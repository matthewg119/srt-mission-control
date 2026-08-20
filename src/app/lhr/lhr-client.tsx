"use client";

// The interactive half of /LHR: the hero button, the opt-in form, the gated video and
// the card that appears once the video has actually been watched.
//
// One client island rather than four, because every stage shares the same piece of
// state and threading it through separate components would mean lifting it into a
// context for no gain. Same shape as webflow-aivisibility/funnel-client.tsx.
//
// ‼️ THE STAGE ORDER IS INVERTED RELATIVE TO EVERY OTHER SRT FUNNEL, DELIBERATELY.
//
// On /webflow-Aivisibility the video plays first and reaching ctaRevealSeconds is what
// reveals the opt-in form. Here the FORM COMES FIRST and the video is what they get for
// filling it in, which is what the reference page Matthew specified does.
//
// Consequences worth knowing before editing:
//   - `Lead` fires BEFORE `ViewContent`, not after. That is correct for this funnel and
//     is not a bug to "fix" by reordering: the lead exists the moment the form posts.
//   - GatedVSL's `onCtaReveal` no longer reveals the form, it reveals the NEXT STEP.
//   - GatedVSL fires onCtaReveal immediately when videoUrl is null, so with the video
//     env unset the whole funnel still runs end to end and is testable today.

import { useEffect, useRef, useState } from "react";
import { GatedVSL } from "@/components/gated-vsl";
import { HERO, NEXT_STEP, OPTIN, VIDEO, VSL } from "@/config/lhr-funnel";
import { fieldErrorMessage, validateOptin, type FieldError } from "@/lib/medspa/validate";
import { formatPhoneUS } from "@/lib/clients/normalize";
import { readAttribution, track } from "@/lib/medspa/pixel";

type Stage = "hero" | "optin" | "watching" | "revealed";

export function LhrClient() {
  const [stage, setStage] = useState<Stage>("hero");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [honeypot, setHoneypot] = useState("");
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const renderedAt = useRef(Date.now());
  const optinRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLDivElement | null>(null);
  const nextRef = useRef<HTMLDivElement | null>(null);

  // PageView is NOT fired here. The base pixel snippet in layout.tsx fires it
  // unconditionally, which is deliberate and matches every srtagency funnel: PageView
  // is the pixel's baseline and is what sets _fbp in the first place. The attribution
  // gate in track() applies to the CONVERSION events below, which is what the ad sets
  // optimize on and what would otherwise be inflated by direct traffic.

  // Move the viewer to whatever just appeared.
  useEffect(() => {
    const target =
      stage === "optin" ? optinRef : stage === "watching" ? videoRef : stage === "revealed" ? nextRef : null;
    target?.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [stage]);

  /** Playback actually reached VSL.ctaRevealSeconds, or there is no video to reach it in. */
  function onCtaReveal() {
    track("CompleteRegistration");
    setStage((s) => (s === "watching" ? "revealed" : s));
  }

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
      const res = await fetch("/api/lhr/optin", {
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
        setFormMessage(data.message ?? OPTIN.genericError);
        setBusy(false);
        return;
      }

      // Fires only for ad-attributed visitors, which is what the ad set optimizes on.
      track("Lead");
      setBusy(false);
      setStage("watching");
      track("ViewContent");
    } catch {
      setFormMessage(OPTIN.networkError);
      setBusy(false);
    }
  }

  const errorFor = (f: FieldError) => (errors.includes(f) ? fieldErrorMessage(f) : null);

  return (
    <>
      {stage === "hero" && (
        <button className="lhr-btn lhr-btn-hero" type="button" onClick={() => setStage("optin")}>
          {HERO.cta}
        </button>
      )}

      {stage === "optin" && (
        <div className="lhr-card" ref={optinRef}>
          <h2>{OPTIN.headline}</h2>
          <p>{OPTIN.body}</p>

          <form onSubmit={submitOptin} noValidate>
            <div className="lhr-field">
              <label className="lhr-label" htmlFor="lhr-name">
                {OPTIN.fields.name}
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
                {OPTIN.fields.email}
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
                {OPTIN.fields.phone}
              </label>
              <input
                id="lhr-phone"
                className="lhr-input"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder={OPTIN.fields.phonePlaceholder}
                value={phone}
                // Live-formatted, same as every other funnel. The route behind this
                // stores E.164 via validateOptin, so this is the typing half only: a
                // number that reads back as (336) 833-2303 while it is being entered is
                // one the visitor can check, and a typed +1 is absorbed rather than
                // doubled.
                onChange={(e) => setPhone(formatPhoneUS(e.target.value))}
                disabled={busy}
                aria-invalid={errors.includes("phone")}
              />
              {errorFor("phone") && <p className="lhr-error">{errorFor("phone")}</p>}
            </div>

            {/* Honeypot. Off-screen rather than display:none, and never autofilled. */}
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

            <button className="lhr-btn" type="submit" disabled={busy}>
              {busy ? OPTIN.submitBusy : OPTIN.submit}
            </button>

            {formMessage && (
              <p className="lhr-error" role="alert">
                {formMessage}
              </p>
            )}
            <p className="lhr-reassure">{OPTIN.reassure}</p>
          </form>
        </div>
      )}

      {(stage === "watching" || stage === "revealed") && (
        <div ref={videoRef}>
          <GatedVSL
            videoUrl={VSL.url}
            poster={VSL.poster}
            onCtaReveal={onCtaReveal}
            ctaRevealSeconds={VSL.ctaRevealSeconds}
            allowScrub={VSL.allowScrub}
            resumeMode={VSL.resumeMode}
            unmuteLabel={VIDEO.unmuteLabel}
            playLabel={VIDEO.playLabel}
            placeholderTitle={VIDEO.placeholderTitle}
            placeholderBody={VIDEO.placeholderBody}
          />
        </div>
      )}

      {stage === "revealed" && (
        <div className="lhr-card" ref={nextRef}>
          <h2>{NEXT_STEP.headline}</h2>
          {/*
            NEXT_STEP.href is tri-state on purpose. With no destination configured this
            renders as text and stops, rather than as a button pointing nowhere: a
            promised link that does not exist is discovered by the prospect right after
            the video, when nothing can be done about it. See config/lhr-funnel.ts.
          */}
          {NEXT_STEP.href ? (
            <>
              <p>{NEXT_STEP.body}</p>
              <a className="lhr-btn lhr-btn-link" href={NEXT_STEP.href}>
                {NEXT_STEP.label}
              </a>
            </>
          ) : (
            <p style={{ marginBottom: 0 }}>{NEXT_STEP.bodyNoLink}</p>
          )}
        </div>
      )}
    </>
  );
}
