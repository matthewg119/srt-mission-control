// The switch that puts the widget on a real page, and takes it off one.
//
// Matthew, 2026-09-17: "Also give me a button where i can turn on and off the ai concierge for my
// clients like a simple toggle for the ai concierge."
//
// ‼️ UNTIL THIS FILE EXISTED NOTHING IN THE REPO EVER WROTE `enabled`. concierge-setup.ts says the
// omission was deliberate and concierge_live "is where somebody flips enabled. It is manual and it
// stays manual" — but manual meant a hand-typed UPDATE in Supabase, because no surface offered it.
// A column only a database console can reach is not a decision anybody makes twice. This is that
// surface, and it is still manual: a person presses it.
//
// ‼️ IT WRITES `enabled` AND NOTHING ELSE. `addon_status` is the COMMERCIAL decision (did they buy
// it) and lives in concierge-addon.ts; `enabled` is whether the widget renders. Folding them into
// one control would mean turning a client off for a fortnight reads, later, as them never having
// bought it. Two columns, two meanings, two doors.
//
// ‼️ OFF IS NEVER REFUSED. Turning it ON checks the add-on and the audience; turning it OFF checks
// nothing at all. This is the kill switch for a widget sitting on somebody else's live website, and
// a kill switch that can decline to fire is not one. The asymmetry is the design.

import { supabaseAdmin } from "@/lib/db";
import { stepNumber } from "@/config/delivery-steps";
import type { AddonStatus } from "@/lib/concierge/config";

export interface ConciergeSwitchState {
  /** The column as stored. What the toggle shows and what a write changes. */
  enabled: boolean;
  /**
   * What loadConciergeConfig actually serves, which is `enabled && addonStatus !== "declined"`
   * (config.ts:164).
   *
   * ‼️ BOTH ARE REPORTED BECAUSE THEY CAN DISAGREE. A declined client whose column reads true is
   * off on every page, and a surface showing only the column would say "on" about a widget nobody
   * can see. Everything user facing reads `live`; only the toggle itself reads `enabled`.
   */
  live: boolean;
  addonStatus: AddonStatus;
  audienceConfirmedAt: string | null;
  bookingMode: string | null;
  bookingUrl: string | null;
  bookingPhone: string | null;
  allowedOrigins: string[];
  slug: string | null;
}

function normalizeAddon(v: unknown): AddonStatus {
  return v === "included" || v === "declined" ? v : "undecided";
}

/**
 * Read the switch for one client. `null` means step 18 has not provisioned a config row.
 *
 * Every column is named explicitly rather than `select("*")` for the reason pages.ts gives: one
 * unknown column fails the WHOLE PostgREST select and supabase-js RETURNS the error instead of
 * throwing, so a try/catch never fires. These columns all shipped on or before 2026-09-16 and are
 * verified present in production; a NEW one would go in its own select.
 */
export async function conciergeSwitchState(clientId: string): Promise<ConciergeSwitchState | null> {
  const { data, error } = await supabaseAdmin
    .from("concierge_configs")
    .select(
      "enabled, addon_status, audience_confirmed_at, booking_mode, booking_url, booking_phone, allowed_origins, clients!inner(slug)"
    )
    .eq("client_id", clientId)
    .maybeSingle();

  if (error) {
    console.error(`[concierge-enabled] read failed: ${error.message}`);
    return null;
  }
  if (!data) return null;

  const addonStatus = normalizeAddon(data.addon_status);
  const enabled = data.enabled === true;
  const clients = (data as unknown as { clients: { slug: string } | Array<{ slug: string }> }).clients;

  return {
    enabled,
    live: enabled && addonStatus !== "declined",
    addonStatus,
    audienceConfirmedAt: (data.audience_confirmed_at as string | null) ?? null,
    bookingMode: (data.booking_mode as string | null) ?? null,
    bookingUrl: (data.booking_url as string | null) ?? null,
    bookingPhone: (data.booking_phone as string | null) ?? null,
    allowedOrigins: Array.isArray(data.allowed_origins) ? (data.allowed_origins as string[]) : [],
    slug: Array.isArray(clients) ? (clients[0]?.slug ?? null) : (clients?.slug ?? null),
  };
}

export type SetEnabledResult =
  | { ok: true; state: ConciergeSwitchState; lines: string[] }
  | { ok: false; error: string };

