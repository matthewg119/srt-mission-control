// Where a CLIENT's own patients go when the widget closes.
//
// ‼️ UNTIL THIS FILE EXISTED, NOTHING IN THE REPO EVER WROTE ANY OF THE THREE BOOKING COLUMNS.
// `concierge_configs.booking_mode`, `.booking_url` and `.booking_phone` were read in five places
// and written in none. Six code paths update that table (`launcher_corner`, `addon_status`, the
// audience, `enabled`, the seed upsert, the mascot) and not one of them touched these. So every
// provisioned client sat at the column default `booking_mode = 'none'` with both other fields null,
// and `patientOffer()` in concierge/booking.ts therefore answered the same thing on every clinic's
// website: we will call you back. The widget reached the close, asked for the appointment, and had
// no answer. concierge-setup.ts:13 records that the omission was deliberate at seed time; nothing
// ever supplied the door afterwards. This is that door.
//
// ‼️ ONE COLUMN GROUP, ONE FILE, which is the pattern concierge-addon.ts (`addon_status`) and
// concierge-enabled.ts (`enabled`) already set, and that file's header states the reason: two
// meanings folded into one control means a later reader cannot tell which decision was made.
// Booking is a third meaning. It is where their patients go, it is not whether they bought the
// add-on and it is not whether the widget renders.
//
// ‼️ THE PATIENT LANE IS THE POINT, AND THE OWNER LANE MUST NOT BE TOUCHED. resolveBooking()
// (concierge/booking.ts:121) sends every non-owner audience to patientOffer() and its header says
// the owner lane ignores these columns ON PURPOSE, so that a misconfigured tenant row can never
// redirect SRT's own sales calls. Nothing here changes that: these three columns only ever decide
// where a clinic's patients go.
//
// ‼️ NEVER WRITE booking_mode = 'calendly'. The CHECK constraint allows it and bookingMode() in
// config.ts parses it, and NO CODE PATH BRANCHES ON IT for a patient: patientOffer tests
// `=== "link"` and nothing else. Storing 'calendly' would pass every validation, read correctly in
// the dashboard, and silently behave as "no destination". A Calendly URL is stored as a `link`,
// which is what actually works.

import { supabaseAdmin } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";
import { conciergeSwitchState, type ConciergeSwitchState } from "./concierge-enabled";

/** What somebody typed, once it has been understood. */
export type BookingTarget =
  | { mode: "link"; url: string }
  | { mode: "phone"; phone: string }
  | { mode: "callback" };

export type BookingParse = { ok: true; target: BookingTarget } | { ok: false; error: string };

export type SetBookingResult =
  | { ok: true; state: ConciergeSwitchState; lines: string[] }
  | { ok: false; error: string };

/**
 * `booking: <url>` / `booking: <phone>` / `booking: callback`.
 *
 * ‼️ ANCHORED AND COLON FORM ONLY. This is a client-level fact that can be typed in any of a
 * client's step threads, the same door `concierge install` uses, so it competes with free text in
 * every one of them. "booking is handled by their front desk" is dictation and must reach the
 * assistant; `booking:` followed by something is a command.
 */
export const BOOKING_SET = /^\s*[`*_]*booking\s*:\s*(.+?)\s*[`*_]*\s*$/i;

/** Words that mean "neither a link nor a phone: a person will call them back". */
const CALLBACK_WORDS = /^(callback|call back|call-back|none|no booking|nothing|manual)$/i;

/**
 * Understand what was typed, without touching the database.
 *
 * ‼️ A URL IS TESTED BEFORE A PHONE, and the order matters: `new URL()` accepts far more than it
 * looks like it does, and a bare run of digits is a plausible host to nobody but a parser. Testing
 * the phone first would be worse still, because normalizePhone strips non-digits, so it would read
 * a Calendly link containing a number as a telephone number.
 */
export function parseBookingTarget(raw: string): BookingParse {
  const given = raw.trim().replace(/^<|>$/g, "").replace(/\|.*$/, "");
  if (!given) return { ok: false, error: "nothing followed `booking:`." };

  if (CALLBACK_WORDS.test(given)) return { ok: true, target: { mode: "callback" } };

  if (/^https?:\/\//i.test(given) || /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(given)) {
    const withScheme = /^https?:\/\//i.test(given) ? given : `https://${given}`;
    try {
      const u = new URL(withScheme);
      if (!u.hostname.includes(".")) return { ok: false, error: `"${given}" is not a web address.` };
      return { ok: true, target: { mode: "link", url: u.toString() } };
    } catch {
      return { ok: false, error: `"${given}" is not a web address.` };
    }
  }

  const phone = normalizePhone(given);
  if (phone) return { ok: true, target: { mode: "phone", phone } };

  return {
    ok: false,
    error: `"${given}" is not a booking link, a phone number, or the word callback.`,
  };
}

/** How the three columns are written for each target. */
function patchFor(target: BookingTarget): Record<string, string | null> {
  switch (target.mode) {
    // The phone is left alone: patientOffer falls back to it only when the link is absent, so a
    // clinic can carry both and lose nothing.
    case "link":
      return { booking_mode: "link", booking_url: target.url };

    // ‼️ THE URL IS CLEARED. booking_mode stops being 'link', so a surviving URL would be a
    // destination nothing can reach, sitting in a column the dashboard prints.
    case "phone":
      return { booking_mode: "none", booking_url: null, booking_phone: target.phone };

    // ‼️ BOTH ARE CLEARED, AND THAT IS THE WHOLE MEANING OF THE WORD. patientOffer tests the phone
    // AFTER the mode, so callback with a stale phone still hands out the phone, and somebody who
    // just said "no booking destination" would watch the widget give one out.
    case "callback":
      return { booking_mode: "none", booking_url: null, booking_phone: null };
  }
}

