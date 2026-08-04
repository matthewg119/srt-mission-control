// Three worst customers, three best, and the pick — per NICHE, not per prospect.
//
// The selling premise this implements (MASTER_PROMPT.md step 3): the owner is not buying AI
// visibility, they are buying a specific customer they wish they had more of. So the pitch names
// ONE dream buyer and points everything at them. Naming the three customers that quietly lose
// them money first is what earns the right to name the good one, because it proves we understand
// their P&L rather than their marketing.
//
// WHY IT IS CACHED PER NICHE: the avatars for two landscapers are the same avatars. Only the
// scorecard changes. Caching by vertical means prospect #2 in a niche costs nothing and the
// whole pitch drops to a couple of minutes, which is the difference between this being a tool
// and being a weekly project.
//
// Picking rules, in order: recurring contracts beat big one-time jobs, and big one-time jobs beat
// volume. "More customers" is never the pick, because it is not an idea the owner hasn't already
// had. A strategic reposition (residential -> commercial contracts, cleanings -> implants) IS
// allowed to be the pick, and when it is, the reposition is the pitch angle.

import { callClaudeJSON, camelizeKeys } from "@/lib/claude-calls";
import { supabaseAdmin } from "@/lib/db";
import { NICHE_BRIEF_TTL_DAYS } from "@/config/pitch";
import type { AuditReportRow } from "./types";
import type { ReportView } from "./report-view";

export interface WorstCustomer {
  /** Memorable and specific, e.g. "the $45 one-time mow shopper". */
  label: string;
  /** Margin, time, payment or stress. One line. */
  whyItHurts: string;
  /** What is actually left after costs. One line. */
  economics: string;
  /** Paraphrased owner sentiment. Never a verbatim quote from a real thread. */
  ownersSay: string;
}

export interface BestAvatar {
  label: string;
  /** Job value and how often it recurs. */
  ticket: string;
  /** Why it is high return for low effort: margin, predictability, one decision maker. */
  whyHighRoi: string;
  /** The exact question this buyer types into an AI engine. This becomes the image's hook line. */
  aiQuestion: string;
}

export interface NicheAvatars {
  worst: WorstCustomer[];
  best: BestAvatar[];
  /** 1-based index into `best`. */
  pick: number;
  pickWhy: string;
  /** True when the pick moves them into a different kind of work than they present today. */
  isReposition: boolean;
}

export interface AvatarsResult {
  avatars: NicheAvatars;
  /** True when this came from cache rather than a fresh generation. */
  cached: boolean;
  nicheKey: string;
  ageDays: number;
}

/** The cache key. Falls back to business_type so a report with no vertical still caches. */
export function nicheKeyFor(report: Pick<AuditReportRow, "vertical_slug" | "business_type">): string | null {
  const key = (report.vertical_slug || report.business_type || "").trim().toLowerCase();
  return key || null;
}

function isFresh(createdAt: string): { fresh: boolean; ageDays: number } {
  const ageMs = Date.now() - new Date(createdAt).getTime();
  const ageDays = Math.floor(ageMs / 86_400_000);
  return { fresh: ageDays < NICHE_BRIEF_TTL_DAYS, ageDays };
}

/**
 * The one repairable near-miss, and why it is worth repairing.
 *
 * `pick` is documented as 1-based and consumed as `best[pick - 1]`, but the model returns a
 * ZERO-based index often enough that it took out two live prospects in a row: a fully correct set
 * (3 worst, 3 best, right keys, not truncated) was thrown away because one field read 0. A 0 has
 * exactly one sensible reading, the first item, so it is mapped rather than rejected.
 *
 * Anything still outside 1..3 is left alone to fail. Clamping a 7 would silently pick a customer
 * the model did not choose, and `pickWhy` would then describe someone else.
 */
function coerceAvatars(p: unknown): unknown {
  // camelizeKeys first: this generator has not drifted into snake_case yet, but the intel brief
  // did on a run whose content was fine, and the two share a prompt style.
  const o = camelizeKeys(p) as Record<string, unknown>;
  if (!o || typeof o !== "object") return o;
  const n = typeof o.pick === "string" ? Number(o.pick.trim()) : o.pick;
  if (typeof n === "number" && Number.isFinite(n)) o.pick = n === 0 ? 1 : n;
  return o;
}

