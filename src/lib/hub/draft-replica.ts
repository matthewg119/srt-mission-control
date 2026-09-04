// One page of the replica: their own section, restated in their own words.
//
// ‼️ WHY THIS IS NOT draft-page.ts WITH A DIFFERENT PROMPT VARIABLE.
// draft-page.ts writes an ANSWER TO A QUESTION. Its whole brief is "a person typed this into
// ChatGPT and wants it answered", its output carries a `question`, and it emits QAPage JSON-LD
// on a page that is indexed on a client's domain. A replica section is none of those things: it
// is their About page, on our preview host, noindex, existing so a client recognises the thing
// they are being shown on a call. Folding the two together would mean one prompt hedging between
// two jobs, and the answer-page job is the one that earns money.
//
// ‼️ WHAT KEEPS THIS OUT OF OPTION (a). This is not a copy. A verbatim rehost of somebody's
// marketing copy is the crawl-and-rehost design that was refused, and it is refused for legal
// reasons that a different code path does not change. The model is given the page's visible text
// and asked to RESTATE what that page says, in the business's own terminology. If the output
// starts coming back as the source with the whitespace moved, that is a prompt failure and it is
// the failure to watch for.
//
// ‼️ draft-page.ts RULE 1 CARRIES OVER UNCHANGED AND IS THE OTHER HALF. Nothing invented: no
// prices, years, certifications, staff names, awards, guarantees, hours or service areas that
// the snapshot does not carry. A replica the client reads on a call and does not recognise is
// worse than no replica, and a replica that INVENTS a guarantee is worse than both.

import { callClaudeJSON } from "@/lib/claude-calls";
import { hasBannedDash } from "@/lib/copy-guard";
import type { EvidenceRef } from "@/lib/clients/page-evidence";
import type { MagnetChoice } from "@/lib/concierge/magnets";

export interface DraftedSection {
  title: string;
  bodyMd: string;
  /**
   * Which offer this section is written toward, by magnet_key, or null.
   *
   * ‼️ NULL IS A REAL ANSWER AND IS NOT A FAILURE. It means no offer in this client's catalogue
   * belongs at the end of this page, and the ladder in lib/concierge/magnets.ts then decides at
   * render time. Forcing a key would attach the nearest plausible offer to every page, which is
   * the same failure mode draft-page.ts describes for `sourceRef: null`: it would not improve the
   * offers, it would remove our ability to see which pages have none.
   */
  leadMagnetKey: string | null;
}

const SYSTEM = `You are rebuilding one page of a local business's own website, for that business
to look at.

WHAT THIS IS FOR, stated plainly. The business owner is going to be shown this page on a call.
They wrote the original. They will read your version and decide in about four seconds whether
this company understands their business. That is the only thing this page has to do.

WHAT YOU ARE GIVEN. The visible text of one page of their site, plus background about the
business. Nothing else exists. You cannot visit the page, you cannot look anything up, and there
is no other source.

YOUR JOB. Restate what THAT PAGE says, in THEIR terminology, at about the same length.

THE RULES, and each one exists because breaking it is worse than a thin page.

1. NOTHING INVENTED. Every fact must come from the supplied text. No prices, no years in
   business, no certifications, no staff names, no awards, no guarantees, no hours, no service
   areas, no phone numbers that are not in front of you. The owner is reading this and will
   catch you. If the page says little, your version says little.

2. NOT A COPY EITHER. Do not reproduce their sentences verbatim. Say the same things in clean
   prose. If you find yourself returning the input with the line breaks moved, you have done the
   wrong job.

3. THEIR WORDS FOR THEIR OWN WORK. If they call it a "consultation" do not call it an
   "appointment". If they name a treatment, a technique or a product, keep that name exactly.
   This is the single biggest thing that makes the page recognisable.

4. NO SELLING THAT THEY DID NOT DO. Match the register of the source. A calm services page stays
   calm. Do not add urgency, superlatives or a call to action that is not on their page.

5. PLAIN MARKDOWN ONLY. Headings, paragraphs, lists. No links, no images, no HTML, no tables.

6. NEVER USE AN EM DASH OR AN EN DASH. Use commas, periods or hyphens. This is absolute.

7. THE TITLE IS THEIRS. Use the page's own heading or nav label. Do not improve it.

THE OFFER. You are given a list of free things this business can offer a visitor, each with a
key. Pick the one a person finishing THIS page would actually want, and return its key. Return
null if none of them belongs here. It is a choice about where the page LEAVES the reader, and it
never appears in the body: something else hands it over. Do not write a pitch for it, do not
mention it, do not end the page by teeing it up.`;

interface SectionGrounding {
  clientName: string;
  navLabel: string;
  sourceUrl: string;
  sourceText: string;
  city: string | null;
  state: string | null;
  businessType: string | null;
  evidence: EvidenceRef[];
  magnets: MagnetChoice[];
}

