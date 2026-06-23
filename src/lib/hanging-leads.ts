// Daily morning digest — the "organize my day" board. Scans Zoho for every lead/
// deal in an ACTIVE stage (everything except Declined / DNQ / Deal Lost / won-closed)
// that has had NO contact for >= 7 days. Posts ONE digest to SLACK_FOLLOWUPS_CHANNEL:
// each hanging lead listed one after another with stage, days since last contact, a
// 1-click Zoho deep link, and a brief latest-note preview.
//
// Deal Lost is handled by a SECOND scan with a revival cadence: follow up 1 week
// after it was marked lost, then every 2 weeks thereafter.
//
// For the priority subset that has a Supabase contact + email, we also post a
// VeKtor-drafted follow-up EMAIL card (✅ Approve to send), reusing draftFollowupEmail
// + postApprovalRequest. Deduped via contacts.last_digest_nudge_at (active) and
// contacts.last_lost_followup_at (Deal Lost cadence). Leads without a Supabase contact
// still appear in the digest with their Zoho link so they can be worked by hand.
//
// Driven by /api/cron/hanging-leads (8am ET weekday mornings).

import { supabaseAdmin } from "@/lib/db";
import { slack, type SlackBlock } from "@/lib/slack-bot";
import { zohoRequest, getLeadNotes } from "@/lib/zoho";
import { buildMerchantContext } from "@/lib/ai-intel/merchant-context";
import { draftFollowupEmail } from "@/lib/ai-intel/followup-director";
import { postApprovalRequest } from "@/lib/ai-intel/slack-approval";
import type { PendingActionPayload } from "@/lib/ai-intel/types";

const HANGING_DAYS = 7; // no contact for this long → hanging
const DIGEST_MAX = 30; // leads enriched + listed in detail per run
const EMAIL_CARD_MAX = 10; // email drafts per run (LLM cost)
const RENUDGE_DAYS = 7; // don't re-card the same contact within a week
const LOST_FIRST_DAYS = 7; // first Deal Lost follow-up: 1 week after lost
const LOST_REPEAT_DAYS = 14; // then every 2 weeks
const PER_PAGE = 200; // Zoho hard cap
const PULL_LIMIT = parseInt(process.env.HANGING_PULL_LIMIT || "400", 10);

const ZOHO_FIELDS = [
  "First_Name", "Last_Name", "Company", "Phone", "Mobile", "Email",
  "Lead_Status", "Lead_Source", "Modified_Time", "Created_Time",
  "Funding_Amount_Requested", "Monthly_Revenue",
].join(",");

// Excluded in the Zoho query (kept ≤8 conditions to stay under the criteria cap).
const QUERY_EXCLUDE = [
  "Declined", "Dead Declined", "DNQ", "Deal Lost",
  "Closed", "Funded", "Converted", "Not Interested",
];
// Full JS-side exclusion (defense-in-depth for picklist drift). Deal Lost is NOT
// here because it is included only via the dedicated second scan below.
const TERMINAL_KEYWORDS = [
  "declined", "dead", "dnq", "lost", "junk", "duplicate",
  "not interested", "unresponsive", "wrong number", "bad lead",
  "funded", "converted", "closed",
];

function isExcludedStage(stage: string | null | undefined): boolean {
  if (!stage) return false;
  const lower = stage.toLowerCase();
  return TERMINAL_KEYWORDS.some((k) => lower.includes(k));
}

type ZohoRow = Record<string, unknown>;

