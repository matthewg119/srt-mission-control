// Steps 36 and 37: getting the attribution stack onto a client's own website.
//
// ─────────────────────────────────────────────────────────────────────────────
// ‼️ THIS IS THE DELIVERY HALF OF SECTION 3 OF THE AGREEMENT, AND SECTION 3 IS THE ONLY REASON
// SRT EVER GETS PAID.
//
// The guarantee counts a "qualified appointment" as one where the patient TELLS the clinic they
// came from AI. Nothing about that is automatic. It needs two things installed on somebody
// else's website, and if either is missing the work still happens and simply cannot be counted:
//
//   LAYER 2  "How did you hear about us?" on every booking form, theirs and ours.
//   LAYER 1  The SRT pixel, which corroborates and feeds the monthly report.
//
// LAYER 3, the AI Skin Concierge, is already two steps of its own (concierge_preview and
// concierge_live) and is the only layer that is 100% attributed with nothing else installed.
// ─────────────────────────────────────────────────────────────────────────────
//
// ‼️ THE PIXEL IS THE SAME SITE ACCESS THE CONCIERGE ALREADY NEEDS, AND THE AGREEMENT SAYS SO.
// One snippet, one ask, one person touching the site once. Adding a second install conversation
// weeks later is how the second tag never gets added.
//
// ‼️ NOTHING HERE MAY EVER MAKE THE PIXEL COUNT AN APPOINTMENT. See the header of
// src/lib/attribution/ai-domains.ts. This module installs the corroborating layer and the
// asking layer; the count itself is a generated column in Postgres that excludes pixel rows by
// construction, and it stays that way.

import { randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/lib/db";
import { SELF_REPORT_OPTIONS } from "@/lib/attribution/ai-domains";
import { appUrl } from "@/lib/onboarding2/constants";
import type { AutoResult } from "./artifacts/registry";

/**
 * ‼️ RANDOM, NOT DERIVED, AND NEVER clients.id. This string sits in the <head> of a website
 * anybody can view-source, so it is public the moment it is installed. A random key can be
 * rotated after a scrape or a departing web developer; a primary key cannot, and it is the join
 * key for every other table in this database.
 *
 * 24 bytes of base64url. Long enough that guessing one is not a thing, short enough to read
 * down a phone to a web developer without anybody losing their place.
 */
function newPixelKey(): string {
  return `srt_${randomBytes(18).toString("base64url")}`;
}

/**
 * Step 36's auto half. Mint the key if this client has none.
 *
 * ‼️ IT NEVER REGENERATES AN EXISTING KEY, AND THE GUARD IS THE POINT. This step is
 * auto_then_manual, so it genuinely does get re-run: by the ready sweep, by somebody unticking
 * and re-ticking, by a retry after an error. A second key would silently orphan a snippet that
 * is already live on the client's site, and the symptom would be traffic quietly stopping
 * rather than an error. Same rule concierge-setup.ts writes down about not clobbering a live
 * widget's booking config.
 */
export async function provisionPixelKey(clientId: string): Promise<AutoResult> {
  const { data, error } = await supabaseAdmin
    .from("clients")
    .select("id, pixel_key, domain")
    .eq("id", clientId)
    .maybeSingle();

  if (error) {
    return /pixel_key|schema cache/i.test(error.message)
      ? { ok: false, error: `docs/2026-09-03-attribution.sql has not been run: ${error.message}` }
      : { ok: false, error: error.message };
  }
  if (!data) return { ok: false, error: "No clients row." };

  if (data.pixel_key) {
    return {
      ok: true,
      note: `Site key already provisioned. Snippet is on this card; nothing was regenerated.`,
    };
  }

  const key = newPixelKey();
  const upd = await supabaseAdmin.from("clients").update({ pixel_key: key }).eq("id", clientId);
  if (upd.error) return { ok: false, error: upd.error.message };

  return { ok: true, note: `Site key provisioned. The snippet to paste is on this card.` };
}

export interface SnippetFacts {
  pixelKey: string | null;
  domain: string | null;
  /** Real, non-test sessions seen from this client. The install's only honest proof. */
  sessions: number | null;
  /** Bookings the pixel saw. Corroboration only, never the count. */
  pixelBookings: number | null;
  /** Bookings somebody was actually asked about. THIS is what the guarantee counts from. */
  answeredBookings: number | null;
}

export async function snippetFacts(clientId: string): Promise<SnippetFacts> {
  const { data } = await supabaseAdmin
    .from("clients")
    .select("pixel_key, domain")
    .eq("id", clientId)
    .maybeSingle();

  // ‼️ THREE SEPARATE COUNTS RATHER THAN ONE GROUPED QUERY, BECAUSE THE THIRD ONE IS THE ONLY
  // ONE THAT MATTERS AND IT MUST NOT BE DERIVABLE FROM THE OTHER TWO BY ARITHMETIC. A reader
  // who can compute "answered = total - pixel" will eventually do it, and the moment a fourth
  // basis exists that subtraction is wrong in the direction that inflates the number the
  // guarantee turns on.
  const sessions = await countLive("attribution_sessions", clientId, null);
  const pixelBookings = await countLive("attribution_bookings", clientId, ["pixel_only"]);
  const answeredBookings = await countLive("attribution_bookings", clientId, [
    "assistant",
    "self_reported",
  ]);

  return {
    pixelKey: (data?.pixel_key as string | null) ?? null,
    domain: (data?.domain as string | null) ?? null,
    sessions,
    pixelBookings,
    answeredBookings,
  };
}

/**
 * Count real rows for one client, optionally narrowed to a set of bases.
 *
 * ‼️ is_test = false IS NOT OPTIONAL AND IS APPLIED HERE RATHER THAN LEFT TO THE CALLER. Test
 * mode writes to these same tables on purpose, so that a test proves the real path end to end.
 * The cost of that decision is that every read has to exclude them, and a card that told
 * somebody their install was working because a test event landed would be the worst version of
 * this feature: confidently wrong, on the number the whole engagement is measured by.
 *
 * ‼️ null IS "COULD NOT CHECK" AND IS NEVER ZERO. Same rule countRows() in step-verify.ts
 * writes down: a failed query reported as 0 tells somebody their work is missing because
 * Supabase blinked.
 */
async function countLive(
  table: string,
  clientId: string,
  bases: string[] | null
): Promise<number | null> {
  let q = supabaseAdmin
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .eq("is_test", false);
  if (bases) q = q.in("count_basis", bases);
  const { count, error } = await q;
  if (error) {
    console.error(`[tracking-setup] count on ${table} failed:`, error.message);
    return null;
  }
  return count ?? 0;
}

/**
 * The exact tag to paste, with this client's key already in it.
 *
 * ‼️ IT IS PRINTED WITH THE KEY FILLED IN RATHER THAN AS A TEMPLATE WITH A PLACEHOLDER. A
 * generic snippet plus "replace YOUR_KEY_HERE" is how a site goes live with the literal string
 * YOUR_KEY_HERE in it, and the failure is silent: the collector answers 204 to an unknown key
 * by design, so nothing errors and no data ever arrives.
 *
 * `data-confirm` is a comma-separated list of PATH PREFIXES that mean a booking just completed.
 * It is the one part nobody can guess: every booking system has a different confirmation URL,
 * which is exactly why it is a question on the call rather than a default here.
 */
export function snippetFor(pixelKey: string, confirmPaths: string[]): string {
  const confirm = confirmPaths.filter(Boolean).join(",");
  return (
    `<script async src="${appUrl()}/px.js"\n` +
    `        data-key="${pixelKey}"` +
    (confirm ? `\n        data-confirm="${confirm}"` : "") +
    `></script>`
  );
}

/**
 * The six options, as the exact words to put on their booking form.
 *
 * ‼️ THE WORDING IS FIXED AND THE ORDER IS FIXED. These are stored as slugs precisely so the
 * labels can be reworded without breaking a year of monthly reports, but a clinic that renames
 * "ChatGPT or another AI" to "Online" has broken the only question the guarantee turns on. This
 * list is what gets read down the phone.
 */
export function selfReportFieldSpec(): string[] {
  return [
    'Question label: "How did you hear about us?"',
    "Required: yes. Single choice. Six options, in this order:",
    ...SELF_REPORT_OPTIONS.map((o, i) => `  ${i + 1}. ${o.label}`),
  ];
}

/**
 * ‼️ THE ONE OPTION THAT MAY NEVER BE REWORDED OR MERGED. Everything else on that list is
 * there so this one does not stand alone and prompt the answer.
 */
export const AI_OPTION_LABEL = SELF_REPORT_OPTIONS.find((o) => o.slug === "ai")!.label;
