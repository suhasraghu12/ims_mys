// Thumb-reach tab bar on the main screens. The raised centre button is the
// most-used action (New bill); Payment and Reminders sit either side of it.
import { useStore, activeCustomers, statusOf } from '../lib/store.js';
import { Icon } from './components.jsx';
import { go, back } from './router.js';
import { startBill, startPayment } from '../actions.jsx';

export const TAB_SCREENS = ['home', 'customers', 'reminders'];

export default function BottomNav({ active }) {
  const st = useStore();
  const due = activeCustomers(st).map(c => statusOf(c, st)).filter(s => s.balance > 0 && (s.isOverdue || s.dueSoon)).length;

  // Tabs sit one step above Home in history, so the phone's back button always returns Home
  const tab = name => () => {
    if (name === active) return;
    if (name === 'home') back(); else go(name, {}, active !== 'home');
  };
  const item = (name, icon, label, extra = null) =>
    <button className={`tab${active === name ? ' on' : ''}`} onClick={tab(name)} aria-current={active === name ? 'page' : undefined}>
      <Icon name={icon} />{label}{extra}
    </button>;

  return <nav className="tabbar" aria-label="Main">
    {item('home', 'home', 'Home')}
    {item('customers', 'users', 'Customers')}
    <button className="fab" onClick={() => startBill()} aria-label="New bill"><span><Icon name="camera" /></span>New bill</button>
    <button className="tab" onClick={() => startPayment()}><Icon name="wallet" />Payment</button>
    {item('reminders', 'bell', 'Remind', due > 0 && <span className="tab-badge">{due}</span>)}
  </nav>;
}
