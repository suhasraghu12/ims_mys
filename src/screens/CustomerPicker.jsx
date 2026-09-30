import { useState } from 'react';
import { useStore, activeCustomers, statusOf, recency } from '../lib/store.js';
import { amountText, tone } from '../lib/format.js';
import { Avatar, Icon, StatusLine } from '../ui/components.jsx';
import { openCustomerForm } from '../actions.jsx';

// The filter chips double as the colour legend
const FILTERS = [
  ['all', 'All', () => true],
  ['over', 'Overdue', s => tone(s) === 'over'],
  ['soon', 'Due soon', s => tone(s) === 'soon'],
  ['due', 'On credit', s => tone(s) === 'due'],
  ['clear', 'Clear', s => s.balance <= 0],
];

export default function CustomerPicker({ onPick, pendingFirst = false }) {
  const st = useStore();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const test = FILTERS.find(f => f[0] === filter)[2];
  const query = q.trim().toLowerCase();
  const digits = query.replace(/\D/g, '');

  const items = activeCustomers(st).map(c => ({ c, s: statusOf(c, st) }))
    .filter(({ s }) => test(s))
    .filter(({ c }) => !query || c.name.toLowerCase().includes(query) || (digits && (c.phone || '').replace(/\D/g, '').includes(digits)))
    .sort((a, b) => (pendingFirst ? (b.s.balance > 0) - (a.s.balance > 0) : 0) || recency(b.c) - recency(a.c));

  const add = async () => { const c = await openCustomerForm(null, q.trim()); if (c) onPick(c); };

  return <div className="picker">
    <div className="search-wrap">
      <Icon name="search" />
      <input className="search" type="search" placeholder="Search name or number" autoComplete="off" aria-label="Search customers"
        value={q} onChange={e => setQ(e.target.value)} />
    </div>
    <div className="filters" role="group" aria-label="Show">
      {FILTERS.map(([k, label]) => <button key={k} className={`t-${k}${filter === k ? ' on' : ''}`} onClick={() => setFilter(k)}>
        {k !== 'all' && <i className="dot" />}{label}
      </button>)}
    </div>
    <button className="wide-btn add" onClick={add}><Icon name="plus" /> New customer</button>
    <ul className="clist">
      {items.map(({ c, s }) => <li key={c.id}>
        <button className={`crow t-${tone(s)}`} onClick={() => onPick(c)}>
          <Avatar c={c} s={s} />
          <span className="cmain"><span className="cname">{c.name}</span><span className="csub"><StatusLine s={s} /></span></span>
          <span className="camt">{amountText(s.balance)}</span>
          {s.frozen && <span className="flag" title="Credit warning"><Icon name="alert" /></span>}
        </button>
      </li>)}
      {!items.length && <li className="empty">{query ? 'No match. Tap “New customer” to add.' : filter !== 'all' ? 'Nobody in this list.' : 'No customers yet. Tap “New customer”.'}</li>}
    </ul>
  </div>;
}
