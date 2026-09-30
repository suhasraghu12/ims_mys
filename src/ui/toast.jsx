import { useLayoutEffect, useRef, useState } from 'react';

let show = null;
export const toast = (msg, ms = 2500) => show?.(msg, ms);

export function Toast() {
  const [t, setT] = useState({ msg: '', on: false });
  const timer = useRef();
  useLayoutEffect(() => {
    show = (msg, ms) => {
      setT({ msg, on: true });
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setT(x => ({ ...x, on: false })), ms);
    };
  }, []);
  return <div id="toast" className={t.on ? 'show' : ''} role="status" aria-live="polite">{t.msg}</div>;
}
