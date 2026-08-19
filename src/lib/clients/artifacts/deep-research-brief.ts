// Delivery step 9, the half of it a person runs.
//
// ‼️ RECONSTRUCTED 2026-08-19 after this file was accidentally overwritten while it was
// still untracked. The contract below is taken from scripts/test-onboarding-artifacts.ts,
// which asserts the section headings, the verbatim rules and the deterministic output, and
// from registry.ts, which calls generateDeepResearchBrief(clientId). If anything here reads
// as a paraphrase of the original intent rather than the original wording, that is why.
//
// The step is `auto_then_manual`: runHarvest() in ../harvest.ts is the automatic half and
// scrapes real phrasings off the pages the engines cited; this is the manual half. It emits
// a brief a person pastes into a deep-research tool, and the result comes back into
// question_bank with source 'deep_research'.
//
// ─── THE BRIEF IS WRITTEN, NOT GENERATED ─────────────────────────────────────────────
//
// A model asked to "write a research brief" writes a different one every run, which makes
// two clients' phrase sets incomparable and makes a regression in the template invisible.
// So the template is code and the client's facts are interpolated into it. The test asserts
// buildDeepResearchBrief(x) === buildDeepResearchBrief(x), byte for byte, and that assertion
// is the whole reason this is a function and not a prompt.
//
// ─── VERBATIM MEANS VERBATIM ─────────────────────────────────────────────────────────
//
// The owner's own words for their objections, their ideal customer and who they do not want
// go in EXACTLY as typed, typos included. They are the most valuable strings in the file:
// an owner writing "im scared itll look fake" has told you the register their buyers think
// in, and tidying it into "concerns about unnatural results" throws that away and replaces
// it with agency language. The test checks for the typo on purpose.

import { supabaseAdmin } from "@/lib/db";
import { deliverArtifact } from "./deliver";

export interface BriefInput {
  clinicName: string;
  city: string | null;
  state: string | null;
  /** The treatment the money is in. Null when intake never recorded one. */
  primaryTreatment: string | null;
  services: string[];
  /** The owner's own words. Never summarised, never corrected. */
  objections: string | null;
  targetPatient: string | null;
  notWanted: string | null;
  triedBefore: string | null;
  /** Hosts the engines actually cited. The seed list, not a guess at one. */
  citedDomains: string[];
  /** Businesses the engines named instead of this one. */
  namedInstead: string[];
}

/** An absent value says so rather than leaving a hole the reader has to interpret. */
const NOT_RECORDED = "not recorded";

function val(v: string | null | undefined): string {
  const s = (v ?? "").trim();
  return s.length > 0 ? s : NOT_RECORDED;
}

function list(items: string[], empty: string): string {
  return items.length > 0 ? items.map((i) => `- ${i}`).join("\n") : `- ${empty}`;
}

/**
 * The brief. Deterministic: same input, same bytes.
 *
 * Structured on the customer-awareness framework the rest of SRT's research uses, so the
 * three parts are stable headings a reader learns once. The test asserts each of them.
 */
