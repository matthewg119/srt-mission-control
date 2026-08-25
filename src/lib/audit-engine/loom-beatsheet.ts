// What the recording is allowed to say, computed from one audit's real data.
//
// This file used to render a six-beat timing sheet in six-word bullets, on the theory that
// Matthew improvises better than he reads. He does not want to improvise. The script he reads
// out loud is now built by loom-script.ts, and what survives here is the part a script cannot
// carry: the 20 prompts exactly as they were run, and a PRE-FLIGHT list of the things that will
// cost him the call if he gets them wrong on camera.
//
// The single most valuable thing this file does is compute PROMPT_TRAMPA: the prompt where
// the business ranks BEST. The prospect will check that one himself right after the video, so
// opening with it kills the video, and ignoring it entirely makes the rest look like a setup.
// It is a concession, delivered early, and it has to be flagged before the recording starts.
//
// Everything here is derived from audit_runs and ReportView. Nothing is estimated. Where a
// fact does not exist (a rank that was never captured, an engine that never ran) the line is
// printed without it rather than filled in with something plausible.
//
// computeBeatSheetFacts() is exported separately from the rendering because loom-script.ts
// consumes the same facts. Running the pick logic twice would mean two Claude calls for the
// price tiers and, worse, two chances for the trampa in the PRE-FLIGHT list to disagree with
// the trampa in the script.

import { callClaudeJSON } from "@/lib/claude-calls";
import {
  BOOKING_LINK,
  FOUNDING_SPOTS,
  FREE_UNTIL_LINE,
  GUARANTEE_RESTATE,
  PRICE_RETAINER,
  QUALIFIED_INQUIRY_DEF,
} from "@/config/pitch";
import { buildAliases } from "./mention-match";
import { robotsVerdict, searchBotFindings, type RobotsVerdict } from "./robots-check";
import type { AuditReportRow, AuditRunRow } from "./types";
import type { ReportView, PromptRowView } from "./report-view";
import { displayName } from "./display-name";

const MODEL = "claude-sonnet-4-6" as const;

/** Engine ids as they read on camera. */
const ENGINE_LABELS: Record<string, string> = {
  openai: "ChatGPT",
  perplexity: "Perplexity",
};

/**
 * Which engines produced real data.
 *
 * ReportView cannot answer this: engineCell collapses "no run row" and "run failed" into the
 * same no_data cell. So it is computed from the raw rows, and an engine with zero ok rows did
 * not run, whatever the report layout implies. Naming an engine on camera that returned
 * nothing is the fastest way to lose a prospect who checks.
 */
export function enginesWithData(runs: AuditRunRow[]): string[] {
  const engines = [...new Set(runs.map((r) => r.engine))];
  return engines
    .filter((e) => runs.some((r) => r.engine === e && r.status === "ok"))
    .map((e) => ENGINE_LABELS[e] ?? e);
}

/**
 * Where the business sits in an engine's ordered answer, 1-based, or null.
 *
 * There is no rank column, and the order of `recommended[]` is incidental rather than
 * contractual, so index+1 there would be an invented fact. The genuinely ordered list only
 * exists in raw_response, so rank is re-derived by finding which named business appears first
 * in that text. Returns null whenever that cannot be established, and the caller then prints
 * the beat with no number at all.
 */
export function deriveRank(run: AuditRunRow | undefined, aliases: string[]): number | null {
  if (!run || run.status !== "ok" || !run.raw_response || !run.mentioned) return null;
  const text = run.raw_response;

  const names = run.recommended ?? [];
  if (names.length < 2) return null;

  // Order the named businesses by where each first appears in the response text.
  const positions = names
    .map((name) => ({ name, at: text.toLowerCase().indexOf(name.toLowerCase()) }))
    .filter((p) => p.at >= 0)
    .sort((a, b) => a.at - b.at);

  if (positions.length < 2) return null;

  const idx = positions.findIndex((p) =>
    aliases.some((a) => p.name.toLowerCase().includes(a.toLowerCase()))
  );
  return idx >= 0 ? idx + 1 : null;
}

export interface PromptPick {
  prompt: string;
  block: string;
  rank: number | null;
}

export interface BeatSheetFacts {
  company: string;
  score: number;
  appeared: number;
  total: number;
  engines: string[];
  topCompetitor: { name: string; count: number } | null;
  trampa: PromptPick | null;
  apertura: PromptPick | null;
  ticketAlto: PromptPick | null;
  pattern: string;
  patternIsInferred: boolean;
  siteFinding: string | null;
  siteScanned: boolean;
  worstBlock: { block: string; mentioned: number; total: number } | null;
  /** Which second-gap beat the robots result authorizes, if any. See robots-check.ts. */
  robotsVerdict: RobotsVerdict;
  /** The bot to point at on screen, e.g. "OAI-SearchBot". Null when there is nothing to show. */
  robotsBot: string | null;
  robotsEngine: string | null;
}

