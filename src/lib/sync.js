// Cloud sync with the Shop Khata server (server/index.js → MongoDB).
// Every phone keeps its full copy in IndexedDB and works offline; sync pushes this
// phone's changes and pulls everyone else's. The newer copy of a record wins.
import { db } from './db.js';
import { getState, saveSync, setSyncStatus, applyRemote, setChangeListener } from './store.js';
import { blobToDataURL, dataURLToBlob } from './image.js';

// PIN and backup date stay per-phone; everything else in settings is shared
const LOCAL_SETTINGS = ['key', 'pinHash', 'pinSalt', 'lastBackupAt', 'setupDone'];
const OVERLAP = 5000; // re-read the last 5 s each time, so writes landing mid-sync are never missed

const base = url => (url || '').trim().replace(/\/+$/, '');
const b64 = async blob => (await blobToDataURL(blob)).split(',')[1];
const fromB64 = s => dataURLToBlob(`data:image/jpeg;base64,${s}`);

async function api(cfg, path, body) {
  const res = await fetch(base(cfg.url) + path, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', 'x-shop-key': cfg.key },
    body: body && JSON.stringify(body),
  });
  if (res.status === 401) throw new Error('Wrong shop key');
  if (res.status === 404 && path.startsWith('/api/photos/')) return null;
  if (!res.ok) throw new Error(`Server error (${res.status})`);
  return res.json();
}

const sharedSettings = s => Object.fromEntries(Object.entries(s).filter(([k]) => !LOCAL_SETTINGS.includes(k)));
const changedSince = (list, t) => list.filter(r => (r.updatedAt || 0) >= t);

async function uploadPhotos(cfg) {
  const done = new Set();
  for (const id of cfg.pendingPhotos || []) {
    const p = await db.get('photos', id);
    if (p) await api(cfg, '/api/photos', { id, createdAt: p.createdAt, blob: await b64(p.blob), thumb: p.thumb ? await b64(p.thumb) : null });
    done.add(id);
  }
  // Re-read: photos saved while uploading stay queued
  if (done.size) await saveSync({ pendingPhotos: (getState().sync.pendingPhotos || []).filter(id => !done.has(id)) });
}

async function downloadPhotos(cfg, ids) {
  const missing = [];
  for (const id of new Set(ids)) {
    if (await db.get('photos', id)) continue;
    const p = await api(cfg, `/api/photos/${encodeURIComponent(id)}`);
    if (!p) { missing.push(id); continue; } // not uploaded yet by the other phone — try again next time
    await db.put('photos', { id, createdAt: p.createdAt, blob: await fromB64(p.blob), thumb: p.thumb ? await fromB64(p.thumb) : null });
  }
  return missing;
}

const photoIdsIn = ch => [...(ch.entries || []).map(e => e.photoId), ch.settings?.qrPhotoId].filter(Boolean);

async function runSync() {
  const cfg = getState().sync;
  if (!cfg?.key || !navigator.onLine) return;
  setSyncStatus('syncing');
  try {
    const startedAt = Date.now();
    await uploadPhotos(cfg);

    // First sync on this phone: take the cloud's shared settings (if any) before pushing ours
    let since = cfg.cursor || 0;
    let pushSettings = true;
    let wanted = cfg.missingPhotos || [];
    if (!cfg.connectedOnce) {
      const first = await api(cfg, '/api/sync', { since: 0, changes: {} });
      await applyRemote(first.changes, { forceSettings: true });
      pushSettings = !first.changes.settings;
      since = first.now - OVERLAP;
      wanted = [...wanted, ...photoIdsIn(first.changes)];
    }

    const { customers, entries, settings } = getState();
    const from = cfg.connectedOnce ? cfg.lastPushAt || 0 : 0;
    const changes = {
      customers: changedSince(customers, from),
      entries: changedSince(entries, from),
      settings: pushSettings && (settings.updatedAt || 0) >= from ? sharedSettings(settings) : null,
    };
    const res = await api(cfg, '/api/sync', { since, changes });
    await applyRemote(res.changes);
    const missingPhotos = await downloadPhotos(cfg, [...wanted, ...photoIdsIn(res.changes)]);

    await saveSync({ connectedOnce: true, cursor: res.now - OVERLAP, lastPushAt: startedAt, lastSyncAt: Date.now(), missingPhotos, error: null });
    setSyncStatus('ok');
  } catch (err) {
    await saveSync({ error: navigator.onLine ? err.message : 'Offline' });
    setSyncStatus('error');
    throw err;
  }
}

let running = null;
let again = false;
// Runs one sync at a time; a request during a sync queues exactly one more
export function syncNow() {
  if (running) { again = true; return running; }
  running = runSync().finally(() => {
    running = null;
    if (again) { again = false; syncNow().catch(() => {}); }
  });
  return running;
}

/* ---------- Connect / disconnect ---------- */

export async function testConnection(url, key) {
  const res = await api({ url, key }, '/api/health');
  return res.ok;
}

export async function connect(url, key) {
  await testConnection(url, key);
  // Queue every photo already on this phone for upload
  await saveSync({ url: base(url), key, cursor: 0, lastPushAt: 0, connectedOnce: false, pendingPhotos: await db.keys('photos'), missingPhotos: [], error: null });
  await syncNow();
}

export const disconnect = () => saveSync(null);

/* ---------- Automatic sync ---------- */

export function startAutoSync() {
  let timer;
  const soon = (ms = 3000) => { clearTimeout(timer); timer = setTimeout(() => syncNow().catch(() => {}), ms); };
  setChangeListener(() => soon());
  const onVisible = () => { if (!document.hidden) soon(500); };
  document.addEventListener('visibilitychange', onVisible);
  addEventListener('online', () => soon(500));
  const interval = setInterval(() => { if (!document.hidden) syncNow().catch(() => {}); }, 2 * 60 * 1000);
  soon(500);
  return () => { clearTimeout(timer); clearInterval(interval); document.removeEventListener('visibilitychange', onVisible); setChangeListener(() => {}); };
}
