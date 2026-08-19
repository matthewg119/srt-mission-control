// Who the engines actually named — delivery step 7, Runner v3 section 7.
//
// ‼️ THE CLIENT'S THREE GUESSES ARE NOT THE AUDIT SET.
// Section 7: "Do not use the client's three guesses as the audit set. Use them as candidates
// alongside who the engines actually named." Both sources go in, labelled, and a clinic naming
// three competitors that no engine has ever mentioned is itself a finding worth saying out loud
// on the call. Collapsing the two sources would delete that finding.
//
// The ranking comes from audit_runs.recommended: zero to five business names extracted per
// prompt by extract-recommended.ts. Counting how many of the twenty named each business is the
// only ranking signal that exists, and it is the right one — it is literally "who does AI put in
// front of your customers instead of you".

import { supabaseAdmin } from "@/lib/db";
import { isExcludedFromShortlist } from "@/config/presence-platforms";
import { normalizeNameForCompare, stripEntitySuffix } from "./nap-compare";

export interface CandidateRow {
  id: string;
  name: string;
  normalizedName: string;
  website: string | null;
  address: string | null;
  source: "baseline_named" | "client_intake" | "both";
  timesNamed: number;
  engines: string[];
  sampleQuestions: string[];
  selected: boolean;
}

/** How many candidates the shortlist card offers. Matthew picks exactly three from it. */
export const SHORTLIST_SIZE = 10;
export const REQUIRED_SELECTIONS = 3;

interface Tally {
  name: string;
  normalized: string;
  timesNamed: number;
  engines: Set<string>;
  questions: string[];
}

/**
 * Count who was named across the run, excluding the client themselves and every consensus lock.
 *
 * Pure so it can be tested without a database. `clientAliases` are the names that mean the
 * client — being named IS the good outcome and must never appear in their own competitor list.
 */
export function tallyRecommended(
  runs: Array<{ prompt: string; engine: string; recommended: string[] }>,
  clientAliases: string[]
): Tally[] {
  const aliasSet = new Set(clientAliases.map((a) => stripEntitySuffix(normalizeNameForCompare(a))));
  const byName = new Map<string, Tally>();

  for (const run of runs) {
    // One prompt naming the same business twice still counts once: the metric is "how many of
    // the twenty named them", not how many times the string appeared.
    const seenInThisPrompt = new Set<string>();

    for (const raw of run.recommended ?? []) {
      const name = (raw ?? "").trim();
      if (!name) continue;

      const normalized = stripEntitySuffix(normalizeNameForCompare(name));
      if (!normalized) continue;
      if (aliasSet.has(normalized)) continue;
      if (isExcludedFromShortlist(name).excluded) continue;
      if (seenInThisPrompt.has(normalized)) continue;
      seenInThisPrompt.add(normalized);

      const existing = byName.get(normalized);
      if (existing) {
        existing.timesNamed += 1;
        existing.engines.add(run.engine);
        if (existing.questions.length < 3) existing.questions.push(run.prompt);
      } else {
        byName.set(normalized, {
          // The first spelling seen wins as the display name. The engines write one business
          // several ways and there is no authority to prefer one, so the alternative would be
          // picking arbitrarily and pretending otherwise.
          name,
          normalized,
          timesNamed: 1,
          engines: new Set([run.engine]),
          questions: [run.prompt],
        });
      }
    }
  }

  return [...byName.values()].sort((a, b) => b.timesNamed - a.timesNamed);
}

/**
 * Build the shortlist for a client from their baseline run plus their intake guesses.
 *
 * Idempotent: upserts on (client_id, normalized_name), so re-running refreshes counts without
 * duplicating and without clearing a selection somebody already made.
 */
