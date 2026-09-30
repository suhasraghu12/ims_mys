import { useEffect, useState } from 'react';
import * as L from '../lib/logic.js';
import { photoURL } from '../lib/store.js';
import { hue, initials, plural, tone, statusLabel } from '../lib/format.js';
import { back } from './router.js';
import { viewPhoto } from './overlay.jsx';

// Line icons (24px grid, drawn with currentColor) — bundled so they work offline
const ICONS = {
  camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
  wallet: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  settings: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  chev: '<path d="m9 18 6-6-6-6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
  chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  receipt: '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6M16 12h-6M13 16h-3"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m17 8-5-5-5 5"/><path d="M12 3v12"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  restore: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
  del: '<path d="M20 5H9l-7 7 7 7h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Z"/><path d="m18 9-6 6M12 9l6 6"/>',
  cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2"/><path d="M6 12h.01M18 12h.01"/>',
  mobile: '<rect x="5" y="2" width="14" height="20" rx="2"/><path d="M12 18h.01"/>',
  contact: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  trend: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
};

export const Icon = ({ name, className = '' }) =>
  <svg className={`ic ${className}`} viewBox="0 0 24 24" aria-hidden="true" dangerouslySetInnerHTML={{ __html: ICONS[name] }} />;

export function Header({ title, eyebrow, showBack = true, right = null }) {
  return <header className="bar">
    {showBack && <button className="icon-btn" onClick={back} aria-label="Back"><Icon name="back" /></button>}
    <h1>{eyebrow && <small>{eyebrow}</small>}{title}</h1>
    {right}
  </header>;
}

// Initials in a circle; with a status, it gets a ring in that status colour
export const Avatar = ({ c, s, size }) =>
  <span className={`avatar${s ? ` ring t-${tone(s)}` : ''}${size ? ` ${size}` : ''}`} style={{ '--h': hue(c.name) }} aria-hidden="true">{initials(c.name)}</span>;

export const StatusPill = ({ s }) => <span className={`pill t-${tone(s)}`}><i />{statusLabel(s)}</span>;

// Donut chart; `parts` are values drawn clockwise in colours .b0, .b1, …
export function Ring({ parts, size = 112, stroke = 12, children }) {
  const r = (size - stroke) / 2, C = 2 * Math.PI * r, c = size / 2;
  const total = parts.reduce((a, v) => a + v, 0);
  const gap = parts.filter(v => v > 0).length > 1 ? 3 : 0;
  let off = 0;
  return <div className="ring-chart" style={{ width: size, height: size }}>
    <svg viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle className="ring-track" cx={c} cy={c} r={r} strokeWidth={stroke} />
      {total > 0 && parts.map((v, i) => {
        if (!v) return null;
        const len = v / total * C;
        const seg = <circle key={i} className={`ring-seg b${i}`} cx={c} cy={c} r={r} strokeWidth={stroke}
          strokeDasharray={`${Math.max(len - gap, 0.5)} ${C}`} strokeDashoffset={-off} />;
        off += len;
        return seg;
      })}
    </svg>
    <div className="ring-center">{children}</div>
  </div>;
}

export function StatusLine({ s }) {
  if (s.balance <= 0) return s.balance < 0 ? 'Advance paid' : 'No pending';
  if (s.isOverdue) return <span className="red">Overdue {plural(s.overdueDays, 'day')}</span>;
  if (s.dueSoon) return <span className="amber">{s.overdueDays === 0 ? 'Due today' : `Due in ${plural(-s.overdueDays, 'day')}`}</span>;
  return `Since ${L.fmtDate(s.oldest.date)}`;
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', '⌫'];
export function Keypad({ value, onChange, max = 7, pin = false }) {
  const press = k => {
    let v = value;
    if (k === '⌫') v = v.slice(0, -1);
    else if (v.length < max) { v += k; if (!pin) v = v.replace(/^0+/, ''); }
    onChange(v.slice(0, max));
  };
  return <div className="keypad">
    {KEYS.map(k => (pin && k === '00')
      ? <span key={k} className="key blank" />
      : <button key={k} type="button" className="key" onClick={() => press(k)} aria-label={k === '⌫' ? 'Delete' : undefined}>
          {k === '⌫' ? <Icon name="del" /> : k}
        </button>)}
  </div>;
}

export const PinDots = ({ count, shake = false }) =>
  <div className={`dots${shake ? ' shake' : ''}`}>{[0, 1, 2, 3].map(i => <span key={i} className={i < count ? 'on' : ''} />)}</div>;

// Stored photo (thumbnail by default); tapping it opens the full photo
export function Photo({ id, kind = 'thumb', className, alt }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let live = true;
    photoURL(id, kind).then(u => live && setSrc(u));
    return () => { live = false; };
  }, [id, kind]);
  return <img className={className} src={src || undefined} alt={alt} onClick={e => { e.stopPropagation(); viewPhoto(id); }} />;
}
