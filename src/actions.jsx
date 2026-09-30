// Everything that changes data or talks to the phone (camera, share sheet, files).
// Screens call these; they open sheets and update the store.
import { useEffect, useRef, useState } from 'react';
import { db } from './lib/db.js';
import * as L from './lib/logic.js';
import * as Img from './lib/image.js';
import {
  useStore, getState, saveSettings, saveCustomer, saveEntry, savePhonebook, touch, startFlow, setFlow, customerById, activeCustomers,
  entriesOf, statusOf, photoFile, qrFile, processPhoto, savePhoto,
} from './lib/store.js';
import { uid, plural, cycleOptions, cycleValue, parseCycle } from './lib/format.js';
import { sheet, confirmBox, askAmount, askPin } from './ui/overlay.jsx';
import { toast } from './ui/toast.jsx';
import { go, back, currentRoute } from './ui/router.js';
import { Icon } from './ui/components.jsx';

const settings = () => getState().settings;

/* ================= Files & camera ================= */

export function pickFile({ accept = 'image/*', camera = false } = {}) {
  return new Promise(resolve => {
    const i = document.createElement('input');
    i.type = 'file';
    i.accept = accept;
    if (camera) i.capture = 'environment';
    i.onchange = () => resolve(i.files[0] || null);
    i.addEventListener('cancel', () => resolve(null));
    i.click();
  });
}

/* ================= WhatsApp ================= */

export function waPhone(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) d = settings().countryCode + d;
  return d;
}

// Is this a usable mobile number? null = nothing typed yet
export function phoneStatus(phone) {
  if (!String(phone || '').trim()) return null;
  const d = waPhone(phone);
  if (settings().countryCode === '91' && d.startsWith('91')) return /^91[6-9]\d{9}$/.test(d) ? 'ok' : 'bad';
  return d.length >= 11 && d.length <= 15 ? 'ok' : 'bad';
}

// Customers marked "no WhatsApp" get their messages by SMS instead
export const hasNoWhatsApp = c => c?.whatsapp === false;

// Shares photo(s) + message through the phone's share sheet (pick WhatsApp there).
// Phones that can't share files get a text-only WhatsApp chat instead.
async function shareWhatsApp({ text, files = [], phone }) {
  files = files.filter(Boolean);
  navigator.clipboard?.writeText(text).catch(() => {}); // backup copy; never wait on it
  if (files.length && navigator.canShare?.({ files })) {
    try {
      await navigator.share({ files, text });
      if (files.length > 1) toast('Message is also copied — paste it if it is missing', 4000);
      return true;
    } catch (e) {
      if (e.name === 'AbortError') return false;
    }
  }
  window.open(`https://wa.me/${waPhone(phone)}?text=${encodeURIComponent(text)}`, '_blank');
  if (files.length) toast('This phone cannot attach photos from the app — sent text only', 4000);
  return true;
}

function sendSMS({ text, files = [], phone }) {
  location.href = `sms:+${waPhone(phone)}?body=${encodeURIComponent(text)}`;
  if (files.some(Boolean)) toast('Sent by SMS — photos cannot go by SMS', 4000);
  return true;
}

// Sends to the customer on WhatsApp, or by SMS if their number has no WhatsApp
const sendTo = (c, msg) => (hasNoWhatsApp(c) ? sendSMS : shareWhatsApp)({ ...msg, phone: c.phone });

const vars = (c, extra = {}) => ({ name: c.name, shop: settings().shopName, upi: settings().upiId, ...extra });

/* ================= Undo window ================= */

let pending = null; // an entry waiting out its 10-second undo window
export const flushPending = () => pending?.flush(); // app closed during the undo window: keep the entry

