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
  SCHEDULING_UI,
} from "@/config/onboarding2";
import { OFFER_INCLUDES } from "@/config/pitch";
import { BUBBLE_GAP_MS } from "@/lib/onboarding2/texting";

const REEF = "#00C9A7";

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
  fullscreen,
  demo,
}: {
  sessionToken: string;
  fullscreen: boolean;
  demo: boolean;
}) {
  const [open, setOpen] = useState(fullscreen);
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

  useEffect(() => {
    if (fullscreen) setOpen(true);
  }, [fullscreen]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy, options]);

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
    setMessages(SCHEDULING_INTRO.map((content) => ({ role: "assistant" as const, content })));
    setOptions([DAYPART_OPTIONS.morning, DAYPART_OPTIONS.afternoon]);
  }, [open, started]);

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

  const shell = fullscreen
    ? "fixed inset-0 z-50 flex flex-col bg-[#0a0a0a]"
    : "fixed inset-x-3 bottom-3 z-50 flex h-[70vh] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0a0a0a] shadow-2xl sm:inset-x-auto sm:right-5 sm:h-[520px] sm:w-[380px]";

  return (
    <div className={shell}>
      {fullscreen && demo && (
        <div className="bg-amber-400 px-4 py-2 text-center text-xs font-bold text-[#0a0a0a]">
          TEST MODE. Nothing here reaches Slack, the CRM, your inbox or the client list.
        </div>
      )}

      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <span className="text-sm font-semibold">
          {bookingUrl || !scheduled ? CHAT_UI.title : "A few quick questions"}
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
                : "mr-auto max-w-[90%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-white/5 px-3.5 py-2.5 text-sm text-white/85"
            }
            style={m.role === "user" ? { backgroundColor: REEF, color: "#04252b" } : undefined}
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
            <iframe
              src={bookingUrl}
              title="Book your onboarding call"
              className="h-[640px] w-full rounded-xl border border-white/10 bg-white"
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
        className={`flex items-end gap-2 border-t border-white/10 p-3 ${scheduled ? "hidden" : ""} ${fullscreen ? "mx-auto w-full max-w-2xl" : ""}`}
      >
        <textarea
          rows={1}
          className="max-h-24 flex-1 resize-none rounded-lg border border-white/15 bg-white/5 px-3 py-2.5 text-sm text-white placeholder-white/30 outline-none focus:border-[#00C9A7]"
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
          style={{ backgroundColor: REEF, color: "#04252b" }}
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
