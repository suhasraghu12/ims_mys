// Bottom sheets, opened imperatively so async flows can simply `await` an answer:
//   const ok = await confirmBox({ title: 'Delete?' });
import { useEffect, useLayoutEffect, useState } from 'react';
import * as L from '../lib/logic.js';
import { photoURL } from '../lib/store.js';
import { Keypad, PinDots } from './components.jsx';

let api = null;
let seq = 0;

export function OverlayRoot() {
  const [items, setItems] = useState([]);
  useLayoutEffect(() => {
    api = {
      open(render, { dismissable = true, sticky = false } = {}) {
        const id = ++seq;
        const close = () => setItems(xs => xs.filter(x => x.id !== id));
        setItems(xs => [...xs, { id, node: render(close), dismissable, sticky, close }]);
        return close;
      },
      closeAll: () => setItems(xs => xs.filter(x => x.sticky)),
    };
  }, []);

  const top = items[items.length - 1];
  useEffect(() => {
    if (!top?.dismissable) return;
    const onKey = e => e.key === 'Escape' && top.close();
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [top]);

  return items.map(x => (
    <div key={x.id} className="modal-backdrop" onClick={e => x.dismissable && e.target === e.currentTarget && x.close()}>
      <div className="modal" role="dialog" aria-modal="true">{x.node}</div>
    </div>
  ));
}

export const sheet = (render, opts) => api.open(render, opts);
export const closeOverlays = () => api?.closeAll();

export function confirmBox({ title, body = null, ok = 'OK', cancel = 'Cancel', danger = false }) {
  return new Promise(resolve => sheet(close => {
    const answer = v => { close(); resolve(v); };
    return <>
      <h2>{title}</h2>{body}
      <div className="modal-actions">
        <button className="btn" onClick={() => answer(false)}>{cancel}</button>
        <button className={`btn ${danger ? 'danger' : 'primary'}`} onClick={() => answer(true)}>{ok}</button>
      </div>
    </>;
  }, { dismissable: false }));
}

function AmountSheet({ title, initial, done }) {
  const [v, setV] = useState(String(initial));
  return <>
    <h2>{title}</h2>
    <div className="amount"><span className="rs">₹</span>{L.num(+v || 0)}</div>
    <Keypad value={v} onChange={setV} />
    <div className="modal-actions">
      <button className="btn" onClick={() => done(null)}>Cancel</button>
      <button className="btn primary" onClick={() => done(+v || null)}>Save</button>
    </div>
  </>;
}
export const askAmount = (title, initial = '') => new Promise(resolve => sheet(close =>
  <AmountSheet title={title} initial={initial} done={v => { close(); resolve(v); }} />, { dismissable: false }));

function PinSheet({ title, done }) {
  const [v, setV] = useState('');
  useEffect(() => {
    if (v.length !== 4) return;
    const t = setTimeout(() => done(v), 150);
    return () => clearTimeout(t);
  }, [v]);
  return <>
    <h2>{title}</h2>
    <PinDots count={v.length} />
    <Keypad value={v} onChange={setV} max={4} pin />
    <div className="modal-actions"><button className="btn" onClick={() => done(null)}>Cancel</button></div>
  </>;
}
export const askPin = title => new Promise(resolve => sheet(close =>
  <PinSheet title={title} done={v => { close(); resolve(v); }} />, { dismissable: false }));

export const showPhoto = src => sheet(close => <>
  <img className="full-photo" src={src} alt="Photo" />
  <div className="modal-actions"><button className="btn" onClick={close}>Close</button></div>
</>);
export const viewPhoto = id => photoURL(id, 'blob').then(showPhoto);