/** Buy-intent wording, strongest first. Used to rank candidate opening prompts. */
const INTENT_MARKERS = ["near me", "quote", "estimate", "free consult", "cost", "price", "best", "top"];

function intentScore(prompt: string): number {
  const p = prompt.toLowerCase();
  const hit = INTENT_MARKERS.findIndex((m) => p.includes(m));
  return hit === -1 ? 0 : INTENT_MARKERS.length - hit;
}

interface TierResult {
  /** Prompt text -> "recurring_cheap" | "onetime_expensive" | "neither" */
  tiers: Record<string, string>;
  /** One line naming the asymmetry, or the empty string when there is none. */
  pattern: string;
}

function isTierResult(v: unknown): v is TierResult {
  if (typeof v !== "object" || v === null) return false;
  const o = v as TierResult;
  return typeof o.tiers === "object" && o.tiers !== null && typeof o.pattern === "string";
}

/**
 * Classify the service prompts by price tier.
 *
 * This is the one part of the beat sheet that is a judgement rather than a measurement:
 * nothing in the pipeline records whether a prompt describes a cheap recurring service or an
 * expensive one-time job, only its block and its text. The caller labels the resulting line as
 * a read, not a finding, so nobody quotes it on camera as data.
 */
async function classifyPriceTiers(prompts: PromptRowView[], businessType: string): Promise<TierResult> {
  const servicePrompts = prompts.filter((p) => p.block === "SERVICIO" && !p.isBranded);
  if (servicePrompts.length < 4) return { tiers: {}, pattern: "" };

  try {
    const { data } = await callClaudeJSON<TierResult>({
      model: MODEL,
      system: [
        `You classify buyer search prompts for a ${businessType} by what the job is worth to the business.`,
        '"recurring_cheap" is low-ticket or repeat work. "onetime_expensive" is the high-ticket job. "neither" when the prompt is not about a specific service.',
        "Then say in ONE sentence whether the business appears where the work is cheap and disappears where the money is, or the reverse, or neither. Return an empty string for pattern if there is no clear asymmetry.",
        "Never overstate. An empty pattern is a correct answer.",
      ].join("\n"),
      user: servicePrompts
        .map((p) => `${p.appeared ? "APPEARS" : "ABSENT"} | ${p.prompt}`)
        .join("\n"),
      maxTokens: 900,
      temperature: 0.2,
      schemaHint: '{ "tiers": { "<prompt text>": "recurring_cheap" | "onetime_expensive" | "neither" }, "pattern": string }',
      validate: isTierResult,
    });
    return data;
  } catch (e) {
    console.error("[loom] price tier classification failed:", (e as Error).message);
    return { tiers: {}, pattern: "" };
  }
}

export interface FactsResult {
  facts: BeatSheetFacts | null;
  /** Why it refused, when it refused. */
  refusal: string | null;
}

/**
 * Everything the recording is allowed to claim, or a refusal.
 *
 * Refusal is a feature. A recording plan with a guessed competitor or a guessed engine is worse
 * than no plan, because it gets read aloud on camera to the person who can check it. Both the
 * PRE-FLIGHT card and the script are gated on this, so a refusal stops the whole wizard rather
 * than producing a script with holes in it.
 */
