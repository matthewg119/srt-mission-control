// The assistant. PUBLIC, unauthenticated, and both modes behind one endpoint.
//
// /api/chat is dashboard-auth and stays that way. This is the public one, so the bound is six
// layers, cheapest first, and none of them is optional:
//
//   1. There is no anonymous entry point. Every request needs a session_token, which only exists
//      after POST /start, which is itself per-IP capped. A chat endpoint you cannot reach without
//      first passing the funnel's front door is most of the problem solved.
//   2. ONBOARDING2_CHAT_ENABLED unset is a HANDLED STATE, not a throw. The bubble says so.
//   3. The (signing_id, ordinal) unique constraint is free idempotency: a double-tap collides on
//      the index and never reaches the model.
//   4. Per-signing turn caps, per mode. THIS is what bounds spend if a session token leaks,
//      because every other guard here keys on IP and a stolen token arrives from anywhere.
//   5. Per-IP turn ledger, off the partial index on the turns table.
//   6. Shape guards: a length cap, and a minimum gap since the last user turn.
//
// ‼️ THE MODE IS READ OFF THE ROW, NEVER OFF THE REQUEST. A client-sent mode would hand anybody
// the post-signature toolset.
//
// ‼️ SCHEDULING IS A DETERMINISTIC STATE MACHINE AND THE MODEL IS NOT IN IT (2026-09-03), AND IT
// NOW RUNS FIRST (2026-09-04). Until the lead row carries booked_slot_at, every turn is decided
// here, from that row, with fixed copy from config/onboarding2.ts and days computed by
// scheduling.ts. The questions come after the booking.
//
// This used to make "no calendar link anywhere in this flow" true. There IS a calendar now: the
// Calendly embed, mounted by the CLIENT from a `bookingUrl` this route returns. The guarantee it
// was protecting is unchanged and is the reason to say this out loud: no prompt produces a link,
// no tool returns one, and the model never sees the turn the URL is sent on. The funnel gained a
// calendar; the assistant did not gain a way to hand one out.
//
// ‼️ THE REPLY IS AN ARRAY OF MESSAGES, NOT A STRING. Two or three short bubbles in a row read
// like a person texting; one paragraph reads like a form. See lib/onboarding2/texting.ts for the
// split rule. Each bubble is stored as its own turn on consecutive ordinals, so the transcript
// and the (signing_id, ordinal) idempotency both stay intact.
//
// ‼️ THE COST DRIVER IS NOT THE TURN COUNT. Grounded mode ships the whole agreement in the system
// prompt on every turn, with no caching. Measure with count_tokens before raising the caps.
// Prompt caching is the real fix and is deliberately NOT attempted here: ai.ts sends `system` as
// a plain string, and CLAUDE.md records that the minimum cacheable prefix is not monotonic across
// model generations, which left the Call Coach's cache silently dead for months.

