"use client";

// The interactive half of /LHR: the hero button and the opt-in modal it opens.
//
// The video is NOT here any more. A qualified opt-in navigates to /lhr/training, which
// is a white page carrying the VSL and the booking calendar. This component's only job
// is to decide whether someone is a clinic owner and, if so, capture them.
//
// THE QUALIFIER IS THE FIRST FIELD ON PURPOSE. Someone who does not own a clinic should
// find that out before typing their phone number, not after. Picking the No option
// removes the submit button rather than disabling it, so there is nothing to press and
// nothing is posted; ownsQualifyingClinic() re-runs on the server, because a modal is a
// courtesy to a real person and never a gate.

import { useCallback, useEffect, useRef, useState } from "react";
import { HERO, OPTIN, OWNS_NO, TRAINING_PATH } from "@/config/lhr-funnel";
import { ownsQualifyingClinic } from "@/lib/lhr/qualify";
import { fieldErrorMessage, validateOptin, type FieldError } from "@/lib/medspa/validate";
import { formatPhoneUS } from "@/lib/clients/normalize";
import { readAttribution, track } from "@/lib/medspa/pixel";

export function LhrClient() {
  const [open, setOpen] = useState(false);

  const [owns, setOwns] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [ownsError, setOwnsError] = useState(false);
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const renderedAt = useRef(Date.now());
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const firstFieldRef = useRef<HTMLSelectElement | null>(null);
  const openerRef = useRef<HTMLButtonElement | null>(null);

  const declined = owns === OWNS_NO;
  const qualified = ownsQualifyingClinic(owns);

  // PageView is NOT fired here. The base pixel snippet in layout.tsx fires it
  // unconditionally, which is deliberate and matches every srtagency funnel: PageView is
  // the pixel's baseline and is what sets _fbp in the first place. The attribution gate
  // in track() applies to the CONVERSION events, which is what the ad sets optimize on.

  const close = useCallback(() => {
    setOpen(false);
    // Focus goes back to the button that opened it, or a keyboard user is dropped at the
    // top of the document with no idea where they are.
    openerRef.current?.focus();
  }, []);

  // Escape closes, and the background does not scroll underneath the modal. Both are
  // restored on unmount, so a fast open/close cannot leave the page permanently locked.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    window.setTimeout(() => firstFieldRef.current?.focus(), 50);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, close]);

  async function submitOptin(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setFormMessage(null);

    if (!qualified) {
      setOwnsError(true);
      return;
    }
    setOwnsError(false);

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
      const res = await fetch("/api/lhr/optin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          owns,
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
        setFormMessage(data.message ?? OPTIN.genericError);
        setBusy(false);
        return;
      }

      // Fires only for ad-attributed visitors, which is what the ad set optimizes on.
      track("Lead");
      // Full navigation, never a next/link: a 30x during an RSC prefetch under the
      // srtagency.com rewrite blanks the page. Relative, so it lands on whichever host
      // they are already on rather than bouncing through the apex 307. Busy stays true
      // so the button cannot be pressed twice while the browser is navigating.
      window.location.assign(TRAINING_PATH);
    } catch {
      setFormMessage(OPTIN.networkError);
      setBusy(false);
    }
  }

  const errorFor = (f: FieldError) => (errors.includes(f) ? fieldErrorMessage(f) : null);

  return (
    <>
      <button
        ref={openerRef}
        className="lhr-btn lhr-btn-hero"
        type="button"
        onClick={() => setOpen(true)}
      >
        {HERO.cta}
      </button>

      {open && (
        <div
          className="lhr-modal-backdrop"
          // Only a click on the backdrop ITSELF closes. Without the target check, a drag
          // that starts inside the form and releases outside it closes the modal and
          // throws away everything they typed.
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div
            className="lhr-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="lhr-modal-title"
            ref={dialogRef}
          >
            <button
              type="button"
              className="lhr-modal-close"
              onClick={close}
              aria-label={OPTIN.close}
            >
              &times;
            </button>

            <h2 id="lhr-modal-title" className="lhr-modal-title">
              {OPTIN.headline}
            </h2>

            <form onSubmit={submitOptin} noValidate>
              <div className="lhr-field">
                <label className="lhr-label" htmlFor="lhr-owns">
                  {OPTIN.fields.owns} <span aria-hidden="true">*</span>
                </label>
                <select
                  id="lhr-owns"
                  ref={firstFieldRef}
                  className="lhr-input lhr-select"
                  value={owns}
                  onChange={(e) => {
                    setOwns(e.target.value);
                    setOwnsError(false);
                  }}
                  disabled={busy}
                  aria-invalid={ownsError}
                >
                  <option value="">{OPTIN.fields.ownsPlaceholder}</option>
                  {OPTIN.ownsOptions.map((o) => (
                    <option key={o} value={o}>
                      {o}
                    </option>
                  ))}
                </select>
                {ownsError && <p className="lhr-error">{OPTIN.ownsError}</p>}
              </div>

              {/*
                Everything below the qualifier is hidden once they say no. The fields are
                not merely disabled: leaving a phone input on screen after telling someone
                the training is not for them invites them to fill it in anyway.
              */}
              {declined ? (
                <p className="lhr-dq">{OPTIN.disqualified}</p>
              ) : (
                <>
                  <div className="lhr-field">
                    <label className="lhr-label" htmlFor="lhr-name">
                      {OPTIN.fields.name} <span aria-hidden="true">*</span>
                    </label>
                    <input
                      id="lhr-name"
                      className="lhr-input"
                      type="text"
                      autoComplete="name"
                      placeholder={OPTIN.fields.namePlaceholder}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      disabled={busy}
                      aria-invalid={errors.includes("name")}
                    />
                    {errorFor("name") && <p className="lhr-error">{errorFor("name")}</p>}
                  </div>

                  <div className="lhr-field">
                    <label className="lhr-label" htmlFor="lhr-email">
                      {OPTIN.fields.email} <span aria-hidden="true">*</span>
                    </label>
                    <input
                      id="lhr-email"
                      className="lhr-input"
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      spellCheck={false}
                      placeholder={OPTIN.fields.emailPlaceholder}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={busy}
                      aria-invalid={errors.includes("email")}
                    />
                    {errorFor("email") && <p className="lhr-error">{errorFor("email")}</p>}
                  </div>

                  <div className="lhr-field">
                    <label className="lhr-label" htmlFor="lhr-phone">
                      {OPTIN.fields.phone} <span aria-hidden="true">*</span>
                    </label>
                    <input
                      id="lhr-phone"
                      className="lhr-input"
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      placeholder={OPTIN.fields.phonePlaceholder}
                      value={phone}
                      // Live-formatted, same as every other funnel. The route stores
                      // E.164 via validateOptin, so this is the typing half only: a
                      // number that reads back as (336) 833-2303 while it is being
                      // entered is one the visitor can check, and a typed +1 is absorbed
                      // rather than doubled.
                      onChange={(e) => setPhone(formatPhoneUS(e.target.value))}
                      disabled={busy}
                      aria-invalid={errors.includes("phone")}
                    />
                    {errorFor("phone") && <p className="lhr-error">{errorFor("phone")}</p>}
                  </div>

                  {/* Honeypot. Off-screen rather than display:none, never autofilled. */}
                  <div className="lhr-hp" aria-hidden="true">
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

                  <label className="lhr-consent">
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(e) => setConsent(e.target.checked)}
                      disabled={busy}
                    />
                    <span>{OPTIN.consent}</span>
                  </label>
                  {errorFor("consent") && <p className="lhr-error">{errorFor("consent")}</p>}

                  <button className="lhr-btn lhr-btn-modal" type="submit" disabled={busy}>
                    {busy ? OPTIN.submitBusy : OPTIN.submit}
                  </button>

                  {formMessage && (
                    <p className="lhr-error" role="alert">
                      {formMessage}
                    </p>
                  )}
                  <p className="lhr-reassure">{OPTIN.reassure}</p>
                </>
              )}
            </form>
          </div>
        </div>
      )}
    </>
  );
}
