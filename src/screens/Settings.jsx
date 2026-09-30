import { useEffect, useRef, useState } from 'react';
import * as L from '../lib/logic.js';
import { useStore, saveSettings, savePhoto, deletePhoto, processPhoto } from '../lib/store.js';
import { cycleOptions, cycleValue, parseCycle } from '../lib/format.js';
import { Header, Icon, Photo } from '../ui/components.jsx';
import { toast } from '../ui/toast.jsx';
import { pickFile, setPin, removePin, doBackup, doRestore } from '../actions.jsx';
import CloudSync from './CloudSync.jsx';

const TEMPLATES = [['billTemplate', 'New bill', 5], ['reminderTemplate', 'Reminder', 5], ['paymentTemplate', 'Payment receipt', 4]];

export default function Settings() {
  const { settings: st } = useStore();
  const form = useRef();
  const [persisted, setPersisted] = useState(null);
  useEffect(() => { navigator.storage?.persisted?.().then(setPersisted); }, []);

  // The form is uncontrolled (like a paper form): values are read when Save is tapped
  const submit = async e => {
    e.preventDefault();
    const v = n => form.current.elements[n];
    const cyc = parseCycle(v('defaultCycle').value);
    await saveSettings({
      shopName: v('shopName').value.trim() || L.DEFAULT_SETTINGS.shopName,
      upiId: v('upiId').value.trim(),
      attachQr: v('attachQr').checked,
      countryCode: v('countryCode').value.replace(/\D/g, '') || '91',
      freezeDays: Math.max(1, +v('freezeDays').value || 15),
      defaultCreditLimit: Math.max(0, +v('defaultCreditLimit').value || 0),
      defaultDueType: cyc.dueType,
      defaultDueValue: cyc.dueValue,
      ...Object.fromEntries(TEMPLATES.map(([k]) => [k, v(k).value])),
    });
    toast('Settings saved ✓');
  };

  const resetTemplates = () => {
    for (const [k, t] of Object.entries(L.DEFAULT_TEMPLATES)) form.current.elements[k].value = t;
    toast('Tap “Save settings” to keep');
  };

  const changeQr = async () => {
    const file = await pickFile();
    if (!file) return;
    const old = st.qrPhotoId;
    await saveSettings({ qrPhotoId: await savePhoto(await processPhoto(file)) });
    if (old) await deletePhoto(old);
  };
  const removeQr = async () => { await deletePhoto(st.qrPhotoId); await saveSettings({ qrPhotoId: null }); };

  return <>
    <Header title="Settings" />
    <main>
      <form ref={form} className="form" onSubmit={submit}>
        <h2 className="section">Shop</h2>
        <label>Shop name<input name="shopName" defaultValue={st.shopName} /></label>
        <label>UPI ID <small>(shown in messages)</small><input name="upiId" defaultValue={st.upiId} placeholder="shopname@okaxis" autoComplete="off" /></label>
        <div className="qr-row">
          {st.qrPhotoId && <Photo id={st.qrPhotoId} className="qr-thumb" alt="UPI QR" />}
          <button type="button" className="btn" onClick={changeQr}><Icon name="camera" /> {st.qrPhotoId ? 'Change' : 'Add'} UPI QR photo</button>
          {st.qrPhotoId && <button type="button" className="btn danger-outline" onClick={removeQr}>Remove</button>}
        </div>
        <label className="check"><input type="checkbox" name="attachQr" defaultChecked={st.attachQr} /> Attach QR photo to bills and reminders</label>
        <label>Country code<input name="countryCode" inputMode="numeric" defaultValue={st.countryCode} /></label>

        <h2 className="section">Credit rules</h2>
        <label>Warn before giving credit when overdue more than (days)<input name="freezeDays" type="number" inputMode="numeric" min="1" defaultValue={st.freezeDays} /></label>
        <label>Default credit limit for new customers ₹ <small>(0 = no limit)</small><input name="defaultCreditLimit" type="number" inputMode="numeric" min="0" defaultValue={st.defaultCreditLimit} /></label>
        <label>Default payment cycle
          <select name="defaultCycle" defaultValue={cycleValue(st.defaultDueType, st.defaultDueValue)}>
            {cycleOptions(st.defaultDueType, st.defaultDueValue, false).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>

        <h2 className="section">WhatsApp messages</h2>
        <p className="muted small">You can write these in any language. Words in {'{braces}'} are filled in automatically:
          {' {name} {amount} {total} {date} {since} {shop} {upi}'}. A line is skipped if its value is empty.</p>
        {TEMPLATES.map(([k, label, rows]) => <label key={k}>{label}<textarea name={k} rows={rows} defaultValue={st[k]} /></label>)}
        <button type="button" className="link-btn" onClick={resetTemplates}>Reset messages to default</button>
        <button className="btn primary block big">Save settings</button>
      </form>

      <h2 className="section">Cloud sync</h2>
      <CloudSync />

      <h2 className="section">Security</h2>
      <button className="btn block" onClick={setPin}><Icon name="lock" /> {st.pinHash ? 'Change PIN' : 'Set a PIN'}</button>
      {st.pinHash && <button className="btn block" onClick={removePin}>Remove PIN</button>}

      <h2 className="section">Backup</h2>
      <p className="muted small">Last backup: {st.lastBackupAt ? L.fmtDate(st.lastBackupAt, true) : 'never'}.
        Save a copy to Google Drive or send it to yourself on WhatsApp every week.</p>
      <button className="btn block" onClick={doBackup}><Icon name="upload" /> Backup now</button>
      <button className="btn block" onClick={doRestore}><Icon name="restore" /> Restore from backup</button>
      {persisted !== null && <p className="muted small">Phone storage: {persisted ? 'protected ✓' : 'not protected — the browser may clear it if the phone is full. Install the app to protect it.'}</p>}
    </main>
  </>;
}
