// The audit follows the prospect into the client.
//
// Matthew, 2026-09-14: "if a lead is getting onboarded we must already have data from that
// customer, since we literally just did an AI visibility scan for them." The data was always
// there. The join was not: audit_reports.client_id was set on 1 row in 103, because the only two
// writers set it at INSERT and a prospect has no client row at the moment it is scanned.
//
// delivery-steps.ts has promised this since it was written. Step 1's label is "Intake received,
// canonical NAP locked, AUDIT ATTACHED IF ONE EXISTS", and nothing in the repo kept the last
// clause. This is that clause.
//
// ‼️ RUN AT intake_received, NOT AT PROVISIONING. startPilot frequently has nothing to match on:
// /api/clients/start provisions from an email alone, and StartPilotInput's own comment says intake
// step 1 is the authority on the website. By the tick of intake_received the website, the domain
// and the contact are all on the client row, and it is still before startBaselineScan fires, so
// the attach cannot race the baseline insert.
//
// ‼️ IT NEVER THROWS INTO THE INTAKE FLOW. A missing audit is the ordinary case (89 of 103 reports
// are prospects who never became clients) and a failure here must not stop somebody from finishing
// onboarding. Every path returns a result and logs; nothing rejects.

import { supabaseAdmin } from "@/lib/db";
import { recordWebsiteSnapshot } from "./page-evidence";

/** Only a finished audit is worth adopting. A failed run has no conclusions to carry over. */
const FINISHED = "done";

export interface AdoptAuditResult {
  /** The audit_reports id now linked, or null when there was nothing to adopt. */
  reportId: string | null;
  /** True when a site_crawl was promoted into page_sources. */
  promoted: boolean;
  /** Human-readable outcome for the step log. */
  detail: string;
}

function domainOf(website: string | null | undefined): string | null {
  const raw = (website ?? "").trim();
  if (!raw) return null;
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    return url.hostname.replace(/^www\./i, "").toLowerCase() || null;
  } catch {
    return null;
  }
}

/**
 * Attach the prospect audit this client already has, and promote what it crawled.
 *
 * Matching is lifted from prior-report.ts deliberately, including its shape:
 *
 * ‼️ ONE QUERY PER IDENTITY RATHER THAN AN `or` FILTER. PostgREST's `or` with embedded commas
 * inside an ilike pattern is a parsing hazard and a domain can legitimately contain one. Three
 * small selects are cheaper than one clever one that breaks on a comma in a hostname.
 */
