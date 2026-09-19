// Has this person, or this company, been contacted by us before. Ever. On any channel.
//
// Matthew, 2026-09-17: "Suppression list applied (replies, current clients, active deals, opt-outs,
// exhausted domains) ... Suppression + dedupe belongs with our source of truth, not inside a
// vendor's cache we're renting."
//
// ‼️ NOTHING IN THIS REPO COULD ANSWER THAT QUESTION BEFORE THIS FILE. dedup.ts answers "is this row
// a duplicate of another row IN THIS FILE", which is a different question with a similar name, and
// answering the second one does nothing about mailing somebody for the fourth time.
//
// ‼️ IT IS NOT SCRAPER-ONLY, AND THAT IS WHY IT LIVES UNDER outreach/ RATHER THAN scraper/. The same
// question has to be asked by the sequencer, by the dialer and by anything that ever sends. A copy
// per caller is how one of them ends up checking three of the five sources.
//
// ‼️ BY DOMAIN AS WELL AS BY EMAIL. The illustrative case Matthew gave is one prospect receiving
// three campaigns from three of our sending domains: the key is the PROSPECT or the COMPANY across
// every campaign, not the address that happens to be on this row. matthew@clinic.com and
// info@clinic.com are the same company and a second mail to the second address is still a second
// mail.

import { supabaseAdmin } from "@/lib/db";

/** Why an address is held back. Ordered by how final it is: an opt-out outranks a stale touch. */
export type SuppressionReason =
  | "opted_out"
  | "current_client"
  | "active_deal"
  | "replied"
  | "already_contacted"
  | "domain_contacted";

export interface Suppression {
  reason: SuppressionReason;
  /** What was found, for the card. Never a raw row: this gets printed. */
  detail: string;
}

export interface SuppressionInput {
  email?: string | null;
  domain?: string | null;
}

/**
 * What a `closed_reason` looks like when the close was THEM asking us to stop, rather than a bounce
 * or a no. Kept in step with classify-reply.ts's OPT_OUT patterns, which are what write these
 * strings in the first place via `applyReply`'s `closed_reason: c.summary`.
 */
const OPT_OUT_CLOSE = /unsubscrib|opt(ed)? out|remove me|take me off|stop email|do not (contact|email)/i;

/** Most final first. A row matching two reasons is reported by the one that matters more. */
const PRECEDENCE: SuppressionReason[] = [
  "opted_out",
  "current_client",
  "active_deal",
  "replied",
  "already_contacted",
  "domain_contacted",
];

export function normalizeEmail(v: string | null | undefined): string | null {
  const s = (v ?? "").trim().toLowerCase();
  return s.includes("@") ? s : null;
}

/**
 * The registrable host, lowercased, without www.
 *
 * ‼️ NOT A PUBLIC-SUFFIX PARSE. `clinic.co.uk` and `clinic.com` are different companies and both are
 * kept whole; the only thing stripped is the leading www, which is never part of an identity. A
 * naive "last two labels" rule would collapse every .co.uk in the file into one another.
 */
export function normalizeDomain(v: string | null | undefined): string | null {
  let s = (v ?? "").trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/^https?:\/\//, "").replace(/^www\./, "");
  s = s.split("/")[0].split("?")[0].split("#")[0];
  if (s.includes("@")) s = s.split("@")[1] ?? "";
  return s.includes(".") ? s : null;
}

export function domainOfEmail(email: string | null | undefined): string | null {
  const e = normalizeEmail(email);
  return e ? normalizeDomain(e.split("@")[1]) : null;
}

/**
 * Check one address or company against everything we have ever sent.
 *
 * ‼️ EVERY SOURCE IS ITS OWN SELECT AND EVERY ONE DEGRADES TO "NOT SUPPRESSED" ON AN ERROR, WHICH IS
 * THE DANGEROUS DIRECTION AND IS DELIBERATE ANYWAY. The alternative is suppressing a whole list
 * because one table was briefly unreadable, which reads as the pipeline being broken and gets the
 * check disabled. The error is logged loudly and checkMany reports how many sources answered, so a
 * run where a source was down says so on the card rather than quietly passing everything.
 */
