import * as L from './logic.js';

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
export const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
export const initials = name => name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
export const hue = name => [...name].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 7);

// The colour code — one status per customer, same colour on every screen:
//   over = coral (overdue) · soon = amber (due in ≤2 days) · due = violet (on credit, not due yet)
//   clear = mint (nothing owed) · adv = mint (paid in advance)
export const tone = s => (s.balance < 0 ? 'adv' : s.balance === 0 ? 'clear' : s.isOverdue ? 'over' : s.dueSoon ? 'soon' : 'due');

export function statusLabel(s) {
  const t = tone(s);
  if (t === 'over') return `Overdue ${s.overdueDays}d`;
  return { soon: s.overdueDays === 0 ? 'Due today' : 'Due soon', due: 'On credit', clear: 'Clear', adv: 'Advance' }[t];
}

export const amountText = balance => (balance > 0 ? L.money(balance) : balance < 0 ? `Adv ${L.money(-balance)}` : 'Clear');

export const CYCLES = [['none', 'No fixed date'], ['days:7', 'Every week'], ['days:15', 'Every 15 days'], ['days:30', 'Every month'], ['monthday', 'Fixed date each month (salary day)']];

export const cycleValue = (type, value) => (type === 'days' ? `days:${value}` : type || 'none');

export function cycleOptions(type, value, withMonthday = true) {
  const cur = cycleValue(type, value);
  let opts = CYCLES.filter(o => withMonthday || o[0] !== 'monthday');
  if (type === 'days' && !opts.some(o => o[0] === cur)) opts = [...opts, [cur, `Every ${value} days`]];
  return opts;
}

export function parseCycle(val, day) {
  const [type, n] = val.split(':');
  if (type === 'days') return { dueType: 'days', dueValue: +n };
  if (type === 'monthday') return { dueType: 'monthday', dueValue: Math.min(31, Math.max(1, +day || 1)) };
  return { dueType: 'none', dueValue: null };
}
