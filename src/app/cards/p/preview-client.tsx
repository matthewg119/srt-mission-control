"use client";

// /cards/p — the card, the proof, and then the ask. In that order.
//
// ‼️ READ src/config/card-preview.ts FIRST for what this walks and why the order is the argument.
//
// ‼️ THREE STATES IN ONE SECTION, NOT THREE PAGES. The lockup at the top does not move and the
// content under it changes, which is the doctrine /cards and the review walk both settled on after
// Matthew rejected the double stacking by name on 2026-10-07. The walk only goes forwards: the
// "Back to the card" link between the first two screens was removed on 2026-10-09 at his request,
// and nothing can rewind out of the chat, because a chat that can be rewound is a chat whose
// answers nobody trusts.
//
// ‼️ THERE IS NO MODEL IN THIS PATH AND NO FETCH PER TURN. The whole script is in the bundle and
// the walk is an index into an array, the same doctrine the Virtual Agent and /cards follow.
//
// ‼️ IT POSTS ONCE, WHEN THE FIFTH ANSWER LANDS. Nothing is sent while they are typing, so a
// clinic that abandons halfway leaves no half-lead. The booking beats that follow are after the
// write on purpose: the lead is the thing worth protecting, and a clinic that answers five
// questions and never picks a time is still somebody to chase.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { calendlyEmbedUrl } from "@/lib/calendly";
import { validEmail, validName } from "@/lib/medspa/validate";
import {
  PREVIEW_CLOSE,
  PREVIEW_CUSTOM,
  PREVIEW_DAY,
  PREVIEW_DAYPART,
  PREVIEW_INSIDE,
  PREVIEW_SCAN,
  PREVIEW_SCRIPT,
  PREVIEW_SLOTS,
  copyFor,
  type PreviewKey,
  type PreviewStep,
} from "@/config/card-preview";
import { designByKey } from "@/config/card-designs";
import { CardFront, ScanHand } from "./card-art";

const GAP_MS = { min: 420, max: 820 } as const;

/** One offering from Calendly's own availability, with the URL that books that exact time. */
interface Slot {
  startTime: string;
  schedulingUrl: string;
  label: string;
}

interface Bubble {
  id: number;
  from: "them" | "her";
  text: string;
}

type Screen = "card" | "inside" | "chat";
type Awaiting = "none" | "text" | "daypart" | "day" | "slots" | "done";
type Answers = Partial<Record<PreviewKey, string>>;

/**
 * The next two days, in the VISITOR's own zone, labelled the way a person says them.
 *
 * ‼️ THE OFFSET TRAVELS AND THE LABEL DOES NOT. The server resolves the day from the integer
 * against the same zone, so nothing depends on two machines agreeing what a date string means.
 * Copied from /cards deliberately rather than shared: that funnel offers three and this one offers
 * two, and a shared helper taking a count would be one function pretending two decisions are one.
 */
function nextDays(count: number, now: Date = new Date()): Array<{ label: string; offset: number }> {
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long" });
  return Array.from({ length: count }, (_, offset) => {
    const d = new Date(now.getTime() + offset * 86_400_000);
    const label = offset === 0 ? "Today" : offset === 1 ? "Tomorrow" : weekday.format(d);
    return { label, offset };
  });
}

export interface PreviewClientProps {
  /** The clinic's name, or the placeholder. Never empty. Resolved on the server. */
  clinicName: string;
  /** Their own future reviews host, printed on the card, or null. See CardFrontProps. */
  reviewsHost: string | null;
  /** The code, rendered server side by `qrcode`. One target, so one image for all three designs. */
  qrDataUrl: string;
  /** What the phone frame embeds. The walkthrough with its demo ribbon dropped. */
  insideSrc: string;
  /** Which design the page opened on, from ?d= or the first offered one. */
  initialDesign: string;
  /** The link's own token, handed back on submit so the answers find the right thread. */
  token: string | null;
}

