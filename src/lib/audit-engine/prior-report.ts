/**
 * Has this person already had a scan, and did they already get the Loom?
 *
 * ‼️ THIS IS THE BRAKE ON AN AUTOMATION, NOT A CACHE. Two independent dedup guards already exist
 * and neither answers this question: run-audit-pipeline.ts has a 30-MINUTE window on
 * website + requester_email, and scan/session.ts caches a domain for 7 days. Both are
 * double-submit protection. Nothing in the repo has ever asked "did we already do this for them
 * in March", which is why a lead who came back in September got a brand new full audit and would
 * now get an email offering to record a Loom they already have.
 *
 * Matthew's framing: "if we already sent the loom for a specific customer we should cancel out
 * this automation ... we can pull the data on the previous run or we can ask if they really want
 * a new run".
 *
 * ‼️ MATCHED ON EITHER THE CONTACT OR THE DOMAIN, AND THE DOMAIN HALF IS THE ONE THAT EARNS ITS
 * KEEP. An owner who filled a funnel with matthew@clinic.com and comes back with
 * frontdesk@clinic.com is the same clinic and the same report. Requiring the same address would
 * miss every one of those, which is the common case for a business.
 */
import { supabaseAdmin } from "@/lib/db";

export interface PriorReport {
  id: string;
  slug: string | null;
  score: number | null;
  createdAt: string;
  /** A Loom exists for this report. The strongest suppression signal there is. */
  loomSent: boolean;
  /** The pitch email went out. Weaker: it means a thread exists to reply on. */
  pitchSent: boolean;
  /** Businesses the engines named instead of them, for the chat to quote back. */
  competitors: string[];
}

/** Rows in these states are not a finished report and must not suppress anything. */
const FINISHED = "done";

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
 * The newest finished report for this person or their domain, or null.
 *
 * Never throws. A database blip must not stop a funnel from capturing a lead, and the fail-open
 * direction here is deliberate: returning null means "no prior report", which lets the email go
 * out. The alternative, failing closed, would silently stop every follow-up in the system the
 * first time a query timed out.
 */
export async function priorReportFor(input: {
  email?: string | null;
  website?: string | null;
  contactId?: string | null;
}): Promise<PriorReport | null> {
  const email = (input.email ?? "").trim().toLowerCase();
  const domain = domainOf(input.website);
  if (!email && !domain && !input.contactId) return null;

  // ‼️ ONE QUERY PER IDENTITY RATHER THAN AN `or` FILTER. PostgREST's `or` with embedded commas
  // inside an ilike pattern is a parsing hazard, and a domain can legitimately contain one.
  const found: PriorReport[] = [];

  const collect = async (apply: (q: ReturnType<typeof base>) => ReturnType<typeof base>) => {
    const { data, error } = await apply(base());
    if (error || !data) return;
    for (const row of data) found.push(shape(row));
  };

  const base = () =>
    supabaseAdmin
      .from("audit_reports")
      .select("id, slug, score, created_at, loom_url, loom_state, auto_send_state, competitors")
      .eq("status", FINISHED)
      .order("created_at", { ascending: false })
      .limit(3);

  if (input.contactId) await collect((q) => q.eq("contact_id", input.contactId!));
  if (email) await collect((q) => q.ilike("requester_email", email));
  // `website` is stored as the submitted URL, so match on the host appearing in it.
  if (domain) await collect((q) => q.ilike("website", `%${domain}%`));

  if (!found.length) return null;

  // Newest wins, but a report WITH a Loom outranks a newer one without: the question this
  // answers is "have they had the Loom", and a later bare scan does not undo an earlier Loom.
  found.sort((a, b) => {
    if (a.loomSent !== b.loomSent) return a.loomSent ? -1 : 1;
    return b.createdAt.localeCompare(a.createdAt);
  });
  return found[0];
}

function shape(row: Record<string, unknown>): PriorReport {
  const loomState = (row.loom_state ?? null) as { stage?: string } | null;
  return {
    id: row.id as string,
    slug: (row.slug as string | null) ?? null,
    score: (row.score as number | null) ?? null,
    createdAt: (row.created_at as string) ?? "",
    // Either signal counts. loom_url is set when the video exists; loom_state.stage === 'done'
    // is set when the wizard finished, and a finished wizard without a URL still means the
    // conversation about a Loom has already happened with this person.
    loomSent: Boolean(row.loom_url) || loomState?.stage === "done",
    pitchSent: row.auto_send_state === "sent",
    competitors: Array.isArray(row.competitors)
      ? (row.competitors as unknown[]).map(String).filter(Boolean).slice(0, 5)
      : [],
  };
}
