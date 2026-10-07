// Putting a keyword somebody typed into a client's set, from a surface that is not Slack.
//
// ‼️ IT EXISTS BECAUSE THE LAUNCH LANE COULD PICK KEYWORDS AND NOT MINT THEM (2026-10-05).
// Matthew asked the onboarding chat to add four lead-magnet phrases and it answered "I cannot add
// keywords directly, that requires the keyword step to be reopened". That was true: the only
// `add:` in the repo is addCommand() in client-keywords.ts, which is private, and that file
// statically imports @/lib/slack-bot and @/config/delivery-steps, both of which
// _probe-launch-isolation.ts forbids a lane file from reaching.
//
// ‼️ IT SHARES THE RULES AND NOT THE ORCHESTRATION, WHICH IS THE HONEST SPLIT.
// Every judgement about whether a phrase may join a set lives in keyword-expansion.ts and is
// called from here, not copied: classifyUse decides query or hook, keywordFault refuses the
// shapes that are not searches, scoreKeyword scores it, normalizePhrase computes the key the
// unique index is on. So a phrase refused in Slack is refused here, in the same words.
//
// What differs is deliberate and is the whole reason for a second door:
//   - THE CATEGORY IS GIVEN, NEVER CLASSIFIED. addCommand runs classifyCategory over a pasted
//     phrase because it is sorting a harvest. A keyword typed by hand is going somewhere on
//     purpose, and Matthew's rule (2026-10-05) is that hand-added keywords land in their own
//     named cluster so they stay visibly distinct from harvested ones.
//   - APPROVAL RIDES ON SELECTION rather than on whether the set was already approved. addCommand
//     approves only if an approval exists, which is right when it is filing a paste. Here the
//     caller said these are for pages, so selectKeywordIds does both facts in its one write.
//
// ‼️ IT NEVER WRITES selected_at OR approved ITSELF. selectKeywordIds in keyword-decisions.ts is
// the repo's one writer of both, declared in step-needs.ts and grepped by _probe-dead-wires.ts §8.
// This module inserts the row and hands the ids to that function.

import { supabaseAdmin } from "@/lib/db";
import { normalizePhrase } from "./phrase-quality";
import { isObjection } from "./harvest";
import { classifyUse, keywordFault, scoreKeyword } from "./keyword-expansion";
import { awarenessOf } from "@/lib/audit-engine/awareness";
import { blockFor } from "@/lib/audit-engine/supplied-run";

export interface MintReport {
  /** Phrases that became new rows. */
  added: string[];
  /** Phrases that were dropped before and have been brought back. */
  restored: string[];
  /** Phrases already in the set. Not an error: they are selected along with the rest. */
  already: string[];
  /** Phrases the shared filter would not take, each with the reason it gave. */
  refused: Array<{ phrase: string; why: string }>;
  /** How many ended up in the page pool, counted by the writer that put them there. */
  selected: number;
  /** Stored as hooks, which can never be a page's keyword. */
  hooks: string[];
}

/**
 * The awareness stage, composed exactly as client-keywords.ts composes it.
 *
 * No client name is passed to blockFor for the reason that file gives: a keyword naming the client
 * is a brand query, and the set is built from what buyers type about the OFFER.
 */
function stageOf(phrase: string): number {
  return awarenessOf(phrase, blockFor(phrase, null));
}

