// Delivery step 10, the half that used to be a person's job.
//
// ─── WHAT THIS REPLACED, AND WHY ─────────────────────────────────────────────
//
// Until 2026-08-27 this step emitted `deep-research-brief.txt`: three Spanish messages somebody
// pasted into ChatGPT one at a time. Message 2 pasted two first-person teaching transcripts
// ("yo abro varios resultados en pestañas nuevas", "entro al hilo y empiezo a copiar y pegar")
// and message 3 then asked the model to WRITE A PROMPT.
//
// Matthew's read of it, and he is right: that is training material for a human, not instructions
// for a model. It had no role, no explicit task and no output format, and the avatar — the whole
// point of the step — was buried in prose instead of being an input. A model handed it summarises
// the methodology back at you. It was also two indirections from the deliverable: a prompt that
// writes a prompt that a person runs.
//
// So the step runs the research itself now and files a PDF. The eight sections below are HIS
// output spec, in his order, and the anti-fabrication rule in SYSTEM is his too.
//
// ─── THE MODEL IS HAIKU BECAUSE HE ASKED FOR HAIKU ───────────────────────────
//
// Stated at the time and worth keeping stated: Haiku 4.5 does NOT support `web_search_20260209`,
// the tool version claude-research.ts and intel-brief.ts use. It gets `web_search_20250305`, the
// basic variant, which format-generator.ts already runs. Expect thinner sourcing than a Sonnet
// run would give. The two constants below are the whole swap if that turns out to matter.
//
// ─── PARALLEL IS THE DESIGN, NOT AN OPTIMISATION ─────────────────────────────
//
// This runs inside the step cascade against a 300s maxDuration and there is no queue in this repo
// (no QStash, no Inngest — waitUntil and cron, and audit/process's header records what happened
// the last time somebody tried to self-chain across invocations). Eight sequential web-search
// calls do not finish. Run in parallel, wall clock is the slowest single section rather than the
// sum, and the whole thing lands in ~2 minutes.
//
// ─── A SECTION THAT FAILED SAYS SO ───────────────────────────────────────────
//
// Every failure mode here — timeout, API error, a truncated tool loop — renders as a stated stub
// in the report. Never a silent gap, never filler. Same rule formatHarvestSummary follows when it
// says out loud that Reddit was not read: a research document whose holes are invisible is worse
// than one with fewer sections, because somebody builds pages off it.

import { supabaseAdmin } from "@/lib/db";
import { callClaudeText, type ClaudeModel } from "@/lib/claude-calls";
import * as pdf from "@/lib/pdf/kit";
import { deliverArtifact } from "./deliver";

// ─────────────────────────────────────────────────────────────────────────────
// The swap points
// ─────────────────────────────────────────────────────────────────────────────

/** Matthew's call, 2026-08-27. Swap to "claude-sonnet-4-6" and the tool below together. */
const RESEARCH_MODEL: ClaudeModel = "claude-haiku-4-5-20251001";

/**
 * ‼️ PAIRED WITH THE MODEL ABOVE. `web_search_20250305` is the only version Haiku accepts;
 * `web_search_20260209` (dynamic filtering) needs Sonnet 4.6 or better and 400s on Haiku. Moving
 * one of these two constants without the other breaks every section at once.
 */
const WEB_SEARCH_TOOL_VERSION = "web_search_20250305";

/** Searches a section gets unless its spec asks for more. */
const DEFAULT_SEARCHES = 5;

const searchTool = (maxUses: number) => ({
  type: WEB_SEARCH_TOOL_VERSION,
  name: "web_search",
  max_uses: maxUses,
});

/**
 * Per-section wall clock. Eight of these run at once, so this is roughly the whole run's budget
 * rather than a slice of it, and it has to leave room inside 300s for the ranking call, the PDF
 * and the Slack round trip.
 */
const SECTION_TIMEOUT_MS = 100_000;

/** The ranking pass carries eight sections of prose in and 25 lines out. */
const RANK_TIMEOUT_MS = 60_000;
const RANK_MAX_TOKENS = 4000;
const SECTION_MAX_TOKENS = 3000;

// ─────────────────────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────────────────────

