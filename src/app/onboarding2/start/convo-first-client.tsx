"use client";

// /onboarding2/start. THE CONVERSATION COMES FIRST AND THE OFFER INTERRUPTS IT.
//
// ‼️ THIS REVERSES THE ORDER EVERY EARLIER VERSION OF THIS FUNNEL USED, AND THE REVERSAL IS THE
// WHOLE FEATURE (Matthew, 2026-09-30). /onboarding2 and /onboarding2/free both open on an offer:
// the first durable trace of a visitor is the signing row written when they tap a card, so
// somebody who reads the offer and closes the tab is, to us, nobody at all. Here the thread opens
// cold, takes a name, a website, a mobile number and an email, and only then asks which offer. A
// visitor who abandons on the sheet leaves a contact row and a number somebody can ring.
//
// ‼️ THE FOUR ANSWERS ARE COLLECTED WITH NO SESSION BEHIND THEM, AND THAT IS FORCED RATHER THAN
// CHOSEN. POST /start has to know the offer to freeze the right agreement into the signing row, so
// there is nothing to attach a server turn to until the offer is picked. So this component holds
// them in React state and hands all four to /start in the same call as the offer. They are
// validated here for the typing experience and again on /start, which is the side that counts.
//
// ‼️ NOTHING IS ASKED TWICE AFTER THE HANDOVER. /start writes the four identity columns onto the
// signing row, so nextIntakeStep() finds them filled and the chat's first real turn is the
// daypart. ChatPanel's `knownIdentity` swaps its two seeded opening bubbles to match; without it
// the panel would paint "What is your business website?" over an answer given three steps ago.
//
// ‼️ IT LOOKS LIKE THE ASSISTANT IT HANDS OVER TO, DELIBERATELY. Same light panel, same bubbles,
// same reef chips, same composer as chat-bubble.tsx, so the seam between "the browser is asking"
// and "the server is asking" is invisible to the person answering. The palette is copied BY VALUE
// from that file, which copied it by value from hub.css, for the reason recorded there: onboarding2
// has no stylesheet at all.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ASK_EMAIL_CONVO,
  ASK_NAME_FIRST,
  ASK_PHONE_CONVO,
  ASK_WEBSITE_AFTER_NAME,
  CONVO_INTRO,
  FREE_WEBSITE,
  NO_WEBSITE_OPTION,
  SETUP_TITLE,
} from "@/config/onboarding2";
import { parseIntake, type IntakeKey } from "@/lib/onboarding2/intake-steps";
import { formatPhoneUS } from "@/lib/clients/normalize";
import { readAttribution, track } from "@/lib/medspa/pixel";
import { ChatPanel } from "../chat-bubble";
import { Starting } from "../onboarding2-client";
import { OfferSheet, OPENING_BILLING, type OfferPhase } from "./offer-sheet";
import type { UpsellOutcome } from "../free/free-first-picker";
import type { BillingState, OfferKey } from "@/config/pitch";

const REEF = "#00C9A7";
const PANEL = {
  bg: "#ffffff",
  ink: "#14181f",
  mut: "#5b6672",
  line: "#e3e8ec",
  card: "#f2f5f7",
  onAccent: "#04252b",
} as const;

/** The four asked before the offer, in order. `offer` is the sheet, not a question. */
type Step = "name" | "website" | "phone" | "email" | "offer" | "handoff";

interface Msg {
  role: "assistant" | "user";
  content: string;
}

interface Report {
  score: number | null;
  city: string | null;
  business: string | null;
  competitor: string | null;
  userShowed: number | null;
  compShowed: number | null;
  reportSlug: string | null;
}

/** How long a bubble "takes to type" before it lands. Matches BUBBLE_GAP_MS in feel. */
const TYPE_MS = 480;
const GAP_MS = 260;

