"use client";

import { useEffect, useState } from "react";
import { OTO, PRICES, dollars, FOUNDING_SEATS } from "@/config/medspa-funnel";
import { PaymentForm, handleNextAction } from "../../payment-element";
import { track } from "@/lib/medspa/pixel";
import type { OtoMode } from "./page";

interface Props {
  mode: OtoMode;
  token: string;
  orderId: string | null;
  seatsLeft: number;
  checkoutEnabled: boolean;
}

type Stage = "offer" | "done" | "declined";

interface AuditStatus {
  activeStep: number;
  engine: { done: number; total: number };
  done: boolean;
}

export function OtoClient({ mode, token, orderId, seatsLeft, checkoutEnabled }: Props) {
  const [stage, setStage] = useState<Stage>("offer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [city, setCity] = useState("");
  const [standardSecret, setStandardSecret] = useState<string | null>(null);
  const [status, setStatus] = useState<AuditStatus | null>(null);

  // The audit runs while they read. Steps are DERIVED server side from the report
  // row and a count of audit_runs, so a stalled pipeline stalls the display rather
  // than a timer inventing progress.
  useEffect(() => {
    if (!orderId) return;
    let alive = true;

    async function poll() {
      try {
        const res = await fetch(`/api/medspa/order/${orderId}/status`);
        const data = await res.json();
        if (!alive || !data.ok) return;
        setStatus({ activeStep: data.activeStep, engine: data.engine, done: data.done });
        if (data.done) return; // stop polling
      } catch {
        /* a failed poll is not worth surfacing; the next one may work */
      }
      if (alive) window.setTimeout(poll, 5000);
    }

    poll();
    return () => {
      alive = false;
    };
  }, [orderId]);

  async function claimFounding() {
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const res = await fetch("/api/medspa/oto/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, city }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        if (data.fallback === "standard") {
          // The seat went, or the token was already spent. Move them to the standard
          // path rather than dead-ending on an error.
          setError(null);
          await startStandard();
          return;
        }
        setError(data.message ?? "That did not go through.");
        setBusy(false);
        return;
      }

      // Off-session 3DS. Without raising the challenge the subscription would sit
      // `incomplete` forever while the buyer believed they had subscribed.
      if (data.requiresAction && data.clientSecret) {
        const result = await handleNextAction(data.clientSecret);
        if (!result.ok) {
          setError(result.message ?? "We could not authenticate that card.");
          setBusy(false);
          return;
        }
      }

      track("Subscribe");
      setStage("done");
    } catch {
      setError("We could not reach the server. Try again in a moment.");
      setBusy(false);
    }
  }

  async function startStandard() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/medspa/oto/standard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, city }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data.message ?? "Could not start checkout.");
        setBusy(false);
        return;
      }
      setStandardSecret(data.clientSecret);
      setBusy(false);
    } catch {
      setError("We could not reach the server. Try again in a moment.");
      setBusy(false);
    }
  }

  if (stage === "done") {
    return (
      <div className="medspa-card">
        <h2>{OTO.done.headline}</h2>
        <p style={{ marginBottom: 0 }}>{OTO.done.body}</p>
      </div>
    );
  }

  if (stage === "declined") {
    return (
      <div className="medspa-card">
        <h2>{OTO.declined.headline}</h2>
        <p style={{ marginBottom: 0 }}>{OTO.declined.body}</p>
      </div>
    );
  }

  if (mode === "invalid") {
    return (
      <div className="medspa-card">
        <h2>{OTO.invalid.headline}</h2>
        <p style={{ marginBottom: 0 }}>{OTO.invalid.body}</p>
      </div>
    );
  }

  const isFounding = mode === "founding";
  const copy = isFounding ? OTO.founding : OTO.standard;

  return (
    <>
      {orderId && (
        <div className="medspa-card" style={{ marginBottom: "1.5rem" }}>
          <h2>{OTO.runningHeadline}</h2>
          <p>{OTO.runningBody}</p>
          <ol className="medspa-steps">
            {OTO.steps.map((label, i) => {
              const n = i + 1;
              const active = status ? status.activeStep === n : n === 1;
              const complete = status ? status.activeStep > n || status.done : false;
              return (
                <li key={label} className={complete ? "is-done" : active ? "is-active" : ""}>
                  <span className="medspa-step-dot" aria-hidden="true">
                    {complete ? "✓" : n}
                  </span>
                  <span>
                    {label}
                    {n === 4 && status && status.engine.total > 0 && !complete && (
                      <span className="medspa-step-count">
                        {" "}
                        {status.engine.done} of {status.engine.total}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>
      )}

      <section className="medspa-offer">
        <span className="medspa-eyebrow">{copy.eyebrow}</span>
        <h2>{copy.headline}</h2>
        <p className="medspa-offer-body">{copy.body}</p>

        {isFounding && (
          <>
            <ul className="medspa-bullets">
              {OTO.founding.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
            <p className="medspa-seats">
              {seatsLeft} of {FOUNDING_SEATS} {OTO.founding.seatsLabel}
            </p>
          </>
        )}

        {!isFounding && (
          <p className="medspa-notice" style={{ marginTop: 0, marginBottom: "1.25rem" }}>
            {mode === "standard_sold_out" ? OTO.standard.soldOut : OTO.standard.expired}
          </p>
        )}

        <div className="medspa-field">
          <label className="medspa-label" htmlFor="oto-city">
            {OTO.standard.cityLabel}
          </label>
          <input
            id="oto-city"
            className="medspa-input"
            type="text"
            autoComplete="address-level2"
            placeholder={OTO.standard.cityPlaceholder}
            value={city}
            onChange={(e) => setCity(e.target.value)}
            disabled={busy}
          />
        </div>

        {!checkoutEnabled ? (
          <p className="medspa-notice">Checkout is not open yet.</p>
        ) : standardSecret ? (
          <PaymentForm
            clientSecret={standardSecret}
            submitLabel={`${OTO.standard.cta}`}
            busyLabel={OTO.standard.ctaBusy}
            onPaid={async () => {
              track("Subscribe");
              setStage("done");
            }}
          />
        ) : (
          <button
            className="medspa-btn"
            type="button"
            disabled={busy}
            onClick={isFounding ? claimFounding : startStandard}
          >
            {busy ? copy.ctaBusy : copy.cta}
          </button>
        )}

        {isFounding && <p className="medspa-reassure">{OTO.founding.noCard}</p>}

        {error && (
          <p className="medspa-error" role="alert">
            {error}
          </p>
        )}

        <button type="button" className="medspa-linkbtn" onClick={() => setStage("declined")}>
          {OTO.founding.decline}
        </button>

        <p className="medspa-reassure" style={{ marginTop: "0.5rem" }}>
          {isFounding ? dollars(PRICES.founding) : dollars(PRICES.standard)} a month. Cancel any time.
        </p>
      </section>
    </>
  );
}
