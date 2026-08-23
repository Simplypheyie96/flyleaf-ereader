import { useEffect, useRef, useState } from 'react'
import { CupIcon } from './icons'

/* ── the tip jar ───────────────────────────────────────────────────────────
   Its own panel in Settings, and its own Paystack integration.

   It used to be a link to Press. That was a defensible call when it was made —
   Press already runs the Paystack function and already holds the secret, so a
   second integration meant a second thing to keep working — but it was the
   wrong call for the reader, who tapped a row in this app's settings and
   arrived in a different app's settings with no explanation. The owner's words:
   "why is buy me a coffee redirecting to press flyleaf? it should have it's
   own."

   ARCHITECTURE, and the honest trade-off. Press initialises the transaction
   server-side and verifies it server-side, because it has a Vercel function and
   a secret key. This app has neither: it is a static deploy with no server and
   no database, on purpose, and the only credential that exists for it is the
   PUBLIC key. So it uses Paystack Inline instead — the checkout runs in a popup
   Paystack itself owns, and the browser is told the outcome.

   What that costs: nothing here is server-verified, so a determined person
   could make this panel SAY thank you without having paid. That is acceptable
   only because the jar gates nothing at all — there is no feature, no unlock,
   no receipt to forge your way into. If anything in this app were ever put
   behind a payment, this file would have to be replaced with a server call, not
   patched.

   The key is committed. Paystack public keys are publishable by design (they
   are meant to sit in client JavaScript, which is exactly where this one sits),
   and hardcoding it means the jar works on a fresh deploy with no dashboard
   step to forget. The env var is an override, not a requirement.

   NOT a network feature in the sense the guardrails ban. The app itself has to
   work offline; a jar cannot, and it says so plainly when the device is offline
   rather than firing a script tag into the dark and reporting a mystery. */

const KEY = (import.meta.env.VITE_PAYSTACK_KEY as string | undefined)
  ?? 'pk_live_3bf4a538516e191e8c5ad61330c51f5b16879181'

const SDK = 'https://js.paystack.co/v2/inline.js'

/* Naira, because that is the account the money lands in. Three amounts and a
   floor, matching Press so the two jars ask for the same thing: a small,
   a middling and a generous one, and nothing above them — a jar with a £500
   option is not asking for a coffee. */
const CURRENCY = 'NGN'
const PRESETS = [2000, 5000, 10_000] as const
const FLOOR = 200

/* narrowSymbol so it reads ₦2,000 rather than NGN 2,000. Wrapped, because
   currencyDisplay is not everywhere and a thrown formatter would take the whole
   panel down over a symbol. */
function money(n: number): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency: CURRENCY, currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0,
    }).format(n)
  } catch {
    return `${CURRENCY} ${n.toLocaleString()}`
  }
}

/* Deliberately loose. This field exists because Paystack requires an email to
   raise a transaction, not so this app can validate anybody's address — the
   strict thing to do is let Paystack reject it, and the kind thing is to catch
   the obvious typo before the popup opens. */
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

type Stage = 'shut' | 'asking' | 'opening' | 'thanks' | 'stuck'

interface Txn {
  key: string
  email: string
  amount: number
  currency: string
  onSuccess?: (r: { reference?: string }) => void
  onCancel?: () => void
  onError?: (e: unknown) => void
  onLoad?: () => void
}
interface Pop { newTransaction: (t: Txn) => void }
declare global {
  interface Window { PaystackPop?: new () => Pop }
}

/* One tag, one promise, however many times the panel is opened and shut. */
let sdk: Promise<void> | null = null
function loadSdk(): Promise<void> {
  if (window.PaystackPop) return Promise.resolve()
  if (sdk) return sdk
  sdk = new Promise<void>((ok, no) => {
    const tag = document.createElement('script')
    tag.src = SDK
    tag.async = true
    tag.onload = () => (window.PaystackPop ? ok() : no(new Error('loaded without PaystackPop')))
    tag.onerror = () => { sdk = null; no(new Error('script blocked')) }
    document.head.append(tag)
  })
  return sdk
}