export async function adoptPriorAudit(clientId: string): Promise<AdoptAuditResult> {
  const nothing = (detail: string): AdoptAuditResult => ({ reportId: null, promoted: false, detail });

  const { data: client, error: clientErr } = await supabaseAdmin
    .from("clients")
    .select("website, domain, email, contact_id")
    .eq("id", clientId)
    .maybeSingle();

  if (clientErr) return nothing(`client row unreadable: ${clientErr.message}`);
  if (!client) return nothing("no client row");

  const email = String(client.email ?? "").trim().toLowerCase();
  const domain = domainOf((client.website as string | null) ?? (client.domain as string | null));
  const contactId = (client.contact_id as string | null) ?? null;

  if (!email && !domain && !contactId) {
    return nothing("nothing to match on: no contact, no email and no website");
  }

  // ‼️ UNLINKED ROWS ONLY. `client_id is null` is what stops this ever taking an audit that already
  // belongs to somebody else. Two clients can share a host (an agency and the client it resells
  // for), and an arbitrary re-link is worse than no link at all.
  const base = () =>
    supabaseAdmin
      .from("audit_reports")
      .select("id, created_at, site_crawl, website")
      .eq("status", FINISHED)
      .is("client_id", null)
      .order("created_at", { ascending: false })
      .limit(3);

  const found: Array<{ id: string; created_at: string; site_crawl: unknown; website: string | null }> = [];
  const collect = async (apply: (q: ReturnType<typeof base>) => ReturnType<typeof base>) => {
    const { data, error } = await apply(base());
    if (error || !data) return;
    for (const row of data) {
      if (!found.some((f) => f.id === row.id)) {
        found.push({
          id: row.id as string,
          created_at: (row.created_at as string) ?? "",
          site_crawl: row.site_crawl,
          website: (row.website as string | null) ?? null,
        });
      }
    }
  };

  if (contactId) await collect((q) => q.eq("contact_id", contactId));
  if (email) await collect((q) => q.ilike("requester_email", email));
  // `website` holds the submitted URL, so match on the host appearing anywhere in it.
  if (domain) await collect((q) => q.ilike("website", `%${domain}%`));

  if (!found.length) return nothing("no unlinked finished audit matches this client");

  found.sort((a, b) => b.created_at.localeCompare(a.created_at));
  const report = found[0];

  // ‼️ backfilled_by_domain, NOT fired_for_client, AND THE DISTINCTION IS THE WHOLE POINT.
  // This run was fired at a prospect before the client existed. It is a real audit and worth
  // attaching, but it is NOT the client's baseline photograph, and the day 30/60/90 numbers are
  // measured against the baseline. See docs/2026-09-14-audit-foundation.sql section 4.
  const { error: linkErr } = await supabaseAdmin
    .from("audit_reports")
    .update({ client_id: clientId, client_link_source: "backfilled_by_domain" })
    .eq("id", report.id)
    // Re-checked at the write, not just at the read: two intake ticks landing at once must not
    // race, and this keeps "never steal a linked audit" true at the database.
    .is("client_id", null);

  if (linkErr) return nothing(`could not link report ${report.id}: ${linkErr.message}`);

  const promoted = await promoteCrawl(clientId, report);
  return {
    reportId: report.id,
    promoted,
    detail: promoted
      ? `linked audit from ${report.created_at.slice(0, 10)} and filed its crawl as evidence`
      : `linked audit from ${report.created_at.slice(0, 10)}; it carried no stored crawl to file`,
  };
}

/**
 * Put the audit's crawl into page_sources, where the drafting lane can cite it.
 *
 * ‼️ NEVER WRITTEN DIRECTLY FROM A PROSPECT SCAN, WHICH IS WHY THIS RUNS HERE AND NOT IN THE
 * PIPELINE. page_sources.client_id is `not null references clients(id)`, a prospect has no client
 * row, and relaxing that would make every `.eq("client_id", ...)` read and isFirstParty()'s
 * evidence count prospect-aware. Promoting one jsonb column at intake is a far smaller blast
 * radius than teaching the whole evidence layer about rows that belong to nobody.
 *
 * ‼️ source_date IS THE CRAWL DATE, NOT TODAY. recordWebsiteSnapshot's own header says an
 * eighteen-month-old crawl asserted as today's fact is worse than no row, and a promoted prospect
 * audit is exactly that case: it can be weeks old by the time somebody onboards.
 */
async function promoteCrawl(
  clientId: string,
  report: { id: string; created_at: string; site_crawl: unknown; website: string | null }
): Promise<boolean> {
  const crawl = report.site_crawl as { bodyText?: unknown; website?: unknown } | null;
  const body = typeof crawl?.bodyText === "string" ? crawl.bodyText.trim() : "";
  if (!body) return false;

  const url =
    (typeof crawl?.website === "string" && crawl.website) || report.website || null;
  if (!url) return false;

  try {
    const id = await recordWebsiteSnapshot({
      clientId,
      url,
      content: body,
      sourceDate: report.created_at.slice(0, 10),
      // 'audit' already exists in CollectedVia and in page_sources_via_check and has never been
      // used. This is the path it was added for: read from a scan, not from a live crawl.
      collectedVia: "audit",
    });
    return Boolean(id);
  } catch (e) {
    console.error("[adopt-audit] crawl promotion failed:", (e as Error).message);
    return false;
  }
}