export async function computeBeatSheetFacts(
  report: AuditReportRow,
  view: ReportView,
  runs: AuditRunRow[]
): Promise<FactsResult> {
  const company = displayName(report);

  // isBranded is computed from aliases, and buildAliases falls back to business_type when
  // client_name is null. That fallback would flag every prompt containing the category phrase
  // as branded, so the branded labelling below cannot be trusted and we stop instead.
  if (!report.client_name) {
    return {
      facts: null,
      refusal: `I can't tell which prompts are branded for ${company}: this report has no business name stored, only a category, so every prompt mentioning the category would look branded. Re-run the audit or set the client name first.`,
    };
  }

  const engines = enginesWithData(runs);
  if (!engines.length) {
    return { facts: null, refusal: `No engine returned usable data for ${company}. There is nothing to record.` };
  }

  const answered = view.prompts.filter((p) => p.engines.openai.status === "ok");
  if (answered.length < view.totalPrompts) {
    return {
      facts: null,
      refusal: `Necesito el run completo de ${company} antes de generar el guion. Only ${answered.length} of ${view.totalPrompts} prompts came back with data.`,
    };
  }

  const aliases = buildAliases(report.client_name, report.website);
  const runsByPrompt = new Map<string, AuditRunRow[]>();
  for (const r of runs) {
    const list = runsByPrompt.get(r.prompt) ?? [];
    list.push(r);
    runsByPrompt.set(r.prompt, list);
  }

  const rankFor = (prompt: string): number | null => {
    const rs = runsByPrompt.get(prompt) ?? [];
    for (const r of rs) {
      const rank = deriveRank(r, aliases);
      if (rank !== null) return rank;
    }
    return null;
  };

  // PROMPT_TRAMPA: where they look best. Organic only, because a branded prompt returns them
  // for the trivial reason that it names them, and presenting that as a win is dishonest.
  const organicWins = view.prompts.filter((p) => p.appeared && !p.isBranded);
  const trampaRow = organicWins
    .map((p) => ({ p, rank: rankFor(p.prompt) }))
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))[0];
  const trampa: PromptPick | null = trampaRow
    ? { prompt: trampaRow.p.prompt, block: trampaRow.p.block, rank: trampaRow.rank }
    : null;

  const absent = view.prompts.filter((p) => !p.appeared && !p.isBranded);

  // PROMPT_APERTURA: highest buy intent among the ones they miss. SERVICIO first.
  const apertura = [...absent]
    .sort((a, b) => {
      const blockRank = (x: PromptRowView) => (x.block === "SERVICIO" ? 0 : x.block === "COMPARATIVO" ? 1 : 2);
      const byBlock = blockRank(a) - blockRank(b);
      return byBlock !== 0 ? byBlock : intentScore(b.prompt) - intentScore(a.prompt);
    })
    .map((p) => ({ prompt: p.prompt, block: p.block, rank: null }))[0] ?? null;

  const tiers = await classifyPriceTiers(view.prompts, report.business_type || "local business");

  const ticketAlto =
    absent
      .filter((p) => tiers.tiers[p.prompt] === "onetime_expensive")
      .map((p) => ({ prompt: p.prompt, block: p.block, rank: null }))[0] ??
    absent.filter((p) => p.prompt !== apertura?.prompt).map((p) => ({ prompt: p.prompt, block: p.block, rank: null }))[0] ??
    null;

  const worstBlock =
    [...view.blockStats]
      .filter((b) => b.total > 0)
      .sort((a, b) => a.mentioned / a.total - b.mentioned / b.total)[0] ?? null;

  const patternIsInferred = Boolean(tiers.pattern);
  const pattern =
    tiers.pattern ||
    (worstBlock
      ? `weakest category is ${worstBlock.block.toLowerCase()}, ${worstBlock.mentioned} of ${worstBlock.total}`
      : "no clear asymmetry");

  // site_signals: [] means the scan ran and found nothing, null means it never ran. Those are
  // different answers and must not read the same on camera.
  const siteScanned = Array.isArray(report.site_signals);
  const siteFinding = siteScanned && report.site_signals?.length ? report.site_signals[0].detail : null;

  // The second gap has two possible sources and they are not equal. A blocked SEARCH crawler is
  // the devastating version (they are locked out of the answers being given today); a blocked
  // TRAINING crawler is a much smaller, precise point that must say "training" out loud. Neither
  // exists on most sites, in which case the site scan supplies the beat, and if that is clean too
  // the beat is CUT rather than filled with something invented.
  const robots = report.robots_check ?? null;
  const verdict = robotsVerdict(robots);
  const robotsFinding = verdict === "none" ? null : searchBotFindings(robots)[0] ?? robots?.[0] ?? null;

  const facts: BeatSheetFacts = {
    company,
    score: report.score ?? 0,
    appeared: view.totalMentioned,
    total: view.totalPrompts,
    engines,
    topCompetitor: view.mostRecommended[0] ?? null,
    trampa,
    apertura,
    ticketAlto,
    pattern,
    patternIsInferred,
    siteFinding,
    siteScanned,
    worstBlock,
    robotsVerdict: verdict,
    robotsBot: robotsFinding?.bot ?? null,
    robotsEngine: robotsFinding?.engine ?? null,
  };

  return { facts, refusal: null };
}

/**
 * The two blocks that go in Slack: the prompts to paste, and the things not to get wrong.
 *
 * The script itself is a separate artifact (loom-script.ts) and is uploaded as a file, because a
 * page of prose read off a Slack message scrolls while you are talking.
 */
