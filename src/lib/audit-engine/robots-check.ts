// Does this site lock the AI crawlers out of its own front door?
//
// THE DISTINCTION THIS FILE EXISTS FOR (SRT_Loom_AI_Access_Check.md): every engine runs two
// different bots, and they are not interchangeable.
//
//   TRAINING bot   (GPTBot, ClaudeBot, Google-Extended)  — blocking it stops the model being
//                  trained on your pages. It does NOT remove you from today's answers.
//   SEARCH bot     (OAI-SearchBot, PerplexityBot, Claude-SearchBot, and the live-fetch
//                  ChatGPT-User / Perplexity-User / Claude-User) — blocking THIS is what takes
//                  you out of the answer a buyer is reading right now.
//
// So "your site blocks ChatGPT" is only an honest sentence when a SEARCH bot is disallowed. Said
// about a blocked GPTBot while OAI-SearchBot is wide open, it is wrong, and any technical person
// catches it in five seconds. The email tease and the Loom's second-gap beat are both gated on
// `verdict === "devastating"` for exactly that reason.
//
// HONESTY CAVEAT worth knowing when reading the output: robots.txt is the two-minute check, not
// the whole truth. A site can say Allow and still block the crawler at the WAF, via Cloudflare
// bot rules, or by rate-limiting to a 429. So a clean result is "nothing visible in robots.txt",
// never "the crawlers definitely get in" — which is why `checkRobots` returns findings, and the
// scripts only ever claim what is literally on screen.

const TIMEOUT_MS = 8000;
const MAX_BYTES = 200_000;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";

export type CrawlerRole = "search" | "training";

interface KnownBot {
  /** Token as it appears in robots.txt. Matched case-insensitively, as the spec requires. */
  name: string;
  role: CrawlerRole;
  engine: string;
}

/** Verified July 2026 per SRT_Loom_AI_Access_Check.md. Order is the order findings are reported. */
const KNOWN_BOTS: KnownBot[] = [
  { name: "OAI-SearchBot", role: "search", engine: "ChatGPT" },
  { name: "ChatGPT-User", role: "search", engine: "ChatGPT" },
  { name: "PerplexityBot", role: "search", engine: "Perplexity" },
  { name: "Perplexity-User", role: "search", engine: "Perplexity" },
  { name: "Claude-SearchBot", role: "search", engine: "Claude" },
  { name: "Claude-User", role: "search", engine: "Claude" },
  { name: "GPTBot", role: "training", engine: "ChatGPT" },
  { name: "ClaudeBot", role: "training", engine: "Claude" },
  { name: "Google-Extended", role: "training", engine: "Google AI" },
];

export interface RobotsFinding {
  /** The bot token exactly as written in their robots.txt, so it can be shown on screen. */
  bot: string;
  role: CrawlerRole;
  engine: string;
  /** True when the block comes from `User-agent: *` rather than a rule naming this bot. */
  viaWildcard: boolean;
  /** One clause written to be pasted into an email or read on camera. */
  detail: string;
}

/**
 * `null` means the check never ran (no claim of any kind is allowed).
 * `[]` means it ran and found nothing (the beat is cut, and that is a real answer).
 * Non-empty means findings. These three must never read the same, which is the same tri-state
 * contract `site_signals` already uses.
 */
export type RobotsCheck = RobotsFinding[] | null;

export type RobotsVerdict = "devastating" | "soft" | "none";

/**
 * Which beat the findings authorize.
 *
 *   devastating  a SEARCH bot is disallowed. Record the second-gap beat; the email may tease it.
 *   soft         only TRAINING bots are disallowed. Optional, precise beat, and it must say
 *                "training" out loud. Never gates the email tease.
 *   none         nothing found, or never checked. Do not fabricate a problem.
 */
export function robotsVerdict(check: RobotsCheck): RobotsVerdict {
  if (!check || check.length === 0) return "none";
  return check.some((f) => f.role === "search") ? "devastating" : "soft";
}

/** The findings that authorize the hard beat, most quotable first. */
export function searchBotFindings(check: RobotsCheck): RobotsFinding[] {
  return (check ?? []).filter((f) => f.role === "search");
}

function robotsUrl(website: string): string | null {
  try {
    const base = website.startsWith("http") ? website : `https://${website}`;
    return new URL("/robots.txt", base).toString();
  } catch {
    return null;
  }
}

