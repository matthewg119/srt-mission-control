// Shared "research → classify → create report → post prompt drop → kick off
// batch 0" pipeline. Used by both the Slack /audit command and the public
// srtagency.com free-audit intake — each just supplies how to report back on
// a low-confidence-city or a hard failure (Slack has a thread to reply into;
// the public intake has no one to ask, so it proceeds on a best guess).

import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { isThinResearch, researchWebsite, SiteFetchError, type SiteResearch } from "./site-research";
import { researchProfile, describeTarget, type ResearchTarget } from "./search-research";
import { isOwnDomain, type BusinessIdentity } from "./claude-research";
import { normalizeTarget } from "@/lib/scan/normalize";
import { assertPublicHost } from "@/lib/scan/public-host";
import { classifyBusiness } from "./classify";
import { generateSlug } from "./slug";
import { getOrCreateAuditChannel } from "./audit-channel";
import { formatPromptDrop } from "./slack-format";
import { detectSiteSignals } from "./site-signals";
import { checkRobots, type RobotsCheck } from "./robots-check";
import type { AuditReportRow } from "./types";

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";
}

export interface RunAuditPipelineParams {
  /**
   * The prospect's website. OPTIONAL, because a large share of local businesses do not have
   * one: a Google Business Profile, a Yelp page, and nothing they own.
   *
   * Supply this OR `businessName`. With neither there is nothing to identify and the run is
   * refused; with both, the website wins and the name is only a hint to the classifier.
   */
  website?: string;
  /**
   * Name-mode: the business as Matthew typed it in `/audit Business Name | City, ST`.
   *
   * ‼️ `city` becomes REQUIRED alongside it. There is no site to detect a city from, and a
   * trading name on its own is not unique — search will happily return the Hernandez Auto
   * Repair in Durham for a run meant for the one in Chicago, and the whole score would then
   * describe a business nobody asked about.
   */
  businessName?: string;
  city?: string;
  competitors?: string[];
  requestedBy?: string; // Slack user id, when triggered from Slack
  requesterName?: string;
  requesterEmail?: string;
  requesterPhone?: string;
  /** Links the report to the #hot-leads thread opened by ingestLead, so the
   *  finished report replies under the lead instead of posting standalone. */
  contactId?: string;
  /** Which public funnel produced this lead ("audit" | "pdf" | "contact"). Persisted on the
   *  row rather than kept in memory because finishReport runs in a DIFFERENT request
   *  (/api/audit/process) and only ever sees the audit_reports row. It routes the pitch card
   *  and decides whether the drafted email carries the med spa guide. */
  leadSource?: string;
  /** Public intake has no one to ask for a city — proceed on the best guess instead of blocking. */
  allowLowConfidenceCity?: boolean;
  /**
   * Ask which city this is, and do not score until the answer comes back.
   *
   * `subject` is the website or the business name, whichever identifies this run. `alternates`
   * is populated only on the name-research path, where the research step found the same trading
   * name in more than one metro — that list is the whole reason a bare `/audit Business Name` is
   * safe, so a caller that renders this should offer the candidates rather than just repeating
   * the best guess.
   */
  onNeedsCity?: (
    subject: string,
    bestGuess: string | null,
    alternates?: Array<{ city: string; state: string; note: string }>
  ) => Promise<void>;
  onError?: (message: string) => Promise<void>;
  /**
   * The client this run is being fired FOR, when it is a client baseline rather than a
   * prospecting audit. Stored on the row so every artifact generator can ask "which run is
   * this client's" without going through the soft contact_id link.
   */
  clientId?: string;
  /**
   * Where the finished scorecard should land. Supplied by client onboarding so the report
   * comes back in the client's own ops thread instead of #ai-visibility-audits.
   *
   * ‼️ THIS HAS TO BE A PARAMETER, not something the caller patches on afterwards. The row is
   * inserted with the audit channel below, and `slack_thread_ts` is OVERWRITTEN a few lines
   * further down with the prompt drop's ts. Anything an onReportCreated callback wrote to
   * either field would be gone before the batches even start. Passing it in is what lets the
   * insert and the post agree in the first place.
   */
  deliveryThread?: { channelId: string; threadTs: string };
  /**
   * Fired the moment the audit_reports row exists, BEFORE the Slack post and before the
   * batch kick-off.
   *
   * This function does not return until the ENTIRE audit is finished: the kick-off fetch
   * below is awaited (it has to be, see the comment there), and /api/audit/process runs every
   * batch and then finishReport before it responds. So `reportId` in the return value arrives
   * minutes late, which is useless to a caller that needs to show progress or link a row.
   * /scan uses this to attach its session to the report within ~30s instead of ~5 minutes.
   *
   * Best-effort: a throw here must not sink an audit that is otherwise fine.
   */
  onReportCreated?: (reportId: string) => Promise<void>;
}

