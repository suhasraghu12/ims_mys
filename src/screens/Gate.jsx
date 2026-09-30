// Screens shown before the app: PIN lock and first-run setup
import { useEffect, useState } from 'react';
import { useStore, saveSettings, setLocked } from '../lib/store.js';
import { Icon, Keypad, PinDots } from '../ui/components.jsx';
import { go } from '../ui/router.js';
import { checkPin } from '../actions.jsx';
import { sheet } from '../ui/overlay.jsx';
import { ConnectForm } from './CloudSync.jsx';

export function Lock() {
  const { settings } = useStore();
  const [v, setV] = useState('');
  const [shake, setShake] = useState(false);
  useEffect(() => {
    if (v.length < 4) return;
    let live = true;
    checkPin(v).then(ok => {
      if (!live) return;
      if (ok) return setLocked(false);
      setShake(true);
      setTimeout(() => { setV(''); setShake(false); }, 400);
    });
    return () => { live = false; };
  }, [v]);
  return <main className="lock">
    <div className="lock-icon"><Icon name="lock" /></div>
    <h1>{settings.shopName}</h1>
    <p>Enter PIN</p>
    <PinDots count={v.length} shake={shake} />
    <Keypad value={v} onChange={setV} max={4} pin />
  </main>;
}

export function Setup() {
  const { settings } = useStore();
  const submit = async e => {
    e.preventDefault();
    const f = e.target.elements;
    await saveSettings({ shopName: f.shopName.value.trim(), upiId: f.upiId.value.trim(), setupDone: true });
    go('home', {}, true);
  };
  // A second phone: pull everything from the cloud instead of starting empty
  const connectExisting = () => sheet(close => <>
    <h2>Connect to cloud</h2>
    <p className="muted">Customers, bills and settings will be downloaded to this phone.</p>
    <ConnectForm onConnected={async () => { close(); await saveSettings({ setupDone: true }); go('home', {}, true); }} />
  </>);

  return <main className="setup">
    <div className="logo"><Icon name="receipt" /></div>
    <h1>Welcome to Shop Khata</h1>
    <p className="muted">Photograph credit bills, keep balances, and send them on WhatsApp.</p>
    <form className="form" onSubmit={submit}>
      <label>Shop name<input name="shopName" required autoComplete="organization" defaultValue={settings.shopName} /></label>
      <label>UPI ID <small>(optional, shown in messages)</small><input name="upiId" placeholder="shopname@okaxis" autoComplete="off" /></label>
      <button className="btn primary block big">Start</button>
    </form>
    <button className="link-btn" onClick={connectExisting}>Already using Shop Khata on another phone? Connect to cloud</button>
  </main>;
}