export async function buildShortlist(
  clientId: string
): Promise<{ ok: boolean; error?: string; candidates?: number }> {
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("legal_name, dba_name, services")
    .eq("id", clientId)
    .maybeSingle();

  if (!client) return { ok: false, error: "client not found" };

  const { data: report } = await supabaseAdmin
    .from("audit_reports")
    .select("id")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!report) {
    return { ok: false, error: "no baseline run for this client, so nobody has been named yet" };
  }

  const { data: runs } = await supabaseAdmin
    .from("audit_runs")
    .select("prompt, engine, recommended")
    .eq("report_id", report.id);

  const aliases = [client.legal_name as string, client.dba_name as string].filter(Boolean);
  const tallies = tallyRecommended(
    (runs ?? []).map((r) => ({
      prompt: r.prompt as string,
      engine: r.engine as string,
      recommended: (r.recommended as string[] | null) ?? [],
    })),
    aliases
  );

  // The three named at intake step 2, flagged even when no engine mentioned them.
  const services = (client.services ?? {}) as Record<string, unknown>;
  const intakeNames = String(services.competitors ?? "")
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3);

  const rows = new Map<string, Record<string, unknown>>();

  for (const t of tallies.slice(0, SHORTLIST_SIZE)) {
    rows.set(t.normalized, {
      client_id: clientId,
      name: t.name,
      normalized_name: t.normalized,
      source: "baseline_named",
      times_named: t.timesNamed,
      engines: [...t.engines],
      sample_questions: t.questions,
    });
  }

  for (const raw of intakeNames) {
    const normalized = stripEntitySuffix(normalizeNameForCompare(raw));
    if (!normalized) continue;
    const existing = rows.get(normalized);
    if (existing) {
      // Named by the engines AND guessed by the client. The strongest kind of candidate.
      existing.source = "both";
    } else {
      rows.set(normalized, {
        client_id: clientId,
        name: raw,
        normalized_name: normalized,
        source: "client_intake",
        times_named: 0,
        engines: [],
        sample_questions: [],
      });
    }
  }

  if (!rows.size) return { ok: true, candidates: 0 };

  const { error } = await supabaseAdmin
    .from("competitor_candidates")
    .upsert([...rows.values()], { onConflict: "client_id,normalized_name" });

  if (error) return { ok: false, error: error.message };
  return { ok: true, candidates: rows.size };
}

export async function loadCandidates(clientId: string): Promise<CandidateRow[]> {
  const { data, error } = await supabaseAdmin
    .from("competitor_candidates")
    .select("*")
    .eq("client_id", clientId)
    .order("times_named", { ascending: false });

  if (error) {
    console.error("[clients/competitors] load failed:", error.message);
    return [];
  }

  return (data ?? []).map((d) => ({
    id: d.id as string,
    name: d.name as string,
    normalizedName: d.normalized_name as string,
    website: (d.website as string | null) ?? null,
    address: (d.address as string | null) ?? null,
    source: d.source as CandidateRow["source"],
    timesNamed: (d.times_named as number) ?? 0,
    engines: (d.engines as string[] | null) ?? [],
    sampleQuestions: (d.sample_questions as string[] | null) ?? [],
    selected: (d.selected as boolean) ?? false,
  }));
}

export async function selectedCompetitors(clientId: string): Promise<CandidateRow[]> {
  return (await loadCandidates(clientId)).filter((c) => c.selected);
}

/** The shortlist card. Numbered, with the count and one example question each. */
export function formatShortlistCard(clientName: string, candidates: CandidateRow[], totalPrompts: number): string {
  const lines = [
    `*Competitor shortlist for ${clientName}* — pick exactly ${REQUIRED_SELECTIONS}.`,
    `Ranked by how many of the ${totalPrompts} questions named them. Google each one before picking.`,
    "",
  ];

  candidates.forEach((c, i) => {
    const named =
      c.timesNamed > 0
        ? `named in ${c.timesNamed} of ${totalPrompts}`
        : "NOT named by any engine — this is the client's own guess, and that gap is worth saying on the call";
    lines.push(`${i + 1}. *${c.name}* — ${named}`);
    if (c.source === "both") lines.push("    Named by the engines and by the client at intake.");
    if (c.source === "client_intake") lines.push("    From intake step 2 only.");
    if (c.website) lines.push(`    ${c.website}`);
    if (c.sampleQuestions[0]) lines.push(`    e.g. "${c.sampleQuestions[0]}"`);
  });

  lines.push(
    "",
    "National chains and aggregators are already excluded: those are a consensus lock, not competitors."
  );
  return lines.join("\n");
}
