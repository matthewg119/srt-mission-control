"use client";

// The card-led onboarding chatbox. Scripted, no model, one POST at the end.
//
// ‼️ READ src/config/onboarding-cards.ts FIRST for what this walks and why it is a sibling of
// /onboarding2 rather than a mode of it.
//
// ‼️ THERE IS NO MODEL IN THIS PATH AND NO FETCH PER TURN. The whole script is in the bundle and
// the walk is an index into an array, the same doctrine the Virtual Agent follows. onboarding2's
// chat IS a model conversation; this one deliberately is not, because nothing here needs
// interpreting: six fields and a fork. A model would add latency, cost and a way for the funnel
// to say something nobody wrote.
//
// ‼️ IT POSTS ONCE, AT THE END, AND THE END IS THE FORK. Nothing is sent while she is typing.
// That means a clinic that abandons halfway leaves no half-lead, which is the right trade for a
// funnel somebody reaches from an email we sent them: a partial row would start a follow-up
// sequence against somebody who never finished telling us who they are.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { calendlyEmbedUrl } from "@/lib/calendly";
import { validEmail, validName } from "@/lib/medspa/validate";
import {
  CARDS_CLOSE,
  CARDS_FORK,
  CARDS_FREE_SITE,
  CARDS_HERO,
  CARDS_PLATFORM_STEP,
  CARDS_SCRIPT,
  CARDS_SLOTS,
  DAYPART_STEP,
  DAY_STEP,
  NO_WEBSITE,
  type CardKey,
  type CardStep,
  type CardsFinish,
} from "@/config/onboarding-cards";

const GAP_MS = { min: 420, max: 820 } as const;

type Awaiting = "none" | "text" | "chips" | "consent" | "fork" | "freesite" | "slots" | "done";

/** One offering from Calendly's own availability, with the URL that books that exact time. */
interface Slot {
  startTime: string;
  schedulingUrl: string;
  label: string;
}

/**
 * The next three days, in the VISITOR's own zone, labelled the way a person says them.
 *
 * ‼️ THE OFFSET TRAVELS AND THE LABEL DOES NOT. The server resolves the day from the integer
 * against the same zone, so nothing depends on two machines agreeing about what a date string
 * means. See the header of /api/cards/slots.
 */
function nextDays(now: Date = new Date()): Array<{ label: string; offset: number }> {
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "long" });
  return [0, 1, 2].map((offset) => {
    const d = new Date(now.getTime() + offset * 86_400_000);
    const label = offset === 0 ? "Today" : offset === 1 ? "Tomorrow" : weekday.format(d);
    return { label, offset };
  });
}

interface Bubble {
  id: number;
  from: "them" | "her";
  text: string;
}

type Answers = Partial<Record<CardKey, string>>;

/**
 * A website as typed, or null.
 *
 * ‼️ A SHAPE CHECK AND NOT A REACHABILITY CHECK. "yourclinic.com" with no scheme is what people
 * type and is accepted; a bare word with no dot is not, because that is a typo rather than a
 * domain. We do not fetch it here: a clinic whose site is down for an hour must still be able to
 * finish this, and whether the site exists is the crawler's question, not the funnel's.
 */
function cleanWebsite(raw: string): string | null {
  const value = raw.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (!value || value.length > 253) return null;
  // One dot, no spaces, and a plausible TLD. Deliberately loose on the rest.
  return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(value) ? value : null;
}

