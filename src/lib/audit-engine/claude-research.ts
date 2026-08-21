// Identify a business from third-party sources using Claude's server-side web search.
//
// This is the primary research engine for a business we cannot read a website for — either
// because there is no website, or because the one there is could not be fetched. The OpenAI
// path in search-research.ts stays as the backup; see researchProfile() there for the order.
//
// WHY CLAUDE AND NOT THE OPENAI PATH THAT ALREADY EXISTED
// researchViaSearch() reuses runOpenAI, which needs OPENAI_API_KEY. That key has been the
// standing blocker on this whole feature, so the happy path had never run end to end. Anthropic
// runs web_search server-side on the key this app already has in production, so this unblocks it
// without waiting on billing anywhere.
//
// WHAT IT RETURNS THAT THE PROSE PATH COULD NOT
// runOpenAI hands back a blob of text. That is enough to write 20 questions from, but the caller
// also needs two things it cannot reliably regex out of prose: WHICH CITY this business is in
// (so a name with no city can still be audited) and WHETHER THEY HAVE A SITE after all (so the
// run can upgrade itself to a real crawl). So this asks for JSON and keeps the prose too.
//
// NO FABRICATED DATA, same rule as run-prompts.ts and search-research.ts. If search cannot say
// who this is, this returns null and the pipeline fails with the real reason. An invented
// business produces 20 confident questions about a company that does not exist, and every
// artifact downstream inherits that without ever knowing.

import { callClaudeJSON } from "@/lib/claude-calls";
import type { SiteResearch } from "./site-research";
import type { CrawlBlock } from "./types";
import type { ResearchTarget } from "./search-research";

/** Under this, the profile is a shrug dressed as prose rather than an identification.
 *  Same floor as search-research.ts, and deliberately the same number. */
const MIN_PROFILE_CHARS = 250;

/**
 * Searches per identification. A business is either findable in a handful of queries or it is
 * not findable, and every extra use is latency in front of 20 engine calls that have not
 * started yet.
 *
 * ‼️ MEASURED, not guessed, and 6 was too many. Each web_search round trip on this tool version
 * costs roughly 13s and adds several thousand input tokens the model then re-reads, so cost is
 * worse than linear: a 3-search request measured 40s end to end, and a 6-search one blew a
 * 120s budget outright. Four keeps a real identification comfortably inside the timeout below.
 * Raising this means raising RESEARCH_TIMEOUT_MS with it, and that budget is not free.
 */
const MAX_SEARCHES = 4;

/** Wall-clock budget for the identification call. Generous, because a real web_search run
 *  legitimately takes over a minute, but finite: the whole audit lives inside a 300s
 *  maxDuration and this step runs before any of the 20 engine calls. */
const RESEARCH_TIMEOUT_MS = 200_000;

/**
 * ‼️ THIS IS NOT `BRIEF_BLOCKED_DOMAINS` AND MUST NOT BE REPLACED WITH IT.
 *
 * That list exists for the niche intel brief, whose whole job is to find owners talking to each
 * other rather than agencies publishing at them — so it blocks `yelp.com`, `angi.com`,
 * `thumbtack.com` and `homeadvisor.com` as low-signal marketing surfaces.
 *
 * For THIS job those four are among the highest-signal sources that exist. A business with no
 * website is, by definition, known to the internet only through directories: a Google Business
 * Profile, a Yelp page, a Facebook page. Blocking them would leave the model with nothing to
 * identify the business FROM, and a model with nothing left to cite starts answering from
 * memory, which is the one failure this file exists to prevent.
 *
 * What is blocked here is a different category: SEO tooling and site builders that rank for any
 * "<business name>" query with an auto-generated stub page containing no facts about anyone.
 */
const IDENTIFY_BLOCKED_DOMAINS = [
  "semrush.com",
  "ahrefs.com",
  "similarweb.com",
  "crunchbase.com",
  "zoominfo.com",
  "rocketreach.co",
  "apollo.io",
  "wix.com",
  "squarespace.com",
  "godaddy.com",
  "indeed.com",
  "ziprecruiter.com",
  "glassdoor.com",
];

/**
 * Hosts that are somebody else's platform, never the business's own website.
 *
 * Used to decide whether a `websites[]` entry is a site worth crawling or just another
 * third-party source. Getting this wrong in the permissive direction is expensive: the pipeline
 * would "upgrade" a declared run to a website run pointed at a Facebook page, then report
 * site_signals and a robots.txt verdict about facebook.com to the prospect.
 */
