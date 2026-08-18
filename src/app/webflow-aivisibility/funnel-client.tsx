"use client";

// The interactive half of the VSL-A landing page: the gated video, the opt-in form,
// and the $39 offer panel that replaces the form once they are on the list.
//
// One client island rather than three, because all three share the same two pieces
// of state (has the CTA been revealed, and has the visitor opted in) and threading
// that through separate components would mean lifting it into a context for no gain.

import { useEffect, useRef, useState } from "react";
import { GatedVSL } from "@/components/gated-vsl";
import { LANDING, OFFER, VIDEO, VSL_A } from "@/config/medspa-funnel";
import {
  fieldErrorMessage,
  validateOptin,
  type FieldError,
} from "@/lib/medspa/validate";
import { normalizeTarget, normalizeErrorMessage } from "@/lib/scan/normalize";
import { formatPhoneUS } from "@/lib/clients/normalize";
import { readAttribution, track } from "@/lib/medspa/pixel";
import { PaymentForm } from "./payment-element";

type Stage = "watching" | "optin" | "offer" | "declined" | "intent" | "paying";

export function FunnelClient({ checkoutEnabled }: { checkoutEnabled: boolean }) {
  const [stage, setStage] = useState<Stage>("watching");

  // Opt-in fields
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Offer fields. The website is the ONLY thing collected here: the popup sells a
  // single flat $39 line item, no bump, no add-on.
  const [website, setWebsite] = useState("");
  const [websiteError, setWebsiteError] = useState<string | null>(null);
  const [offerBusy, setOfferBusy] = useState(false);

  // Live checkout state (only used when checkoutEnabled).
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  // The opt-in route signs and returns this. Both the buy path and the decline path
  // lead to the training, so it is the next destination either way.
  const [trainingUrl, setTrainingUrl] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [confirmSecret, setConfirmSecret] = useState<string | null>(null);

  const renderedAt = useRef(Date.now());
  const optinRef = useRef<HTMLDivElement | null>(null);
  const offerRef = useRef<HTMLDivElement | null>(null);
  const websiteRef = useRef<HTMLInputElement | null>(null);

  // PageView is NOT fired here. The base pixel snippet in layout.tsx fires it
  // unconditionally, which is deliberate and matches every srtagency funnel: PageView
  // is the pixel's baseline and is what sets _fbp in the first place. The attribution
  // gate in track() applies to the CONVERSION events below, which is what the ad sets
  // optimize on and what would otherwise be inflated by direct traffic.

  function onCtaReveal() {
    track("ViewContent");
    setStage((s) => (s === "watching" ? "optin" : s));
  }

  // Move the viewer to whatever just appeared. Focus goes with it on the offer panel
  // because its input is the next thing they have to touch.
  useEffect(() => {
    if (stage === "optin") {
      optinRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    if (stage === "offer") {
      offerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      window.setTimeout(() => websiteRef.current?.focus(), 350);
    }
  }, [stage]);

  async function submitOptin(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setFormMessage(null);

    // Validated with the SAME function the route uses, so a typo never costs a round
    // trip and the two cannot drift apart.
    const check = validateOptin({ name, email, phone, consent });
    if (!check.ok) {
      setErrors(check.errors);
      return;
    }
    setErrors([]);
    setBusy(true);

    const attr = readAttribution();

    try {
      const res = await fetch("/api/medspa/optin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          phone,
          consent,
          company_url_hp: honeypot,
          renderedAt: renderedAt.current,
          ...attr,
        }),
      });
      const data = await res.json();

      if (!res.ok || !data.ok) {
        setErrors(Array.isArray(data.fields) ? data.fields : []);
        setFormMessage(data.message ?? "Something went wrong. Try again in a moment.");
        setBusy(false);
        return;
      }

      // Fires only for ad-attributed visitors, which is what the ad set optimizes on.
      track("Lead");
      if (typeof data.trainingUrl === "string") setTrainingUrl(data.trainingUrl);
      setBusy(false);
      setStage("offer");
      track("InitiateCheckout");
    } catch {
      setFormMessage("We could not reach the server. Check your connection and try again.");
      setBusy(false);
    }
  }

  async function submitIntent(e: React.FormEvent) {
    e.preventDefault();
    if (offerBusy) return;

    const check = normalizeTarget(website);
    if (!check.ok) {
      setWebsiteError(normalizeErrorMessage(check.error));
      websiteRef.current?.focus();
      return;
    }
    setWebsiteError(null);
    setOfferBusy(true);

    const attr = readAttribution();

    // ONE env var separates the two behaviours. Unset, the tap records intent and
    // the clinic URL so the $39 click-through rate is measurable before any payment
    // code runs. Set, the same tap opens a real Payment Element.
    const endpoint = checkoutEnabled ? "/api/medspa/checkout/intent" : "/api/medspa/intent";

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          name,
          website: check.target.website,
          fbclid: attr.fbclid,
          fbc: attr.fbc,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setWebsiteError(data.message ?? "Something went wrong. Try again in a moment.");
        setOfferBusy(false);
        return;
      }

      if (checkoutEnabled) {
        setClientSecret(data.clientSecret);
        setOrderId(data.orderId);
        setConfirmSecret(data.confirmSecret);
        setOfferBusy(false);
        setStage("paying");
        return;
      }

      setStage("intent");
    } catch {
      setWebsiteError("We could not reach the server. Try again in a moment.");
      setOfferBusy(false);
    }
  }

  /**
   * Called once Stripe confirms in the browser.
   *
   * This is the PRIMARY provisioning trigger. The webhook is an idempotent backstop,
   * but the buyer is redirected to the training about a second from now and webhook
   * latency cannot promise the row is ready by then.
   */
  async function onPaid() {
    track("Purchase");
    try {
      const res = await fetch("/api/medspa/checkout/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId, confirmSecret }),
      });
      const data = await res.json();
      // Buyers watch the training next. The subscription is sold from /get-named
      // afterwards, not as an immediate upsell.
      const next = (typeof data.trainingUrl === "string" && data.trainingUrl) || trainingUrl;
      if (data.ok && next) {
        window.location.assign(next);
        return;
      }
    } catch {
      /* fall through to the confirmation below */
    }
    // Payment succeeded but provisioning is still settling. The webhook finishes it
    // and the receipt email carries the same OTO link, so never imply a failure.
    setStage("intent");
  }

  const errorFor = (f: FieldError) => (errors.includes(f) ? fieldErrorMessage(f) : null);

  return (
    <>
      <GatedVSL
        videoUrl={VSL_A.url}
        poster={VSL_A.poster}
        onCtaReveal={onCtaReveal}
        ctaRevealSeconds={VSL_A.ctaRevealSeconds}
        allowScrub={VSL_A.allowScrub}
        resumeMode={VSL_A.resumeMode}
        unmuteLabel={VIDEO.unmuteLabel}
        playLabel={VIDEO.playLabel}
        placeholderTitle={VIDEO.placeholderTitle}
        placeholderBody={VIDEO.placeholderBody}
      />

      {stage === "optin" && (
        <div className="medspa-card" ref={optinRef}>
          <h2>{LANDING.ctaHeadline}</h2>
          <p>{LANDING.ctaBody}</p>

          <form onSubmit={submitOptin} noValidate>
            <div className="medspa-field">
              <label className="medspa-label" htmlFor="ms-name">
                {LANDING.fields.name}
              </label>
              <input
                id="ms-name"
                className="medspa-input"
                type="text"
                autoComplete="name"
                placeholder={LANDING.fields.namePlaceholder}
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={busy}
                aria-invalid={errors.includes("name")}
              />
              {errorFor("name") && <p className="medspa-error">{errorFor("name")}</p>}
            </div>

            <div className="medspa-field">
              <label className="medspa-label" htmlFor="ms-email">
                {LANDING.fields.email}
              </label>
              <input
                id="ms-email"
                className="medspa-input"
                type="email"
                inputMode="email"
                autoComplete="email"
                spellCheck={false}
                placeholder={LANDING.fields.emailPlaceholder}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={busy}
                aria-invalid={errors.includes("email")}
              />
              {errorFor("email") && <p className="medspa-error">{errorFor("email")}</p>}
            </div>

            <div className="medspa-field">
              <label className="medspa-label" htmlFor="ms-phone">
                {LANDING.fields.phone}
              </label>
              <input
                id="ms-phone"
                className="medspa-input"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder={LANDING.fields.phonePlaceholder}
                value={phone}
                // Live-formatted, same as /onboarding. The route behind this already
                // stores E.164 via validateOptin, so this is the typing half only: a
                // number that reads back as (336) 833-2303 while it is being entered is
                // one the visitor can check, and a typed +1 is absorbed rather than
                // doubled.
                onChange={(e) => setPhone(formatPhoneUS(e.target.value))}
                disabled={busy}
                aria-invalid={errors.includes("phone")}
              />
              {errorFor("phone") && <p className="medspa-error">{errorFor("phone")}</p>}
            </div>

            {/* Honeypot. Off-screen rather than display:none, and never autofilled. */}
            <div className="medspa-hp" aria-hidden="true">
              <label htmlFor="company_url_hp">Leave this empty</label>
              <input
                id="company_url_hp"
                name="company_url_hp"
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={honeypot}
                onChange={(e) => setHoneypot(e.target.value)}
              />
            </div>

            <label className="medspa-consent">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                disabled={busy}
              />
              <span>{LANDING.consent}</span>
            </label>
            {errorFor("consent") && <p className="medspa-error">{errorFor("consent")}</p>}

            <button className="medspa-btn" type="submit" disabled={busy}>
              {busy ? LANDING.submitBusy : LANDING.submit}
            </button>

            {formMessage && (
              <p className="medspa-error" role="alert">
                {formMessage}
              </p>
            )}
            <p className="medspa-reassure">{LANDING.reassure}</p>
          </form>
        </div>
      )}

      {(stage === "offer" || stage === "intent" || stage === "declined" || stage === "paying") && (
        <>
          <div className="medspa-card">
            <h2>{LANDING.successHeadline}</h2>
            <p style={{ marginBottom: 0 }}>{LANDING.successBody}</p>
          </div>

          {stage === "offer" && (
            <section className="medspa-offer" ref={offerRef}>
              <h2>{OFFER.headline}</h2>
              <p className="medspa-offer-body">{OFFER.body}</p>

              {/*
                One button, one price, one field. No order bump and no add-on: the
                only decision on this panel is the website, and it sits under the
                button as its label because it is the next step, not a caveat.
              */}
              <form onSubmit={submitIntent} noValidate>
                <button className="medspa-btn" type="submit" disabled={offerBusy}>
                  {offerBusy ? OFFER.buttonBusy : OFFER.button}
                </button>

                {/*
                  The website field sits DIRECTLY UNDER the button, as its label. It is
                  the next step, not a caveat, and the order is the founder's spec.
                */}
                <div className="medspa-offer-field">
                  <label className="medspa-label" htmlFor="ms-website">
                    {OFFER.fieldLabel}
                  </label>
                  <input
                    id="ms-website"
                    ref={websiteRef}
                    className="medspa-input"
                    type="text"
                    inputMode="url"
                    autoComplete="url"
                    spellCheck={false}
                    placeholder={OFFER.fieldPlaceholder}
                    value={website}
                    onChange={(e) => {
                      setWebsite(e.target.value);
                      if (websiteError) setWebsiteError(null);
                    }}
                    disabled={offerBusy}
                    aria-invalid={!!websiteError}
                    required
                  />
                  {websiteError && (
                    <p className="medspa-error" role="alert">
                      {websiteError}
                    </p>
                  )}
                </div>
              </form>

              <button
                type="button"
                className="medspa-linkbtn"
                onClick={() => {
                  // Decliners get the training too. It is not gated behind the
                  // purchase, and it is what carries them to /get-named.
                  if (trainingUrl) {
                    window.location.assign(trainingUrl);
                    return;
                  }
                  setStage("declined");
                }}
              >
                {OFFER.decline}
              </button>
            </section>
          )}

          {stage === "paying" && clientSecret && (
            <section className="medspa-offer" ref={offerRef}>
              <h2>{OFFER.headline}</h2>
              <p className="medspa-offer-body">{OFFER.body}</p>
              <PaymentForm
                clientSecret={clientSecret}
                submitLabel={OFFER.button}
                busyLabel={OFFER.buttonBusy}
                onPaid={onPaid}
              />
            </section>
          )}

          {stage === "intent" && <p className="medspa-notice">{OFFER.placeholderNotice}</p>}
          {stage === "declined" && <p className="medspa-notice">{OFFER.declinedNotice}</p>}
        </>
      )}
    </>
  );
}
