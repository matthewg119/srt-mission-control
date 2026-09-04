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

5. PLAIN MARKDOWN ONLY. Headings, paragraphs, lists. No links, no images, no HTML, no tables,
   and no horizontal rules: a heading already separates two sections.

6. NEVER USE AN EM DASH OR AN EN DASH. Use commas, periods or hyphens. This is absolute,
   it is checked character by character, and a section that breaks it is DROPPED rather
   than published. It is the rule this task fails most often, and it fails it in exactly
   one place: joining two clauses for emphasis. Write that as two sentences.

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
  if (hasBannedDash(d.title) || hasBannedDash(withoutRules(d.bodyMd))) return false;
  const key = d.leadMagnetKey;
  if (key === null || key === undefined) return true;
  // A key that names nothing is refused rather than stored. offerForPage deliberately does NOT
  // fall back to the ladder for a named key that resolves nothing, so storing an invented one
  // would give the page a pill that hands over nothing at all.
  return typeof key === "string" && validKeys.has(key);
}

/**
 * The body as the dash rule should see it: markdown thematic breaks removed.
 *
 * ‼️ A `---` SEPARATOR IS NOT A DASH, AND TREATING IT AS ONE COST FOUR PAGES OF A LIVE REPLICA.
 * copy-guard's BANNED is /[emdash endash horbar]|--/, and the `--` half is there to catch somebody
 * typing a double hyphen as punctuation. A line consisting only of hyphens is a horizontal rule,
 * which is BLOCK syntax and exactly what rule 5 asks for when it says plain markdown. Measured on
 * srtagency.com 2026-09-04: Home, Method, Pricing and Contact were all rejected, none of them
 * contained an em dash or an en dash, and every reported span was a "\n\n---\n\n" between two
 * headings. The three sections that survived were the three with no section breaks in them.
 *
 * Worse than the drop: the one correction that did land rewrote "Founding Offer - 5 spots" as
 * "Founding Offer. 5 spots", because a model told its copy contains a banned dash starts editing
 * hyphens that were never the problem. A false positive here does not just reject good work, it
 * teaches the retry to damage it.
 *
 * ‼️ THIS LOOSENS NOTHING. An em dash, an en dash, a horizontal bar and a double hyphen used as
 * punctuation all still fail, in the title and in the body. Only a line that is nothing but
 * hyphens is exempt, and a line that is nothing but hyphens cannot be punctuation.
 */
export function withoutRules(md: string): string {
  return md.replace(/^[ \t]*-{3,}[ \t]*$/gm, "");
}

/**
 * Every banned dash, quoted with enough of its sentence to be found and fixed in place.
 *
 * Bounded at five so one dash-happy draft cannot produce a correction prompt larger than the
 * section it is correcting.
 */
function dashSpans(...fields: string[]): string {
  const out: string[] = [];
  for (const field of fields) {
    for (const m of field.matchAll(/[\u2013\u2014]|--/g)) {
      const i = m.index ?? 0;
      out.push(JSON.stringify(field.slice(Math.max(0, i - 45), i + 45)));
      if (out.length >= 5) return out.join(", ");
    }
  }
  return out.length ? out.join(", ") : "(none found, which means the check and this message disagree)";
}

function whyInvalid(v: unknown, validKeys: Set<string>): string {
  if (!v || typeof v !== "object") return "not an object";
  const d = v as Record<string, unknown>;
  if (typeof d.title !== "string" || !d.title.trim()) return "title is missing or empty";
  if (typeof d.bodyMd !== "string" || !d.bodyMd.trim()) return "bodyMd is missing or empty";
  if (hasBannedDash(String(d.title)) || hasBannedDash(withoutRules(String(d.bodyMd)))) {
    // ‼️ THE OFFENDING SENTENCES ARE QUOTED BACK, AND WITHOUT THAT THE CORRECTION DOES NOT LAND.
    // callClaudeJSON gets exactly ONE correction attempt and hands the model this string. Told
    // only "there is an em dash somewhere", it rewrote the section from scratch and produced new
    // ones: a live run on srtagency.com lost Home, Method, Pricing and Contact that way, four of
    // seven sections, and kept only the three driest pages. The source text had no dashes in it
    // at all, so this is the model reaching for them in persuasive prose, not copying them.
    //
    // Naming the span makes the retry surgical, which is the same move draft-page.ts makes when
    // it quotes back a dangling evidence ref instead of saying "a ref is wrong". The rule itself
    // is untouched and still absolute: this changes what the model is TOLD, never what is allowed.
    return (
      "the copy contains an em dash or en dash, which is banned. Replace each one with a comma, " +
      "a period or a plain hyphen and change NOTHING else. The offending spans are: " +
      dashSpans(String(d.title), withoutRules(String(d.bodyMd)))
    );
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
