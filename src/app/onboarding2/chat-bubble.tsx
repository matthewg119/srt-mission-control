"use client";

// The assistant. THE WHOLE PAGE, from the moment identity is in.
//
// ‼️ IT IS NO LONGER A CORNER BUBBLE ANYWHERE (2026-09-04). It used to be one while somebody read
// the contract, and the `signed` prop picked between that and the full-page questions. There is
// no contract on screen to sit beside: the funnel is six fields, then this. `fullscreen` is
// still a prop because the component can still be laid out either way, and losing that would be
// throwing away the layout for no reason.
//
// ‼️ TWO PHASES, ONE THREAD, AND IT DECIDES NEITHER. First it books a call, then it asks the
// questions. Which of the two a turn belongs to is decided SERVER-SIDE off the lead row
// (booked_slot_at), not here, because that is an authorisation boundary and component state is
// not one. What this file owns is what a phase LOOKS like: chips, a calendar, a summary card.
//
// ‼️ IT READS LIKE A TEXTING APP (Matthew, 2026-09-03). Full bleed, message bubbles, tappable
// answers, three dots while it thinks. A corner widget was fine for "question about clause 4"; it
// is the wrong shape for the only thing on the screen.
//
// ‼️ TWO OR THREE MESSAGES ARRIVE AT A TIME, STAGGERED. The route returns an array and this
// component paints them one at a time with a gap, because six bubbles appearing simultaneously is
// not what two or three messages in a row looks like. The split rule is server-side in
// lib/onboarding2/texting.ts; the only thing decided here is the delay between them.
//
// Non-streaming, like everything else in this repo. runConversationWithTools does not stream and
// streamChatResponse has no tool support, so streaming would mean a second code path. A silent
// three to eight second gap reads as broken, so the mitigation is the typing indicator and a low
// maxTokens on the server. A stated cost rather than a hidden one.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  CHAT_UI,
  CLOSING_SUMMARY,
  DAYPART_OPTIONS,
  OTHER_PROMPT,
  QUALIFYING_INTRO,
  SCHEDULING_INTRO,
  SCHEDULING_INTRO_KNOWN,
  SCHEDULING_UI,
} from "@/config/onboarding2";
import { OFFER_INCLUDES } from "@/config/pitch";
import { BUBBLE_GAP_MS } from "@/lib/onboarding2/texting";

const REEF = "#00C9A7";

// The Virtual Agent panel's palette, copied BY VALUE from src/app/hub/[host]/hub.css.
//
// ‼️ THIS IS A COPY, AND IT IS DELIBERATELY NOT A THIRD SURFACE IN THE GRAMMAR PROBE.
// scripts/_probe-virtual-agent-grammar.ts holds exactly two surfaces together: hub.css, where the review
// panel resolves --va-accent to the client's own colour, and w/[slug]/route.ts, where the widget carries
// SRT's as a hex literal. Its third check partitions the accent source into precisely those two cases,
// its first two checks are two-term booleans, and its rule parser reads CSS braces. onboarding2 has no
// stylesheet at all, by a decision recorded in layout.tsx with two named traps behind it, and declares
// no --va-* tokens anywhere.
//
// Making it a third surface would mean either reversing that decision or teaching the probe to read
// Tailwind class literals, which is a parser it cannot honestly have. So this page LOOKS like the panel
// and is not claimed to BE it. If these values and hub.css ever disagree, hub.css is right.
const PANEL = {
  bg: "#ffffff",
  ink: "#14181f",
  mut: "#5b6672",
  line: "#e3e8ec",
  card: "#f2f5f7",
  onAccent: "#04252b",
} as const;

/**
 * Stamp the browser's own hostname onto the Calendly URL.
 *
 * ‼️ WITHOUT `embed_domain` CALENDLY DOES NOT POST event_scheduled AND THE CONVERSATION STOPS
 * DEAD. That is exactly what happened on 2026-09-04: the booking went through, the iframe showed
 * "You are scheduled!", and the thread underneath never continued. `embed_type=Inline` is set
 * server-side in lib/onboarding2/booking.ts; this half has to happen in the browser because the
 * value must be the host the page is actually being served from, and the same deployment answers
 * on the apex, on the mission subdomain and on a *.vercel.app preview.
 *
 * Falls back to the untouched URL rather than throwing: a calendar that renders and does not
 * report back is worse than one that reports back, and far better than no calendar at all.
 */
function embedUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.searchParams.set("embed_domain", window.location.hostname);
    url.searchParams.set("embed_type", "Inline");
    return url.toString();
  } catch {
    return raw;
  }
}

interface Msg {
  role: "user" | "assistant";
  content: string;
}

interface ChatReply {
  ok?: boolean;
  messages?: string[];
  options?: string[];
  otherOption?: string | null;
  /** True once a call day is stored. The conversation is over and the summary takes the screen. */
  scheduled?: boolean;
  callLabel?: string | null;
  duplicate?: boolean;
  error?: string;
  /** Present only on the turn a day is agreed. The Calendly embed mounts on it. */
  bookingUrl?: string | null;
}

/**
 * !! THE `signed` PROP WAS REMOVED ON 2026-09-04. It picked the opener and the placeholder, and
 * it distinguished "reading the agreement" from "answering the questions". Neither state exists:
 * the agreement is no longer read here, so every session that reaches this component has been
 * through screen one and is on its way to a booking.
 *
 * It was never an authorisation boundary. The server reads the mode off the signing row
 * (modeFor in lib/onboarding2/chat-store.ts) and always did.
 */
export function ChatPanel({
  sessionToken,
  fullscreen = false,
  demo,
  knownIdentity = false,
  layout = "panel",
  title,
}: {
  sessionToken: string;
  /**
   * Fill the viewport at every width instead of floating as a panel above 640px.
   *
   * ‼️ NOTHING PASSES THIS ANY MORE, AND THE BRANCHES STAY ANYWAY (2026-09-25). Both call sites in
   * onboarding2-client.tsx dropped it when Matthew asked for the review tool's panel here; the comment
   * at the top of this file already records why the layout is worth keeping either way, and the panel
   * itself is full bleed below 640px, so "full screen on a phone" is not what this prop buys. What it
   * buys is full screen on a DESKTOP, which is a different product decision and one that was made and
   * then reversed once. Optional rather than deleted so reversing it again is one word.
   */
  fullscreen?: boolean;
  demo: boolean;
  /**
   * The session already knows their name, website, phone and email.
   *
   * ‼️ IT CHANGES THE OPENING LINES AND NOTHING ELSE, AND THAT IS THE POINT. The server is
   * already correct without being told: /start wrote the four identity columns, so
   * nextIntakeStep() finds them filled and the first real turn comes back as the daypart. What it
   * could not fix is the two bubbles this component paints BEFORE any turn exists, which are
   * hard-coded to SCHEDULING_INTRO and open on "What is your business website?" That question was
   * answered three steps before the offer, and re-asking it is the most visible possible way to
   * tell somebody their answers were thrown away.
   *
   * ‼️ THE CHIPS ARE SEEDED WITH IT, for the reason the mount effect already records: the route
   * only returns options once there is a turn to answer, so the first question on screen has none
   * unless this component supplies them. SCHEDULING_INTRO_KNOWN ends on DAYPART_PROMPT, which is a
   * two-chip question, so it needs the same seeding the daypart used to get when it opened cold.
   */
  knownIdentity?: boolean;
  /**
   * Where the panel sits above 640px. See the note over `shell` below.
   *
   * "panel" is the floating bottom-right card the review tool uses and is the default everywhere.
   * "centre" is a centred, phone-proportioned card, for a route where this panel IS the page.
   */
  layout?: "panel" | "centre";
  /**
   * The header line.
   *
   * ‼️ CHAT_UI.title IS "Questions about the agreement" AND IT IS WRONG ON A BOOKING THREAD. It
   * was written when this panel sat beside a contract somebody was reading, and it survived the
   * removal of that screen: a visitor answering "mornings or afternoons" is currently told they are
   * asking questions about an agreement that is not on screen and will not be signed here. Passed
   * in rather than changed at source, because the constant is still exactly right on /sign/[token].
   */
  title?: string;
}) {
  // ‼️ IT STARTS OPEN, AND SEEDING THIS FROM `fullscreen` WAS A BUG I SHIPPED (2026-09-25). This
  // component is only rendered at stage === "chat", which is the moment the conversation IS the page, so
  // there is never a reason for it to start collapsed. It used to read `fullscreen`, which was always
  // true, so the bug was invisible until the panel change made that prop default false: picking an offer
  // then rendered the 56px circle below instead of the chat, and looked like nothing had happened.
  //
  // The circle stays as the way back, because the close button is the only thing that sets this false.
  const [open, setOpen] = useState(true);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [options, setOptions] = useState<string[]>([]);
  const [otherOption, setOtherOption] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState(false);
  /** The "please be specific" popup behind the Other chip. */
  const [otherOpen, setOtherOpen] = useState(false);
  const [otherText, setOtherText] = useState("");
  /** Set once every question is answered. The summary card closes the conversation out. */
  const [scheduled, setScheduled] = useState(false);
  const [callLabel, setCallLabel] = useState<string | null>(null);
  /**
   * The Calendly embed, mounted mid-conversation once a day is agreed.
   *
   * !! THE URL COMES FROM THE ROUTE, NOT FROM THE MODEL. It is a field on the JSON response,
   * built by lib/onboarding2/booking.ts on a turn Claude never sees. Nothing the assistant says
   * can produce a link, which is the guarantee config/onboarding2.ts describes.
   */
  const [bookingUrl, setBookingUrl] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  /** The composer, so the answer to the next question can be typed without a click. */
  const entryRef = useRef<HTMLTextAreaElement>(null);

  // The effect that forced it open went with the line above: it can no longer be closed by mistake, and
  // re-opening on a prop change would fight the close button rather than help it.

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy, options]);

  // ── THE COMPOSER TAKES ITS FOCUS BACK THE MOMENT THE ASSISTANT IS DONE ──
  //
  // ‼️ MATTHEW'S RULE, AND IT IS A RULE FOR EVERY CONVERSATIONAL SURFACE WE SHIP, not a nicety on
  // this one (2026-09-30). Seven questions answered on a laptop is seven answers and, without
  // this, seven clicks back into the box between them. The click is invisible in a demo and
  // relentless when you are the one filling the funnel in.
  //
  // ‼️ NOT ON A TOUCH DEVICE. Focusing a textarea on a phone opens the soft keyboard, so a reader
  // who has just been handed three bubbles to read would get half the panel eaten by a keyboard
  // they did not ask for, mid-scroll. `hover: none` is the honest test for "no mouse here" and is
  // read at the moment of focusing rather than cached, so a tablet that gains a keyboard is not
  // stuck with the answer it gave on first render.
  //
  // ‼️ preventScroll IS LOAD-BEARING. The composer sits below the scrolling message column, and a
  // default focus() scrolls it into view, which drags the thread away from the bubble that just
  // arrived. The effect above has already put the reader at the bottom; this must not fight it.
  useEffect(() => {
    if (busy || scheduled || otherOpen) return;
    // The calendar owns the screen while it is up, and a focused textarea behind an iframe is a
    // keystroke going somewhere nobody can see.
    if (bookingUrl && !booking) return;
    if (typeof window !== "undefined" && window.matchMedia("(hover: none)").matches) return;
    const id = window.setTimeout(() => {
      try {
        entryRef.current?.focus({ preventScroll: true });
      } catch {
        // Older Safari has no options argument on focus(). A focused box that scrolled is still
        // better than a box nobody can type into.
        entryRef.current?.focus();
      }
    }, 40);
    return () => window.clearTimeout(id);
  }, [busy, scheduled, otherOpen, bookingUrl, booking, messages.length]);

  /**
   * Paint an array of bubbles one at a time.
   *
   * ‼️ THE TYPING INDICATOR STAYS UP BETWEEN THEM, which is what makes three bubbles read as
   * somebody typing three messages rather than as one message that arrived in pieces.
   */
  const paint = useCallback(async (incoming: string[]) => {
    for (let i = 0; i < incoming.length; i++) {
      if (i > 0) {
        const gap =
          BUBBLE_GAP_MS.min + Math.round((BUBBLE_GAP_MS.max - BUBBLE_GAP_MS.min) * (i % 2 ? 0.8 : 0.35));
        await new Promise((r) => setTimeout(r, gap));
      }
      const text = incoming[i];
      setMessages((m) => [...m, { role: "assistant", content: text }]);
    }
  }, []);

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || busy) return;
      setMessages((m) => [...m, { role: "user", content: message }]);
      setInput("");
      // The chips belong to the question that was on screen. The moment it is answered they are
      // stale, and leaving them up invites a second tap that answers the next question by accident.
      setOptions([]);
      setOtherOption(null);
      setBusy(true);
      try {
        const res = await fetch("/api/onboarding2/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionToken, message }),
        });
        const data = (await res.json()) as ChatReply;
        const incoming = data.messages ?? [];
        if (incoming.length) await paint(incoming);
        else if (!data.ok) {
          setMessages((m) => [...m, { role: "assistant", content: CHAT_UI.offline }]);
        }
        setOptions(data.options ?? []);
        setOtherOption(data.otherOption ?? null);
        if (data.bookingUrl) setBookingUrl(data.bookingUrl);
        if (data.scheduled) {
          setCallLabel(data.callLabel ?? null);
          setScheduled(true);
        }
      } catch {
        setMessages((m) => [...m, { role: "assistant", content: CHAT_UI.offline }]);
      } finally {
        setBusy(false);
      }
    },
    [busy, paint, sessionToken]
  );

  // ───────────────────────────────────────────────────────────────────────────
  // Calendly reporting a booking.
  //
  // ‼️ THE ORIGIN CHECK IS NOT OPTIONAL AND IT IS ALSO NOT SUFFICIENT. Without it, any page that
  // opened this one could post a fake event_scheduled and write a booking that never happened.
  // With it, the browser is honest, and a script POSTing to /api/onboarding2/booked directly is
  // not affected at all. The real guard is server-side: that route verifies the event URI against
  // Calendly's API before it writes or provisions anything. This is the cheap half.
  // ───────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!bookingUrl) return;

    async function onMessage(e: MessageEvent) {
      if (e.origin !== "https://calendly.com") return;
      const data = e.data as { event?: string; payload?: Record<string, unknown> } | null;
      if (!data || data.event !== "calendly.event_scheduled") return;

      setBooking(true);
      const payload = (data.payload ?? {}) as {
        event?: { uri?: string };
        invitee?: { uri?: string };
      };

      let confirmed = false;
      try {
        const res = await fetch("/api/onboarding2/booked", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionToken,
            eventUri: payload.event?.uri ?? null,
            inviteeUri: payload.invitee?.uri ?? null,
          }),
        });
        const json = (await res.json()) as { ok?: boolean };
        confirmed = json.ok === true;
      } catch {
        confirmed = false;
      }

      // ‼️ THE CALENDAR COMES DOWN EITHER WAY, AND THE COPY DOES NOT LIE EITHER WAY. Calendly has
      // taken the booking and sent its own confirmation regardless of what our route said; what a
      // failure here means is that WE did not record it. Leaving the embed up would invite a
      // second booking for the same call. Claiming the email when the write failed would be the
      // one sentence this close cannot get wrong, so the two messages are separate constants.
      setBookingUrl(null);
      setBooking(false);
      setMessages((m) => [
        ...m,
        { role: "assistant", content: confirmed ? SCHEDULING_UI.emailSent : SCHEDULING_UI.noCalendar },
        { role: "assistant", content: QUALIFYING_INTRO },
      ]);
      // The first question. Sent as a turn because the questions live in the system prompt, which
      // is the one place they are allowed to live.
      void send("Ready for the questions.");
    }

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [bookingUrl, sessionToken, send]);

  // !! THE CONVERSATION OPENS ON SCHEDULING, NOT ON THE QUESTIONS (2026-09-04).
  //
  // Both opening lines are LOCAL, and there is no kick-off POST any more. It used to send
  // "I'm ready." to make the model ask question one; the first thing that happens now is the
  // daypart, which the deterministic scheduling branch handles without a model at all. Sending a
  // turn just to be told "mornings or afternoons?" would burn a round trip to reach copy we
  // already hold.
  //
  // The daypart chips are seeded here for the same reason: the route only starts returning
  // options once it has a turn to answer, and the first question has no turn before it.
  useEffect(() => {
    if (!open || started) return;
    setStarted(true);
    const intro = knownIdentity ? SCHEDULING_INTRO_KNOWN : SCHEDULING_INTRO;
    setMessages(intro.map((content) => ({ role: "assistant" as const, content })));
    // ‼️ NO CHIPS ON THE OPENING TURN WHEN IT OPENS COLD (2026-09-27). It used to open on the
    // daypart, which is a two-chip question, so the first thing on screen was two buttons. The cold
    // first question is the website, which is typed, and seeding the old options there would put
    // Mornings and Afternoons under "What is your business website?".
    //
    // ‼️ AND THAT IS EXACTLY WHY THEY COME BACK WHEN THE IDENTITY IS ALREADY IN (2026-09-30). The
    // rule was never "no chips on the first turn", it was "the chips must match the question", and
    // SCHEDULING_INTRO_KNOWN ends on DAYPART_PROMPT. Everything after this turn still gets its
    // options from the route, which is where every other question's come from.
    if (knownIdentity) {
      setOptions([DAYPART_OPTIONS.morning, DAYPART_OPTIONS.afternoon]);
    }
  }, [open, started, knownIdentity]);

  function tapOption(value: string) {
    if (otherOption && value === otherOption) {
      // ‼️ HANDLED HERE, NOT BY THE MODEL. Recording the word "Other" as somebody's booking system
      // is an answer nobody can use, and the alternative is the assistant asking "which one?",
      // which is exactly the clarifying follow-up this pass removed everywhere else.
      setOtherText("");
      setOtherOpen(true);
      return;
    }
    void send(value);
  }

  if (!open) {
    return (
      <button
        aria-label={CHAT_UI.title}
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full text-2xl shadow-lg transition hover:opacity-90"
        style={{ backgroundColor: REEF, color: "#04252b" }}
      >
        <span aria-hidden>?</span>
      </button>
    );
  }

  // ‼️ THE PANEL IS FULL BLEED BELOW 640px, AND THAT IS WHAT KEEPS THE CALENDAR USABLE. hub.css
  // does the same thing at the same breakpoint (@media (max-width: 40rem) gives .va-panel inset:0 and no
  // radius), and the reason here is concrete: the Calendly embed mounts INSIDE the scrolling message
  // column, and in the old 70vh card at 375px that iframe was taller than the entire panel. Full bleed on
  // a phone means the booking step is exactly as roomy as it was in full screen.
  //
  // ‼️ AND THE PANEL GROWS WHILE THE CALENDAR IS UP. On a desktop the resting size is hub.css's
  // min(28rem, 100vw-3rem) by min(38rem, 100vh-3rem), which leaves about 500px of column once the header
  // and the composer are out of it. That is a cramped 640px calendar. Booking is the step this page
  // exists for, so it gets more room for as long as it is on screen and gives it back afterwards.
  const calendarUp = Boolean(bookingUrl) && !booking;

  // ── WHERE THE PANEL SITS ABOVE 640px ──
  //
  // ‼️ "centre" IS NOT A SKIN, IT IS WHAT KEEPS THE HANDOVER FROM LOOKING LIKE TWO PRODUCTS
  // (2026-09-30). /onboarding2/start runs its own conversation as a centred, phone-proportioned
  // card and then hands over to this component mid-thread. Left on the corner default, the panel
  // jumped from the middle of the screen to the bottom right at the exact moment somebody chose an
  // offer, which reads as the page having reloaded into something else.
  //
  // ‼️ THE CORNER IS STILL THE DEFAULT, AND DELIBERATELY SO. Matthew asked on 2026-09-25 for this
  // to be the same floating panel the review tool opens in, so that the three places a person meets
  // the assistant are recognisably one product. That call stands everywhere it was made about. What
  // it did not anticipate is a route where the panel IS the page and nothing sits behind it, which
  // is the one case this prop exists for.
  //
  // Below 640px there is no difference at all: full bleed either way, which is what makes the
  // Calendly embed usable on a phone.
  const shell = fullscreen
    ? "fixed inset-0 z-50 flex flex-col"
    : layout === "centre"
      ? [
          "fixed inset-0 z-50 flex flex-col",
          // sm:relative, never sm:static: the "Other" prompt is an absolute child and anchors here.
          "sm:relative sm:z-auto sm:mx-auto sm:overflow-hidden sm:rounded-[22px] sm:border sm:shadow-2xl",
          calendarUp
            ? "sm:h-[min(46rem,calc(100vh-4rem))] sm:w-[min(34rem,calc(100vw-2rem))]"
            : "sm:h-[min(44rem,calc(100vh-4rem))] sm:w-[min(26rem,calc(100vw-2rem))]",
        ].join(" ")
      : [
          "fixed inset-0 z-50 flex flex-col",
          "sm:inset-auto sm:bottom-6 sm:right-6 sm:overflow-hidden sm:rounded-[14px] sm:border sm:shadow-2xl",
          calendarUp
            ? "sm:h-[min(44rem,calc(100vh-3rem))] sm:w-[min(34rem,calc(100vw-3rem))]"
            : "sm:h-[min(38rem,calc(100vh-3rem))] sm:w-[min(28rem,calc(100vw-3rem))]",
        ].join(" ");

  // The centred layout needs a parent to centre it in, and this component is mounted directly
  // under a min-h-screen <main>. Wrapping here rather than at the call site keeps "where the panel
  // sits" a single decision in a single file.
  const wrap =
    layout === "centre" && !fullscreen
      ? "sm:flex sm:min-h-screen sm:flex-col sm:items-center sm:justify-center sm:px-4 sm:py-10"
      : "";

  return (
    <div className={wrap}>
    <div className={shell} style={{ backgroundColor: PANEL.bg, color: PANEL.ink, borderColor: PANEL.line }}>
      {fullscreen && demo && (
        <div className="bg-amber-400 px-4 py-2 text-center text-xs font-bold text-[#0a0a0a]">
          TEST MODE. Nothing here reaches Slack, the CRM, your inbox or the client list.
        </div>
      )}

      <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: PANEL.line }}>
        <span className="text-sm font-semibold">
          {bookingUrl || !scheduled ? (title ?? CHAT_UI.title) : "A few quick questions"}
        </span>
        {/* No close button in full screen. There is nothing behind it to go back to. */}
        {!fullscreen && (
          <button
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="rounded px-2 text-lg text-white/50 hover:text-white"
          >
            x
          </button>
        )}
      </div>

      <div
        ref={scrollRef}
        className={`flex-1 space-y-3 overflow-y-auto px-4 py-4 ${fullscreen ? "mx-auto w-full max-w-2xl" : ""}`}
      >
        {messages.map((m, i) => (
          <div
            key={i}
            className={
              m.role === "user"
                ? "ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm px-3.5 py-2.5 text-sm font-medium"
                : "mr-auto max-w-[90%] whitespace-pre-wrap rounded-2xl rounded-bl-sm px-3.5 py-2.5 text-sm"
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

        {/* ‼️ THREE DOTS, NOT WORDS. The old indicator said "Reading the agreement", which was a
            claim about what the model was doing and plainly wrong once the questions started. */}
        {busy && (
          <div className="mr-auto rounded-2xl rounded-bl-sm bg-white/5 px-4 py-3">
            <div className="flex gap-1">
              <span
                className="h-1.5 w-1.5 animate-bounce rounded-full"
                style={{ backgroundColor: REEF, animationDelay: "0ms" }}
              />
              <span
                className="h-1.5 w-1.5 animate-bounce rounded-full"
                style={{ backgroundColor: REEF, animationDelay: "150ms" }}
              />
              <span
                className="h-1.5 w-1.5 animate-bounce rounded-full"
                style={{ backgroundColor: REEF, animationDelay: "300ms" }}
              />
            </div>
          </div>
        )}

        {/* ‼️ THE CARD THAT ENDS THE CONVERSATION. A thread that just stops leaves somebody at the
            highest point of their confidence in this decision with nothing to hold. This is the
            offer restated and the work named, at the moment they are most glad they signed. */}
        {scheduled && <ClosingSummary callLabel={callLabel} />}

        {/* ‼️ THE CALENDAR, INSIDE THE THREAD. Mounted from a URL the ROUTE returned, never from
            anything the assistant said. It stays until Calendly reports event_scheduled, at which
            point onBooked() unmounts it and the questions begin. */}
        {bookingUrl && !booking && (
          <div className="pt-2">
            {/* ‼️ CAPPED AGAINST THE VIEWPORT, NOT A FLAT 640px. The header and the composer take
                roughly 7rem between them, so a fixed 640px was taller than its own scroll column on any
                short window, and inside the old 70vh card it was taller than the panel on every phone.
                This keeps 640px where there is room and shrinks instead of overflowing where there is
                not.

                The two numbers were measured in a browser, not guessed. 14rem is the header, the
                composer, the column's own padding and the panel's 3rem margin, measured as 112px of
                chrome plus the margin rather than estimated. A 27rem floor was WRONG and the measurement
                caught it: at a 1280x600 window the floor beat the cap and put a 432px calendar inside a
                345px column, which is nested scrolling. 18rem keeps it from collapsing and never wins.
                Measured good at 375x667 (343px wide, 443px tall in a 557px column), 375x812, 1280x800
                and 1280x600. */}
            <iframe
              src={embedUrl(bookingUrl)}
              title="Book your onboarding call"
              className="h-[min(640px,calc(100vh-11rem))] min-h-[18rem] w-full rounded-xl border bg-white"
              style={{ borderColor: PANEL.line }}
            />
          </div>
        )}
        {booking && (
          <p className="pt-2 text-sm text-white/50">One moment, confirming your booking.</p>
        )}

        {/* Tappable answers. Server-computed from the question that was actually asked, so what is
            on screen to tap and what was asked cannot come apart. */}
        {!busy && !scheduled && !bookingUrl && options.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {options.map((o) => (
              <button
                key={o}
                onClick={() => tapOption(o)}
                className="rounded-full border px-3.5 py-2 text-sm font-medium transition hover:bg-white/10"
                style={{ borderColor: REEF, color: REEF }}
              >
                {o}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ‼️ THE COMPOSER GOES AWAY WHEN THE CONVERSATION IS OVER. Leaving a text box under a
          summary invites somebody to type into a thread nothing is listening to any more, and the
          scheduling branch would answer "just tap one of the options below" with no options. */}
      <div
        className={`flex items-end gap-2 border-t p-3 ${scheduled ? "hidden" : ""} ${fullscreen ? "mx-auto w-full max-w-2xl" : ""}`}
        style={{ borderColor: PANEL.line }}
      >
        <textarea
          ref={entryRef}
          rows={1}
          /* 16px on the control itself, or iOS zooms the whole panel on focus. hub.css carries the same
             note on .va-bar textarea, and it is the one place a font size is not a style choice. */
          style={{ backgroundColor: PANEL.bg, color: PANEL.ink, borderColor: PANEL.line, fontSize: 16 }}
          className="max-h-24 flex-1 resize-none rounded-lg border px-3 py-2.5 outline-none focus:border-[#00C9A7]"
          placeholder={CHAT_UI.placeholderPost}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
        />
        <button
          onClick={() => void send(input)}
          disabled={busy || !input.trim()}
          className="rounded-lg px-4 py-2.5 text-sm font-bold disabled:opacity-40"
          style={{ backgroundColor: REEF, color: PANEL.onAccent }}
        >
          Send
        </button>
      </div>

      {otherOpen && !scheduled && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/70 p-6">
          <div className="w-full max-w-sm rounded-xl border border-white/15 bg-[#111] p-5">
            <h2 className="mb-1 text-base font-bold">{OTHER_PROMPT.heading}</h2>
            <p className="mb-4 text-sm text-white/60">{OTHER_PROMPT.body}</p>
            <input
              autoFocus
              className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-white outline-none focus:border-[#00C9A7]"
              value={otherText}
              onChange={(e) => setOtherText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && otherText.trim()) {
                  setOtherOpen(false);
                  void send(otherText);
                }
              }}
            />
            <div className="mt-4 flex gap-2">
              <button
                className="flex-1 rounded-lg px-4 py-2.5 text-sm font-bold disabled:opacity-40"
                style={{ backgroundColor: REEF, color: "#04252b" }}
                disabled={!otherText.trim()}
                onClick={() => {
                  setOtherOpen(false);
                  void send(otherText);
                }}
              >
                {OTHER_PROMPT.cta}
              </button>
              <button
                className="rounded-lg border border-white/20 px-4 py-2.5 text-sm text-white/70"
                onClick={() => setOtherOpen(false)}
              >
                {OTHER_PROMPT.cancel}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </div>
  );
}

/**
 * The end of the conversation, and the last thing anybody sees in this funnel.
 *
 * A headline, the offer restated, and the five things we start on. The work list is composed from
 * OFFER_INCLUDES so the figures live in exactly one place, config/pitch.ts, the same way section 1
 * of the agreement composes its annotations. The AI Skin Concierge line carries no figure because
 * that array does not price it, and inventing one to make the list look even is the move pitch.ts
 * explicitly forbids.
 */
function ClosingSummary({ callLabel }: { callLabel: string | null }) {
  return (
    <div className="mr-auto mt-4 w-full rounded-2xl border border-white/10 bg-white/[0.04] p-5 sm:p-6">
      <div className="mb-2 text-xs font-bold uppercase tracking-wider" style={{ color: REEF }}>
        {CLOSING_SUMMARY.eyebrow}
      </div>
      <h2 className="mb-3 text-xl font-bold leading-snug text-white sm:text-2xl">
        {CLOSING_SUMMARY.headline}
      </h2>
      <p className="mb-6 text-sm leading-6 text-white/70">{CLOSING_SUMMARY.subheadline}</p>

      <div className="mb-2 text-xs font-bold uppercase tracking-wider text-white/40">
        {CLOSING_SUMMARY.worksHeading}
      </div>
      <ul className="mb-6 space-y-2.5">
        {OFFER_INCLUDES.map((o) => (
          <li key={o.work} className="flex gap-3 text-sm leading-6 text-white/85">
            <span className="shrink-0 font-bold" style={{ color: REEF }} aria-hidden>
              +
            </span>
            <span>
              {o.work}
              <span className="text-white/40"> ({o.value})</span>
            </span>
          </li>
        ))}
        <li className="flex gap-3 text-sm leading-6 text-white/85">
          <span className="shrink-0 font-bold" style={{ color: REEF }} aria-hidden>
            +
          </span>
          <span>{CLOSING_SUMMARY.conciergeLine}</span>
        </li>
      </ul>

      <div className="rounded-xl border border-white/10 bg-white/5 p-4">
        <div className="mb-1 text-xs font-bold uppercase tracking-wider text-white/40">
          {CLOSING_SUMMARY.callHeading}
        </div>
        <div className="text-base font-semibold text-white">
          {callLabel || CLOSING_SUMMARY.callFallback}
        </div>
      </div>

      <p className="mt-5 text-xs leading-5 text-white/40">{CLOSING_SUMMARY.footer}</p>
    </div>
  );
}
