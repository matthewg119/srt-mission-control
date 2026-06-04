// "find lead & build draft" — Section 1: resolve a dropped deal to a lead in Mission Control
// + Zoho CRM (fuzzy on misspellings), and post a confirmation in #srt-sub. Later sections
// extend handleBuildCommand to also produce the report + the two Outlook drafts.

import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { findDealByName } from "@/lib/zoho";

export interface LeadMatch {
  query: string;
  businessName: string | null;   // canonical name from the best match
  mcContactId: string | null;
  mcDealId: string | null;
  zohoLeadId: string | null;
  zohoDealId: string | null;
  confidence: "exact" | "fuzzy" | "none";
  candidates: Array<{ name: string; contactId: string }>;
}

type ContactRow = { id: string; business_name: string | null; zoho_lead_id: string | null };

const STOP = new Set(["llc", "inc", "corp", "co", "the", "and", "group", "company", "services", "service"]);

function tokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !STOP.has(t));
}

/** Token-overlap similarity 0..1 (Jaccard-ish, weighted to the query tokens). */
function similarity(query: string, candidate: string): number {
  const q = tokens(query);
  const c = new Set(tokens(candidate));
  if (q.length === 0) return 0;
  let hit = 0;
  for (const t of q) {
    if (c.has(t)) hit++;
    else if ([...c].some((x) => x.startsWith(t.slice(0, 4)) || t.startsWith(x.slice(0, 4)))) hit += 0.5; // prefix-fuzzy for typos
  }
  return hit / q.length;
}

/**
 * Resolve a business name to MC contact/deal + Zoho lead/deal. Exact ilike first, then a
 * token-overlap fuzzy scan so misspelled/abbreviated names still match.
 */
export async function resolveLead(query: string): Promise<LeadMatch> {
  const q = (query || "").trim();
  const base: LeadMatch = { query: q, businessName: null, mcContactId: null, mcDealId: null, zohoLeadId: null, zohoDealId: null, confidence: "none", candidates: [] };
  if (q.length < 3) return base;

  // 1) exact-ish substring
  const { data: exact } = await supabaseAdmin
    .from("contacts")
    .select("id, business_name, zoho_lead_id")
    .ilike("business_name", `%${q}%`)
    .limit(5);

  let contact: ContactRow | null = null;
  let confidence: LeadMatch["confidence"] = "none";

  if (exact && exact.length > 0) {
    contact = (exact.find((c) => (c.business_name ?? "").toLowerCase() === q.toLowerCase()) ?? exact[0]) as ContactRow;
    confidence = "exact";
    base.candidates = exact.map((c) => ({ name: (c.business_name as string) ?? "", contactId: c.id as string }));
  } else {
    // 2) fuzzy: scan candidates that share the first significant token, then rank by similarity
    const qt = tokens(q);
    if (qt.length > 0) {
      const { data: pool } = await supabaseAdmin
        .from("contacts")
        .select("id, business_name, zoho_lead_id")
        .or(qt.map((t) => `business_name.ilike.%${t}%`).join(","))
        .limit(50);
      const scored = (pool ?? [])
        .map((c) => ({ c, s: similarity(q, (c.business_name as string) ?? "") }))
        .filter((x) => x.s >= 0.5)
        .sort((a, b) => b.s - a.s);
      if (scored.length > 0) {
        contact = scored[0].c as ContactRow;
        confidence = "fuzzy";
        base.candidates = scored.slice(0, 5).map((x) => ({ name: (x.c.business_name as string) ?? "", contactId: x.c.id as string }));
      }
    }
  }

  if (contact) {
    base.mcContactId = contact.id;
    base.businessName = contact.business_name;
    base.zohoLeadId = contact.zoho_lead_id;
    base.confidence = confidence;
    const { data: deal } = await supabaseAdmin
      .from("deals")
      .select("id")
      .eq("contact_id", contact.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    base.mcDealId = (deal?.id as string) ?? null;
  }

  // Zoho converted Deal (notes/tracking target) — by canonical name, else the raw query.
  base.zohoDealId = await findDealByName(base.businessName || q);
  return base;
}

/** True when a #srt-sub message is the build trigger. */
export function isBuildCommand(text: string): boolean {
  return /^\s*build\b/i.test(text || "");
}

/** Extract the business name from "build <business>" (empty → derive from thread/files later). */
export function parseBuildBusiness(text: string): string {
  return (text || "").replace(/^\s*build\s*(draft|deal)?\s*/i, "").trim();
}

/**
 * Section 1 behaviour: resolve the lead and post a confirmation in-thread. Sections 3–5 will
 * extend this to gather statements, post the report, and create the two Outlook drafts.
 */
export async function handleBuildCommand(args: {
  channel: string;
  threadTs: string;
  userId: string;
  text: string;
}): Promise<boolean> {
  const business = parseBuildBusiness(args.text);
  if (!business) {
    await slack.postThreadReply(args.channel, args.threadTs, "Reply `build <business name>` so I can find the lead (I couldn't read a name).");
    return true;
  }

  const match = await resolveLead(business);
  if (match.confidence === "none" || !match.mcContactId) {
    await slack.postThreadReply(
      args.channel,
      args.threadTs,
      `⚠️ No lead found for *${business}* in Mission Control${match.zohoDealId ? ` (but found a Zoho Deal).` : "."} Check the spelling or create the lead first.`
    );
    return true;
  }

  const lines = [
    `🔎 *Matched lead* (${match.confidence}) — *${match.businessName}*`,
    `• MC contact: \`${match.mcContactId}\`${match.mcDealId ? ` · deal \`${match.mcDealId}\`` : ""}`,
    `• Zoho: ${match.zohoDealId ? `Deal \`${match.zohoDealId}\`` : match.zohoLeadId ? `Lead \`${match.zohoLeadId}\`` : "not found"}`,
  ];
  if (match.confidence === "fuzzy" && match.candidates.length > 1) {
    lines.push(`Other possible matches: ${match.candidates.slice(1, 4).map((c) => c.name).join(", ")}`);
  }
  lines.push("_Building the report + drafts next…_");
  await slack.postThreadReply(args.channel, args.threadTs, lines.join("\n"));
  return true;
}