export function renderPreflight(view: ReportView, f: BeatSheetFacts, price?: string | null): string {
  const promptList = view.prompts.map((p) => p.prompt).join("\n\n");

  const shortPrompt = (p: PromptPick | null): string => {
    if (!p) return "(none available)";
    const t = p.prompt.length > 70 ? `${p.prompt.slice(0, 67)}...` : p.prompt;
    return p.rank ? `${t}  [#${p.rank}]` : t;
  };

  const block1 = [
    `*THE 20 PROMPTS* · paste straight into a temporary chat`,
    "```",
    promptList,
    "```",
    `Run in a temporary chat or a logged-out session.`,
    `Engines that actually returned data on this run: ${f.engines.join(", ")}.`,
    `If the screen disagrees with the PDF, narrate the screen.`,
  ].join("\n");

  const brandedCount = view.prompts.filter((p) => p.isBranded).length;

  // ‼️ THE COMMITMENTS GO ON THE CHECKLIST BECAUSE THEY ARE THE THINGS HERE THAT CANNOT BE FIXED
  // AFTER THE FACT. Every other item costs a re-record at worst. A guarantee and a free period said
  // on camera outlive the video, and the person about to read them out is the only one who knows
  // whether we will actually do the work behind them.
  //
  // The tier branch that used to live here is gone with the tiers (2026-08-25). There is one offer,
  // so there is nothing to choose and nothing to withhold — but the two commitments still get
  // called out one at a time, because "the offer" is not a thing anybody double-checks and
  // "we are promising 5 queries by day 30" is.
  const commitmentItems = [
    `[ ] Selling ${price ?? PRICE_RETAINER}, free until the first 5 qualified AI-sourced inquiries`,
    `[ ] :rotating_light: THIS RECORDING PROMISES: ${GUARANTEE_RESTATE}`,
    `[ ] :rotating_light: AND IT PROMISES: ${FREE_UNTIL_LINE}`,
    QUALIFIED_INQUIRY_DEF
      ? `[ ] "Qualified AI-sourced inquiry" means: ${QUALIFIED_INQUIRY_DEF}`
      : `[ ] NO DEFINITION OF "QUALIFIED AI-SOURCED INQUIRY" IS SET. That phrase starts the billing. Be ready to define it on the call`,
    `[ ] Founding cohort is ${FOUNDING_SPOTS} seats. Only say that while it is still true`,
  ];

  const preflight = [
    `*PRE-FLIGHT* · the things that cost you the call if you get them wrong`,
    ...commitmentItems,
    `[ ] Temporary chat visible on screen`,
    f.trampa
      ? `[ ] DO NOT OPEN WITH: ${shortPrompt(f.trampa)}`
      : `[ ] No organic win exists, do not imply one`,
    `[ ] Engines to name out loud: ${f.engines.join(", ")}`,
    brandedCount ? `[ ] ${brandedCount} branded prompts, they do not count as wins` : null,
    `[ ] Dream-lead image pasted and on screen for the open`,
    `[ ] PDF open in a tab`,
    // The close sends them to the onboarding call, so the link has to exist and has to be on
    // screen. With none configured this is not a checklist item, it is a correction: the script
    // prints the same warning, because a promised link that does not exist is discovered by the
    // prospect, after the recording, when nothing can be done about it.
    //
    // It was PAYMENT_LINK until 2026-08-25. Nothing is charged up front under the new offer, so a
    // checkout page open in a tab would contradict the free period the video just promised.
    BOOKING_LINK
      ? `[ ] Booking page open in a tab: ${BOOKING_LINK}`
      : `[ ] NO BOOKING LINK SET (SRT_ONBOARDING_CALL_URL). Do not say "the link to book the onboarding call"`,
    f.robotsVerdict === "soft"
      ? `[ ] robots.txt blocks ${f.robotsBot}, TRAINING only. Do NOT say "your site blocks ${f.robotsEngine}"`
      : null,
    // The site beat is no longer in the script, which was a length decision, not a decision that
    // these stopped mattering. A blocked search crawler is the strongest finding some audits
    // produce, so it is offered here rather than dropped: his call whether to say it on camera.
    f.robotsVerdict === "devastating" && f.robotsBot
      ? `[ ] OFF SCRIPT, worth saying: their robots.txt blocks ${f.robotsBot}, the crawler ${f.robotsEngine ?? "the engine"} reads pages with`
      : f.siteFinding
        ? `[ ] OFF SCRIPT, worth saying: ${f.siteFinding}`
        : null,
    f.patternIsInferred ? `[ ] The pattern line is a read, not a measured finding` : null,
    `[ ] The image is the TARGET, never a lead that already arrived`,
  ]
    .filter(Boolean)
    .join("\n");

  return [block1, "", preflight].join("\n");
}
