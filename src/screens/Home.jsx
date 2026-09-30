import * as L from '../lib/logic.js';
import { useStore, activeCustomers, statusOf } from '../lib/store.js';
import { plural, tone } from '../lib/format.js';
import { Header, Icon, Avatar, StatusLine, StatusPill, Ring } from '../ui/components.jsx';
import { go } from '../ui/router.js';
import { sendReminder } from '../actions.jsx';

const AGE_BUCKETS = [[15, '0–15 days'], [30, '15–30 days'], [60, '30–60 days'], [Infinity, '60+ days']];
const DAY_LETTER = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export default function Home() {
  const st = useStore();
  const today = L.startOfDay(Date.now());
  const all = activeCustomers(st).map(c => ({ c, s: statusOf(c, st) }));
  const withBal = all.filter(x => x.s.balance > 0);
  const total = withBal.reduce((a, x) => a + x.s.balance, 0);
  const count = t => withBal.filter(x => tone(x.s) === t).length;

  // How old is the unpaid money? Each unpaid bill counts by its own age.
  const aging = AGE_BUCKETS.map(() => 0);
  for (const { s } of withBal) for (const u of s.unpaid) {
    const age = Math.round((today - L.startOfDay(u.bill.date)) / L.DAY);
    aging[AGE_BUCKETS.findIndex(([max]) => age < max)] += u.remaining;
  }
  const pct = v => (total ? Math.round(v / total * 100) : 0);

  // Collections over the last 7 days (oldest → today)
  const live = st.entries.filter(e => !e.deleted);
  const days = Array.from({ length: 7 }, (_, i) => today - (6 - i) * L.DAY);
  const collected = days.map(d => live.filter(e => e.type === 'payment' && L.startOfDay(e.date) === d).reduce((a, e) => a + e.amount, 0));
  const week = collected.reduce((a, v) => a + v, 0);
  const peak = Math.max(...collected, 1);
  const todaySum = type => live.filter(e => e.type === type && L.startOfDay(e.date) === today).reduce((a, e) => a + e.amount, 0);

  const dueNow = withBal.filter(x => x.s.isOverdue || x.s.dueSoon).sort((a, b) => b.s.overdueDays - a.s.overdueDays || b.s.balance - a.s.balance);
  const top = [...withBal].sort((a, b) => b.s.balance - a.s.balance).slice(0, 5);
  const cloudFresh = st.sync?.lastSyncAt && Date.now() - st.sync.lastSyncAt < 2 * L.DAY;
  const needBackup = live.length > 0 && !cloudFresh && (!st.settings.lastBackupAt || Date.now() - st.settings.lastBackupAt > 7 * L.DAY);
  const syncDot = !st.sync ? '' : st.syncStatus === 'syncing' ? ' sync-syncing' : st.sync.error ? ' sync-error' : ' sync-ok';
  const dateLine = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' });

  return <>
    <Header title={st.settings.shopName} eyebrow={dateLine} showBack={false}
      right={<button className={`icon-btn${syncDot}`} onClick={() => go('settings')} aria-label="Settings"><Icon name="settings" /></button>} />
    <main className="home with-tabs">
      {needBackup && <button className="banner" onClick={() => go('settings')}>
        <Icon name="alert" /><span>No backup in the last 7 days. Tap to back up.</span><Icon name="chev" />
      </button>}

      <section className="hero" aria-label="Money to collect">
        <div className="hero-top">
          <span className="eyebrow">To collect</span>
          <span className="hero-chip">{plural(withBal.length, 'customer')}</span>
        </div>
        <div className="hero-amt"><span className="rs">₹</span>{L.num(total)}</div>

        <div className="hero-split">
          <ul className="hero-status">
            {[['over', 'Overdue'], ['soon', 'Due soon'], ['due', 'On credit']].map(([t, label]) =>
              <li key={t} className={`t-${t}`}><i className="dot" />{label}<b>{count(t)}</b></li>)}
          </ul>
          <Ring parts={aging} size={112} stroke={11}>
            <b>{pct(aging[2] + aging[3])}%</b><small>older than<br />30 days</small>
          </Ring>
        </div>

        <dl className="age-legend">
          {AGE_BUCKETS.map(([, l], i) => <div key={l}>
            <dt><i className={`b${i}`} />{l}</dt>
            <dd>{L.money(aging[i])}</dd>
          </div>)}
        </dl>

        <div className="hero-week">
          <div>
            <span className="eyebrow">Collected · 7 days</span>
            <b>{L.money(week)}</b>
          </div>
          <div className="spark" role="img" aria-label="Collections per day, last 7 days">
            {collected.map((v, i) => <div key={i} className={i === 6 ? 'today' : ''}>
              <span style={{ height: `${v ? Math.max(8, v / peak * 100) : 4}%` }} title={L.money(v)} />
              <small>{DAY_LETTER[new Date(days[i]).getDay()]}</small>
            </div>)}
          </div>
        </div>
      </section>

      {dueNow.length > 0 && <section>
        <div className="sec-head"><h2 className="section">Due now</h2><button className="text-btn" onClick={() => go('reminders')}>See all</button></div>
        <div className="rail">
          {dueNow.map(({ c, s }) =>
            <div key={c.id} className={`due-card t-${tone(s)}`} role="button" tabIndex={0} onClick={() => go('customer', { id: c.id })}>
              <div className="due-top"><Avatar c={c} s={s} /><StatusPill s={s} /></div>
              <span className="cname">{c.name}</span>
              <b className="due-amt">{L.money(s.balance)}</b>
              <button className="btn small remind" onClick={e => { e.stopPropagation(); sendReminder(c); }}><Icon name="send" /> Remind</button>
            </div>)}
        </div>
      </section>}

      <div className="bento">
        <div className="tile">
          <span className="ibox t-due"><Icon name="receipt" /></span>
          <span className="label">Billed today</span>
          <b>{L.money(todaySum('bill'))}</b>
        </div>
        <div className="tile">
          <span className="ibox t-clear"><Icon name="trend" /></span>
          <span className="label">Collected today</span>
          <b>{L.money(todaySum('payment'))}</b>
        </div>
      </div>

      {top.length > 0 && <section>
        <div className="sec-head"><h2 className="section">Top outstanding</h2><button className="text-btn" onClick={() => go('customers')}>All customers</button></div>
        <ul className="clist">{top.map(({ c, s }) => <li key={c.id}>
          <button className={`crow t-${tone(s)}`} onClick={() => go('customer', { id: c.id })}>
            <Avatar c={c} s={s} />
            <span className="cmain">
              <span className="cname">{c.name}</span>
              <span className="csub"><StatusLine s={s} /></span>
              <span className="share"><span style={{ width: `${Math.max(3, s.balance / top[0].s.balance * 100)}%` }} /></span>
            </span>
            <span className="camt">{L.money(s.balance)}</span>
          </button>
        </li>)}</ul>
      </section>}
    </main>
  </>;
}
