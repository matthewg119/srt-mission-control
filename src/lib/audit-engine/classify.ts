// Business classification + 20-prompt generation for the Audit Engine. One Claude
// call, fully generic — there must never be an `if (vertical === "...")` branch
// anywhere in this file or its callers. Buyer language, not marketer language.

import { callClaudeJSON, type ClaudeModel } from "@/lib/claude-calls";
import type { SiteResearch } from "./site-research";
import type { ResearchSource } from "./types";

export type AuditBlock = "SERVICIO" | "COMPARATIVO" | "INFO" | "MARCA";

export interface AuditPrompt {
  block: AuditBlock;
  prompt: string;
}

export interface LikelyCompetitor {
  name: string;
  domain?: string;
}

export interface AuditClassification {
  business_name: string; // the actual proper-noun brand/business name (e.g. "Arpovo Health"), NOT the category
  business_type: string;
  vertical_slug: string;
  is_local: boolean; // false for online/national/B2B businesses with no single relevant city
  city_detected: string | null;
  city_confidence: "high" | "low";
  buyer_persona: string;
  prompts: AuditPrompt[];
  likely_competitors: LikelyCompetitor[];
}

export interface ClassifyOverrides {
  city?: string;
  competitors?: string[];
  /**
   * The name Matthew typed on a name-mode run. Same doctrine as `city`: a thing a human stated
   * outranks a thing the model inferred.
   *
   * ‼️ It matters more here than it looks. With no website there is no bare-domain token, so
   * buildAliases() runs on the business name ALONE and the name is the entire mention match.
   * A classifier that quietly renamed "Hernandez Complete Auto Repair" to "Hernandez Auto"
   * would not produce a slightly-off report, it would produce a score measuring a business
   * nobody asked about.
   */
  businessName?: string;
}

const BLOCKS: AuditBlock[] = ["SERVICIO", "COMPARATIVO", "INFO", "MARCA"];

function model(): ClaudeModel {
  return (process.env.ANTHROPIC_MODEL as ClaudeModel) || "claude-sonnet-4-6";
}

const SCHEMA_HINT = `{
  "business_name": string,          // the actual proper-noun brand name, e.g. "Arpovo Health" — NOT a category description
  "business_type": string,          // e.g. "TRT clinic", "online medical supply store"
  "vertical_slug": string,          // short kebab-case, e.g. "trt", "medical-supply"
  "is_local": boolean,              // false for online/national/B2B/shipped-anywhere businesses with no single relevant city
  "city_detected": string | null,   // "City, ST" format, or null if not local or not confidently found
  "city_confidence": "high" | "low", // meaningless when is_local is false — still return "low" then
  "buyer_persona": string,          // one line: who buys and what hurts
  "prompts": [ { "block": "SERVICIO" | "COMPARATIVO" | "INFO" | "MARCA", "prompt": string } ], // exactly 20
  "likely_competitors": [ { "name": string, "domain": string } ] // hypotheses only, confirmed later by real runs
}`;

function isAuditClassification(v: unknown): v is AuditClassification {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Partial<AuditClassification>;
  if (typeof c.business_name !== "string" || !c.business_name.trim()) return false;
  if (typeof c.business_type !== "string" || !c.business_type.trim()) return false;
  if (typeof c.vertical_slug !== "string" || !c.vertical_slug.trim()) return false;
  if (typeof c.is_local !== "boolean") return false;
  if (typeof c.buyer_persona !== "string" || !c.buyer_persona.trim()) return false;
  if (c.city_confidence !== "high" && c.city_confidence !== "low") return false;
  if (!Array.isArray(c.prompts) || c.prompts.length !== 20) return false;
  if (
    !c.prompts.every(
      (p) =>
        typeof p === "object" &&
        p !== null &&
        BLOCKS.includes((p as AuditPrompt).block) &&
        typeof (p as AuditPrompt).prompt === "string" &&
        (p as AuditPrompt).prompt.trim().length > 0
    )
  ) {
    return false;
  }
  if (!Array.isArray(c.likely_competitors)) return false;
  return true;
}

/** What the research text IS, in the model's words. On a search run it is looking at Yelp and
 *  Google listings, not at the business's own pages, and telling it otherwise produces a
 *  confident description of markup nobody read. */