export function buildDeepResearchBrief(input: BriefInput): string {
  const where = [input.city, input.state].filter(Boolean).join(", ") || NOT_RECORDED;

  return `DEEP RESEARCH BRIEF
${input.clinicName}${where !== NOT_RECORDED ? `, ${where}` : ""}

WHAT THIS IS FOR

I am building pages that answer the questions real buyers ask before they choose a
provider. I need their language, not the industry's. Everything below feeds a ranked list
of phrases, so precision matters more than polish.

WHAT I ALREADY KNOW

Business: ${input.clinicName}
Where: ${where}
The treatment the money is in: ${val(input.primaryTreatment)}
Services offered:
${list(input.services, NOT_RECORDED)}

The owner's own words, quoted exactly as they wrote them. Do not clean these up, do not
correct them, and do not treat them as sloppy. The register is the finding.

What customers object to: ${val(input.objections)}
Who they want more of: ${val(input.targetPatient)}
Who they do not want: ${val(input.notWanted)}
What they already tried: ${val(input.triedBefore)}

SEED SITES

These are the sources the AI engines actually cited when answering questions about this
market. Start here rather than with a fresh search, because these are the pages the engines
are already reading.

${list(input.citedDomains, "no cited sources recorded yet, so start from an open search")}

Businesses the engines named instead of this one:
${list(input.namedInstead, NOT_RECORDED)}

WHAT I WANT BACK

Minimum six pages. Cite a source for every claim. If you cannot source something, leave it
out and say you left it out. Do not invent a statistic and do not write marketing copy.

Part 1: Who the customer is

Who is actually buying this, in demographic and in situation. What is happening in their
life in the week before they start looking. What they call themselves, and what they would
never call themselves.

Part 2: What they are already using

What they have tried before this, including the things that are not competitors: the home
remedy, the cheaper substitute, doing nothing. Why each one stopped being enough. What they
believe about the professional option that is wrong.

Part 3: Curiosity and history

What they are quietly curious about and will not ask out loud. The horror stories that
circulate in this market, told the way buyers tell them rather than the way the trade
answers them. The external forces they blame for the problem, because a buyer who blames
their genetics and a buyer who blames their last provider need different pages. The
prejudices they hold about providers in this category, stated plainly even where they are
unfair.

For every phrase you report, give it word for word as somebody actually wrote or said it,
with the link. A paraphrase is worth nothing to me here. Note the reading level they write
at, because a page pitched above it does not get read.

Finish with a ranked list of the twenty-five phrases you would build pages around, most
commercially urgent first, each with the source it came from and one line on why it earns
its place.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// The generator the registry calls
// ─────────────────────────────────────────────────────────────────────────────

interface AutoResult {
  ok: boolean;
  error?: string;
  docId?: string;
  note?: string;
}

/**
 * Assemble this client's facts, render the brief, file it and post it.
 *
 * Ends the same way every other artifact does, through deliverArtifact: stored first,
 * step output_ref second, Slack last. The bot is not a member of the onboarding channel, so
 * the upload is expected to fail and the thread gets a link instead. That is documented at
 * length in deliver.ts and is a workspace fact rather than a bug here.
 */
export async function generateDeepResearchBrief(clientId: string): Promise<AutoResult> {
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("legal_name, dba_name, city, state, contact_id, domain, services, ideal_patient")
    .eq("id", clientId)
    .maybeSingle();

  if (!client) return { ok: false, error: "client not found" };

  // Intake bags. Free text the owner typed, read straight through without interpretation.
  const services = (client.services ?? {}) as Record<string, unknown>;
  const ideal = (client.ideal_patient ?? {}) as Record<string, unknown>;

  const str = (v: unknown): string | null => {
    const s = typeof v === "string" ? v.trim() : "";
    return s.length > 0 ? s : null;
  };

  const serviceList = Array.isArray(services.services)
    ? (services.services as unknown[]).map((s) => String(s)).filter(Boolean)
    : str(services.services)
      ? [str(services.services) as string]
      : [];

  // The seed sites and the competitors both come from measured runs rather than from
  // anybody's opinion. An empty list is reported as empty; it is never padded.
  const { citedDomains, namedInstead } = await measuredContext(
    clientId,
    (client.contact_id as string | null) ?? null,
    (client.domain as string | null) ?? null
  );

  const brief = buildDeepResearchBrief({
    clinicName: (client.dba_name as string) || (client.legal_name as string) || "This business",
    city: (client.city as string | null) ?? null,
    state: (client.state as string | null) ?? null,
    primaryTreatment: str(services.primary_treatment) ?? str(services.primaryTreatment),
    services: serviceList,
    objections: str(ideal.objections),
    targetPatient: str(ideal.target),
    notWanted: str(ideal.not_wanted),
    triedBefore: str(ideal.tried_before),
    citedDomains,
    namedInstead,
  });

  const result = await deliverArtifact({
    clientId,
    stepKey: "avatar_harvest",
    filename: "deep-research-brief.txt",
    buffer: Buffer.from(brief, "utf8"),
    contentType: "text/plain; charset=utf-8",
    message:
      "Deep research brief. Paste it into the research tool, then bring the ranked list back " +
      "into this thread. The step stays open until that lands.",
  });

  return { ok: result.ok, error: result.error, docId: result.docId };
}

/**
 * Cited hosts and the businesses named instead, off this client's most recent run.
 *
 * ‼️ audit_reports.client_id is deliberately NOT used. It arrives with
 * docs/2026-08-19-artifact-plumbing.sql, which has not been applied, and PostgREST fails
 * the WHOLE query on one unknown column rather than ignoring it, so selecting it early
 * would break this for every client instead of degrading to an empty seed list.
 */
async function measuredContext(
  clientId: string,
  contactId: string | null,
  domain: string | null
): Promise<{ citedDomains: string[]; namedInstead: string[] }> {
  const empty = { citedDomains: [], namedInstead: [] };

  let q = supabaseAdmin
    .from("audit_reports")
    .select("id")
    .order("created_at", { ascending: false })
    .limit(1);

  if (contactId) q = q.eq("contact_id", contactId);
  else if (domain) q = q.ilike("website", `%${domain}%`);
  else return empty;

  const { data: report } = await q.maybeSingle();
  if (!report) return empty;

  const { data: runs } = await supabaseAdmin
    .from("audit_runs")
    .select("citations, recommended")
    .eq("report_id", report.id as string)
    .eq("status", "ok");

  const hosts = new Map<string, number>();
  const named = new Map<string, number>();

  for (const row of runs ?? []) {
    // citations is jsonb and has carried both bare strings and {url} objects over the life
    // of the table. Handle both rather than assuming the newer shape.
    for (const c of Array.isArray(row.citations) ? (row.citations as unknown[]) : []) {
      const url = typeof c === "string" ? c : ((c as { url?: string })?.url ?? "");
      if (!url) continue;
      try {
        const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
        hosts.set(host, (hosts.get(host) ?? 0) + 1);
      } catch {
        // A malformed citation is skipped rather than reported. It is one seed site.
      }
    }

    for (const r of Array.isArray(row.recommended) ? (row.recommended as unknown[]) : []) {
      const name = typeof r === "string" ? r.trim() : String((r as { name?: string })?.name ?? "").trim();
      if (name) named.set(name, (named.get(name) ?? 0) + 1);
    }
  }

  const rank = (m: Map<string, number>, n: number) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);

  return { citedDomains: rank(hosts, 12), namedInstead: rank(named, 8) };
}