function validate(p: unknown): p is NicheAvatars {
  const o = p as NicheAvatars;
  return (
    !!o &&
    Array.isArray(o.worst) &&
    o.worst.length === 3 &&
    Array.isArray(o.best) &&
    o.best.length === 3 &&
    typeof o.pick === "number" &&
    o.pick >= 1 &&
    o.pick <= 3 &&
    o.best.every((b) => typeof b?.aiQuestion === "string" && b.aiQuestion.length > 0)
  );
}

/**
 * Which check failed, in words.
 *
 * Fed back to the model on the correction retry, and printed in Slack instead of the first 500
 * characters of raw JSON. That excerpt is what made the `pick: 0` failure undiagnosable: the
 * broken field was 4,000 characters in, so the error showed nothing but correct output.
 */
function describeInvalid(p: unknown): string {
  if (!p || typeof p !== "object") return "the response was not a JSON object";
  const o = p as Partial<NicheAvatars>;
  const problems: string[] = [];
  if (!Array.isArray(o.worst)) problems.push("worst was missing or not an array");
  else if (o.worst.length !== 3) problems.push(`worst had ${o.worst.length} entries, expected exactly 3`);
  if (!Array.isArray(o.best)) problems.push("best was missing or not an array");
  else if (o.best.length !== 3) problems.push(`best had ${o.best.length} entries, expected exactly 3`);
  if (typeof o.pick !== "number") problems.push(`pick was ${JSON.stringify(o.pick)}, expected the number 1, 2 or 3`);
  else if (o.pick < 1 || o.pick > 3) problems.push(`pick was ${o.pick}, expected 1, 2 or 3 counting from 1`);
  if (Array.isArray(o.best) && !o.best.every((b) => typeof b?.aiQuestion === "string" && b.aiQuestion.length > 0)) {
    problems.push("every entry in best needs a non-empty aiQuestion");
  }
  return problems.join("; ") || "it did not match the required shape";
}

/**
 * Get the niche's avatars, from cache when one is less than NICHE_BRIEF_TTL_DAYS old.
 *
 * `force` regenerates and overwrites, for when a cached set reads wrong for a vertical that
 * turned out to be broader than its slug suggested.
 */
export async function getNicheAvatars(
  report: AuditReportRow,
  view: ReportView,
  opts: { force?: boolean } = {}
): Promise<AvatarsResult> {
  const nicheKey = nicheKeyFor(report);

  if (nicheKey && !opts.force) {
    const { data } = await supabaseAdmin
      .from("niche_briefs")
      .select("avatars, created_at")
      .eq("niche_key", nicheKey)
      .maybeSingle();
    if (data?.avatars && validate(data.avatars)) {
      const { fresh, ageDays } = isFresh(data.created_at as string);
      if (fresh) return { avatars: data.avatars as NicheAvatars, cached: true, nicheKey, ageDays };
    }
  }

  // The money questions they are missing are the strongest evidence of which good customer is
  // currently going elsewhere, so they seed the generation rather than being an afterthought.
  const absent = view.prompts
    .filter((p) => !p.appeared && !p.isBranded && (p.block === "SERVICIO" || p.block === "COMPARATIVO"))
    .map((p) => p.prompt)
    .slice(0, 10);

  const { data: generated } = await callClaudeJSON<NicheAvatars>({
    model: "claude-sonnet-4-6",
    system: [
      "You analyse how owners in a trade actually make and lose money, for a sales pitch.",
      "",
      "Return THREE worst customers and THREE best customers for this niche, then pick one of the best.",
      "",
      "WORST: the customers that quietly lose the owner money. Judge on margin after real costs, time lost, payment behaviour and stress. Give each a memorable label the owner would recognise instantly, one line on why it hurts, one line on the actual economics, and one line of paraphrased owner sentiment. Paraphrase that sentiment, never present it as a quote.",
      "",
      "BEST: judge on HIGHEST return for LOWEST effort, in this order: recurring contracts beat big one-time jobs, and big one-time jobs beat volume. For each give the label, the ticket and how often it recurs, why it is high return for low effort (margin, predictability, one decision maker meaning many jobs), and the exact question that buyer types into an AI engine.",
      "",
      "PICK one of the three best and say why in two or three sentences. Prefer recurring revenue. If the pick would move this business into work it does not currently present itself as doing, set isReposition true and say so plainly, because the reposition is the whole pitch angle.",
      "",
      'IMPORTANT: `pick` counts from 1. The first entry in `best` is 1, the second is 2, the third is 3. It is NOT a zero-based array index, so 0 is never a valid answer.',
      "",
      "NEVER pick 'more customers', 'more leads' or 'more visibility'. That is not an idea the owner has not already had.",
      "Be concrete about this trade. Generic advice that would fit any business is a failed answer.",
      "Return JSON only.",
    ].join("\n"),
    user: [
      `Trade: ${report.business_type ?? "unknown"}`,
      `Their buyer, as classified: ${report.buyer_persona ?? "unknown"}`,
      report.city ? `Market: ${report.city}` : "",
      "",
      absent.length
        ? `Buyer questions this business does NOT appear in. These are buyers going to a competitor right now:\n${absent.map((q) => `- ${q}`).join("\n")}`
        : "",
      "",
      'Return {"worst":[{"label","whyItHurts","economics","ownersSay"}],"best":[{"label","ticket","whyHighRoi","aiQuestion"}],"pick":1,"pickWhy":"...","isReposition":false}',
    ]
      .filter(Boolean)
      .join("\n"),
    maxTokens: 2600,
    temperature: 0.6,
    // The shape belongs in the SYSTEM prompt, which is what schemaHint does. It used to appear
    // only on the last line of the user message, the weakest place to state a contract.
    schemaHint:
      '{ "worst": [{ "label": string, "whyItHurts": string, "economics": string, "ownersSay": string }] (exactly 3), ' +
      '"best": [{ "label": string, "ticket": string, "whyHighRoi": string, "aiQuestion": string }] (exactly 3), ' +
      '"pick": 1 | 2 | 3 (counts from 1, NOT a zero-based index), "pickWhy": string, "isReposition": boolean }',
    coerce: coerceAvatars,
    describeInvalid,
    validate,
  });

  if (nicheKey) {
    // Upsert rather than insert: a forced regeneration replaces the stale set instead of racing
    // the unique index and failing.
    await supabaseAdmin
      .from("niche_briefs")
      .upsert(
        {
          niche_key: nicheKey,
          business_type: report.business_type,
          avatars: generated,
          created_at: new Date().toISOString(),
        },
        { onConflict: "niche_key" }
      )
      .then(
        () => undefined,
        (e: unknown) => console.error("[niche-avatars] cache write failed:", (e as Error)?.message)
      );
  }

  return { avatars: generated, cached: false, nicheKey: nicheKey ?? "(uncached)", ageDays: 0 };
}