export function Tip() {
  const [stage, setStage] = useState<Stage>('shut')
  const [amount, setAmount] = useState<number>(PRESETS[1])
  const [custom, setCustom] = useState('')
  const [email, setEmail] = useState('')
  const [why, setWhy] = useState<string | null>(null)
  const [online, setOnline] = useState(() => navigator.onLine)
  const first = useRef<HTMLButtonElement>(null)

  /* Watched rather than read once: Settings is a page people leave open, and a
     jar that decided you were offline three minutes ago is a jar that is wrong
     now. */
  useEffect(() => {
    const up = () => setOnline(true)
    const down = () => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down) }
  }, [])

  /* Focus the first amount when the checkout opens, so a keyboard lands inside
     the thing that just appeared rather than back at the button that opened it. */
  useEffect(() => { if (stage === 'asking') first.current?.focus() }, [stage])

  const typed = custom.trim() === '' ? null : Number(custom.replace(/[^\d]/g, ''))
  const chosen = typed !== null && Number.isFinite(typed) && typed > 0 ? typed : amount
  const tooSmall = chosen < FLOOR

  const open = async () => {
    if (tooSmall) return
    if (!LOOKS_LIKE_EMAIL.test(email.trim())) {
      setWhy('Paystack needs an email address to send the receipt to.')
      return
    }
    setWhy(null)
    setStage('opening')
    try {
      await loadSdk()
    } catch {
      /* Three different failures land here and they are not the same thing to
         say: no network at all, a network that will not fetch Paystack (an
         extension, a filter, a captive portal), or Paystack answering with
         something that is not the SDK. None of them took any money, and all of
         them are worth naming rather than calling "something went wrong" —
         being told the wrong cause of a failure is worse than being told
         nothing. */
      setWhy(
        navigator.onLine
          ? 'Paystack’s checkout would not load. A content blocker or a network filter is the usual reason. Nothing was charged.'
          : 'This device is offline, so the checkout could not load. Nothing was charged.',
      )
      setStage('stuck')
      return
    }
    try {
      /* Kobo. Paystack takes the amount in the currency's SUBUNIT, so a ₦2,000
         tip is 200000 — the one arithmetic mistake in this file that would cost
         somebody real money, which is why it is on its own line with its own
         name. */
      const subunit = Math.round(chosen * 100)
      new window.PaystackPop!().newTransaction({
        key: KEY,
        email: email.trim(),
        amount: subunit,
        currency: CURRENCY,
        onSuccess: () => { setStage('thanks') },
        /* Cancelling is not a failure and must not be dressed as one: it puts
           the form back exactly as it was, with no red text and no apology. */
        onCancel: () => { setStage('asking') },
        onError: () => {
          setWhy('Paystack turned the payment down. Nothing was charged — it is worth trying another card.')
          setStage('stuck')
        },
      })
    } catch {
      setWhy('The checkout would not start. Nothing was charged.')
      setStage('stuck')
    }
  }

  return (
    <section className="panel">
      <p className="ui-lbl">Buy the maker a coffee</p>

      <div className="tip-head">
        <span className="tip-mark" aria-hidden="true"><CupIcon /></span>
        <p className="ui-p">
          This reader is free and stays free. There is nothing behind a payment
          here — no account, no upgrade, no feature waiting for one. If it has
          been good company, the jar is here, and if it has not, nothing is
          missing.
        </p>
      </div>

      {stage === 'thanks' ? (
        <div className="set-confirm">
          <p className="ui-p">
            Thank you — genuinely. Paystack has emailed the receipt to{' '}
            <strong>{email.trim()}</strong>.
          </p>
          <div className="set-acts">
            <button className="btn btn--ghost btn--sm" type="button" onClick={() => { setStage('shut'); setCustom('') }}>
              Close
            </button>
          </div>
        </div>
      ) : stage === 'shut' ? (
        <div className="set-acts">
          <button className="btn" type="button" onClick={() => setStage('asking')} disabled={!online}>
            Leave something in the jar
          </button>
          {!online && (
            <p className="ui-p ui-p--soft" style={{ flexBasis: '100%', marginTop: 4 }}>
              The jar needs a connection. Everything else in this app does not.
            </p>
          )}
        </div>
      ) : (
        /* A step inside the panel, not a second card and not a modal: the
           checkout belongs to the button above it. Press's rule, kept — a
           checkout sitting permanently open in the settings of a free app is a
           shop counter in somebody's living room. */
        <div className="set-confirm">
          <p className="ui-lbl">How much</p>
          <div className="tip-amounts">
            {PRESETS.map((n, i) => (
              <button
                key={n}
                ref={i === 0 ? first : undefined}
                type="button"
                className="tip-amount"
                aria-pressed={typed === null && amount === n}
                onClick={() => { setAmount(n); setCustom(''); setWhy(null) }}
              >
                {money(n)}
              </button>
            ))}
          </div>

          <label className="tip-field">
            {/* The unit in the LABEL, not the placeholder. The pills above set
                ₦2,000 and the field's placeholder read "2000", so the two
                disagreed about whether a currency belonged in the number —
                and a grey "2000" under a label with no unit reads as a value
                already entered rather than a hint. */}
            <span className="ui-lbl">Or another amount (₦)</span>
            <input
              type="text"
              inputMode="numeric"
              value={custom}
              placeholder={String(PRESETS[0])}
              aria-label={`Another amount, in ${CURRENCY}`}
              onChange={(e) => { setCustom(e.target.value); setWhy(null) }}
            />
          </label>

          <label className="tip-field">
            <span className="ui-lbl">Email for the receipt</span>
            <input
              type="email"
              value={email}
              autoComplete="email"
              placeholder="you@example.com"
              aria-label="Email address for the receipt"
              onChange={(e) => { setEmail(e.target.value); setWhy(null) }}
            />
          </label>

          {tooSmall && (
            <p className="ui-p ui-p--soft tip-note">
              Paystack’s own floor is {money(FLOOR)} — under that, the fee is most of the tip.
            </p>
          )}
          {why && <p className="ui-p tip-why">{why}</p>}

          <div className="set-acts">
            <button className="btn" type="button" onClick={() => void open()} disabled={stage === 'opening' || tooSmall}>
              {stage === 'opening' ? 'Opening Paystack…' : `Continue with ${money(chosen)}`}
            </button>
            <button
              className="btn btn--ghost"
              type="button"
              onClick={() => { setStage('shut'); setWhy(null); setCustom('') }}
            >
              Not now
            </button>
          </div>
          <p className="ui-p ui-p--soft tip-fine">
            Paystack takes the card details, not this app — it never sees them,
            and there is nothing here to store them in. One payment, no
            subscription.
          </p>
        </div>
      )}
    </section>
  )
}
