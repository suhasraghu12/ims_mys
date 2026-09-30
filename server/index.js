// Shop Khata cloud sync server.
// Holds the MongoDB credentials (from .env) so they never reach the phone, and serves
// the built app from dist/, so one deploy gives both the app and its sync API.
//
//   POST /api/sync          push local changes, get everything changed since `since`
//   POST /api/photos        upload one photo (base64 JSON) → stored privately in Cloudinary
//   GET  /api/photos/:id    download one photo (full + thumbnail, fetched from Cloudinary)
//   GET  /api/health        check the key and the database connection
//
// Every /api call needs the header  x-shop-key: <SHOP_KEY>.
import express from 'express';
import { MongoClient } from 'mongodb';
import { v2 as cloudinary } from 'cloudinary';
import { timingSafeEqual } from 'node:crypto';
import dns from 'node:dns';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const { MONGO_URI, MONGO_DB_NAME = 'IMS', SHOP_KEY, PORT = 8787, CLOUDINARY_URL, CLOUDINARY_FOLDER = 'shop-khata' } = process.env;
if (!MONGO_URI || !SHOP_KEY || !CLOUDINARY_URL) {
  console.error('Set MONGO_URI, SHOP_KEY and CLOUDINARY_URL (see .env.example).');
  process.exit(1);
}
cloudinary.config({ secure: true }); // reads CLOUDINARY_URL

// Some home routers don't answer the SRV lookup that mongodb+srv:// needs; fall back to public DNS
if (MONGO_URI.startsWith('mongodb+srv://')) {
  const host = new URL(MONGO_URI.replace('mongodb+srv://', 'http://')).hostname;
  try { await dns.promises.resolveSrv(`_mongodb._tcp.${host}`); } catch {
    dns.setServers(['1.1.1.1', '8.8.8.8']);
    console.log('Local DNS could not resolve the cluster; using public DNS (1.1.1.1, 8.8.8.8)');
  }
}

const client = new MongoClient(MONGO_URI);
await client.connect();
const db = client.db(MONGO_DB_NAME);
const RECORDS = ['customers', 'entries', 'settings'];
for (const name of [...RECORDS, 'photos']) await db.collection(name).createIndex({ _syncedAt: 1 });
console.log(`Connected to MongoDB database "${MONGO_DB_NAME}"; photos → Cloudinary "${cloudinary.config().cloud_name}/${CLOUDINARY_FOLDER}"`);

const app = express();
app.disable('x-powered-by');

// The app may be hosted elsewhere (e.g. Netlify) — allow it to call the API; the key is the protection
app.use('/api', (req, res, next) => {
  res.set({ 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type, x-shop-key', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' });
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const keyBuf = Buffer.from(SHOP_KEY);
app.use('/api', (req, res, next) => {
  const got = Buffer.from(req.get('x-shop-key') || '');
  if (got.length !== keyBuf.length || !timingSafeEqual(got, keyBuf)) return res.status(401).json({ error: 'Wrong shop key' });
  next();
});
app.use('/api', express.json({ limit: '12mb' }));

app.get('/api/health', async (req, res) => {
  await db.command({ ping: 1 });
  res.json({ ok: true, db: MONGO_DB_NAME });
});

// Last write wins: a record is stored only if it is newer than the copy already in the cloud
async function upsertNewer(name, docs, now) {
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

app.post('/api/sync', async (req, res) => {
  const { since = 0, changes = {} } = req.body || {};
  const now = Date.now();
  const pushed = {};
  for (const name of ['customers', 'entries']) {
    const docs = (changes[name] || []).filter(d => d && typeof d.id === 'string');
    pushed[name] = docs.map(d => d.id);
    await upsertNewer(name, docs, now);
  }
  const settings = changes.settings ? [{ ...changes.settings, id: 'app' }] : [];
  pushed.settings = settings.map(d => d.id);
  await upsertNewer('settings', settings, now);

  // Everything that changed since the phone last synced, minus what it just sent
  const pull = name => db.collection(name)
    .find({ _syncedAt: { $gt: Number(since) || 0 }, _id: { $nin: pushed[name] } })
    .project({ _id: 0, _syncedAt: 0 })
    .toArray();
  const [customers, entries, [remoteSettings = null]] = await Promise.all(RECORDS.map(pull));
  res.json({ now, changes: { customers, entries, settings: remoteSettings } });
});

// Photos live in Cloudinary as "authenticated" (private) images: they can only be viewed through
// signed URLs, which only this server can make. MongoDB keeps a small record per photo.
const THUMB = { width: 320, height: 320, crop: 'limit', quality: 70, format: 'jpg' };
const signedUrl = (p, transformation) =>
  cloudinary.url(p.publicId, { type: 'authenticated', sign_url: true, version: p.version, format: 'jpg', ...(transformation && { transformation: [transformation] }) });
const fetchB64 = async url => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Cloudinary returned ${r.status}`);
  return Buffer.from(await r.arrayBuffer()).toString('base64');
};

app.post('/api/photos', async (req, res) => {
  const { id, createdAt, blob } = req.body || {};
  if (typeof id !== 'string' || !/^[\w-]{1,64}$/.test(id) || typeof blob !== 'string') return res.status(400).json({ error: 'Bad photo' });
  const photos = db.collection('photos');
  if (await photos.findOne({ _id: id, publicId: { $exists: true } })) return res.json({ ok: true }); // already uploaded
  const up = await cloudinary.uploader.upload(`data:image/jpeg;base64,${blob}`, {
    public_id: id, folder: CLOUDINARY_FOLDER, type: 'authenticated', resource_type: 'image', overwrite: false,
  });
  await photos.updateOne({ _id: id }, {
    $set: { createdAt, publicId: up.public_id, version: up.version, bytes: up.bytes, _syncedAt: Date.now() },
    $unset: { blob: '', thumb: '' },
  }, { upsert: true });
  res.json({ ok: true });
});

app.get('/api/photos/:id', async (req, res) => {
  const p = await db.collection('photos').findOne({ _id: req.params.id });
  if (!p) return res.status(404).json({ error: 'No such photo' });
  if (!p.publicId) { // stored before Cloudinary was added: still inside MongoDB
    return res.json({ id: p._id, createdAt: p.createdAt, blob: Buffer.from(p.blob.buffer).toString('base64'), thumb: p.thumb ? Buffer.from(p.thumb.buffer).toString('base64') : null });
  }
  const [blob, thumb] = await Promise.all([fetchB64(signedUrl(p)), fetchB64(signedUrl(p, THUMB))]);
  res.json({ id: p._id, createdAt: p.createdAt, blob, thumb });
});

app.use('/api', (err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

// Serve the built app (npm run build) with SPA fallback
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
app.use(express.static(dist));
app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));

app.listen(PORT, () => console.log(`Shop Khata server on http://localhost:${PORT}`));