function sourceFraming(source: ResearchSource): { intro: string; nameHint: string } {
  if (source === "site") {
    return {
      intro: "You are given raw text and structured hints scraped from a business's own website.",
      nameHint: "read it off the site's title/logo/footer, never invent one",
    };
  }
  // The one framing that is not about a site we failed to read: there is no site. Saying
  // "could not be read" here would invite the classifier to reason about a website that does
  // not exist, and everything downstream inherits that as a fact.
  if (source === "declared") {
    return {
      intro:
        "You are given a research profile of a business that has NO WEBSITE OF ITS OWN. It was assembled entirely from THIRD-PARTY sources (Google Business Profile, Yelp, Facebook, directories, review sites, local news). Treat it as other people reporting about the business. There is no website to describe, so never refer to their site, their pages, or anything on them, and never speculate about what a site of theirs might say.",
      nameHint: "read it off the directory and review listings, never invent one",
    };
  }
  const shared =
    "The business's own website could not be read, so this profile was assembled from THIRD-PARTY sources (Google Business Profile, Yelp, Facebook, directories, review sites). Treat it as reporting ABOUT the business, not as the business's own words, and never describe or make claims about their website itself.";
  if (source === "search") {
    return {
      intro: `You are given a research profile of a business. ${shared}`,
      nameHint: "read it off the directory and review listings, never invent one",
    };
  }
  return {
    intro:
      "You are given raw text scraped from a business's own website, which was too thin to classify from on its own, followed by a third-party research profile under a '--- Third-party research ---' heading. Use both; the site text is the business's own words, the research below it is other people reporting about them. Do not make claims about their website beyond what the site text itself shows.",
    nameHint: "read it off the site text or the listings, never invent one",
  };
}

function buildSystemPrompt(source: ResearchSource): string {
  const { intro, nameHint } = sourceFraming(source);
  return [
    "You are the classification brain for SRT Agency's AI-search-visibility audit tool.",
    intro,
    "Your job, in one response:",
    "",
    `1. Identify business_name (the actual proper-noun brand name this business trades under, e.g. 'Arpovo Health', 'Joe's Pizza' — ${nameHint}) and business_type in plain buyer language (e.g. 'TRT clinic', 'online medical supply store', 'HVAC contractor') — business_type is a category description, never a marketing label.`,
    "2. Determine is_local FIRST: is this a business a buyer walks into or that only serves one metro area (clinic, contractor, restaurant), or is it national/online/B2B/ships-anywhere ",
    "   (e-commerce store, SaaS, a distributor, a manufacturer)? Many real businesses are NOT local — set is_local to false for those, and do not try to force a city onto them.",
    "3. Only if is_local is true: determine city_detected — the city/region the business actually serves customers from — with city_confidence 'high' only if you have a clear signal ",
    "   (schema.org address/areaServed, a footer/contact address, a phone area code plus explicit city mention, etc). If you cannot find a confident signal, ",
    "   set city_confidence to 'low' and city_detected to your best guess or null — do NOT guess with false confidence. If is_local is false, set city_detected to null and city_confidence to 'low' (it's simply not applicable).",
    // Two examples from deliberately unrelated industries. buyer_persona is the one free-text
    // field the model invents, and it gets piped verbatim into every outreach email, so a
    // single medical example here used to pull industrial personas toward clinic vocabulary.
    "4. Write buyer_persona: one line, who buys and what hurts them, in the buyer's own words. Write it in the vocabulary of THIS business's own industry, never another one (e.g. for a clinic: 'a man in his 40s quietly worried his low energy is just aging'; for a control panel shop: 'a plant engineer whose line is down and who needs a UL 508A panel built right the first time'). Not marketing language like 'premium hormone optimization solutions'.",
    "5. Generate exactly 20 prompts a real buyer would type into ChatGPT/Perplexity/Google AI when researching this exact business type, split across 4 blocks:",
    "   - SERVICIO (~8): high-intent service search, e.g. 'best {business_type} in {city}' for a local business, or 'best place to buy {product} online' for a non-local one. Include the detected city in every one of these ONLY if is_local is true AND city_confidence is 'high' — never invent a geo-modifier for a national/online business.",
    "   - COMPARATIVO (~4): local vs. online/chain, or brand vs. brand comparisons — or, for non-local businesses, this-store vs. a marketplace/competitor. Include the city only under the same condition as above.",
    "   - INFO (~5): pre-purchase questions the buyer researches privately before ever contacting the business (concerns, side effects, 'is it worth it', how it works).",
    "   - MARCA (~3): brand-name queries, e.g. '{brand} reviews', 'is {brand} legit'.",
    "   Use real buyer language throughout — the way someone actually types into a search box, not marketing copy.",
    "6. List likely_competitors: 2-4 businesses you'd expect to also show up in these searches, based on the research text and general knowledge of the space. These are hypotheses ONLY — label them as such implicitly by putting them in this field, never present them as confirmed.",
    "",
    "Zero vertical-specific hardcoding: this same instruction set must work for a TRT clinic, a sausage shop, a law firm, or anything else — reason from the actual research text every time, never assume a vertical.",
  ].join("\n");
}

