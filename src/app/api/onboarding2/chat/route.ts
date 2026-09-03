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
// ‼️ THE SCHEDULING CLOSE IS A DETERMINISTIC STATE MACHINE AND THE MODEL IS NOT IN IT
// (2026-09-03). Once the last question is answered, every remaining turn is decided here, from
// the lead row, with fixed copy from config/onboarding2.ts and days computed by scheduling.ts.
// That is what makes "no calendar link anywhere in this flow" a guarantee rather than an
// instruction: there is no turn in which a model could produce one. It also costs nothing, which
// is a pleasant second reason but not the first one.
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
import { loadByToken, overChatIpLimit } from "@/lib/onboarding2/session";
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
import { scheduleCallAndInvite } from "@/lib/onboarding2/calendar";
import { splitIntoMessages } from "@/lib/onboarding2/texting";
import {
  CALL_HOUR,
  clockLabel,
  dayOptions,
  readTimezone,
  readDayChoice,
  readDaypart,
  type DayOption,
} from "@/lib/onboarding2/scheduling";
import {
  CHAT_UI,
  CLOSING_MESSAGES,
  TIMEZONE_OPTIONS,
  DAYPART_OPTIONS,
  SCHEDULING_UI,
} from "@/config/onboarding2";
import { MAX_MESSAGE_CHARS, MIN_TURN_GAP_MS, chatEnabled } from "@/lib/onboarding2/constants";
import type { Onboarding2LeadRow } from "@/lib/onboarding2/types";

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
  // ‼️ EVERY TURN AFTER THE LAST ANSWER IS HANDLED HERE. Reached whenever the questions are done,
  // which is the state the lead row already records, so it survives a refresh, a new tab and a
  // cold instance without anything extra to keep in sync.
  if (mode === "qualifying" && lead?.qualifying_completed_at && !lead.call_day) {
    const out = await handleScheduling({ lead, typed: message, isDemo: Boolean(row.is_demo) });
    await storeAssistant({ signingId: row.id, mode, from: ordinal + 1, messages: out.messages });
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
      // The client swaps the composer for the closing summary on this, so it is only true once a
      // day is actually stored, never when the daypart lands.
      scheduled: Boolean(out.lead?.call_day),
      callLabel: out.lead?.call_choice_label ?? null,
      complete: true,
    });
  }

  await bumpTurnCount(row, mode);

  const ctx: ExecutorContext = {
    row,
    lead,
    ordinal,
    bookingOffered: false,
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
  // ‼️ THE offer_booking CASE IS DIFFERENT AND MUST NOT FALL THROUGH TO THE FALLBACK. That tool
  // deliberately tells the model to say nothing, because the three closing messages below are
  // ours. An empty reply there is the intended outcome, not a failure.
  let messages: string[] = [];
  const text = result.response.trim();

  if (ctx.bookingOffered) {
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
  const upcoming = mode === "qualifying" && !ctx.bookingOffered ? nextQuestion(ctx.lead) : null;

  return NextResponse.json({
    ok: true,
    messages,
    mode,
    options: ctx.bookingOffered
      ? [DAYPART_OPTIONS.morning, DAYPART_OPTIONS.afternoon]
      : (upcoming?.options ?? []),
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
 * The close, decided from the lead row rather than by a model.
 *
 * THREE states and nothing else, each one keyed on a column that is either set or is not, so the
 * whole thing survives a refresh, a new tab and a cold instance with nothing extra to sync:
 *   no call_daypart   -> read one out of what they typed, then ask the zone.
 *   no call_timezone  -> read one out of what they typed, then offer three days.
 *   call_timezone set -> match what they typed to one of those days, store it, send the invite.
 *
 * ‼️ THE ZONE IS ASKED BEFORE THE DAYS, NOT AFTER, AND THE ORDER IS LOAD-BEARING. dayOptions()
 * drops today once our own working half-day has gone, which is a judgement about THEIR day. A
 * Pacific clinic at 1pm Eastern is at 10am and can still take a call this morning; asking the
 * zone afterwards would already have offered them the wrong three days.
 *
 * ‼️ THE DAYS ARE RECOMPUTED ON EVERY TURN RATHER THAN STORED. They are a pure function of the
 * daypart and the clock, so recomputing cannot drift, and storing three candidate days on a row
 * would be a third thing to keep in sync for no gain. The only thing worth persisting is what
 * they actually chose.
 */
async function handleScheduling(args: {
  lead: Onboarding2LeadRow;
  typed: string;
  isDemo: boolean;
}): Promise<{ messages: string[]; options: string[]; lead: Onboarding2LeadRow | null }> {
  const { lead, typed } = args;

  if (!lead.call_daypart) {
    const daypart = readDaypart(typed);
    if (!daypart) {
      return {
        messages: [SCHEDULING_UI.reask],
        options: [DAYPART_OPTIONS.morning, DAYPART_OPTIONS.afternoon],
        lead: null,
      };
    }
    await upsertLead({ email: lead.email, call_daypart: daypart });
    return {
      messages: [SCHEDULING_UI.askZone],
      options: TIMEZONE_OPTIONS.map((t) => t.label),
      lead: null,
    };
  }

  if (!lead.call_timezone) {
    const zone = readTimezone(typed);
    if (!zone) {
      return {
        messages: [SCHEDULING_UI.reask],
        options: TIMEZONE_OPTIONS.map((t) => t.label),
        lead: null,
      };
    }
    await upsertLead({ email: lead.email, call_timezone: zone });
    const days = dayOptions(lead.call_daypart);
    return {
      messages: [SCHEDULING_UI.askDay],
      options: days.map((d) => d.label),
      // Not scheduled yet, so no Slack reply. That fires when a DAY lands.
      lead: null,
    };
  }

  const days: DayOption[] = dayOptions(lead.call_daypart);
  const picked = readDayChoice(typed, days);
  if (!picked) {
    return { messages: [SCHEDULING_UI.reask], options: days.map((d) => d.label), lead: null };
  }

  const stored = await upsertLead({
    email: lead.email,
    call_day: picked.date,
    call_choice_label: picked.label,
    call_chosen_at: new Date().toISOString(),
  });

  // ‼️ THE DAY IS WRITTEN BEFORE THE INVITE IS ATTEMPTED, AND THAT ORDER IS THE FALLBACK. If
  // Graph is unreachable the booking is already durable and the Slack card still fires; the
  // reverse order would lose an agreed call to protect an invite nobody has seen yet.
  const saved =
    (await scheduleCallAndInvite({
      lead: stored ?? lead,
      date: picked.date,
      daypart: lead.call_daypart,
      timeZone: lead.call_timezone,
      isDemo: args.isDemo,
    })) ?? stored;

  // ‼️ THE CONFIRMATION NAMES THE HOUR ONLY WHEN AN INVITE ACTUALLY WENT OUT, and the two strings
  // are separate constants rather than one with an optional clause. "The invite is on its way"
  // said on a row whose call_invite_sent_at is null is the one sentence this close cannot afford
  // to get wrong: the client stops watching for it and nobody finds out for a week.
  const zoneLabel =
    TIMEZONE_OPTIONS.find((t) => t.zone === lead.call_timezone)?.label ?? "";
  const confirm = saved?.call_invite_sent_at
    ? SCHEDULING_UI.confirmed
        .replace("{day}", picked.label)
        .replace("{time}", `${clockLabel(CALL_HOUR[lead.call_daypart])} ${zoneLabel}`.trim())
    : SCHEDULING_UI.confirmedNoInvite.replace("{day}", picked.label);

  return {
    // Two bubbles, the way somebody actually confirms something.
    messages: [confirm, SCHEDULING_UI.closing],
    options: [],
    lead: saved,
  };
}
