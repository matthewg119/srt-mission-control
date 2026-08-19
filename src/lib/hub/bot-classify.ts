// What kind of client made this request?
//
// Pure, edge-safe, zero imports, same discipline as host-classify.ts. It runs on every
// hub request, so it is a table and a loop and nothing else.
//
// ‼️ AN ANSWER CRAWLER AND A TRAINING CRAWLER ARE NOT THE SAME THING, and collapsing them
// is the mistake this file exists to prevent. src/lib/audit-engine/robots-check.ts already
// documents the distinction on the way in: blocking GPTBot is a TRAINING opt-out and does
// not remove you from today's answers, while OAI-SearchBot is what actually fetches a page
// in order to cite it. The same split has to survive on the way out, because "an AI engine
// read the page we built for you" is the number the client is paying for and "an AI company
// took a copy for its next model" is not.
//
// FOUR CLASSES, and the residual matters as much as the named ones:
//   ai_answer    live retrieval that feeds an answer a person is reading right now
//   ai_training  corpus collection for a future model
//   search       ordinary search indexing
//   bot          anything self-identifying as automated that is none of the above
//   human        everything else, WHICH IS A RESIDUAL AND NOT A MEASUREMENT
//
// That last line is the honest caveat. A browser is not detectable, only undetectable-as-
// a-bot, so `human` means "nothing in the table matched". Do not render it as a verified
// person count.

export type BotClass = "human" | "ai_answer" | "ai_training" | "search" | "bot";

export interface BotVerdict {
  /** Which bucket the chart should count this in. */
  botClass: BotClass;
  /** The canonical agent name when we recognised one, else null. Display only. */
  botName: string | null;
}

/**
 * Substring match against the raw User-Agent, lowercased, FIRST HIT WINS.
 *
 * ‼️ ORDER IS LOAD-BEARING WHERE ONE TOKEN CONTAINS ANOTHER. "applebot-extended" contains
 * "applebot", so the training entry has to be tested before the search one or Apple's
 * AI opt-out crawler is filed as ordinary search indexing forever. Any new entry that is a
 * prefix of an existing one goes ABOVE it. The list is ordered, not alphabetised, on
 * purpose.
 */
