// The referral setup, typed into the step thread.
//
// ‼️ IT COPIES offers.ts's PARSER DOCTRINE AND THE REASONS ARE ITS REASONS.
//
//  - THE FIRST LINE DECIDES. Only a message whose FIRST line starts with a known prefix is a
//    command. A pasted document with "Offer: 3 free sessions" on line nine is not one, which is
//    the bug that corrupted srt-agency-llc's locked treatment on 2026-09-14.
//  - A COMBINED MESSAGE IS REFUSED, NEVER MERGED. One command per message, and the refusal says
//    which ones it saw so nobody has to guess what was kept. See
//    reference_offer_reply_two_messages: a combined `offer:` + `terms:` was refused for this
//    reason and the refusal is the feature.
//  - A CONTINUATION LINE IS NOT PART OF THE VALUE, and the reply says what it ignored.
//
// ‼️ AND NOTHING HERE CARRIES A FIGURE. The deal is typed by a human on the call. A default
// percentage in this file would be a discount SRT invented turning up in a message a patient
// sends to her friend. Same rule as src/lib/hub/review-script.ts.

import { supabaseAdmin } from "@/lib/db";

/** Where these commands are accepted. The referral is settled at handover. */
const REFERRAL_STEPS = new Set(["review_handover", "referral_engine_preview"]);

const CHARGE_PREFIX = /^\s*charge\s*:/i;
const SERVICE_PREFIX = /^\s*service offer\s*:/i;
const DEFAULT_PREFIX = /^\s*default offer\s*:/i;

export type ReferralCommandKind = "charge" | "service" | "default";

const COMMAND_PREFIXES: ReadonlyArray<readonly [ReferralCommandKind, RegExp]> = [
  ["charge", CHARGE_PREFIX],
  ["service", SERVICE_PREFIX],
  ["default", DEFAULT_PREFIX],
];

export type ReferralCommand =
  | { kind: "none" }
  | { kind: ReferralCommandKind; value: string; extra: string[] }
  | { kind: "combined"; commands: ReferralCommandKind[] };

function commandOf(line: string): ReferralCommandKind | null {
  for (const [kind, prefix] of COMMAND_PREFIXES) if (prefix.test(line)) return kind;
  return null;
}

function prefixOf(kind: ReferralCommandKind): RegExp {
  return (COMMAND_PREFIXES.find(([k]) => k === kind) ?? COMMAND_PREFIXES[0])[1];
}

/** Read one message as ONE command, decided by its first line. */
export function readReferralCommand(text: string): ReferralCommand {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const kind = lines.length ? commandOf(lines[0]) : null;
  if (!kind) return { kind: "none" };

  const rest = lines.slice(1);
  const others = rest.map(commandOf).filter((c): c is ReferralCommandKind => c !== null);
  if (others.length) return { kind: "combined", commands: [kind, ...others] };

  return { kind, value: lines[0].replace(prefixOf(kind), "").trim(), extra: rest };
}

const CHARGE_VALUES = ["before", "after", "both"] as const;

/**
 * Merge one key into `clients.review_workflow`.
 *
 * ‼️ READ THEN SPREAD THEN WRITE, NEVER A BARE ASSIGN. That bag is intake step 4's and owns ten
 * of the client's own answers plus six destination URLs. Assigning it deletes them, which is the
 * failure the dashboard route's header spends a paragraph on.
 */
async function mergeWorkflow(
  clientId: string,
  mutate: (bag: Record<string, unknown>) => void
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("clients")
    .select("review_workflow")
    .eq("id", clientId)
    .maybeSingle();
  if (error) return error.message;
  if (!data) return "no clients row with that id";

  const bag = { ...(((data as Record<string, unknown>).review_workflow ?? {}) as Record<string, unknown>) };
  mutate(bag);

  const { error: writeError } = await supabaseAdmin
    .from("clients")
    .update({ review_workflow: bag, updated_at: new Date().toISOString() })
    .eq("id", clientId);
  return writeError ? writeError.message : null;
}

export interface ReferralReply {
  message: string;
}

