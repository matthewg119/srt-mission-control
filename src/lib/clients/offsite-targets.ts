// Where the engines get their answers: the citation corpus, kept instead of counted.
//
// ‼️ THE DATA HAS BEEN COLLECTED ON EVERY AUDIT SINCE 2026-07 AND THROWN AWAY. Every engine
// call records what it cited: run-prompts.ts fills a Set from the Responses API's
// `url_citation` annotations and run-batch.ts writes it to audit_runs.citations. harvest.ts
// reads that list, fetches up to forty of the pages, extracts phrases -- and stores
// `{ citations: <a number> }`. The URLs are dropped on the floor.
//
// That number is the single most useful thing an AI visibility audit produces and nobody has
// ever seen it: not "you are absent from twelve questions" but "here are the eleven places
// the engines read before answering them".
//
// ‼️ IT RUNS FOR EVERY PROSPECT AUDIT, NOT JUST SIGNED CLIENTS, which is what makes it sales
// intel rather than delivery work. SRT's own targets come from SRT's own audits.
//
// ‼️ AND IT DOES NOT POST ANYWHERE, EVER. harvest.ts states the ban this lane inherits:
// "DOES NOT POST: anywhere, ever, to any forum, as anyone. That ban is canon and predates
// this file. There is no posting code path here and one must not be added." Submitting our
// own listing to a directory and emailing a human a reviewed draft are the two permitted
// acts, and neither one happens in this module.

import { supabaseAdmin } from "@/lib/db";

export type TargetKind =
  | "directory"
  | "listicle"
  | "forum"
  | "review_platform"
  | "news"
  | "competitor"
  | "client_own"
  | "listed_subject"
  | "unknown";

export interface OffsiteTarget {
  domain: string;
  exampleUrl: string | null;
  timesCited: number;
  kind: TargetKind;
}

/**
 * Hostname, lowercased, `www.` stripped, or null.
 *
 * Mirrors domainOf() in report-view.ts deliberately rather than importing it: that one is a
 * private helper in the audit view and this module has no business reaching into it.
 */
export function domainOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** A hostname from either a bare domain or a full URL. Never throws. */
function hostOf(raw: string): string {
  const viaUrl = domainOf(raw);
  if (viaUrl) return viaUrl;
  return raw.trim().toLowerCase().replace(/^www\./, "").replace(/\/.*$/, "");
}

// ─────────────────────────────────────────────────────────────────────────────
// Classification
// ─────────────────────────────────────────────────────────────────────────────
//
// ‼️ DETERMINISTIC FIRST, A MODEL ONLY FOR THE LEFTOVERS, AND harvest.ts ALREADY STATES WHY
// FOR ITS OWN SCORES: a number that moves on its own makes the day-thirty comparison
// meaningless. If `yelp.com` is a review_platform today and a directory next month because a
// model felt differently, the before-and-after says nothing about the work done in between.
//
// These are HOST matches on the registrable name, never substring matches on the whole URL.
// "reddit" appears in plenty of URLs that are not Reddit.

const REVIEW_PLATFORMS = new Set([
  "yelp.com", "trustpilot.com", "realself.com", "healthgrades.com", "zocdoc.com",
  "vitals.com", "ratemds.com", "birdeye.com", "g2.com", "capterra.com", "trustradius.com",
]);

const DIRECTORIES = new Set([
  "bbb.org", "yellowpages.com", "superpages.com", "manta.com", "hotfrog.com",
  "citysearch.com", "foursquare.com", "mapquest.com", "chamberofcommerce.com",
  "angi.com", "thumbtack.com", "npidb.org", "expertise.com", "clutch.co",
]);

const FORUMS = new Set([
  "reddit.com", "quora.com", "stackexchange.com", "stackoverflow.com", "discourse.org",
  "forums.somethingawful.com", "city-data.com",
]);

const NEWS = new Set([
  "nytimes.com", "wsj.com", "washingtonpost.com", "bbc.co.uk", "bbc.com", "cnn.com",
  "forbes.com", "businessinsider.com", "techcrunch.com", "theguardian.com", "reuters.com",
  "apnews.com", "npr.org", "bloomberg.com", "axios.com",
]);

/** A path that reads like a ranked list of businesses. */
const LISTICLE_PATH = /[/-](best|top|(?:top|best)-\d+|vs|versus|compare|comparison|alternatives|reviews-of)\b/i;

/**
 * What kind of place this is, from the domain and the path shape alone.
 *
 * `unknown` is a real answer and is the honest one for most of a corpus. It is what a model
 * pass would be given, and it is also perfectly usable as-is: a person reading the list can
 * tell what an outlet is far faster than they can tell whether a score is trustworthy.
 */
