import { useEffect } from 'react';
import * as L from '../lib/logic.js';
import { useStore, customerById, entriesOf, statusOf } from '../lib/store.js';
import { plural, tone, amountText } from '../lib/format.js';
import { Header, Icon, Photo, Avatar, StatusPill } from '../ui/components.jsx';
import { go } from '../ui/router.js';
import { startBill, startPayment, sendReminder, openCustomerForm, entryActions, waPhone, hasNoWhatsApp } from '../actions.jsx';
import CustomerPicker from './CustomerPicker.jsx';

export function CustomersScreen() {
  return <><Header title="Customers" showBack={false} /><main className="with-tabs"><CustomerPicker onPick={c => go('customer', { id: c.id })} /></main></>;
}

const MODE_LABEL = { upi: 'UPI', cash: 'Cash', other: 'Other' };

function EntryRow({ e, bal }) {
  const bill = e.type === 'bill';
  const title = bill ? 'Bill' : `Payment${e.mode ? ' · ' + MODE_LABEL[e.mode] : ''}`;
  return <li className={`entry ${e.type}`} onClick={() => entryActions(e)}>
    {e.photoId
      ? <Photo id={e.photoId} className="thumb" alt={`${title} photo — tap to enlarge`} />
      : <span className={`thumb ibox ${bill ? 't-due' : 't-clear'}`} aria-hidden="true"><Icon name={bill ? 'receipt' : 'wallet'} /></span>}
    <span className="emain"><span className="etitle">{title}</span><span className="esub">{L.fmtDate(e.date, true)}</span></span>
    <span className="eright"><span className="eamt">{bill ? '+' : '−'}{L.money(e.amount)}</span><span className="ebal">bal {amountText(bal)}</span></span>
    <span className="more" aria-hidden="true">⋮</span>
  </li>;
}

export function CustomerScreen({ id }) {
  const st = useStore();
  const c = customerById(id);
  const gone = !c || c.deleted;
  useEffect(() => { if (gone) go('customers', {}, true); }, [gone]);
  if (gone) return null;

  const s = statusOf(c, st);
  // Running balance after each entry, oldest first, then shown newest first
  let run = 0;
  const list = entriesOf(id, st).sort((a, b) => a.date - b.date)
    .map(e => { run += e.type === 'bill' ? e.amount : -e.amount; return { e, bal: run }; }).reverse();
  const limit = +c.creditLimit || 0;
  const used = limit > 0 ? Math.max(0, s.balance) / limit : 0;
  const phone = waPhone(c.phone);

  return <>
    <Header title={c.name} right={<button className="icon-btn" onClick={() => openCustomerForm(c)} aria-label="Edit customer"><Icon name="edit" /></button>} />
    <main>
      <section className={`hero cust t-${tone(s)}`}>
        <div className="cust-top">
          <Avatar c={c} s={s} size="lg" />
          <div><StatusPill s={s} /><div className="eyebrow">{s.balance > 0 ? 'Pending' : s.balance < 0 ? 'Advance paid' : 'All clear'}</div></div>
        </div>
        <div className="hero-amt"><span className="rs">₹</span>{L.num(Math.abs(s.balance))}</div>
        {s.balance > 0 && s.oldest && <div className="since">Oldest unpaid bill {L.ago(s.oldest.date)} · {plural(s.unpaid.length, 'bill')} open</div>}
        {limit > 0 && <div className="limit">
          <div className={`meter ${used >= 1 ? 'full' : used >= .8 ? 'high' : ''}`}><span style={{ width: `${Math.min(100, used * 100)}%` }} /></div>
          <div className="small">{Math.round(used * 100)}% of {L.money(limit)} limit used</div>
        </div>}
        <div className="chips">
          {c.phone && <span className="chip">{c.phone}</span>}
          {c.phone && c.whatsapp === true && <span className="chip wa">On WhatsApp</span>}
          {c.phone && hasNoWhatsApp(c) && <span className="chip amber">No WhatsApp · SMS</span>}
          <span className="chip">{L.cycleLabel(c)}</span>
          {s.balance > 0 && s.due && (s.isOverdue
            ? <span className="chip red">Overdue {plural(s.overdueDays, 'day')}</span>
            : <span className={`chip ${s.dueSoon ? 'amber' : ''}`}>Due {L.fmtDate(s.due)}</span>)}
        </div>
        {s.frozen && <div className="freeze"><Icon name="alert" /><div>{s.reasons.map(r => <div key={r}>{r}</div>)}</div></div>}
        {c.notes && <p className="muted notes">{c.notes}</p>}
      </section>

      <div className="actions">
        <button className="act" id="aBill" onClick={() => startBill(c.id)}><Icon name="camera" /><span>Bill</span></button>
        <button className="act" onClick={() => startPayment(c.id)}><Icon name="wallet" /><span>Payment</span></button>
        <button className="act" disabled={s.balance <= 0} onClick={() => sendReminder(c)}><Icon name="bell" /><span>Remind</span></button>
        {phone && <>
          {hasNoWhatsApp(c)
            ? <a className="act" href={`sms:+${phone}`}><Icon name="chat" /><span>SMS</span></a>
            : <a className="act" href={`https://wa.me/${phone}`} target="_blank" rel="noopener"><Icon name="chat" /><span>WhatsApp</span></a>}
          <a className="act" href={`tel:+${phone}`}><Icon name="phone" /><span>Call</span></a>
        </>}
      </div>

      <h2 className="section">History</h2>
      <ul className="timeline">
        {list.map(x => <EntryRow key={x.e.id} {...x} />)}
        {!list.length && <li className="empty">No bills or payments yet</li>}
      </ul>
    </main>
  </>;
}