export function CardsClient() {
  const [answers, setAnswers] = useState<Answers>({});
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [index, setIndex] = useState(0);
  const [awaiting, setAwaiting] = useState<Awaiting>("none");
  const [typing, setTyping] = useState(false);
  const [composed, setComposed] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [finish, setFinish] = useState<CardsFinish | null>(null);
  const [freeSite, setFreeSite] = useState<boolean | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [bookingUrl, setBookingUrl] = useState<string | null>(null);
  const [booked, setBooked] = useState(false);
  // ‼️ THE CHAT DOES NOT START UNTIL THE CARD IS TAPPED. Matthew, 2026-10-06: this page
  // should open the way the review walk does, on a card that says what they are getting, with the
  // chat taking its place in the same box.
  const [started, setStarted] = useState(false);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  // Refs, not state: the Calendly listener reads them from a closure set up once, so it has to
  // see the latest value rather than the one that existed when it subscribed. The same shape
  // chatgpt-ads-client.tsx uses, and for the same reason.
  const contactId = useRef<string | null>(null);
  const pendingSlot = useRef<Slot | null>(null);
  const bookedOnce = useRef(false);
  const days = useMemo(() => nextDays(), []);

  const bubbleId = useRef(0);
  const played = useRef<Set<string>>(new Set());
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([]);
  const endRef = useRef<HTMLDivElement | null>(null);

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

  /**
   * The walk, after the main script: the free-site offer when they have no website, then the
   * platform question when they chose to set it up themselves.
   *
   * ‼️ BUILT AS A LIST RATHER THAN BRANCHED INLINE, so the whole conversation is readable in one
   * place and the exclusivity of the fork is visible: the platform step is in this array only
   * when `finish` is "self".
   */
  const steps = useMemo<CardStep[]>(() => {
    const out = [...CARDS_SCRIPT];
    // ‼️ THE CALL BRANCH ASKS WHEN, THE SELF BRANCH ASKS WHICH PLATFORM, AND NEITHER EVER ASKS
    // BOTH. The daypart question is the same shape the concierge's referral walk uses, which is
    // what Matthew means by "the exact same flow": two chips, a preference recorded on the lead,
    // and the calendar still doing the actual booking.
    if (finish === "call") {
      // ‼️ WHICH DAY, THEN WHICH HALF OF IT, THEN TWO REAL TIMES. Matthew's order, and it
      // narrows the way a person actually decides: a grid of thirty openings is a decision, two
      // openings on a day they already named is a tap.
      out.push({
        kind: "chips",
        id: DAY_STEP.id,
        key: DAY_STEP.key,
        prompt: DAY_STEP.prompt,
        options: days.map((d) => d.label),
      });
      out.push(DAYPART_STEP);
    }
    if (finish === "self") out.push(CARDS_PLATFORM_STEP);
    return out;
  }, [finish, days]);

  const step = steps[index];

  // ── The driver ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!started) return;
    if (!step) return;
    if (played.current.has(step.id)) return;
    played.current.add(step.id);

    setTyping(true);
    later(() => {
      setTyping(false);
      if (step.kind === "say") {
        push("them", step.text);
        setIndex((i) => i + 1);
        return;
      }
      push("them", step.kind === "consent" || step.kind === "fork" ? step.prompt : step.prompt);
      setAwaiting(
        step.kind === "ask"
          ? "text"
          : step.kind === "chips"
            ? "chips"
            : step.kind === "consent"
              ? "consent"
              : "fork"
      );
    }, index === 0 ? GAP_MS.min : GAP_MS.max);
  }, [started, step, index, push, later]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [bubbles, typing]);

  /**
   * Calendly tells the parent window when a booking completes.
   *
   * ‼️ THE ORIGIN IS CHECKED, because this listens on `window` and anything can post to it. The
   * only message that moves this screen on is one from calendly.com saying `calendly.event_
   * scheduled`; everything else is ignored, including a well-meaning extension.
   *
   * ‼️ AND IT ONLY EVER CONFIRMS. Nothing here re-sends the lead or changes what was stored: the
   * lead went in before the calendar was ever rendered, so a booking that fails to emit costs a
   * line of copy rather than the clinic.
   */
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      // ‼️ EXACT ORIGIN, AND IT USED TO BE endsWith("calendly.com"). That accepted
      // evilcalendly.com, which is the whole point of an origin check. chatgpt-ads-client.tsx
      // already compared exactly; this one is now the same.
      if (e.origin !== "https://calendly.com") return;
      const data = e.data as { event?: string; payload?: { event?: { uri?: string } } } | null;
      if (!data || typeof data !== "object" || data.event !== "calendly.event_scheduled") return;
      // Once. Calendly can emit more than one message, and a second notice is a second booking
      // in the thread that nobody made.
      if (bookedOnce.current) return;
      bookedOnce.current = true;
      setBooked(true);

      // ‼️ TELLING SLACK IS THE POINT OF THIS LISTENER NOW. Until 2026-10-06 a completed booking
      // set one boolean here and notified nobody: the #hot-leads card went out when the questions
      // were answered, and the thing worth interrupting somebody for happened afterwards.
      //
      // Fire and forget, and deliberately so. Their screen is finished; a failed notification is
      // ours to notice in the logs and never theirs to retry.
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

  /** Her typed answer, validated before it is kept. */
  function commit(raw: string) {
    if (!step || step.kind !== "ask") return;
    const value = raw.trim();

    // ‼️ VALIDATED HERE AND AGAIN ON THE SERVER. This arm is for her benefit, so the message
    // names the field and the fix; the route's copy of the same rules is the one that protects
    // the row, because a client check is a courtesy and never a boundary.
    if (step.validate === "email" && !validEmail(value)) {
      setFieldError("That does not look like an email address.");
      return;
    }
    if (step.validate === "name" && !validName(value)) {
      setFieldError("Please type a name we can use.");
      return;
    }
    if (step.validate === "website") {
      const site = cleanWebsite(value);
      if (!site) {
        setFieldError("Type it like yourclinic.com, or tap the button below.");
        return;
      }
      accept(step.key, site, site);
      return;
    }

    accept(step.key, value, value);
  }

  /** Store an answer, show it in the transcript, and move on. */
  function accept(key: CardKey, stored: string, shown: string) {
    setFieldError(null);
    push("her", shown);
    setAnswers((prev) => ({ ...prev, [key]: stored }));
    setComposed("");
    setAwaiting("none");
    setIndex((i) => i + 1);
  }

  /**
   * "We do not have one."
   *
   * ‼️ IT IS AN ANSWER AND NOT A SKIP, which is why it stores a sentinel. Downstream this earns
   * the free website offer and a line on the Slack card; an empty string would be
   * indistinguishable from never having asked.
   */
  function noWebsite() {
    if (!step || step.kind !== "ask" || !step.skip) return;
    setFieldError(null);
    push("her", step.skip.label);
    setAnswers((prev) => ({ ...prev, website: NO_WEBSITE }));
    setComposed("");
    setAwaiting("none");
    // The offer comes before the next scripted question, so it reads as a reaction to what she
    // just said rather than as an unrelated upsell three screens later.
    setTyping(true);
    later(() => {
      setTyping(false);
      push("them", CARDS_FREE_SITE.prompt);
      setAwaiting("freesite");
    }, GAP_MS.max);
  }

  function answerFreeSite(yes: boolean) {
    push("her", yes ? CARDS_FREE_SITE.yes : CARDS_FREE_SITE.no);
    setFreeSite(yes);
    setAwaiting("none");
    setTyping(true);
    later(() => {
      setTyping(false);
      push("them", yes ? CARDS_FREE_SITE.ackYes : CARDS_FREE_SITE.ackNo);
      setIndex((i) => i + 1);
    }, GAP_MS.min);
  }

  function acknowledge() {
    if (!step || step.kind !== "consent") return;
    push("her", step.cta);
    setAwaiting("none");
    setIndex((i) => i + 1);
  }

  /**
   * The fork, and the one place this funnel writes anything.
   *
   * ‼️ TAKING ONE CLOSES THE OTHER. Picking the call sends the lead and hands over a booking
   * link; the platform question is never appended, because the platform is decided on the call
   * with somebody who can explain the trade. Picking self-serve appends exactly one question.
   */
  function choose(which: CardsFinish) {
    // ‼️ THE CLOSED BRANCH CANNOT BE CHOSEN AT ALL, not merely discouraged. Its button is
    // disabled and this is the second guard, because a disabled button is a rendering detail and
    // this function is the decision.
    if (!CARDS_FORK[which].available) return;
    push("her", CARDS_FORK[which].label);
    setFinish(which);
    setAwaiting("none");
    // Both branches now walk into one more question, appended by `steps`. The lead is sent once
    // that answer is in, by the effect below.
    setIndex((i) => i + 1);
  }

  /** Send the lead. Called once, from the branch that completes the walk. */
  async function send(which: CardsFinish, platform: string | null) {
    setBusy(true);
    setSendError(null);
    try {
      const res = await fetch("/api/cards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...answers,
          finish: which,
          platform,
          daypart: answers.daypart ?? null,
          freeWebsite: freeSite === true,
          sourcePage: typeof window === "undefined" ? "" : window.location.pathname,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        bookingUrl?: string;
        contactId?: string;
      };
      if (!json.ok) {
        setSendError(json.error ?? "That did not go through. Please reply to our email instead.");
        return;
      }
      if (json.bookingUrl) setBookingUrl(json.bookingUrl);
      if (json.contactId) contactId.current = json.contactId;

      // ‼️ THE SELF BRANCH ENDS HERE AND THE CALL BRANCH HAS ONE MORE BEAT. Only somebody
      // booking a call needs a time, and only they named a day and a half-day to look one up with.
      if (which !== "call") {
        setTyping(true);
        later(() => {
          setTyping(false);
          push("them", CARDS_CLOSE[which]);
          setAwaiting("done");
        }, GAP_MS.min);
        return;
      }

      setTyping(true);
      const found = await loadSlots();
      setTyping(false);

      if (found.length === 0) {
        // Availability unreadable, or that half-day full. Either way the calendar is the answer
        // and the copy says so rather than pretending we chose to skip the shortcut.
        push("them", CARDS_SLOTS.none);
        setAwaiting("done");
        return;
      }

      setSlots(found);
      push("them", CARDS_SLOTS.prompt);
      setAwaiting("slots");
    } catch {
      setSendError("That did not go through. Please reply to our email instead.");
    } finally {
      setBusy(false);
    }
  }


  /**
   * Two real openings on the day and half-day they named, or none.
   *
   * ‼️ IT NEVER THROWS AND NEVER BLOCKS THE BOOKING. Calendly being slow or the token being
   * unset both come back as an empty list, and an empty list means the full calendar. A clinic
   * that has answered six questions must not lose the call because a shortcut failed.
   */
  const loadSlots = useCallback(async (): Promise<Slot[]> => {
    const chosen = days.find((d) => d.label === answers.callDay);
    try {
      const res = await fetch("/api/cards/slots", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dayOffset: chosen?.offset ?? 0,
          daypart: answers.daypart ?? "",
          // Their zone decides which day "Today" was and where noon falls.
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
      });
      const json = (await res.json()) as { slots?: Slot[] };
      return Array.isArray(json.slots) ? json.slots : [];
    } catch {
      return [];
    }
  }, [days, answers.callDay, answers.daypart]);

  /**
   * They took one of the two.
   *
   * ‼️ THE SLOT'S OWN URL, PREFILLED, AND CALENDLY STILL CONFIRMS IT. We cannot create the
   * invitee from here: the API does not do it on this plan. What this buys is that the time is
   * already chosen and the name and email are already in the boxes, so the last screen is a
   * button. A slot taken in the meantime fails on Calendly's side, which is the only side that
   * can know.
   *
   * ‼️ SHAPED BY calendlyEmbedUrl AND NOT BY HAND, AND THAT IS A FIX RATHER THAN A TIDY-UP. Until
   * 2026-10-06 this built the query string itself, with name and email and nothing else, which
   * meant no `embed_type=Inline`. That parameter is the one its helper's header is in capitals
   * about: it "IS WHAT MAKES CALENDLY POST event_scheduled TO THE PARENT WINDOW, AND WITHOUT IT A
   * BOOKING SILENTLY DEAD-ENDS". So taking either of the two offered times booked the call
   * perfectly and told nobody: the listener below never fired, /api/cards/booked was never called,
   * and the #hot-leads thread never heard about it. Only the no-slots fallback notified anybody,
   * because that URL comes from /api/cards, which went through this helper all along. The helper
   * exists precisely so a third caller does not rediscover this the hard way, and this was the
   * third caller.
   *
   * Prefill cannot move to the server: /api/cards/slots is public and deliberately holds no name,
   * no email and no lead id, so the only place that knows who is booking is here.
   */
  function takeSlot(slot: Slot) {
    const name = [answers.firstName, answers.lastName].filter(Boolean).join(" ");
    const embed = calendlyEmbedUrl(slot.schedulingUrl, { name, email: answers.email ?? null });

    // A slot URL Calendly minted parses, so this is belt and braces. If it ever does not, the
    // whole-calendar URL from /api/cards is already in state and the copy says what happened,
    // rather than mounting a frame with `null` in its src.
    if (!embed) {
      push("them", CARDS_SLOTS.none);
      setAwaiting("done");
      return;
    }

    pendingSlot.current = slot;
    setBookingUrl(embed);
    push("her", slot.label);
    push("them", CARDS_SLOTS.booking);
    setAwaiting("done");
  }

  /** The escape from the two. Only now does the whole calendar appear. */
  function wantAnotherTime() {
    push("her", CARDS_SLOTS.another);
    push("them", CARDS_CLOSE.call);
    setAwaiting("done");
  }

  // Either tail completes when its one answer lands and the walk runs out of steps.
  useEffect(() => {
    if (!finish) return;
    if (step) return; // still walking
    if (awaiting === "done" || busy) return;
    const tail = finish === "call" ? answers.daypart : answers.platform;
    if (!tail) return;
    void send(finish, finish === "self" ? answers.platform ?? null : null);
    // `send` closes over state that is settled by the time the walk has run out of steps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finish, answers.platform, answers.daypart, step]);

  const canSend = composed.trim().length > 0;

  // ‼️ THE CARD IS THE WHOLE PAGE UNTIL IT IS TAPPED, AND THEN THE CHAT TAKES ITS PLACE IN THE
  // SAME BOX. The review walk does exactly this and a clinic sees both; two different front doors
  // would be two products. Nothing is queried and no lead exists until the first answer, so this
  // card costs a visitor nothing.
  if (!started) {
    return (
      <div className="cd-open">
        {/* The promise, then a rule, then what it actually is. Two blocks in one box rather than
            a headline floating above a card, which is what this used to be. */}
        <p className="cd-open-eyebrow">{CARDS_HERO.topEyebrow}</p>
        <h1 className="cd-open-promise">{CARDS_HERO.topTitle}</h1>
        <p className="cd-open-sub">{CARDS_HERO.topSub}</p>

        <hr className="cd-open-rule" />

        <p className="cd-open-eyebrow">{CARDS_HERO.eyebrow}</p>
        <h2 className="cd-open-title">{CARDS_HERO.title}</h2>
        <p className="cd-open-lede">{CARDS_HERO.lede}</p>
        <ul className="cd-open-facts">
          {CARDS_HERO.facts.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
        <button type="button" className="cd-primary cd-open-cta" onClick={() => setStarted(true)}>
          {CARDS_HERO.cta}
        </button>
      </div>
    );
  }

  return (
    <div className="cd-shell">
      <div className="cd-head">
        <span className="cd-dot" aria-hidden="true" />
        <span className="cd-title">SRT</span>
      </div>

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

      {sendError && (
        <p className="cd-error" role="alert">
          {sendError}
        </p>
      )}

      {awaiting === "text" && step?.kind === "ask" && (
        <div className="cd-composer">
          <div className="cd-bar">
            <input
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
            <button type="button" onClick={() => commit(composed)} disabled={!canSend}>
              Send
            </button>
          </div>
          {fieldError && (
            <p className="cd-error" role="alert">
              {fieldError}
            </p>
          )}
          {step.skip && (
            <button type="button" className="cd-skip" onClick={noWebsite}>
              {step.skip.label}
            </button>
          )}
        </div>
      )}

      {awaiting === "chips" && step?.kind === "chips" && (
        <div className="cd-chips">
          {step.options.map((option) => (
            <button key={option} type="button" onClick={() => accept(step.key, option, option)}>
              {option}
            </button>
          ))}
        </div>
      )}

      {awaiting === "freesite" && (
        <div className="cd-chips is-pair">
          <button type="button" onClick={() => answerFreeSite(true)}>
            {CARDS_FREE_SITE.yes}
          </button>
          <button type="button" onClick={() => answerFreeSite(false)}>
            {CARDS_FREE_SITE.no}
          </button>
        </div>
      )}

      {awaiting === "consent" && step?.kind === "consent" && (
        <div className="cd-composer">
          <button type="button" className="cd-primary" onClick={acknowledge}>
            {step.cta}
          </button>
        </div>
      )}

      {awaiting === "fork" && (
        <div className="cd-fork">
          {(["call", "self"] as const).map((key) => {
            const open = CARDS_FORK[key].available;
            return (
              <button
                key={key}
                type="button"
                className={`cd-choice${key === "call" ? " is-primary" : ""}${open ? "" : " is-closed"}`}
                // ‼️ DISABLED AND SAYING SO, rather than live-looking and failing. See the note on
                // CARDS_FORK.self: a greyed-out option a clinic can read is a roadmap item; a
                // button that swallows a minute of their time and then dies is something else.
                disabled={busy || !open}
                aria-disabled={!open}
                onClick={() => choose(key)}
              >
                <span className="cd-choice-label">{CARDS_FORK[key].label}</span>
                <span className="cd-choice-note">{CARDS_FORK[key].note}</span>
              </button>
            );
          })}
        </div>
      )}

      {/*
        ‼️ TWO OPENINGS AND AN ESCAPE. Both buttons carry a real Calendly time; the third is the
        way out to the whole calendar, which is the only thing that was ever offered before.
      */}
      {awaiting === "slots" && slots && (
        <div className="cd-chips is-stack">
          {slots.map((s) => (
            <button key={s.startTime} type="button" onClick={() => takeSlot(s)}>
              {s.label}
            </button>
          ))}
          <button type="button" className="cd-skip" onClick={wantAnotherTime}>
            {CARDS_SLOTS.another}
          </button>
        </div>
      )}

      {awaiting === "done" && bookingUrl && !booked && (
        <div className="cd-cal">
          {/*
            ‼️ THE CALENDAR IS INSIDE THE WINDOW, NOT A LINK OUT. Matthew, 2026-10-05: onboarding2
            "was adding a widget to the thing making it better because they had to book the call
            inside of the UI which is what i want". Every hop out of this card is somewhere to
            lose a clinic that has already answered six questions.

            ‼️ embed_domain IS APPENDED HERE AND NOT ON THE SERVER. It has to be the host the
            BROWSER is on, and the server cannot know whether that is the apex, mission, or a
            preview deployment. Getting it wrong does not break the frame; it stops Calendly
            emitting event_scheduled, which is the silent failure the helper's header describes.
          */}
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
          <p className="cd-booked">You are booked. We will see you then.</p>
        </div>
      )}
    </div>
  );
}
