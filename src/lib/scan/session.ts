// Session store + stage derivation for the public /scan funnel.
//
// The stage model is DERIVED, never written by the UI: it is read back off the
// audit_reports row and a count of audit_runs. That is the same no-fabrication
// rule report-view.ts follows — the page can only show a step as finished
// because the row proves it finished, so a stalled pipeline stalls the UI
// instead of quietly animating past it.

import { createHash } from "crypto";
import type { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { TOTAL_PROMPTS, ENGINES_PER_PROMPT } from "@/lib/audit-engine/types";
import type { AuditReportRow } from "@/lib/audit-engine/types";
import type { ScanSessionStatus, ScanStatusPayload } from "./steps";

// Re-exported so server-side callers have one import. The client must import
// these from ./steps directly — see the note at the top of that file.
export { SCAN_STEPS } from "./steps";
export type { ScanSessionStatus, ScanStatusPayload, ScanStepKey } from "./steps";

export interface ScanSessionRow {
  id: string;
  domain: string;
  website: string;
  ip_hash: string | null;
  status: ScanSessionStatus;
  report_id: string | null;
  contact_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

/** A full run is 40 model calls. These are the two limits that keep that affordable. */
export const RATE_LIMIT_PER_IP = 3;
export const RATE_LIMIT_WINDOW_HOURS = 24;
/** Re-scanning the same domain inside this window returns the existing report. */
export const DOMAIN_CACHE_HOURS = 24 * 7;
/**
 * A session with no report_id after this long is dead, not slow.
 *
 * onReportCreated fires within ~30s of the paste (research plus classify), so anything past
 * this lost its lambda before the row was inserted. Nothing heals that: audit-watchdog only
 * knows about audit_reports and has never heard of scan_sessions. Without this guard the page
 * spins on step 1 forever AND the row stays a cache hit, handing the same dead session to
 * every later visitor for a week.
 */
export const RESEARCH_TIMEOUT_MINUTES = 5;

/** What a stranger is told when a run dies. audit_reports.error carries raw exception text
 *  (see failReport in process/route.ts) and this payload is served unauthenticated. */
const PUBLIC_FAILURE_MESSAGE =
  "The scan could not be completed for this site. Nothing was saved against your business.";

function isStuck(session: Pick<ScanSessionRow, "report_id" | "status" | "created_at">): boolean {
  if (session.report_id || session.status === "failed") return false;
  return Date.now() - new Date(session.created_at).getTime() > RESEARCH_TIMEOUT_MINUTES * 60_000;
}

/** Hash, never store, the client IP. This is a rate-limit ledger, not a visitor log. */
export function hashIp(ip: string): string {
  return createHash("sha256").update(`${ip}::${process.env.SCAN_IP_SALT ?? "srt-scan"}`).digest("hex");
}

/**
 * The client IP, from a header the client cannot forge.
 *
 * NOT `x-forwarded-for[0]`. Vercel APPENDS the real IP to whatever the client sent, so on a
 * request carrying its own `X-Forwarded-For: 1.2.3.4` the first entry is the attacker's string.
 * Reading [0] means anyone can rotate a header and scan without limit. `x-vercel-forwarded-for`
 * is set by the proxy and overwrites any client value; `req.ip` is the same thing typed.
 */
export function clientIpFrom(req: NextRequest): string {
  if (req.ip) return req.ip;
  const vercel = req.headers.get("x-vercel-forwarded-for");
  if (vercel) return vercel.split(",")[0].trim();
  // Local dev only: neither of the above exists outside Vercel.
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",").pop()!.trim();
  return "unknown";
}

export async function countRecentScansForIp(ipHash: string): Promise<number> {
  const cutoff = new Date(Date.now() - RATE_LIMIT_WINDOW_HOURS * 3_600_000).toISOString();
  const { count } = await supabaseAdmin
    .from("scan_sessions")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash)
    .gte("created_at", cutoff);
  return count ?? 0;
}

/**
 * A recent, non-failed scan of the same domain.
 *
 * Returned instead of spending another 40 calls. `failed` rows are deliberately
 * excluded — a site that was down an hour ago deserves a real retry, and caching
 * a failure would make a transient fetch error permanent for a week.
 */
export async function findCachedSession(domain: string): Promise<ScanSessionRow | null> {
  const cutoff = new Date(Date.now() - DOMAIN_CACHE_HOURS * 3_600_000).toISOString();
  const { data } = await supabaseAdmin
    .from("scan_sessions")
    .select("*")
    .eq("domain", domain)
    .neq("status", "failed")
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const row = (data as ScanSessionRow) ?? null;
  // A stuck row is not a cache hit. Serving it would give every visitor who pastes this
  // domain the same permanent step-1 spinner until the window expires.
  if (row && isStuck(row)) return null;
  return row;
}