/**
 * Flip it, and say what actually changed.
 *
 * Turning ON refuses on two things and WARNS on two more:
 *   refuse  no config row            step 18 has not run, so there is nothing to switch
 *   refuse  addon_status = declined  they did not buy it; `concierge install` is the fix
 *   warn    audience unconfirmed     the lane is a seed, not a ratified choice
 *   warn    no booking destination   the widget has nowhere to send anybody
 *
 * ‼️ THE TWO WARNINGS DO NOT BLOCK, AND THAT IS ON PURPOSE. They are step 36's conditions and step
 * 36's verifier still refuses Done over both of them. Blocking here as well would mean the only way
 * to demo a widget mid-setup is SQL, which is the situation this file exists to end. The switch
 * makes it visible; the step is what makes it finished.
 */
export async function setConciergeEnabled(args: {
  clientId: string;
  enabled: boolean;
  by: string;
  /** Where the press happened, for the event log. */
  source?: "slack" | "dashboard";
}): Promise<SetEnabledResult> {
  const before = await conciergeSwitchState(args.clientId);
  if (!before) {
    return {
      ok: false,
      error:
        "this client has no concierge row yet. Step 18 (concierge_preview) creates it; re-run that step first.",
    };
  }

  if (args.enabled && before.addonStatus === "declined") {
    return {
      ok: false,
      error:
        "the concierge add-on is marked declined for this client, so turning it on here would put a widget on a page they did not buy. Type `concierge install` in any of their step threads first.",
    };
  }

  // Not an error and not a write. Saying "already on" is more useful than a silent success that
  // looks identical to a real change.
  if (before.enabled === args.enabled) {
    return {
      ok: true,
      state: before,
      lines: [`:information_source: The concierge was already ${args.enabled ? "ON" : "OFF"} for this client. Nothing changed.`],
    };
  }

  const { error } = await supabaseAdmin
    .from("concierge_configs")
    .update({ enabled: args.enabled, updated_at: new Date().toISOString() })
    .eq("client_id", args.clientId);

  if (error) return { ok: false, error: error.message };

  // The public config route is unstable_cache'd on this tag. Without the bust the widget keeps its
  // old answer for five minutes, which reads as the button not working. Same shape as
  // api/concierge/corner/route.ts.
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
    kind: "button",
    author: args.by,
    text: `concierge ${args.enabled ? "on" : "off"}`,
    payload: { handler: "concierge-enabled", enabled: args.enabled, was: before.enabled },
  });

  const after: ConciergeSwitchState = {
    ...before,
    enabled: args.enabled,
    live: args.enabled && before.addonStatus !== "declined",
  };

  return { ok: true, state: after, lines: switchLines(after, args.by) };
}

/** What the press means, in the order somebody reading it needs to know. */
export function switchLines(state: ConciergeSwitchState, by: string): string[] {
  if (!state.enabled) {
    return [
      `:no_entry_sign: *AI Concierge OFF* (${by}). It disappears from every page of theirs within five minutes.`,
      "Their pages, magnets and plan are unaffected. Press it again to bring it back.",
    ];
  }

  const lines = [
    `:white_check_mark: *AI Concierge ON* (${by}). It appears on every page carrying their embed within five minutes.`,
  ];

  // The two step 36 conditions the switch deliberately does not enforce. Named here so turning it
  // on never quietly ships a widget that greets somebody and then has nowhere to send them.
  if (!state.audienceConfirmedAt) {
    lines.push(
      ":warning: The audience is still the seeded one, not a confirmed choice. Confirm the lane on step 18 before this is in front of anybody real."
    );
  }
  if (state.bookingMode === "none" || (!state.bookingUrl && !state.bookingPhone)) {
    lines.push(
      ":warning: No booking destination is set, so the widget can talk but has nowhere to send a booking. " +
        "`booking: <their booking link>` sets one, and a phone number or `booking: callback` also work."
    );
  }
  if (!state.allowedOrigins.length) {
    lines.push(
      ":warning: `allowed_origins` is empty, which means their own hosts only. If the widget is meant to sit on another domain, add it first."
    );
  }

  // stepNumber(), never a literal: delivery-steps.ts computes the board number from array position
  // and renumbers every step whenever one is inserted.
  lines.push(
    `Step ${stepNumber("concierge_live")} (\`concierge_live\`) still has to be ticked separately, and its check reads all of the above.`
  );
  return lines;
}