export function ConvoFirstFunnel({
  report,
  utm,
}: {
  report: Report;
  utm: { source: string; medium: string; campaign: string; content: string };
}) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [step, setStep] = useState<Step>("name");
  const [typing, setTyping] = useState(false);
  const [input, setInput] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [sheetOpen, setSheetOpen] = useState(false);
  // ‼️ THE SHEET'S OWN STATE LIVES HERE, NOT IN THE SHEET. A pick flips `starting`, whose render
  // returns <Starting /> and unmounts the sheet; a failed /start then remounts it. Held down
  // there, the phase and the billing choice came back reset, so somebody who hit an error on
  // "Start monthly" was silently returned to the free card. See the note over OfferPhase.
  const [phase, setPhase] = useState<OfferPhase>("card");
  const [billing, setBilling] = useState<BillingState>(OPENING_BILLING);
  const [addonOpen, setAddonOpen] = useState(false);
  const [wantsFreeSite, setWantsFreeSite] = useState(true);
  const [starting, setStarting] = useState(false);
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [demo, setDemo] = useState(false);
  const [limited, setLimited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trap, setTrap] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);
  const entryRef = useRef<HTMLInputElement>(null);
  const renderedAt = useRef(Date.now());
  /** Guards the opener against React 18's double-invoked effects in development. */
  const opened = useRef(false);

  // ── The opener. Two bubbles, and the second one is the question. ──
  //
  // ‼️ A GREETING WITH THE QUESTION BOLTED ONTO THE END OF IT READS AS A FORM LABEL (Matthew,
  // 2026-09-30). "I will help you get your account set up. First, what is your full name?" in one
  // bubble is a sentence nobody says. In two it is somebody talking, then asking.
  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    void paint([CONVO_INTRO, ASK_NAME_FIRST]);
    track("ViewContent");
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, typing, sheetOpen]);

  // ── THE FOCUS LOCK (Matthew, 2026-09-30, and it is a house rule rather than a nicety here) ──
  //
  // Four answers typed on a laptop is four answers and, without this, four clicks back into the
  // box between them. Skipped while a surface is over the thread, and skipped on touch, where
  // focusing an input reopens the soft keyboard under somebody's thumb mid-read. preventScroll
  // because the composer sits below the message column and a default focus() would drag the thread
  // away from the bubble that just arrived.
  useEffect(() => {
    if (typing || sheetOpen || addonOpen || starting) return;
    if (step === "offer" || step === "handoff") return;
    if (typeof window !== "undefined" && window.matchMedia("(hover: none)").matches) return;
    const id = window.setTimeout(() => {
      try {
        entryRef.current?.focus({ preventScroll: true });
      } catch {
        entryRef.current?.focus();
      }
    }, 40);
    return () => window.clearTimeout(id);
  }, [typing, sheetOpen, addonOpen, starting, step, messages.length]);

  /** Paint assistant bubbles one at a time, with the dots up between them. */
  const paint = useCallback(async (lines: string[]) => {
    for (let i = 0; i < lines.length; i++) {
      setTyping(true);
      await new Promise((r) => setTimeout(r, i === 0 ? TYPE_MS : TYPE_MS + GAP_MS));
      setTyping(false);
      const text = lines[i];
      setMessages((m) => [...m, { role: "assistant", content: text }]);
      if (i < lines.length - 1) await new Promise((r) => setTimeout(r, GAP_MS));
    }
  }, []);

  const attribution = useCallback(() => {
    const a = readAttribution();
    return {
      sourceUrl: window.location.href,
      referrer: document.referrer,
      utmSource: utm.source || a.utmSource,
      utmMedium: utm.medium || a.utmMedium,
      utmCampaign: utm.campaign || a.utmCampaign,
      utmContent: utm.content,
      fbc: a.fbc,
      fbp: a.fbp,
      fbclid: a.fbclid,
      score: report.score,
      city: report.city,
      business: report.business,
      competitor: report.competitor,
      userShowed: report.userShowed,
      compShowed: report.compShowed,
      reportSlug: report.reportSlug,
    };
  }, [report, utm]);

  /**
   * Open the session, freezing the agreement for the offer, carrying the four answers.
   *
   * ‼️ THE ONLY WRITE THIS WHOLE COMPONENT MAKES. Nothing is sent while the four questions are
   * being answered, which is why somebody can walk the entire conversation and the sheet without
   * burning a row or one of the five daily starts this IP is allowed. The cost, stated rather than
   * discovered: close the tab before picking an offer and nothing is recorded at all, not even the
   * email. Moving the hot lead earlier means moving this call earlier, and that means minting a
   * signing row before an offer exists, which /start refuses by design.
   */
  const start = useCallback(
    async (offer: OfferKey, outcome: UpsellOutcome) => {
      setStarting(true);
      setError(null);
      try {
        const res = await fetch("/api/onboarding2/start", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            renderedAt: renderedAt.current,
            company_url_hp: trap,
            attribution: attribution(),
            offer,
            conciergeInterest: false,
            upsellOutcome: outcome,
            identity: {
              contactName: answers.name ?? "",
              website: answers.website ?? "",
              phone: answers.phone ?? "",
              email: answers.email ?? "",
              wantsFreeWebsite: answers.website === NO_WEBSITE_OPTION && wantsFreeSite,
            },
          }),
        });
        const data = (await res.json()) as Record<string, unknown>;
        if (data?.limited) {
          setLimited(true);
          return;
        }
        if (data?.ok !== true || !data.sessionToken) {
          setError("Something went wrong on our end. Tap the button again.");
          setStarting(false);
          return;
        }
        sessionStorage.setItem("srt:onb2:token", data.sessionToken as string);
        setDemo(data.demo === true);
        setSessionToken(data.sessionToken as string);
        setStep("handoff");
      } catch {
        // ‼️ THE NETWORK PATH CLEARS `starting` TOO. It is the only thing locking the sheet's
        // buttons now, so leaving it set on a dropped connection is what made every later tap a
        // no-op with nothing on screen to explain it.
        setError("That did not go through. Check your connection and tap the button again.");
        setStarting(false);
      }
    },
    [answers, attribution, trap, wantsFreeSite]
  );

  /** Take one answer, or say why it was not one. */
  function submit(raw: string) {
    if (typing || step === "offer" || step === "handoff") return;
    const said = raw.trim();
    if (!said) return;

    // The button beside the website box. Matched against the exported constant so rewording it
    // cannot start rejecting the answer it produces.
    if (step === "website" && said === NO_WEBSITE_OPTION) {
      setMessages((m) => [...m, { role: "user", content: said }]);
      setAnswers((a) => ({ ...a, website: NO_WEBSITE_OPTION }));
      setInput("");
      setAddonOpen(true);
      return;
    }

    const parsed = parseIntake(step as IntakeKey, said);
    setMessages((m) => [
      ...m,
      { role: "user", content: step === "phone" ? formatPhoneUS(said) || said : said },
    ]);
    setInput("");

    if (!parsed.ok) {
      void paint([parsed.error]);
      return;
    }

    const value = parsed.value;
    setAnswers((a) => ({ ...a, [step]: value }));

    if (step === "name") {
      setStep("website");
      // `{first}` or nothing. A greeting with a hanging comma is worse than one that never
      // promised to know who they are.
      const firstName = value.trim().split(/\s+/)[0] ?? "";
      void paint([ASK_WEBSITE_AFTER_NAME.replace("{first}", firstName ? `, ${firstName}` : "")]);
      return;
    }
    if (step === "website") {
      setStep("phone");
      void paint([ASK_PHONE_CONVO]);
      return;
    }
    if (step === "phone") {
      setStep("email");
      void paint([ASK_EMAIL_CONVO]);
      return;
    }
    if (step === "email") {
      // ‼️ Lead, not CompleteRegistration. Nothing has been signed and no offer has been chosen;
      // what just happened is that a stranger became somebody we can contact.
      track("Lead");
      setStep("offer");
      void paint(["Perfect. One thing before we book the call."]).then(() => setSheetOpen(true));
    }
  }

  /** The free-website add-on, answered. Never blocks the conversation either way. */
  function closeAddon(yes: boolean) {
    setWantsFreeSite(yes);
    setAddonOpen(false);
    if (yes) setMessages((m) => [...m, { role: "user", content: FREE_WEBSITE.optIn }]);
    setStep("phone");
    void paint([yes ? FREE_WEBSITE.ackYes : FREE_WEBSITE.ackNo, ASK_PHONE_CONVO]);
  }

  // ── Render ──

  if (limited) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-24">
        <div className="rounded-xl bg-white/5 p-6 text-center">
          <h1 className="mb-2 text-xl font-bold text-white">That has already come through</h1>
          <p className="text-white/70">
            We have a few sign ups from this connection already today. Reply to our email and we
            will sort it out.
          </p>
        </div>
      </div>
    );
  }

  // ‼️ THE WAIT GETS A SCREEN OF ITS OWN, AND THE ONLY REASON IS THE REFRESH. /start now mints the
  // signing row, the lead, the #hot-leads thread AND the RingOut in one request. A disabled button
  // saying "One moment" looks like a page that did not respond, and the thing somebody does to a
  // page that did not respond is reload it, which abandons all four.
  if (starting && !sessionToken) return <Starting />;

  if (step === "handoff" && sessionToken) {
    return (
      <ChatPanel
        sessionToken={sessionToken}
        demo={demo}
        knownIdentity
        /* Same centred card the conversation above ran in. Without this the panel jumps to the
           bottom-right corner at the exact moment somebody picks an offer. */
        layout="centre"
        title={SETUP_TITLE}
      />
    );
  }

  const websiteStep = step === "website";

  return (
    /*
      ── THE DESKTOP LAYOUT (Matthew, 2026-09-30: "for mobile version is cool but in pc looks weird") ──

      ‼️ IT IS A CENTRED, PHONE-PROPORTIONED CARD ON DESKTOP, NOT A CORNER PANEL, AND THE SHEET IS
      WHY. This started as a copy of chat-bubble.tsx's shell, which floats bottom-right above 640px.
      That is exactly right for the review widget it was borrowed from, because there a real page
      sits behind it and the panel is an accessory to it. Here there is nothing behind it at all, so
      a 448px box pinned to the corner of an empty black screen reads as a widget that failed to
      load its host page.

      It also broke the offer. A sheet that rises from the bottom edge and stops at 88% means
      something on a phone: the bottom edge is where the thumb is, and the 12% left showing is the
      thread it came from. Inside a short corner panel it was neither of those things, just a dark
      rectangle covering a smaller dark rectangle, with the whole conversation hidden behind it.

      A centred card at roughly phone proportions makes both true again at every width, and it is
      one layout rather than two: the sheet, the scrim and the add-on all keep the same geometry
      they were designed against instead of growing a desktop special case each.

      ‼️ sm:relative, NEVER sm:static. The sheet, the scrim and the add-on are all `absolute` and
      anchor to this element. Going static would take it out of the positioned chain and they would
      anchor to the viewport instead, which puts a full-height sheet over the entire browser window.
      `inset-0` is harmless under relative: the offsets are all zero.
    */
    <div className="sm:flex sm:min-h-screen sm:flex-col sm:items-center sm:justify-center sm:px-4 sm:py-10">
      {/* Grounds the card so it is a composition rather than an object floating on black. Desktop
          only, and behind everything: purely decorative, so it is hidden from assistive tech. */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 hidden sm:block"
        style={{
          background:
            "radial-gradient(60rem 40rem at 50% 42%, rgba(0,201,167,0.10), transparent 70%)",
        }}
      />

      <div className="relative mb-5 hidden items-center gap-2 sm:flex">
        <span
          aria-hidden="true"
          className="grid h-6 w-6 place-items-center rounded-md text-[9px] font-extrabold"
          style={{ backgroundColor: REEF, color: PANEL.onAccent }}
        >
          SRT
        </span>
        <span className="text-[13px] font-semibold tracking-tight text-white/70">SRT Agency</span>
      </div>

    <div
      className="fixed inset-0 z-50 flex flex-col sm:relative sm:z-auto sm:h-[min(44rem,calc(100vh-10rem))] sm:w-[min(26rem,100%)] sm:overflow-hidden sm:rounded-[22px] sm:border sm:shadow-2xl"
      style={{ backgroundColor: PANEL.bg, color: PANEL.ink, borderColor: PANEL.line }}
    >
      <div
        className="flex flex-none items-center gap-2.5 border-b px-4 py-3"
        style={{ borderColor: PANEL.line }}
      >
        <span
          aria-hidden="true"
          className="grid h-7 w-7 place-items-center rounded-full text-[10px] font-extrabold"
          style={{ backgroundColor: REEF, color: PANEL.onAccent }}
        >
          SRT
        </span>
        <span>
          <b className="block text-sm font-semibold">{SETUP_TITLE}</b>
          <small className="block text-[11px]" style={{ color: PANEL.mut }}>
            Setting up your AI Referral Engine
          </small>
        </span>
      </div>

      <div ref={scrollRef} className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 py-4">
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user"
                ? "ml-auto max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm px-3.5 py-2.5 text-sm font-medium"
                : "mr-auto max-w-[90%] whitespace-pre-wrap break-words rounded-2xl rounded-bl-sm px-3.5 py-2.5 text-sm"
            }
            style={
              m.role === "user"
                ? { backgroundColor: REEF, color: PANEL.onAccent }
                : { backgroundColor: PANEL.card, color: PANEL.ink }
            }
          >
            {m.content}
          </div>
        ))}

        {typing && (
          <div
            className="mr-auto rounded-2xl rounded-bl-sm px-4 py-3"
            style={{ backgroundColor: PANEL.card }}
          >
            <div className="flex gap-1">
              {[0, 150, 300].map((d) => (
                <span
                  key={d}
                  className="h-1.5 w-1.5 animate-bounce rounded-full"
                  style={{ backgroundColor: REEF, animationDelay: `${d}ms` }}
                />
              ))}
            </div>
          </div>
        )}

        {/*
          ‼️ THE ONE STEP IN THE FUNNEL THAT TAKES A CHIP **AND** TYPING AT ONCE (Matthew,
          2026-09-30). Every other chip question hides the composer, because a typed day is a day we
          have to parse and can get wrong. A website is either theirs or they do not have one, and
          before this button existed "I dont have a website" got typed into the box and bounced off
          normalizeTarget as a malformed address, which is exactly what it looks like to a regex and
          not at all what it means.
        */}
        {websiteStep && !typing && (
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              onClick={() => submit(NO_WEBSITE_OPTION)}
              className="rounded-full border px-3.5 py-2 text-sm font-medium transition hover:bg-black/5"
              style={{ borderColor: REEF, color: "#00806c" }}
            >
              {NO_WEBSITE_OPTION}
            </button>
          </div>
        )}

      </div>

      <div
        className={`flex flex-none items-end gap-2 border-t p-3 ${
          step === "offer" || step === "handoff" ? "hidden" : ""
        }`}
        style={{ borderColor: PANEL.line }}
      >
        <input
          ref={entryRef}
          value={input}
          onChange={(e) =>
            // Live E.164 formatting on the phone step only, so what they see as they type is what
            // gets stored. formatPhoneUS is the same helper the client forms use.
            setInput(step === "phone" ? formatPhoneUS(e.target.value) || e.target.value : e.target.value)
          }
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit(input);
            }
          }}
          placeholder={PLACEHOLDER[step] ?? ""}
          aria-label="Your answer"
          /* 16px on the control itself, or iOS zooms the whole panel on focus. */
          style={{ backgroundColor: PANEL.bg, color: PANEL.ink, borderColor: PANEL.line, fontSize: 16 }}
          className="min-w-0 flex-1 rounded-lg border px-3 py-2.5 outline-none focus:border-[#00C9A7]"
        />
        <button
          type="button"
          onClick={() => submit(input)}
          disabled={typing || !input.trim()}
          className="rounded-lg px-4 py-2.5 text-sm font-bold disabled:opacity-40"
          style={{ backgroundColor: REEF, color: PANEL.onAccent }}
        >
          Send
        </button>
      </div>

      {/* The honeypot. POST /start still reads company_url_hp and still answers a filled one with a
          cheerful 200, so keeping the field on screen is what keeps that trap armed. */}
      <input
        type="text"
        name="company_url"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        value={trap}
        onChange={(e) => setTrap(e.target.value)}
        className="absolute left-[-9999px] h-0 w-0 opacity-0"
      />

      <OfferSheet
        open={sheetOpen}
        busy={starting}
        error={error}
        phase={phase}
        onPhase={setPhase}
        billing={billing}
        onBilling={setBilling}
        onPick={(offer, outcome) => void start(offer, outcome)}
      />

      {/* ── The free website add-on ── */}
      {addonOpen && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 p-5">
          <div className="w-full max-w-[20rem] rounded-2xl bg-[#111] p-5 text-white ring-1 ring-white/15">
            <div className="text-[10.5px] font-bold uppercase tracking-[0.12em]" style={{ color: REEF }}>
              {FREE_WEBSITE.eyebrow}
            </div>
            <h2 className="mt-2 text-balance text-[20px] font-bold leading-tight">
              {FREE_WEBSITE.headline}
            </h2>
            <p className="mt-2.5 text-[13px] leading-relaxed text-white/68">{FREE_WEBSITE.body}</p>

            {/* Pre-ticked. The thing behind it costs nothing and commits nobody, so an unticked box
                would be asking somebody to opt in to a free sample. A deliberate default. */}
            <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-[#00C9A7]/35 bg-[#00C9A7]/[0.08] p-3">
              <input
                type="checkbox"
                checked={wantsFreeSite}
                onChange={(e) => setWantsFreeSite(e.target.checked)}
                className="mt-0.5 h-[18px] w-[18px] flex-none accent-[#00C9A7]"
              />
              <span className="text-[13px] font-semibold leading-snug">
                {FREE_WEBSITE.optIn}
                <small className="mt-1 block text-[12px] font-normal text-white/55">
                  {FREE_WEBSITE.optInNote}
                </small>
              </span>
            </label>

            <button
              type="button"
              onClick={() => closeAddon(wantsFreeSite)}
              className="mt-4 w-full rounded-xl px-5 py-3.5 text-sm font-bold text-[#04252b] transition hover:opacity-90"
              style={{ backgroundColor: REEF }}
            >
              {FREE_WEBSITE.cta}
            </button>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}

const PLACEHOLDER: Record<string, string> = {
  name: "Your full name",
  website: "yourclinic.com",
  phone: "(555) 123 4567",
  email: "you@yourclinic.com",
};
