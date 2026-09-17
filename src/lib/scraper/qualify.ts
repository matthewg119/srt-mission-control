// Stage 2: keep or drop, with a written reason, BEFORE a penny of enrichment is spent.
//
// Matthew, 2026-09-17: "AI qualification against ICP → keep/drop + written reason (before enrichment
// this is where the money is) ... Qualifying before enriching kills roughly half the enrichment spend
// on companies we were always going to drop. That one reorder pays for the build."
//
// ‼️ THERE IS NO SKIP PATH, AND THAT IS THE WHOLE DESIGN. The state after the picker resolves to
// Workflow C is `qualifying`, unconditionally. A "just this once" bypass is how the reorder stops
// being true, and once one list has skipped it every later list has a precedent.
//
// ‼️ THE REASON IS NOT DECORATION, IT IS THE CHECKPOINT. A few thousand rows cut for ONE reason means
// the ICP is wrong, not that the list is bad, and that has to be visible before the money goes. So
// every verdict carries prose a person can read in bulk, grouped and counted the way junk.csv already
// reports its own drops.
//
// ‼️ A FAILED VERDICT IS `null`, NEVER `false`. The tri-state rule mx.ts already documents: a model
// that timed out has not judged the company, and recording that as a drop silently throws away rows
// nobody decided about. Unjudged rows are reported as unjudged and re-run.

import { callClaudeJSON } from "@/lib/claude-calls";

const MODEL = "claude-sonnet-4-6" as const;

/** Small enough that one bad row cannot cost the batch, big enough that the ICP is not re-sent per company. */
export const QUALIFY_CHUNK = 20;

export interface QualifyCandidate {
  id: string;
  businessName: string;
  domain: string | null;
  city: string | null;
  state: string | null;
  categories: string | null;
  primaryType: string | null;
  rating: number | null;
  reviewCount: number | null;
  instagramHandle: string | null;
}

export interface Verdict {
  id: string;
  /** null means the model did not judge it. Never coerce this to false. */
  keep: boolean | null;
  reason: string;
}

const SYSTEM = [
  "You are qualifying companies against an ideal customer profile, before anybody spends money",
  "enriching them. For each company return keep true or false and one short reason.",
  "",
  "RULES:",
  "1. Judge ONLY against the profile you are given. Not against whether the business looks good.",
  "2. The reason is read in bulk by a person looking for a pattern, so write the ACTUAL criterion",
  "   that decided it, in four to twelve words. 'not a fit' is useless. 'chain, not owner operated'",
  "   is the whole point.",
  "3. When the row does not say enough to judge, keep it and say what was missing. A cheap enrichment",
  "   on a maybe is better than dropping a company nobody looked at.",
  "4. Return a verdict for every id you were given, and invent no ids.",
  "5. Never use an em dash.",
].join("\n");

const SCHEMA_HINT = `{ "verdicts": [ { "id": "the id given", "keep": true, "reason": "why, in a few words" } ] }`;