export interface ResearchContext {
  clinicName: string;
  city: string | null;
  state: string | null;
  /** The confirmed avatar's label. This is what every section prompt is aimed at. */
  avatarLabel: string;
  avatarSlug: string;
  vertical: string;
  /** The prose one ("AI visibility (AEO) marketing agency for local businesses"), not the slug. */
  trade: string | null;
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

const NOT_RECORDED = "not recorded";

function val(v: string | null | undefined): string {
  const s = (v ?? "").trim();
  return s.length > 0 ? s : NOT_RECORDED;
}

function list(items: string[], empty: string): string {
  return items.length > 0 ? items.map((i) => `- ${i}`).join("\n") : `- ${empty}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// The eight sections — Matthew's spec, his order
// ─────────────────────────────────────────────────────────────────────────────

export interface SectionSpec {
  key: string;
  /** Printed as the heading in the PDF and as the `##` in the markdown. */
  title: string;
  /** What this section has to come back with. Interpolated with the avatar. */
  instruction: (ctx: ResearchContext) => string;
  /**
   * Web searches this section may spend, overriding DEFAULT_SEARCHES.
   *
   * Not every section needs the same budget: the demographics are in the first result and the
   * verbatim phrases take several attempts to hunt down. Raising the default for all eight would
   * cost the run its wall clock for no gain on the six that do not need it.
   */
  searches?: number;
}

const SECTIONS: SectionSpec[] = [
  {
    key: "demographics",
    title: "Demografía del comprador",
    instruction: (c) =>
      `Who actually BUYS this, not who suffers the problem. The two are often different people ` +
      `and the buyer is the one the pages get written for. Age, gender split, income band, where ` +
      `they live, marital and family situation, what they do for a living. What is happening in ` +
      `their life in the week before they start looking for ${val(c.primaryTreatment)}. What they ` +
      `call themselves, and what they would never let anybody call them.`,
  },
  {
    key: "current_solutions",
    title: "Qué soluciones ya está usando el mercado",
    instruction: (c) =>
      `Everything ${c.avatarLabel} is already using for this, including the things that are not ` +
      `competitors: the home remedy, the cheaper substitute, the DIY version, and doing nothing ` +
      `at all. Name real products, real brands and real services where you can find them.`,
  },
  {
    key: "what_they_like",
    title: "Qué les gusta de esas soluciones",
    instruction: () =>
      `What people say they LIKE about each of those solutions, in their words. This is what the ` +
      `new offer has to keep or match, so be specific: "it is fast", "I can do it at home", ` +
      `"nobody can tell". Quote the wording.`,
  },
  {
    key: "what_they_hate",
    title: "Qué problemas tienen con esas soluciones",
    instruction: () =>
      `What goes wrong with each one and why people stop. The complaints, the abandonment ` +
      `reasons, the horror stories as BUYERS tell them rather than as the trade answers them. ` +
      `These become the objections the page has to answer before it is asked.`,
  },
  {
    key: "beliefs",
    title: "Creencias del mercado",
    instruction: (c) =>
      `What ${c.avatarLabel} BELIEVES about this problem and its solutions. ` +
      `IMPORTANT: report these whether they are true or false and do not correct them. A widely held ` +
      `false belief is more useful to a copywriter than a true one, because it is what the reader ` +
      `brings to the page. Mark each one "widely believed" or "fringe" if you can tell, but do ` +
      `not filter by accuracy.`,
  },
  {
    key: "external_forces",
    title: "Fuerzas externas que culpan",
    instruction: (c) =>
      `Who or what ${c.avatarLabel} blames for not being able to live their best life on this ` +
      `problem. Their genetics, their age, their last provider, the industry, the cost, their ` +
      `family, the government. This matters because a buyer who blames their own body and a ` +
      `buyer who blames their last provider need completely different pages.`,
  },
  {
    key: "verbatim_language",
    title: "Lenguaje literal del cliente",
    // ‼️ THE SECTION THE WHOLE STEP EXISTS FOR, AND THE ONE THAT FAILS MOST. Everything else can
    // be answered from industry write-ups; this one needs pages where buyers talk to each other,
    // and a plain search for the topic returns agency marketing copy every time. So it gets a
    // bigger search budget (see searches, below) and it is told HOW to hunt rather than what to
    // find. Three probe runs on Haiku: the run that searched Reddit and named forums directly
    // came back with a dozen quotes and real links; the runs that searched the topic came back
    // with "could not verify".
    searches: 8,
    instruction: (c) =>
      `The exact words, phrases and questions ${c.avatarLabel} types and says. ` +
      `VERBATIM ONLY. Give each one word for word as somebody actually wrote it, with the ` +
      `link it came from. Keep the typos, the lowercase, the missing apostrophes: the register ` +
      `IS the finding. A paraphrase is worth nothing here. Also note the reading level they ` +
      `write at, because a page pitched above it does not get read.\n\n` +
      `HOW TO SEARCH, because this is the section that comes back empty when it is done wrong. ` +
      `Do NOT search the topic: that returns agency marketing pages and listicles, which contain ` +
      `no buyer language at all. Search for the PLACES buyers talk to each other and then read ` +
      `them. Run searches shaped like: "${c.avatarLabel} reddit", "${c.avatarLabel} forum", ` +
      `site:reddit.com ${c.avatarLabel}, "${c.avatarLabel}" + "any advice", ` +
      `"${c.avatarLabel}" + "am i the only one", and the same again with the specific complaints ` +
      `and questions you already know this buyer has. Quora, Reddit threads, forum posts, review ` +
      `replies and comment sections are what you are after.\n\n` +
      `Aim for 30 or more phrases. If a page you find is thin, search again somewhere else ` +
      `rather than settling: you have the budget for several attempts, and coming back with five ` +
      `real quotes beats coming back with a summary of what people supposedly say.`,
  },
  {
    key: "headline_ideas",
    title: "Ideas de titulares y asuntos",
    instruction: (c) =>
      `Headline and email-subject ideas built from the highest-interest topics you found for ` +
      `${c.avatarLabel}: the threads with the most views and the most replies, the questions ` +
      `that keep coming back. Each one should be traceable to something you actually read. Say ` +
      `which finding each headline came from.`,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Prompts
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The rules that make this a prompt rather than a lecture.
 *
 * The anti-fabrication clause is the one that matters. Section 7's entire value is that the
 * phrases are real; a model that invents plausible forum quotes produces something that reads
 * better and is worth nothing, and nobody downstream can tell the difference.
 */
const SYSTEM = [
  "You are a direct-response market researcher. You do primary research and report what you",
  "found. You are not writing marketing copy and you are not summarising a methodology.",
  "",
  "RULES, in order of importance:",
  "",
  "1. Use web search. Report what real sources say, not what you already believe.",
  "2. Cite a source for every claim. A bare URL at the end of the line is enough.",
  "3. If you cannot verify something, SAY SO and leave it out. Write \"could not verify\" rather",
  "   than filling the gap. An honest short answer beats a complete-looking invented one.",
  "4. NEVER invent a quote, a forum post, a review or a statistic. Quoting a real person badly is",
  "   recoverable; quoting a person who does not exist is not.",
  "5. When you quote somebody, quote them word for word, typos and all. Do not tidy their",
  "   grammar. The way they write is the finding.",
  "6. Prefer forums, review sites, comment threads and Q&A pages over marketing pages. You are",
  "   looking for what buyers say to each other, not what sellers say to buyers.",
  "",
  "Write in English. Return prose and bullet lists, no preamble, no sign-off, no restating of",
  "the question.",
  "",
  "‼️ NEVER use an em dash (the long one) in anything you write. Use a comma, a full stop, a",
  "colon or a plain hyphen instead. This is a standing house rule and it applies to every line of",
  "this report. The one exception is inside a quotation: if the person you are quoting wrote one,",
  "it stays, because a quote is copied and never edited.",
].join("\n");

/** The business facts, identical in every section prompt so the model always has the whole picture. */
function factsBlock(c: ResearchContext): string {
  const where = [c.city, c.state].filter(Boolean).join(", ") || NOT_RECORDED;

  return [
    "WHAT WE ALREADY KNOW",
    "",
    `Business: ${c.clinicName}${c.trade ? ` (${c.trade})` : ""}`,
    `Where: ${where}`,
    `The customer this research is about: ${c.avatarLabel}`,
    `The service the money is in: ${val(c.primaryTreatment)}`,
    "Services offered:",
    list(c.services, NOT_RECORDED),
    "",
    "The owner's own words, quoted exactly as they typed them. Do not clean these up, do not",
    "correct them and do not treat them as sloppy: the register is the finding.",
    "",
    `What customers object to: ${val(c.objections)}`,
    `Who they want more of: ${val(c.targetPatient)}`,
    `Who they do not want: ${val(c.notWanted)}`,
    `What they already tried: ${val(c.triedBefore)}`,
    "",
    "SEED SITES",
    "",
    "These are the pages the AI engines actually cited when answering questions about this",
    "market. Start here rather than with a fresh search: these are what the engines already read.",
    "",
    list(c.citedDomains, "no cited sources recorded yet, so start from an open search"),
    "",
    "Businesses the engines named instead of this one:",
    list(c.namedInstead, NOT_RECORDED),
  ].join("\n");
}

/** One section's prompt. Deterministic: same context, same bytes. */
export function buildSectionPrompt(ctx: ResearchContext, section: SectionSpec): string {
  return [
    `Research ONE section of a market-research report about ${ctx.avatarLabel}.`,
    "",
    `SECTION: ${section.title}`,
    "",
    section.instruction(ctx),
    "",
    factsBlock(ctx),
    "",
    `Return only this one section. Do not write the other sections and do not write an ` +
      `introduction or a conclusion for the report as a whole.`,
  ].join("\n");
}

/**
 * The single prompt, for running this by hand somewhere else.
 *
 * ‼️ IT IS THE SAME INSTRUCTIONS THE RUNNER EXECUTES, CONCATENATED. That is the point: what
 * Matthew pastes into ChatGPT deep research and what this file produced are the same ask, so the
 * two outputs are comparable. Surfaced by typing `prompt` in the step thread, never by default —
 * the step's deliverable is the PDF.
 */
export function buildFullPrompt(ctx: ResearchContext): string {
  return [
    SYSTEM,
    "",
    "────────────────────────────────────────────────────────────",
    "",
    `Write a deep market-research report about ${ctx.avatarLabel}.`,
    "",
    factsBlock(ctx),
    "",
    "SECTIONS, in this order. Use these exact headings:",
    "",
    ...SECTIONS.flatMap((s, i) => [`${i + 1}. ${s.title}`, `   ${s.instruction(ctx)}`, ""]),
    "Finish with a ranked list of the twenty-five phrases you would build pages around, most",
    "commercially urgent first, each with the source it came from and one line on why it earns",
    "its place.",
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// The run
// ─────────────────────────────────────────────────────────────────────────────

interface AutoResult {
  ok: boolean;
  error?: string;
  docId?: string;
  note?: string;
}

interface HarvestedRow {
  phrase: string;
  sourceUrl: string | null;
}

/**
 * The phrases runHarvest already scraped for this avatar, newest and most commercially urgent
 * first. Read rather than re-derived: harvest.ts wrote them minutes ago in the same step.
 */
async function harvestedPhrases(vertical: string, avatarSlug: string): Promise<HarvestedRow[]> {
  const { data } = await supabaseAdmin
    .from("question_bank")
    .select("phrase, source_url")
    .eq("vertical", vertical)
    .eq("avatar", avatarSlug)
    .eq("source", "harvest")
    .order("commercial_intent_score", { ascending: false })
    .limit(60);

  return (data ?? []).map((d) => ({
    phrase: d.phrase as string,
    sourceUrl: (d.source_url as string | null) ?? null,
  }));
}

interface SectionResult {
  spec: SectionSpec;
  text: string;
  /** Set when the section did not come back whole. Rendered into the report verbatim. */
  failure?: string;
}

/** How a failed section reads in the report. Stated, never silent, never filled in. */
function stub(reason: string): string {
  return `_This section could not be researched: ${reason}. It is missing from this report rather than guessed at._`;
}

async function runSection(ctx: ResearchContext, spec: SectionSpec): Promise<SectionResult> {
  try {
    const { text, stopReason } = await callClaudeText({
      model: RESEARCH_MODEL,
      system: SYSTEM,
      user: buildSectionPrompt(ctx, spec),
      maxTokens: SECTION_MAX_TOKENS,
      // Reporting what sources say, not writing. Same reasoning as claude-research.ts's 0.1.
      temperature: 0.2,
      tools: [searchTool(spec.searches ?? DEFAULT_SEARCHES)],
      timeoutMs: SECTION_TIMEOUT_MS,
    });

    if (!text.trim()) {
      return { spec, text: stub("the model returned nothing"), failure: "empty" };
    }

    // ‼️ A TRUNCATED SECTION IS A FAILED SECTION AND HAS TO SAY SO. Both of these come back as
    // ordinary-looking prose that simply stops, which is indistinguishable from a finished
    // answer once it is in a PDF somebody is building pages from.
    if (stopReason === "max_tokens" || stopReason === "pause_turn") {
      const why =
        stopReason === "max_tokens"
          ? "it ran out of output budget part-way through"
          : "the search loop was cut short before it finished";
      return { spec, text: `${text}\n\n${stub(`incomplete — ${why}`)}`, failure: stopReason };
    }

    return { spec, text };
  } catch (e) {
    const reason = (e as Error).message;
    console.error(`[deep-research] ${spec.key}: ${reason}`);
    return { spec, text: stub(reason), failure: reason };
  }
}

/**
 * The ranking pass: the only step needing judgment across all eight sections at once.
 *
 * No tools — everything it needs is already in the sections, and letting it search again would
 * invite phrases that are in the ranked list but in none of the research above it.
 */
async function rankPhrases(
  ctx: ResearchContext,
  sections: SectionResult[],
  harvested: HarvestedRow[]
): Promise<string> {
  const body = sections.map((s) => `## ${s.spec.title}\n\n${s.text}`).join("\n\n");

  // ‼️ THE HARVEST IS THE FLOOR UNDER THIS SECTION, AND IT IS WHY THE LIST IS NEVER EMPTY.
  //
  // Measured across five probe runs on Haiku: the verbatim-language section found a real forum
  // ONCE. The other four runs came back "could not verify" and the ranker then had nothing to
  // rank, which is a correct refusal and a useless deliverable. `web_search_20250305` returns
  // agency marketing pages for this kind of query and no amount of prompt tuning fixed it.
  //
  // But runHarvest has ALREADY scraped up to 40 of the pages the engines actually cited, with a
  // real source_url on every phrase and the typos kept. Those are exactly what this list wants
  // and they cost nothing extra: they are sitting in question_bank by the time this runs. So the
  // ranker gets both, and a thin web-search section degrades the list rather than emptying it.
  const harvestBlock = harvested.length
    ? [
        "",
        "────────────────────────────────────────────────────────────",
        "",
        "THE CANDIDATE POOL. Each of these was scraped verbatim off a page an AI engine actually",
        "cited when answering questions about this market. They are real strings off real pages,",
        "already filtered to question-shaped and objection-shaped wording, with the typos kept.",
        "",
        "‼️ DO NOT JUDGE WHETHER THESE ARE ORGANIC ENOUGH. They are what this market's pages",
        "actually say, which is the definition of the thing being ranked. A question sitting on a",
        "provider's FAQ is there because buyers ask it.",
        "",
        ...harvested.map((h) => `- "${h.phrase}"  ->  ${h.sourceUrl || "no url in the research"}`),
      ].join("\n")
    : "";

  try {
    const { text } = await callClaudeText({
      model: RESEARCH_MODEL,
      system: SYSTEM,
      user: [
        `You are ordering a list of buyer phrases for ${ctx.avatarLabel}.`,
        "",
        "‼️ THIS IS A RANKING TASK, NOT A RESEARCH TASK. The candidates are supplied below. Your",
        "job is to choose the best twenty-five and put them in order, most commercially urgent",
        "first. You are not being asked whether the research was good enough, and there is no",
        "outcome where the correct answer is a refusal: if the pool is small, rank the small pool.",
        "",
        "WHERE THE CANDIDATES COME FROM. Two places, both eligible, in this order of preference:",
        "",
        "1. THE CANDIDATE POOL at the bottom. Real strings scraped off the pages the engines cite.",
        "   Every one already has its URL. Most of your list should come from here.",
        "2. Any sentence inside the research that is quoted as somebody's actual words.",
        "",
        "MOST COMMERCIALLY URGENT MEANS closest to spending money. Someone asking what it costs or",
        "how to book outranks someone asking how the technology works. An objection that stops a",
        "sale outranks idle curiosity.",
        "",
        "OUTPUT. The numbered list and nothing else. No preamble, no closing note, no commentary",
        "on the research. It goes straight into a PDF at the place the list belongs.",
        "",
        '1. "the phrase, copied exactly"  ->  https://the-page-it-came-from',
        "   Why: one line on why it earns its place.",
        '2. "a phrase that had no link beside it"  ->  no url in the research',
        "   Why: one line on why it earns its place.",
        "",
        "RULES:",
        "",
        "- COPY EACH PHRASE CHARACTER FOR CHARACTER. Keep the casing, the typos, the missing",
        "  apostrophes, the lowercase i. Do not Title Case it and do not fix the spelling.",
        "- INVENT NOTHING, and that includes URLs. Every phrase and every link must already appear",
        "  below. Carry each phrase's URL across with it.",
        "- Skip a candidate only if it is a statistic ABOUT the market rather than something a",
        "  person would say, or if it duplicates one you already listed.",
        "- Fewer than twenty-five good candidates is fine. Rank what there is and stop.",
        "",
        "────────────────────────────────────────────────────────────",
        "",
        body,
        harvestBlock,
      ].join("\n"),
      maxTokens: RANK_MAX_TOKENS,
      temperature: 0.2,
      timeoutMs: RANK_TIMEOUT_MS,
    });

    const list = trimToList(text);
    // ‼️ THE MODEL DOES NOT GET THE LAST WORD ON WHETHER THIS SECTION EXISTS.
    //
    // Measured on Haiku over seven probe runs: told plainly that refusing is not an option, it
    // still sometimes answers a page of reasons the research was too thin instead of the list.
    // That lands under a heading promising twenty-five phrases in a document a client-facing
    // build is made from. When it happens, fall back to data we already hold.
    if (!hasNumberedList(list)) {
      console.error("[deep-research] ranking returned no list, falling back to the harvest");
      return fallbackRanking(harvested);
    }
    return list;
  } catch (e) {
    console.error(`[deep-research] ranking: ${(e as Error).message}`);
    return fallbackRanking(harvested) || stub((e as Error).message);
  }
}

/** Does this text actually contain a numbered list, or is it prose about one? */
function hasNumberedList(text: string): boolean {
  return /^\s*1[.)]\s+["\u201C]/m.test(text);
}

/**
 * The ranked list, built from the harvest with no model involved.
 *
 * ‼️ NOT A DEGRADED VERSION OF THE MODEL'S ANSWER, A DIFFERENTLY-SOURCED ONE. These phrases were
 * scraped verbatim off the pages the engines cited, they each carry the URL they came from, and
 * commercial_intent_score already ordered them on the deterministic keyword ladder in harvest.ts.
 * Every claim the model's version makes about provenance is true of this one and checkable.
 *
 * What it cannot do is say WHY each phrase earns its place, so it does not pretend to. The line
 * that would carry the reasoning says where the ordering came from instead.
 */
function fallbackRanking(harvested: HarvestedRow[]): string {
  if (!harvested.length) {
    return stub(
      "the ranking pass returned no list and the citations harvest found no phrases to fall back on"
    );
  }

  const top = harvested.slice(0, 25);

  return [
    "_Ranked from the citations harvest rather than by the model: the ranking pass did not return",
    "a list. These are verbatim phrases scraped off the pages the AI engines cited about this",
    "market, ordered by the commercial-intent ladder in harvest.ts. Every one is real and carries",
    "its source._",
    "",
    ...top.map(
      (h, i) => `${i + 1}. "${h.phrase}"  ->  ${h.sourceUrl || "no url recorded"}`
    ),
    "",
    `Found ${top.length} phrase${top.length === 1 ? "" : "s"} this way.`,
  ].join("\n");
}

/**
 * Drop any preamble in front of the numbered list.
 *
 * ‼️ DETERMINISTIC, BECAUSE THE PROMPT ALONE DID NOT HOLD. Told plainly and repeatedly that its
 * whole output is the list, Haiku still opens with a paragraph explaining that the research is
 * thin before producing the list anyway. That paragraph lands at the top of the client-facing
 * PDF, under a heading promising twenty-five phrases, and reads as a failure even when nine
 * usable phrases follow it.
 *
 * So the prompt asks and this enforces. Anything before the first `1. "` goes. If there is no
 * numbered list at all the text is returned untouched, because then the commentary IS the
 * finding and deleting it would leave the section blank.
 */
export function trimToList(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^\s*1[.)]\s+["“]/m);
  if (!match || match.index == null) return trimmed;
  return trimmed.slice(match.index).trim();
}

/** Assemble the markdown. This is what gets ingested AND what the PDF renders from. */
function buildReport(ctx: ResearchContext, sections: SectionResult[], ranked: string): string {
  const where = [ctx.city, ctx.state].filter(Boolean).join(", ");

  return [
    `# Deep research: ${ctx.avatarLabel}`,
    "",
    `${ctx.clinicName}${where ? `, ${where}` : ""}`,
    `Researched with ${RESEARCH_MODEL} and web search.`,
    "",
    ...sections.flatMap((s, i) => [`## ${i + 1}. ${s.spec.title}`, "", s.text, ""]),
    "## The twenty-five phrases, ranked",
    "",
    ranked,
    "",
  ].join("\n");
}

/**
 * Render the report.
 *
 * plainFooter, not fidelityFooter: this document carries no engine results, so a fidelity line
 * claiming questions-times-engines would be describing a run that did not happen here.
 */
function renderPdf(ctx: ResearchContext, sections: SectionResult[], ranked: string): Buffer {
  const where = [ctx.city, ctx.state].filter(Boolean).join(", ");
  const title = `Deep research — ${ctx.avatarLabel}`;

  const state = pdf.startDoc({
    title,
    footer: pdf.plainFooter(
      `${ctx.clinicName} · ${ctx.avatarLabel} · ${new Date().toISOString().slice(0, 10)} · ${RESEARCH_MODEL}`
    ),
  });

  pdf.coverHeading(state, {
    eyebrow: "Buyer research",
    title,
    subtitle: `${ctx.clinicName}${where ? `, ${where}` : ""} · researched with web search, sources cited inline`,
  });

  const failed = sections.filter((s) => s.failure);
  if (failed.length > 0) {
    // Stated on page one rather than discovered on page six.
    pdf.paragraph(
      state,
      `${failed.length} of ${sections.length} sections did not come back whole: ` +
        `${failed.map((f) => f.spec.title).join(", ")}. Each one says so where it appears.`,
      { italic: true }
    );
  }

  sections.forEach((s, i) => {
    pdf.sectionHeading(state, s.spec.title, { number: i + 1 });
    renderBody(state, s.text);
  });

  pdf.sectionHeading(state, "The twenty-five phrases, ranked");
  renderBody(state, ranked);

  return pdf.finishDoc(state);
}

/**
 * Markdown-ish prose into the PDF kit's primitives.
 *
 * Deliberately small: the models emit paragraphs, `-`/`*` bullets and the odd `###`. Anything
 * fancier renders as a paragraph, which is the right failure — a stray `**` in a research
 * document is noise, a swallowed line is a missing finding.
 */
function renderBody(state: pdf.PageState, body: string): void {
  const lines = body.split("\n");
  let bullets: string[] = [];

  const flush = () => {
    if (bullets.length) {
      pdf.bulletList(state, bullets);
      bullets = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);

    if (bullet || numbered) {
      bullets.push(clean((bullet ?? numbered)![1]));
      continue;
    }

    flush();
    if (!line.trim()) continue;

    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      pdf.paragraph(state, clean(heading[1]), { bold: true, size: 10.5, gap: 2 });
      continue;
    }

    pdf.paragraph(state, clean(line), { italic: /^_.*_$/.test(line.trim()) });
  }

  flush();
}

/** Strip the markdown emphasis the kit cannot render. The text survives; the markers do not. */
function clean(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/(^|\s)_(.+?)_(\s|$)/g, "$1$2$3")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

/**
 * Run the research, file the phrases, hand back a PDF.
 *
 * The registry's entry point for step 10's second half.
 */
export async function runDeepResearch(clientId: string): Promise<AutoResult> {
  const built = await buildContext(clientId);
  if (!built.ok) return { ok: false, error: built.error };
  const ctx = built.ctx;

  const started = Date.now();

  // Parallel — see the header. Wall clock is the slowest section, not the sum of eight.
  const sections = await Promise.all(SECTIONS.map((spec) => runSection(ctx, spec)));
  const harvested = await harvestedPhrases(ctx.vertical, ctx.avatarSlug);
  const ranked = await rankPhrases(ctx, sections, harvested);

  const report = buildReport(ctx, sections, ranked);
  const elapsed = Math.round((Date.now() - started) / 1000);
  const failed = sections.filter((s) => s.failure);

  // ‼️ THE PHRASES GO IN THROUGH THE SAME DOOR A PASTE WOULD USE. ingestResearch writes
  // question_bank rows with source='deep_research' under this avatar's slug, which is exactly
  // what stepPrecondition counts — so the [Done] gate needs no change at all, it just satisfies
  // itself now. One extractor, one code path, whether a person or this file brought the text.
  const { ingestResearch } = await import("../research-intake");
  const intake = await ingestResearch({ clientId, text: report });

  const pdfBuffer = renderPdf(ctx, sections, ranked);

  const result = await deliverArtifact({
    clientId,
    stepKey: "avatar_harvest",
    filename: `deep-research-${ctx.avatarSlug}.pdf`,
    buffer: pdfBuffer,
    contentType: "application/pdf",
    message:
      `Deep research for *${ctx.avatarLabel}* is done — ${elapsed}s, ${RESEARCH_MODEL}, ` +
      `${sections.length - failed.length}/${sections.length} sections whole. ` +
      (intake.ok
        ? `${intake.stored ?? 0} new phrases filed against this avatar` +
          `${intake.seen ? `, ${intake.seen} already known` : ""}. `
        : `Nothing was filed to the question bank: ${intake.error}. `) +
      "Read it, then press Done. Type `prompt` here if you want the prompt to run yourself.",
  });

  // Filed against the AVATAR, not the client: the next client in this vertical aiming at the
  // same buyer is offered this back instead of paying for the run again. Same mechanism the old
  // brief used for its prompt text, now carrying actual research.
  const { storeAvatarResearch } = await import("../avatars");
  await storeAvatarResearch({
    vertical: ctx.vertical,
    avatarSlug: ctx.avatarSlug,
    avatarLabel: ctx.avatarLabel,
    researchText: report,
    researchDocId: result.docId ?? null,
    clientId,
  });

  return {
    ok: result.ok,
    error: result.error,
    docId: result.docId,
    note: formatRunSummary({
      avatarLabel: ctx.avatarLabel,
      elapsed,
      total: sections.length,
      failed: failed.map((f) => f.spec.title),
      stored: intake.ok ? (intake.stored ?? 0) : null,
      seen: intake.ok ? (intake.seen ?? 0) : null,
      intakeError: intake.ok ? null : (intake.error ?? "unknown"),
    }),
  };
}

/** The thread note. Says what ran, what did not, and what got filed. */
export function formatRunSummary(a: {
  avatarLabel: string;
  elapsed: number;
  total: number;
  failed: string[];
  stored: number | null;
  seen: number | null;
  intakeError: string | null;
}): string {
  const lines = [
    `Deep research for *${a.avatarLabel}*: ${a.total - a.failed.length}/${a.total} sections ` +
      `researched in ${a.elapsed}s on ${RESEARCH_MODEL} with web search.`,
  ];

  if (a.failed.length) {
    lines.push(
      `Did not come back whole: ${a.failed.join(", ")}. Those sections say so in the PDF rather ` +
        "than being filled in."
    );
  }

  lines.push(
    a.intakeError
      ? `:warning: Nothing reached the question bank: ${a.intakeError}`
      : `${a.stored} new phrases filed under this avatar${a.seen ? `, ${a.seen} already known` : ""}.`
  );

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// Assembling the client's facts
// ─────────────────────────────────────────────────────────────────────────────

type BuildResult = { ok: true; ctx: ResearchContext } | { ok: false; error: string };

/**
 * Everything the prompts interpolate, off measured runs and the intake bags.
 *
 * Exported because the `prompt` thread command rebuilds the same context to render the same
 * prompt. Two callers, one definition of what this client's facts are.
 */
export async function buildContext(clientId: string): Promise<BuildResult> {
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("legal_name, dba_name, city, state, contact_id, domain, services, ideal_patient, business_type")
    .eq("id", clientId)
    .maybeSingle();

  if (!client) return { ok: false, error: "client not found" };

  const { confirmedAvatarFor } = await import("../avatars");
  const { verticalFor } = await import("../harvest");

  const avatar = await confirmedAvatarFor(clientId);

  // ‼️ REFUSES RATHER THAN RESEARCHING "THE BUSINESS". question_bank has no client_id, so a
  // phrase filed under the wrong avatar cannot be unpicked afterwards, and this writes into a
  // corpus every client in the vertical reads from. Same refusal runHarvest and ingestResearch
  // make, for the same reason.
  if (!avatar) {
    return {
      ok: false,
      error:
        "No avatar is confirmed on this client, so there is nothing to research. Confirm one at " +
        "the step above: it is what the research is supposed to be about.",
    };
  }

  const resolved = await verticalFor(clientId);
  if (!resolved.ok) return { ok: false, error: resolved.error };

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

  const { citedDomains, namedInstead } = await measuredContext(
    clientId,
    (client.contact_id as string | null) ?? null,
    (client.domain as string | null) ?? null
  );

  return {
    ok: true,
    ctx: {
      clinicName: (client.dba_name as string) || (client.legal_name as string) || "This business",
      city: (client.city as string | null) ?? null,
      state: (client.state as string | null) ?? null,
      avatarLabel: avatar.label,
      avatarSlug: avatar.slug,
      vertical: resolved.vertical,
      // ‼️ THE PROSE ONE, NOT THE SLUG. business_type reads "AI visibility (AEO) marketing agency
      // for local businesses"; vertical_slug reads "aeo-agency". These prompts are sentences, and
      // a slug in the middle of one tells the model less than the phrase the classifier wrote.
      // verticalFor() is still what KEYS everything.
      trade: ((client.business_type as string | null) ?? "").trim() || null,
      primaryTreatment: str(services.primary_treatment) ?? str(services.primaryTreatment),
      services: serviceList,
      objections: str(ideal.objections),
      targetPatient: str(ideal.target),
      notWanted: str(ideal.not_wanted),
      triedBefore: str(ideal.tried_before),
      citedDomains,
      namedInstead,
    },
  };
}

/**
 * Cited hosts and the businesses named instead, off this client's most recent run.
 *
 * ‼️ MATCHED ON client_id FIRST, AND THE ORDER MATTERS MORE THAN IT LOOKS.
 *
 * contact_id and domain are FALLBACKS, not equivalents. Both can match a `prospect_audit`: the
 * one-engine prospecting run the audit bot fires at a lead. Seeding research from one is not a
 * scorecard contamination, but it does mean "the sources the engines actually cited" would
 * describe a different run than the one this client's numbers come from. client_id is the only
 * link that says "this run was fired FOR this client".
 *
 * Moved here verbatim from deep-research-brief.ts when that file was retired.
 */
async function measuredContext(
  clientId: string,
  contactId: string | null,
  domain: string | null
): Promise<{ citedDomains: string[]; namedInstead: string[] }> {
  const empty = { citedDomains: [], namedInstead: [] };

  const base = () =>
    supabaseAdmin.from("audit_reports").select("id").order("created_at", { ascending: false }).limit(1);

  let { data: report } = await base().eq("client_id", clientId).maybeSingle();

  if (!report && contactId) ({ data: report } = await base().eq("contact_id", contactId).maybeSingle());
  if (!report && domain) ({ data: report } = await base().ilike("website", `%${domain}%`).maybeSingle());
  if (!report) return empty;

  const { data: runs } = await supabaseAdmin
    .from("audit_runs")
    .select("citations, recommended")
    .eq("report_id", report.id as string)
    .eq("status", "ok");

  const hosts = new Map<string, number>();
  const named = new Map<string, number>();

  for (const row of runs ?? []) {
    // citations is jsonb and has carried both bare strings and {url} objects over the life of
    // the table. Handle both rather than assuming the newer shape.
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