function userPrompt(g: SectionGrounding): string {
  const lines: string[] = [];

  lines.push(`THE BUSINESS: ${g.clientName}`);
  if (g.businessType) lines.push(`WHAT THEY DO: ${g.businessType}`);
  const where = [g.city, g.state].filter(Boolean).join(", ");
  if (where) lines.push(`WHERE: ${where}`);
  lines.push("");

  lines.push(`THE PAGE YOU ARE REBUILDING: "${g.navLabel}" (${g.sourceUrl})`);
  lines.push("");
  lines.push("ITS VISIBLE TEXT, which is the only thing you may take facts about it from:");
  lines.push("---");
  lines.push(g.sourceText);
  lines.push("---");
  lines.push("");

  if (g.evidence.length > 0) {
    // Background, deliberately ranked below the page's own text. A fact the business told us in
    // an interview is true, but it is not what THIS page says, and a section page that grows a
    // paragraph the original never had stops being recognisable.
    lines.push(
      "BACKGROUND ON THE BUSINESS. Use only to get their terminology right, never to add a " +
        "topic this page does not cover:"
    );
    for (const e of g.evidence.slice(0, 12)) {
      lines.push(`[${e.ref}] ${e.label}${e.topic ? ` (${e.topic})` : ""}: ${e.content.slice(0, 600)}`);
    }
    lines.push("");
  }

  if (g.magnets.length > 0) {
    lines.push("THE FREE THINGS THIS BUSINESS CAN OFFER. Return the key of at most one, or null:");
    for (const m of g.magnets) {
      lines.push(`  ${m.magnetKey} - ${m.title}. ${m.promise} (${m.scope})`);
    }
  } else {
    // Said out loud rather than left as an empty section, so the model returns null on purpose
    // rather than inventing a key that resolves to nothing.
    lines.push("THERE ARE NO OFFERS CONFIGURED FOR THIS BUSINESS. Return null for leadMagnetKey.");
  }

  return lines.join("\n");
}

function isDrafted(v: unknown, validKeys: Set<string>): v is DraftedSection {
  if (!v || typeof v !== "object") return false;
  const d = v as Record<string, unknown>;
  if (typeof d.title !== "string" || !d.title.trim()) return false;
  if (typeof d.bodyMd !== "string" || !d.bodyMd.trim()) return false;
  if (hasBannedDash(d.title) || hasBannedDash(d.bodyMd)) return false;
  const key = d.leadMagnetKey;
  if (key === null || key === undefined) return true;
  // A key that names nothing is refused rather than stored. offerForPage deliberately does NOT
  // fall back to the ladder for a named key that resolves nothing, so storing an invented one
  // would give the page a pill that hands over nothing at all.
  return typeof key === "string" && validKeys.has(key);
}

function whyInvalid(v: unknown, validKeys: Set<string>): string {
  if (!v || typeof v !== "object") return "not an object";
  const d = v as Record<string, unknown>;
  if (typeof d.title !== "string" || !d.title.trim()) return "title is missing or empty";
  if (typeof d.bodyMd !== "string" || !d.bodyMd.trim()) return "bodyMd is missing or empty";
  if (hasBannedDash(String(d.title)) || hasBannedDash(String(d.bodyMd))) {
    return "the copy contains an em dash or en dash, which is banned. Use commas, periods or hyphens.";
  }
  const key = d.leadMagnetKey;
  if (typeof key === "string" && !validKeys.has(key)) {
    return `leadMagnetKey "${key}" is not one of the offered keys: ${[...validKeys].join(", ") || "(none)"}`;
  }
  return "unknown validation failure";
}

/**
 * Draft one replica section. Returns it for the caller to store; saves nothing and publishes
 * nothing, the same division draft-page.ts keeps.
 */
export async function draftSection(
  g: SectionGrounding
): Promise<{ ok: true; section: DraftedSection } | { ok: false; error: string }> {
  if (!g.sourceText.trim()) {
    return { ok: false, error: "That page had no readable text, so there is nothing to restate." };
  }

  const validKeys = new Set(g.magnets.map((m) => m.magnetKey));

  try {
    const res = await callClaudeJSON<DraftedSection>({
      model: "claude-sonnet-4-6",
      system: SYSTEM,
      user: userPrompt(g),
      maxTokens: 2000,
      temperature: 0.3,
      schemaHint: `{ "title": string, "bodyMd": string, "leadMagnetKey": string | null }`,
      validate: (v): v is DraftedSection => isDrafted(v, validKeys),
      describeInvalid: (v) => whyInvalid(v, validKeys),
    });
    return { ok: true, section: res.data };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export type { SectionGrounding };