import { NextRequest, NextResponse } from "next/server";
import { slack } from "@/lib/slack-bot";
import { hashIp, clientIpFrom } from "@/lib/scan/session";
import { clean } from "@/lib/medspa/validate";
import { loadByToken, overChatIpLimit, patchOpenSigning } from "@/lib/onboarding2/session";
import { isDemoRequest } from "@/lib/onboarding2/demo";
import { startDelivery } from "@/lib/onboarding2/delivery";
import {
  appendTurn,
  bumpTurnCount,
  loadTurns,
  modeFor,
  nextOrdinal,
  overTurnCap,
  type ChatMode,
} from "@/lib/onboarding2/chat-store";
import { nextQuestion, runTurn, type ExecutorContext } from "@/lib/onboarding2/chat";
import { findLeadByEmail, leadEmailFor, upsertLead } from "@/lib/onboarding2/lead";
import { callReply, qualifyingReply } from "@/lib/onboarding2/card";
// ‼️ scheduleCallAndInvite() IS NO LONGER CALLED FROM ANYWHERE, and src/lib/onboarding2/calendar.ts
// is deliberately left in the tree. It is a complete, working Microsoft Graph implementation
// gated on four MS_CALENDAR_* vars that have never been set. If that Azure app is ever created,
// this is a one-line re-import, and its file header carries the AADSTS65001 reasoning that is
// the only record of why Graph was chosen over Calendly in the first place.
import { bookingUrlFor, hasBooked } from "@/lib/onboarding2/booking";
import { splitIntoMessages } from "@/lib/onboarding2/texting";
import { dayOptions, readDayChoice, type DayOption } from "@/lib/onboarding2/scheduling";
import {
  INTAKE_COPY,
  nextIntakeStep,
  parseIntake,
  replayDraft,
  type IntakeKey,
} from "@/lib/onboarding2/intake-steps";
import {
  CHAT_UI,
  CLOSING_MESSAGES,
  TIMEZONE_OPTIONS,
  DAYPART_OPTIONS,
  SCHEDULING_INTRO,
  SCHEDULING_UI,
} from "@/config/onboarding2";
import { MAX_MESSAGE_CHARS, MIN_TURN_GAP_MS, chatEnabled } from "@/lib/onboarding2/constants";
import type { Onboarding2LeadRow, Onboarding2SigningRow } from "@/lib/onboarding2/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }

  // ‼️ ON BY DEFAULT ON A PREVIEW OR LOCALHOST, OFF BY DEFAULT IN PRODUCTION.
  // The assistant is the half of this funnel you cannot check by reading the diff, so a preview
  // where it answers "not available" is a preview that tests nothing. Nothing it does there can
  // escape (see demo.ts) and every cap still applies, so the only cost is tokens. Production
  // still needs ONBOARDING2_CHAT_ENABLED set by hand, because turning a public model endpoint on
  // for real traffic should be a deliberate act rather than a default somebody inherited.
  if (!chatEnabled() && !isDemoRequest(req)) {
    return NextResponse.json({ ok: true, messages: [CHAT_UI.offline], offline: true });
  }

  const row = await loadByToken(body.sessionToken as string);
  if (!row) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });

  const message = clean(body.message, MAX_MESSAGE_CHARS);
  if (!message) {
    return NextResponse.json({ ok: false, error: "Say something first." }, { status: 400 });
  }

  const mode = modeFor(row);
  if (overTurnCap(row, mode)) {
    return NextResponse.json({ ok: true, messages: [CHAT_UI.capped], capped: true });
  }

  const ipHash = hashIp(clientIpFrom(req));
  if (await overChatIpLimit(ipHash)) {
    return NextResponse.json({ ok: true, messages: [CHAT_UI.capped], capped: true });
  }

  const turns = await loadTurns(row.id);

  // A user turn arriving faster than a second after the last one is a script. The model has not
  // even finished answering.
  const lastUser = [...turns].reverse().find((t) => t.role === "user");
  if (lastUser && Date.now() - new Date(lastUser.created_at).getTime() < MIN_TURN_GAP_MS) {
    return NextResponse.json({ ok: false, error: "Too fast." }, { status: 429 });
  }

  // The INSERT is the claim. A retry carrying the same ordinal collides and never reaches Claude.
  const ordinal = nextOrdinal(turns);
  const claimed = await appendTurn({
    signingId: row.id,
    role: "user",
    content: message,
    mode,
    ordinal,
    ipHash,
  });
  if (!claimed.ok) {
    return NextResponse.json({ ok: false, error: "Could not save that." }, { status: 500 });
  }
  if (claimed.duplicate) {
    // Somebody else already used this ordinal. Hand back the transcript and let the client
    // re-read rather than paying for the same question twice.
    return NextResponse.json({ ok: true, duplicate: true, messages: [] });
  }

  const email = leadEmailFor(row);
  const lead = email ? await findLeadByEmail(email) : null;

  // ── THE SCHEDULING BRANCH, BEFORE THE MODEL AND INSTEAD OF IT ──
  //
  // ‼️ THE GATE INVERTED ON 2026-09-04. It used to read
  // `lead?.qualifying_completed_at && !lead.call_day`: every question first, scheduling last,
  // enforced a second time inside makeExecutor's offer_booking. Now scheduling comes FIRST and
  // the questions follow the booking.
  //
  // Matthew's call, and the reasoning is about what each half is for. The BOOKING is the
  // commitment; the QUESTIONS are preparation for the call it commits to. Gating the booking on
  // eight answers meant somebody who wanted to book had to fill in a form first, and anyone who
  // dropped at question four left with neither. Reversed, a lead who books and then abandons
  // question four has still done the thing that matters, and we have a call to ask the rest on.
  //
  // ‼️ IT KEYS ON booked_slot_at, WHICH ONLY /api/onboarding2/booked WRITES. Not on call_day,
  // which is set the moment they tap a day and BEFORE Calendly has seen them: keying on that
  // would walk somebody into the questions while the calendar was still on their screen. The
  // state lives on the lead row, so it survives a refresh, a new tab and a cold instance.
  // ‼️ `lead` MAY BE NULL HERE AND THAT IS THE NORMAL CASE FOR THE FIRST FOUR TURNS. The lead row
  // is keyed on email and the email is the fifth question, so the daypart, the zone, the website
  // and the name are all answered before one exists. This used to read `lead && !lead.booked...`,
  // which was correct while a form collected the email first and is a dead funnel now: with no
  // lead, the branch would fall through to the model on turn one.
  if (mode === "qualifying" && !hasBooked(lead)) {
    // ‼️ THE TURNS BEFORE THIS ONE, NOT INCLUDING IT. `turns` was loaded before the user turn was
    // appended, so this is exactly the prior transcript. handleScheduling appends `message`
    // itself where it needs the full picture. Passing the post-append list would make the daypart
    // step read its own answer and skip a question.
    const priorTurns = turns.filter((t) => t.role === "user").map((t) => t.content);
    const out = await handleScheduling({
      row,
      lead,
      typed: message,
      priorTurns,
      isDemo: Boolean(row.is_demo),
    });
    await storeAssistant({ signingId: row.id, mode, from: ordinal + 1, messages: out.messages });
    // ‼️ THE SLACK CALL REPLY FIRES ON THE AGREED DAY, NOT ON THE BOOKING. It always did: the
    // handler returns a lead only on the turn a day lands. Matthew wants to know a call was
    // agreed even if Calendly is never completed, which is exactly the lead worth chasing.
    if (out.lead && row.slack_thread_ts && row.slack_channel && !row.is_demo) {
      const reply = callReply(out.lead);
      await slack
        .postThreadReply(row.slack_channel, row.slack_thread_ts, reply.text, reply.blocks)
        .catch((e) =>
          console.error("[onboarding2/chat] call reply failed:", (e as Error).message)
        );
    }
    return NextResponse.json({
      ok: true,
      mode,
      messages: out.messages,
      options: out.options,
      // The URL the client mounts the Calendly embed on. Present only on the turn a day lands.
      bookingUrl: out.bookingUrl ?? null,
      // ‼️ NOT `complete`, AND NOT `scheduled` EITHER. Both used to be true here because
      // scheduling was the LAST thing this funnel did. It is now the first, so the composer must
      // stay live: the questions come next. The client shows the closing summary when the
      // QUESTIONS finish, which is a different response entirely.
      scheduled: false,
      callLabel: out.lead?.call_choice_label ?? null,
      complete: false,
    });
  }

  await bumpTurnCount(row, mode);

  const ctx: ExecutorContext = {
    row,
    lead,
    ordinal,
    justCompleted: false,
    priceFlagged: false,
  };

  // History is rebuilt server-side from stored turns. Anything the client sent as a message list
  // is ignored, including any system role it tries to smuggle in.
  const history = [
    ...turns.map((t) => ({ role: t.role, content: t.content })),
    { role: "user" as const, content: message },
  ];

  const result = await runTurn({ ctx, history });
  if (!result.ok) {
    return NextResponse.json({ ok: true, messages: [CHAT_UI.offline], offline: true });
  }

  // ‼️ A TURN THAT ENDED ON A TOOL CALL RETURNS NO TEXT, AND A BLANK BUBBLE IS A DEAD END.
  // Seen live on question five: record_answer ran, the answer was stored correctly, and the
  // visitor got an empty message with no way forward. Rather than spend another model call to
  // recover, ask the next outstanding question ourselves. It is computed from stored answers, so
  // it cannot contradict what the model just did.
  //
  // ‼️ THE LAST-ANSWER CASE IS DIFFERENT AND MUST NOT FALL THROUGH TO THE FALLBACK. record_answer
  // tells the model to say nothing once every question is in, because the three closing messages
  // below are ours. An empty reply there is the intended outcome, not a failure.
  //
  // This branch used to key on ctx.bookingOffered, which was set by the offer_booking tool that
  // no longer exists. It keys on justCompleted now: same moment, one fewer round trip, and it
  // cannot be reached by a model deciding to call a tool early.
  let messages: string[] = [];
  const text = result.response.trim();

  if (ctx.justCompleted) {
    // The close, verbatim, as three separate bubbles. No model, no link, nothing to argue with.
    messages = [...CLOSING_MESSAGES];
  } else if (text) {
    messages = splitIntoMessages(text);
  } else {
    const fallback =
      (mode === "qualifying" ? nextQuestion(ctx.lead)?.question ?? null : null) ??
      // A price handoff that ended on the tool call gets the one line we want said, not the
      // "assistant unavailable" message. See CHAT_UI.priceHandoff.
      (ctx.priceFlagged ? CHAT_UI.priceHandoff : null) ??
      CHAT_UI.offline;
    messages = [fallback];
  }

  await storeAssistant({ signingId: row.id, mode, from: ordinal + 1, messages });

  // ── Every question answered ──
  //
  // ‼️ THIS IS THE MOMENT THE INTAKE IS GENUINELY COMPLETE, so it is the moment the delivery
  // board opens. Everything below is caught: an answer is already stored and nothing here may
  // cost it. See lib/onboarding2/delivery.ts for why the board waits until here rather than
  // opening at signature.
  if (ctx.justCompleted) {
    // ONE thread reply carrying all of them, not one per answer, which is the wall the step board
    // was rebuilt to remove. Threads under the SIGNED CARD, which is not the ops thread.
    if (ctx.lead && row.slack_thread_ts && row.slack_channel) {
      const reply = qualifyingReply(ctx.lead);
      await slack
        .postThreadReply(row.slack_channel, row.slack_thread_ts, reply.text, reply.blocks)
        .catch((e) =>
          console.error("[onboarding2/chat] slack reply failed:", (e as Error).message)
        );
    }

    // The intake write, the domain, the subdomain, the board and the baseline scan.
    const delivery = await startDelivery(row, ctx.lead).catch((e) => ({
      started: false,
      claimed: false,
      warnings: [(e as Error).message],
    }));

    if (delivery.warnings.length && row.slack_thread_ts && row.slack_channel) {
      await slack
        .postThreadReply(
          row.slack_channel,
          row.slack_thread_ts,
          [
            ":warning: The delivery board did not open cleanly:",
            ...delivery.warnings.map((w) => `- ${w}`),
          ].join("\n")
        )
        .catch(() => null);
    }
  }

  // The chips under the next question, from the same function that decided what to ask, so what
  // is tappable and what was asked cannot come apart.
  // nextQuestion() already returns null once every question is answered, so the old
  // `&& !ctx.bookingOffered` guard was doing nothing the function did not already do.
  const upcoming = mode === "qualifying" ? nextQuestion(ctx.lead) : null;

  return NextResponse.json({
    ok: true,
    messages,
    mode,
    // No daypart chips here any more: scheduling happens before the model ever has a turn, in
    // the branch above, and offering them at the END would offer a booking they already made.
    options: upcoming?.options ?? [],
    otherOption: upcoming?.otherOption ?? null,
    answered: ctx.lead?.qualifying_answered ?? 0,
    complete: ctx.justCompleted || Boolean(ctx.lead?.qualifying_completed_at),
  });
}