export async function mintKeywords(args: {
  clientId: string;
  phrases: readonly string[];
  /** The cluster these belong to. Given by the caller, never guessed. */
  category: string;
  by: string;
  /** Default true: the caller asked for these because pages are to be built from them. */
  select?: boolean;
}): Promise<{ ok: true; report: MintReport } | { ok: false; error: string }> {
  const category = args.category.trim();
  if (!category) return { ok: false, error: "A hand-added keyword needs a category, and one is never guessed here." };

  const wanted = args.phrases.map((p) => String(p ?? "").trim()).filter(Boolean);
  if (!wanted.length) return { ok: false, error: "No phrases were given." };

  const { data, error } = await supabaseAdmin
    .from("client_keywords")
    .select("id, phrase, normalized, use, dropped_at, rank, audience, offer_fingerprint")
    .eq("client_id", args.clientId);
  if (error) return { ok: false, error: error.message };

  const rows = (data ?? []) as Array<Record<string, unknown>>;

  // ‼️ TAKEN OFF THE SET RATHER THAN RECOMPUTED. `audience` has a CHECK of ('patient','owner') and
  // `offer_fingerprint` is what marks which offer a proposal was written for. Both are properties
  // of the set these phrases are joining, so reading them off it cannot disagree with it. A client
  // with no keywords yet has no set to join and is told to build one first.
  const sibling = rows.find((r) => r.audience);
  if (!sibling) {
    return {
      ok: false,
      error: "This client has no keyword set yet, so there is nothing to add to. Build the keyword set first.",
    };
  }
  const audience = String(sibling.audience);
  const fingerprint = (sibling.offer_fingerprint as string | null) ?? null;

  const byKey = new Map<string, Record<string, unknown>>();
  for (const r of rows) byKey.set(`${String(r.normalized)}|${String(r.use)}`, r);

  let rank = Math.max(0, ...rows.map((r) => (r.rank as number | null) ?? 0));
  const now = new Date().toISOString();

  const report: MintReport = { added: [], restored: [], already: [], refused: [], selected: 0, hooks: [] };
  const ids: string[] = [];
  const inserts: Array<Record<string, unknown>> = [];

  for (const phrase of wanted) {
    const use = classifyUse("query", phrase);
    const fault = keywordFault(phrase, use);
    if (fault) {
      report.refused.push({ phrase, why: fault.replace(/_/g, " ") });
      continue;
    }

    const normalized = normalizePhrase(phrase);
    const existing = byKey.get(`${normalized}|${use}`);

    if (existing && !existing.dropped_at) {
      report.already.push(String(existing.phrase));
      ids.push(String(existing.id));
      continue;
    }

    if (existing) {
      // Dropped before and asked for again. Bringing it back is a decision somebody just made, so
      // the drop is cleared and the origin becomes manual, exactly as `add:` does it.
      const { error: upErr } = await supabaseAdmin
        .from("client_keywords")
        .update({ dropped_at: null, origin: "manual", category, updated_at: now })
        .eq("id", String(existing.id));
      if (upErr) return { ok: false, error: upErr.message };
      report.restored.push(String(existing.phrase));
      ids.push(String(existing.id));
      continue;
    }

    rank += 1;
    // ‼️ A HOOK IS STORED AND NEVER SELECTED. It is a marketing line rather than a search, so it is
    // not a thing a page can be aimed at, and selecting it would put a slogan in the page pool.
    if (use === "hook") report.hooks.push(phrase);
    else report.added.push(phrase);

    inserts.push({
      client_id: args.clientId,
      phrase,
      normalized,
      category,
      use,
      origin: "manual",
      audience,
      offer_fingerprint: fingerprint,
      score: scoreKeyword(
        { origin: "manual", frequency: 1, intent: 0, objection: isObjection(phrase), currentlyNamed: null },
        0
      ),
      rank,
      // Left unapproved here on purpose: selectKeywordIds writes `approved` and `selected_at`
      // together, and it is the declared writer of both.
      approved: false,
      awareness_stage: stageOf(phrase),
      updated_at: now,
    });
  }

  if (inserts.length) {
    const { data: made, error: insErr } = await supabaseAdmin
      .from("client_keywords")
      .insert(inserts)
      .select("id, use");
    if (insErr) return { ok: false, error: insErr.message };
    for (const m of (made ?? []) as Array<Record<string, unknown>>) {
      if (String(m.use) === "query") ids.push(String(m.id));
    }
  }

  if (args.select !== false && ids.length) {
    const { selectKeywordIds } = await import("./keyword-decisions");
    const sel = await selectKeywordIds({ clientId: args.clientId, ids, by: args.by });
    if (!sel.ok) return { ok: false, error: `Stored, but not selected: ${sel.error}` };
    report.selected = sel.selected;
  }

  return { ok: true, report };
}

/**
 * Drop keywords by id: out of both pools, and remembered as unwanted.
 *
 * ‼️ dropped_at, NEVER A DELETE, which is the rule client_keywords has carried since its first
 * migration: a dropped row is remembered so a later expansion cannot propose it back. Unselecting
 * is the gentler decision and lives in keyword-decisions.ts beside its opposite; this one is for a
 * phrase that is simply wrong for the business.
 */
export async function dropKeywordIds(args: {
  clientId: string;
  ids: readonly string[];
  by: string;
}): Promise<{ ok: true; dropped: number } | { ok: false; error: string }> {
  if (!args.ids.length) return { ok: true, dropped: 0 };

  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from("client_keywords")
    .update({ dropped_at: now, selected_at: null, selected_by: null, updated_at: now })
    .eq("client_id", args.clientId)
    .in("id", args.ids)
    .select("id, phrase, category, rank, score, origin, use");
  if (error) return { ok: false, error: error.message };

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  const { recordKeywordDecisions } = await import("./keyword-dataset");
  await recordKeywordDecisions({
    clientId: args.clientId,
    action: "drop",
    actor: args.by,
    rows: rows.map((r) => ({
      id: String(r.id ?? ""),
      phrase: String(r.phrase ?? ""),
      category: String(r.category ?? "general"),
      use: (String(r.use ?? "query") as "query" | "hook"),
      origin: String(r.origin ?? "manual") as never,
      rank: (r.rank as number | null) ?? null,
      score: (r.score as number) ?? 0,
    })),
    context: { via: "typed" },
  }).catch(() => {});

  return { ok: true, dropped: rows.length };
}