const PLATFORM_HOSTS = [
  "facebook.com",
  "fb.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "linkedin.com",
  "yelp.com",
  "google.com",
  "goo.gl",
  "maps.app.goo.gl",
  "business.site",
  "mapquest.com",
  "bbb.org",
  "angi.com",
  "thumbtack.com",
  "homeadvisor.com",
  "nextdoor.com",
  "tiktok.com",
  "youtube.com",
  "apple.com",
  "yellowpages.com",
  "manta.com",
  "chamberofcommerce.com",
  "birdeye.com",
  "porch.com",
  "houzz.com",
  "tripadvisor.com",
];

function hostOf(url: string): string {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname
      .replace(/^www\./, "")
      .toLowerCase();
  } catch {
    return "";
  }
}

/** Words that carry no identity: they appear in the business name AND in half the directory
 *  hostnames on the internet, so a match on one of them proves nothing. */
const GENERIC_NAME_TOKENS = new Set([
  "the", "and", "for", "inc", "llc", "ltd", "corp", "co", "company", "group", "holdings",
  "services", "service", "solutions", "enterprises", "partners", "associates", "brothers",
  "sons", "reviews", "review", "best", "local", "usa", "america", "american", "national",
]);

/** Name → the distinctive lowercase tokens a real domain of theirs would plausibly contain. */
function nameTokens(businessName: string): string[] {
  return businessName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !GENERIC_NAME_TOKENS.has(t));
}

/**
 * Is this URL the business's OWN site, rather than a profile on somebody else's platform?
 *
 * ‼️ TWO CHECKS, AND THE SECOND ONE IS NOT OPTIONAL. A blocklist alone was wrong and a live
 * probe proved it: researching "Hernandez Auto Repair" returned surecritic.com and carfax.com
 * among its URLs, and a name-blind blocklist called both of them the business's own website.
 * The pipeline would then have crawled SureCritic, and reported ITS site_signals and ITS
 * robots.txt verdict to the prospect as facts about their business.
 *
 * There is no version of PLATFORM_HOSTS that is complete — review platforms, aggregators and
 * directory sites are effectively unbounded, and the ones that matter are the ones nobody
 * thought of. So the real test is affinity to the name: a business's own domain almost always
 * contains a distinctive word from its trading name (hdzautorepair.com for Hernandez AUTO
 * REPAIR, katzsdelicatessen.com for KATZ'S DELICATESSEN), and a third-party platform almost
 * never does. That inverts the guarantee from "block the ones we listed" to "allow only the
 * ones that look like theirs", which is the same move BRIEF_BLOCKED_DOMAINS had to give up and
 * this one can still make.
 *
 * Generic tokens are excluded because "services" or "reviews" would match a directory as
 * readily as an owner's domain. With no distinctive token left (a business genuinely called
 * "The Best Local Services"), this returns false and the run stays `declared` — refusing to
 * upgrade is the cheap failure here; crawling the wrong site is not.
 */
export function isOwnDomain(url: string, businessName: string | null): boolean {
  const host = hostOf(url);
  if (!host || !host.includes(".")) return false;
  if (PLATFORM_HOSTS.some((p) => host === p || host.endsWith(`.${p}`))) return false;

  const tokens = nameTokens(businessName ?? "");
  if (tokens.length === 0) return false;

  // Compare against the host with punctuation removed, so "hdz-auto-repair.com" and
  // "hdzautorepair.com" behave the same.
  const flat = host.replace(/[^a-z0-9]/g, "");
  return tokens.some((t) => flat.includes(t));
}

/** How sure the model is that it found the right city. `low` is a real answer, not a failure. */
export type CityConfidence = "high" | "medium" | "low";

