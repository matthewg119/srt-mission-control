// ZOHO BRIDGE — pull real call lists, write notes. Thin adapter over the existing
// Zoho v5 client (src/lib/zoho.ts): reuses the cached OAuth token + zohoRequest()
// + addNoteToLead(). Maps real SRT Lead fields into the Red Panther lead shape.

import { zohoRequest, addNoteToLead } from "@/lib/zoho";

const RED_SOURCE = process.env.ST_ZOHO_RED_SOURCE || "DB 1.0";
const GREEN_SOURCES = (process.env.ST_ZOHO_GREEN_SOURCES || "Meta Ads,BusinessFunding")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const PULL_LIMIT = parseInt(process.env.ST_ZOHO_PULL_LIMIT || "300", 10);
const PER_PAGE = 200; // Zoho hard cap per page

// Fields we read for the kiosk (real SRT Zoho Lead field names).
const ZOHO_FIELDS = [
  "First_Name", "Last_Name", "Company", "Phone", "Mobile", "Email",
  "Lead_Status", "Lead_Source", "Modified_Time", "Created_Time",
  "Funding_Amount_Requested", "Monthly_Revenue", "Time_in_Business", "Credit_Score_Range",
].join(",");

// Dead/terminal statuses to exclude from any call queue. Kept ≤8 so the Zoho
// search criteria stays under its ~10-condition cap; keyword matching below is
// defense-in-depth for picklist drift.
const DEAD_STATUSES = [
  "Not Interested", "DNQ", "Declined", "Dead Declined",
  "Take Off List", "Lost", "Bad Lead", "Wrong Number",
];
const TERMINAL_KEYWORDS = ["declined", "dead", "dnq", "lost", "not interested", "junk", "duplicate", "bad lead", "wrong number"];

function isTerminal(status: string | null | undefined): boolean {
  if (!status) return false;
  const lower = String(status).toLowerCase();
  return TERMINAL_KEYWORDS.some((k) => lower.includes(k));
}

export interface ZohoLead {
  external_id: string;
  name: string;
  company: string | null;
  phone: string | null;
  email: string | null;
  stage: string;
  queue: "red" | "green";
  co: string;
  initials: string;
  fund: string;
  rev: string;
  biz: string;
  score: string;
  touch: string;
  sum: string;
  notes: string[];
  slack: string;
  drafts: string[];
  zoho_modified_at: string;
}

type ZohoRow = Record<string, unknown>;

function s(v: unknown): string | null {
  if (typeof v === "string") return v.trim() ? v : null;
  return v != null ? String(v) : null;
}

function formatRelativeTime(date: Date): string {
  const diffMin = Math.floor((Date.now() - date.getTime()) / 60000);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `${diffH}h ago`;
  return `${Math.floor(diffH / 24)}d ago`;
}