export function classifyTarget(args: {
  domain: string;
  exampleUrl: string | null;
  clientDomain: string | null;
  competitorDomains: readonly string[];
}): TargetKind {
  const d = hostOf(args.domain);

  // ‼️ THE CLIENT'S OWN DOMAIN FIRST, AND IT IS NEVER A TARGET. An engine citing their own
  // site is the thing we are trying to CAUSE. Putting it on a list of people to email would
  // be asking a client for a link to themselves.
  //
  // ‼️ NORMALISED HERE RATHER THAN TRUSTED FROM THE CALLER, AND THE FIRST CUT DID NOT.
  // clients.website and competitor_candidates.website hold full URLs, so a bare
  // `.replace(/^www\./)` on "https://www.aclinic.com" changes nothing and the comparison
  // against a hostname never matches. Every caller happened to pass a host, which is exactly
  // what makes it the kind of bug that surfaces on the one caller that does not -- and the
  // failure is the client's own site on a list of people to email.
  if (args.clientDomain && d === hostOf(args.clientDomain)) return "client_own";

  if (args.competitorDomains.some((c) => c && d === hostOf(c))) return "competitor";

  if (REVIEW_PLATFORMS.has(d)) return "review_platform";
  if (DIRECTORIES.has(d)) return "directory";
  if (NEWS.has(d)) return "news";

  // Forums match on the registrable domain OR one level up, because a subreddit is a path and
  // a Discourse instance is a subdomain.
  for (const f of FORUMS) {
    if (d === f || d.endsWith(`.${f}`)) return "forum";
  }

  if (args.exampleUrl && LISTICLE_PATH.test(args.exampleUrl)) return "listicle";

  return "unknown";
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading the corpus
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every domain the engines cited for this client's audits, rolled up.
 *
 * ‼️ IT READS audit_runs, NOT audit_reports.prompts, AND findings.ts STATES THE RULE. The
 * prompts column is regenerated by every run; the runs are what happened. A target list built
 * from the former would change under a re-scan without anybody having learned anything new.
 */
export async function readCitationCorpus(
  clientId: string
): Promise<{ targets: OffsiteTarget[]; runId: string | null; reports: number }> {
  const { data: reports, error: repErr } = await supabaseAdmin
    .from("audit_reports")
    .select("id, website")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(10);

  if (repErr) throw new Error(`[offsite] reports unavailable: ${repErr.message}`);
  const reportRows = (reports ?? []) as Array<{ id: string; website: string | null }>;
  if (reportRows.length === 0) return { targets: [], runId: null, reports: 0 };

  const clientDomain = reportRows.map((r) => r.website).find(Boolean) ?? null;
  const clientHost = clientDomain ? domainOf(clientDomain) ?? clientDomain : null;

  const { data: runs, error: runErr } = await supabaseAdmin
    .from("audit_runs")
    .select("report_id, citations")
    .in(
      "report_id",
      reportRows.map((r) => r.id)
    );

  if (runErr) throw new Error(`[offsite] runs unavailable: ${runErr.message}`);

  const competitors = await competitorDomainsFor(clientId);

  const byDomain = new Map<string, { count: number; example: string; runId: string }>();
  for (const row of (runs ?? []) as Array<{ report_id: string; citations: unknown }>) {
    const list = Array.isArray(row.citations) ? (row.citations as unknown[]) : [];
    for (const raw of list) {
      if (typeof raw !== "string" || !/^https?:\/\//i.test(raw)) continue;
      const d = domainOf(raw);
      if (!d) continue;
      const held = byDomain.get(d);
      if (held) held.count += 1;
      else byDomain.set(d, { count: 1, example: raw, runId: row.report_id });
    }
  }

  const targets: OffsiteTarget[] = [...byDomain.entries()]
    .map(([domain, v]) => ({
      domain,
      exampleUrl: v.example,
      timesCited: v.count,
      kind: classifyTarget({
        domain,
        exampleUrl: v.example,
        clientDomain: clientHost,
        competitorDomains: competitors,
      }),
    }))
    // ‼️ THE CLIENT'S OWN SITE IS DROPPED HERE, NOT LEFT IN AND LABELLED. engines_cited_site
    // already records whether the engines cite them, as a boolean on the report, and it is a
    // finding rather than a target. A list of people to contact that includes the client is a
    // list somebody eventually emails.
    .filter((t) => t.kind !== "client_own")
    .sort((a, b) => b.timesCited - a.timesCited || a.domain.localeCompare(b.domain));

  return { targets, runId: reportRows[0]?.id ?? null, reports: reportRows.length };
}

/**
 * The same roll-up for ONE report, client or not.
 *
 * ‼️ THIS IS THE ONE THE PUBLIC REPORT USES, AND IT IS WHY THE SECTION WORKS FOR A
 * PROSPECT. Most audits have no clients row at all: /scan lets strangers run one and `/audit`
 * runs them for people who have never replied. Keying the read on client_id would have made
 * the most useful section in the report visible only to businesses who had already signed,
 * which is exactly backwards for something whose job is to start the conversation.
 */
export async function targetsForReport(reportId: string): Promise<OffsiteTarget[]> {
  const { data: report } = await supabaseAdmin
    .from("audit_reports")
    .select("id, website, competitors")
    .eq("id", reportId)
    .maybeSingle();

  if (!report) return [];

  const { data: runs, error } = await supabaseAdmin
    .from("audit_runs")
    .select("citations")
    .eq("report_id", reportId);

  // Decoration on a report that rendered fine without it. planLinkRows makes the same call for
  // the same reason: a 5xx on a page a prospect is reading, over a section, is worse than the
  // section being absent.
  if (error) {
    console.error(`[offsite] runs unavailable for report ${reportId}: ${error.message}`);
    return [];
  }

  const clientHost = report.website ? domainOf(String(report.website)) : null;
  const competitorDomains = Array.isArray(report.competitors)
    ? (report.competitors as Array<Record<string, unknown>>)
        .map((c) => (typeof c.website === "string" ? domainOf(c.website) : null))
        .filter((d): d is string => Boolean(d))
    : [];

  const byDomain = new Map<string, { count: number; example: string }>();
  for (const row of (runs ?? []) as Array<{ citations: unknown }>) {
    const list = Array.isArray(row.citations) ? (row.citations as unknown[]) : [];
    for (const raw of list) {
      if (typeof raw !== "string" || !/^https?:\/\//i.test(raw)) continue;
      const d = domainOf(raw);
      if (!d) continue;
      const held = byDomain.get(d);
      if (held) held.count += 1;
      else byDomain.set(d, { count: 1, example: raw });
    }
  }

  return [...byDomain.entries()]
    .map(([domain, v]) => ({
      domain,
      exampleUrl: v.example,
      timesCited: v.count,
      kind: classifyTarget({ domain, exampleUrl: v.example, clientDomain: clientHost, competitorDomains }),
    }))
    .filter((t) => t.kind !== "client_own")
    .sort((a, b) => b.timesCited - a.timesCited || a.domain.localeCompare(b.domain));
}

async function competitorDomainsFor(clientId: string): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from("competitor_candidates")
    .select("website")
    .eq("client_id", clientId)
    .eq("selected", true);

  return ((data ?? []) as Array<{ website: string | null }>)
    .map((r) => (r.website ? domainOf(r.website) : null))
    .filter((d): d is string => Boolean(d));
}

// ─────────────────────────────────────────────────────────────────────────────
// Writing them down
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Store the corpus, plus every subject we named on a published roundup, comparison or review.
 *
 * ‼️ A LISTED SUBJECT IS A QUALIFIED PROSPECT AND A CITED DOMAIN IS NOT, AND THE KIND IS THE
 * ONLY THING THAT CARRIES THE DIFFERENCE. We put the subject on the page, so the email is
 * "you are in this" rather than a favour ask. Same table because the follow-up is the same;
 * different kind because the first line is not.
 *
 * ‼️ status IS NEVER OVERWRITTEN ON A RE-RUN. A target somebody has already contacted must
 * not go back to `new` because the audit found it again, which is the whole reason this is an
 * upsert on (client_id, domain) with a narrow update list rather than a delete and reload.
 */
export async function storeTargets(
  clientId: string,
  targets: readonly OffsiteTarget[],
  runId: string | null
): Promise<{ ok: true; written: number } | { ok: false; error: string }> {
  if (targets.length === 0) return { ok: true, written: 0 };

  const now = new Date().toISOString();
  const rows = targets.map((t) => ({
    client_id: clientId,
    domain: t.domain,
    example_url: t.exampleUrl,
    times_cited: t.timesCited,
    first_seen_run_id: runId,
    kind: t.kind,
    updated_at: now,
  }));

  const { error } = await supabaseAdmin
    .from("offsite_targets")
    .upsert(rows, { onConflict: "client_id,domain", ignoreDuplicates: false });

  if (error) return { ok: false, error: error.message };
  return { ok: true, written: rows.length };
}

/**
 * The subjects named on this client's published roundup, comparison and review pages.
 *
 * ‼️ READ OFF page_dataset.format_dataset, WHICH IS WHERE THE ANSWERS ALREADY LIVE. The
 * `roundup` format's `entries` field and `comparison`'s two subjects are collected from a
 * person as the page is written, so nothing here asks a model who was on the page.
 */
export async function listedSubjects(clientId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from("page_dataset")
    .select("post_format, format_dataset")
    .eq("client_id", clientId)
    .in("post_format", ["roundup", "comparison", "review"]);

  if (error) {
    console.error(`[offsite] listed subjects unavailable: ${error.message}`);
    return [];
  }

  const out = new Set<string>();
  for (const row of (data ?? []) as Array<{ format_dataset: unknown }>) {
    const bag = row.format_dataset as { values?: Record<string, unknown> } | null;
    const values = bag?.values ?? {};
    for (const key of ["entries", "subjectA", "subjectB", "subject"]) {
      const v = values[key];
      if (typeof v === "string" && v.trim()) out.add(v.trim());
      else if (Array.isArray(v)) for (const x of v) if (typeof x === "string" && x.trim()) out.add(x.trim());
    }
  }
  return [...out];
}
