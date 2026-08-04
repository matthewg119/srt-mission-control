// The niche intel brief: what owners in this trade are actually afraid of, in their own words.
//
// This is the research that makes a Loom sound like it was recorded by someone who knows the
// business, rather than by someone reading a scorecard. It is deliberately NOT about us: pains,
// horror stories, what they already tried and hated, what keeps them up, where the real money
// is, and what they will be afraid of when we ask for it.
//
// REDDIT FIRST, and enforced structurally rather than by asking nicely: `allowed_domains` on the
// server-side web_search tool means the model physically cannot cite a content-marketing blog
// written by an agency selling to this trade. Those rank well and say nothing true. `max_uses`
// caps the run at NICHE_BRIEF_MAX_SEARCHES so a brief cannot quietly cost ten minutes.
//
// HONESTY, inherited from the pipeline:
//   - VOZ is verbatim and carries its source link, or it does not ship. A quote we cannot point
//     at is a quote we invented.
//   - Numbers appear only when the thread contained them. No estimating a figure that sounds right.
//   - Horror stories are the MARKET's pattern ("we hear this every week"), never attributed to
//     the prospect. Telling someone their own story back, wrong, ends the call.
//
// Cached per niche on the same key and TTL as the avatars, because it changes on the same clock.

import { callClaudeJSON } from "@/lib/claude-calls";
import { supabaseAdmin } from "@/lib/db";
import { NICHE_BRIEF_MAX_SEARCHES, NICHE_BRIEF_TTL_DAYS } from "@/config/pitch";
import { nicheKeyFor } from "./niche-avatars";
import type { AuditReportRow } from "./types";

export interface Pain {
  /** How they say it, first person, 15 words or fewer. */
  says: string;
  /** One line on why it actually hurts. */
  whyItHurts: string;
}

export interface HorrorStory {
  /** Situation and figure, one or two lines. The figure only if the source had it. */
  story: string;
  /** Short verbatim line as the owner wrote it, 15 words or fewer. */
  voice: string;
  /** Where it came from. No link, no story. */
  source: string;
  /** Rewritten as a question, ready to open a Loom or an email with. */
  hook: string;
  /** Which belief it installs. Usually B3 (it's you, today) or B4 (different game). */
  installs: string;
}

export interface IntelBrief {
  pains: Pain[];
  horrorStories: HorrorStory[];
  /** What they do today to get customers, and what they hate about each channel. */
  channels: Array<{ channel: string; whatTheyHate: string }>;
  /** The questions they ask themselves at night, in their words. */
  nightQuestions: string[];
  /** The $100 bills: what they sell at the best margin, and what they wish they sold more of. */
  hundredDollarBills: Array<{ what: string; why: string }>;
  /** What they will be afraid of when we ask for the sale, and the line that disarms each. */
  objections: Array<{ fear: string; disarm: string }>;
}

export interface BriefResult {
  brief: IntelBrief;
  cached: boolean;
  nicheKey: string;
  ageDays: number;
}

function validate(p: unknown): p is IntelBrief {
  const o = p as IntelBrief;
  return (
    !!o &&
    Array.isArray(o.pains) &&
    o.pains.length >= 3 &&
    Array.isArray(o.horrorStories) &&
    Array.isArray(o.channels) &&
    Array.isArray(o.nightQuestions) &&
    Array.isArray(o.hundredDollarBills) &&
    Array.isArray(o.objections) &&
    o.objections.length >= 1
  );
}