export async function handleReferralThreadReply(input: {
  clientId: string;
  stepKey: string | null;
  text: string;
}): Promise<ReferralReply | null> {
  if (!input.stepKey || !REFERRAL_STEPS.has(input.stepKey)) return null;

  const cmd = readReferralCommand(input.text);
  // ‼️ STILL null ON A MISS, so an ordinary sentence in the thread falls through untouched to
  // whatever else reads it. Only a FIRST line with a known prefix is a command.
  if (cmd.kind === "none") return null;

  if (cmd.kind === "combined") {
    const named = [...new Set(cmd.commands)].map((c) => `\`${c}:\``).join(" and ");
    return {
      message:
        `:warning: Nothing saved. That message has ${named} in it, and this thread takes one ` +
        "command per message, so none of them was applied. Send each one as its own message.",
    };
  }

  const ignored = cmd.extra.length
    ? [
        "",
        `_Not saved, because only the \`${cmd.kind}\` line itself is read: ${cmd.extra
          .map((l) => `"${l.length > 80 ? `${l.slice(0, 80)}...` : l}"`)
          .join(", ")}._`,
      ]
    : [];

  if (cmd.kind === "charge") {
    const value = cmd.value.toLowerCase();
    if (!(CHARGE_VALUES as readonly string[]).includes(value)) {
      return {
        message:
          `:warning: Nothing saved. \`charge:\` takes one of ${CHARGE_VALUES.join(", ")}. ` +
          "It decides when the front desk hands the card over.",
      };
    }
    const failed = await mergeWorkflow(input.clientId, (bag) => {
      bag.charge_timing = value;
    });
    if (failed) return { message: `:warning: Not saved: ${failed}` };
    return {
      message: [`Charging *${value}* the appointment. Recorded.`, ...ignored].join("\n"),
    };
  }

  if (cmd.kind === "default") {
    const offer = cmd.value;
    if (!offer) {
      return {
        message:
          ":warning: Nothing saved. `default offer:` takes the words a referred friend is given, " +
          "for a service that is not on the list.",
      };
    }
    const failed = await mergeWorkflow(input.clientId, (bag) => {
      const referral = { ...((bag.referral_offer ?? {}) as Record<string, unknown>) };
      referral.default_offer = offer.slice(0, 600);
      bag.referral_offer = referral;
    });
    if (failed) return { message: `:warning: Not saved: ${failed}` };
    return {
      message: [
        `Default referral offer: *${offer}*. A patient who names a service that is not listed gets this one.`,
        ...ignored,
      ].join("\n"),
    };
  }

  // ── service offer: <service> = <what their friend gets> ──
  //
  // ‼️ `=` RATHER THAN A COMMA, BECAUSE THE OFFER CONTAINS COMMAS. "80% off the first month,
  // then $299" is the shape of every real answer, so splitting on a comma would cut the deal in
  // half and store the remainder as nothing.
  const [rawService, ...rawOffer] = cmd.value.split("=");
  const service = (rawService ?? "").trim();
  const offer = rawOffer.join("=").trim();

  if (!service || !offer) {
    return {
      message:
        ":warning: Nothing saved. It reads `service offer: <service> = <what their friend gets>`, " +
        "for example `service offer: Botox = 80% off their first visit`. The `=` matters, because " +
        "an offer usually has a comma in it.",
    };
  }

  // ‼️ FIND THEN WRITE, AND DELIBERATELY NOT AN UPSERT. The unique index is on
  // `(client_id, lower(service_label))`, so case cannot be used to create a second "Botox" row.
  // PostgREST's `onConflict` names COLUMNS and cannot target a functional index, so an upsert on
  // "client_id,service_label" would have asked Postgres for a constraint that does not exist and
  // failed at runtime on the first command. Matching here in JS is what honours that index.
  const { data: existing, error: readError } = await supabaseAdmin
    .from("client_service_offers")
    .select("id, service_label, sort_order")
    .eq("client_id", input.clientId);

  if (readError) {
    const missing = readError.code === "42P01";
    return {
      message: missing
        ? ":warning: Not saved. The service offers table does not exist yet. Run `docs/2026-10-05-referral-invites.sql`."
        : `:warning: Not saved: ${readError.message}`,
    };
  }

  const rows = (existing ?? []) as Array<Record<string, unknown>>;
  const hit = rows.find(
    (r) => String(r.service_label ?? "").trim().toLowerCase() === service.toLowerCase()
  );
  const nextOrder = rows.reduce(
    (max, r) => Math.max(max, typeof r.sort_order === "number" ? r.sort_order : 0),
    -1
  );

  // ‼️ TYPING A DEAL FOR A SERVICE UN-EXCLUDES IT. Somebody naming an offer has decided the
  // service carries one, and leaving `excluded` true would store a deal the walk then refuses to
  // show, which is the most confusing state this table has.
  const { error } = hit
    ? await supabaseAdmin
        .from("client_service_offers")
        .update({
          offer_text: offer.slice(0, 600),
          excluded: false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", hit.id as string)
    : await supabaseAdmin.from("client_service_offers").insert({
        client_id: input.clientId,
        service_label: service.slice(0, 200),
        offer_text: offer.slice(0, 600),
        excluded: false,
        sort_order: nextOrder + 1,
      });

  if (error) {
    return { message: `:warning: Not saved: ${error.message}` };
  }

  return {
    message: [
      `*${service}* referrals get *${offer}*.`,
      "A patient who names that service is offered it for a friend. Everything else falls back to `default offer:`.",
      ...ignored,
    ].join("\n"),
  };
}
