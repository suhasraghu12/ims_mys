import * as L from '../lib/logic.js';
import { useStore, activeCustomers, statusOf } from '../lib/store.js';
import { tone } from '../lib/format.js';
import { Header, Icon, StatusLine, Avatar } from '../ui/components.jsx';
import { go } from '../ui/router.js';
import { sendReminder } from '../actions.jsx';

const rank = s => (s.isOverdue ? 0 : s.dueSoon ? 1 : 2);

function Row({ c, s }) {
  const remindedToday = c.lastRemindedAt && L.ago(c.lastRemindedAt) === 'today';
  return <li className={`rrow t-${tone(s)}`}>
    <Avatar c={c} s={s} />
    <button className="rinfo" onClick={() => go('customer', { id: c.id })}>
      <span className="cname">{c.name}</span>
      <b className="camt">{L.money(s.balance)}</b>
      <span className="csub"><StatusLine s={s} />{c.lastRemindedAt && ` · reminded ${L.ago(c.lastRemindedAt)}`}</span>
    </button>
    <button className={`btn remind-btn ${remindedToday ? 'done' : ''}`} onClick={() => sendReminder(c)}><Icon name="send" /> Remind</button>
  </li>;
}

export default function Reminders() {
  const st = useStore();
  const items = activeCustomers(st).map(c => ({ c, s: statusOf(c, st) })).filter(x => x.s.balance > 0)
    .sort((a, b) => rank(a.s) - rank(b.s) || (b.s.overdueDays ?? -1e9) - (a.s.overdueDays ?? -1e9) || b.s.balance - a.s.balance);
  const due = items.filter(x => rank(x.s) < 2);
  const rest = items.filter(x => rank(x.s) === 2);

  return <>
    <Header title="Reminders" showBack={false} />
    <main className="with-tabs">
      {!items.length && <p className="empty">Nobody owes anything right now.</p>}
      {due.length > 0 && <><h2 className="section">Due now ({due.length})</h2><ul className="clist">{due.map(x => <Row key={x.c.id} {...x} />)}</ul></>}
      {rest.length > 0 && <><h2 className="section">Other pending ({rest.length})</h2><ul className="clist">{rest.map(x => <Row key={x.c.id} {...x} />)}</ul></>}
    </main>
  </>;
}