/**
 * The Slack card. Worst first: it is what earns the right to name the good one.
 *
 * `footer` is overridden by the `loom` wizard, where the same card is a question rather than a
 * reference: there the three best customers are a menu and the reply picks one, so telling the
 * reader to run `image 2` would be pointing at the wrong command.
 */
export function formatAvatarsCard(result: AvatarsResult, report: AuditReportRow, footer?: string): string {
  const a = result.avatars;
  const pick = a.best[a.pick - 1];
  const provenance = result.cached
    ? `_Reused the ${result.nicheKey} set from ${result.ageDays === 0 ? "today" : `${result.ageDays}d ago`}. Reply \`avatars fresh\` to regenerate._`
    : `_Fresh for ${result.nicheKey}. Cached for ${NICHE_BRIEF_TTL_DAYS} days, so the next ${report.business_type ?? "prospect"} in this niche is instant._`;

  return [
    `:busts_in_silhouette: *Avatars · ${report.business_type ?? "this niche"}*`,
    provenance,
    "",
    "*The 3 customers quietly costing them money*",
    ...a.worst.map((w, i) => `${i + 1}. *${w.label}* — ${w.whyItHurts}\n    _${w.economics}_\n    Owners say: ${w.ownersSay}`),
    "",
    "*The 3 worth chasing*",
    ...a.best.map((b, i) => {
      const star = i + 1 === a.pick ? " :star:" : "";
      return `${i + 1}. *${b.label}*${star} — ${b.ticket}\n    ${b.whyHighRoi}\n    Asks AI: _"${b.aiQuestion}"_`;
    }),
    "",
    `:dart: *The pick: #${a.pick}, ${pick.label}*${a.isReposition ? "  ·  *reposition*" : ""}`,
    a.pickWhy,
    a.isReposition
      ? "_This moves them into work they don't currently present as doing. That reposition IS the pitch angle: it lands as an idea, not a service._"
      : "",
    "",
    footer ?? "`image` builds the dream-lead picture for the pick · `image 2` / `image 3` for another one.",
  ]
    .filter((l) => l !== "")
    .join("\n");
}
