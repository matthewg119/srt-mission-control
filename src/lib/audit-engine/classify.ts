// Business classification + 20-prompt generation for the Audit Engine. One Claude
// call, fully generic — there must never be an `if (vertical === "...")` branch
// anywhere in this file or its callers. Buyer language, not marketer language.

import { callClaudeJSON, type ClaudeModel } from "@/lib/claude-calls";
import { AWARENESS_STAGES, isAwarenessStage, type AwarenessSource, type AwarenessStage } from "./awareness";
import type { SiteResearch } from "./site-research";
import type { ResearchSource } from "./types";

export type AuditBlock = "SERVICIO" | "COMPARATIVO" | "INFO" | "MARCA";

export interface AuditPrompt {
  block: AuditBlock;
  prompt: string;
  /**
   * Where the person typing this sits, 5 (unaware) to 1 (most aware). See awareness.ts.
   *
   * ‼️ OPTIONAL IN THE TYPE AND NEVER ABSENT ON A NEW ROW. Every report written before 2026-09-15
   * lacks it, and nothing re-validates a stored row, so a reader must handle its absence. Every
   * writer since sets it: the classifier for its own twenty, awarenessOf() for everything else.
   */
  awareness?: AwarenessStage;
  /** Which of the two made the label. A `rule` label is a floor, not a judgement. */
  awareness_by?: AwarenessSource;
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
  "prompts": [ { "block": "SERVICIO" | "COMPARATIVO" | "INFO" | "MARCA", "prompt": string, "awareness": 1 | 2 | 3 | 4 | 5 } ], // exactly 20, awareness is an integer
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
        (p as AuditPrompt).prompt.trim().length > 0 &&
        // ‼️ IN THIS GATE, NOT A SECOND ONE, AND SHIPPED WITH THE PROMPT THAT ASKS FOR IT. A
        // validator demanding a field the prompt never asked for rejects the classification, and a
        // rejected classification kills the run AFTER the crawl and the paid research are bought.
        isAwarenessStage((p as AuditPrompt).awareness)
    )
  ) {
    return false;
  }
  if (!Array.isArray(c.likely_competitors)) return false;
  return true;
}

/**
 * Why a classification was rejected, in words the correction retry can act on.
 *
 * ‼️ THIS DID NOT EXIST, SO EVERY REJECTION RETRIED BLIND ("it did not match the required shape").
 * Adding the awareness field adds a new way to be rejected, and a blind retry of a twenty-row answer
 * is a coin toss spent on the most expensive call in the run. Named, the model fixes the one field.
 */
function whyNotClassification(v: unknown): string {
  const c = (v ?? {}) as Partial<AuditClassification>;
  if (!Array.isArray(c.prompts)) return "there was no prompts array";
  if (c.prompts.length !== 20) return `prompts has ${c.prompts.length} entries and it must have exactly 20`;
  const bad = c.prompts.findIndex((p) => !isAwarenessStage((p as AuditPrompt | null)?.awareness));
  if (bad >= 0) {
    return (
      `prompts[${bad}] has awareness ${JSON.stringify((c.prompts[bad] as AuditPrompt | null)?.awareness)}; ` +
      "every prompt needs awareness as a whole number from 1 to 5"
    );
  }
  const badBlock = c.prompts.findIndex((p) => !BLOCKS.includes((p as AuditPrompt | null)?.block as AuditBlock));
  if (badBlock >= 0) return `prompts[${badBlock}] has a block that is not one of ${BLOCKS.join(", ")}`;
  for (const field of ["business_name", "business_type", "vertical_slug", "buyer_persona"] as const) {
    if (typeof c[field] !== "string" || !(c[field] as string).trim()) return `${field} is missing or empty`;
  }
  if (typeof c.is_local !== "boolean") return "is_local must be true or false";
  if (c.city_confidence !== "high" && c.city_confidence !== "low") return 'city_confidence must be "high" or "low"';
  if (!Array.isArray(c.likely_competitors)) return "likely_competitors must be an array";
  return "it did not match the required shape";
}

/** "3" is a model being loose about a number, not a different answer. Anything else is left for the gate. */
function coerceAwareness(v: unknown): unknown {
  const c = v as Partial<AuditClassification> | null;
  if (!c || !Array.isArray(c.prompts)) return v;
  return {
    ...c,
    prompts: c.prompts.map((p) => {
      const a = (p as { awareness?: unknown } | null)?.awareness;
      return p && typeof a === "string" && /^[1-5]$/.test(a.trim()) ? { ...p, awareness: Number(a.trim()) } : p;
    }),
  };
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
    "   Give every prompt an awareness number: where the person typing it sits, judged from what they already know. 5 is least aware and 1 is most aware:",
    ...AWARENESS_STAGES.map((s) => `     ${s.stage} ${s.name}: ${s.means}.`),
    "   Judge the person, not the block. A brand query is usually 1, but an INFO question can be 5 or 3 depending on whether the person has even named the problem.",
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
  const { data: validated } = await callClaudeJSON<AuditClassification>({
    model: model(),
    system: buildSystemPrompt(research.source),
    user: buildUserPrompt(research, overrides),
    schemaHint: SCHEMA_HINT,
    maxTokens: 4000,
    temperature: 0.4,
    coerce: coerceAwareness,
    validate: isAuditClassification,
    describeInvalid: whyNotClassification,
  });

  // Stamped in code, never asked of the model: which of the two paths made a label is a fact about
  // this call, not something to generate.
  const raw: AuditClassification = {
    ...validated,
    prompts: validated.prompts.map((p) => ({ ...p, awareness_by: "classifier" as const })),
  };

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
