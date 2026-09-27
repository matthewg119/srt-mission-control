// Start a self-serve AI visibility scan, and claim it with an email. Shared by /api/scan/* and the concierge.
//
// ‼️ MOVED OUT OF THE ROUTES, NOT REWRITTEN (2026-09-16). The concierge's "Get Free AI Visibility audit (3 min)"
// button runs exactly this, and a second copy of the four checks that stand between a public request and a
// bill would be the copy that forgets one. The order in startScan is the order the route documented:
// normalize, public host, cache, per-IP cap. Do not reorder them, and do not add a path that skips them.

import { waitUntil } from "@vercel/functions";
import { supabaseAdmin } from "@/lib/db";
import { ingestLead } from "@/lib/lead-intake";
import { runAuditPipeline } from "@/lib/audit-engine/run-audit-pipeline";
import { normalizeTarget, normalizeErrorMessage } from "@/lib/scan/normalize";
import { assertPublicHost } from "@/lib/scan/public-host";
import {
  countRecentScansForIp,
  createSession,
  findCachedSession,
  getSession,
  updateSession,
  RATE_LIMIT_PER_IP,
} from "@/lib/scan/session";
import type { AuditReportRow } from "@/lib/audit-engine/types";

export type StartScanResult =
  | { ok: true; id: string; domain: string; cached: boolean }
  | { ok: false; status: number; error: string; message?: string };

export async function startScan(args: {
  url: string;
  ipHash: string;
  /**
   * The campaign that sent them, if this visit carried one.
   *
   * ‼️ WITHOUT THIS A COLD EMAIL MEASURES NOTHING, AND NOTHING FAILS WHILE IT DOES NOT. A prospect
   * is only created in the CRM when they REPLY. Somebody who clicks a campaign link, runs the
   * scan and books without ever writing back is invisible, and that is the BEST outcome a campaign
   * has. The chain is: the scan form, this row, the Get Started link on the report, then
   * onboarding2_leads.utm_campaign.
   *
   * It rides on the audit_reports ROW rather than in the browser because the report is emailed and
   * opened days later, usually on another device, by which time any browser-side value is gone.
   *
   * Optional, because the concierge's audit button shares this function and carries no campaign.
   */
  utm?: Record<string, string>;
}): Promise<StartScanResult> {
  const normalized = normalizeTarget(args.url ?? "");
  if (!normalized.ok) {
    return { ok: false, status: 400, error: normalized.error, message: normalizeErrorMessage(normalized.error) };
  }
  const { website, domain } = normalized.target;

  // 2. What does that name actually resolve to?
  if (!(await assertPublicHost(domain))) {
    return { ok: false, status: 400, error: "not_public", message: normalizeErrorMessage("not_public") };
  }

  // 3. Already scanned recently? Hand back that run rather than paying again.
  //
  // ‼️ A CACHED HIT KEEPS THE FIRST VISIT'S CAMPAIGN AND DOES NOT TAKE THIS ONE. The report
  // already exists and already carries whoever brought it into being. Overwriting would let the
  // last person to scan a domain claim a report somebody else's campaign produced, which is a
  // worse lie than an unattributed one. Two campaigns reaching one clinic is a real thing and the
  // honest answer is that the first one found them.
  const cached = await findCachedSession(domain);
  if (cached) return { ok: true, id: cached.id, domain, cached: true };

  // 4. Per-IP cap.
  const recent = await countRecentScansForIp(args.ipHash);
  if (recent >= RATE_LIMIT_PER_IP) {
    return {
      ok: false,
      status: 429,
      error: "rate_limited",
      message: `That is ${RATE_LIMIT_PER_IP} scans from this connection today. Email info@srtagency.com and we will run more by hand.`,
    };
  }

  const session = await createSession({ domain, website, ipHash: args.ipHash });
  if (!session) {
    // The partial unique index on domain makes a concurrent duplicate fail here rather than run a second
    // audit. Re-read: the row the other request just wrote is the one this visitor wants.
    const raced = await findCachedSession(domain);
    if (raced) return { ok: true, id: raced.id, domain, cached: true };
    return { ok: false, status: 500, error: "could_not_start" };
  }

  waitUntil(
    (async () => {
      // onError writes the SPECIFIC reason; keep it here too, because the `session` object in this
      // closure is the pre-update in-memory row whose error is always null.
      let failure: string | null = null;
      try {
        const result = await runAuditPipeline({
          website,
          leadSource: "scan",
          // Nobody is on the other end to answer a city question: proceed on the best guess.
          allowLowConfidenceCity: true,
          onReportCreated: async (reportId) => {
            await updateSession(session.id, { status: "running", report_id: reportId });
            // Stamped here because this is the first moment the row exists: the pipeline owns the
            // insert and this is the earliest hook after it. A failure is logged and swallowed, as
            // an unattributed report is a reporting gap and killing a running audit over one would
            // cost the prospect the thing they actually came for.
            if (args.utm && Object.keys(args.utm).length) {
              const { error } = await supabaseAdmin
                .from("audit_reports")
                .update(args.utm)
                .eq("id", reportId);
              if (error) console.error("[scan/start] utm stamp failed:", error.message);
            }
          },
          onError: async (message) => {
            console.error("[scan/start] pipeline error:", message);
            failure = message;
            await updateSession(session.id, { status: "failed", error: message });
          },
        });
        if (!result.ok && !failure) {
          await updateSession(session.id, { status: "failed", error: "We could not read that site." });
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : "unknown error";
        console.error("[scan/start] unhandled:", message);
        await updateSession(session.id, { status: "failed", error: message });
      }
    })()
  );

  return { ok: true, id: session.id, domain, cached: false };
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";
}

/** The report URL, or null while the run is still going. */
export function reportUrlFor(report: AuditReportRow | null): string | null {
  if (!report || report.status !== "done" || !report.slug) return null;
  return `${appUrl()}/r/${report.slug}`;
}

export function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}