/**
 * Set where this client's patients book.
 *
 * ‼️ IT REFUSES WITHOUT A CONFIG ROW rather than creating one. Step 18 provisions the row with an
 * audience and a vertical; a row conjured here would have neither, and loadConciergeConfig refuses
 * to serve a config whose `audience_id` is missing, so the widget would go dark rather than gain a
 * booking link. Same refusal, same wording shape, as setConciergeEnabled.
 */
export async function setConciergeBooking(args: {
  clientId: string;
  target: BookingTarget;
  by: string;
  source?: "slack" | "dashboard";
}): Promise<SetBookingResult> {
  const before = await conciergeSwitchState(args.clientId);
  if (!before) {
    return {
      ok: false,
      error:
        "this client has no concierge row yet. Step 18 (concierge_preview) creates it; re-run that step first.",
    };
  }

  const patch = patchFor(args.target);
  const { error } = await supabaseAdmin
    .from("concierge_configs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("client_id", args.clientId);

  if (error) return { ok: false, error: error.message };

  // The public config route is unstable_cache'd on this tag. Without the bust the widget keeps its
  // old answer for five minutes, which reads as the change not working. Same shape as
  // concierge-enabled.ts and api/concierge/corner/route.ts.
  const { revalidateTag } = await import("next/cache");
  try {
    revalidateTag("concierge-config");
  } catch {
    /* outside a request the five minute cache covers it */
  }

  const { logClientEvent } = await import("./client-events");
  await logClientEvent({
    clientId: args.clientId,
    stepKey: "concierge_live",
    source: args.source ?? "slack",
    kind: "command",
    author: args.by,
    text: `booking: ${describe(args.target)}`,
    payload: { handler: "concierge-booking", ...patch },
  });

  const after: ConciergeSwitchState = {
    ...before,
    bookingMode: (patch.booking_mode as string | null) ?? before.bookingMode,
    bookingUrl: "booking_url" in patch ? (patch.booking_url as string | null) : before.bookingUrl,
    bookingPhone: "booking_phone" in patch ? (patch.booking_phone as string | null) : before.bookingPhone,
  };

  return { ok: true, state: after, lines: bookingLines(after, args.target, args.by) };
}

function describe(target: BookingTarget): string {
  if (target.mode === "link") return target.url;
  if (target.mode === "phone") return target.phone;
  return "callback";
}

/** What the change means for a real visitor, which is the only thing worth printing. */
export function bookingLines(state: ConciergeSwitchState, target: BookingTarget, by: string): string[] {
  const lines: string[] = [];

  if (target.mode === "link") {
    lines.push(
      `:calendar: *Booking set* (${by}). The assistant now offers *Book a consultation* pointing at ${target.url}.`
    );
    // Every outbound booking link is wrapped by trackedUrl() through /api/concierge/booked, which
    // is what makes `booked` reachable on the session outcome ladder.
    lines.push("Clicks are recorded, so a booking shows up as an outcome rather than a guess.");
    if (state.bookingPhone) {
      lines.push(`If the link is ever empty the assistant falls back to ${state.bookingPhone}.`);
    }
  } else if (target.mode === "phone") {
    lines.push(`:telephone_receiver: *Booking set* (${by}). The assistant now tells people to call ${target.phone}.`);
    lines.push(
      "A phone number cannot be tracked the way a link can, so a booking taken this way will not show as an outcome. A link is better if they have one."
    );
  } else {
    lines.push(`:writing_hand: *Booking set to callback* (${by}). The assistant takes a name and a number and promises a call back.`);
    lines.push("Nothing is scheduled. Somebody at the clinic has to ring them.");
  }

  if (!state.enabled) {
    lines.push(
      ":warning: The concierge is currently OFF for this client, so nobody is seeing any of this yet."
    );
  }

  return lines;
}

/**
 * `booking: ...` in ANY of this client's step threads.
 *
 * ‼️ ANY THREAD, for the reason `concierge install` is any-thread: it is a fact about the client,
 * not about a step. It usually comes up on the prep call, which is step 10, long before the
 * concierge step that will read it.
 */
export async function handleConciergeBookingThreadReply(args: {
  clientId: string;
  stepKey: string | null;
  text: string;
  by: string;
  // The `after` arm is declared and never used, so this handler is assignable alongside every
  // other arm of the `??` chain in the events route. Without it TypeScript narrows the chain to
  // the shape of whichever arm has the fewest keys and the callers stop compiling.
}): Promise<{ message: string; after?: () => Promise<void> } | null> {
  const m = BOOKING_SET.exec(args.text);
  if (!m) return null;

  const parsed = parseBookingTarget(m[1]);
  if (!parsed.ok) {
    return {
      message: [
        `:warning: ${parsed.error}`,
        "",
        "`booking: https://their-calendar.com/book` for a link, `booking: 555 123 4567` for a phone, or `booking: callback` if a person rings them back.",
      ].join("\n"),
    };
  }

  const res = await setConciergeBooking({ clientId: args.clientId, target: parsed.target, by: args.by });
  if (!res.ok) return { message: `:warning: ${res.error}` };
  return { message: res.lines.join("\n") };
}