/** What the block of text below the header actually is. Kept beside sourceFraming() rather
 *  than inlined, so the system prompt and the user prompt cannot end up describing the same
 *  bytes two different ways. */
function researchLabel(source: ResearchSource): string {
  switch (source) {
    case "search":
      return "Third-party research profile (the site itself could not be read):";
    case "declared":
      return "Third-party research profile (this business has no website):";
    default:
      return "Visible page text (homepage + up to 2 inner pages):";
  }
}

function buildUserPrompt(research: SiteResearch, overrides?: ClassifyOverrides): string {
  const lines = [
    research.website
      ? `Website: ${research.website}`
      : "Website: NONE. This business has no website of its own.",
    research.siteName ? `Site name (og:site_name): ${research.siteName}` : "",
    research.title ? `Page title: ${research.title}` : "",
    research.metaDescription ? `Meta description: ${research.metaDescription}` : "",
    research.headings.length ? `Headings:\n${research.headings.map((h) => `- ${h}`).join("\n")}` : "",
    research.schemaHints.length
      ? `schema.org LocalBusiness/Organization data found:\n${JSON.stringify(research.schemaHints).slice(0, 2000)}`
      : research.source === "declared"
        ? "No schema.org data, because there are no pages to find it on."
        : "No schema.org LocalBusiness/Organization data found on the pages fetched.",
    "",
    researchLabel(research.source),
    research.bodyText,
  ];

  if (overrides?.businessName) {
    lines.push(
      "",
      `Matthew has manually confirmed the business name as: ${overrides.businessName}. Use it as business_name, and build the MARCA prompts on it. The one thing you may do instead is return a fuller trading name that CONTAINS it (for example "Hernandez Complete Auto Repair Inc" when he typed "Hernandez Complete Auto Repair"), if the sources show one. Never return a shorter or different name.`
    );
  }
  if (overrides?.city) {
    lines.push("", `Matthew has manually confirmed the city as: ${overrides.city}. Use this as city_detected with city_confidence "high" — do not override it.`);
  }
  if (overrides?.competitors?.length) {
    lines.push(
      "",
      `Matthew has manually named these competitors: ${overrides.competitors.join(", ")}. Include them in likely_competitors alongside any others you'd add.`
    );
  }

  return lines.filter(Boolean).join("\n");
}

export async function classifyBusiness(
  research: SiteResearch,
  overrides?: ClassifyOverrides
): Promise<AuditClassification> {
  const { data: raw } = await callClaudeJSON<AuditClassification>({
    model: model(),
    system: buildSystemPrompt(research.source),
    user: buildUserPrompt(research, overrides),
    schemaHint: SCHEMA_HINT,
    maxTokens: 4000,
    temperature: 0.4,
    validate: isAuditClassification,
  });

  // A confirmed name is pinned in CODE, not left to the prompt, for the same reason the city
  // override is: the prompt asks, and asking is not a guarantee. The one edit allowed is the
  // fuller trading name the prompt invites, recognised by containment rather than trusted, so
  // "Hernandez Complete Auto Repair Inc" survives and "Hernandez Auto" does not.
  const data = ((): AuditClassification => {
    const confirmed = overrides?.businessName?.trim();
    if (!confirmed) return raw;
    const returned = raw.business_name?.trim() ?? "";
    const isFullerForm = returned.toLowerCase().includes(confirmed.toLowerCase());
    return isFullerForm ? raw : { ...raw, business_name: confirmed };
  })();

  // Safety net, not a fabrication risk: never let a "high confidence" city ship
  // without an actual city string attached — downgrade instead of erroring out,
  // since asking the user is the fallback path, not a hard failure.
  if (data.is_local && data.city_confidence === "high" && !data.city_detected?.trim()) {
    return { ...data, city_confidence: "low" };
  }

  // Non-local businesses never need a city — force-clear it even if the model
  // slipped one in, so downstream code has one clean signal to check.
  if (!data.is_local) {
    return { ...data, city_detected: null, city_confidence: "low" };
  }

  if (overrides?.city) {
    return { ...data, is_local: true, city_detected: overrides.city, city_confidence: "high" };
  }

  return data;
}