function str(v: unknown): string | null {
  if (typeof v === "string") return v.trim() ? v : null;
  return v != null ? String(v) : null;
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

const ZOHO_LEAD_URL = (id: string) => `https://crm.zoho.com/crm/org/leads/view/${id}`;

// Paginated Zoho /Leads/search, oldest-modified first (most-hanging first).
async function searchByCriteria(criteria: string, limit: number): Promise<ZohoRow[]> {
  const rows: ZohoRow[] = [];
  let page = 1;
  const maxPages = Math.ceil(limit / PER_PAGE);
  while (page <= maxPages) {
    const path =
      `/Leads/search?criteria=${encodeURIComponent(criteria)}` +
      `&fields=${ZOHO_FIELDS}&per_page=${PER_PAGE}&page=${page}` +
      `&sort_by=Modified_Time&sort_order=asc`;
    let result: { data?: ZohoRow[]; info?: { more_records?: boolean } };
    try {
      result = (await zohoRequest("GET", path)) as typeof result;
    } catch (e) {
      console.error("[hanging-leads] Zoho search failed:", (e as Error).message);
      break;
    }
    const batch = result.data || [];
    rows.push(...batch);
    if (batch.length < PER_PAGE || !result.info?.more_records || rows.length >= limit) break;
    page++;
  }
  return rows.slice(0, limit);
}

interface Candidate {
  zohoId: string;
  name: string;
  firstName: string;
  stage: string;
  fund: string | null;
  email: string | null;
  modifiedAt: string | null;
  notePreview: string | null;
  daysSinceContact: number | null;
}

// Build the per-lead detail (latest note preview + refined last-contact) for the
// capped digest set. One Zoho note call per lead.
async function enrich(row: ZohoRow): Promise<Candidate> {
  const zohoId = String(row.id);
  const firstName = str(row.First_Name) || "";
  const lastName = str(row.Last_Name) || "";
  const name = `${firstName} ${lastName}`.trim() || str(row.Company) || "Unknown";
  const stage = str(row.Lead_Status) || "No status";
  const modifiedAt = str(row.Modified_Time);
  const fund = row.Funding_Amount_Requested
    ? `$${Number(row.Funding_Amount_Requested).toLocaleString()}`
    : null;

  let notePreview: string | null = null;
  let lastNoteAt: string | null = null;
  const notes = await getLeadNotes(zohoId, 1).catch(() => []);
  if (notes[0]) {
    const t = (notes[0].Note_Title || "").trim();
    const c = (notes[0].Note_Content || "").trim();
    notePreview = `${t ? `${t}: ` : ""}${c}`.slice(0, 180) || null;
    lastNoteAt = notes[0].Modified_Time || notes[0].Created_Time || null;
  }

  // Last contact = the most recent of lead-modified and latest-note timestamps.
  const candidates = [modifiedAt, lastNoteAt].filter(Boolean) as string[];
  const lastContact = candidates.sort().slice(-1)[0] ?? modifiedAt;

  return {
    zohoId,
    name,
    firstName: firstName || name.split(" ")[0],
    stage,
    fund,
    email: str(row.Email),
    modifiedAt,
    notePreview,
    daysSinceContact: daysSince(lastContact),
  };
}

function digestLine(c: Candidate): string {
  const ageTxt = c.daysSinceContact != null ? `${c.daysSinceContact}d since contact` : "no contact date";
  const head = `*<${ZOHO_LEAD_URL(c.zohoId)}|${c.name}>* — _${c.stage}_ · ${ageTxt}${c.fund ? ` · ${c.fund} ask` : ""}`;
  const note = c.notePreview ? `\n> ${c.notePreview}` : "";
  return head + note;
}

// Chunk leads into Slack messages (≤ ~45 section blocks per message, under the 50 cap).
function buildDigestMessages(header: string, lines: string[]): SlackBlock[][] {
  const messages: SlackBlock[][] = [];
  const PER_MSG = 40;
  for (let i = 0; i < lines.length; i += PER_MSG) {
    const slice = lines.slice(i, i + PER_MSG);
    const blocks: SlackBlock[] = [];
    if (i === 0) {
      blocks.push({ type: "header", text: { type: "plain_text", text: header, emoji: true } } as SlackBlock);
    }
    for (const line of slice) {
      blocks.push({ type: "section", text: { type: "mrkdwn", text: line } } as SlackBlock);
    }
    messages.push(blocks);
  }
  return messages;
}

// Post a VeKtor-drafted follow-up email card for one contact (reuses the
// followup-director flow). Returns true if a card was posted.
async function postEmailCard(contactId: string, channel: string, reason: string): Promise<boolean> {
  const ctx = await buildMerchantContext({ contactId });
  if (!ctx || ctx.contact.do_not_contact || !ctx.contact.email) return false;

  const draft = await draftFollowupEmail(ctx, reason);
  if (!draft) return false;

  const firstName = (ctx.contact.first_name ?? "").trim() || "there";
  const payload: PendingActionPayload = {
    action_type: "send_email",
    to: ctx.contact.email,
    subject: draft.subject,
    body: `Hello ${firstName},\n\n${draft.copy}`,
    is_html: false,
    zoho_id: ctx.contact.zoho_lead_id ?? undefined,
    contact_id: ctx.contact.id,
    signature_name: "S",
    note: { title: "Email sent", content: `Follow-up email sent — Subject: ${draft.subject}` },
  };
  const summary = [
    `*Follow-up email* — ${ctx.contact.business_name ?? firstName}`,
    `_Why now:_ ${reason}`,
    ``,
    `*To:* ${ctx.contact.email}`,
    `*Subject:* ${draft.subject}`,
    "```",
    `Hello ${firstName},`,
    ``,
    draft.copy,
    "```",
    `_+ your Outlook "S" signature (appended on send)_`,
  ].join("\n");

  const res = await postApprovalRequest({
    summary,
    payload,
    channel,
    zohoId: ctx.contact.zoho_lead_id ?? undefined,
    merchantId: ctx.contact.id,
  });
  return Boolean(res.slackTs);
}

export async function runHangingLeadScan(): Promise<{
  hanging: number;
  lostDue: number;
  emailCards: number;
  posted: boolean;
}> {
  const channel =
    process.env.SLACK_FOLLOWUPS_CHANNEL ||
    process.env.SLACK_TEAM_CHANNEL ||
    process.env.SLACK_AI_APPROVALS_CHANNEL ||
    process.env.SLACK_HOT_LEADS_CHANNEL ||
    "";
  if (!channel) {
    console.error("[hanging-leads] no Slack channel configured");
    return { hanging: 0, lostDue: 0, emailCards: 0, posted: false };
  }

  // ── 1. Active-stage scan ──────────────────────────────────────────────
  const activeCriteria =
    `(Lead_Status:not_equal:${QUERY_EXCLUDE[0]})` +
    QUERY_EXCLUDE.slice(1).map((st) => `and(Lead_Status:not_equal:${st})`).join("");
  const activeRows = (await searchByCriteria(activeCriteria, PULL_LIMIT))
    .filter((r) => !isExcludedStage(str(r.Lead_Status)));

  // Cheap first-pass: only leads not modified in >= HANGING_DAYS (oldest first).
  const stale = activeRows.filter((r) => {
    const d = daysSince(str(r.Modified_Time));
    return d != null && d >= HANGING_DAYS;
  });

  // Enrich the most-hanging up to DIGEST_MAX (one note call each), then confirm
  // hanging with the refined last-contact (a recent note disqualifies).
  const enriched: Candidate[] = [];
  for (const row of stale.slice(0, DIGEST_MAX)) {
    const c = await enrich(row);
    if (c.daysSinceContact != null && c.daysSinceContact >= HANGING_DAYS) enriched.push(c);
  }

  // ── 2. Deal Lost revival scan ─────────────────────────────────────────
  const lostRows = await searchByCriteria(`(Lead_Status:equals:Deal Lost)`, PULL_LIMIT);
  const lostDue: Candidate[] = [];
  for (const row of lostRows) {
    const zohoId = String(row.id);
    const lostDays = daysSince(str(row.Modified_Time));
    if (lostDays == null || lostDays < LOST_FIRST_DAYS) continue;

    // Cadence dedup needs a Supabase contact; fetch the bookkeeping row.
    const { data: contact } = await supabaseAdmin
      .from("contacts")
      .select("id, last_lost_followup_at")
      .eq("zoho_lead_id", zohoId)
      .maybeSingle();
    const lastFollowup = (contact?.last_lost_followup_at as string | null) ?? null;
    const sinceFollowup = daysSince(lastFollowup);
    if (lastFollowup && sinceFollowup != null && sinceFollowup < LOST_REPEAT_DAYS) continue;

    const c = await enrich(row);
    lostDue.push(c);
    if (contact?.id) {
      await supabaseAdmin
        .from("contacts")
        .update({ last_lost_followup_at: new Date().toISOString() })
        .eq("id", contact.id);
    }
    if (lostDue.length >= DIGEST_MAX) break;
  }

  // ── 3. Build + post the digest ────────────────────────────────────────
  const date = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const lines: string[] = [];
  if (enriched.length) {
    lines.push(`*🧵 Hanging deals (no contact ${HANGING_DAYS}+ days) — work these:*`);
    enriched.forEach((c) => lines.push(digestLine(c)));
  }
  if (lostDue.length) {
    lines.push(`*♻️ Deal Lost — time to re-engage:*`);
    lostDue.forEach((c) => lines.push(digestLine(c)));
  }
  if (!lines.length) {
    lines.push("✅ Nothing hanging. Every active deal has been touched in the last week.");
  }

  const header = `☀️ Morning Follow-up Board — ${date}`;
  const messages = buildDigestMessages(header, lines);
  for (const blocks of messages) {
    await slack.postMessage(channel, header, blocks);
  }

  // ── 4. Email follow-up cards for the priority subset (has Supabase contact) ─
  let emailCards = 0;
  for (const c of [...enriched, ...lostDue]) {
    if (emailCards >= EMAIL_CARD_MAX) break;
    const { data: contact } = await supabaseAdmin
      .from("contacts")
      .select("id, email, last_digest_nudge_at, do_not_contact")
      .eq("zoho_lead_id", c.zohoId)
      .maybeSingle();
    if (!contact?.id || !contact.email || contact.do_not_contact) continue;
    const sinceCard = daysSince(contact.last_digest_nudge_at as string | null);
    if (contact.last_digest_nudge_at && sinceCard != null && sinceCard < RENUDGE_DAYS) continue;

    const reason = c.daysSinceContact != null
      ? `${c.stage} · no contact in ${c.daysSinceContact} days`
      : `${c.stage} · hanging`;
    const ok = await postEmailCard(contact.id as string, channel, reason).catch(() => false);
    if (ok) {
      emailCards++;
      await supabaseAdmin
        .from("contacts")
        .update({ last_digest_nudge_at: new Date().toISOString() })
        .eq("id", contact.id);
    }
  }

  return { hanging: enriched.length, lostDue: lostDue.length, emailCards, posted: true };
}
