"use client";

import { useRef, useState } from "react";
import {
  GET_NAMED,
  NOT_INCLUDED,
  PRICES,
  TIER_TABLE,
  dollars,
  firstMonthCents,
  funnelUrl,
  tierPrice,
  type Tier,
  type TierRow,
} from "@/config/medspa-funnel";
import { PaymentForm, handleNextAction } from "../payment-element";
import { validEmail } from "@/lib/medspa/validate";
import { track } from "@/lib/medspa/pixel";

interface Props {
  email: string;
  firstName: string;
  city: string;
  zip: string;
  hasAuditCredit: boolean;
  checkoutEnabled: boolean;
}

/** One cell of the comparison table. */
function Cell({ value }: { value: boolean | string }) {
  if (value === true) return <span className="gn-yes" aria-label="Included">✓</span>;
  if (value === false)
    return (
      // A middle dot, not an em dash. copy-guard throws on em dashes at module load
      // and that rule is absolute. aria-label carries the meaning a glyph cannot.
      <span className="gn-no" aria-label="Not included">
        {NOT_INCLUDED}
      </span>
    );
  return <span className="gn-val">{value}</span>;
}

export function GetNamedClient({
  email: initialEmail,
  firstName,
  city: initialCity,
  zip: initialZip,
  hasAuditCredit,
  checkoutEnabled,
}: Props) {
  const [tier, setTier] = useState<Tier>("core");
  const [email, setEmail] = useState(initialEmail);
  const [zip, setZip] = useState(initialZip);
  const [city, setCity] = useState(initialCity);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement | null>(null);

  const knownEmail = Boolean(initialEmail);

  function done() {
    track("Subscribe");
    window.location.assign(funnelUrl("/get-named/confirmed"));
  }

  async function start(chosen: Tier) {
    if (busy) return;
    setTier(chosen);
    setError(null);

    if (!validEmail(email)) {
      setError("We need a working email address.");
      emailRef.current?.focus();
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/medspa/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, tier: chosen, zip, city }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        setError(data.message ?? "That did not go through.");
        setBusy(false);
        return;
      }

      // No saved card: mount a Payment Element against the subscription's first
      // invoice and let them enter one.
      if (data.needsPaymentElement && data.clientSecret) {
        setClientSecret(data.clientSecret);
        setBusy(false);
        return;
      }

      // Saved card that needs a 3DS challenge. Without raising it the subscription
      // sits `incomplete` forever while the customer believes they subscribed.
      if (data.requiresAction && data.clientSecret) {
        const result = await handleNextAction(data.clientSecret);
        if (!result.ok) {
          setError(result.message ?? "We could not authenticate that card.");
          setBusy(false);
          return;
        }
      }

      done();
    } catch {
      setError("We could not reach the server. Try again in a moment.");
      setBusy(false);
    }
  }

  const firstMonth = firstMonthCents(tier, hasAuditCredit);

  return (
    <>
      <span className="medspa-eyebrow">{GET_NAMED.eyebrow}</span>
      <h1 className="medspa-h1">
        {firstName ? `${firstName}, ` : ""}
        {GET_NAMED.headline}
      </h1>

      {/* The whole argument for two tiers, and it sits ABOVE the table on purpose. */}
      <p className="gn-positioning">{GET_NAMED.positioning}</p>

      <div className="gn-table-wrap">
        <table className="gn-table">
          <thead>
            <tr>
              <th scope="col" />
              <th scope="col">
                <span className="gn-tier-name">{GET_NAMED.coreName}</span>
                <span className="gn-tier-price">
                  {dollars(PRICES.core)} {GET_NAMED.perMonth}
                </span>
              </th>
              <th scope="col">
                <span className="gn-tier-name">{GET_NAMED.completeName}</span>
                <span className="gn-tier-price">
                  {dollars(PRICES.complete)} {GET_NAMED.perMonth}
                </span>
              </th>
            </tr>
          </thead>
          {/*
            Sections render in TIER_TABLE order and that order is load-bearing. The
            volume rows (4 vs 8, 20 vs 40) live inside their sections, never at the
            top: the tiers differ in category, not quantity.
          */}
          {TIER_TABLE.map((section) => (
            <tbody key={section.heading}>
              <tr className="gn-section">
                <th scope="rowgroup" colSpan={3}>
                  {section.heading}
                </th>
              </tr>
              {section.rows.map((row: TierRow) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  <td>
                    <Cell value={row.core} />
                  </td>
                  <td>
                    <Cell value={row.complete} />
                  </td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>

      <div className="medspa-card">
        {hasAuditCredit && (
          <p className="gn-credit">
            {GET_NAMED.creditPrefix} <strong>{dollars(firstMonth)}</strong>.
          </p>
        )}

        {!knownEmail && (
          <div className="medspa-field">
            <label className="medspa-label" htmlFor="gn-email">
              Email
            </label>
            <input
              id="gn-email"
              ref={emailRef}
              className="medspa-input"
              type="email"
              inputMode="email"
              autoComplete="email"
              spellCheck={false}
              placeholder="you@yourclinic.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
            />
          </div>
        )}

        {/*
          ZIP and city are CAPTURED, never a gate. One clinic per market is flagged
          and adjudicated by a human; blocking checkout on a string match would lose
          real sales to "Winston Salem" vs "Winston-Salem".
        */}
        <div className="gn-fields">
          <div className="medspa-field">
            <label className="medspa-label" htmlFor="gn-zip">
              {GET_NAMED.zipLabel}
            </label>
            <input
              id="gn-zip"
              className="medspa-input"
              type="text"
              inputMode="numeric"
              autoComplete="postal-code"
              placeholder={GET_NAMED.zipPlaceholder}
              value={zip}
              onChange={(e) => setZip(e.target.value)}
              disabled={busy}
            />
          </div>
          <div className="medspa-field">
            <label className="medspa-label" htmlFor="gn-city">
              {GET_NAMED.cityLabel}
            </label>
            <input
              id="gn-city"
              className="medspa-input"
              type="text"
              autoComplete="address-level2"
              placeholder={GET_NAMED.cityPlaceholder}
              value={city}
              onChange={(e) => setCity(e.target.value)}
              disabled={busy}
            />
          </div>
        </div>

        {!checkoutEnabled ? (
          <p className="medspa-notice">Checkout is not open yet.</p>
        ) : clientSecret ? (
          <PaymentForm
            clientSecret={clientSecret}
            submitLabel={`${tier === "core" ? GET_NAMED.coreCta : GET_NAMED.completeCta}, ${dollars(tierPrice(tier))} ${GET_NAMED.perMonth}`}
            busyLabel={GET_NAMED.ctaBusy}
            onPaid={done}
          />
        ) : (
          <div className="gn-buttons">
            <button
              className="medspa-btn gn-btn-core"
              type="button"
              disabled={busy}
              onClick={() => start("core")}
            >
              {busy && tier === "core"
                ? GET_NAMED.ctaBusy
                : `${GET_NAMED.coreCta}, ${dollars(PRICES.core)} ${GET_NAMED.perMonth}`}
            </button>
            <button
              className="medspa-btn"
              type="button"
              disabled={busy}
              onClick={() => start("complete")}
            >
              {busy && tier === "complete"
                ? GET_NAMED.ctaBusy
                : `${GET_NAMED.completeCta}, ${dollars(PRICES.complete)} ${GET_NAMED.perMonth}`}
            </button>
          </div>
        )}

        {error && (
          <p className="medspa-error" role="alert">
            {error}
          </p>
        )}

        <p className="medspa-reassure">{GET_NAMED.noTerm}</p>
        {hasAuditCredit && <p className="medspa-reassure">{GET_NAMED.savedCardNote}</p>}
      </div>

      <section className="gn-guarantee">
        <h2>{GET_NAMED.guaranteeHeading}</h2>
        <p>{GET_NAMED.guaranteeBody}</p>
        <p className="gn-not-refund">{GET_NAMED.guaranteeNotRefund}</p>
      </section>

      {/* Present before payment even though it is not in the video. */}
      <p className="gn-terms">{GET_NAMED.implementationNote}</p>
    </>
  );
}