/**
 * Store an assistant reply, one row per bubble, on consecutive ordinals.
 *
 * ‼️ NOT ONE ROW WITH NEWLINES IN IT. The transcript is what the model is handed back as history
 * on the next turn, and three bubbles stored as one blob would teach it to write paragraphs,
 * which is the thing this change exists to stop.
 */
async function storeAssistant(args: {
  signingId: string;
  mode: ChatMode;
  from: number;
  messages: string[];
}): Promise<void> {
  for (let i = 0; i < args.messages.length; i++) {
    await appendTurn({
      signingId: args.signingId,
      role: "assistant",
      content: args.messages[i],
      mode: args.mode,
      ordinal: args.from + i,
      ipHash: null,
    });
  }
}

/**
/**
 * The whole pre-booking conversation, decided from stored rows rather than by a model.
 *
 * ‼️ IT IS SEVEN QUESTIONS NOW, NOT THREE (2026-09-04, second pass). It used to run after the
 * identity form and only settle a daypart, a zone and a day. The form is gone: this asks for the
 * website, the name, the email and the phone too, in that order, between the zone and the day.
 * See lib/onboarding2/intake-steps.ts for why the order is what it is.
 *
 * Every state is keyed on a column that is either set or is not, so the whole thing survives a
 * refresh, a new tab and a cold instance with nothing extra to keep in sync. nextIntakeStep() is
 * the single reader of that state and this function is the single writer.
 *
 * ‼️ THE ZONE IS ASKED BEFORE THE DAYS, AND THE ORDER IS LOAD-BEARING. dayOptions() drops today
 * once our own working half-day has gone, which is a judgement about THEIR day. A Pacific clinic
 * at 1pm Eastern is at 10am and can still take a call this morning; asking the zone afterwards
 * would already have offered them the wrong three days.
 *
 * ‼️ THE DAYS ARE RECOMPUTED ON EVERY TURN RATHER THAN STORED. They are a pure function of the
 * daypart and the clock, so recomputing cannot drift. The only thing worth persisting is what
 * they actually chose.
 *
 * ‼️ THE LEAD ROW IS BORN AT THE EMAIL STEP, NOT AT THE END. Two questions still follow it, and
 * somebody who gives an email and then closes the tab is a lead worth having. Creating it there
 * is also what promotes the daypart and the zone out of the draft bag; see intake-steps.ts.
 */