export interface RunAuditPipelineResult {
  ok: boolean;
  reportId?: string;
}

/**
 * How long after it started a run may still plausibly be alive.
 *
 * A full run is 4 to 6 minutes; past this it died without reaching `done` and the
 * watchdog is the only thing that will notice, once a day. Shared so the button that
 * refuses to start a second run and the page that greys it out cannot disagree — two
 * literals is exactly how a lead ends up with its audit button stuck off until
 * tomorrow morning.
 */
export const RUN_IN_FLIGHT_MINUTES = 15;

/** Minutes within which a repeat request for the same website+email is treated
 *  as a double submit rather than a genuine re-audit. A full run is 20 engine
 *  calls plus classification, so a stray second beacon is expensive. */
const DEDUP_WINDOW_MINUTES = 30;

/**
 * Has this exact request already been made in the last half hour?
 *
 * Keyed on the WEBSITE when there is one and on the name+city when there is not. Keying a
 * name-mode run on `website` would compare null to null and either match every other
 * website-less report or, with Postgres null semantics, match none of them. Neither is a
 * duplicate check.
 */
async function findRecentReport(
  target: { website: string } | { name: string; city?: string },
  email?: string
): Promise<string | null> {
  if (!email) return null;
  const cutoff = new Date(Date.now() - DEDUP_WINDOW_MINUTES * 60_000).toISOString();
  let q = supabaseAdmin
    .from("audit_reports")
    .select("id")
    .eq("requester_email", email)
    .in("status", ["classifying", "running", "done"])
    .gte("created_at", cutoff);

  if ("website" in target) {
    q = q.eq("website", target.website);
  } else {
    q = q.is("website", null).eq("client_name", target.name);
    // The city is only part of the key when it was actually supplied. This check runs BEFORE
    // research, so on a bare-name run there is no city to compare yet — matching on name alone
    // is looser than ideal, but this is a 30-minute double-submit guard, and the alternative
    // (comparing against a null city that research is about to fill in) never matches anything.
    if (target.city) q = q.eq("city", target.city);
  }

  const { data } = await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
  return data?.id ?? null;
}