export async function createSession(params: {
  domain: string;
  website: string;
  ipHash: string;
}): Promise<ScanSessionRow | null> {
  const { data, error } = await supabaseAdmin
    .from("scan_sessions")
    .insert({
      domain: params.domain,
      website: params.website,
      ip_hash: params.ipHash,
      status: "researching",
    })
    .select("*")
    .single();
  if (error) {
    console.error("[scan/session] insert failed:", error.message);
    return null;
  }
  return data as ScanSessionRow;
}

export async function updateSession(id: string, patch: Partial<ScanSessionRow>): Promise<void> {
  await supabaseAdmin
    .from("scan_sessions")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
}

export async function getSession(id: string): Promise<ScanSessionRow | null> {
  const { data } = await supabaseAdmin.from("scan_sessions").select("*").eq("id", id).maybeSingle();
  return (data as ScanSessionRow) ?? null;
}

/**
 * Build the payload the run view polls for.
 *
 * Steps 1-3 all become true at the same instant, because research → classify →
 * prompts is one awaited chain in runAuditPipeline and the row only appears at
 * the end of it. The UI staggers the reveal for readability; the DATA never
 * claims a step finished before the row proved it.
 */
export async function buildStatusPayload(session: ScanSessionRow): Promise<ScanStatusPayload> {
  const base: ScanStatusPayload = {
    sessionId: session.id,
    domain: session.domain,
    status: session.status,
    activeStep: 1,
    error: session.error,
    business: null,
    competitors: [],
    prompts: [],
    engine: { done: 0, total: TOTAL_PROMPTS * ENGINES_PER_PROMPT },
    result: null,
    claimed: !!session.contact_id,
  };

  if (session.status === "failed") {
    return { ...base, activeStep: 0 };
  }

  if (isStuck(session)) {
    return {
      ...base,
      status: "failed",
      activeStep: 0,
      error: "This scan stopped before it got going. Start a new one and it should run.",
    };
  }

  if (!session.report_id) {
    // Research + classify still in flight.
    return base;
  }

  const { data: reportData } = await supabaseAdmin
    .from("audit_reports")
    .select("*")
    .eq("id", session.report_id)
    .maybeSingle();

  if (!reportData) return base;
  const report = reportData as AuditReportRow;

  const { count: runCount } = await supabaseAdmin
    .from("audit_runs")
    .select("id", { count: "exact", head: true })
    .eq("report_id", report.id);

  const done = runCount ?? 0;
  // From the row's OWN prompt count, matching process/route.ts and audit-watchdog. classify is
  // a model call: if it returns 19 prompts, a hardcoded 20 means done never reaches total and
  // the scoring step never appears.
  const total = (report.prompts?.length || TOTAL_PROMPTS) * ENGINES_PER_PROMPT;

  const payload: ScanStatusPayload = {
    ...base,
    status: report.status === "done" ? "done" : report.status === "failed" ? "failed" : "running",
    business: {
      name: report.client_name,
      type: report.business_type,
      city: report.city,
      persona: report.buyer_persona,
      isLocal: !!report.city,
    },
    competitors: Array.isArray(report.competitors) ? report.competitors : [],
    prompts: Array.isArray(report.prompts) ? report.prompts : [],
    engine: { done, total },
    // report.error is the raw exception text from process/route.ts. This payload is public.
    error: report.status === "failed" ? PUBLIC_FAILURE_MESSAGE : session.error,
    // Steps 1-3 are proven done by the row existing; step 4 is in flight.
    activeStep: 4,
  };

  if (report.status === "failed") {
    return { ...payload, status: "failed", activeStep: 0 };
  }

  if (report.status === "done") {
    return {
      ...payload,
      status: "done",
      activeStep: 7,
      result: {
        score: report.score,
        // NO slug. /r/[slug] has no auth, so returning it here would hand out the report
        // itself from a public, unauthenticated endpoint while the UI politely asks for an
        // email. The gate has to be enforced where the key lives: /api/scan/[id]/claim
        // returns the URL, and only after ingestLead has run.
        total: report.prompts?.length || TOTAL_PROMPTS,
      },
    };
  }

  // Still running: once every call is in, we are scoring rather than asking.
  if (done >= total) payload.activeStep = 5;

  return payload;
}
