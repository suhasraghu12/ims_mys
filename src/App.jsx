import { useEffect, useState } from 'react';
import { useStore, load, setLocked, getState } from './lib/store.js';
import { useRoute } from './ui/router.js';
import { OverlayRoot, closeOverlays } from './ui/overlay.jsx';
import { Toast } from './ui/toast.jsx';
import BottomNav, { TAB_SCREENS } from './ui/BottomNav.jsx';
import { flushPending } from './actions.jsx';
import { startAutoSync } from './lib/sync.js';
import Home from './screens/Home.jsx';
import { BillScreen, PaymentScreen } from './screens/Entry.jsx';
import { CustomersScreen, CustomerScreen } from './screens/Customers.jsx';
import Reminders from './screens/Reminders.jsx';
import Settings from './screens/Settings.jsx';
import { Lock, Setup } from './screens/Gate.jsx';

const SCREENS = {
  home: Home, bill: BillScreen, payment: PaymentScreen, reminders: Reminders,
  customers: CustomersScreen, customer: CustomerScreen, settings: Settings,
};
const RELOCK_AFTER = 5 * 60 * 1000;

export default function App() {
  const st = useStore();
  const route = useRoute();
  const [error, setError] = useState(null);

  useEffect(() => {
    load().catch(setError);
    navigator.storage?.persist?.();
  }, []);

  useEffect(() => { if (st.ready) return startAutoSync(); }, [st.ready]);

  // Keep a pending entry if the app is closed; lock again after 5 minutes away
  useEffect(() => {
    let hiddenAt = 0;
    const onVis = () => {
      if (document.hidden) { hiddenAt = Date.now(); flushPending(); }
      else if (getState().settings?.pinHash && hiddenAt && Date.now() - hiddenAt > RELOCK_AFTER) { closeOverlays(); setLocked(true); }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  let screen;
  if (error) screen = <main><p className="red">Could not start the app: {error.message}</p></main>;
  else if (!st.ready) screen = <div className="spinner" role="status" aria-label="Loading" />;
  else if (st.locked) screen = <Lock />;
  else if (!st.settings.setupDone) screen = <Setup />;
  else {
    const Screen = SCREENS[route.name] || Home;
    screen = <>
      <Screen key={route.name + (route.params.id || '')} {...route.params} />
      {TAB_SCREENS.includes(route.name) && <BottomNav active={route.name} />}
    </>;
  }

  return <>{screen}<OverlayRoot /><Toast /></>;
}