function UndoSheet({ title, sendLabel, onFinish, onUndo }) {
  const [left, setLeft] = useState(10);
  useEffect(() => {
    const t = setInterval(() => setLeft(l => l - 1), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { if (left <= 0) onFinish('auto'); }, [left]);
  return <div className="undo">
    <h2>{title}</h2>
    <div className="countdown" aria-live="polite">
      <svg viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="34" /><circle cx="40" cy="40" r="34" style={{ strokeDashoffset: 213.6 * (1 - Math.max(0, left) / 10) }} /></svg>
      <b>{Math.max(0, left)}</b>
    </div>
    <p className="muted">Saving automatically…</p>
    <button className="btn primary block big" onClick={() => onFinish('send')}><Icon name="send" /> {sendLabel}</button>
    <button className="btn block" onClick={() => onFinish('save')}><Icon name="check" /> Save only</button>
    <button className="btn danger-outline block" onClick={onUndo}><Icon name="undo" /> Undo — wrong entry</button>
  </div>;
}

// Nothing is saved for 10 seconds, so a wrong customer or amount can be undone.
function undoWindow({ title, sendLabel, commit, share, afterSaved }) {
  let done = false;
  let close = () => {};
  const finish = async how => {
    if (done) return;
    done = true;
    pending = null;
    close();
    const saving = commit();              // start saving…
    if (how === 'send') await share();    // …and open the share sheet while this tap still counts
    try { await saving; } catch (err) { alert('Could not save! ' + err.message); return; }
    afterSaved(how);
  };
  const undo = () => {
    if (done) return;
    done = true;
    pending = null;
    close();
    toast('Cancelled — nothing saved');
  };
  close = sheet(() => <UndoSheet title={title} sendLabel={sendLabel} onFinish={finish} onUndo={undo} />, { dismissable: false, sticky: true });
  pending = { flush: () => finish('auto') };
}

function sendLater(title, send) {
  sheet(close => <>
    <h2>{title}</h2>
    <p className="muted">Send it to the customer now?</p>
    <button className="btn primary block big" onClick={() => { send(); close(); }}><Icon name="send" /> Send now</button>
    <button className="btn block" onClick={close}>Not now</button>
  </>, { sticky: true });
}

export function leaveFlow() {
  if (['bill', 'payment'].includes(currentRoute().name)) {
    addEventListener('popstate', () => startFlow(null), { once: true });
    back();
  } else startFlow(null);
}

/* ================= New bill ================= */

export function startBill(customerId = null) {
  startFlow({ kind: 'bill', step: 'photo', customerId, photo: null, amount: '' });
  go('bill');
  takeBillPhoto(true); // straight to the camera — same tap
}

export async function takeBillPhoto(camera) {
  const file = await pickFile({ camera });
  if (!file || !getState().flow) return;
  setFlow({ step: 'processing' });
  let photo;
  try {
    photo = await processPhoto(file);
  } catch {
    toast('Could not read that photo, try again');
    return setFlow({ step: 'photo' });
  }
  const F = getState().flow;
  if (!F) return;
  setFlow({ photo });
  if (F.customerId && !(await creditOk(customerById(F.customerId)))) return leaveFlow();
  setFlow({ step: F.customerId ? 'amount' : 'customer' });
}

export async function creditOk(c) {
  const s = statusOf(c);
  if (!s.frozen) return true;
  return confirmBox({
    title: `Careful with ${c.name}`,
    body: <><ul className="reasons">{s.reasons.map(r => <li key={r}>{r}</li>)}</ul><p>Give more credit anyway?</p></>,
    ok: 'Yes, give credit', cancel: 'No', danger: true,
  });
}

export async function saveBill() {
  const F = getState().flow;
  const c = customerById(F.customerId);
  const amount = +F.amount;
  if (!c || !amount) return;

  const warn = [];
  const photo = F.photo;
  const same = photo && getState().entries.find(e => !e.deleted && e.fileHash === photo.hash);
  if (same) warn.push(`This exact photo was already saved for ${customerById(same.customerId)?.name || 'a customer'} on ${L.fmtDate(same.date)}.`);
  const today = L.startOfDay(Date.now());
  if (entriesOf(c.id).some(e => e.type === 'bill' && e.amount === amount && L.startOfDay(e.date) === today)) {
    warn.push(`A ${L.money(amount)} bill for ${c.name} was already saved today.`);
  }
  if (warn.length && !(await confirmBox({ title: 'Looks like a duplicate', body: warn.map(w => <p key={w}>{w}</p>), ok: 'Save anyway', cancel: 'Go back' }))) return;

  const now = Date.now();
  const entry = { id: uid(), customerId: c.id, type: 'bill', amount, date: now, photoId: null, fileHash: photo?.hash || null, createdAt: now };
  const text = L.fillTemplate(settings().billTemplate, vars(c, { amount: L.num(amount), total: L.num(statusOf(c).balance + amount), date: L.fmtDate(now) }));
  const files = [photo && new File([photo.blob], `bill-${L.fmtDate(now).replace(/\W+/g, '-')}.jpg`, { type: 'image/jpeg' }), await qrFile()];
  const send = () => sendTo(c, { text, files });

  undoWindow({
    title: `Bill ${L.money(amount)} for ${c.name}`,
    sendLabel: hasNoWhatsApp(c) ? 'Save & send SMS' : 'Save & send on WhatsApp',
    commit: async () => { if (photo) entry.photoId = await savePhoto(photo); await saveEntry(entry); await touch(c.id); },
    share: send,
    afterSaved: how => {
      leaveFlow();
      if (how === 'auto') sendLater(`Bill ${L.money(amount)} saved for ${c.name}`, send);
      else toast('Bill saved ✓');
    },
  });
}

/* ================= Payment ================= */

export function startPayment(customerId = null) {
  startFlow({ kind: 'payment', step: customerId ? 'amount' : 'customer', customerId, amount: '', mode: 'cash', photo: null });
  go('payment');
}

export async function addReceipt() {
  const file = await pickFile();
  if (!file) return;
  try { setFlow({ photo: await processPhoto(file) }); } catch { toast('Could not read that photo'); }
}

export async function savePayment() {
  const F = getState().flow;
  const c = customerById(F.customerId);
  const amount = +F.amount;
  if (!c || !amount) return;
  const s = statusOf(c);
  if (s.balance > 0 && amount > s.balance && !(await confirmBox({
    title: 'More than pending?',
    body: <p>{c.name} owes only {L.money(s.balance)}. Save {L.money(amount)}? The extra {L.money(amount - s.balance)} is kept as advance.</p>,
    ok: 'Yes, save',
  }))) return;

  const now = Date.now();
  const photo = F.photo;
  const entry = { id: uid(), customerId: c.id, type: 'payment', amount, mode: F.mode, date: now, photoId: null, fileHash: photo?.hash || null, createdAt: now };
  const text = L.fillTemplate(settings().paymentTemplate, vars(c, { amount: L.num(amount), total: L.num(Math.max(0, s.balance - amount)), date: L.fmtDate(now) }));

  undoWindow({
    title: `Payment ${L.money(amount)} from ${c.name}`,
    sendLabel: 'Save & send receipt',
    commit: async () => { if (photo) entry.photoId = await savePhoto(photo); await saveEntry(entry); await touch(c.id); },
    share: () => sendTo(c, { text }),
    afterSaved: () => { leaveFlow(); toast('Payment saved ✓'); },
  });
}

/* ================= Reminders ================= */

export async function sendReminder(c) {
  const s = statusOf(c);
  if (s.balance <= 0) return toast('Nothing pending');
  const text = L.fillTemplate(settings().reminderTemplate, vars(c, { total: L.num(s.balance), since: L.fmtDate(s.oldest.date) }));
  const ids = s.unpaid.map(u => u.bill.photoId).filter(Boolean).slice(0, 5);
  const files = await Promise.all(ids.map((id, i) => photoFile(id, `bill-${i + 1}.jpg`)));
  files.push(await qrFile());
  if (await sendTo(c, { text, files })) {
    await saveCustomer({ ...customerById(c.id), lastRemindedAt: Date.now() });
  }
}

/* ================= Entries ================= */

export function entryActions(e) {
  const c = customerById(e.customerId);
  const bill = e.type === 'bill';
  sheet(close => {
    const run = fn => async () => { close(); await fn(); };
    return <>
      <h2>{bill ? 'Bill' : 'Payment'} {L.money(e.amount)}</h2>
      <p className="muted">{c.name} · {L.fmtDate(e.date, true)}</p>
      {bill && <button className="btn block" onClick={run(async () => {
        const text = L.fillTemplate(settings().billTemplate, vars(c, { amount: L.num(e.amount), total: L.num(statusOf(c).balance), date: L.fmtDate(e.date) }));
        sendTo(c, { text, files: [await photoFile(e.photoId, 'bill.jpg'), await qrFile()] });
      })}><Icon name="send" /> Send this bill again</button>}
      <button className="btn block" onClick={run(async () => {
        const v = await askAmount('Correct amount', e.amount);
        if (v) { await saveEntry({ ...e, amount: v }); toast('Amount updated'); }
      })}><Icon name="edit" /> Change amount</button>
      <button className="btn danger-outline block" onClick={run(async () => {
        if (await confirmBox({ title: 'Delete this entry?', body: <p>{bill ? 'Bill' : 'Payment'} of {L.money(e.amount)} on {L.fmtDate(e.date)} will be removed from the balance.</p>, ok: 'Delete', danger: true })) {
          await saveEntry({ ...e, deleted: true });
          toast('Entry deleted');
        }
      })}><Icon name="trash" /> Delete entry</button>
      <button className="btn block" onClick={close}>Close</button>
    </>;
  });
}

/* ================= Contact book ================= */

// Chrome on Android (and some others) can open the phone's contact picker
export const canPickContacts = () => 'contacts' in navigator && 'select' in navigator.contacts;

// Import many contacts at once; afterwards they can be searched by name in "New customer"
export async function importContacts() {
  let picked;
  try { picked = await navigator.contacts.select(['name', 'tel'], { multiple: true }); } catch { return; }
  if (!picked?.length) return;
  const rows = new Map(getState().phonebook.map(r => [waPhone(r.phone), r]));
  const before = rows.size;
  for (const ct of picked) {
    for (const tel of ct.tel || []) {
      if (phoneStatus(tel) === 'ok') rows.set(waPhone(tel), { name: (ct.name?.[0] || tel).trim(), phone: tel.trim() });
    }
  }
  await savePhonebook([...rows.values()].sort((x, y) => x.name.localeCompare(y.name)));
  toast(`${plural(rows.size - before, 'new contact')} imported · ${rows.size} in total`, 3500);
}

// Opens the number in WhatsApp, then asks what WhatsApp showed.
// (No app can look this up silently: WhatsApp itself says if the number isn't registered.)
function askWhatsAppResult(phone) {
  window.open(`https://wa.me/${waPhone(phone)}`, '_blank');
  return new Promise(resolve => sheet(close => {
    const answer = v => { close(); resolve(v); };
    return <>
      <h2>What did WhatsApp show?</h2>
      <p className="muted">WhatsApp opened for <b>+{waPhone(phone)}</b>. Come back here and tap what you saw.</p>
      <button className="btn primary block big" onClick={() => answer(true)}><Icon name="chat" /> A chat opened — it's on WhatsApp</button>
      <button className="btn danger-outline block" onClick={() => answer(false)}><Icon name="alert" /> “Phone number … is invalid” — no WhatsApp</button>
      <button className="btn block" onClick={() => answer(undefined)}>Not sure</button>
    </>;
  }, { dismissable: false }));
}

const PHONE_HELP = {
  empty: 'Bills and reminders are sent to this number.',
  bad: 'This doesn’t look like a mobile number.',
  unchecked: 'Tap Check to open this number in WhatsApp.',
  yes: 'On WhatsApp.',
  no: 'No WhatsApp on this number — bills and reminders will be sent by SMS.',
};

/* ================= Customer form ================= */

function CustomerForm({ c, prefillName, done }) {
  const { phonebook } = useStore();
  const st = settings();
  const d = c || { name: prefillName, phone: '', creditLimit: st.defaultCreditLimit || '', dueType: st.defaultDueType, dueValue: st.defaultDueValue, notes: '' };
  const [f, setF] = useState({
    name: d.name, phone: d.phone || '', creditLimit: d.creditLimit || '', cycle: cycleValue(d.dueType, d.dueValue),
    day: d.dueType === 'monthday' ? d.dueValue : 1, notes: d.notes || '',
  });
  // WhatsApp check result, valid only for the number it was checked for
  const [wa, setWa] = useState({ for: c?.phone ? waPhone(c.phone) : '', value: c?.whatsapp });
  const [nameFocus, setNameFocus] = useState(false);
  const bind = k => ({ value: f[k], onChange: e => setF(p => ({ ...p, [k]: e.target.value })) });
  const nameRef = useRef();
  useEffect(() => { if (!c) nameRef.current?.focus(); }, []);

  const pstat = phoneStatus(f.phone);
  const waValue = pstat === 'ok' && wa.for === waPhone(f.phone) ? wa.value : undefined;
  const help = !pstat ? 'empty' : pstat === 'bad' ? 'bad' : waValue === true ? 'yes' : waValue === false ? 'no' : 'unchecked';

  // Contacts matching what's typed in Name (or digits of a number)
  const q = f.name.trim().toLowerCase();
  const qd = q.replace(/\D/g, '');
  const customerNumbers = new Set(activeCustomers().filter(x => x.id !== c?.id && x.phone).map(x => waPhone(x.phone)));
  const chosen = r => r.name === f.name && waPhone(r.phone) === waPhone(f.phone);
  const matches = nameFocus && q
    ? phonebook.filter(r => !chosen(r) && (r.name.toLowerCase().includes(q) || (qd.length >= 3 && r.phone.replace(/\D/g, '').includes(qd)))).slice(0, 6)
    : [];

  const choose = r => { setF(p => ({ ...p, name: r.name, phone: r.phone })); setNameFocus(false); };

  const pickContact = async () => {
    try {
      const [ct] = await navigator.contacts.select(['name', 'tel']);
      if (ct) setF(p => ({ ...p, name: ct.name?.[0] || p.name, phone: ct.tel?.[0] || p.phone }));
    } catch { /* user closed the picker */ }
  };

  const check = async () => {
    const value = await askWhatsAppResult(f.phone);
    setWa({ for: waPhone(f.phone), value });
  };

  const remove = async () => {
    const s = statusOf(c);
    if (!(await confirmBox({ title: `Delete ${c.name}?`, body: s.balance > 0 ? <p className="red">They still owe {L.money(s.balance)}.</p> : <p>Their history will be hidden.</p>, ok: 'Delete', danger: true }))) return;
    await saveCustomer({ ...c, deleted: true });
    done(null);
    go('customers', {}, true);
    toast('Customer deleted');
  };

  const submit = async e => {
    e.preventDefault();
    const name = f.name.trim();
    const phone = f.phone.trim();
    if (!name) return;
    if (pstat === 'bad') return toast('Please check the mobile number');
    const dup = phone && activeCustomers().find(x => x.id !== c?.id && x.phone && waPhone(x.phone) === waPhone(phone));
    if (dup && !(await confirmBox({ title: 'Number already used', body: <p>{dup.name} already has this number. Save anyway?</p>, ok: 'Save' }))) return;
    const base = c ? customerById(c.id) : { id: uid(), createdAt: Date.now(), lastActivityAt: Date.now() };
    done(await saveCustomer({
      ...base, name, phone, whatsapp: waValue, creditLimit: Math.max(0, +f.creditLimit || 0), notes: f.notes.trim(), ...parseCycle(f.cycle, f.day),
    }));
  };

  return <>
    <h2>{c ? 'Edit customer' : 'New customer'}</h2>
    <form className="form" onSubmit={submit}>
      <label>Name
        <input ref={nameRef} required autoComplete="off" placeholder={phonebook.length ? 'Type to search your contacts' : 'Customer name'}
          {...bind('name')} onFocus={() => setNameFocus(true)} onBlur={() => setTimeout(() => setNameFocus(false), 150)} />
      </label>
      {matches.length > 0 && <ul className="suggest" aria-label="Matching contacts">
        {matches.map(r => {
          const taken = customerNumbers.has(waPhone(r.phone));
          return <li key={r.phone}>
            <button type="button" disabled={taken} onMouseDown={e => e.preventDefault()} onClick={() => choose(r)}>
              <Icon name="contact" /><span className="cmain"><span className="cname">{r.name}</span><span className="csub">{r.phone}</span></span>
              {taken ? <span className="tag">Already a customer</span> : <Icon name="plus" />}
            </button>
          </li>;
        })}
      </ul>}

      {canPickContacts()
        ? <div className="contact-tools">
            <button type="button" className="chip-btn" onClick={pickContact}><Icon name="contact" /> Pick a contact</button>
            <button type="button" className="chip-btn" onClick={importContacts}><Icon name="download" /> {phonebook.length ? `Update contacts (${phonebook.length})` : 'Import contact book'}</button>
          </div>
        : <p className="hint"><Icon name="contact" /> Contact import works in Chrome on Android. You can type the number below.</p>}

      <label>Mobile number
        <span className={`phone-row wa-${help}`}>
          <input type="tel" inputMode="tel" placeholder="10-digit mobile number" {...bind('phone')} />
          <button type="button" className="btn wa-check" disabled={pstat !== 'ok'} onClick={check}><Icon name="chat" /> Check</button>
        </span>
      </label>
      <p className={`phone-help wa-${help}`} role="status">
        {help === 'yes' && <Icon name="check" />}{help === 'no' && <Icon name="alert" />}{PHONE_HELP[help]}
      </p>

      <label>Credit limit ₹ <small>(0 = no limit)</small><input type="number" inputMode="numeric" min="0" {...bind('creditLimit')} /></label>
      <label>Pays<select {...bind('cycle')}>{cycleOptions(d.dueType, d.dueValue).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      {f.cycle === 'monthday' && <label>Day of month (1–31)<input type="number" inputMode="numeric" min="1" max="31" {...bind('day')} /></label>}
      <label>Notes<textarea rows="2" {...bind('notes')} /></label>
      <div className="modal-actions">
        {c && <button type="button" className="btn danger-outline" onClick={remove}>Delete</button>}
        <button type="button" className="btn" onClick={() => done(null)}>Cancel</button>
        <button className="btn primary">Save</button>
      </div>
    </form>
  </>;
}

export const openCustomerForm = (c, prefillName = '') => new Promise(resolve => sheet(close =>
  <CustomerForm c={c} prefillName={prefillName} done={v => { close(); resolve(v); }} />, { dismissable: false }));

/* ================= PIN ================= */

export const checkPin = async pin => (await Img.sha256Text(settings().pinSalt + pin)) === settings().pinHash;

export async function setPin() {
  if (settings().pinHash) {
    const cur = await askPin('Enter current PIN');
    if (!cur) return;
    if (!(await checkPin(cur))) return toast('Wrong PIN');
  }
  const p1 = await askPin('Choose a 4-digit PIN');
  if (!p1) return;
  const p2 = await askPin('Enter the same PIN again');
  if (p1 !== p2) return toast('PINs did not match — try again');
  const salt = uid();
  await saveSettings({ pinSalt: salt, pinHash: await Img.sha256Text(salt + p1) });
  toast('PIN set ✓ — don’t forget it');
}

export async function removePin() {
  const p = await askPin('Enter current PIN');
  if (p && (await checkPin(p))) { await saveSettings({ pinHash: null, pinSalt: null }); toast('PIN removed'); }
  else if (p) toast('Wrong PIN');
}

/* ================= Backup ================= */

export async function doBackup() {
  toast('Preparing backup…', 10000);
  const photos = await Promise.all((await db.all('photos')).map(async p => ({
    id: p.id, createdAt: p.createdAt, blob: await Img.blobToDataURL(p.blob), thumb: p.thumb ? await Img.blobToDataURL(p.thumb) : null,
  })));
  const { settings: st, customers, entries } = getState();
  const data = { app: 'shop-khata', version: 1, exportedAt: Date.now(), settings: st, customers, entries, photos };
  const file = new File([JSON.stringify(data)], `khata-backup-${new Date().toISOString().slice(0, 10)}.json`, { type: 'application/json' });
  toast('Backup ready');
  const canShare = navigator.canShare?.({ files: [file] });
  const mark = () => saveSettings({ lastBackupAt: Date.now() });
  sheet(close => <>
    <h2>Backup ready</h2>
    <p className="muted">{file.name} · {(file.size / 1048576).toFixed(1)} MB</p>
    {canShare && <button className="btn primary block big" onClick={async () => {
      try { await navigator.share({ files: [file], title: 'Shop Khata backup' }); close(); await mark(); } catch { /* cancelled */ }
    }}><Icon name="upload" /> Save to Google Drive / WhatsApp</button>}
    <button className="btn block" onClick={async () => {
      const link = Object.assign(document.createElement('a'), { href: URL.createObjectURL(file), download: file.name });
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 10000);
      close();
      await mark();
    }}><Icon name="download" /> Download file</button>
    <button className="btn block" onClick={close}>Close</button>
  </>);
}

export async function doRestore() {
  const file = await pickFile({ accept: '.json,application/json' });
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch { return toast('That is not a backup file'); }
  if (data?.app !== 'shop-khata') return toast('That is not a Shop Khata backup');
  const ok = await confirmBox({
    title: 'Replace all data?',
    body: <><p>Backup from <b>{L.fmtDate(data.exportedAt, true)}</b> with {plural(data.customers.length, 'customer')} and {plural(data.entries.length, 'entry')}.</p>
      <p className="red">Everything currently in the app will be replaced.</p></>,
    ok: 'Restore', danger: true,
  });
  if (!ok) return;
  toast('Restoring…', 10000);
  const photos = await Promise.all(data.photos.map(async p => ({
    id: p.id, createdAt: p.createdAt, blob: await Img.dataURLToBlob(p.blob), thumb: p.thumb ? await Img.dataURLToBlob(p.thumb) : null,
  })));
  for (const s of ['customers', 'entries', 'photos', 'settings']) await db.clear(s);
  await db.putMany('customers', data.customers);
  await db.putMany('entries', data.entries);
  await db.putMany('photos', photos);
  // Keep this phone's PIN, so a fresh install can recover from a forgotten PIN
  await db.put('settings', { ...data.settings, pinHash: settings().pinHash, pinSalt: settings().pinSalt, key: 'app' });
  location.reload();
}
