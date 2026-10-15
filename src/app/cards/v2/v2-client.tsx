"use client";

// /cards/v2 — details first, then the card and the walkthrough on one page, then the call.
//
// ‼️ READ THE PREVIEW_V2 BLOCK IN src/config/card-preview.ts FIRST. Every word on this screen
// lives there; this file only walks it.
//
// ‼️ TWO STAGES, AND THE SECOND NEVER SWAPS. The intake is one question per screen (typeform
// style, no headline). After it, the card and the live walkthrough sit on one page together, and
// the green button opens the chat UNDER them rather than replacing them: Matthew, 2026-10-15,
// "leave them both there, dont change the screen".
//
// ‼️ THE LEAD LANDS BEFORE THE CARD DOES. A partial POST fires the moment the email is in (name,
// clinic, email) and again when the phone lands, both through /api/cards/preview's partial path,
// so somebody who stops at the card is still a #hot-leads card with a number on it.

import { useEffect, useMemo, useRef, useState } from "react";

import {
  PREVIEW_INSIDE,
  PREVIEW_SCAN,
  PREVIEW_V2_CLOSE,
  PREVIEW_V2_FORM,
  PREVIEW_V2_INTAKE,
  PREVIEW_V2_PAGE,
  PREVIEW_V2_SCRIPT,
  copyFor,
  type IntakeStep,
} from "@/config/card-preview";
import { designByKey } from "@/config/card-designs";
import { formatPhoneUS } from "@/lib/clients/normalize";
import { clean, normalizePhone, validEmail, validName } from "@/lib/medspa/validate";
import { CardFront, ScanHand } from "../p/card-art";
import { PreviewChat } from "../p/preview-chat";

type Key = IntakeStep["key"];
type Details = Record<Key, string>;

export interface V2ClientProps {
  /** What the card says before they have typed a clinic name. */
  fallbackName: string;
  /** What a tokenised link already knows. Shown in the boxes, still confirmed by them. */
  prefill: Partial<Details>;
  reviewsHost: string | null;
  qrDataUrl: string;
  insideSrc: string;
  initialDesign: string;
  token: string | null;
}

/** The answer if it is acceptable, or the message saying what to fix. */
function check(key: Key, raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const value = clean(raw, key === "email" ? 160 : 120);
  switch (key) {
    case "firstName":
    case "lastName":
      return validName(value) ? { ok: true, value } : { ok: false, error: "Please type a name we can use." };
    case "businessName":
      return value.length >= 2
        ? { ok: true, value }
        : { ok: false, error: "Please type your clinic's name." };
    case "email":
      return validEmail(value)
        ? { ok: true, value: value.toLowerCase() }
        : { ok: false, error: "That does not look like an email address." };
    case "phone": {
      // ‼️ KEEP THE E.164 RESULT, DO NOT JUST TEST IT. The box shows (555) 555-5555 for the human;
      // the route and the CRM get +15555555555.
      const e164 = normalizePhone(value);
      return e164 ? { ok: true, value: e164 } : { ok: false, error: "Enter a 10 digit US mobile number." };
    }
  }
}