function describe(c: QualifyCandidate): string {
  return [
    `id: ${c.id}`,
    `  name: ${c.businessName}`,
    c.domain ? `  website: ${c.domain}` : "  website: none found",
    c.city || c.state ? `  where: ${[c.city, c.state].filter(Boolean).join(", ")}` : "",
    c.categories ? `  categories: ${c.categories}` : "",
    c.primaryType ? `  google type: ${c.primaryType}` : "",
    c.reviewCount !== null ? `  reviews: ${c.reviewCount}${c.rating !== null ? ` at ${c.rating}` : ""}` : "",
    c.instagramHandle ? `  instagram: @${c.instagramHandle}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Every reason a batch of verdicts is unusable. Pure, for the probe. */
export function verdictFaults(raw: unknown, ids: readonly string[]): string[] {
  const faults: string[] = [];
  const v = raw as { verdicts?: unknown } | null;
  const list = Array.isArray(v?.verdicts) ? (v!.verdicts as Array<Record<string, unknown>>) : [];

  if (!list.length) return ["no verdicts were returned."];

  const given = new Set(ids);
  const seen = new Set<string>();

  for (const r of list) {
    const id = typeof r.id === "string" ? r.id : "";
    if (!id) faults.push("a verdict has no id.");
    else if (!given.has(id)) faults.push(`verdict names ${id}, which was not in the batch.`);
    else if (seen.has(id)) faults.push(`${id} is judged twice.`);
    else seen.add(id);

    if (typeof r.keep !== "boolean") faults.push(`${id || "a verdict"}: keep must be true or false.`);

    const reason = typeof r.reason === "string" ? r.reason.trim() : "";
    if (!reason) faults.push(`${id || "a verdict"}: a reason is required.`);
    else if (reason.length > 160) faults.push(`${id}: the reason is over 160 characters.`);
    else if (reason.includes("—")) faults.push(`${id}: the reason carries an em dash.`);
  }

  const missing = ids.filter((i) => !seen.has(i));
  if (missing.length) faults.push(`${missing.length} of ${ids.length} companies were not judged.`);

  return faults;
}

/**
 * Judge one chunk. Returns a verdict per input id, with `keep: null` for anything the model failed on.
 *
 * ‼️ IT RESOLVES RATHER THAN THROWS ON A MODEL FAILURE. A thrown chunk would abandon the nineteen
 * rows beside the one that confused it, and the caller cannot tell a model timeout from an empty
 * list. Unjudged comes back as unjudged and the caller re-runs it.
 */
export async function qualifyChunk(
  candidates: readonly QualifyCandidate[],
  icp: string
): Promise<Verdict[]> {
  const ids = candidates.map((c) => c.id);
  if (!ids.length) return [];

  const user = [
    "THE IDEAL CUSTOMER PROFILE:",
    icp.trim(),
    "",
    `THE COMPANIES, ${candidates.length} of them:`,
    ...candidates.map(describe),
  ].join("\n");

  try {
    const res = await callClaudeJSON<{ verdicts: Array<Record<string, unknown>> }>({
      model: MODEL,
      system: SYSTEM,
      user,
      maxTokens: 4000,
      // Low: this is a judgement against a written rule, not a creative act.
      temperature: 0.2,
      schemaHint: SCHEMA_HINT,
      validate: (v): v is { verdicts: Array<Record<string, unknown>> } => verdictFaults(v, ids).length === 0,
      describeInvalid: (v) => verdictFaults(v, ids).join(" "),
    });

    const byId = new Map(res.data.verdicts.map((r) => [String(r.id), r]));
    return ids.map((id) => {
      const r = byId.get(id);
      return r
        ? { id, keep: Boolean(r.keep), reason: String(r.reason).trim() }
        : { id, keep: null, reason: "the model did not return a verdict for this row" };
    });
  } catch (e) {
    return ids.map((id) => ({ id, keep: null, reason: `not judged: ${(e as Error).message}` }));
  }
}

export interface DropGroup {
  reason: string;
  count: number;
  examples: string[];
}

/**
 * Drop reasons, grouped and counted, which is the human checkpoint before any money is spent.
 *
 * ‼️ GROUPED ON A NORMALISED REASON, NOT ON THE VERBATIM STRING. The model writes "chain, not owner
 * operated" and "a chain rather than owner operated" for the same judgement, and a group-by on the
 * raw text would report two groups of one instead of one group of two, which is exactly the signal
 * this exists to surface.
 */
export function groupDrops(
  verdicts: ReadonlyArray<Verdict & { businessName?: string }>
): DropGroup[] {
  const groups = new Map<string, DropGroup>();

  for (const v of verdicts) {
    if (v.keep !== false) continue;
    const key = normalizeReason(v.reason);
    const g = groups.get(key) ?? { reason: v.reason, count: 0, examples: [] };
    g.count += 1;
    if (g.examples.length < 3 && v.businessName) g.examples.push(v.businessName);
    groups.set(key, g);
  }

  return [...groups.values()].sort((a, b) => b.count - a.count);
}

const REASON_STOPWORDS = new Set(["a", "an", "the", "is", "are", "not", "no", "rather", "than", "and", "or", "of", "it"]);

export function normalizeReason(reason: string): string {
  return reason
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !REASON_STOPWORDS.has(w))
    .sort()
    .join(" ");
}

/** The card a person reads before releasing the spend. */
export function dropReviewLines(args: {
  raw: number;
  kept: number;
  unjudged: number;
  groups: DropGroup[];
}): string[] {
  const dropped = args.raw - args.kept - args.unjudged;
  const lines = [
    `*Qualified against the ICP:* ${args.kept} kept of ${args.raw}, ${dropped} dropped.`,
    args.unjudged ? `:warning: ${args.unjudged} were not judged and will be re-run. They are not drops.` : "",
    "",
    "*Why they were dropped, most common first:*",
  ].filter(Boolean);

  for (const g of args.groups.slice(0, 12)) {
    lines.push(`  • ${g.count} x ${g.reason}${g.examples.length ? `  _${g.examples.join(", ")}_` : ""}`);
  }

  // ‼️ THE WHOLE REASON THIS CARD EXISTS, SAID ON THE CARD. Somebody scanning it needs to be told
  // what they are looking for, or they tick it because the numbers look plausible.
  const top = args.groups[0];
  if (top && dropped > 0 && top.count / dropped > 0.5) {
    lines.push("");
    lines.push(
      `:mag: *${Math.round((top.count / dropped) * 100)}% of the drops are one reason.* That usually means the ICP or the ` +
        "search is wrong rather than the list. Worth a look before the enrichment spend."
    );
  }

  lines.push("");
  lines.push("React :white_check_mark: to release the enrichment spend on the kept rows only.");
  return lines;
}
