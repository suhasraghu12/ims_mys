// App data lives in one immutable snapshot; React subscribes with useSyncExternalStore.
// Every write goes to IndexedDB first, then replaces the snapshot so screens re-render.
import { useSyncExternalStore } from 'react';
import { db } from './db.js';
import * as L from './logic.js';
import * as Img from './image.js';
import { uid } from './format.js';

let state = { ready: false, settings: null, customers: [], entries: [], phonebook: [], sync: null, syncStatus: 'idle', flow: null, locked: false };
const subs = new Set();
const set = patch => { state = { ...state, ...patch }; subs.forEach(f => f()); };
const subscribe = f => { subs.add(f); return () => subs.delete(f); };

// Cloud sync listens here so it can push soon after anything is saved
let onLocalChange = () => {};
export const setChangeListener = f => { onLocalChange = f; };

export const getState = () => state;
export const useStore = () => useSyncExternalStore(subscribe, getState);

export async function load() {
  const settings = { ...L.DEFAULT_SETTINGS, ...((await db.get('settings', 'app')) || {}) };
  const phonebook = (await db.get('settings', 'phonebook'))?.list || [];
  const sync = (await db.get('settings', 'sync')) || null;
  set({ ready: true, settings, customers: await db.all('customers'), entries: await db.all('entries'), phonebook, sync, locked: !!settings.pinHash });
}

// Contacts imported from the phone's contact book ({ name, phone } rows), kept on this phone only
export async function savePhonebook(list) {
  await db.put('settings', { key: 'phonebook', list });
  set({ phonebook: list });
}

export async function saveSettings(patch) {
  const settings = { ...state.settings, ...patch, updatedAt: Date.now() };
  await db.put('settings', { ...settings, key: 'app' });
  set({ settings });
  onLocalChange();
}

// Cloud sync connection + progress (this phone only; never synced or backed up)
export async function saveSync(patch) {
  const sync = patch && { ...state.sync, ...patch };
  if (sync) await db.put('settings', { ...sync, key: 'sync' }); else await db.del('settings', 'sync');
  set({ sync });
}
export const setSyncStatus = syncStatus => set({ syncStatus });

// Merge records that came from the cloud: the newer copy of each record wins.
// Their updatedAt is kept as-is, so they aren't pushed back as new changes.
export async function applyRemote({ customers = [], entries = [], settings = null }, { forceSettings = false } = {}) {
  const patch = {};
  for (const [key, incoming] of [['customers', customers], ['entries', entries]]) {
    const map = new Map(state[key].map(x => [x.id, x]));
    const changed = incoming.filter(r => !map.has(r.id) || (r.updatedAt || 0) >= (map.get(r.id).updatedAt || 0));
    if (!changed.length) continue;
    await db.putMany(key, changed);
    changed.forEach(r => map.set(r.id, r));
    patch[key] = [...map.values()];
  }
  if (settings && (forceSettings || (settings.updatedAt || 0) > (state.settings.updatedAt || 0))) {
    const { id, key, ...shared } = settings;
    patch.settings = { ...state.settings, ...shared };
    await db.put('settings', { ...patch.settings, key: 'app' });
  }
  if (Object.keys(patch).length) set(patch);
}

async function upsert(key, rec) {
  rec = { ...rec, updatedAt: Date.now() };
  await db.put(key, rec);
  onLocalChange();
  const list = state[key];
  set({ [key]: list.some(x => x.id === rec.id) ? list.map(x => (x.id === rec.id ? rec : x)) : [...list, rec] });
  return rec;
}
export const saveCustomer = c => upsert('customers', c);
export const saveEntry = e => upsert('entries', e);
export const touch = id => saveCustomer({ ...customerById(id), lastActivityAt: Date.now() });

export const setLocked = locked => set({ locked });

// The bill / payment currently being entered
export const startFlow = flow => set({ flow });
export const setFlow = patch => state.flow && set({ flow: { ...state.flow, ...patch } });

/* ---------- Selectors ---------- */

export const customerById = id => state.customers.find(c => c.id === id);
export const activeCustomers = (s = state) => s.customers.filter(c => !c.deleted);
export const entriesOf = (id, s = state) => s.entries.filter(e => e.customerId === id && !e.deleted);
export const recency = c => c.lastActivityAt || c.createdAt || 0;

// Balances for every customer, recomputed only when data (or the day) changes
let memo = {};
function statusMap(s) {
  const day = L.startOfDay(Date.now());
  if (memo.entries !== s.entries || memo.customers !== s.customers || memo.settings !== s.settings || memo.day !== day) {
    const byCustomer = new Map();
    for (const e of s.entries) {
      if (e.deleted) continue;
      if (!byCustomer.has(e.customerId)) byCustomer.set(e.customerId, []);
      byCustomer.get(e.customerId).push(e);
    }
    const map = new Map(s.customers.map(c => [c.id, L.customerStatus(c, byCustomer.get(c.id) || [], s.settings)]));
    memo = { entries: s.entries, customers: s.customers, settings: s.settings, day, map };
  }
  return memo.map;
}
export const statusOf = (c, s = state) => statusMap(s).get(c.id) || L.customerStatus(c, entriesOf(c.id, s), s.settings);

/* ---------- Photos ---------- */

const urlCache = new Map();
export async function photoURL(id, kind = 'thumb') {
  const key = id + kind;
  if (!urlCache.has(key)) {
    const p = await db.get('photos', id);
    if (!p) return '';
    urlCache.set(key, URL.createObjectURL(p[kind] || p.blob));
  }
  return urlCache.get(key);
}

export async function photoFile(id, name) {
  const p = id && (await db.get('photos', id));
  return p ? new File([p.blob], name, { type: p.blob.type || 'image/jpeg' }) : null;
}
export const qrFile = () => (state.settings.attachQr && state.settings.qrPhotoId ? photoFile(state.settings.qrPhotoId, 'upi-qr.jpg') : null);

export async function processPhoto(file) {
  const [{ blob, thumb }, hash] = await Promise.all([Img.compress(file), Img.sha256(file)]);
  return { blob, thumb, hash, url: URL.createObjectURL(thumb), fullUrl: URL.createObjectURL(blob) };
}

export async function savePhoto(photo) {
  const id = uid();
  await db.put('photos', { id, blob: photo.blob, thumb: photo.thumb, createdAt: Date.now() });
  if (state.sync) await saveSync({ pendingPhotos: [...(state.sync.pendingPhotos || []), id] });
  return id;
}
export const deletePhoto = id => db.del('photos', id);