export interface BusinessIdentity {
  /** false is the honest NOT_FOUND: no real business matched. Everything else is then ignored. */
  found: boolean;
  tradingName: string | null;
  whatTheyDo: string | null;
  services: string[];
  city: string | null;
  state: string | null;
  cityConfidence: CityConfidence | null;
  /**
   * Other cities where a business trades under this same name.
   *
   * ‼️ This is the single most important field for a name-only run and the reason the JSON shape
   * exists at all. Hernandez Auto Repair is in Chicago AND in Durham NC; a model asked for "the
   * city" returns one of them with no indication that the question was ambiguous, and the audit
   * then scores a business nobody asked about. A populated `alternates` is what lets the caller
   * stop and ask instead of guessing.
   */
  alternates: Array<{ city: string; state: string; note: string }>;
  /** Every URL found for them, own-domain or not. The caller filters with isOwnDomain(). */
  websites: string[];
  reviewsSummary: string | null;
  competitors: string[];
  /** URLs actually consulted. A profile with none of these is the model talking from memory. */
  sources: string[];
}

/**
 * WHY an identification came back empty. Four outcomes that used to be one bare `null`.
 *
 * ‼️ THE SPLIT IS BETWEEN "call_failed" AND EVERYTHING ELSE, and it is a statement about who the
 * failure is about. A request that threw or timed out says nothing whatsoever about the prospect;
 * the other three say the same thing three ways, that nothing public describes this business. The
 * no-website pitch is allowed to build an email on the second group and must never build one on
 * the first. Same doctrine as run-prompts.ts's status:"no_data": an infrastructure failure is not
 * a finding about anybody.
 */
export type ResearchMiss = "call_failed" | "unidentified" | "thin_profile" | "no_sources";

/** researchViaClaude's answer with the reason kept. `result` and `miss` are exclusive. */
export interface ClaudeResearchDetailed {
  result: ClaudeResearchResult | null;
  miss: ResearchMiss | null;
}

export interface ClaudeResearchResult {
  /** The SiteResearch the rest of the pipeline consumes, shaped exactly as the OpenAI path's. */
  research: SiteResearch;
  /** The structured half: city, alternates, discovered websites. */
  identity: BusinessIdentity;
}

const SCHEMA_HINT = `{
  "found": boolean,
  "trading_name": string | null,
  "what_they_do": string | null,
  "services": string[],
  "city": string | null,
  "state": string | null,
  "city_confidence": "high" | "medium" | "low" | null,
  "alternates": [{ "city": string, "state": string, "note": string }],
  "websites": string[],
  "reviews_summary": string | null,
  "competitors": string[],
  "sources": string[]
}`;

const SYSTEM = [
  "You identify real businesses from third-party web sources. You are the research step in front",
  "of an audit that will score how visible this business is in AI search results, so getting the",
  "IDENTITY right matters more than getting a complete answer.",
  "",
  "RULES, in order of importance:",
  "1. Report only what your sources actually say. Never fill a gap from general knowledge.",
  "2. If you cannot find a real business matching what you were given, set found=false and stop.",
  "   Returning a plausible business is worse than returning nothing, because everything",
  "   downstream will treat it as verified.",
  "3. Never substitute a business with a similar name in a different city. If more than one city",
  "   has a business trading under this name, list every one of them in `alternates` and set",
  "   city_confidence to \"low\". Do not pick a favourite and hide the ambiguity.",
  "4. `websites` is for URLs the business appears to OWN. Include social and directory profiles",
  "   too if that is all that exists, but never invent a domain from the business name.",
  "5. `sources` must list the URLs you actually consulted.",
  "6. BE DECISIVE. You have a small search budget and a hard time limit. The moment you can name",
  "   the business and say what it does, stop searching and report what you have, leaving the",
  "   fields you could not fill as null or empty. A thin sourced answer is useful; an exhaustive",
  "   search that never returns is worth nothing to the person waiting for it.",
  "",
  "PRIORITY, when the budget is tight: trading name, what they do, and city come first. services,",
  "competitors and reviews are nice to have — never spend a search on them alone.",
].join("\n");

