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
  business_type: string;
  vertical_slug: string;
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
  "business_type": string,          // e.g. "TRT clinic", "sausage shop"
  "vertical_slug": string,          // short kebab-case, e.g. "trt", "food-retail"
  "city_detected": string | null,   // "City, ST" format, or null if not confidently found
  "city_confidence": "high" | "low",
  "buyer_persona": string,          // one line: who buys and what hurts
  "prompts": [ { "block": "SERVICIO" | "COMPARATIVO" | "INFO" | "MARCA", "prompt": string } ], // exactly 20
  "likely_competitors": [ { "name": string, "domain": string } ] // hypotheses only, confirmed later by real runs
}`;

function isAuditClassification(v: unknown): v is AuditClassification {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Partial<AuditClassification>;
  if (typeof c.business_type !== "string" || !c.business_type.trim()) return false;
  if (typeof c.vertical_slug !== "string" || !c.vertical_slug.trim()) return false;
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
    "1. Identify the business_type in plain buyer language (e.g. 'TRT clinic', 'sausage shop', 'HVAC contractor') — never a marketing label.",
    "2. Determine city_detected — the city/region the business actually serves customers from — with city_confidence 'high' only if you have a clear signal ",
    "   (schema.org address/areaServed, a footer/contact address, a phone area code plus explicit city mention, etc). If you cannot find a confident signal, ",
    "   set city_confidence to 'low' and city_detected to your best guess or null — do NOT guess with false confidence.",
    "3. Write buyer_persona: one line, who buys and what hurts them, in the buyer's own words (e.g. 'a man in his 40s quietly worried his low energy is 'just aging'' — not 'premium hormone optimization solutions').",
    "4. Generate exactly 20 prompts a real buyer would type into ChatGPT/Perplexity/Google AI when researching this exact business type, split across 4 blocks:",
    "   - SERVICIO (~8): high-intent service search, e.g. 'best {business_type} in {city}', '{service} near me'. Include the detected city in every one of these IF city_confidence is 'high'.",
    "   - COMPARATIVO (~4): local vs. online/chain, or brand vs. brand comparisons. Include the city if it's a local business and confidence is 'high'.",
    "   - INFO (~5): pre-purchase questions the buyer researches privately before ever contacting the business (concerns, side effects, 'is it worth it', how it works).",
    "   - MARCA (~3): brand-name queries, e.g. '{brand} reviews', 'is {brand} legit'.",
    "   Use real buyer language throughout — the way someone actually types into a search box, not marketing copy.",
    "5. List likely_competitors: 2-4 businesses you'd expect to also show up in these searches, based on the research text and general knowledge of the space. These are hypotheses ONLY — label them as such implicitly by putting them in this field, never present them as confirmed.",
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
  if (data.city_confidence === "high" && !data.city_detected?.trim()) {
    return { ...data, city_confidence: "low" };
  }

  if (overrides?.city) {
    return { ...data, city_detected: overrides.city, city_confidence: "high" };
  }

  return data;
}