function mapRow(r: ZohoRow, queue: "red" | "green"): ZohoLead {
  const firstName = (s(r.First_Name) as string) || "";
  const lastName = (s(r.Last_Name) as string) || "";
  const fullName = `${firstName} ${lastName}`.trim() || "Unknown";
  const initials = `${firstName[0] || ""}${lastName[0] || ""}`.toUpperCase() || "??";
  const phone = s(r.Phone) || s(r.Mobile);
  const company = s(r.Company);

  const fund = r.Funding_Amount_Requested ? `$${Number(r.Funding_Amount_Requested).toLocaleString()}` : "—";
  const rev = r.Monthly_Revenue ? `$${Number(r.Monthly_Revenue).toLocaleString()}+` : "—";
  const biz = r.Time_in_Business ? `${r.Time_in_Business}` : "—";
  const score = r.Credit_Score_Range ? `${r.Credit_Score_Range}` : "—";

  const modifiedAt = (s(r.Modified_Time) as string) || "";
  const touch = modifiedAt ? formatRelativeTime(new Date(modifiedAt)) : "Never";
  const stage = (s(r.Lead_Status) as string) || "No Contact";
  const co = `${company || "Unknown company"}${phone ? ` · ${phone}` : ""}`;

  return {
    external_id: String(r.id),
    name: fullName,
    company,
    phone,
    email: s(r.Email),
    stage,
    queue,
    co,
    initials,
    fund, rev, biz, score, touch,
    sum: `<strong>${stage}.</strong> ${company || "Unknown company"} · ${fund} ask.`,
    notes: [`${touch} · ${s(r.Lead_Source) || "Zoho"}`],
    slack: `#${fullName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
    drafts: [
      `Hi ${firstName || "there"}, this is Jordan with Sales Twin Funding. I wanted to reach out about your funding request. Do you have a few minutes?`,
      `${firstName || "Hi"} — Jordan here. Following up on your inquiry. We may have a strong offer for you. Worth a quick call?`,
      `Hey ${firstName || "there"}! Jordan from Sales Twin. We reviewed your profile and think we can help. When works for a 5-min call?`,
    ],
    zoho_modified_at: modifiedAt,
  };
}

// Paginated Zoho /Leads/search. Returns up to `limit` rows. ~ceil(limit/200) API calls.
async function paginatedSearch(criteria: string, limit: number): Promise<{ rows: ZohoRow[]; apiCallsUsed: number }> {
  const rows: ZohoRow[] = [];
  let apiCallsUsed = 0;
  let page = 1;
  const maxPages = Math.ceil(limit / PER_PAGE);
  while (page <= maxPages) {
    const path = `/Leads/search?criteria=${encodeURIComponent(criteria)}&fields=${ZOHO_FIELDS}&per_page=${PER_PAGE}&page=${page}`;
    const result = (await zohoRequest("GET", path)) as { data?: ZohoRow[]; info?: { more_records?: boolean } };
    apiCallsUsed++;
    const batch = result.data || [];
    rows.push(...batch);
    if (batch.length < PER_PAGE || !result.info?.more_records || rows.length >= limit) break;
    page++;
  }
  return { rows: rows.slice(0, limit), apiCallsUsed };
}

function buildExcludeDeadCriteria(base: string): string {
  // base is the leading condition, e.g. (Lead_Source:equals:DB 1.0)
  return base + DEAD_STATUSES.map((st) => `and(Lead_Status:not_equal:${st})`).join("");
}

// RED queue: the no-contact call list — Lead_Source = DB 1.0, excluding dead statuses.
export async function fetchRedLeads(): Promise<{ leads: ZohoLead[]; apiCallsUsed: number }> {
  const criteria = buildExcludeDeadCriteria(`(Lead_Source:equals:${RED_SOURCE})`);
  const { rows, apiCallsUsed } = await paginatedSearch(criteria, PULL_LIMIT);
  const leads = rows
    .filter((r) => !isTerminal(s(r.Lead_Status))) // defense-in-depth
    .filter((r) => s(r.Phone) || s(r.Mobile)) // must be dial-able
    .map((r) => mapRow(r, "red"));
  return { leads, apiCallsUsed };
}

// GREEN queue: warmer leads — inbound paid-ads / funnel sources (warm by virtue
// of opting in), excluding only dead statuses.
export async function fetchGreenLeads(): Promise<{ leads: ZohoLead[]; apiCallsUsed: number }> {
  if (!GREEN_SOURCES.length) return { leads: [], apiCallsUsed: 0 };
  const sourceList = GREEN_SOURCES.join(","); // Zoho `in` is comma-separated
  const criteria = buildExcludeDeadCriteria(`(Lead_Source:in:${sourceList})`);
  const { rows, apiCallsUsed } = await paginatedSearch(criteria, PULL_LIMIT);
  const leads = rows
    .filter((r) => !isTerminal(s(r.Lead_Status)))
    .filter((r) => s(r.Phone) || s(r.Mobile))
    .map((r) => mapRow(r, "green"));
  return { leads, apiCallsUsed };
}

// DEBUG: sample recent leads and tally distinct Lead_Source values so the exact
// picklist strings (e.g. "DB 1.0", the green funnel names) can be confirmed.
export async function listLeadSources(sample = 400): Promise<{ counts: Record<string, number>; sampled: number; apiCallsUsed: number }> {
  const counts: Record<string, number> = {};
  let apiCallsUsed = 0;
  let page = 1;
  let sampled = 0;
  const maxPages = Math.ceil(sample / PER_PAGE);
  while (page <= maxPages) {
    const path = `/Leads?fields=Lead_Source&per_page=${PER_PAGE}&page=${page}&sort_by=Modified_Time&sort_order=desc`;
    const result = (await zohoRequest("GET", path)) as { data?: ZohoRow[]; info?: { more_records?: boolean } };
    apiCallsUsed++;
    const batch = result.data || [];
    for (const r of batch) {
      const src = (s(r.Lead_Source) as string) || "(blank)";
      counts[src] = (counts[src] || 0) + 1;
      sampled++;
    }
    if (batch.length < PER_PAGE || !result.info?.more_records) break;
    page++;
  }
  return { counts, sampled, apiCallsUsed };
}

// Write a [Sales Twin] note under a Zoho lead. Delegates to the shared client.
export async function writeNoteToZoho(params: {
  leadExternalId: string;
  noteBody: string;
  repName: string;
  disposition?: string;
}): Promise<{ ok: boolean }> {
  try {
    const content = `[Sales Twin] ${params.noteBody}\nRep: ${params.repName}\nDisposition: ${params.disposition || "logged"}\nLogged: ${new Date().toISOString()}`;
    await addNoteToLead(params.leadExternalId, "[Sales Twin] Call Note", content);
    return { ok: true };
  } catch (e) {
    console.error("[sales-twin] writeNoteToZoho failed:", (e as Error).message);
    return { ok: false };
  }
}