function buildUserPrompt(target: ResearchTarget): string {
  const lines: string[] = [];

  if (target.kind === "website") {
    lines.push(
      `Identify the business that operates the website ${hostOf(target.website)}.`,
      "I could not read that site myself, so use sources OTHER than the site itself."
    );
  } else if (target.city) {
    lines.push(
      `Identify a business called "${target.name}" in ${target.city}.`,
      "It appears to have no website of its own, so every source you find will be third-party."
    );
  } else {
    // The no-city case, and the reason `alternates` is load-bearing. There is nothing pinning
    // this name to a place, so the model must be told that finding the place IS the task rather
    // than a detail it can settle on quietly.
    lines.push(
      `Identify a business called "${target.name}". I do not know what city it is in, and`,
      "working that out is part of the job.",
      "",
      "If businesses trade under this name in more than one metro area, that is an ambiguous",
      "result, not a choice for you to make: list every city in `alternates`, set `city` to the",
      "best-supported one, and set city_confidence to \"low\" so a human is asked."
    );
  }

  lines.push(
    "",
    "Search the web and report:",
    "- The exact name it trades under.",
    "- What it actually sells or does, in plain language.",
    "- The city and state it serves customers from.",
    "- Its main services or products.",
    "- Any website, social profile or directory listing it has.",
    "- What reviews say about it, and roughly how many exist.",
    "- Who its local competitors appear to be.",
    "",
    "Sources worth using: Google Business Profile, Yelp, Facebook, Instagram, Apple Maps, the",
    "Better Business Bureau, state business registries, industry directories, local news, review",
    "sites, trade association listings.",
    "",
    target.kind === "website"
      ? `If there is no real business at ${hostOf(target.website)}, set found=false.`
      : `If there is no real business called "${target.name}", set found=false.`
  );

  return lines.join("\n");
}

// --- shape repair -----------------------------------------------------------
// ‼️ coerce IS THE ONLY DEFENCE THIS CALL HAS.
//
// callClaudeJSON skips its correction retry whenever `tools` are present: the retry would have
// to replay the server_tool_use / web_search_tool_result blocks verbatim to rebuild a valid
// conversation, and it would re-run every search. So there is no second chance here — a shape
// the validator rejects is a whole research call thrown away, and on a tool call that is the
// most expensive generation in the pipeline. Repair anything unambiguous; leave anything
// genuinely uncertain for validate to reject.

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

/** A single string where an array was asked for is the most common drift; so is null for []. */
function strArray(v: unknown): string[] {
  if (typeof v === "string") return v.trim() ? [v.trim()] : [];
  if (!Array.isArray(v)) return [];
  return v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean);
}

function coerceIdentity(parsed: unknown): unknown {
  if (typeof parsed !== "object" || parsed === null) return parsed;
  const r = parsed as Record<string, unknown>;

  // The schema asks for snake_case and the model still camelCases it some of the time. This is
  // the exact drift that cost intel-brief.ts a perfectly good generation (why_it_hurts came back
  // as whyItHurts), so both spellings are read rather than assumed.
  const pick = (...keys: string[]): unknown => {
    for (const k of keys) if (r[k] !== undefined) return r[k];
    return undefined;
  };

  const conf = str(pick("city_confidence", "cityConfidence"))?.toLowerCase();

  const alternatesRaw = pick("alternates", "alternate_cities", "alternateCities");
  const alternates = Array.isArray(alternatesRaw)
    ? alternatesRaw
        .map((a) => {
          if (typeof a === "string") {
            // "Durham, NC" collapsed into a bare string. Splitting it is unambiguous.
            const [city, state] = a.split(",").map((p) => p.trim());
            return { city: city || "", state: state || "", note: "" };
          }
          if (typeof a !== "object" || a === null) return null;
          const o = a as Record<string, unknown>;
          return {
            city: str(o.city) ?? "",
            state: str(o.state) ?? "",
            note: str(o.note) ?? str(o.why) ?? "",
          };
        })
        .filter((a): a is { city: string; state: string; note: string } => !!a && !!a.city)
    : [];

  return {
    // A model that found the business sometimes just omits `found` rather than saying true.
    // Infer it from whether it actually named anything, never default it to true blindly.
    found:
      typeof pick("found") === "boolean"
        ? pick("found")
        : !!str(pick("trading_name", "tradingName")),
    trading_name: str(pick("trading_name", "tradingName", "name")),
    what_they_do: str(pick("what_they_do", "whatTheyDo", "description")),
    services: strArray(pick("services")),
    city: str(pick("city")),
    state: str(pick("state")),
    city_confidence:
      conf === "high" || conf === "medium" || conf === "low" ? conf : null,
    alternates,
    websites: strArray(pick("websites", "website", "urls")),
    reviews_summary: str(pick("reviews_summary", "reviewsSummary", "reviews")),
    competitors: strArray(pick("competitors")),
    sources: strArray(pick("sources", "citations")),
  };
}