export async function runAuditPipeline(params: RunAuditPipelineParams): Promise<RunAuditPipelineResult> {
  // One of the two identities is required. Name mode additionally requires a city — see the
  // doc on businessName for why that is a correctness rule and not a convenience.
  const declaredName = params.businessName?.trim();
  if (!params.website && !declaredName) {
    await params.onError?.("No website and no business name, so there was nothing to identify.");
    return { ok: false };
  }
  // ‼️ There is deliberately no "a city is required" guard here any more.
  //
  // There used to be, and its reasoning still holds: a trading name is not unique, so a run with
  // no city scores whichever business search happened to surface. What changed is WHERE that is
  // enforced. The research step below is now required to report every candidate metro, and this
  // function refuses to score while the answer is ambiguous (see the city-resolution block after
  // the research). Blocking at the door additionally demanded that Matthew already know the city
  // for the one segment of prospects who have the least published about them.
  const typedCity = params.city?.trim() || undefined;

  const target: ResearchTarget = params.website
    ? { kind: "website", website: params.website }
    : { kind: "name", name: declaredName as string, city: typedCity };
  const label = describeTarget(target);

  const duplicateOf = await findRecentReport(
    params.website ? { website: params.website } : { name: declaredName as string, city: typedCity },
    params.requesterEmail
  );
  if (duplicateOf) {
    console.log(`[run-audit-pipeline] skipping duplicate for ${label} (report ${duplicateOf})`);
    return { ok: true, reportId: duplicateOf };
  }

  // The crawl feeds the QUESTIONS, never the answers — the score comes entirely from
  // audit_runs. So a page we cannot read is not a reason to skip 20 engine calls; it is a
  // reason to find out who this business is some other way. What we must NOT do is guess.
  //
  // A business with no site at all is the same situation arrived at from the other end: there
  // was never a page to read, so third-party research is not a fallback here, it is the plan.
  let research: SiteResearch;
  /** Populated only when a research engine returned STRUCTURE (Claude did the identifying).
   *  Null after an OpenAI-backup run, which returns prose — see researchProfile(). */
  let identity: BusinessIdentity | null = null;
  /** A site the research turned up for a business we were told had none. */
  let discoveredWebsite: string | null = null;

  if (target.kind === "name") {
    try {
      const found = await researchProfile(target, null);
      research = found.research;
      identity = found.identity;
    } catch (e) {
      await params.onError?.((e as Error).message);
      return { ok: false };
    }

    // ‼️ THE BUSINESS MAY HAVE A SITE AFTER ALL, and if it does we want to read it.
    //
    // "No website" is Matthew's read of a Google result, not a verified fact, and research
    // routinely turns one up. A crawlable site is strictly better input than a directory
    // profile: it re-enables site_signals and robots_check, both of which are null on a
    // declared run, and those are what the cold-email hooks are built from. So a discovered
    // site upgrades this run from `declared` to a real crawl rather than being noted and
    // ignored.
    // The name to test affinity against is the one RESEARCH returned, falling back to the one
    // Matthew typed. A trading name found in sources ("Hernandez Auto Repair Inc.") matches a
    // domain more reliably than an abbreviation he typed from a Google result.
    const affinityName = identity?.tradingName ?? declaredName ?? null;
    const candidate = (identity?.websites ?? []).find((w) => isOwnDomain(w, affinityName)) ?? null;
    if (candidate) {
      // ‼️ THIS IS A MODEL-SUPPLIED URL ABOUT TO BE FETCHED SERVER-SIDE.
      //
      // Until now /scan was the only place in this app that did that, and it is guarded for a
      // reason — a hostname that resolves to link-local or private space turns our own fetcher
      // into an SSRF probe. Reuse those guards rather than writing a second pair: normalizeTarget
      // rejects junk and obvious private hosts with no DNS, assertPublicHost resolves the name
      // and fails closed on a private answer.
      const normalized = normalizeTarget(candidate);
      if (!normalized.ok) {
        console.warn(`[run-audit-pipeline] ${label}: rejected discovered URL ${candidate} (${normalized.error})`);
      } else if (!(await assertPublicHost(normalized.target.domain))) {
        // Returns false rather than throwing, and false covers both "resolves to private space"
        // and "does not resolve at all". Either way we are not fetching it.
        console.warn(`[run-audit-pipeline] ${label}: discovered host ${normalized.target.domain} is not public`);
      } else {
        try {
          const site = await researchWebsite(normalized.target.website);
          if (isThinResearch(site)) {
            console.warn(
              `[run-audit-pipeline] ${label}: ${normalized.target.website} too thin, staying declared`
            );
          } else {
            console.log(`[run-audit-pipeline] ${label}: found and read ${normalized.target.website}`);
            research = site;
            discoveredWebsite = normalized.target.website;
          }
        } catch (e) {
          // A site we found but cannot read is not a reason to fail: the third-party profile we
          // already have is exactly what this run was going to use anyway.
          console.warn(
            `[run-audit-pipeline] ${label}: could not read discovered site ${normalized.target.website} — ${(e as Error).message}`
          );
        }
      }
    }
  } else {
    try {
      research = await researchWebsite(target.website);
      if (isThinResearch(research)) {
        // Readable, but it says almost nothing — a splash page or a JS-only shell. Classifying
        // from this produces 20 generic questions that measure nothing.
        console.warn(`[run-audit-pipeline] ${label}: page text too thin, adding search research`);
        try {
          const enriched = await researchProfile(target, null, research);
          research = enriched.research;
          identity = enriched.identity;
        } catch {
          // Thin is survivable on its own — the page WAS readable. Keep what we have.
          console.warn(`[run-audit-pipeline] ${label}: enrichment found nothing, using thin page`);
        }
      }
    } catch (e) {
      const block = e instanceof SiteFetchError ? e.block : null;
      try {
        const fallback = await researchProfile(target, block);
        research = fallback.research;
        identity = fallback.identity;
      } catch {
        await params.onError?.(
          `${(e as Error).message} Third-party sources could not identify the business either, ` +
            `so there was nothing to build questions from. Nothing was scored.`
        );
        return { ok: false };
      }
      console.warn(
        `[run-audit-pipeline] ${label}: site unreadable (${block?.reason ?? "unknown"}), running on search research`
      );
    }
  }

  // --- City resolution ------------------------------------------------------
  // Only reachable on a name run with no city typed. A city Matthew supplied always wins: he is
  // looking at the Google result and the model is not.
  let resolvedCity = typedCity;
  if (!resolvedCity && identity) {
    const ambiguous = identity.alternates.length > 0 || identity.cityConfidence === "low";

    if (ambiguous && !params.allowLowConfidenceCity) {
      // ‼️ Ask, do not guess. This is the entire safety property that made it acceptable to drop
      // the city requirement at the parser: two businesses sharing a trading name is the normal
      // case, not an edge one, and scoring the wrong one produces a full report, a scorecard and
      // a cold email about a company nobody asked about.
      await params.onNeedsCity?.(
        declaredName as string,
        identity.city ? [identity.city, identity.state].filter(Boolean).join(", ") : null,
        identity.alternates
      );
      return { ok: false };
    }

    if (identity.city) {
      resolvedCity = [identity.city, identity.state].filter(Boolean).join(", ");
      console.log(
        `[run-audit-pipeline] ${label}: resolved city to ${resolvedCity} (${identity.cityConfidence ?? "unstated"} confidence)`
      );
    }
  }

  let classification;
  try {
    classification = await classifyBusiness(research, {
      // The RESOLVED city, not the typed one. On a bare-name run this is what research settled
      // on (and what the ambiguity gate above already cleared), so the 20 questions carry the
      // right geo-modifiers instead of none at all.
      city: resolvedCity,
      competitors: params.competitors,
      businessName: declaredName,
    });
  } catch (e) {
    await params.onError?.(`Classification failed for ${label}: ${(e as Error).message}`);
    return { ok: false };
  }

  // A city is only ever required for local businesses — a national/online/B2B
  // business (is_local:false) proceeds with no city, no fallback question.
  if (classification.is_local && classification.city_confidence === "low" && !params.allowLowConfidenceCity) {
    // Unreachable in name mode: a city is required at the door and classifyBusiness pins it
    // to "high", so this only ever fires for a website run that came back unsure.
    await params.onNeedsCity?.(params.website ?? label, classification.city_detected);
    return { ok: false };
  }

  // A client baseline is delivered to the client's ops thread; everything else goes to the
  // audit channel. Resolved once, here, so the insert below and the post further down cannot
  // disagree about where this run lives.
  const destination = params.deliveryThread
    ? { id: params.deliveryThread.channelId, threadTs: params.deliveryThread.threadTs }
    : { id: (await getOrCreateAuditChannel()).id, threadTs: null as string | null };
  const slug = await generateSlug();

  // The "one thing working against you" hook for cold email 1, computed from the homepage
  // markup we already have. Best-effort: a regex surprise here must never sink an audit.
  // ‼️ null and [] are NOT interchangeable here. [] means "we read the site and it is clean",
  // which is one of the two things that licenses the "something on your own site" tease in cold
  // email 1. On a run where nobody read the page there is no site to have an opinion about, so
  // it stays null and that tease stays unsayable. Same tri-state contract as robots_check.
  let siteSignals: ReturnType<typeof detectSiteSignals> | null = null;
  if (research.source !== "search" && research.source !== "declared") {
    siteSignals = [];
    try {
      siteSignals = detectSiteSignals({
        html: research.homepageHtml,
        // Non-null inside this branch: source is neither "search" nor "declared", so a page
        // was actually fetched and researchWebsite echoed its URL back.
        website: research.website as string,
        schemaHints: research.schemaHints,
        currentYear: new Date().getFullYear(),
      });
    } catch (e) {
      console.error("[run-audit-pipeline] site-signal scan failed:", (e as Error).message);
    }
  }

  // Does robots.txt lock the AI crawlers out? Tri-state on purpose (see robots-check.ts):
  // null = never ran, so nothing downstream may claim anything about their crawler access.
  // ‼️ Stays null with no website. There is no robots.txt to fetch, and null is exactly the
  // right answer: "nothing is known about their crawler access", which is what forbids any
  // downstream claim about it. Reading it as [] would say "we checked and they are wide
  // open" about a site that does not exist.
  let robotsCheck: RobotsCheck = null;
  if (research.website) {
    try {
      robotsCheck = await checkRobots(research.website);
    } catch (e) {
      console.error("[run-audit-pipeline] robots check failed:", (e as Error).message);
    }
  }

  const { data: inserted, error: insertError } = await supabaseAdmin
    .from("audit_reports")
    .insert({
      slug,
      // discoveredWebsite is set only when a name-mode run turned up a real own-domain site AND
      // successfully read it, so `website` here is never a URL nobody fetched. That matters: the
      // whole readership of this column treats a non-null value as "there is a site and we have
      // seen it", and robots_check / site_signals below are computed on exactly that basis.
      website: params.website ?? discoveredWebsite ?? null,
      client_name: classification.business_name,
      city: classification.city_detected,
      business_type: classification.business_type,
      vertical_slug: classification.vertical_slug,
      buyer_persona: classification.buyer_persona,
      competitors: classification.likely_competitors,
      prompts: classification.prompts,
      status: "running",
      requested_by: params.requestedBy ?? null,
      requester_name: params.requesterName ?? null,
      requester_email: params.requesterEmail ?? null,
      requester_phone: params.requesterPhone ?? null,
      contact_id: params.contactId ?? null,
      lead_source: params.leadSource ?? null,
      slack_channel_id: destination.id,
      slack_thread_ts: destination.threadTs,
      client_id: params.clientId ?? null,
      site_signals: siteSignals,
      robots_check: robotsCheck,
      crawl_block: research.blocked,
      research_source: research.source,
    })
    .select("*")
    .single();

  if (insertError || !inserted) {
    await params.onError?.(`Could not save audit report: ${insertError?.message ?? "unknown error"}`);
    return { ok: false };
  }

  const report = inserted as AuditReportRow;

  // Announce the row before anything slow happens to it. See onReportCreated's doc comment:
  // everything below this line, including the awaited kick-off, takes minutes.
  try {
    await params.onReportCreated?.(report.id);
  } catch (e) {
    console.error("[run-audit-pipeline] onReportCreated failed:", (e as Error).message);
  }

  const { text: dropText } = formatPromptDrop(report, {
    cityResolvedByResearch: !typedCity && !!resolvedCity,
    discoveredWebsite,
  });

  if (destination.threadTs) {
    // ‼️ The prompt drop is a REPLY here, and slack_thread_ts is deliberately NOT touched. A
    // reply's own ts is not a thread key: writing it back would make finishReport post the
    // scorecard as a reply to a reply, which Slack flattens into the parent thread but which
    // also detaches it from clientForThread()'s ops_thread_ts lookup, so any screenshot filed
    // under it would stop resolving to a client. The parent stays the thread.
    await slack.postThreadReply(destination.id, destination.threadTs, dropText);
  } else {
    const posted = await slack.postMessage(destination.id, dropText);
    const threadTs = (posted as { ts?: string }).ts;
    if (threadTs) {
      await supabaseAdmin.from("audit_reports").update({ slack_thread_ts: threadTs }).eq("id", report.id);
    }
  }

  // Kick off batch processing. Internal route self-chains through the remaining
  // batches. MUST be awaited here — this function may itself run inside
  // waitUntil() at the call site, which only keeps the lambda alive until the
  // promise IT was given settles. A fire-and-forget fetch resolves this
  // function instantly, letting Vercel freeze the lambda before the request is
  // actually sent — the kick-off silently vanishes. (Confirmed in production:
  // the first real /audit run left status:"running" forever with zero
  // audit_runs rows, because this fetch never got out the door.)
  const secret = process.env.AUDIT_INTERNAL_SECRET || "";
  try {
    await fetch(`${appUrl()}/api/audit/process?id=${report.id}&batch=0`, {
      method: "POST",
      headers: { "x-audit-secret": secret },
    });
  } catch (e) {
    console.error("[run-audit-pipeline] failed to kick off processing:", (e as Error).message);
  }

  return { ok: true, reportId: report.id };
}
