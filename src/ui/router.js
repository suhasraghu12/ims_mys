// Tiny history-based router: each screen is a history entry, so the phone's
// back button leaves a flow or closes the current screen.
import { useEffect, useState } from 'react';
import { closeOverlays } from './overlay.jsx';

const HOME = { name: 'home', params: {} };
let setRouteRef = null;

export function useRoute() {
  const [route, setRoute] = useState(HOME);
  setRouteRef = setRoute;
  useEffect(() => {
    history.replaceState(HOME, '');
    const onPop = e => { closeOverlays(); setRoute(e.state || HOME); window.scrollTo(0, 0); };
    addEventListener('popstate', onPop);
    return () => removeEventListener('popstate', onPop);
  }, []);
  return route;
}

export function go(name, params = {}, replace = false) {
  const st = { name, params };
  if (replace) history.replaceState(st, ''); else history.pushState(st, '');
  setRouteRef?.(st);
  window.scrollTo(0, 0);
}

export const back = () => history.back();
export const currentRoute = () => history.state || HOME;