export type ClaimScanResult =
  | { ok: true; alreadyClaimed?: boolean; pending?: boolean; reportUrl: string | null }
  | { ok: false; status: number; error: string; message?: string };

/**
 * The email gate. See the claim route's header for why TIMING is the whole point: this must land before the
 * report finishes, or finish-report.ts drafts nothing.
 */
export async function claimScan(args: {
  sessionId: string;
  email: string;
  name: string;
  /** contacts.source and the Slack line. The scan page says "scan"; the concierge says "concierge". */
  source?: string;
  funnel?: string;
}): Promise<ClaimScanResult> {
  const email = args.email.trim().toLowerCase();
  const name = args.name.trim();
  if (!isEmail(email)) return { ok: false, status: 400, error: "invalid_email", message: "Enter a valid email address." };

  const session = await getSession(args.sessionId);
  if (!session) return { ok: false, status: 404, error: "not_found" };

  let report: AuditReportRow | null = null;
  if (session.report_id) {
    const { data } = await supabaseAdmin.from("audit_reports").select("*").eq("id", session.report_id).maybeSingle();
    report = (data as AuditReportRow) ?? null;
  }

  // Idempotent. A session is shared by everyone who scans that domain inside the cache window, and the button
  // can be double-clicked. Without this, each POST creates another contact, Zoho lead and #hot-leads post.
  if (session.contact_id) return { ok: true, alreadyClaimed: true, reportUrl: reportUrlFor(report) };

  const nameParts = name.split(" ").filter(Boolean);
  const stillRunning = !report || report.status !== "done";
  const source = args.source ?? "scan";
  const funnel = args.funnel ?? "/scan";

  const { contactId } = await ingestLead({
    firstName: nameParts[0] || "",
    lastName: nameParts.slice(1).join(" ") || "",
    email,
    website: session.website,
    businessName: report?.client_name ?? undefined,
    city: report?.city ?? undefined,
    source,
    // ‼️ THE FUNNEL STRING IS THE BEST THIS PATH HAS, AND IT IS NOT A URL. There is no request
    // object here: a scan is claimed from /api/scan/[id]/claim and from the concierge widget, and the
    // caller passes what it knows ("/scan", or "concierge (srt-agency-llc)"). Prefixing a host would be
    // inventing one for the concierge case, which arrives from a client's own domain.
    sourcePage: funnel,
    // No phone was collected, so there is nothing to dial and nothing to promise.
    speedToLead: false,
    noteTitle: "Self-serve AI visibility scan",
    headline:
      source === "concierge"
        ? `:cat: *Asked the concierge for a free audit* of ${session.domain} and gave their email.`
        : `:satellite: *Ran their own scan* on ${session.domain} at srtagency.com/scan and asked for the report.`,
    detailLines: [
      `Website: ${session.website}`,
      report?.business_type ? `Business type: ${report.business_type}` : "",
      report?.city ? `City: ${report.city}` : "",
      stillRunning
        ? "Scan still running. The report and the draft pitch land in #ai-visibility-audits when it finishes."
        : `AI visibility score: ${report?.score ?? "not scored"}/100`,
      `SMS consent: not collected (${source === "scan" ? "scan funnel" : source} asks for email only)`,
      `Funnel: ${funnel}`,
    ],
  });

  await updateSession(session.id, { contact_id: contactId ?? null });

  // Attach the person to the report so finishReport addresses them and drafts the pitch. Only fills blanks:
  // a report that already belongs to a lead is never reassigned.
  if (report && !report.requester_email) {
    await supabaseAdmin
      .from("audit_reports")
      .update({ requester_email: email, requester_name: name || null, contact_id: contactId ?? null })
      .eq("id", report.id);
  }

  return { ok: true, pending: stillRunning, reportUrl: reportUrlFor(report) };
}
