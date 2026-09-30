// Shop Khata cloud API — one implementation used by both hosts:
//   • Netlify:  netlify/functions/api.mjs  (serverless function on /api/*)
//   • Anywhere: server/index.js            (Express, for local use or Render/Railway)
//
//   POST /api/sync          push local changes, get everything changed since `since`
//   POST /api/photos        upload one photo (base64 JSON) → stored privately in Cloudinary
//   GET  /api/photos/:id    download one photo (full + thumbnail, fetched from Cloudinary)
//   GET  /api/health        check the key and the database connection
//
// Every call needs the header  x-shop-key: <SHOP_KEY>. Secrets come from environment variables only.
import { MongoClient } from 'mongodb';
import { v2 as cloudinary } from 'cloudinary';
import { timingSafeEqual } from 'node:crypto';
import dns from 'node:dns';

const REQUIRED = ['MONGO_URI', 'SHOP_KEY', 'CLOUDINARY_URL'];
const RECORDS = ['customers', 'entries', 'settings'];
const env = () => ({ dbName: process.env.MONGO_DB_NAME || 'IMS', folder: process.env.CLOUDINARY_FOLDER || 'shop-khata' });

// One MongoDB connection per server / warm function instance, reused across requests
let dbPromise = null;
function getDb() {
  dbPromise ||= (async () => {
    const uri = process.env.MONGO_URI;
    // Some home routers don't answer the SRV lookup that mongodb+srv:// needs; fall back to public DNS
    if (uri.startsWith('mongodb+srv://')) {
      const host = new URL(uri.replace('mongodb+srv://', 'http://')).hostname;
      try { await dns.promises.resolveSrv(`_mongodb._tcp.${host}`); } catch {
        dns.setServers(['1.1.1.1', '8.8.8.8']);
        console.log('Local DNS could not resolve the cluster; using public DNS (1.1.1.1, 8.8.8.8)');
      }
    }
    const client = new MongoClient(uri, { maxPoolSize: 5 });
    await client.connect();
    const db = client.db(env().dbName);
    await Promise.all([...RECORDS, 'photos'].map(n => db.collection(n).createIndex({ _syncedAt: 1 })));
    return db;
  })().catch(err => { dbPromise = null; throw err; });
  return dbPromise;
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, x-shop-key', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS } });

function keyOk(got) {
  const want = Buffer.from(process.env.SHOP_KEY);
  const g = Buffer.from(got || '');
  return g.length === want.length && timingSafeEqual(g, want);
}

// Last write wins: a record is stored only if it is newer than the copy already in the cloud
async function upsertNewer(db, name, docs, now) {
  if (!docs.length) return;
  try {
    await db.collection(name).bulkWrite(docs.map(d => ({
      updateOne: {
        filter: { _id: d.id, $or: [{ updatedAt: { $lt: d.updatedAt || 0 } }, { updatedAt: { $exists: false } }] },
        update: { $set: { ...d, _syncedAt: now } },
        upsert: true,
      },
    })), { ordered: false });
  } catch (err) {
    // E11000 = the cloud copy is newer, so the upsert was skipped — that's expected
    if (!err.writeErrors?.every(w => w.code === 11000)) throw err;
  }
}

async function sync(db, { since = 0, changes = {} }) {
  const now = Date.now();
  const pushed = {};
  for (const name of ['customers', 'entries']) {
    const docs = (changes[name] || []).filter(d => d && typeof d.id === 'string');
    pushed[name] = docs.map(d => d.id);
    await upsertNewer(db, name, docs, now);
  }
  const settings = changes.settings ? [{ ...changes.settings, id: 'app' }] : [];
  pushed.settings = settings.map(d => d.id);
  await upsertNewer(db, 'settings', settings, now);

  // Everything that changed since the phone last synced, minus what it just sent
  const pull = name => db.collection(name)
    .find({ _syncedAt: { $gt: Number(since) || 0 }, _id: { $nin: pushed[name] } })
    .project({ _id: 0, _syncedAt: 0 })
    .toArray();
  const [customers, entries, [remoteSettings = null]] = await Promise.all(RECORDS.map(pull));
  return { now, changes: { customers, entries, settings: remoteSettings } };
}

// Photos live in Cloudinary as "authenticated" (private) images: they can only be viewed through
// signed URLs, which only this API can make. MongoDB keeps a small record per photo.
const THUMB = { width: 320, height: 320, crop: 'limit', quality: 70, format: 'jpg' };
const signedUrl = (p, transformation) =>
  cloudinary.url(p.publicId, { type: 'authenticated', sign_url: true, version: p.version, format: 'jpg', ...(transformation && { transformation: [transformation] }) });
const fetchB64 = async url => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Cloudinary returned ${r.status}`);
  return Buffer.from(await r.arrayBuffer()).toString('base64');
};

async function uploadPhoto(db, { id, createdAt, blob }) {
  if (typeof id !== 'string' || !/^[\w-]{1,64}$/.test(id) || typeof blob !== 'string') return json({ error: 'Bad photo' }, 400);
  const photos = db.collection('photos');
  if (await photos.findOne({ _id: id, publicId: { $exists: true } })) return json({ ok: true }); // already uploaded
  const up = await cloudinary.uploader.upload(`data:image/jpeg;base64,${blob}`, {
    public_id: id, folder: env().folder, type: 'authenticated', resource_type: 'image', overwrite: false,
  });
  await photos.updateOne({ _id: id }, {
    $set: { createdAt, publicId: up.public_id, version: up.version, bytes: up.bytes, _syncedAt: Date.now() },
    $unset: { blob: '', thumb: '' },
  }, { upsert: true });
  return json({ ok: true });
}

async function downloadPhoto(db, id) {
  const p = await db.collection('photos').findOne({ _id: id });
  if (!p) return json({ error: 'No such photo' }, 404);
  if (!p.publicId) { // stored before Cloudinary was added: still inside MongoDB
    return json({ id: p._id, createdAt: p.createdAt, blob: Buffer.from(p.blob.buffer).toString('base64'), thumb: p.thumb ? Buffer.from(p.thumb.buffer).toString('base64') : null });
  }
  const [blob, thumb] = await Promise.all([fetchB64(signedUrl(p)), fetchB64(signedUrl(p, THUMB))]);
  return json({ id: p._id, createdAt: p.createdAt, blob, thumb });
}

export async function handleApi(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const missing = REQUIRED.filter(k => !process.env[k]);
  if (missing.length) {
    console.error(`Missing environment variables: ${missing.join(', ')}`);
    return json({ error: 'Server is not configured' }, 500);
  }
  if (!keyOk(req.headers.get('x-shop-key'))) return json({ error: 'Wrong shop key' }, 401);
  cloudinary.config({ secure: true }); // reads CLOUDINARY_URL

  const path = new URL(req.url).pathname.replace(/\/+$/, '');
  try {
    const db = await getDb();
    const body = req.method === 'POST' ? await req.json().catch(() => null) : null;
    if (req.method === 'POST' && !body) return json({ error: 'Bad JSON' }, 400);

    if (req.method === 'GET' && path === '/api/health') { await db.command({ ping: 1 }); return json({ ok: true, db: env().dbName }); }
    if (req.method === 'POST' && path === '/api/sync') return json(await sync(db, body));
    if (req.method === 'POST' && path === '/api/photos') return await uploadPhoto(db, body);
    const m = path.match(/^\/api\/photos\/([\w-]{1,64})$/);
    if (req.method === 'GET' && m) return await downloadPhoto(db, m[1]);
    return json({ error: 'Not found' }, 404);
  } catch (err) {
    console.error(err);
    return json({ error: 'Server error' }, 500);
  }
}