interface RawIdentity {
  found: boolean;
  trading_name: string | null;
  what_they_do: string | null;
  services: string[];
  city: string | null;
  state: string | null;
  city_confidence: CityConfidence | null;
  alternates: Array<{ city: string; state: string; note: string }>;
  websites: string[];
  reviews_summary: string | null;
  competitors: string[];
  sources: string[];
}

function isRawIdentity(v: unknown): v is RawIdentity {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  if (typeof r.found !== "boolean") return false;
  if (!Array.isArray(r.services) || !Array.isArray(r.websites)) return false;
  if (!Array.isArray(r.sources) || !Array.isArray(r.alternates)) return false;
  // found=false is a complete, valid answer and needs nothing else populated.
  if (!r.found) return true;
  return typeof r.trading_name === "string" && typeof r.what_they_do === "string";
}

function describeInvalidIdentity(v: unknown): string {
  if (typeof v !== "object" || v === null) return "response was not a JSON object";
  const r = v as Record<string, unknown>;
  if (typeof r.found !== "boolean") return "`found` must be a boolean (true or false)";
  for (const k of ["services", "websites", "sources", "alternates"]) {
    if (!Array.isArray(r[k])) return `\`${k}\` must be an array, got ${typeof r[k]}`;
  }
  if (r.found && typeof r.trading_name !== "string") {
    return "`found` is true but `trading_name` is not a string — name the business or set found=false";
  }
  if (r.found && typeof r.what_they_do !== "string") {
    return "`found` is true but `what_they_do` is not a string";
  }
  return "failed validation";
}

// --- prose rendering --------------------------------------------------------

/** The classifier reads prose, not our JSON, so the identity is rendered back into the same
 *  shape of text the OpenAI path produced. Keeping this identical is what lets classify.ts stay
 *  untouched regardless of which engine did the research. */
function renderProfile(id: BusinessIdentity): string {
  const parts: string[] = [];
  if (id.tradingName) parts.push(`Trading name: ${id.tradingName}`);
  if (id.whatTheyDo) parts.push(`What they do: ${id.whatTheyDo}`);
  if (id.city) parts.push(`Location: ${[id.city, id.state].filter(Boolean).join(", ")}`);
  if (id.services.length) parts.push(`Services: ${id.services.join(", ")}`);
  if (id.reviewsSummary) parts.push(`Reviews: ${id.reviewsSummary}`);
  if (id.competitors.length) parts.push(`Local competitors: ${id.competitors.join(", ")}`);
  if (id.websites.length) parts.push(`Web presence: ${id.websites.join(", ")}`);
  return parts.join("\n\n");
}

export function describeResearchTarget(target: ResearchTarget): string {
  if (target.kind === "website") return target.website;
  return target.city ? `${target.name} (${target.city})` : target.name;
}

/**
 * Identify a business with Claude's server-side web search.
 *
 * `existing` is passed on the thin-page path: whatever the page DID give us is kept and this
 * research is appended under its own heading, so real first-party text is never thrown away in
 * favour of a directory listing.
 *
 * `result: null` when the business cannot be identified — the caller then tries the OpenAI backup
 * and, failing that, fails the audit with a real reason. `miss` names WHICH of the four failures
 * it was; see ResearchMiss for why that distinction is load-bearing.
 */