async function handleScheduling(args: {
  row: Onboarding2SigningRow;
  lead: Onboarding2LeadRow | null;
  typed: string;
  /** Every user turn BEFORE this one, oldest first. The daypart and the zone are read back out
   *  of these until the lead row exists to hold them. See intake-steps.ts. */
  priorTurns: string[];
  isDemo: boolean;
}): Promise<{
  messages: string[];
  options: string[];
  /** Non-null only on the turn a DAY lands, which is what the Slack card keys on. */
  lead: Onboarding2LeadRow | null;
  /** Set on the final turn only. The client mounts the Calendly embed on it. */
  bookingUrl?: string;
}> {
  let { row, lead } = args;
  const step = nextIntakeStep(row, lead, args.priorTurns);

  // Nothing outstanding. Reached only by a stray turn after the calendar is already on screen.
  if (!step) return { messages: [SCHEDULING_UI.reask], options: [], lead: null };

  // ‼️ THE DAY IS THE ONE STEP parseIntake CANNOT ANSWER, AND SKIPPING IT HERE IS NOT AN
  // OVERSIGHT BEING PAPERED OVER. Every other step validates a value against a fixed rule. The
  // day validates against THREE OPTIONS COMPUTED FROM THE CLOCK AND THE DAYPART, which is
  // readDayChoice's job and which needs dayOptions(). Routing it through parseIntake would mean
  // either passing the options into a pure validator or duplicating the day arithmetic inside
  // it; instead the day branch below owns its own matching.
  //
  // This is a bug that shipped for exactly one test run: parseIntake fell through to its default
  // refusal, so "Tuesday afternoon" came back as "Just tap one of the options below" and the
  // calendar was never reached.
  if (step !== "day") {
    const parsed = parseIntake(step, args.typed);
    if (!parsed.ok) {
      return {
        messages: [parsed.error],
        options: optionsFor(step, row, lead, args.priorTurns),
        lead: null,
      };
    }
  // ── The two steps answered before any lead row exists ──
  //
  // ‼️ NOTHING IS WRITTEN HERE, AND NOTHING NEEDS TO BE. The user turn carrying this answer was
  // appended to onboarding2_chat_turns by the caller before this function ran, so the answer is
  // already durable. replayDraft() reads it back on the next request. This branch exists only to
  // move the conversation on.
  if (step === "daypart" || step === "timezone") {
    const turns = [...args.priorTurns, args.typed];
    const next = nextIntakeStep(row, lead, turns);
    return { messages: [promptFor(next, row, lead, turns)], options: optionsFor(next, row, lead, turns), lead: null };
  }

  // ── The four identity steps ──
  if (step === "website" || step === "name" || step === "email" || step === "phone") {
    const column =
      step === "website"
        ? { website: parsed.value }
        : step === "name"
          ? { contact_name: parsed.value }
          : step === "email"
            ? { email: parsed.value, contact_email: parsed.value }
            : {
                contact_phone: parsed.value,
                contact_phone_typed: String(parsed.extra?.typed ?? parsed.value),
              };

    const patched = await patchOpenSigning(row.id, column);
    if (patched) row = patched;

    // ‼️ THE LEAD IS CREATED HERE, AND THE DRAFT IS PROMOTED WITH IT. Everything the conversation
    // has collected goes across in one upsert, so a lead row is never half a person.
    if (step === "email") {
      const draft = replayDraft(args.priorTurns);
      lead =
        (await upsertLead({
          email: parsed.value,
          contact_name: row.contact_name,
          website: row.website,
          signing_id: row.id,
          is_demo: row.is_demo,
          call_daypart: draft.daypart ?? null,
          call_timezone: draft.timezone ?? null,
        })) ?? null;
      if (lead) await patchOpenSigning(row.id, { lead_id: lead.id });
    }

    if (step === "phone" && row.email) {
      lead = (await upsertLead({ email: row.email, phone: parsed.value })) ?? lead;
    }

    const turns = [...args.priorTurns, args.typed];
    const next = nextIntakeStep(row, lead, turns);
    return { messages: [promptFor(next, row, lead, turns)], options: optionsFor(next, row, lead, turns), lead: null };
  }

  }

  // ── The day, and the calendar ──
  const daypart = lead?.call_daypart ?? replayDraft(args.priorTurns).daypart;
  if (!daypart || !lead) return { messages: [SCHEDULING_UI.reask], options: [], lead: null };

  const days: DayOption[] = dayOptions(daypart);
  const picked = readDayChoice(args.typed, days);
  if (!picked) {
    return { messages: [SCHEDULING_UI.reask], options: days.map((d) => d.label), lead: null };
  }

  const stored = await upsertLead({
    email: lead.email,
    call_day: picked.date,
    call_choice_label: picked.label,
    call_chosen_at: new Date().toISOString(),
  });

  // ‼️ THE DAY IS WRITTEN BEFORE THE CALENDAR IS OFFERED, AND THAT ORDER IS THE FALLBACK. If the
  // embed never loads, or they close the tab on the Calendly screen, the agreed day is already
  // durable and the Slack card still fires. The reverse order would lose an agreed call to
  // protect a booking nobody has made yet.
  //
  // ‼️ NOTHING IS CONFIRMED HERE. This turn hands over a calendar; it does not claim a booking
  // and it does not claim an email. Both are said by /api/onboarding2/booked, after Calendly
  // reports event_scheduled.
  const url = bookingUrlFor(stored ?? lead, picked.date);

  if (!url) {
    return {
      messages: [
        SCHEDULING_UI.confirmedNoInvite.replace("{day}", picked.label),
        SCHEDULING_UI.noCalendar,
      ],
      options: [],
      lead: stored,
    };
  }

  return {
    messages: [SCHEDULING_UI.pickTime.replace("{day}", picked.label)],
    options: [],
    lead: stored,
    bookingUrl: url,
  };
}