export function PreviewClient(props: PreviewClientProps) {
  const [screen, setScreen] = useState<Screen>("card");
  // ‼️ READ ONCE AND NEVER SET. The picker that used to change it is gone; ?d= still seeds it on
  // the server, so a second design is a setter and a control away rather than a rewrite.
  const [designKey] = useState(props.initialDesign);
  // ‼️ THE FRAME DOES NOT START INTERACTIVE, WHICH IS A REQUIREMENT AND NOT A DETAIL. "they need
  // to click it to go inside". A clinic owner who scrolls past an embedded page has not understood
  // that it is live; one deliberate tap is what turns a picture into a product.
  const [insideLive, setInsideLive] = useState(false);
  // ‼️ WHICH DOOR THEY TOOK INTO THE CHAT, and it changes two things only: an opening bubble, and
  // a loud line on the Slack card. The five questions are identical, because a clinic that wants a
  // custom design still has to tell us who they are and what they sell.
  const [wantsCustom, setWantsCustom] = useState(false);

  const [answers, setAnswers] = useState<Answers>({});
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [index, setIndex] = useState(0);
  const [awaiting, setAwaiting] = useState<Awaiting>("none");
  const [typing, setTyping] = useState(false);
  const [composed, setComposed] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [bookingUrl, setBookingUrl] = useState<string | null>(null);
  const [booked, setBooked] = useState(false);

  // Refs, not state: the Calendly listener reads them from a closure set up once, so it has to
  // see the latest value rather than the one that existed when it subscribed. The same shape
  // cards-client.tsx uses, and for the same reason.
  const contactId = useRef<string | null>(null);
  const calendarUrl = useRef<string | null>(null);
  const pendingSlot = useRef<Slot | null>(null);
  const bookedOnce = useRef(false);
  const sentOnce = useRef(false);

  const bubbleId = useRef(0);
  const played = useRef<Set<string>>(new Set());
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const endRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const design = useMemo(() => designByKey(designKey), [designKey]);
  const copy = useMemo(() => copyFor(design.copy), [design]);
  const days = useMemo(() => nextDays(PREVIEW_DAY.count), []);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const t of pending) clearTimeout(t);
    };
  }, []);

  const later = useCallback((fn: () => void, ms: number) => {
    const t = setTimeout(fn, ms);
    timers.current.push(t);
  }, []);

  const push = useCallback((from: Bubble["from"], text: string) => {
    bubbleId.current += 1;
    const id = bubbleId.current;
    setBubbles((prev) => [...prev, { id, from, text }]);
  }, []);

  const step: PreviewStep | undefined = PREVIEW_SCRIPT[index];

  // ‼️ PUSHED ONCE, BEFORE THE FIRST QUESTION, AND NOT AS A SCRIPT STEP. It is the answer to the
  // button they pressed rather than part of the walk, and `played` already guards the walk itself.
  const openedCustom = useRef(false);
  useEffect(() => {
    if (screen !== "chat" || !wantsCustom || openedCustom.current) return;
    openedCustom.current = true;
    push("them", PREVIEW_CUSTOM.opener);
  }, [screen, wantsCustom, push]);

  // ── The driver, for the scripted half only ─────────────────────────────────
  // Everything after the fifth answer is a beat rather than a step: the write happens in the
  // middle of it, and a question that can only be asked once a POST has returned is not a line in
  // an array. Modelling those as script steps would mean a driver that has to know about network
  // state, which is how a scripted walk stops being readable.
  useEffect(() => {
    if (screen !== "chat") return;
    if (!step) return;
    if (played.current.has(step.id)) return;
    played.current.add(step.id);

    setTyping(true);
    later(
      () => {
        setTyping(false);
        if (step.kind === "say") {
          push("them", step.text);
          setIndex((i) => i + 1);
          return;
        }
        push("them", step.prompt);
        setAwaiting(step.kind === "ask" ? "text" : "none");
      },
      index === 0 ? GAP_MS.min : GAP_MS.max
    );
  }, [screen, step, index, push, later]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [bubbles, typing]);

  // ‼️ THE BOX TAKES THE CARET BACK AFTER EVERY ANSWER. A desktop visitor who has just pressed
  // Enter should be able to type the next answer without reaching for the mouse; without this the
  // focus is lost when the composer unmounts between questions and every answer costs a click.
  useEffect(() => {
    if (awaiting === "text") inputRef.current?.focus();
  }, [awaiting, index]);

  /**
   * Calendly tells the parent window when a booking completes.
   *
   * ‼️ THE ORIGIN IS CHECKED EXACTLY, because this listens on `window` and anything can post to
   * it. endsWith("calendly.com") would accept evilcalendly.com, which is the whole point of an
   * origin check.
   */
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== "https://calendly.com") return;
      const data = e.data as { event?: string; payload?: { event?: { uri?: string } } } | null;
      if (!data || typeof data !== "object" || data.event !== "calendly.event_scheduled") return;
      if (bookedOnce.current) return;
      bookedOnce.current = true;
      setBooked(true);

      // Fire and forget. Their screen is finished; a failed notification is ours to notice in the
      // logs and never theirs to retry. The route is /api/cards/booked, shared with /cards: it
      // takes a contact id and verifies the event against Calendly itself, and nothing about it
      // is specific to which funnel booked.
      void fetch("/api/cards/booked", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contactId: contactId.current,
          eventUri: data.payload?.event?.uri ?? "",
          startTime: pendingSlot.current?.startTime ?? "",
        }),
      }).catch(() => {});
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  /** Store an answer, show it in the transcript, and move on. */
  const accept = useCallback((key: PreviewKey, value: string) => {
    setFieldError(null);
    push("her", value);
    setAnswers((prev) => ({ ...prev, [key]: value }));
    setComposed("");
    setAwaiting("none");
    setIndex((i) => i + 1);
  }, [push]);

  /** Their typed answer, validated before it is kept. */
  function commit(raw: string) {
    if (!step || step.kind !== "ask") return;
    const value = raw.trim();

    // ‼️ VALIDATED HERE AND AGAIN ON THE SERVER. This arm is for their benefit, so the message
    // names the field and the fix; the route's copy of the same rules is the one that protects the
    // row, because a client check is a courtesy and never a boundary.
    if (step.validate === "email" && !validEmail(value)) {
      setFieldError("That does not look like an email address.");
      return;
    }
    if (step.validate === "name" && !validName(value)) {
      setFieldError("Please type a name we can use.");
      return;
    }
    // ‼️ "free" IS NOT "unchecked". The best seller and the offer are deliberately open, because
    // "we have not decided" is a real answer from a clinic that has never run a referral
    // programme. What is still refused is an empty box and a paragraph: one is a mis-tap and the
    // other does not fit on a Slack card or a service row.
    if (step.validate === "free" && (value.length < 2 || value.length > 160)) {
      setFieldError(value.length < 2 ? "A word or two is plenty." : "Keep it under 160 characters.");
      return;
    }

    accept(step.key, value);
  }

  /**
   * Send the lead. Called once, by the effect below, when the fifth answer lands.
   *
   * ‼️ THE CLOSE AND THE BOOKING ASK ARE TWO BUBBLES, NOT ONE. "we can say, We will send the
   * email with your Free PDF card shortly. and next message says When do you have 15 mins..."
   * His structure, and it is the right one: the first bubble finishes what they came for and the
   * second starts something new. One bubble carrying both reads as a condition on the card.
   */
  const send = useCallback(async () => {
    setBusy(true);
    setSendError(null);
    try {
      const res = await fetch("/api/cards/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...answers,
          design: designKey,
          customDesign: wantsCustom,
          token: props.token,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        bookingUrl?: string;
        contactId?: string;
      };
      if (!json.ok) {
        // ‼️ THE WALK STOPS HERE RATHER THAN CARRYING ON TO THE BOOKING. Offering a calendar to
        // somebody whose details did not save is how a call lands with no lead behind it.
        sentOnce.current = false;
        setSendError(json.error ?? "That did not go through. Please reply to our email instead.");
        return;
      }
      if (json.contactId) contactId.current = json.contactId;
      if (json.bookingUrl) calendarUrl.current = json.bookingUrl;

      setTyping(true);
      later(() => {
        setTyping(false);
        push("them", PREVIEW_CLOSE.sent);
        setTyping(true);
        later(() => {
          setTyping(false);
          push("them", PREVIEW_CLOSE.ask);
          setAwaiting("daypart");
        }, GAP_MS.max);
      }, GAP_MS.min);
    } catch {
      sentOnce.current = false;
      setSendError("That did not go through. Please reply to our email instead.");
    } finally {
      setBusy(false);
    }
  }, [answers, designKey, wantsCustom, props.token, later, push]);

  // The walk runs out of scripted steps exactly once, and that is the write.
  useEffect(() => {
    if (screen !== "chat") return;
    if (step) return;
    if (sentOnce.current) return;
    if (!answers.referralOffer) return;
    sentOnce.current = true;
    void send();
  }, [screen, step, answers.referralOffer, send]);

  /**
   * Two real openings on the day and half-day they named, or none.
   *
   * ‼️ IT NEVER THROWS AND NEVER BLOCKS THE BOOKING. Calendly being slow or the token being unset
   * both come back as an empty list, and an empty list means the full calendar.
   */
  const loadSlots = useCallback(
    async (dayOffset: number, daypart: string): Promise<Slot[]> => {
      try {
        const res = await fetch("/api/cards/slots", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            dayOffset,
            daypart,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
        });
        const json = (await res.json()) as { slots?: Slot[] };
        return Array.isArray(json.slots) ? json.slots : [];
      } catch {
        return [];
      }
    },
    []
  );

  function chooseDaypart(value: string) {
    push("her", value);
    setAnswers((prev) => ({ ...prev, daypart: value }));
    setAwaiting("none");
    setTyping(true);
    later(() => {
      setTyping(false);
      push("them", PREVIEW_DAY.prompt);
      setAwaiting("day");
    }, GAP_MS.min);
  }

  /** The whole calendar, which is what "Another day" and every fallback resolve to. */
  function showCalendar(line: string) {
    setBookingUrl(calendarUrl.current);
    push("them", line);
    setAwaiting("done");
  }

  async function chooseDay(label: string, offset: number | null) {
    push("her", label);
    setAwaiting("none");

    // ‼️ "if they click other show calendly menu". The escape is the only thing that reveals the
    // whole calendar, which is what makes offering two a shortcut rather than a cage.
    if (offset === null) {
      showCalendar(PREVIEW_SLOTS.booking);
      return;
    }

    setAnswers((prev) => ({ ...prev, callDay: label }));
    setTyping(true);
    const found = await loadSlots(offset, answers.daypart ?? "");
    setTyping(false);

    if (found.length === 0) {
      // Availability unreadable, or that half-day full. Either way the calendar is the answer and
      // the copy says so rather than pretending we chose to skip the shortcut.
      showCalendar(PREVIEW_SLOTS.none);
      return;
    }
    setSlots(found);
    push("them", PREVIEW_SLOTS.prompt);
    setAwaiting("slots");
  }

  /**
   * They took one of the two.
   *
   * ‼️ SHAPED BY calendlyEmbedUrl AND NOT BY HAND. `embed_type=Inline` is what makes Calendly
   * post event_scheduled to the parent window; without it a booking silently dead-ends, the
   * listener above never fires and the lead's thread never hears. /cards shipped that exact bug
   * and the helper exists so a fourth caller does not rediscover it.
   */
  function takeSlot(slot: Slot) {
    const name = [answers.firstName, answers.lastName].filter(Boolean).join(" ");
    const embed = calendlyEmbedUrl(slot.schedulingUrl, { name, email: answers.email ?? null });
    push("her", slot.label);

    // A slot URL Calendly minted parses, so this is belt and braces. If it ever does not, the
    // whole-calendar URL is already in a ref and the copy says what happened, rather than mounting
    // a frame with null in its src.
    if (!embed) {
      showCalendar(PREVIEW_SLOTS.none);
      return;
    }
    pendingSlot.current = slot;
    setBookingUrl(embed);
    push("them", PREVIEW_SLOTS.booking);
    setAwaiting("done");
  }

  const canSend = composed.trim().length > 0;

  // ── Screen one: the object ────────────────────────────────────────────────
  if (screen === "card") {
    return (
      <div className="cp-screen">
        <p className="cd-open-eyebrow">{PREVIEW_SCAN.eyebrow}</p>
        <h1 className="cp-title">{PREVIEW_SCAN.title}</h1>
        <p className="cd-open-lede">{PREVIEW_SCAN.lede}</p>

        <div className="cp-stage">
          {/* ‼️ A BUTTON AND NOT A DIV WITH AN onClick. The whole card is the tap target, it is
              the only thing on the screen that moves the walk on, and a keyboard has to reach it. */}
          <button
            type="button"
            className="cp-cardtap"
            onClick={() => setScreen("inside")}
            aria-label={PREVIEW_SCAN.tap}
          >
            <CardFront
              design={design}
              copy={copy}
              clinicName={props.clinicName}
              qrDataUrl={props.qrDataUrl}
              reviewsHost={props.reviewsHost}
            />
            <span className="cp-tap" style={{ background: design.accent, color: design.onAccent }}>
              {PREVIEW_SCAN.tap}
            </span>
          </button>
          <ScanHand design={design} />
        </div>

        {/* ‼️ THE SHORTCUT SITS WITH THE LINE ABOUT THEIR OWN PAGE, which is where he put it, and
            the two belong together: that sentence is the first thing on the screen that is about
            THEIR setup rather than about the card, so it is the moment somebody who has already
            understood the product stops reading and wants to start. It sits UNDER the sentence
            and smaller than it, because it is an escape and not an instruction.

            ‼️ AND THE TWO SWATCHES THAT WERE HERE ARE GONE. "remove the option to look at 2
            previews 2 squares". There is one card now, so a picker under it was a question with
            one answer, and it turned a demonstration into a form. */}
        <p className="cp-note">{PREVIEW_SCAN.qrNote}</p>
        <button type="button" className="cp-mini cp-skip" onClick={() => setScreen("chat")}>
          {PREVIEW_SCAN.skipToChat}
        </button>

        <button type="button" className="cd-primary cp-cta" onClick={() => setScreen("inside")}>
          {PREVIEW_SCAN.cta}
        </button>
      </div>
    );
  }

  // ── Screen two: the proof ─────────────────────────────────────────────────
  if (screen === "inside") {
    return (
      <div className="cp-screen">
        <p className="cd-open-eyebrow">{PREVIEW_INSIDE.eyebrow}</p>
        <h1 className="cp-title">{PREVIEW_INSIDE.title}</h1>
        <p className="cd-open-lede">{PREVIEW_INSIDE.lede}</p>

        <div className="cp-phone">
          <div className="cp-phone-screen">
            {/* ‼️ THE REAL PAGE, NOT A PICTURE OF IT, AND NOT A SECOND RENDERER OF IT EITHER.
                /preview/[token]'s header warns that three renderers of one page is three places for
                a theme to drift; a hand-drawn mock of the walk here would be a fourth. The frame
                loads /demo/agent, which is the same <ReferralEngine> every other surface draws,
                reaches no database and stores nothing. */}
            <iframe
              title={PREVIEW_INSIDE.title}
              src={props.insideSrc}
              loading="lazy"
              className="cp-frame"
              // Inert until tapped. `inert` is not in React's types on this version, so the
              // overlay below is what actually blocks the pointer; this is the belt.
              tabIndex={insideLive ? undefined : -1}
            />
            {!insideLive && (
              <button type="button" className="cp-veil" onClick={() => setInsideLive(true)}>
                <span
                  className="cp-tap"
                  style={{ background: design.accent, color: design.onAccent }}
                >
                  {PREVIEW_INSIDE.tap}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* ‼️ THE ROW UNDER THE PHONE IS A WAY FORWARD NOW, NOT A WAY OUT. It used to carry
            "Open it full screen", which was a link into another tab at the exact moment somebody
            had just understood what they were looking at. In its place, in grey so it cannot
            compete with the green: the door for a clinic that likes the idea and not the card.
            Matthew, 2026-10-09, on both halves of that swap. */}
        <p className="cp-note">
          {insideLive ? `${PREVIEW_INSIDE.live} ` : ""}
          <button
            type="button"
            className="cp-mini"
            onClick={() => {
              setWantsCustom(true);
              setScreen("chat");
            }}
          >
            {PREVIEW_INSIDE.custom}
          </button>
        </p>

        <button type="button" className="cd-primary cp-cta" onClick={() => setScreen("chat")}>
          {PREVIEW_INSIDE.cta}
        </button>
        <p className="cd-open-foot">{PREVIEW_INSIDE.foot}</p>
      </div>
    );
  }

  // ── Screen three: the chat ────────────────────────────────────────────────
  return (
    <div className="cd-shell">
      <div className="cd-msgs">
        {bubbles.map((b) => (
          <div key={b.id} className={b.from === "her" ? "cd-msg is-me" : "cd-msg is-them"}>
            {b.text}
          </div>
        ))}
        {typing && (
          <div className="cd-msg is-them cd-typing" aria-label="typing">
            <span />
            <span />
            <span />
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/*
        ‼️ A FAILED SEND OFFERS A RETRY RATHER THAN ENDING THE WALK. /cards sets the same error and
        stops there, which was survivable on a funnel reached from an email somebody still has;
        this one is reached from a link in a conversation, and a clinic that answered five
        questions into a dead end has no obvious way back. `send` resets sentOnce on failure
        precisely so this button means something: without it that line was dead code promising a
        retry that nothing could trigger, because the effect's dependencies never change again.
      */}
      {sendError && (
        <div className="cd-composer">
          <p className="cd-error" role="alert">
            {sendError}
          </p>
          <button
            type="button"
            className="cd-primary"
            disabled={busy}
            onClick={() => {
              if (sentOnce.current) return;
              sentOnce.current = true;
              setSendError(null);
              void send();
            }}
          >
            Try that again
          </button>
        </div>
      )}

      {awaiting === "text" && step?.kind === "ask" && (
        <div className="cd-composer">
          <div className="cd-bar">
            <input
              ref={inputRef}
              type={step.validate === "email" ? "email" : "text"}
              value={composed}
              placeholder={step.placeholder}
              aria-label={step.prompt}
              autoComplete={
                step.key === "firstName"
                  ? "given-name"
                  : step.key === "lastName"
                    ? "family-name"
                    : step.key === "email"
                      ? "email"
                      : "off"
              }
              onChange={(e) => {
                setComposed(e.target.value);
                setFieldError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSend) commit(composed);
              }}
            />
            <button type="button" onClick={() => commit(composed)} disabled={!canSend || busy}>
              Send
            </button>
          </div>
          {fieldError && (
            <p className="cd-error" role="alert">
              {fieldError}
            </p>
          )}
          {/* ‼️ AN ANSWER AND NOT A SKIP, which is why it stores a sentence rather than nothing.
              "Not decided yet" and "we never asked" are different facts on a Slack card somebody
              reads before a call, and only one of them is worth opening the call with. */}
          {step.skip && (
            <button
              type="button"
              className="cd-skip"
              onClick={() => accept(step.key, step.skip!.value)}
            >
              {step.skip.label}
            </button>
          )}
        </div>
      )}

      {awaiting === "daypart" && (
        <div className="cd-chips is-pair">
          {PREVIEW_DAYPART.options.map((option) => (
            <button key={option} type="button" onClick={() => chooseDaypart(option)}>
              {option}
            </button>
          ))}
        </div>
      )}

      {awaiting === "day" && (
        <div className="cd-chips is-stack">
          {days.map((d) => (
            <button key={d.offset} type="button" onClick={() => void chooseDay(d.label, d.offset)}>
              {d.label}
            </button>
          ))}
          <button type="button" className="cd-skip" onClick={() => void chooseDay(PREVIEW_DAY.other, null)}>
            {PREVIEW_DAY.other}
          </button>
        </div>
      )}

      {awaiting === "slots" && slots && (
        <div className="cd-chips is-stack">
          {slots.map((s) => (
            <button key={s.startTime} type="button" onClick={() => takeSlot(s)}>
              {s.label}
            </button>
          ))}
          <button
            type="button"
            className="cd-skip"
            onClick={() => {
              push("her", PREVIEW_SLOTS.another);
              showCalendar(PREVIEW_SLOTS.booking);
            }}
          >
            {PREVIEW_SLOTS.another}
          </button>
        </div>
      )}

      {awaiting === "done" && bookingUrl && !booked && (
        <div className="cd-cal">
          {/* ‼️ embed_domain IS APPENDED HERE AND NOT ON THE SERVER. It has to be the host the
              BROWSER is on, and the server cannot know whether that is the apex, mission, or a
              preview deployment. Getting it wrong does not break the frame; it stops Calendly
              emitting event_scheduled, which is the silent failure calendlyEmbedUrl warns about. */}
          <iframe
            title="Pick a time"
            src={`${bookingUrl}&embed_domain=${encodeURIComponent(
              typeof window === "undefined" ? "" : window.location.hostname
            )}`}
            style={{ width: "100%", height: "100%", border: 0 }}
          />
        </div>
      )}

      {booked && (
        <div className="cd-composer">
          <p className="cd-booked">{PREVIEW_SLOTS.booked}</p>
        </div>
      )}
    </div>
  );
}