const AGENTS: ReadonlyArray<readonly [needle: string, botClass: BotClass, name: string]> = [
  // ── ai_answer: fetched in order to answer somebody ─────────────────────────
  ["oai-searchbot", "ai_answer", "OAI-SearchBot"],
  ["chatgpt-user", "ai_answer", "ChatGPT-User"],
  ["perplexity-user", "ai_answer", "Perplexity-User"],
  ["perplexitybot", "ai_answer", "PerplexityBot"],
  ["claude-searchbot", "ai_answer", "Claude-SearchBot"],
  ["claude-user", "ai_answer", "Claude-User"],
  ["duckassistbot", "ai_answer", "DuckAssistBot"],
  ["mistralai-user", "ai_answer", "MistralAI-User"],

  // ── ai_training: corpus collection ────────────────────────────────────────
  ["gptbot", "ai_training", "GPTBot"],
  ["claudebot", "ai_training", "ClaudeBot"],
  ["anthropic-ai", "ai_training", "anthropic-ai"],
  // ‼️ THESE TWO ARE robots.txt DIRECTIVE NAMES AND ALMOST CERTAINLY WILL NEVER MATCH.
  // Google fetches for AI Overviews and Gemini grounding under the plain `Googlebot` UA,
  // and Apple fetches under plain `Applebot`; `Google-Extended` and `Applebot-Extended`
  // exist only as tokens you write in robots.txt to opt out of training. They are listed
  // so that the day either becomes a real header this file already handles it, and so
  // nobody re-adds them believing they were forgotten.
  //
  // The consequence for the dashboard: a zero next to these is NOT evidence that Google's
  // or Apple's AI has not read the pages. It is the absence of a measurement. Do not
  // render them as their own row. Same tri-state discipline as site_signals and
  // robots_check, where "never ran" and "ran and found nothing" must never read the same.
  ["google-extended", "ai_training", "Google-Extended"],
  ["applebot-extended", "ai_training", "Applebot-Extended"], // MUST precede "applebot"
  ["meta-externalagent", "ai_training", "meta-externalagent"],
  ["meta-externalfetcher", "ai_training", "meta-externalfetcher"],
  ["facebookbot", "ai_training", "FacebookBot"],
  ["bytespider", "ai_training", "Bytespider"],
  ["ccbot", "ai_training", "CCBot"],
  ["cohere-ai", "ai_training", "cohere-ai"],
  ["diffbot", "ai_training", "Diffbot"],
  ["omgili", "ai_training", "omgili"],
  ["timpibot", "ai_training", "Timpibot"],
  ["webzio-extended", "ai_training", "Webzio-Extended"],
  ["imagesiftbot", "ai_training", "ImagesiftBot"],
  ["pangubot", "ai_training", "PanguBot"],

  // ── search ────────────────────────────────────────────────────────────────
  ["googlebot", "search", "Googlebot"],
  ["google-inspectiontool", "search", "Google-InspectionTool"],
  ["storebot-google", "search", "Storebot-Google"],
  ["bingbot", "search", "Bingbot"],
  ["duckduckbot", "search", "DuckDuckBot"],
  ["baiduspider", "search", "Baiduspider"],
  ["yandexbot", "search", "YandexBot"],
  ["seznambot", "search", "SeznamBot"],
  ["applebot", "search", "Applebot"], // bare Applebot, AFTER Applebot-Extended
  ["slurp", "search", "Yahoo Slurp"],
  ["sogou", "search", "Sogou"],
  ["petalbot", "search", "PetalBot"],
  ["amazonbot", "search", "Amazonbot"],

  // ── bot: unfurlers, monitors, libraries, generic self-identified crawlers ──
  ["facebookexternalhit", "bot", "facebookexternalhit"],
  ["twitterbot", "bot", "Twitterbot"],
  ["linkedinbot", "bot", "LinkedInBot"],
  ["slackbot", "bot", "Slackbot"],
  ["discordbot", "bot", "Discordbot"],
  ["telegrambot", "bot", "TelegramBot"],
  ["whatsapp", "bot", "WhatsApp"],
  ["pinterest", "bot", "Pinterest"],
  ["ahrefsbot", "bot", "AhrefsBot"],
  ["semrushbot", "bot", "SemrushBot"],
  ["mj12bot", "bot", "MJ12bot"],
  ["dotbot", "bot", "DotBot"],
  ["uptimerobot", "bot", "UptimeRobot"],
  ["pingdom", "bot", "Pingdom"],
  ["vercel-screenshot", "bot", "vercel-screenshot"],
  ["vercel-favicon", "bot", "vercel-favicon"],
  ["headlesschrome", "bot", "HeadlessChrome"],
  ["python-requests", "bot", "python-requests"],
  ["go-http-client", "bot", "Go-http-client"],
  ["node-fetch", "bot", "node-fetch"],
  ["axios", "bot", "axios"],
  ["curl/", "bot", "curl"],
  ["wget", "bot", "Wget"],
  ["libwww-perl", "bot", "libwww-perl"],
];

/**
 * The last-resort tells, checked only after the table misses.
 *
 * Deliberately NOT in the table: they are generic enough to swallow a real agent name if
 * they were tested in order, and "spider" appears inside plenty of legitimate strings. A
 * hit here is a bot we could not name, which is exactly what botName: null means.
 */
const GENERIC_TELLS = ["bot", "crawler", "spider", "crawl", "http-client", "scraper"];

export function classifyUserAgent(rawUa: string | null | undefined): BotVerdict {
  const ua = (rawUa ?? "").toLowerCase();

  // No User-Agent at all is not a person. Almost every browser sends one and every
  // scripted client that bothers to look human sends one too, so a blank is a tell.
  if (!ua.trim()) return { botClass: "bot", botName: null };

  for (const [needle, botClass, name] of AGENTS) {
    if (ua.includes(needle)) return { botClass, botName: name };
  }

  for (const tell of GENERIC_TELLS) {
    if (ua.includes(tell)) return { botClass: "bot", botName: null };
  }

  return { botClass: "human", botName: null };
}

/** The classes the client actually cares about, in the order they should be charted. */
export const CHARTED_CLASSES: readonly BotClass[] = ["ai_answer", "ai_training", "search", "human"];

export const BOT_CLASS_LABEL: Record<BotClass, string> = {
  ai_answer: "AI answers",
  ai_training: "AI training",
  search: "Search",
  human: "People",
  bot: "Other bots",
};