export async function checkSuppression(input: SuppressionInput): Promise<Suppression | null> {
  const email = normalizeEmail(input.email);
  const domain = normalizeDomain(input.domain) ?? domainOfEmail(email);
  if (!email && !domain) return null;

  const found = new Map<SuppressionReason, string>();

  // 1. Opted out. contacts.do_not_contact, which already exists and is read by zoho-guardian as a
  // last-resort gate. There is no separate opt-out table and there does not need to be.
  if (email) {
    const { data, error } = await supabaseAdmin
      .from("contacts")
      .select("email, do_not_contact_reason")
      .eq("email", email)
      .eq("do_not_contact", true)
      .limit(1);
    if (error) console.error(`[suppression] contacts read failed: ${error.message}`);
    else if (data?.length) {
      found.set("opted_out", `asked not to be contacted${data[0].do_not_contact_reason ? `: ${data[0].do_not_contact_reason}` : ""}`);
    }
  }

  // 2. A paying client. A clients row is the authoritative signal, and mailing a cold sequence to
  // somebody we already work for is the worst single failure this file prevents.
  if (domain) {
    const { data, error } = await supabaseAdmin
      .from("clients")
      .select("slug, domain")
      .eq("domain", domain)
      .limit(1);
    if (error) console.error(`[suppression] clients read failed: ${error.message}`);
    else if (data?.length) found.set("current_client", `already a client (${data[0].slug})`);
  }

  // 3. Contacted before, by email or by domain, and whether they ever replied.
  if (email || domain) {
    const q = supabaseAdmin
      .from("outreach_prospects")
      .select("email, website, state, closed_reason, last_touch_at, last_reply_at")
      .limit(5);
    const { data, error } = email && domain
      ? await q.or(`email.eq.${email},website.ilike.%${domain}%`)
      : await (email ? q.eq("email", email) : q.ilike("website", `%${domain}%`));

    if (error) console.error(`[suppression] outreach_prospects read failed: ${error.message}`);
    else
      for (const r of data ?? []) {
        const matchedEmail = normalizeEmail(r.email as string | null) === email;
        if (r.last_reply_at) {
          found.set("replied", `replied on ${String(r.last_reply_at).slice(0, 10)}`);
        }

        // ‼️ THIS TEST USED TO READ `state.includes("CLOSED")` AND REPORT IT AS "an open
        // conversation (CLOSED)", which is backwards on both halves. CLOSED is the one state that
        // is definitively NOT open, and the four states that ARE open were the ones falling
        // through. The row was still suppressed, so nothing looked broken, but it was suppressed
        // under a reason that reads as nonsense on the card, and the obvious "fix" for somebody
        // reading that card later is to delete the branch, which would un-suppress every opt-out
        // that reached us by email. The states are a closed set in types.ts, so name them.
        const state = String(r.state ?? "").toUpperCase();
        if (state === "CLOSED") {
          const why = String(r.closed_reason ?? "");
          if (OPT_OUT_CLOSE.test(why)) {
            found.set("opted_out", `asked not to be contacted${why ? `: ${why}` : ""}`);
          } else {
            // Bounced, or told us no. Either way the conversation ended and re-mailing it is the
            // thing this file exists to stop. `replied` is set separately above when they actually
            // wrote back, and it outranks this.
            found.set("already_contacted", `a conversation that closed${why ? ` (${why})` : ""}`);
          }
        } else if (state === "REPLIED_INTERESTED" || state === "ASKED_PRICE_HOT" || state === "OBJECTION") {
          found.set("active_deal", `an open conversation (${state})`);
        }
        const when = r.last_touch_at ? ` on ${String(r.last_touch_at).slice(0, 10)}` : "";
        found.set(
          matchedEmail ? "already_contacted" : "domain_contacted",
          matchedEmail ? `this address was mailed${when}` : `somebody at ${domain} was mailed${when}`
        );
      }
  }

  for (const reason of PRECEDENCE) {
    const detail = found.get(reason);
    if (detail) return { reason, detail };
  }
  return null;
}

export interface SuppressionSummary {
  checked: number;
  suppressed: number;
  /** How many of each reason, for the card. */
  byReason: Record<string, number>;
}

/**
 * Check a whole list, one at a time.
 *
 * ‼️ SEQUENTIAL ON PURPOSE. A few thousand rows against four tables is a lot of queries, and running
 * them in parallel is how a suppression pass takes the database down and gets itself removed from
 * the pipeline. This is the last stage before a send, it is not on anybody's critical path, and slow
 * is the correct trade here.
 */
export async function checkMany(
  rows: ReadonlyArray<SuppressionInput & { id: string }>
): Promise<{ summary: SuppressionSummary; hits: Map<string, Suppression> }> {
  const hits = new Map<string, Suppression>();
  const byReason: Record<string, number> = {};

  for (const row of rows) {
    const hit = await checkSuppression(row);
    if (!hit) continue;
    hits.set(row.id, hit);
    byReason[hit.reason] = (byReason[hit.reason] ?? 0) + 1;
  }

  return {
    summary: { checked: rows.length, suppressed: hits.size, byReason },
    hits,
  };
}

/** The funnel line for the card. Counts, never rates: a rate hides the denominator. */
export function suppressionLines(s: SuppressionSummary): string[] {
  if (!s.checked) return [];
  const kept = s.checked - s.suppressed;
  const lines = [`*Suppression:* ${kept} of ${s.checked} survive, ${s.suppressed} held back.`];
  for (const reason of PRECEDENCE) {
    const n = s.byReason[reason];
    if (n) lines.push(`  • ${LABEL[reason]}: ${n}`);
  }
  return lines;
}

const LABEL: Record<SuppressionReason, string> = {
  opted_out: "asked not to be contacted",
  current_client: "already a client",
  active_deal: "an open conversation",
  replied: "has replied to us before",
  already_contacted: "this address was mailed before",
  domain_contacted: "somebody at that company was mailed before",
};
