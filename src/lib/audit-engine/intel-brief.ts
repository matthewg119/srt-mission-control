// The niche intel brief: what owners in this trade are actually afraid of, in their own words.
//
// This is the research that makes a Loom sound like it was recorded by someone who knows the
// business, rather than by someone reading a scorecard. It is deliberately NOT about us: pains,
// horror stories, what they already tried and hated, what keeps them up, where the real money
// is, and what they will be afraid of when we ask for it.
//
// OWNER TALK FIRST, and this used to be enforced structurally rather than by asking nicely:
// `allowed_domains: ["reddit.com"]` meant the model physically could not cite a content-marketing
// blog written by an agency selling to this trade. Those rank well and say nothing true.
//
// THAT IS NO LONGER POSSIBLE, and the reason matters before anyone puts it back. Reddit blocks
// Anthropic's crawler, so the allowlist is now rejected at request validation:
//   Anthropic API error (400): The following domains are not accessible to our user agent:
//   ['reddit.com']
// It is not a transient error, nothing retries it, and every `brief` failed outright. So the
// guarantee inverted: search broadly, block the worst offenders (BRIEF_BLOCKED_DOMAINS), and keep
// steering toward owner-to-owner talk in the prompt. A blocklist is genuinely weaker than an
// allowlist, which is why `sourceDomains()` reports what it actually read and the Slack card prints
// it: a brief built from trade press must never be mistaken for one built from owners talking.
//
// `max_uses` caps the run at NICHE_BRIEF_MAX_SEARCHES so a brief cannot quietly cost ten minutes.
//
// HONESTY, inherited from the pipeline:
//   - VOZ is verbatim and carries its source link, or it does not ship. A quote we cannot point
//     at is a quote we invented.
//   - Numbers appear only when the thread contained them. No estimating a figure that sounds right.
//   - Horror stories are the MARKET's pattern ("we hear this every week"), never attributed to
//     the prospect. Telling someone their own story back, wrong, ends the call.
//
// Cached per niche on the same key and TTL as the avatars, because it changes on the same clock.

import { callClaudeJSON, camelizeKeys } from "@/lib/claude-calls";
import { supabaseAdmin } from "@/lib/db";
import { BRIEF_BLOCKED_DOMAINS, NICHE_BRIEF_MAX_SEARCHES, NICHE_BRIEF_TTL_DAYS } from "@/config/pitch";
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

/**
 * The domains this brief actually read, from the URLs it was required to cite.
 *
 * Derived from `horrorStories[].source` rather than plumbed out of the web_search tool-result
 * blocks, because those are the sources that ended up in the brief. A search the model ran and
 * discarded is not what anyone needs to see; a quote's origin is.
 *
 * This exists because the Reddit allowlist is gone. When the source rule was structural nobody had
 * to check it. Now it is a filter, so it has to be visible.
 */
export function sourceDomains(brief: IntelBrief): string[] {
  const hosts = new Set<string>();
  for (const h of brief.horrorStories ?? []) {
    if (!h?.source) continue;
    try {
      hosts.add(new URL(h.source.trim()).hostname.replace(/^www\./, ""));
    } catch {
      // A source that is not a URL is not a source we can name. The HARD RULES already say a
      // horror story without a real link should have been dropped; do not invent a domain for it.
    }
  }
  return [...hosts];
}

/**
 * Repair the two ways this generator drifts, because it gets NO second chance.
 *
 * `callClaudeJSON`'s correction retry is skipped for tool-using calls (replaying the search-result
 * blocks would be malformed, and it would re-run every search), so `coerce` is the only defence
 * this brief has. Both drifts below are real, from one run whose CONTENT was good:
 *
 *  1. Full snake_case. `why_it_hurts`, and therefore `horror_stories` / `night_questions` /
 *     `hundred_dollar_bills`, none of which are the arrays validate looks for.
 *  2. `pains[].statement` instead of `pains[].says`. Not a casing problem, a synonym, and
 *     camelizing does not touch it. It survives validate (which never checks inside pains) and
 *     then prints as "undefined" in the markdown, which is worse than failing.
 */
