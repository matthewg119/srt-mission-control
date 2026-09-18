// What we refuse to publish, compiled from Google's published guidance. The RULES, not the corpus.
//
// Matthew, 2026-09-18: "lets build it in a new window so we can make sure all of our stuff is
// compliant [Google's content guidelines, the full pre-publish reviewer system prompt, the official
// source list]."
//
// ‼️ THE DOCUMENT IS THE REFERENCE AND THIS IS WHAT BINDS, AND THE SPLIT IS NOT TIDINESS.
// callClaudeJSON (src/lib/claude-calls.ts:287) takes a plain `system: string`. Its request body has
// no content-block array and it sends no anthropic-beta header, so there is NO cache_control
// anywhere on that path: the only prompt caching in this repo is the Call Coach's /suggest route,
// which builds its own Anthropic request. A guidelines corpus in the gate's system prompt would
// therefore be paid IN FULL on every Check press, uncached, on a command explicitly designed to be
// pressed several times while writing. policy_documents holds the full text for a person to read;
// this constant is what reaches the model.
//
// ‼️ IT IS ALSO THIS REPO'S OWN DOCTRINE ARRIVING FROM THE OTHER SIDE: "a prose guard is not a
// guard", stated four times. A policy that must bind is a constant or a pure function, never a
// paragraph somebody hopes the model read to the end of.
//
// ‼️ EDITING THIS IS A CODE CHANGE SOMEBODY MAKES ON PURPOSE. When the weekly scan finds a source
// changed, it posts the diff and asks whether any rule here changed. It never edits this file, and
// nothing reads policy_documents into a prompt. The store answers "what did Google say in week 38";
// this answers "what do we refuse".

/**
 * The pages the weekly scan reads.
 *
 * ‼️ A FIXED LIST IN CODE, NEVER USER-SUPPLIED, AND IT MUST STAY THAT WAY. These are Google's own
 * public documentation, so no SSRF boundary is needed today. The moment any part of a URL here
 * becomes configurable, typed in Slack or read from a row, assertPublicHost() becomes mandatory:
 * a blocklist of literals is not a defence against a resolver.
 *
 * ‼️ THE RATER GUIDELINES ARE NOT HERE ON PURPOSE. They are a ~180 page PDF and must not be fetched
 * weekly. They are versioned by hand as source 'pasted'.
 */
export const GUIDELINE_SOURCES: ReadonlyArray<{ kind: string; label: string; url: string }> = [
  {
    kind: "creating_helpful_content",
    label: "Creating helpful, reliable, people-first content",
    url: "https://developers.google.com/search/docs/fundamentals/creating-helpful-content",
  },
  {
    kind: "spam_policies",
    label: "Spam policies for Google web search",
    url: "https://developers.google.com/search/docs/essentials/spam-policies",
  },
  {
    kind: "search_essentials",
    label: "Google Search Essentials",
    url: "https://developers.google.com/search/docs/essentials",
  },
  {
    kind: "gen_ai_content",
    label: "Google Search's guidance about AI-generated content",
    url: "https://developers.google.com/search/blog/2023/02/google-search-and-ai-content",
  },
  {
    kind: "search_central_blog",
    label: "Google Search Central blog",
    url: "https://developers.google.com/search/blog",
  },
];

/** The kind under which the rater guidelines are filed when somebody pastes them. */
export const RATER_GUIDELINES_KIND = "quality_rater_guidelines";

/**
 * The compiled rules, as they reach the model.
 *
 * ‼️ BOUNDED, AND THE PROBE ASSERTS IT. Every character here is paid on every Check press, three
 * times over on a page somebody is iterating on. If this grows past GUIDELINE_RULES_MAX it has
 * stopped being a compiled rule set and become the corpus again, which is the exact thing the
 * split above exists to prevent.
 *
 * ‼️ ONE BLOCK RULE, AND THE REST WARN. The page gate's own line: "a gate that blocks on taste gets
 * waived out of habit within a fortnight, and a rail everybody steps over is worse than no rail
 * because it looks like one." Most of Google's guidance is taste by that definition. The one slice
 * that is not is a factual claim about experience or credentials that no source carries, which is
 * publishable-and-false on a domain the client controls, under their name. That is the same shape
 * as the existing `unsupported` check, which is why it earns the same tier.
 */
export const GUIDELINE_RULES = [
  "GOOGLE'S PUBLISHED GUIDANCE, COMPILED. Judge the page against these and nothing else.",
  "",
  "EXPERIENCE (this one is a matter of fact, not of taste):",
  "  A claim of first-hand experience, credentials, qualifications, licences, years in business,",
  "  awards, certifications, or of having personally done, used or treated the thing, is a claim a",
  "  reader can check. List every one the page makes that the sources do not carry. Do not list a",
  "  claim the sources DO carry, however boastful it reads, and do not list an opinion.",
  "",
  "PEOPLE FIRST (taste, so report impressions rather than verdicts):",
  "  Was this written to help the reader, or to rank? Does it leave the reader feeling they have",
  "  learned enough to act, or does it restate the question at length and answer it thinly?",
  "  Does it read as one of many near-identical pages produced at scale?",
  "",
  "AUTHORITATIVENESS (taste):",
  "  Does anything on the page establish who is behind it and why they would know? Absence is worth",
  "  saying. Do not confuse it with the experience rule above: that one is about a claim that is",
  "  made and unbacked, this one is about nothing being said at all.",
  "",
  "SPAM: say so if the page is keyword-stuffed, is largely copied from somewhere else, exists only",
  "  to carry a link, or promises something the page does not deliver.",
].join("\n");

/** The ceiling the probe holds GUIDELINE_RULES to. */
export const GUIDELINE_RULES_MAX = 2000;
