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

import { callClaudeJSON } from "@/lib/claude-calls";
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
      "PICK one of the three best and say why in two or three sentences. Prefer recurring revenue. If the pick would move this business into work it does not currently present itself as doing, set is_reposition true and say so plainly, because the reposition is the whole pitch angle.",
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
