// Can the AI crawlers actually read this site?
//
// Two questions with one answer shape. The robots.txt half is what the file SAYS. The WAF half
// is what the server DOES when a crawler asks, which is a different fact: plenty of sites
// publish a welcoming robots.txt and then 403 anything whose user agent is not a browser.
//
// ‼️ THE robots.txt HALF IS NOT REBUILT. src/lib/audit-engine/robots-check.ts already parses
// it, already honours real precedence (stacked User-agent lines share one rule block, a bot's
// own group overrides `*`), already knows the nine agents, and already splits SEARCH from
// TRAINING. That split is the whole reason it exists, and it is the thing this lane would most
// easily get wrong on its own.
//
// ‼️ "YOUR SITE BLOCKS CHATGPT" IS A CLAIM ABOUT SEARCH BOTS AND ABOUT NOTHING ELSE. Blocking
// GPTBot or Google-Extended is a TRAINING opt-out: it stops the model being trained on the site
// and does not remove it from today's answers. Saying otherwise is caught by anyone technical in
// five seconds, on a pitch whose entire basis is "you can verify this yourself".
// robots-check.ts's own header says this in as many words. searchBotFindings() is the gate.
//
// ‼️ AND IT IS TRI-STATE, LIKE EVERYTHING ELSE THAT MEASURES. `null` means the check never ran
// or could not run; `[]` means it ran and found nothing. "We could not look" and "nothing is
// there" are different answers, and collapsing them is how a resolver outage becomes a finding.

import { supabaseAdmin } from "@/lib/db";
import {
  checkRobots,
  robotsVerdict,
  searchBotFindings,
  type RobotsCheck,
} from "@/lib/audit-engine/robots-check";

/** The user agent OpenAI's search crawler sends. Used to see what the server does with it. */
const SEARCH_BOT_UA =
  "Mozilla/5.0 (compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot)";

export type WafVerdict = "open" | "blocked" | "unknown";

export interface DoorCheck {
  /** null = never read. [] = read, nothing disallowed. */
  robots: RobotsCheck;
  /** What the server did when asked as a search crawler. */
  waf: WafVerdict;
  /** The status the crawler-UA request came back with, when there was one. */
  wafStatus: number | null;
  /** The bots a claim may be made about. Empty is a real and good answer. */
  blockedSearchBots: string[];
  /** True only when a SEARCH bot is disallowed. Never true for a training-only block. */
  closed: boolean;
  checkedAt: string;
}

/**
 * Ask for a real page as a search crawler and see what comes back.
 *
 * ‼️ A FAILURE IS `unknown`, NEVER `blocked`. A timeout, a DNS hiccup or our own network is not
 * evidence that a client is blocking anybody, and recording it as one puts a false finding in
 * front of an owner who can disprove it from their phone. Same rule MxVerdict keeps in the
 * scraper lane and `site_signals` keeps in the audit.
 *
 * ‼️ AND A 403 OR 429 IS THE ONLY THING THAT COUNTS. A 404 means that page is not there, which
 * says nothing about crawlers. A 500 means their site is broken, which is a different
 * conversation and not this one.
 */