/**
 * robots.txt groups, as `user-agent (lowercased) -> disallowed paths`.
 *
 * A group can list several User-agent lines before its rules, and consecutive User-agent lines
 * share one rule set — parsing each line as its own group is the classic bug and would miss a
 * block written that way. `agents` therefore accumulates until the first directive line, and
 * resets on the next User-agent that follows one.
 */
function parseGroups(txt: string): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  let agents: string[] = [];
  let sawRule = false;

  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();

    if (field === "user-agent") {
      if (sawRule) {
        agents = [];
        sawRule = false;
      }
      agents.push(value.toLowerCase());
      continue;
    }
    if (field !== "disallow" && field !== "allow") continue;

    sawRule = true;
    if (field === "disallow" && value !== "") {
      for (const a of agents) groups.set(a, [...(groups.get(a) ?? []), value]);
    } else if (!groups.has(agents[0] ?? "")) {
      // Record the group even when it only carries Allow / empty Disallow, so the
      // most-specific-group rule below can tell "has its own group" from "falls back to *".
      for (const a of agents) if (!groups.has(a)) groups.set(a, []);
    }
  }
  return groups;
}

/** A group blocks the whole site when it disallows the root outright. */
function blocksEverything(paths: string[] | undefined): boolean {
  return !!paths?.some((p) => p === "/" || p === "/*");
}

function detailFor(bot: KnownBot, viaWildcard: boolean): string {
  const how = viaWildcard
    ? "their robots.txt disallows every crawler at the root, which includes"
    : "their robots.txt names and blocks";
  return bot.role === "search"
    ? `${how} ${bot.name}, the crawler ${bot.engine} uses to read pages for the answers it gives today`
    : `${how} ${bot.name}, which only affects ${bot.engine} training, not the answers it gives today`;
}

/**
 * Read a robots.txt body. Pure, so the precedence rules are testable without a network call.
 *
 * Returns [] for anything that is not a robots.txt: some hosts answer /robots.txt with a styled
 * HTML 404 at status 200, and finding the word "Disallow" inside that page would be the worst
 * possible false positive.
 */
export function analyzeRobotsTxt(txt: string): RobotsFinding[] {
  if (/^\s*</.test(txt) || !/^\s*(?:user-agent|sitemap|allow|disallow)\s*:/im.test(txt)) return [];

  const groups = parseGroups(txt);
  const wildcardBlocks = blocksEverything(groups.get("*"));

  const findings: RobotsFinding[] = [];
  for (const bot of KNOWN_BOTS) {
    const own = groups.get(bot.name.toLowerCase());
    // Most-specific group wins: a bot with its own group ignores `*` entirely, which is the
    // actual robots.txt precedence rule. Treating them as additive would report a bot as blocked
    // when its own group explicitly allows it.
    if (own !== undefined) {
      if (blocksEverything(own)) {
        findings.push({ bot: bot.name, role: bot.role, engine: bot.engine, viaWildcard: false, detail: detailFor(bot, false) });
      }
    } else if (wildcardBlocks) {
      findings.push({ bot: bot.name, role: bot.role, engine: bot.engine, viaWildcard: true, detail: detailFor(bot, true) });
    }
  }
  return findings;
}

/**
 * Fetch and read the site's robots.txt.
 *
 * Its own fetch rather than the shared `fetchText`, which rejects any content-type that is not
 * text/html — robots.txt is text/plain, so that helper always returns null for it.
 *
 * Returns null (never threw, never guessed) for any failure: a missing robots.txt is a 404, and
 * a 404 means "no restrictions stated", not "we could not check". Both are reported as null so
 * nothing downstream can claim anything about a site we did not successfully read.
 */
export async function checkRobots(website: string): Promise<RobotsCheck> {
  const url = robotsUrl(website);
  if (!url) return null;

  let txt: string;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": USER_AGENT, Accept: "text/plain,*/*" },
    });
    clearTimeout(timer);
    // A 404 is a real, clean answer: no robots.txt means nothing is disallowed.
    if (res.status === 404) return [];
    if (!res.ok) return null;
    txt = (await res.text()).slice(0, MAX_BYTES);
  } catch {
    return null;
  }

  return analyzeRobotsTxt(txt);
}
