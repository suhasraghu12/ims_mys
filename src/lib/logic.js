// Pure business logic: balances, due dates, credit warnings, message text.
export const DAY = 86400000;

export const DEFAULT_TEMPLATES = {
  billTemplate: 'Namaste {name},\nBill dated {date}: ₹{amount}\nTotal pending: ₹{total}\nPay by UPI: {upi}\n– {shop}',
  reminderTemplate: 'Namaste {name},\nA gentle reminder from {shop}.\nPending amount: ₹{total} (since {since})\nPay by UPI: {upi}\nThank you!',
  paymentTemplate: 'Thank you {name}!\nReceived ₹{amount} on {date}.\nBalance pending: ₹{total}\n– {shop}',
};

export const DEFAULT_SETTINGS = {
  setupDone: false,
  shopName: "Iyengar's Masala Stores",
  upiId: '',
  qrPhotoId: null,
  attachQr: true,
  countryCode: '91',
  freezeDays: 15,
  defaultCreditLimit: 0,
  defaultDueType: 'days',
  defaultDueValue: 30,
  pinHash: null,
  pinSalt: null,
  lastBackupAt: null,
  ...DEFAULT_TEMPLATES,
};

export const startOfDay = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
export const num = n => Math.round(n).toLocaleString('en-IN');
export const money = n => '₹' + num(n);

export function fmtDate(t, withTime = false) {
  const d = new Date(t);
  const opts = { day: 'numeric', month: 'short' };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  let s = d.toLocaleDateString('en-IN', opts);
  if (withTime) s += ', ' + d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  return s;
}

export function ago(t, now = Date.now()) {
  const d = Math.round((startOfDay(now) - startOfDay(t)) / DAY);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`;
}

const ordinal = n => n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');

export function cycleLabel(c) {
  if (c.dueType === 'days') return { 7: 'Pays weekly', 15: 'Pays every 15 days', 30: 'Pays monthly' }[c.dueValue] || `Pays every ${c.dueValue} days`;
  if (c.dueType === 'monthday') return `Pays on ${ordinal(c.dueValue)} of month`;
  return 'No fixed pay date';
}

// When is a bill taken on `billDate` due, given the customer's payment cycle?
export function dueDate(billDate, c) {
  if (!c || !c.dueType || c.dueType === 'none') return null;
  const start = startOfDay(billDate);
  if (c.dueType === 'days') return start + (Number(c.dueValue) || 30) * DAY;
  if (c.dueType === 'monthday') {
    const day = Number(c.dueValue) || 1;
    const d = new Date(start);
    const on = (y, m) => new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate())).getTime();
    let t = on(d.getFullYear(), d.getMonth());
    if (t <= start) t = on(d.getFullYear(), d.getMonth() + 1);
    return t;
  }
  return null;
}

// Balance, which bills are still unpaid (payments settle oldest bills first),
// due status and credit warnings for one customer.
export function customerStatus(c, entries, settings, now = Date.now()) {
  const bills = entries.filter(e => e.type === 'bill').sort((a, b) => a.date - b.date);
  const paid = entries.filter(e => e.type === 'payment').reduce((s, e) => s + e.amount, 0);
  const balance = bills.reduce((s, b) => s + b.amount, 0) - paid;

  let left = paid;
  const unpaid = [];
  for (const b of bills) {
    if (left >= b.amount) { left -= b.amount; continue; }
    unpaid.push({ bill: b, remaining: b.amount - left });
    left = 0;
  }

  const oldest = unpaid[0]?.bill || null;
  const due = oldest ? dueDate(oldest.date, c) : null;
  const overdueDays = due != null ? Math.round((startOfDay(now) - due) / DAY) : null;
  const isOverdue = balance > 0 && overdueDays != null && overdueDays > 0;
  const dueSoon = balance > 0 && overdueDays != null && overdueDays >= -2 && overdueDays <= 0;

  const reasons = [];
  const limit = Number(c.creditLimit) || 0;
  if (limit > 0 && balance >= limit) reasons.push(`Owes ${money(balance)} — credit limit is ${money(limit)}`);
  if (isOverdue && overdueDays >= (Number(settings.freezeDays) || 15)) reasons.push(`Payment overdue by ${overdueDays} days`);

  return { balance, unpaid, oldest, due, overdueDays, isOverdue, dueSoon, frozen: reasons.length > 0, reasons };
}

// Fill {placeholders}. A line whose placeholder is empty (e.g. no UPI ID set) is dropped.
export function fillTemplate(tpl, vars) {
  return tpl.split('\n').map(line => {
    let drop = false;
    const out = line.replace(/\{(\w+)\}/g, (m, k) => {
      if (!(k in vars)) return m;
      const v = vars[k];
      if (v === '' || v == null) { drop = true; return ''; }
      return String(v);
    });
    return drop ? null : out;
  }).filter(l => l !== null).join('\n');
}