/** The question for a step, or the handover line when there are none left. */
function promptFor(
  step: IntakeKey | null,
  row: Onboarding2SigningRow,
  lead: Onboarding2LeadRow | null,
  turns: string[]
): string {
  if (step === "timezone") return SCHEDULING_UI.askZone;
  if (step === "day") return SCHEDULING_UI.askDay;
  if (step === "daypart") return SCHEDULING_INTRO[SCHEDULING_INTRO.length - 1];
  if (step) return INTAKE_COPY[step].prompt;
  // Unreachable in practice: the day step is the last one and it returns above.
  void row;
  void lead;
  void turns;
  return SCHEDULING_UI.reask;
}

/** The chips under a step, empty for the free-text ones. */
function optionsFor(
  step: IntakeKey | null,
  row: Onboarding2SigningRow,
  lead: Onboarding2LeadRow | null,
  turns: string[]
): string[] {
  if (step === "daypart") return [DAYPART_OPTIONS.morning, DAYPART_OPTIONS.afternoon];
  if (step === "timezone") return TIMEZONE_OPTIONS.map((t) => t.label);
  if (step === "day") {
    void row;
    const daypart = lead?.call_daypart ?? replayDraft(turns).daypart;
    return daypart ? dayOptions(daypart).map((d) => d.label) : [];
  }
  return [];
}