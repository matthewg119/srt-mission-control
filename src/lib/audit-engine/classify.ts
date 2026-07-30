// Business classification + 20-prompt generation for the Audit Engine. One Claude
// call, fully generic — there must never be an `if (vertical === "...")` branch
// anywhere in this file or its callers. Buyer language, not marketer language.

import { callClaudeJSON, type ClaudeModel } from "@/lib/claude-calls";
import type { SiteResearch } from "./site-research";

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

function buildSystemPrompt(): string {
  return [
    "You are the classification brain for SRT Agency's AI-search-visibility audit tool.",
    "You are given raw text and structured hints scraped from a business's own website.",
    "Your job, in one response:",
    "",
    "1. Identify business_name (the actual proper-noun brand name this business trades under, e.g. 'Arpovo Health', 'Joe's Pizza' — read it off the site's title/logo/footer, never invent one) and business_type in plain buyer language (e.g. 'TRT clinic', 'online medical supply store', 'HVAC contractor') — business_type is a category description, never a marketing label.",
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

function buildUserPrompt(research: SiteResearch, overrides?: ClassifyOverrides): string {
  const lines = [
    `Website: ${research.website}`,
    research.siteName ? `Site name (og:site_name): ${research.siteName}` : "",
    research.title ? `Page title: ${research.title}` : "",
    research.metaDescription ? `Meta description: ${research.metaDescription}` : "",
    research.headings.length ? `Headings:\n${research.headings.map((h) => `- ${h}`).join("\n")}` : "",
    research.schemaHints.length
      ? `schema.org LocalBusiness/Organization data found:\n${JSON.stringify(research.schemaHints).slice(0, 2000)}`
      : "No schema.org LocalBusiness/Organization data found on the pages fetched.",
    "",
    "Visible page text (homepage + up to 2 inner pages):",
    research.bodyText,
  ];

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
  const { data } = await callClaudeJSON<AuditClassification>({
    model: model(),
    system: buildSystemPrompt(),
    user: buildUserPrompt(research, overrides),
    schemaHint: SCHEMA_HINT,
    maxTokens: 4000,
    temperature: 0.4,
    validate: isAuditClassification,
  });

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
