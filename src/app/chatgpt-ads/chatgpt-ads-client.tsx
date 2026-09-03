"use client";

// The /chatgpt-ads funnel.
//
// SHAPE: a hero that stays put, and a card under it that swaps. The hero is the score, the
// video and the offer line, and it is the reason the person is here, so it does not scroll
// away or get replaced when the questions start. Everything else is one card driven by a
// stage machine.
//
// ‼️ EXPLICIT STAGES, NEVER A +1 WALK. The path forks at revenue and rejoins nowhere: the
// under $10k branch ends on its own screen and the qualified branch ends on three different
// ones. srt-agwb/funnel.js and /audit both learned that a counter cannot express a fork
// without lying about where it is, and both replaced one with a routing table.
//
// ‼️ THE LEAD IS POSTED AT THE INTAKE, NOT AT THE END. Somebody who answers three questions
// and closes the tab is already a lead with a phone number. Same doctrine as the email step
// in funnel.js, and the reason the intake is three fields and not one.
//
// ‼️ REVIEW MODE, AND THE LOAD-BEARING HALF IS THE SUPPRESSION. On localhost and any
// *.vercel.app preview every post becomes a console.info. Without it, walking this page on a
// preview URL writes real contacts, fires a real 🚨 @channel alert at the whole team, and
// starts a real 60 second callback SLA on a lead that does not exist. It is ONE early return
// in post(), because a gate scattered across five call sites has one call site that is wrong.
// ?live=1 opts back in for a deliberate end to end.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Script from "next/script";
import {
  ALL_FAQS,
  BOOKING,
  BRANCH_B_QUESTIONS,
  CALLING,
  CALL_SECONDS,
  FALLBACK,
  HERO,
  INTAKE,
  LOOM_EMBED_URL,
  OFFER_LINE,
  PATHS,
  PATH_FAQS,
  REVENUE_QUESTION,
  SELF,
  WEDGE,
  branchFor,
  type Faq,
  type OptionDef,
  type QuestionDef,
} from "@/config/chatgpt-ads";
import { clean, normalizePhone, validEmail } from "@/lib/medspa/validate";
import { normalizeTarget } from "@/lib/scan/normalize";
import { formatPhoneUS } from "@/lib/clients/normalize";
import { PROMPT_SAMPLE, type ReportParams } from "@/lib/chatgpt-ads/params";

// ---------------------------------------------------------------------------
// Look. Black and reef, the same tokens /onboardingfree and the marketing site use.
//
// The source spec asked for navy #0A1F44 and teal #00B4B4. That was overruled: the site was
// repainted pure black on 2026-08-26 and this page is reached from a report on the same
// brand, one tap earlier. A visitor who lands on a different-coloured page assumes they have
// been handed off to somebody else, which is the opposite of what the hero is trying to do.
// ---------------------------------------------------------------------------

const REEF = "#00C9A7";
const CARD = "rounded-xl bg-white/5 p-6 sm:p-8";
const CTA =
  "w-full rounded-lg bg-[#00C9A7] px-6 py-3.5 font-bold text-[#04252b] disabled:opacity-50";
const INPUT_BASE =
  "w-full rounded-lg border bg-white/5 px-4 py-3 text-white placeholder-white/30 outline-none focus:border-[#00C9A7] ";

function inputClass(hasError: boolean): string {
  return INPUT_BASE + (hasError ? "border-red-400/60" : "border-white/15");
}

function optionClass(selected: boolean): string {
  return (
    "block w-full rounded-xl border px-4 py-4 text-left text-base font-semibold transition-colors " +
    (selected ? "border-[#00C9A7] bg-[#00C9A7]/15" : "border-white/15 bg-white/5 hover:border-white/30")
  );
}

type Stage =
  | "intake"
  | "questions"
  | "wedge"
  | "paths"
  | "calling"
  | "fallback"
  | "booking"
  | "booked"
  | "self";

interface BookingTarget {
  live: boolean;
  url: string | null;
}

interface Slot {
  startTime: string;
  schedulingUrl: string;
}

interface SlotsResponse {
  reason: "ok" | "unconfigured" | "error";
  bookingUrl: string | null;
  timeZone?: string;
  slots?: Slot[] | null;
  buckets?: {
    today: { morning: Slot[]; afternoon: Slot[] };
    tomorrow: { morning: Slot[]; afternoon: Slot[] };
  };
}