export function V2Client(props: V2ClientProps) {
  const steps = PREVIEW_V2_INTAKE;
  const [stage, setStage] = useState<"intake" | "page">("intake");
  const [index, setIndex] = useState(0);
  const [details, setDetails] = useState<Partial<Details>>({});
  const [draft, setDraft] = useState(() => props.prefill[steps[0].key] ?? "");
  const [error, setError] = useState<string | null>(null);

  const [insideLive, setInsideLive] = useState(false);
  const [wantsCustom, setWantsCustom] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const chatRef = useRef<HTMLDivElement | null>(null);
  const sentEmail = useRef(false);

  const design = useMemo(() => designByKey(props.initialDesign), [props.initialDesign]);
  const copy = useMemo(() => copyFor(design.copy), [design]);
  const step = steps[index];

  // The box takes the caret back on every question, so a desktop visitor never reaches for the mouse.
  useEffect(() => {
    if (stage === "intake") inputRef.current?.focus();
  }, [stage, index]);

  useEffect(() => {
    if (stage === "page") window.scrollTo({ top: 0 });
  }, [stage]);

  useEffect(() => {
    if (chatOpen) chatRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [chatOpen]);

  /** Fire and forget. The next question is already on screen; a failure costs the early card only. */
  function sendPartial(d: Partial<Details>) {
    void fetch("/api/cards/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...d, partial: true, variant: "v2", token: props.token }),
    }).catch(() => {});
  }

  function draftFor(i: number, d: Partial<Details>): string {
    const key = steps[i].key;
    const v = d[key] ?? props.prefill[key] ?? "";
    return key === "phone" ? formatPhoneUS(v) : v;
  }

  function commit() {
    const result = check(step.key, draft);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const next = { ...details, [step.key]: result.value };
    setDetails(next);
    setError(null);

    if (step.key === "email" && !sentEmail.current) {
      sentEmail.current = true;
      sendPartial(next);
    }
    if (index + 1 < steps.length) {
      setIndex(index + 1);
      setDraft(draftFor(index + 1, next));
      return;
    }
    // The last answer is the phone: one more partial carrying it, then the card.
    sendPartial(next);
    setStage("page");
  }

  function back() {
    if (index === 0) return;
    setError(null);
    setIndex(index - 1);
    setDraft(draftFor(index - 1, details));
  }

  function openChat(custom: boolean) {
    if (custom) setWantsCustom(true);
    setChatOpen(true);
  }

  // ── Stage one: the intake ─────────────────────────────────────────────────
  if (stage === "intake") {
    const last = index === steps.length - 1;
    return (
      <div className="v2-intake">
        <div
          className="v2-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={steps.length}
          aria-valuenow={index}
        >
          <span style={{ width: `${(index / steps.length) * 100}%` }} />
        </div>
        <p className="cd-open-eyebrow">{PREVIEW_V2_FORM.eyebrow}</p>

        <form
          key={step.key}
          className="v2-q"
          onSubmit={(e) => {
            e.preventDefault();
            commit();
          }}
          noValidate
        >
          <label className="v2-prompt" htmlFor="v2-input">
            <span className="v2-num">
              {index + 1}
              <span aria-hidden="true"> →</span>
            </span>
            {step.prompt}
          </label>
          <input
            id="v2-input"
            ref={inputRef}
            className="v2-input"
            type={step.key === "email" ? "email" : step.key === "phone" ? "tel" : "text"}
            inputMode={step.key === "phone" ? "tel" : step.key === "email" ? "email" : "text"}
            autoComplete={
              step.key === "firstName"
                ? "given-name"
                : step.key === "lastName"
                  ? "family-name"
                  : step.key === "businessName"
                    ? "organization"
                    : step.key === "email"
                      ? "email"
                      : "tel-national"
            }
            placeholder={step.placeholder}
            value={draft}
            aria-invalid={error ? true : undefined}
            onChange={(e) => {
              setDraft(step.key === "phone" ? formatPhoneUS(e.target.value) : e.target.value);
              setError(null);
            }}
          />
          {step.hint && !error && <p className="v2-hint">{step.hint}</p>}
          {error && (
            <p className="cd-error v2-error" role="alert">
              {error}
            </p>
          )}

          <div className="v2-actions">
            <button type="submit" className="cd-primary v2-ok" disabled={!draft.trim()}>
              {last ? PREVIEW_V2_FORM.last : PREVIEW_V2_FORM.next}
            </button>
            <span className="v2-enter">{PREVIEW_V2_FORM.enterHint}</span>
          </div>
        </form>

        {index > 0 && (
          <button type="button" className="cd-skip v2-back" onClick={back}>
            {PREVIEW_V2_FORM.back}
          </button>
        )}
      </div>
    );
  }

  // ── Stage two: the card and the walkthrough, together, then the chat ──────
  const clinicName = details.businessName || props.fallbackName;
  return (
    <div className="cp-screen v2-page">
      <section className="v2-section">
        <p className="cd-open-eyebrow">{PREVIEW_V2_PAGE.scanEyebrow}</p>
        <h1 className="cp-title">{PREVIEW_SCAN.title}</h1>
        <p className="cd-open-lede">{PREVIEW_SCAN.lede}</p>
        <div className="cp-stage">
          <div className="v2-card">
            <CardFront
              design={design}
              copy={copy}
              clinicName={clinicName}
              qrDataUrl={props.qrDataUrl}
              reviewsHost={props.reviewsHost}
            />
          </div>
          <ScanHand design={design} />
        </div>
        <p className="cp-note">{PREVIEW_SCAN.qrNote}</p>
      </section>

      <section className="v2-section">
        <p className="cd-open-eyebrow">{PREVIEW_V2_PAGE.insideEyebrow}</p>
        <h2 className="cp-title">{PREVIEW_INSIDE.title}</h2>
        <p className="cd-open-lede">{PREVIEW_INSIDE.lede}</p>
        <div className="cp-phone">
          <div className="cp-phone-screen">
            <iframe
              title={PREVIEW_INSIDE.title}
              src={props.insideSrc}
              loading="lazy"
              className="cp-frame"
              tabIndex={insideLive ? undefined : -1}
            />
            {!insideLive && (
              <button type="button" className="cp-veil" onClick={() => setInsideLive(true)}>
                <span className="cp-tap" style={{ background: design.accent, color: design.onAccent }}>
                  {PREVIEW_INSIDE.tap}
                </span>
              </button>
            )}
          </div>
        </div>
        {insideLive && <p className="cp-note v2-live">{PREVIEW_INSIDE.live}</p>}
      </section>

      {!chatOpen && (
        <div className="v2-cta">
          <button type="button" className="cd-primary" onClick={() => openChat(false)}>
            {PREVIEW_V2_PAGE.cta}
          </button>
          <p className="cd-open-foot">{PREVIEW_V2_PAGE.foot}</p>
          <button type="button" className="cp-mini" onClick={() => openChat(true)}>
            {PREVIEW_SCAN.customFree}
          </button>
        </div>
      )}

      {chatOpen && (
        <div ref={chatRef} className="v2-chat">
          <PreviewChat
            script={PREVIEW_V2_SCRIPT}
            known={{
              firstName: details.firstName,
              lastName: details.lastName,
              email: details.email,
            }}
            extra={{ phone: details.phone ?? "", businessName: details.businessName ?? "" }}
            variant="v2"
            close={PREVIEW_V2_CLOSE}
            token={props.token}
            designKey={design.key}
            wantsCustom={wantsCustom}
          />
        </div>
      )}
    </div>
  );
}