function coerceBrief(p: unknown): unknown {
  const o = camelizeKeys(p) as Record<string, unknown>;
  if (!o || typeof o !== "object") return o;
  if (Array.isArray(o.pains)) {
    o.pains = o.pains.map((raw) => {
      const pain = raw as Record<string, unknown>;
      return { ...pain, says: pain.says ?? pain.statement ?? pain.quote ?? pain.pain };
    });
  }
  return o;
}

function validate(p: unknown): p is IntelBrief {
  const o = p as IntelBrief;
  return (
    !!o &&
    Array.isArray(o.pains) &&
    o.pains.length >= 3 &&
    o.pains.every((x) => typeof x?.says === "string" && x.says.length > 0) &&
    Array.isArray(o.horrorStories) &&
    Array.isArray(o.channels) &&
    Array.isArray(o.nightQuestions) &&
    Array.isArray(o.hundredDollarBills) &&
    Array.isArray(o.objections) &&
    o.objections.length >= 1
  );
}

/** Which check failed, in words. See the same helper in niche-avatars.ts for why. */
function describeInvalid(p: unknown): string {
  if (!p || typeof p !== "object") return "the response was not a JSON object";
  const o = p as Partial<IntelBrief>;
  const missing = (["pains", "horrorStories", "channels", "nightQuestions", "hundredDollarBills", "objections"] as const)
    .filter((k) => !Array.isArray(o[k]))
    .map((k) => `${k} was missing or not an array`);
  if (Array.isArray(o.pains) && o.pains.length < 3) missing.push(`pains had ${o.pains.length} entries, expected at least 3`);
  if (Array.isArray(o.pains) && !o.pains.every((x) => typeof x?.says === "string" && x.says.length > 0)) {
    missing.push("every entry in pains needs a non-empty `says`, the owner's own words");
  }
  if (Array.isArray(o.objections) && o.objections.length < 1) missing.push("objections was empty, expected at least 1");
  return missing.join("; ") || "it did not match the required shape";
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
        // Not allowed_domains — see the header. Reddit is unreachable to this crawler, and an
        // allowlist containing it 400s the whole request.
        blocked_domains: BRIEF_BLOCKED_DOMAINS,
      },
    ],
    system: [
      `You research how owners of ${trade} businesses actually make and lose money, so a salesperson can talk to them like a peer.`,
      "",
      "Search for what these owners say to EACH OTHER, not what is written at them. Forums, trade boards, Q&A threads, industry association discussions and trade-press interviews where an owner is quoted directly. Useful shapes:",
      `"${trade} worst customers forum", "${trade} most profitable jobs", "${trade} wasted money on marketing", "${trade} regret hiring agency", plus the trade's own association and forum sites.`,
      `You have at most ${NICHE_BRIEF_MAX_SEARCHES} searches. Spend them on owner conversations, not on advice articles.`,
      "An article written by a software or marketing company selling to this trade is NOT a source, whatever it ranks for. If a search only returns those, say so by returning fewer horror stories rather than quoting one.",
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
    // camelCase, spelled out, in the SYSTEM prompt. The prose above names the fields but a model
    // that has just read eight web pages drifts, and there is no correction retry to catch it.
    schemaHint:
      '{ "pains": [{ "says": string, "whyItHurts": string }], ' +
      '"horrorStories": [{ "story": string, "voice": string, "source": string, "hook": string, "installs": string }], ' +
      '"channels": [{ "channel": string, "whatTheyHate": string }], ' +
      '"nightQuestions": [string], ' +
      '"hundredDollarBills": [{ "what": string, "why": string }], ' +
      '"objections": [{ "fear": string, "disarm": string }] } ' +
      "— every key is camelCase exactly as written, never snake_case.",
    coerce: coerceBrief,
    describeInvalid,
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
