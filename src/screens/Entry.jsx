// New bill and payment screens: photo → customer → amount
import { useEffect } from 'react';
import * as L from '../lib/logic.js';
import { useStore, customerById, statusOf, setFlow } from '../lib/store.js';
import { Header, Icon, Avatar, Keypad } from '../ui/components.jsx';
import { showPhoto } from '../ui/overlay.jsx';
import { go } from '../ui/router.js';
import { takeBillPhoto, creditOk, saveBill, savePayment, addReceipt } from '../actions.jsx';
import CustomerPicker from './CustomerPicker.jsx';

const MODES = [['cash', 'cash', 'Cash'], ['upi', 'mobile', 'UPI'], ['other', null, 'Other']];

function AmountEntry({ F, c, kind }) {
  const st = useStore();
  const s = statusOf(c, st);
  const pay = kind === 'payment';
  const a = +F.amount || 0;
  const after = pay ? s.balance - a : s.balance + a;
  const preview = !a ? '' : !pay ? `New total ${L.money(after)}`
    : after > 0 ? `Still pending ${L.money(after)}` : after === 0 ? 'All clear' : `Advance ${L.money(-after)}`;

  return <>
    <div className="who">
      <Avatar c={c} s={s} />
      <div><b>{c.name}</b><div className="muted">{s.balance > 0 ? `Pending ${L.money(s.balance)}` : s.balance < 0 ? `Advance ${L.money(-s.balance)}` : 'No pending'}</div></div>
      <button className="link-btn" onClick={() => setFlow({ step: 'customer' })}>Change</button>
    </div>
    <div className="display">
      <span className="eyebrow">{pay ? 'Amount received' : 'Bill total'}</span>
      <div className="amount" aria-live="polite"><span className="rs">₹</span>{L.num(a)}</div>
      <div className="preview">{preview || (pay ? 'Type the amount paid' : 'Type the total on the bill')}</div>
    </div>
    {pay && <div className="pay-extras">
      {s.balance > 0 && <button className="chip-btn" id="full" onClick={() => setFlow({ amount: String(s.balance) })}>Full {L.money(s.balance)}</button>}
      <div className="seg" role="group" aria-label="Paid by">
        {MODES.map(([m, ic, label]) => <button key={m} className={F.mode === m ? 'on' : ''} onClick={() => setFlow({ mode: m })}>{ic && <Icon name={ic} />}{label}</button>)}
      </div>
      <button className="chip-btn" onClick={addReceipt}>{F.photo ? <><Icon name="check" />Receipt added</> : <><Icon name="camera" />Receipt photo</>}</button>
    </div>}
    <Keypad value={F.amount} onChange={v => setFlow({ amount: v })} />
    <button className="btn primary block big" disabled={!a} onClick={pay ? savePayment : saveBill}>{pay ? 'Save Payment' : 'Save Bill'}</button>
  </>;
}

// Leave a flow screen if it was reached without a flow (e.g. browser forward button)
function useFlowGuard(F, kind) {
  useEffect(() => { if (!F || F.kind !== kind) go('home', {}, true); }, [F, kind]);
}

export function BillScreen() {
  const { flow: F } = useStore();
  useFlowGuard(F, 'bill');
  if (!F || F.kind !== 'bill') return null;
  const c = customerById(F.customerId);

  let body;
  if (F.step === 'photo') body = <div className="photo-step">
    <button className="primary-action" onClick={() => takeBillPhoto(true)}>
      <span className="ibox"><Icon name="camera" /></span><span className="pa-text"><b>Take photo of bill</b><small>Opens the camera</small></span>
    </button>
    <button className="wide-btn" onClick={() => takeBillPhoto(false)}><Icon name="image" /> Choose from gallery</button>
    <button className="link-btn" onClick={() => setFlow({ step: F.customerId ? 'amount' : 'customer' })}>Continue without photo</button>
  </div>;
  else if (F.step === 'processing') body = <div className="spinner" role="status" aria-label="Loading photo" />;
  else {
    const photoBar = F.photo && <div className="photo-bar">
      <img src={F.photo.url} alt="Bill photo — tap to enlarge" className="bill-thumb" onClick={() => showPhoto(F.photo.fullUrl)} />
      <button className="btn small" onClick={() => takeBillPhoto(true)}><Icon name="camera" /> Retake</button>
    </div>;
    body = F.step === 'customer' || !c
      ? <>{photoBar}<h2 className="step-title">Whose bill is this?</h2>
          <CustomerPicker onPick={async picked => { if (await creditOk(picked)) setFlow({ customerId: picked.id, step: 'amount' }); }} /></>
      : <>{photoBar}<AmountEntry F={F} c={c} kind="bill" /></>;
  }
  return <><Header title="New Bill" /><main>{body}</main></>;
}

export function PaymentScreen() {
  const { flow: F } = useStore();
  useFlowGuard(F, 'payment');
  if (!F || F.kind !== 'payment') return null;
  const c = customerById(F.customerId);
  return <>
    <Header title="Payment Received" />
    <main>
      {F.step === 'customer' || !c
        ? <><h2 className="step-title">Who paid?</h2><CustomerPicker pendingFirst onPick={picked => setFlow({ customerId: picked.id, step: 'amount' })} /></>
        : <AmountEntry F={F} c={c} kind="payment" />}
    </main>
  </>;
}