export async function researchViaClaudeDetailed(
  target: ResearchTarget,
  block: CrawlBlock | null,
  existing?: SiteResearch
): Promise<ClaudeResearchDetailed> {
  const label = describeResearchTarget(target);

  let raw: RawIdentity;
  try {
    const { data } = await callClaudeJSON<RawIdentity>({
      model: "claude-sonnet-4-6",
      system: SYSTEM,
      user: buildUserPrompt(target),
      maxTokens: 3000,
      // ‼️ Bounded on purpose. This runs inside waitUntil against a 300s maxDuration, in front
      // of 20 engine calls that have not started yet, and web_search can run for minutes. A
      // request that never returns would eat the whole audit and post nothing — a timeout drops
      // us to the OpenAI backup in researchProfile(), which is the entire reason it was kept.
      timeoutMs: RESEARCH_TIMEOUT_MS,
      // Identification is a recall task, not a creative one. classify.ts runs at 0.4 because it
      // is writing questions; this is reporting what sources say.
      temperature: 0.1,
      schemaHint: SCHEMA_HINT,
      tools: [
        {
          type: "web_search_20260209",
          name: "web_search",
          max_uses: MAX_SEARCHES,
          // Not allowed_domains: an allowlist containing a host Anthropic's crawler cannot reach
          // is rejected at request validation and takes the whole call with it. See the
          // BRIEF_BLOCKED_DOMAINS header in config/pitch.ts for the incident.
          blocked_domains: IDENTIFY_BLOCKED_DOMAINS,
        },
      ],
      validate: isRawIdentity,
      coerce: coerceIdentity,
      describeInvalid: describeInvalidIdentity,
    });
    raw = data;
  } catch (e) {
    console.error(`[claude-research] ${label}: call failed — ${(e as Error).message}`);
    return { result: null, miss: "call_failed" };
  }

  if (!raw.found) {
    console.error(`[claude-research] ${label}: no identifiable business (found=false)`);
    return { result: null, miss: "unidentified" };
  }

  const identity: BusinessIdentity = {
    found: true,
    tradingName: raw.trading_name,
    whatTheyDo: raw.what_they_do,
    services: raw.services,
    city: raw.city,
    state: raw.state,
    cityConfidence: raw.city_confidence,
    alternates: raw.alternates,
    websites: raw.websites,
    reviewsSummary: raw.reviews_summary,
    competitors: raw.competitors,
    sources: raw.sources,
  };

  const profile = renderProfile(identity);
  if (profile.length < MIN_PROFILE_CHARS) {
    console.error(
      `[claude-research] ${label}: profile too thin (${profile.length} chars) to classify from`
    );
    return { result: null, miss: "thin_profile" };
  }

  // ‼️ A profile with no source is the model answering from memory, which is precisely the
  // failure this file exists to prevent. found=true with an empty sources array is a confident
  // hallucination, and it is indistinguishable from a real answer once it reaches classify.ts.
  if (identity.sources.length === 0) {
    console.error(`[claude-research] ${label}: answer cited no sources`);
    return { result: null, miss: "no_sources" };
  }

  const sources = identity.sources.join(", ");
  const header =
    (target.kind === "website"
      ? [
          `Profile of the business at ${hostOf(target.website)}, assembled from third-party sources`,
          `because the site itself could not be read. Sources: ${sources}.`,
        ]
      : [
          `Profile of "${target.name}", assembled from third-party sources because the business`,
          `has no website of its own. Sources: ${sources}.`,
        ]
    ).join("\n") + "\n\n";

  const searchText = `${header}${profile}`;

  if (existing) {
    return {
      miss: null,
      result: {
        identity,
        research: {
          ...existing,
          source: "site+search",
          blocked: block,
          bodyText: [existing.bodyText.trim(), "", "--- Third-party research ---", "", searchText]
            .join("\n")
            .slice(0, 16000),
          pages: [...existing.pages, ...identity.sources.map((url) => ({ url, text: "" }))],
        },
      },
    };
  }

  return {
    miss: null,
    result: {
      identity,
      research: {
        // Null on the name form, and that is the honest value: there is no site, so nothing
        // downstream may fetch robots.txt for it or print it as a fallback display name.
        website: target.kind === "website" ? target.website : null,
        // Deliberately null, not guessed: these are facts about MARKUP we never saw. site-signals
        // is skipped entirely on this path for the same reason.
        title: null,
        metaDescription: null,
        siteName: null,
        headings: [],
        pages: identity.sources.map((url) => ({ url, text: "" })),
        bodyText: searchText.slice(0, 16000),
        schemaHints: [],
        homepageHtml: "",
        // "search" = a site exists and we could not read it. "declared" = there is no site.
        // Only the first is a fact about their crawler setup. See ResearchSource in types.ts.
        source: target.kind === "website" ? "search" : "declared",
        blocked: block,
      },
    },
  };
}

/**
 * The audit lane's entry point, unchanged in shape.
 *
 * Kept as a wrapper rather than updating twelve call sites: run-audit-pipeline, search-research
 * and the thin-page path all want "did it work or not" and have nothing to do with WHY. Only the
 * no-website pitch reads the reason, so only it calls the detailed form.
 */
export async function researchViaClaude(
  target: ResearchTarget,
  block: CrawlBlock | null,
  existing?: SiteResearch
): Promise<ClaudeResearchResult | null> {
  return (await researchViaClaudeDetailed(target, block, existing)).result;
}