export async function getIntelBrief(
  report: AuditReportRow,
  opts: { force?: boolean } = {}
): Promise<BriefResult> {
  const nicheKey = nicheKeyFor(report);

  if (nicheKey && !opts.force) {
    const { data } = await supabaseAdmin
      .from("niche_briefs")
      .select("brief, brief_created_at")
      .eq("niche_key", nicheKey)
      .maybeSingle();
    if (data?.brief && validate(data.brief) && data.brief_created_at) {
      const ageDays = Math.floor((Date.now() - new Date(data.brief_created_at as string).getTime()) / 86_400_000);
      if (ageDays < NICHE_BRIEF_TTL_DAYS) {
        return { brief: data.brief as IntelBrief, cached: true, nicheKey, ageDays };
      }
    }
  }

  const trade = report.business_type ?? "local service business";

  const { data: generated } = await callClaudeJSON<IntelBrief>({
    model: "claude-sonnet-4-6",
    // Anthropic runs this server-side. Restricting the domain is what keeps the research on
    // what owners say to each other rather than what agencies publish at them.
    tools: [
      {
        type: "web_search_20260209",
        name: "web_search",
        max_uses: NICHE_BRIEF_MAX_SEARCHES,
        allowed_domains: ["reddit.com"],
      },
    ],
    system: [
      `You research how owners of ${trade} businesses actually make and lose money, so a salesperson can talk to them like a peer.`,
      "",
      "Search Reddit for what these owners say to EACH OTHER. Useful shapes:",
      `"${trade} worst customers reddit", "${trade} most profitable jobs", "${trade} wasted money on marketing", "${trade} regret hiring agency", plus r/sweatystartup, r/smallbusiness and the trade's own subreddit.`,
      `You have at most ${NICHE_BRIEF_MAX_SEARCHES} searches. Spend them on owner conversations, not on advice articles.`,
      "",
      "Return:",
      "pains: 5. Each is how THEY say it, first person, 15 words or fewer, plus one line on why it actually hurts.",
      "horrorStories: 3 to 5. Each has: story (situation and figure, but ONLY a figure the source actually stated), voice (a SHORT VERBATIM line as the owner wrote it, 15 words max), source (the URL you found it at), hook (that story rewritten as a question you could open a video with), installs (which belief it plants).",
      "channels: what they do today to get customers, and what they hate about each one.",
      "nightQuestions: 5, in their words.",
      "hundredDollarBills: what they sell at the best margin and what they wish they sold more of.",
      "objections: 3 things they will be afraid of when asked to buy marketing help, each with the one line that disarms it honestly.",
      "",
      "HARD RULES:",
      "1. `voice` is VERBATIM and `source` is the real URL you read it at. If you cannot produce both, drop that horror story. Never write a quote you did not read.",
      "2. Never state a number the source did not state. No estimating, no 'typically around'.",
      "3. Paraphrase long stories down; only `voice` stays in their words.",
      "4. Write plainly. No marketing vocabulary, no 'pain points', no 'leverage'.",
      "Return JSON only.",
    ].join("\n"),
    user: [
      `Trade: ${trade}`,
      report.city ? `A prospect is in ${report.city}, but the brief is about the trade, not this one business.` : "",
      report.buyer_persona ? `Their customer, as classified: ${report.buyer_persona}` : "",
      "",
      "Research now and return the JSON.",
    ]
      .filter(Boolean)
      .join("\n"),
    maxTokens: 8000,
    temperature: 0.4,
    validate,
  });

  if (nicheKey) {
    try {
      const { data: existing } = await supabaseAdmin
        .from("niche_briefs")
        .select("id")
        .eq("niche_key", nicheKey)
        .maybeSingle();

      const row: Record<string, unknown> = {
        niche_key: nicheKey,
        business_type: report.business_type,
        brief: generated,
        brief_created_at: new Date().toISOString(),
      };
      // `avatars` is NOT NULL and a brief can be generated before the avatars for this niche
      // exist, so seed an empty set on first write. It fails getNicheAvatars' validate (which
      // requires three of each), which is exactly right: the next `avatars` call regenerates.
      if (!existing) row.avatars = { worst: [], best: [], pick: 1, pickWhy: "", isReposition: false };

      await supabaseAdmin.from("niche_briefs").upsert(row, { onConflict: "niche_key" });
    } catch (e) {
      // A cache miss is cheap; losing the brief we just paid for is not worth throwing over.
      console.error("[intel-brief] cache write failed:", (e as Error)?.message);
    }
  }

  return { brief: generated, cached: false, nicheKey: nicheKey ?? "(uncached)", ageDays: 0 };
}

/** The brief as a markdown file, which is how it gets into the thread without flooding it. */
export function formatBriefMarkdown(result: BriefResult, report: AuditReportRow): string {
  const b = result.brief;
  return [
    `# Intel brief — ${report.business_type ?? result.nicheKey}`,
    "",
    `_${result.cached ? `Reused, ${result.ageDays}d old` : "Fresh"}. Niche-level: reuse it for every ${report.business_type ?? "prospect"} in this vertical._`,
    "",
    "## A. What hurts (in their words)",
    ...b.pains.map((p) => `- **"${p.says}"** — ${p.whyItHurts}`),
    "",
    "## B. Horror stories",
    "_Market pattern, never the prospect's own story. Use as \"we hear this every week\"._",
    "",
    ...b.horrorStories.flatMap((h) => [
      `**${h.hook}**`,
      "",
      `- Story: ${h.story}`,
      `- Their words: "${h.voice}"`,
      `- Source: ${h.source}`,
      `- Installs: ${h.installs}`,
      "",
    ]),
    "## C. What they do today, and what they hate about it",
    ...b.channels.map((c) => `- **${c.channel}** — ${c.whatTheyHate}`),
    "",
    "## D. What they ask themselves at night",
    ...b.nightQuestions.map((q) => `- "${q}"`),
    "",
    "## E. The $100 bills",
    ...b.hundredDollarBills.map((x) => `- **${x.what}** — ${x.why}`),
    "",
    "## G. What they'll be afraid of, and what disarms it",
    ...b.objections.map((o) => `- **"${o.fear}"**\n  - ${o.disarm}`),
    "",
    "---",
    "_F (3 worst / 3 best / the pick) is the `avatars` command._",
  ].join("\n");
}