export function ChatgptAdsFunnel({
  params,
  utm,
  callerId,
  booking,
}: {
  params: ReportParams;
  utm: { source: string; medium: string; campaign: string; content: string };
  callerId: string | null;
  booking: { fifteenMin: BookingTarget; install: BookingTarget };
}) {
  const [stage, setStage] = useState<Stage>("intake");
  const [identity, setIdentity] = useState({ website: "", email: "", phone: "" });
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [handoffUrl, setHandoffUrl] = useState<string | null>(null);
  const [shownCallerId, setShownCallerId] = useState<string | null>(callerId);

  const [trap, setTrap] = useState("");
  // A ref, not state, so a re-render cannot reset the clock the time trap is measured from.
  const renderedAt = useRef(Date.now());

  const branch = useMemo(() => {
    const rev = answers.revenue;
    return typeof rev === "string" ? branchFor(rev) : null;
  }, [answers.revenue]);

  const questions: QuestionDef[] = useMemo(
    () => (branch === "under_10k" ? [REVENUE_QUESTION] : [REVENUE_QUESTION, ...BRANCH_B_QUESTIONS]),
    [branch]
  );

  // -------------------------------------------------------------------------
  // Review mode
  // -------------------------------------------------------------------------
  const live = useRef(true);
  useEffect(() => {
    const h = window.location.hostname;
    const isReviewHost = h === "localhost" || h === "127.0.0.1" || /\.vercel\.app$/.test(h);
    const optedIn = new URLSearchParams(window.location.search).get("live") === "1";
    live.current = !isReviewHost || optedIn;
  }, []);

  const post = useCallback(
    async (stageName: string, extra: Record<string, unknown> = {}): Promise<Record<string, unknown> | null> => {
      const payload = {
        stage: stageName,
        identity,
        answers,
        report: {
          score: params.score,
          city: params.city,
          business: params.business,
          competitor: params.competitor,
          user_showed: params.userShowed,
          comp_showed: params.compShowed,
          r: params.reportSlug,
        },
        utm,
        sourceUrl: typeof window === "undefined" ? "" : window.location.href,
        renderedAt: renderedAt.current,
        company_url_hp: trap,
        ...extra,
      };

      if (!live.current) {
        console.info("[chatgpt-ads review] suppressed post", payload);
        // Enough of a shape for the caller to keep walking the funnel on a preview.
        return { ok: true, suppressed: true };
      }

      try {
        const res = await fetch("/api/chatgpt-ads/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          keepalive: true,
        });
        return (await res.json()) as Record<string, unknown>;
      } catch {
        return null;
      }
    },
    [identity, answers, params, utm, trap]
  );

  // -------------------------------------------------------------------------
  // Intake
  // -------------------------------------------------------------------------
  async function submitIntake() {
    const found: Record<string, string> = {};
    const website = clean(identity.website, 200);
    const email = clean(identity.email, 254).toLowerCase();
    const phone = clean(identity.phone, 40);

    // A bare word walks straight past a "required" check and becomes a lead with a website
    // nobody can ever scan. normalizeTarget is the same parser the scanner uses, so the two
    // cannot disagree about what a readable address is.
    if (!website || !normalizeTarget(website).ok) found.website = "That does not look like a web address.";
    if (!validEmail(email)) found.email = "That email does not look right.";
    if (!normalizePhone(phone)) found.phone = "Enter a 10 digit US mobile number.";
    if (Object.keys(found).length) {
      setErrors(found);
      return;
    }

    setSaving(true);
    setSaveError(null);
    const res = await post("lead");
    setSaving(false);
    if (!res) {
      setSaveError("That did not send. Check your connection and try once more.");
      return;
    }
    setStage("questions");
    setStep(0);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // -------------------------------------------------------------------------
  // Questions
  // -------------------------------------------------------------------------
  function setAnswer(key: string, value: unknown) {
    setAnswers((prev) => ({ ...prev, [key]: value }));
    setErrors((prev) => (prev[key] ? { ...prev, [key]: "" } : prev));
  }

  const advanceFrom = useCallback(
    (key: string, value: unknown, nextAnswers: Record<string, unknown>) => {
      // The fork. Everything else is "next question, or out of questions".
      if (key === "revenue" && typeof value === "string" && branchFor(value) === "under_10k") {
        void post("wedge", { answers: nextAnswers });
        setStage("wedge");
        window.scrollTo({ top: 0 });
        return;
      }
      const total = key === "revenue" ? 1 + BRANCH_B_QUESTIONS.length : questions.length;
      if (step + 1 >= total) {
        void post("answers", { answers: nextAnswers });
        setStage("paths");
        window.scrollTo({ top: 0 });
        return;
      }
      setStep((s) => s + 1);
      window.scrollTo({ top: 0 });
    },
    [post, questions.length, step]
  );

  function answerAndAdvance(key: string, value: unknown) {
    const next = { ...answers, [key]: value };
    setAnswers(next);
    // A short beat so the tap registers visually before the screen changes. Same feel as the
    // static funnels in srt-agwb and as /onboardingfree.
    window.setTimeout(() => advanceFrom(key, value, next), 200);
  }

  function continueMulti(q: QuestionDef) {
    const picked = Array.isArray(answers[q.key]) ? (answers[q.key] as string[]) : [];
    if (q.required && !picked.length) {
      setErrors({ [q.key]: "Pick at least one." });
      return;
    }
    advanceFrom(q.key, picked, answers);
  }

  // -------------------------------------------------------------------------
  // Paths
  // -------------------------------------------------------------------------
  async function pickCallMeNow() {
    setSaving(true);
    const res = await post("call_me_now");
    setSaving(false);
    if (res && typeof res.callerId === "string") setShownCallerId(res.callerId);
    setStage("calling");
    window.scrollTo({ top: 0 });
  }

  async function pickSelfIntake() {
    setSaving(true);
    const res = await post("self_intake");
    setSaving(false);
    if (res && typeof res.handoffUrl === "string") setHandoffUrl(res.handoffUrl);
    setStage("self");
    window.scrollTo({ top: 0 });
  }

  // -------------------------------------------------------------------------
  // Booking, and the Calendly confirmation
  //
  // ‼️ THE ORIGIN CHECK IS NOT OPTIONAL. Without it any frame or opener can post a fake
  // event_scheduled and mark a lead booked, which writes a booking into Slack that nobody
  // made and, on the pages that carry a pixel, fires a paid conversion. Copied verbatim in
  // spirit from srt-agwb/funnel.js, which carries the same warning.
  // -------------------------------------------------------------------------
  const [bookedLabel, setBookedLabel] = useState<string | null>(null);
  const bookedOnce = useRef(false);
  // The slot the visitor tapped, so the booked beacon can carry the machine-readable start
  // time and not only the label rendered for their eyes. A ref because the Calendly listener
  // reads it from a closure and must see the latest value, not the one at subscribe time.
  const pendingSlot = useRef<Slot | null>(null);

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== "https://calendly.com") return;
      const d = e.data as { event?: string; payload?: { event?: { uri?: string } } };
      if (!d || d.event !== "calendly.event_scheduled") return;
      if (bookedOnce.current) return;
      bookedOnce.current = true;
      void post("booked_call", {
        booked: {
          startTime: pendingSlot.current?.startTime ?? "",
          startTimeLabel: bookedLabel ?? "",
          eventUri: d.payload?.event?.uri ?? "",
        },
      }).then(() => {
        setStage("booked");
        window.scrollTo({ top: 0 });
      });
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [post, bookedLabel]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------
  const heading = params.score !== null
    ? HERO.headingWithScore.replace("{score}", String(params.score))
    : HERO.headingGeneric;

  const gapLine =
    params.userShowed !== null && params.compShowed !== null && params.competitor
      ? HERO.gapLine
          .replace("{user}", String(params.userShowed))
          .replace("{competitor}", params.competitor)
          .replace("{comp}", String(params.compShowed))
      : null;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-12">
      <Hero heading={heading} gapLine={gapLine} showScrollCue={stage === "intake"} />

      <div id="start" className="mt-10 scroll-mt-6">
        {stage === "intake" && (
          <IntakeCard
            identity={identity}
            errors={errors}
            saving={saving}
            saveError={saveError}
            onChange={(k, v) => {
              setIdentity((p) => ({ ...p, [k]: v }));
              setErrors((p) => (p[k] ? { ...p, [k]: "" } : p));
            }}
            onSubmit={submitIntake}
          />
        )}

        {stage === "questions" && (
          <QuestionCard
            q={questions[step] as QuestionDef}
            step={step}
            // The bar counts the LONG path until they tell us otherwise. Showing "1 of 1" on
            // the revenue screen and then jumping to "2 of 6" would read as the funnel
            // growing while they answer it.
            total={branch === "under_10k" ? 1 : 1 + BRANCH_B_QUESTIONS.length}
            answers={answers}
            errors={errors}
            onPick={answerAndAdvance}
            onChange={setAnswer}
            onContinue={continueMulti}
            onBack={step > 0 ? () => setStep((s) => Math.max(0, s - 1)) : null}
          />
        )}

        {stage === "wedge" && (
          <WedgeCard target={booking.install} onOpen={() => setStage("booking")} />
        )}

        {stage === "paths" && (
          <PathsCard
            saving={saving}
            onCall={pickCallMeNow}
            onBook={() => {
              setStage("booking");
              window.scrollTo({ top: 0 });
            }}
            onSelf={pickSelfIntake}
          />
        )}

        {stage === "calling" && (
          <CallingCard
            callerId={shownCallerId}
            email={identity.email}
            live={live}
            onTimeout={() => setStage("fallback")}
            onCancel={() => setStage("booking")}
          />
        )}

        {stage === "fallback" && (
          <BookingCard
            heading={FALLBACK.heading}
            body={FALLBACK.body}
            target={booking.fifteenMin}
            identity={identity}
            pendingSlot={pendingSlot}
            onSlotLabel={setBookedLabel}
          />
        )}

        {stage === "booking" && (
          <BookingCard
            heading={BOOKING.heading}
            body={BOOKING.speedLine}
            target={branch === "under_10k" ? booking.install : booking.fifteenMin}
            kind={branch === "under_10k" ? "install" : "15min"}
            identity={identity}
            pendingSlot={pendingSlot}
            onSlotLabel={setBookedLabel}
          />
        )}

        {stage === "booked" && (
          <div className={CARD}>
            <h2 className="mb-3 text-2xl font-bold">{BOOKING.bookedHeading}</h2>
            <p className="text-white/70">{BOOKING.bookedBody}</p>
          </div>
        )}

        {stage === "self" && <SelfCard url={handoffUrl} />}
      </div>

      {/* Off screen rather than display:none, and never autofilled. A hidden input is the
          first thing a smart bot skips. */}
      <input
        type="text"
        name="company_url_hp"
        value={trap}
        onChange={(e) => setTrap(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="absolute left-[-9999px] h-0 w-0 opacity-0"
      />

      <FaqList items={ALL_FAQS} heading="Questions people ask before they start" />

      <p className="mt-10 text-center text-xs text-white/35">
        SRT Agency LLC, Search Retrieval Tactics. We work upstream of PHI. Nothing here is
        medical advice.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hero
//
// TAP TO PLAY, NO AUTOPLAY, and the iframe is not even requested until the poster is tapped.
// Two reasons, and the second is the load-bearing one: a video that starts talking by itself
// on a phone in a treatment room gets closed, and most visitors on a link like this never
// press play at all, so mounting the embed on load costs every one of them the request.
// ---------------------------------------------------------------------------

function Hero({
  heading,
  gapLine,
  showScrollCue,
}: {
  heading: string;
  gapLine: string | null;
  showScrollCue: boolean;
}) {
  const [playing, setPlaying] = useState(false);

  return (
    <header className="text-center">
      <div className="mx-auto w-full max-w-[720px]">
        {LOOM_EMBED_URL ? (
          <div className="relative w-full overflow-hidden rounded-xl bg-black" style={{ aspectRatio: "16 / 9" }}>
            {playing ? (
              <iframe
                src={LOOM_EMBED_URL}
                title="Your AI visibility walkthrough"
                allow="fullscreen; picture-in-picture"
                allowFullScreen
                className="absolute inset-0 h-full w-full"
              />
            ) : (
              <button
                type="button"
                onClick={() => setPlaying(true)}
                aria-label="Play the walkthrough"
                className="absolute inset-0 flex h-full w-full items-center justify-center bg-gradient-to-b from-white/5 to-black"
              >
                <span
                  className="flex h-16 w-16 items-center justify-center rounded-full sm:h-20 sm:w-20"
                  style={{ backgroundColor: REEF }}
                >
                  <span
                    className="ml-1 block h-0 w-0"
                    style={{
                      borderTop: "12px solid transparent",
                      borderBottom: "12px solid transparent",
                      borderLeft: "20px solid #04252b",
                    }}
                  />
                </span>
              </button>
            )}
          </div>
        ) : (
          // Tri-state again: no video configured is a real state and it renders a sentence,
          // not an empty black box that looks like a failed load.
          <div className="rounded-xl border border-white/10 bg-white/5 p-6 text-sm text-white/60">
            {HERO.noVideo}
          </div>
        )}
      </div>

      <h1 className="mt-8 text-3xl font-bold leading-tight sm:text-4xl">{heading}</h1>
      <p className="mx-auto mt-4 max-w-xl text-base text-white/70 sm:text-lg">{HERO.sub}</p>
      {gapLine && <p className="mt-3 text-sm text-white/50">{gapLine}</p>}

      {showScrollCue && (
        <a href="#start" className="mt-6 inline-flex flex-col items-center text-sm text-white/50 hover:text-white">
          <span>{HERO.scrollCue}</span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true" className="mt-1">
            <path d="M12 5v14M5 12l7 7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
      )}
    </header>
  );
}

// ---------------------------------------------------------------------------
// Intake
// ---------------------------------------------------------------------------

function IntakeCard({
  identity,
  errors,
  saving,
  saveError,
  onChange,
  onSubmit,
}: {
  identity: { website: string; email: string; phone: string };
  errors: Record<string, string>;
  saving: boolean;
  saveError: string | null;
  onChange: (k: "website" | "email" | "phone", v: string) => void;
  onSubmit: () => void;
}) {
  return (
    <form
      className={CARD}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      noValidate
    >
      <h2 className="mb-2 text-xl font-bold sm:text-2xl">{INTAKE.heading}</h2>
      <p className="mb-6 text-sm text-white/60">{INTAKE.body}</p>

      <div className="space-y-5">
        <Labelled label={INTAKE.website} error={errors.website}>
          <input
            type="text"
            inputMode="url"
            autoComplete="url"
            placeholder="yourclinic.com"
            className={inputClass(!!errors.website)}
            value={identity.website}
            onChange={(e) => onChange("website", e.target.value)}
          />
        </Labelled>
        <Labelled label={INTAKE.email} error={errors.email}>
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="you@yourspa.com"
            className={inputClass(!!errors.email)}
            value={identity.email}
            onChange={(e) => onChange("email", e.target.value)}
          />
        </Labelled>
        <Labelled label={INTAKE.phone} error={errors.phone}>
          <input
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            maxLength={14}
            placeholder="(336) 833-2303"
            className={inputClass(!!errors.phone)}
            value={identity.phone}
            // Live formatted so a country code they type themselves is absorbed rather
            // than kept, which is the rule on every SRT funnel.
            onChange={(e) => onChange("phone", formatPhoneUS(e.target.value))}
          />
        </Labelled>
      </div>

      {saveError && <p className="mt-5 text-sm text-red-300">{saveError}</p>}

      <button type="submit" disabled={saving} className={`mt-8 ${CTA}`}>
        {saving ? "Sending" : INTAKE.cta}
      </button>
      <p className="mt-4 text-xs text-white/40">{INTAKE.fine}</p>
    </form>
  );
}

function Labelled({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium">{label}</label>
      {children}
      {error && <p className="mt-1.5 text-xs text-red-300">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

function QuestionCard({
  q,
  step,
  total,
  answers,
  errors,
  onPick,
  onChange,
  onContinue,
  onBack,
}: {
  q: QuestionDef;
  step: number;
  total: number;
  answers: Record<string, unknown>;
  errors: Record<string, string>;
  onPick: (key: string, value: unknown) => void;
  onChange: (key: string, value: unknown) => void;
  onContinue: (q: QuestionDef) => void;
  onBack: (() => void) | null;
}) {
  // The one option that carries a second half. Held here rather than in the parent because
  // nothing outside this screen cares which option is mid-reveal.
  const [revealing, setRevealing] = useState<OptionDef | null>(null);

  useEffect(() => {
    setRevealing(null);
  }, [q.key]);

  const picked = answers[q.key];
  const multi = Array.isArray(picked) ? (picked as string[]) : [];

  return (
    <div className={CARD}>
      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between text-xs text-white/50">
          <span>SRT</span>
          <span>
            {Math.min(step + 1, total)} of {total}
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${((step + 1) / total) * 100}%`, backgroundColor: REEF }}
          />
        </div>
      </div>

      <h2 className="mb-2 text-xl font-bold sm:text-2xl">{q.title}</h2>
      {q.help && <p className="mb-6 text-sm text-white/55">{q.help}</p>}

      {q.kind === "choice" ? (
        <div className="flex flex-col gap-3">
          {q.options.map((o) => (
            <div key={o.value}>
              <button
                type="button"
                className={optionClass(picked === o.value || revealing?.value === o.value)}
                onClick={() => {
                  if (o.reveal) {
                    // Do NOT advance yet. Half an answer is worse than no answer here: the
                    // Slack card would say "on a website builder" with no builder named,
                    // which is the exact ambiguity Q6 was added to remove.
                    setRevealing(o);
                    onChange(q.key, o.value);
                    return;
                  }
                  setRevealing(null);
                  onPick(q.key, o.value);
                }}
              >
                {o.label}
              </button>

              {revealing?.value === o.value && o.reveal && (
                <div className="mt-3 rounded-xl border border-white/10 bg-black/30 p-4">
                  <label className="mb-1.5 block text-sm font-medium">{o.reveal.label}</label>
                  <select
                    className={inputClass(false)}
                    value={String(answers[o.reveal.key] ?? "")}
                    onChange={(e) => onChange(o.reveal!.key, e.target.value)}
                  >
                    <option value="">Choose one</option>
                    {o.reveal.options.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className={`mt-4 ${CTA}`}
                    disabled={!answers[o.reveal.key]}
                    onClick={() => onPick(q.key, o.value)}
                  >
                    Continue
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div>
          <div className="flex flex-wrap gap-2">
            {q.options.map((o) => {
              const on = multi.includes(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() =>
                    onChange(q.key, on ? multi.filter((x) => x !== o.value) : [...multi, o.value])
                  }
                  className={
                    "rounded-full border px-4 py-2.5 text-sm transition-colors " +
                    (on
                      ? "border-[#00C9A7] bg-[#00C9A7]/15 font-semibold"
                      : "border-white/15 bg-white/5 hover:border-white/30")
                  }
                >
                  {o.label}
                </button>
              );
            })}
          </div>
          {errors[q.key] && <p className="mt-2 text-xs text-red-300">{errors[q.key]}</p>}
          <button type="button" className={`mt-6 ${CTA}`} onClick={() => onContinue(q)}>
            Continue
          </button>
        </div>
      )}

      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="mt-6 rounded-lg px-1 py-2 text-sm text-white/50 hover:text-white"
        >
          Back
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The under $10k wedge
// ---------------------------------------------------------------------------

function WedgeCard({ target, onOpen }: { target: BookingTarget; onOpen: () => void }) {
  return (
    <div className={CARD}>
      <h2 className="mb-3 text-2xl font-bold">{WEDGE.heading}</h2>
      <p className="mb-8 text-white/70">{WEDGE.body}</p>
      {target.live || target.url ? (
        <>
          <button type="button" className={CTA} onClick={onOpen}>
            {WEDGE.cta}
          </button>
          <p className="mt-4 text-center text-xs text-white/40">{WEDGE.fine}</p>
        </>
      ) : (
        // No calendar configured at all. A phone number is a real next step; a button that
        // opens nothing is not.
        <a className={`${CTA} block text-center`} href="tel:+13368332303">
          Call (336) 833-2303
        </a>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Paths
//
// MOBILE: the primary CTA has to be thumb-reachable, so on a small screen the card is at
// least 78% of the viewport tall and the buttons are pushed to the bottom of it. The three
// FAQs sit BELOW all three buttons, which means they are below the fold on a phone, which is
// the instruction: tucked in, never pushing the CTA down.
// ---------------------------------------------------------------------------

function PathsCard({
  saving,
  onCall,
  onBook,
  onSelf,
}: {
  saving: boolean;
  onCall: () => void;
  onBook: () => void;
  onSelf: () => void;
}) {
  return (
    <>
      <div className={`${CARD} flex min-h-[78svh] flex-col justify-between sm:min-h-0 sm:block`}>
        <div>
          <h2 className="mb-2 text-xl font-bold sm:text-2xl">{PATHS.heading}</h2>
          <p className="text-sm text-white/55">{PATHS.help}</p>
        </div>

        <div className="mt-8 space-y-4 sm:mt-8">
          <button
            type="button"
            onClick={onCall}
            disabled={saving}
            className="w-full rounded-xl bg-[#00C9A7] px-6 py-5 text-left font-bold text-[#04252b] disabled:opacity-50"
          >
            <span className="block text-lg">{"\u{1F4DE}"} {PATHS.callNow.label}</span>
            <span className="mt-0.5 block text-sm font-medium opacity-80">{PATHS.callNow.sub}</span>
          </button>

          <button
            type="button"
            onClick={onBook}
            disabled={saving}
            className="w-full rounded-xl border border-white/20 bg-white/5 px-6 py-4 text-left font-semibold hover:border-white/40 disabled:opacity-50"
          >
            <span className="block">{"\u{1F4C5}"} {PATHS.book.label}</span>
            <span className="mt-0.5 block text-sm font-normal text-white/55">{PATHS.book.sub}</span>
          </button>

          <button
            type="button"
            onClick={onSelf}
            disabled={saving}
            className="w-full px-2 py-3 text-center text-sm text-white/55 underline underline-offset-4 hover:text-white disabled:opacity-50"
          >
            {PATHS.self.label} {"→"}
          </button>
        </div>
      </div>

      <FaqList items={PATH_FAQS} compact />
    </>
  );
}

// ---------------------------------------------------------------------------
// Calling
//
// A FULL SCREEN SWAP, NOT AN OVERLAY. The instruction was that this must not block scroll and
// that somebody who changes their mind can swipe up out of it. An overlay that does that is
// an overlay with a scroll trap waiting to be written wrong on one browser; a screen is one
// by construction, and there is nothing behind it worth going back to anyway.
//
// NOTHING HERE SAYS WE TEXTED THEM, because nothing did. See the note in config/chatgpt-ads.ts.
// ---------------------------------------------------------------------------

function CallingCard({
  callerId,
  email,
  live,
  onTimeout,
  onCancel,
}: {
  callerId: string | null;
  email: string;
  live: React.MutableRefObject<boolean>;
  onTimeout: () => void;
  onCancel: () => void;
}) {
  const [left, setLeft] = useState(CALL_SECONDS);
  const cancelled = useRef(false);

  useEffect(() => {
    const id = window.setInterval(() => setLeft((s) => Math.max(0, s - 1)), 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (left > 0 || cancelled.current) return;
    if (live.current) {
      void fetch("/api/chatgpt-ads/fallback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
        keepalive: true,
      }).catch(() => {});
    } else {
      console.info("[chatgpt-ads review] suppressed fallback ping");
    }
    onTimeout();
  }, [left, email, live, onTimeout]);

  const mmss = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;

  return (
    <div className={`${CARD} text-center`}>
      <div className="relative mx-auto mb-8 flex h-32 w-32 items-center justify-center">
        <span className="srt-ring absolute inset-0 rounded-full" />
        <span className="srt-ring srt-ring-2 absolute inset-0 rounded-full" />
        <span
          className="relative flex h-20 w-20 items-center justify-center rounded-full"
          style={{ backgroundColor: REEF }}
        >
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M6.6 10.8a15.1 15.1 0 006.6 6.6l2.2-2.2a1 1 0 011-.24c1.1.37 2.3.57 3.5.57a1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.2.2 2.4.57 3.5a1 1 0 01-.25 1l-2.2 2.3z"
              fill="#04252b"
            />
          </svg>
        </span>
      </div>

      <h2 className="mb-3 text-2xl font-bold">{CALLING.heading}</h2>
      <p className="mx-auto max-w-md text-white/70">
        {callerId ? CALLING.sub.replace("{number}", callerId) : CALLING.subNoNumber}
      </p>

      <p className="mt-6 text-lg font-semibold" style={{ color: REEF }}>
        {CALLING.countdown.replace("{seconds}", mmss)}
      </p>

      <button
        type="button"
        onClick={() => {
          cancelled.current = true;
          onCancel();
        }}
        className="mt-6 text-sm text-white/50 underline underline-offset-4 hover:text-white"
      >
        {CALLING.cancel}
      </button>

      <style jsx>{`
        .srt-ring {
          border: 2px solid ${REEF};
          opacity: 0;
          animation: srt-pulse 2s ease-out infinite;
        }
        .srt-ring-2 {
          animation-delay: 1s;
        }
        @keyframes srt-pulse {
          0% {
            transform: scale(0.6);
            opacity: 0.7;
          }
          100% {
            transform: scale(1.15);
            opacity: 0;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .srt-ring {
            animation: none;
            opacity: 0.25;
          }
        }
      `}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Booking
//
// Today or tomorrow, morning or afternoon, then the openings in that window. The narrow
// default is the speed frame the whole page is built on, so "see more times" is a link and
// not a third tab.
//
// UNCONFIGURED FALLS BACK TO THE EMBED. This ships with no Calendly API token, so that path
// is the DEFAULT path and it has to be the one that works, not the one that apologises.
// ---------------------------------------------------------------------------

function BookingCard({
  heading,
  body,
  target,
  kind = "15min",
  identity,
  pendingSlot,
  onSlotLabel,
}: {
  heading: string;
  body: string;
  target: BookingTarget;
  kind?: "15min" | "install";
  identity: { website: string; email: string; phone: string };
  pendingSlot: React.MutableRefObject<Slot | null>;
  onSlotLabel: (label: string) => void;
}) {
  const [data, setData] = useState<SlotsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [day, setDay] = useState<"today" | "tomorrow">("today");
  const [half, setHalf] = useState<"morning" | "afternoon">("morning");
  const [expanded, setExpanded] = useState(false);
  const [embedUrl, setEmbedUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    const w = expanded ? "extended" : "today_tomorrow";
    fetch(`/api/chatgpt-ads/slots?event=${kind}&window=${w}&tz=${encodeURIComponent(tz)}`)
      .then((r) => r.json())
      .then((j: SlotsResponse) => {
        if (alive) setData(j);
      })
      .catch(() => {
        if (alive) setData({ reason: "error", bookingUrl: target.url });
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [kind, expanded, target.url]);

  const fullCalendar = data?.bookingUrl || target.url;

  function openSlot(s: Slot) {
    pendingSlot.current = s;
    onSlotLabel(labelFor(s.startTime));
    setEmbedUrl(withPrefill(s.schedulingUrl, identity.email));
  }

  // The widget is mounted only once a slot is chosen, and its script is not even requested
  // before then. Most visitors never get here.
  if (embedUrl) {
    return (
      <div className={CARD}>
        <Script src="https://assets.calendly.com/assets/external/widget.js" strategy="afterInteractive" />
        <p className="mb-4 text-sm text-white/55">Confirm the details and you are done.</p>
        <div className="calendly-inline-widget min-h-[760px]" data-url={embedUrl} />
        <button
          type="button"
          onClick={() => setEmbedUrl(null)}
          className="mt-4 text-sm text-white/50 underline underline-offset-4 hover:text-white"
        >
          Pick a different time
        </button>
      </div>
    );
  }

  // No API token, or Calendly errored. Either way the honest move is the plain calendar.
  if (!target.live || data?.reason === "unconfigured" || data?.reason === "error") {
    return (
      <div className={CARD}>
        <h2 className="mb-2 text-xl font-bold sm:text-2xl">{heading}</h2>
        <p className="mb-6 text-sm text-white/55">{body}</p>
        {fullCalendar ? (
          <>
            <Script src="https://assets.calendly.com/assets/external/widget.js" strategy="afterInteractive" />
            <div
              className="calendly-inline-widget min-h-[760px]"
              data-url={withPrefill(fullCalendar, identity.email)}
            />
          </>
        ) : (
          <a className={`${CTA} block text-center`} href="tel:+13368332303">
            Call (336) 833-2303
          </a>
        )}
      </div>
    );
  }

  const bucket = data?.buckets?.[day]?.[half] ?? [];
  const shown = bucket.slice(0, 2);

  return (
    <div className={CARD}>
      <h2 className="mb-2 text-xl font-bold sm:text-2xl">{heading}</h2>
      <p className="mb-6 text-sm text-white/55">{body}</p>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <Toggle on={day === "today"} onClick={() => setDay("today")} label={BOOKING.today} />
        <Toggle on={day === "tomorrow"} onClick={() => setDay("tomorrow")} label={BOOKING.tomorrow} />
      </div>
      <div className="mb-6 grid grid-cols-2 gap-2">
        <Toggle on={half === "morning"} onClick={() => setHalf("morning")} label={BOOKING.morning} />
        <Toggle on={half === "afternoon"} onClick={() => setHalf("afternoon")} label={BOOKING.afternoon} />
      </div>

      {loading ? (
        <p className="text-sm text-white/45">Checking the calendar</p>
      ) : shown.length ? (
        <div className="space-y-3">
          {shown.map((s) => (
            <button key={s.startTime} type="button" className={optionClass(false)} onClick={() => openSlot(s)}>
              {labelFor(s.startTime)}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-sm text-white/45">{BOOKING.none}</p>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-4">
        {!expanded && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="text-sm text-white/55 underline underline-offset-4 hover:text-white"
          >
            {BOOKING.more}
          </button>
        )}
        {fullCalendar && (
          <a
            href={fullCalendar}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-white/40 underline underline-offset-4 hover:text-white"
          >
            {BOOKING.openCalendar}
          </a>
        )}
      </div>
    </div>
  );
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-lg border px-4 py-2.5 text-sm font-semibold transition-colors " +
        (on ? "border-[#00C9A7] bg-[#00C9A7]/15" : "border-white/15 bg-white/5 hover:border-white/30")
      }
    >
      {label}
    </button>
  );
}

/** Slot times are rendered in the VISITOR's zone, because that is the one they will show up in. */
function labelFor(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(d);
}

/** Prefill what we already know so nobody types their email twice. */
function withPrefill(url: string, email: string): string {
  try {
    const u = new URL(url);
    if (email) u.searchParams.set("email", email);
    u.searchParams.set("hide_gdpr_banner", "1");
    u.searchParams.set("primary_color", "00C9A7");
    return u.toString();
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------------------
// Self intake
// ---------------------------------------------------------------------------

function SelfCard({ url }: { url: string | null }) {
  return (
    <div className={CARD}>
      <h2 className="mb-3 text-2xl font-bold">{SELF.heading}</h2>
      <p className="mb-8 text-white/70">{SELF.body}</p>
      {url ? (
        <a className={`${CTA} block text-center`} href={url}>
          {SELF.cta}
        </a>
      ) : (
        // The secret is unset, so no link could be minted. Say the true thing rather than
        // rendering a button that goes nowhere.
        <p className="text-sm text-white/60">
          We will email your setup link shortly. If it does not arrive, call (336) 833-2303.
        </p>
      )}
      <p className="mt-4 text-center text-xs text-white/40">{SELF.fine}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FAQs
//
// One open at a time, closed by default, chevron and nothing else. <details> would give this
// for free but not the "one at a time" part, and a native <details> cannot be animated open
// consistently across browsers, so it is a controlled index and a grid-rows transition.
// ---------------------------------------------------------------------------

function FaqList({
  items,
  heading,
  compact,
}: {
  items: Faq[];
  heading?: string;
  compact?: boolean;
}) {
  const [open, setOpen] = useState<number | null>(null);

  return (
    <section className={compact ? "mt-5" : "mt-16"}>
      {heading && <h2 className="mb-5 text-center text-lg font-semibold text-white/80">{heading}</h2>}
      <div className="divide-y divide-white/10 border-y border-white/10">
        {items.map((f, i) => {
          const isOpen = open === i;
          return (
            <div key={f.q}>
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : i)}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between gap-4 py-4 text-left text-sm text-white/60 hover:text-white"
              >
                <span>{f.q}</span>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                  className={"shrink-0 transition-transform " + (isOpen ? "rotate-180" : "")}
                >
                  <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <div
                className="grid transition-all duration-200 ease-out"
                style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
              >
                <div className="overflow-hidden">
                  <p className="pb-4 text-sm leading-relaxed text-white/55">{f.a}</p>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {!compact && <p className="mt-6 text-center text-xs text-white/35">{OFFER_LINE}</p>}
    </section>
  );
}