export async function probeWaf(website: string): Promise<{ verdict: WafVerdict; status: number | null }> {
  const url = website.startsWith("http") ? website : `https://${website}`;

  try {
    const res = await fetch(url, {
      headers: { "user-agent": SEARCH_BOT_UA, accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(12_000),
    });

    if (res.status === 403 || res.status === 429 || res.status === 401) {
      return { verdict: "blocked", status: res.status };
    }
    if (res.ok) return { verdict: "open", status: res.status };
    // Anything else: their server said something, and it was not about us being a crawler.
    return { verdict: "unknown", status: res.status };
  } catch {
    return { verdict: "unknown", status: null };
  }
}

/** Both halves, for one site. */
export async function checkDoor(website: string): Promise<DoorCheck> {
  const [robots, waf] = await Promise.all([
    checkRobots(website).catch(() => null),
    probeWaf(website),
  ]);

  const blocked = searchBotFindings(robots).map((f) => f.bot);

  return {
    robots,
    waf: waf.verdict,
    wafStatus: waf.status,
    blockedSearchBots: blocked,
    // ‼️ SEARCH BOTS ONLY. robotsVerdict() returns "soft" for a training-only block, and a soft
    // verdict is not a closed door.
    closed: blocked.length > 0 || waf.verdict === "blocked",
    checkedAt: new Date().toISOString(),
  };
}

/** Store one reading, so the recurring probe can tell a change from a first sighting. */
export async function recordDoor(clientId: string, check: DoorCheck): Promise<void> {
  const { error } = await supabaseAdmin.from("client_crawler_probes").insert({
    client_id: clientId,
    checked_at: check.checkedAt,
    robots_ok: check.blockedSearchBots.length === 0,
    waf_ok: check.waf === "open",
    agents_blocked: check.blockedSearchBots,
    observed: {
      waf: check.waf,
      wafStatus: check.wafStatus,
      // The full finding list, training blocks included. They are not a claim and they are
      // worth having on file: a training opt-out today is often a search block next month,
      // by the same hand.
      robots: check.robots,
    },
  });

  if (error) console.error(`[crawler-door] reading not stored: ${error.message}`);
}

/** The most recent reading, or null. */
export async function lastDoor(
  clientId: string
): Promise<{ closed: boolean; agents: string[]; checkedAt: string } | null> {
  const { data } = await supabaseAdmin
    .from("client_crawler_probes")
    .select("checked_at, robots_ok, waf_ok, agents_blocked")
    .eq("client_id", clientId)
    .order("checked_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  const agents = Array.isArray(data.agents_blocked) ? (data.agents_blocked as string[]) : [];
  return {
    closed: data.robots_ok === false || data.waf_ok === false,
    agents,
    checkedAt: String(data.checked_at),
  };
}

/**
 * The call-pack lines. Sales intel, written so it can be read aloud.
 *
 * ‼️ EVERY SENTENCE HERE IS ONE A PROSPECT CAN CHECK IN THIRTY SECONDS, WHICH IS WHY THE
 * TRAINING SPLIT IS LOAD-BEARING RATHER THAN PEDANTIC. "Your site blocks ChatGPT" said about a
 * GPTBot line is wrong, and being wrong about the one technical claim in the pitch costs the
 * whole pitch.
 */
export function doorLines(check: DoorCheck): string[] {
  const out: string[] = [];
  const verdict = robotsVerdict(check.robots);

  if (check.robots === null) {
    out.push("Their robots.txt could not be read, so nothing may be claimed about it either way.");
  } else if (check.blockedSearchBots.length > 0) {
    out.push(
      `‼️ Their robots.txt disallows ${check.blockedSearchBots.join(", ")}. ` +
        `Those are the crawlers that fetch a page to ANSWER a question, so this is the strong ` +
        `opener: the engines are being told not to read them right now.`
    );
  } else if (verdict === "soft") {
    const training = (check.robots ?? []).filter((f) => f.role === "training").map((f) => f.bot);
    out.push(
      `Their robots.txt disallows ${training.join(", ")}, which is a TRAINING opt-out. ` +
        `Say "training" out loud if this comes up: it does not remove them from today's answers, ` +
        `and claiming it does is the kind of thing their developer corrects on the call.`
    );
  } else {
    out.push("Their robots.txt allows the AI crawlers. Nothing to fix, and worth saying so.");
  }

  if (check.waf === "blocked") {
    out.push(
      `‼️ Their server answered ${check.wafStatus} to a request sent as a search crawler. ` +
        `The robots.txt is not the whole story: something in front of the site is refusing them.`
    );
  } else if (check.waf === "unknown") {
    out.push("The live crawler request did not come back cleanly, so the server half is unmeasured.");
  }

  return out;
}
