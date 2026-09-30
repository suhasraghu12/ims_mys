// Settings → Cloud sync, and the "connect" form reused on the first-run screen
import { useState } from 'react';
import * as L from '../lib/logic.js';
import { useStore } from '../lib/store.js';
import { plural } from '../lib/format.js';
import { connect, disconnect, syncNow } from '../lib/sync.js';
import { Icon } from '../ui/components.jsx';
import { confirmBox } from '../ui/overlay.jsx';
import { toast } from '../ui/toast.jsx';

export function ago(t) {
  const m = Math.round((Date.now() - t) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : L.fmtDate(t, true);
}

export function ConnectForm({ onConnected }) {
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async e => {
    e.preventDefault();
    setBusy(true);
    try {
      await connect(url, key.trim());
      toast('Connected ✓ — data synced');
      onConnected?.();
    } catch (err) {
      toast(err.message === 'Wrong shop key' ? 'Wrong shop key' : `Could not connect: ${err.message}`, 4000);
    } finally { setBusy(false); }
  };
  return <form className="form" onSubmit={submit}>
    <label>Server address <small>(leave empty if you opened the app from the server)</small>
      <input type="url" inputMode="url" placeholder="https://your-khata-server.onrender.com" value={url} onChange={e => setUrl(e.target.value)} autoComplete="off" />
    </label>
    <label>Shop key
      <input type="password" required value={key} onChange={e => setKey(e.target.value)} autoComplete="off" placeholder="From the server's .env (SHOP_KEY)" />
    </label>
    <button className="btn primary block big" disabled={busy || !key.trim()}>{busy ? 'Connecting…' : 'Connect & sync'}</button>
  </form>;
}

export default function CloudSync() {
  const { sync, syncStatus } = useStore();

  if (!sync) return <>
    <p className="muted small">Keep a live copy in the cloud and use the app on more than one phone. Everything keeps working offline and syncs when there is internet.</p>
    <ConnectForm />
  </>;

  const pending = sync.pendingPhotos?.length || 0;
  const state = syncStatus === 'syncing' ? 'syncing' : sync.error ? 'error' : 'ok';
  const run = () => syncNow().then(() => toast('Synced ✓')).catch(err => toast(`Sync failed: ${err.message}`, 4000));
  const off = async () => {
    if (await confirmBox({ title: 'Disconnect this phone?', body: <p>Data stays on this phone and in the cloud, but they stop syncing until you connect again.</p>, ok: 'Disconnect', danger: true })) {
      await disconnect();
      toast('Disconnected');
    }
  };

  return <>
    <div className={`sync-card sync-${state}`}>
      <span className="ibox"><Icon name={state === 'error' ? 'alert' : state === 'syncing' ? 'restore' : 'check'} /></span>
      <div>
        <b>{state === 'syncing' ? 'Syncing…' : state === 'error' ? `Not synced — ${sync.error}` : 'Connected to cloud'}</b>
        <div className="small muted">
          {sync.lastSyncAt ? `Last synced ${ago(sync.lastSyncAt)}` : 'Not synced yet'}
          {pending > 0 && ` · ${plural(pending, 'photo')} waiting to upload`}
          {sync.url && <> · {new URL(sync.url).host}</>}
        </div>
      </div>
    </div>
    <button className="btn block" onClick={run} disabled={state === 'syncing'}><Icon name="restore" /> Sync now</button>
    <button className="btn danger-outline block" onClick={off}>Disconnect this phone</button>
  </>;
}
