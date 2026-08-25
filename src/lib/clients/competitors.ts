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

/**
 * How arbitrary the third pick is.
 *
 * ‼️ A TIE-BREAK IS NOT A RANKING AND THE CARD MUST NOT PRINT IT AS ONE.
 *
 * `times_named` out of twenty prompts is a coarse signal and it ties constantly. On the first
 * real client the top two had 2 mentions each and then FIVE businesses were level at 1, so
 * "the top 3" was two facts and a coin toss. Printing 1, 2, 3 with no qualifier tells Matthew
 * the third business beat the fourth, which is not something the data says.
 *
 * Pure, so the card and any later caller cannot disagree about what happened.
 */
export function tieAtCutoff(
  candidates: CandidateRow[],
  cutoff = REQUIRED_SELECTIONS
): { tied: boolean; atCount: number; among: number } {
  const eligible = candidates.filter(isDefaultEligible);
  if (eligible.length <= cutoff) return { tied: false, atCount: 0, among: 0 };

  const atCount = eligible[cutoff - 1]?.timesNamed ?? 0;
  const among = eligible.filter((c) => c.timesNamed === atCount).length;
  return { tied: among > 1, atCount, among };
}

/**
 * May this candidate be picked AUTOMATICALLY?
 *
 * ‼️ A DIFFERENT FILTER FROM `isExcludedFromShortlist`, AND BOTH ARE NEEDED.
 *
 * That one drops aggregators and national chains at BUILD time, because a consensus lock is not
 * a competitor for anybody. This one is about what may be chosen with nobody watching, and the
 * case that produced it is real: the first client typed `"a"` into intake step 2's competitor
 * box, which became a candidate with `times_named: 0` and `source: "client_intake"`.
 *
 * An intake guess no engine has ever named is the one thing on this list with NO evidence behind
 * it. It stays on the shortlist, because a client naming three businesses the engines have never
 * heard of is itself a finding worth raising on the call — it just is not something to select on
 * their behalf.
 */
function isDefaultEligible(c: CandidateRow): boolean {
  if (c.timesNamed < 1) return false;
  // A name too short to identify a business cannot be verified before the call, and the point of
  // a default is that it survives being googled.
  if (c.name.trim().length < 3) return false;
  return true;
}

/**
 * Pre-select the top three by `times_named`, as a DEFAULT Matthew can change.
 *
 * Matthew: "I didnt really pick any competitors, just make sure it auto selects the top 3 most
 * mentioned from the audit."
 *
 * ‼️ THE EVIDENCE RULE IS UNTOUCHED. This writes `selected`, which is a real recorded decision
 * about which businesses the review audit and findings section 3 are built from. It does NOT
 * tick step 7 — he still presses Done, and the verifier still counts `selected = true` rows.
 * A default that also ticked the step would be a green checkmark over a choice nobody made,
 * which is the worst bug this board can have.
 *
 * ‼️ IT NEVER OVERWRITES A DECISION. Any row already carrying `selected` or a `selected_at`
 * stamp means somebody has been here, and this returns untouched. That is also what makes it
 * safe to call from `instructionsFor`, which re-runs every time the card is refreshed.
 */
export async function applyDefaultSelection(
  clientId: string
): Promise<{ ok: boolean; error?: string; picked?: CandidateRow[]; alreadyChosen?: boolean }> {
  const candidates = await loadCandidates(clientId);
  if (!candidates.length) return { ok: true, picked: [] };

  const { data: existing, error: existingErr } = await supabaseAdmin
    .from("competitor_candidates")
    .select("id")
    .eq("client_id", clientId)
    .or("selected.eq.true,selected_at.not.is.null")
    .limit(1);

  if (existingErr) return { ok: false, error: existingErr.message };
  if (existing?.length) {
    return { ok: true, alreadyChosen: true, picked: candidates.filter((c) => c.selected) };
  }

  // loadCandidates already orders by times_named desc.
  const picks = candidates.filter(isDefaultEligible).slice(0, REQUIRED_SELECTIONS);
  if (!picks.length) return { ok: true, picked: [] };

  const { error } = await supabaseAdmin
    .from("competitor_candidates")
    .update({
      selected: true,
      selected_at: new Date().toISOString(),
      // Named so a human reading the row later knows nobody chose these by hand. The board's
      // own writer stamps a real actor.
      selected_by: "Mission Control (default)",
    })
    .eq("client_id", clientId)
    .in(
      "id",
      picks.map((p) => p.id)
    )
    // The claim, and it is what makes a concurrent card refresh harmless: the loser updates
    // zero rows rather than re-stamping somebody's pick with a fresh timestamp.
    .is("selected_at", null);

  if (error) return { ok: false, error: error.message };
  return { ok: true, picked: picks.map((p) => ({ ...p, selected: true })) };
}

/**
 * The shortlist card. Numbered, with the count and one example question each.
 *
 * The top three are pre-ticked by `applyDefaultSelection` before this renders, so the card's job
 * is to say WHICH three are picked, that they are a default rather than a judgement, and how
 * arbitrary the last one is.
 */
export function formatShortlistCard(
  clientName: string,
  candidates: CandidateRow[],
  totalPrompts: number,
  boardUrl?: string | null
): string {
  const picked = candidates.filter((c) => c.selected);
  const tie = tieAtCutoff(candidates);

  const lines = [
    `*Competitor shortlist for ${clientName}*`,
    `Ranked by how many of the ${totalPrompts} questions named them. Google each one before confirming.`,
    "",
  ];

  if (picked.length) {
    lines.push(
      `:heavy_check_mark: *Pre-picked for you:* ${picked.map((c) => c.name).join(", ")}.`,
      `The top ${picked.length} by mentions, chosen automatically. It is a DEFAULT, not a decision — ` +
        "change it on the board if you know better, then hit Done to confirm."
    );
    // ‼️ Never present a tie-break as a ranking. On the first real client this read
    // "5 businesses are level at 1 mention", which is the honest description of picks 2 and 3.
    if (tie.tied) {
      lines.push(
        `:warning: The cut is a tie-break, not a ranking: ${tie.among} businesses are level at ` +
          `${tie.atCount} mention${tie.atCount === 1 ? "" : "s"}, so which of them made the ` +
          "list is arbitrary. Pick the ones you actually compete with."
      );
    }
    lines.push("");
  } else {
    lines.push(
      `Nothing is pre-picked: no candidate was named by an engine even once, so there is no ` +
        `default to offer. Pick ${REQUIRED_SELECTIONS} on the board.`,
      ""
    );
  }

  candidates.forEach((c, i) => {
    const named =
      c.timesNamed > 0
        ? `named in ${c.timesNamed} of ${totalPrompts}`
        : "NOT named by any engine — this is the client's own guess, and that gap is worth saying on the call";
    lines.push(`${c.selected ? ":heavy_check_mark:" : `${i + 1}.`} *${c.name}* — ${named}`);
    if (c.source === "both") lines.push("    Named by the engines and by the client at intake.");
    if (c.source === "client_intake") lines.push("    From intake step 2 only.");
    if (c.website) lines.push(`    ${c.website}`);
    if (c.sampleQuestions[0]) lines.push(`    e.g. "${c.sampleQuestions[0]}"`);
  });

  lines.push(
    "",
    "National chains and aggregators are already excluded: those are a consensus lock, not competitors.",
    "The review audit and findings section 3 are both built from this pick, so a wrong one makes " +
      "both of them about the wrong businesses."
  );
  if (boardUrl) lines.push(`Change the pick: ${boardUrl}`);
  return lines.join("\n");
}
