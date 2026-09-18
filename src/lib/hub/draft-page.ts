// A first draft of a hub page, from the question the audit actually ran.
//
// ‼️ READ THIS BEFORE MOVING IT ANYWHERE NEAR THE REVIEW TOOL.
// `src/lib/hub/review-assemble.ts` imports nothing and must keep importing nothing: FTC 16 CFR
// Part 465 regulates a tool that GENERATES review content its user did not write. That rule is
// about somebody else's words. A hub page is the CLIENT's own marketing copy on the client's own
// domain, published under their name after a person read it — the same thing an agency has always
// written for a client. Different artifact, different rule. Do not fold the two together.
//
// ‼️ IT DRAFTS. IT DOES NOT PUBLISH.
// The route saves what comes back as `status: 'draft'` and the Day-0 wall on `page_publish` is
// untouched. Nothing here can put a page on a client's live domain.
//
// What changed and why: the board offered the twenty questions and an empty textarea, and every
// page had to be typed from nothing. That is correct for accuracy and hopeless for throughput —
// the whole product is publishing answers to the questions a client is absent from, and one
// page at a time by hand is not a delivery pipeline.

import { callClaudeJSON } from "@/lib/claude-calls";
import { hasBannedDash } from "@/lib/copy-guard";
import { supabaseAdmin } from "@/lib/db";
import { researchWebsite, isThinResearch, type SiteResearch } from "@/lib/audit-engine/site-research";
import {
  loadNumberedEvidence,
  recordWebsiteSnapshot,
  type EvidenceRef,
} from "@/lib/clients/page-evidence";
import { magnetByKey, type LeadMagnet } from "@/lib/concierge/magnets";
import { audienceForClient } from "@/lib/concierge/for-client";
import type { PageOutline, OutlineGap, OutlineSection } from "@/lib/hub/pages";
import { getPostFormat, type PostFormat } from "@/config/post-formats";
import {
  DRAFT_STORY_RULES,
  OUTLINE_STORY_RULE,
  draftStoryLines,
  outlineStoryLines,
  resolveStories,
  storyFaults,
  EMPTY_STORY_CONTEXT,
  type StoryContext,
} from "@/lib/hub/page-stories";

/**
 * One assertion the page makes, and what it rests on.
 *
 * !! `sourceRef: null` IS A LEGAL AND REQUIRED ANSWER. It is the model saying out loud that a
 * claim has nothing behind it, and the publish gate's `unbacked_claims` check reads exactly
 * that. Forcing a ref for every claim would not remove unsupported claims from pages, it would
 * remove our ability to see them: the model would attach the nearest plausible source and the
 * page would look fully evidenced while asserting something nobody said.
 */
export interface EvidenceClaim {
  claim: string;
  sourceRef: string | null;
}

export interface DraftedPage {
  title: string;
  answerMd: string;
  metaDescription: string;
  evidenceUsed: EvidenceClaim[];
}

interface Grounding {
  clientName: string;
  question: string;
  /**
   * What he already wrote or dictated, when there is any. Null on the board's Draft it
   * button, which starts from nothing.
   */
  existingBody: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  website: string | null;
  businessType: string | null;
  buyerPersona: string | null;
  research: SiteResearch | null;
  alreadyPublished: string[];
  /** The evidence layer, numbered S1..Sn in the order the prompt prints them. */
  evidence: EvidenceRef[];
  /**
   * The free thing the concierge will offer on this page, when one was named before drafting.
   *
   * ‼️ IT IS CONTEXT, NOT A CALL TO ACTION, AND THE PROMPT SAYS SO IN THOSE WORDS. The magnet is
   * delivered by the widget, never by the body: `answerMd` already refuses markdown links and the
   * brief above already says a page that answers in one line and sells for six paragraphs is
   * worth nothing. What knowing the magnet buys is the opposite of a pitch, which is knowing
   * which question to leave standing at the end.
   */
  magnet: LeadMagnet | null;
  /**
   * The approved skeleton, when the page was outlined first. Its headings become the page's
   * subheadings and its gaps were answered as evidence, so `draft` fills a structure a person
   * already agreed to instead of inventing one.
   */
  outline: PageOutline | null;
  /**
   * The buyer and the necessary beliefs the outline's stories install. Loaded only when the outline
   * carries placed stories, so a page drafted without one costs no extra reads.
   */
  stories: StoryContext | null;
}

/**
 * How long one section is, in CHARACTERS.
 *
 * ‼️ CHARACTERS AND NOT WORDS, AND THE UNIT IS THE POINT. Matthew, 2026-09-14. The old rule was
 * "250 to 500 words" for a whole page, which at 6 to 14 sections is somewhere between 18 and 83
 * words a section: a caption. Measuring per section instead makes the floor mean something no
 * matter how many sections the subject wanted, and characters rather than words because a word
 * count is the thing a model pads to hit.
 *
 * Declared HERE, above SYSTEM, because SYSTEM interpolates it and OUTLINE_LIMITS further down
 * reads the same bounds. A const cannot be read before its own declaration is evaluated.
 */
export const SECTION_CHARS = { min: 250, max: 600 } as const;

/** Sections per page. OUTLINE_LIMITS carries the same numbers and the reasoning behind them. */
const SECTION_COUNT = { min: 6, max: 14 } as const;

const SYSTEM = `You write one answer page for a local business's own website.

WHO IS READING IT. A person who typed that question into ChatGPT, Google or a search box, has
not heard of this business, and wants the question answered. Not a customer yet. Not a fan.

WHAT THE PAGE IS FOR. It is published on the business's own domain so that an AI engine
answering that question has something of theirs to cite. That only works if the page actually
answers the question. A page that answers it in one line and then sells for six paragraphs is
worth nothing to the engine and nothing to the reader.

YOUR JOB, stated plainly. Answer the specific question using the supplied evidence. Do not
invent facts. Where the evidence does not support a claim, leave the claim out. Preserve the
business's own terminology and the way they explain their own work. Add general context only
where a source below actually carries it. Make the answer directly useful to the person who
asked the question.

That is the whole brief. You are not writing an article about a topic and you are not writing
marketing copy. A page assembled out of what anybody could say about this subject is worth
nothing here, because an engine can already say that without citing anybody.

THE RULES, and every one of them exists because breaking it is worse than a thin page.

1. ONLY WHAT YOU WERE GIVEN. Every fact about this business must come from the EVIDENCE below.
   No invented prices, no invented years in business, no invented certifications, staff names,
   awards, guarantees, hours or service areas. If no source says it, the page does not say it.
   This is published on their domain under their name and a reader can check it.

1b. YOU MUST DECLARE WHAT EACH CLAIM RESTS ON. Return evidenceUsed: one entry per substantive
   assertion the page makes about this business, each with the source ref it came from ("S2"),
   or null when the page asserts something no source supports. NULL IS AN HONEST ANSWER AND YOU
   WILL NOT BE PENALISED FOR IT. Attaching a source that does not actually say the thing is the
   only real failure here, and it is worse than the claim itself: it makes an unsupported
   sentence look checked. Generic background that asserts nothing about this business does not
   need an entry.

2. NO NUMBERS YOU WERE NOT GIVEN. No statistics, no percentages, no "studies show", no
   "most people". A cited statistic with no source is the fastest way to make the page a
   liability.

3. NO COMPETITOR IS NAMED. Not favourably, not unfavourably, not "unlike some clinics".

4. NO OUTCOME PROMISES. Nothing about results, guarantees, or what the reader will achieve.

5. NO EM DASHES. Use commas, periods or plain hyphens. This is a hard rule and it is checked
   in code.

6. ANSWER FIRST. The first paragraph answers the question directly, in plain words, as though
   a person asked it out loud. Everything after that is detail. Never open with a greeting,
   never open with "when it comes to", never open by restating the question.

7. WHERE THE EVIDENCE IS THIN, DROP THE SECTION. DO NOT THIN IT. A short honest page beats a
   padded one, and this is the one rule that decides what "short" means: if you cannot fill a
   section to the length in SHAPE from what you were given, leave that section OUT entirely
   rather than writing two lines under its heading. Fewer, complete sections is the correct
   outcome and nothing here penalises it. A heading with a sentence under it is worse than no
   heading: it promises an answer and delivers a caption, and both the reader and the engine
   reading it can tell. Never add a section because a page of this kind usually has one.

8. WHAT, WHY AND HOW, ON EVERY PAGE. Say what the thing is, why it matters to the person who
   asked, and how it actually works. A page that only defines something has answered a dictionary
   question, not the one that was typed. This is checked in code against the subheadings.

SHAPE. Markdown. Open with the direct answer, before any subheading, and that opening is held to
the same length as a section. Then ${SECTION_COUNT.min} to ${SECTION_COUNT.max} "##" subheadings: the subject decides how many, and
each one is a question phrased the way the reader would ask it out loud.

${SECTION_CHARS.min} TO ${SECTION_CHARS.max} CHARACTERS UNDER EVERY HEADING, AND UNDER THE OPENING. Characters, not words, and it
is checked in code on each one separately rather than across the page, so a full section cannot
carry six thin ones. Under the floor the section is a caption; over the ceiling it is answering
two questions and the second one needs its own heading.

Short paragraphs, one idea each. No H1: the title is rendered separately. No links, no images, no
tables, no bullet list longer than five items.

TITLE. How a person would say the question, not the raw prompt string. Under 60 characters.

META DESCRIPTION. One sentence, under 155 characters, that answers the question. Not a teaser.`;

/**
 * Is every declared source ref one we actually supplied?
 *
 * !! A REF THAT DOES NOT EXIST IS THE ONE FAILURE THIS WHOLE LAYER IS BUILT TO CATCH.
 * An invented "S9" is worse than a null: null is a claim marked as unsupported, which the gate
 * blocks on and a person then fixes, while a dangling ref is an unsupported claim wearing a
 * citation. It fails validation so it goes into callClaudeJSON's correction retry with the
 * reason quoted back, exactly as the em dash rule does.
 */
function refsAreReal(d: DraftedPage, valid: Set<string>): boolean {
  return d.evidenceUsed.every(
    (c) => c.sourceRef === null || (typeof c.sourceRef === "string" && valid.has(c.sourceRef))
  );
}

/**
 * A cited review must actually be QUOTED, not described.
 *
 * ‼️ THIS IS THE HALF OF THE FTC LINE THAT A TYPE CANNOT HOLD. Everywhere else in this file the
 * schema is the enforcement: SkinRead has no field for markup, so a skin cannot carry a layout.
 * Here the model is handed a real person's sentence and asked not to improve it, and there is no
 * shape that prevents improving it. So it is verified: if the draft cites a CUSTOMER_REVIEW ref,
 * a run of that review's own words has to appear in the body.
 *
 * The window is a whole sentence of the source, or the whole source when it is shorter than one.
 * That is deliberately generous: quoting two sentences out of five is normal editing, and
 * requiring the entire review would push somebody toward citing nothing. What it catches is the
 * failure that matters, which is "our customers rave about the results [S3]" with none of S3 on
 * the page.
 *
 * Whitespace is normalised on both sides because markdown rewraps lines. Nothing else is.
 */
const MIN_QUOTE_CHARS = 40;

function quotesAreVerbatim(d: DraftedPage, reviews: Map<string, string>): boolean {
  return missingQuoteRefs(d, reviews).length === 0;
}

function missingQuoteRefs(d: DraftedPage, reviews: Map<string, string>): string[] {
  if (reviews.size === 0) return [];
  const body = flat(d.answerMd);

  const cited = new Set(
    d.evidenceUsed
      .map((c) => c.sourceRef)
      .filter((r): r is string => typeof r === "string" && reviews.has(r))
  );

  const missing: string[] = [];
  for (const ref of cited) {
    const source = flat(reviews.get(ref) as string);
    if (!source) continue;

    // The whole thing, for a review shorter than one sentence.
    if (source.length <= MIN_QUOTE_CHARS) {
      if (!body.includes(source)) missing.push(ref);
      continue;
    }

    const runs = source
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= MIN_QUOTE_CHARS);

    const quoted =
      body.includes(source) || runs.some((r) => body.includes(r));
    if (!quoted) missing.push(ref);
  }
  return missing;
}

/** Collapse every run of whitespace, so a rewrapped line still matches its source. */
function flat(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Split a body into its "## " sections, each with the prose under it.
 *
 * Anything before the first heading is the answer-first opening paragraph, which rule 6 asks for
 * and which has no heading by design. It is returned as a section with an empty heading so the
 * length rule applies to it too: an opening line that trails off is the same fault as a thin
 * section, and it is the first thing a reader sees.
 */
export function bodySections(answerMd: string): Array<{ heading: string; body: string }> {
  const out: Array<{ heading: string; body: string }> = [];
  let heading = "";
  let buffer: string[] = [];

  const flush = () => {
    const body = buffer.join("\n").trim();
    if (heading || body) out.push({ heading, body });
    buffer = [];
  };

  for (const line of answerMd.split(/\r?\n/)) {
    const m = /^##\s+(.+?)\s*$/.exec(line);
    if (m) {
      flush();
      heading = m[1];
    } else {
      buffer.push(line);
    }
  }
  flush();
  return out.filter((s) => s.heading !== "" || s.body !== "");
}

/**
 * Every section that is outside SECTION_CHARS, in words, for the correction retry.
 *
 * ‼️ THIS REPLACED A FLAT `>= 120 words` ON THE WHOLE PAGE, and the old rule was passing exactly
 * the page this one catches: four full sections and six one-line ones clears 120 words easily
 * while being mostly captions. The floor only means something when it is per section.
 *
 * The MAXIMUM is a fault too, which the old rule had no equivalent of. A section that runs long
 * is one that answered two questions, and the second one deserved its own heading and its own
 * long tail.
 */
export function sectionLengthFaults(answerMd: string): string[] {
  const out: string[] = [];
  for (const [i, section] of bodySections(answerMd).entries()) {
    const where = section.heading ? `"${section.heading}"` : `the opening paragraph`;
    const n = section.body.length;
    if (n < SECTION_CHARS.min) {
      out.push(`Section ${i + 1}, ${where}, is ${n} characters. Every section needs at least ${SECTION_CHARS.min}.`);
    } else if (n > SECTION_CHARS.max) {
      out.push(
        `Section ${i + 1}, ${where}, is ${n} characters and the limit is ${SECTION_CHARS.max}. ` +
          `It is answering two questions. Keep the one the heading asks.`
      );
    }
  }
  return out;
}

function isDrafted(v: unknown, valid: Set<string>, reviews: Map<string, string>): v is DraftedPage {
  const d = v as DraftedPage;
  return (
    !!d &&
    Array.isArray(d.evidenceUsed) &&
    d.evidenceUsed.every(
      (c) => !!c && typeof c.claim === "string" && c.claim.trim().length > 0 && "sourceRef" in c
    ) &&
    refsAreReal(d, valid) &&
    quotesAreVerbatim(d, reviews) &&
    typeof d.title === "string" &&
    d.title.trim().length > 0 &&
    d.title.length <= 90 &&
    typeof d.answerMd === "string" &&
    // Per section, not per page. See sectionLengthFaults for why the flat word floor went.
    sectionLengthFaults(d.answerMd).length === 0 &&
    typeof d.metaDescription === "string" &&
    d.metaDescription.trim().length > 0 &&
    d.metaDescription.length <= 200 &&
    // ‼️ THE DASH RULE IS CHECKED, NOT ASKED FOR. Same precedent as noDashes() in the email
    // lane: a prose ban is not a ban, and the model emits them anyway. A failure here goes into
    // callClaudeJSON's correction retry with the reason quoted back at it.
    !hasBannedDash(d.title) &&
    !hasBannedDash(d.answerMd) &&
    !hasBannedDash(d.metaDescription) &&
    // An H1 would collide with the title the page template renders.
    !/^#\s/m.test(d.answerMd) &&
    // Markdown links are the easiest way for a model to invent a citation.
    !/\]\(/.test(d.answerMd)
  );
}

function whyInvalid(v: unknown, valid: Set<string>, reviews: Map<string, string>): string {
  const d = v as DraftedPage;
  if (!d || typeof d.answerMd !== "string") return "answerMd is missing.";

  if (!Array.isArray(d.evidenceUsed)) {
    return "evidenceUsed is missing. Return one entry per claim the page makes about this business, each with the source ref it came from or null.";
  }
  if (d.evidenceUsed.some((c) => !c || typeof c.claim !== "string" || !c.claim.trim())) {
    return "An evidenceUsed entry has no claim text.";
  }
  const bad = d.evidenceUsed
    .map((c) => c.sourceRef)
    .filter((r): r is string => typeof r === "string" && !valid.has(r));
  if (bad.length) {
    return (
      `evidenceUsed cites ${bad.join(", ")}, which ${bad.length === 1 ? "is not a source" : "are not sources"} you were given. ` +
      `Use only the refs listed in the EVIDENCE block, or null if nothing supports the claim. ` +
      `Null is the correct answer when nothing does.`
    );
  }

  const unquoted = Array.isArray(d.evidenceUsed) ? missingQuoteRefs(d, reviews) : [];
  if (unquoted.length) {
    return (
      `${unquoted.join(", ")} ${unquoted.length === 1 ? "is a customer's own published review" : "are customers' own published reviews"} and you cited ` +
      `${unquoted.length === 1 ? "it" : "them"} without quoting ${unquoted.length === 1 ? "it" : "them"}. ` +
      `Put the review's own words on the page inside quotation marks, character for character, ` +
      `typos included, or drop the citation. A sentence describing what customers say is not a ` +
      `quote, and a tidied quote is a review the customer never wrote.`
    );
  }

  // ‼️ EVERY BAD SECTION AT ONCE, NOT THE FIRST. Returned one at a time this costs one correction
  // retry per thin section, and a 14-section page would exhaust the retries before it was right.
  const lengths = sectionLengthFaults(d.answerMd);
  if (lengths.length) {
    return (
      `Every "##" section has to be ${SECTION_CHARS.min} to ${SECTION_CHARS.max} characters of prose. Fix all of these ` +
      `and return the whole page again:\n${lengths.map((f) => `  - ${f}`).join("\n")}`
    );
  }
  if (hasBannedDash(d.answerMd) || hasBannedDash(d.title) || hasBannedDash(d.metaDescription)) {
    return "An em dash is present. Rewrite those sentences with commas, periods or plain hyphens.";
  }
  if (/^#\s/m.test(d.answerMd)) return "answerMd contains an H1. The title is rendered separately, so use ## at most.";
  if (/\]\(/.test(d.answerMd)) return "answerMd contains a markdown link. Links are not allowed on this page.";
  if (typeof d.title !== "string" || !d.title.trim()) return "title is missing.";
  if (d.title.length > 90) return `title is ${d.title.length} characters. Keep it under 60.`;
  if (typeof d.metaDescription !== "string" || !d.metaDescription.trim()) return "metaDescription is missing.";
  if (d.metaDescription.length > 200) return `metaDescription is ${d.metaDescription.length} characters. Keep it under 155.`;
  return "The payload did not match the shape.";
}

/**
 * The magnet this page is being written toward, resolved by key.
 *
 * ‼️ THE AUDIENCE COMES OFF THE TENANT ROW AND IS NOT ASSUMED. `magnetByKey` is audience-scoped
 * precisely so a chain cannot hop the firewall between the owner and patient catalogues, and
 * passing a guessed audience here would open the hole the scoping closes. A client with no
 * concierge row has no widget, so there is nothing to write toward and null is correct.
 */
async function magnetFor(clientId: string, magnetKey: string | null): Promise<LeadMagnet | null> {
  if (!magnetKey?.trim()) return null;

  const audience = await audienceForClient(clientId);
  if (!audience) return null;

  return magnetByKey(magnetKey.trim(), audience);
}

async function gather(
  clientId: string,
  question: string,
  existingBody: string | null,
  pageId: string | null,
  magnetKey: string | null,
  outline: PageOutline | null = null
): Promise<Grounding | { error: string }> {
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, legal_name, dba_name, city, state, phone, website, domain, contact_id")
    .eq("id", clientId)
    .maybeSingle();

  if (!client) return { error: "That client could not be read." };

  const name = ((client.dba_name || client.legal_name) as string | null) ?? null;
  if (!name) return { error: "This client has no name on file." };

  // The classifier's read on who buys and what they sell, from whichever audit this client's
  // contact has. Optional: a client with no audit still gets a page, it is just less targeted.
  //
  // intake_answers and call_notes are NOT read here even though they live on this row. They are
  // verbatim first-party text and a claim has to be able to point at them, so they come in
  // through loadNumberedEvidence() as numbered sources rather than as prose in the preamble.
  const { data: report } = client.contact_id
    ? await supabaseAdmin
        .from("audit_reports")
        .select("business_type, buyer_persona, city")
        .eq("contact_id", client.contact_id as string)
        .eq("status", "done")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };

  // ‼️ THE SITE IS READ LIVE RATHER THAN FROM A CACHED BLOB, and that is deliberate. Nothing
  // persists the crawl: audit_reports keeps site_signals and the classifier's conclusions, not
  // the body text. Re-reading costs one fetch and means the page is written from what the
  // business says about itself TODAY, which is the only thing standing between this and
  // invented copy. A failed fetch is not fatal; it just narrows what the page may claim.
  const website = (client.website as string | null) ?? null;
  const research = website
    ? await researchWebsite(website).catch(() => null)
    : null;

  // ‼️ THE CRAWL IS NOW KEPT, and that is the fix rather than a nicety. It was read on every
  // draft and discarded, so a published page written from it had no record of what it was
  // written from and the gate had nothing to check an asserted number against. One current row
  // per URL, refreshed here: an old crawl asserted as today's fact is worse than no row.
  if (website && research && !research.blocked && !isThinResearch(research)) {
    await recordWebsiteSnapshot({
      clientId,
      url: website,
      content: [research.title, research.metaDescription, ...research.headings, research.bodyText]
        .filter(Boolean)
        .join("\n"),
    }).catch((e) => {
      console.error("[hub/draft-page] website snapshot failed:", (e as Error).message);
    });
  }

  // Read AFTER the snapshot write, so the crawl that grounds this draft is one of the sources
  // this draft is allowed to cite. Numbered by the shared helper, never here: the refs written
  // into evidence_map are read back by the gate, and two numbering schemes would make every
  // stored ref point at a different source than the one it was written against.
  const evidence = await loadNumberedEvidence(clientId, pageId);

  const stories = outline?.stories?.some((s) => s.heading)
    ? await (await import("@/lib/clients/story-context")).storyContextFor(clientId)
    : null;

  return {
    clientName: name,
    question,
    existingBody,
    evidence,
    magnet: await magnetFor(clientId, magnetKey),
    outline,
    stories,
    city: (client.city as string | null) ?? (report?.city as string | null) ?? null,
    state: (client.state as string | null) ?? null,
    phone: (client.phone as string | null) ?? null,
    website,
    businessType: (report?.business_type as string | null) ?? null,
    buyerPersona: (report?.buyer_persona as string | null) ?? null,
    research: research && !research.blocked ? research : null,
    // Read directly rather than through listPublished(): that one is cached and published-only,
    // and a DRAFT of the same question is just as much a duplicate as a live page is.
    alreadyPublished: (
      (
        await supabaseAdmin
          .from("client_pages")
          .select("question")
          .eq("client_id", clientId)
          .neq("status", "archived")
      ).data ?? []
    ).map((r) => r.question as string),
  };
}

function userPrompt(g: Grounding): string {
  const lines: string[] = [
    `THE QUESTION THIS PAGE ANSWERS, verbatim as the audit ran it:`,
    g.question,
    "",
    `THE BUSINESS: ${g.clientName}`,
  ];

  if (g.city) lines.push(`Location: ${[g.city, g.state].filter(Boolean).join(", ")}`);
  if (g.businessType) lines.push(`What they are: ${g.businessType}`);
  if (g.buyerPersona) lines.push(`Who buys and what hurts: ${g.buyerPersona}`);

  lines.push("");

  // ‼️ THE EVIDENCE BLOCK GOES ABOVE THE WEBSITE, AND THE ORDER IS THE ARGUMENT.
  // What the provider said in their own voice about their own patients is the thing an engine
  // cannot get anywhere else, and it is the only reason this page is worth citing rather than
  // the twenty other pages answering the same question. A model given the website first and the
  // dictation second writes the website's page and sprinkles his words on top.
  if (g.evidence.length) {
    lines.push("EVIDENCE. This is what the page may be built from, and the ONLY place its facts");
    lines.push("about this business may come from. Each source has a ref. Cite the ref in");
    lines.push("evidenceUsed for every claim you take from it.");
    lines.push("");
    for (const e of g.evidence) {
      lines.push(
        `[${e.ref}] ${e.label}${e.topic ? `, on ${e.topic}` : ""} (about ${e.scope})`
      );
      lines.push(e.content);
      lines.push("");
    }
    lines.push(
      "Where these sources disagree with the website below, THE SOURCES WIN: they are more"
    );
    lines.push("recent and they came from the person doing the work.");
    lines.push("");

    // ‼️ THE ONE SOURCE TYPE THAT MAY NOT BE PARAPHRASED, AND THE RULE IS ALSO CHECKED BELOW.
    // A model handed somebody else's sentence will smooth it, because that is what being
    // helpful looks like everywhere else in this prompt. Here the smoothing is the failure:
    // the page publishes the tidied version under a real customer's name, and that is a review
    // WE wrote. quotesAreVerbatim() enforces it after the fact, because a prose ban is not a
    // ban, the same reason the dash rule is checked rather than asked for.
    if (g.evidence.some((e) => e.type === "CUSTOMER_REVIEW")) {
      lines.push("ONE OF THOSE SOURCES IS A CUSTOMER'S OWN PUBLISHED REVIEW. If you use it:");
      lines.push("- Reproduce it inside quotation marks, character for character, typos and all.");
      lines.push("- Do not correct spelling, grammar, punctuation or capitalisation.");
      lines.push("- Do not shorten it, do not summarise it, do not merge two reviews into one.");
      lines.push("- Do not write a sentence that describes what customers say instead of quoting");
      lines.push("  one. If you cite a review ref, the review's own words must appear on the page.");
      lines.push("- If it does not fit what this page is about, do not cite it. That is allowed.");
      lines.push("");
    }
  } else {
    // Absent beats forbidden, said out loud, the same move the no-website branch makes below.
    lines.push("NO EVIDENCE HAS BEEN COLLECTED FOR THIS PAGE. Nobody has dictated an answer and");
    lines.push("no document has been filed. Write only what the website below supports, keep it");
    lines.push("short, and return sourceRef null for anything you cannot trace. A thin draft is");
    lines.push("the correct outcome and a person will fill it in.");
    lines.push("");
  }

  if (g.research && !isThinResearch(g.research)) {
    lines.push("THEIR OWN WEBSITE, as a further source. It is what the business says about itself");
    lines.push("in public. It does not outrank the evidence above.");
    lines.push("");
    if (g.research.title) lines.push(`Page title: ${g.research.title}`);
    if (g.research.metaDescription) lines.push(`Description: ${g.research.metaDescription}`);
    if (g.research.headings.length) {
      lines.push(`Headings: ${g.research.headings.slice(0, 25).join(" | ")}`);
    }
    lines.push("");
    lines.push(g.research.bodyText.slice(0, 12000));
  } else {
    // ‼️ ABSENT BEATS FORBIDDEN, and it is stated out loud rather than left silent. The same
    // move miniCheckContext makes in the no-website lane: a model given no source and no
    // acknowledgement that there is no source will fill the gap confidently.
    lines.push("THEIR WEBSITE COULD NOT BE READ.");
    if (g.evidence.length) {
      // The evidence block is still standing, so this is a narrower statement than it used to
      // be: no website is not the same as no sources any more.
      lines.push("The evidence above is therefore everything you have about this business.");
      lines.push("Assert nothing that is not in it: no services, prices, history, staff,");
      lines.push("equipment or hours that no source mentions.");
    } else {
      lines.push("Combined with the empty evidence block above, you have NO source of facts about");
      lines.push("this business beyond the three lines at the top. Write a page that answers the");
      lines.push("question in general terms for someone in this category and this city, and assert");
      lines.push("nothing specific about this business: no services, no prices, no history, no");
      lines.push("staff, no equipment, no hours. A shorter page is the correct outcome here.");
    }
  }

  // ‼️ HIS OWN WORDS OUTRANK EVERYTHING ELSE IN THIS PROMPT, AND THE JOB CHANGES SHAPE.
  // Without a body this function writes a page from the audit and the website. With one the
  // page has already been written, by him, out loud, and the only honest job left is to tidy
  // it. A model handed a dictated draft and the ordinary "write a page" instruction does not
  // tidy it: it writes its own page and quietly drops whatever he said that it would not have
  // thought of, which is the half worth keeping. Same doctrine as intake_answers and the call
  // notes, where what a human actually said outranks anything generic.
  if (g.existingBody) {
    lines.push("");
    lines.push("‼️ HE HAS ALREADY WRITTEN THIS PAGE. What follows is his own draft, dictated or");
    lines.push("typed. YOUR JOB IS TO TIDY IT, NOT TO REPLACE IT:");
    lines.push("  - Keep his points, his order, his opinions and his examples. All of them.");
    lines.push("  - Fix what speech does to text: false starts, repetition, run-ons, filler.");
    lines.push("  - Add headings, paragraph breaks and lists so it reads on a page.");
    lines.push("  - You may NOT add a fact, a number, a service, a price or a claim that is not");
    lines.push("    already in his draft or on the website above. If he did not say it, it does");
    lines.push("    not go in. A shorter page is the correct outcome.");
    lines.push("  - You may NOT contradict him, soften a position he took, or add a hedge.");
    lines.push("");
    lines.push("HIS DRAFT:");
    lines.push(g.existingBody.slice(0, 12000));
  }

  // ‼️ THE OUTLINE IS STRUCTURE, NOT EVIDENCE, AND THE PROMPT SAYS SO. It was written by a model,
  // so nothing in it may be asserted as a fact about the business. What it contributes is the
  // shape somebody approved and the gaps they answered, and those answers are already numbered in
  // the EVIDENCE block above, where they can be cited.
  if (g.outline && !g.existingBody) {
    lines.push("");
    lines.push("THE APPROVED OUTLINE. Follow it:");
    lines.push("  - Use these headings as your ## subheadings, in this order, VERBATIM. A person");
    lines.push("    approved these words and each one is the search that section has to win.");
    lines.push(`  - ${SECTION_CHARS.min} to ${SECTION_CHARS.max} characters under each heading, as SHAPE says. That rule is per`);
    lines.push("    section and this outline is what tells you how many sections there are.");
    lines.push("  - Cover what each bullet says, in your own sentences.");
    lines.push("  - A [Gn] mark is a gap the business was asked to fill. Its answer is in the EVIDENCE");
    lines.push("    under a topic beginning \"Gap Gn\". Use it and cite it. Where a gap has no answer,");
    lines.push("    leave that point out rather than filling it.");
    lines.push("  - A SECTION YOU CANNOT FILL TO LENGTH IS DROPPED, HEADING AND ALL. Rule 7. The");
    lines.push("    outline is what was planned; the evidence decides what survives. Returning six");
    lines.push("    complete sections out of eleven planned is a correct answer.");
    lines.push("  - The bullets are notes, not facts. Assert nothing from them that no source carries.");
    // ‼️ STORIES ARE TOLD WHERE THE SKELETON PLACED THEM, and only there (F2). The unplaced ideas stay on
    // the outline for posts and are not printed, so the drafter cannot pile a second story into a page.
    const placed = (g.outline.stories ?? []).filter((s) => s.heading);
    const sourceRefs = new Map(
      g.evidence.filter((e) => e.sourceId).map((e) => [e.sourceId as string, e.ref] as const)
    );
    if (placed.length) for (const rule of DRAFT_STORY_RULES) lines.push(rule);
    lines.push("");
    for (const section of g.outline.sections) {
      lines.push(`## ${section.heading}`);
      // ‼️ PRINTED AS THE SEARCH, NOT AS A TARGET. A model told to "include this phrase" welds it
      // in twice a paragraph, which is what keyword_shaped in page-gate.ts fails a page for. What
      // it needs to know is what the reader typed, so the section answers THAT rather than the
      // heading's nearest paraphrase.
      if (section.keyword) lines.push(`     (what the reader typed to get here: ${section.keyword})`);
      for (const bullet of section.bullets) lines.push(`  - ${bullet}`);
      const story = placed.find((s) => s.heading === section.heading);
      if (story) lines.push(...draftStoryLines(story, g.stories ?? EMPTY_STORY_CONTEXT, sourceRefs));
    }
    lines.push("");
  }

  // ‼️ LAST, SO IT CANNOT BECOME THE BRIEF. Everything above decides what the page says; this
  // only decides what it deliberately leaves open. Placed before the evidence it would read as
  // the goal, and a model given a goal writes toward it.
  if (g.magnet) {
    lines.push("");
    lines.push("WHAT THE READER IS OFFERED AFTERWARDS, and it is NOT written on this page.");
    lines.push(`A chat widget on this page offers them: ${g.magnet.title}`);
    lines.push(`What that gives them: ${g.magnet.promise}`);
    lines.push("");
    lines.push("‼️ DO NOT MENTION IT, DO NOT LINK TO IT, DO NOT WRITE A CALL TO ACTION AND DO NOT");
    lines.push("WRITE A CLOSING PARAGRAPH ABOUT GETTING IN TOUCH. The widget does that, and a page");
    lines.push("that sells is worth nothing to the engine that has to cite it.");
    lines.push("");
    lines.push("What this is for: answer the question fully and honestly, and let it end at the");
    lines.push("point where the offer above is the obvious next thing a reader would want. Answer");
    lines.push("the general question completely; do not do for THIS reader the specific piece of");
    lines.push("work the offer is. If the page can only be finished by inventing something you");
    lines.push("were not given, stop there instead. Nothing about this changes the rules above.");
  }

  if (g.alreadyPublished.length) {
    lines.push("");
    lines.push("ALREADY PUBLISHED for this business, so do not answer these again:");
    for (const q of g.alreadyPublished.slice(0, 20)) lines.push(`  - ${q}`);
  }

  return lines.join("\n");
}

/**
 * Draft one page. Returns the draft for a human to edit, never saves and never publishes.
 *
 * `existingBody` is the page studio's `polish`. Without it this is unchanged and writes a page
 * from the audit and the website, which is what the board's Draft it button does. With it, the
 * model is tidying HIS draft under a prompt that forbids adding anything he did not say.
 *
 * `magnetKey` is the offer chosen BEFORE the page is written. It never appears in the body: it
 * tells the model where to stop, so the thing the widget hands over is still worth having.
 */
export async function draftPage(
  clientId: string,
  question: string,
  opts?: {
    existingBody?: string | null;
    pageId?: string | null;
    magnetKey?: string | null;
    outline?: PageOutline | null;
  }
): Promise<{ ok: true; page: DraftedPage } | { ok: false; error: string }> {
  if (!question.trim()) return { ok: false, error: "No question was given." };

  const g = await gather(
    clientId,
    question.trim(),
    opts?.existingBody?.trim() || null,
    opts?.pageId ?? null,
    opts?.magnetKey ?? null,
    opts?.outline ?? null
  );
  if ("error" in g) return { ok: false, error: g.error };

  // The refs that actually exist. Built once and closed over by both validators, so "is this
  // ref real" is answered against what was sent rather than against a pattern.
  const validRefs = new Set(g.evidence.map((e) => e.ref));

  // The review sources by ref, so the verbatim check has the words to compare against. Built
  // here beside validRefs for the same reason: both validators answer against what was actually
  // sent, never against a pattern or a re-read.
  const reviewSources = new Map(
    g.evidence.filter((e) => e.type === "CUSTOMER_REVIEW").map((e) => [e.ref, e.content] as const)
  );

  try {
    const res = await callClaudeJSON<DraftedPage>({
      model: "claude-sonnet-4-6",
      system: SYSTEM,
      user: userPrompt(g),
      maxTokens: 2600,
      temperature: 0.4,
      schemaHint: `{ "title": string, "answerMd": string, "metaDescription": string, "evidenceUsed": [{ "claim": string, "sourceRef": string | null }] }`,
      validate: (v): v is DraftedPage => isDrafted(v, validRefs, reviewSources),
      describeInvalid: (v) => whyInvalid(v, validRefs, reviewSources),
    });

    return { ok: true, page: res.data };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The skeleton: headings, bullets and the gaps only the business can fill
//
// Matthew, 2026-09-11: "can't we simply have one version drafted, delete 80%, leave bullet
// points and we can fill the gaps?" This is that, built the other way round: instead of a full
// draft somebody cuts down, the model writes ONLY the skeleton and names the gaps, the gaps are
// answered out loud as evidence, and `draft` then writes the body from those answers.
//
// ‼️ WHY NOT WRITE THE FULL PAGE AND LET HIM DELETE. A full draft is assembled from what anybody
// could say about the topic, which is the one kind of page this product says is worth nothing to
// an engine. Deleting 80% of it leaves 20% of generic text with his name on it. The skeleton puts
// the model's work where it is good (structure, what to cover) and asks him for the only part an
// engine cannot get anywhere else.
// ─────────────────────────────────────────────────────────────────────────────

/** What the plan decided about this page, when it came off one. All optional. */
export interface OutlineContext {
  workingTitle: string | null;
  targetKeyword: string | null;
  angle: string | null;
  /**
   * The page's picked direct-response headline, which every story starts from (F2). Optional: a page
   * outlined before its headline was picked still gets stories, built from the question.
   */
  headline?: string | null;
  /**
   * The written-post SHAPE, from page_plan.post_format. Optional and null-safe: a page outlined
   * before the axis existed, or one written in the studio with no plan row, resolves to the
   * answer_first baseline, which is byte-identical to what shipped before.
   */
  postFormat?: string | null;
  /** The story spine this page runs on, from the picked angle. */
  narrative?: string | null;
  /** The one belief this page has to install, from the picked angle. */
  indoctrination?: string | null;
}

/**
 * ‼️ THE SUBJECT DECIDES, BETWEEN 6 AND 14. Matthew, 2026-09-14.
 *
 * It was 2 to 5, which is a page that answers one question and stops. What these pages are for is
 * being the thing an engine cites on a long-tail query, and an engine picks the section that
 * matches, not the page. Five sections is five chances; twelve is twelve. The floor is 6 because
 * below it the page is an answer rather than a resource, and the ceiling is 14 because past that
 * the model starts splitting one idea in two to reach a number.
 *
 * ‼️ THE GAP CAP STAYS AT 8, AND IT IS NOT AN OVERSIGHT. outlineFaults pins gap ids to G1..G9, and
 * at 7 pages a batch this is already up to 56 questions in the ONE research prompt W1d sends. The
 * [Pn] page tag is what separates them, not a wider gap numbering.
 */
export interface OutlineLimits {
  minSections: number;
  maxSections: number;
  minBullets: number;
  maxBullets: number;
  minGaps: number;
  maxGaps: number;
  maxBulletChars: number;
  maxHeadingChars: number;
  /** How many headings must be about something other than price, fear, comparison or process. */
  minDivergent: number;
  /** The convergent subjects this shape IS about, which stop counting against minDivergent. */
  exemptSubjects: readonly string[];
  /** The question words at least one heading must START with. */
  mandatoryShapes: readonly string[];
  /** Rule one, specialised per shape. Answer first is never dropped, only specialised. */
  openingRule: string;
}

/**
 * ‼️ THIS IS THE answer_first BASELINE, NOT "THE" LIMITS. limitsFor() merges a shape's overrides
 * onto it, and limitsFor(null) and limitsFor("answer_first") both return exactly this. Nothing that
 * was already working changes shape: the three keys added below are the CURRENT behaviour written
 * down, an empty exempt list, the what/why/how trio and rule one verbatim.
 *
 * ‼️ `as const` IS GONE DELIBERATELY. It has to be assignable to OutlineLimits so a resolved object
 * is the same type. The numbers are unchanged and every reader reads them numerically.
 */
export const OUTLINE_LIMITS: OutlineLimits = {
  minSections: SECTION_COUNT.min,
  maxSections: SECTION_COUNT.max,
  minBullets: 2,
  maxBullets: 4,
  minGaps: 3,
  maxGaps: 8,
  maxBulletChars: 180,
  maxHeadingChars: 80,
  minDivergent: 5,
  exemptSubjects: [],
  mandatoryShapes: ["what", "why", "how"],
  openingRule:
    "ANSWER FIRST. The first section answers the question directly. Its heading names the answer's " +
    'subject. Never "Introduction", never "Overview".',
};

/**
 * The limits for one written-post shape, resolved once and read by BOTH the prompt and the validator.
 *
 * ‼️ THIS FUNCTION EXISTS BECAUSE THE NUMBERS USED TO LIVE IN TWO PLACES. OUTLINE_LIMITS was
 * interpolated into the OUTLINE_SYSTEM string AND read again by outlineFaults, so a per-shape
 * override landing in only one of them would have the prompt asking for six sections while the
 * validator refused anything under eight. The correction retry would then loop on a contradiction it
 * was never shown, and the failure would read as the model being stupid.
 */
export function limitsFor(format: string | null | undefined): OutlineLimits {
  const row = getPostFormat(format ?? null);
  if (!row) return OUTLINE_LIMITS;
  return { ...OUTLINE_LIMITS, ...row.outline };
}

/**
 * The four subjects a page drifts to when nobody stops it, and the words that give each away.
 *
 * ‼️ THIS IS A DIVERGENCE FLOOR, NOT A BAN. A page about a treatment SHOULD cover what it costs
 * and what it is like. What it must not be is four sections of pricing, two of "X vs Y" and one
 * about what to expect, which is the shape every competitor already published and the exact page
 * an engine has no reason to prefer. Five headings have to be about something else.
 *
 * Matched on whole words against the lowercased heading, so "processing" does not count as
 * "process" and "compared" does not count as "compare".
 */
const CONVERGENT_VOCABULARY: Readonly<Record<string, readonly string[]>> = {
  price: ["price", "prices", "pricing", "cost", "costs", "afford", "affordable", "cheap", "expensive", "fee", "fees", "payment", "payments", "financing", "worth", "budget"],
  fear: ["safe", "safety", "risk", "risks", "risky", "danger", "dangerous", "harm", "harmful", "pain", "painful", "hurt", "hurts", "side", "effects", "complication", "complications", "scared", "afraid", "worry", "worried"],
  comparison: ["vs", "versus", "compare", "compares", "comparison", "better", "best", "worse", "difference", "differences", "alternative", "alternatives", "instead", "against", "rather"],
  process: ["process", "step", "steps", "procedure", "expect", "during", "appointment", "session", "consultation", "book", "booking", "prepare", "preparation", "aftercare", "recovery", "downtime"],
};

// The what/why/how trio moved onto OUTLINE_LIMITS.mandatoryShapes so a shape can carry its own.
// A list post's headings ARE its items and start with no question word at all; a comparison page
// wants "which" and does not want "why".

/** Whole words of a heading, lowercased. Punctuation and markdown are not words. */
function headingWords(heading: string): string[] {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
}

/** Which of the four convergent subjects this heading is about, or null when it is about its own. */
export function convergentSubject(heading: string): string | null {
  const words = new Set(headingWords(heading));
  for (const [subject, vocabulary] of Object.entries(CONVERGENT_VOCABULARY)) {
    if (vocabulary.some((w) => words.has(w))) return subject;
  }
  return null;
}

/**
 * Which of what / why / how the outline covers.
 *
 * ‼️ READ OFF THE FIRST WORD, NOT ANYWHERE IN THE HEADING. "What does it cost" is a what-section;
 * "the cost of knowing what to expect" is not, and matching loosely would let a single heading
 * satisfy all three and turn rule 8 into nothing. A long-tail question heading starts with its
 * question word, so the first word is the honest place to read it.
 */
export function shapesCovered(
  headings: readonly string[],
  shapes: readonly string[] = OUTLINE_LIMITS.mandatoryShapes
): Set<string> {
  const found = new Set<string>();
  for (const heading of headings) {
    const first = headingWords(heading)[0];
    if (first && shapes.includes(first)) found.add(first);
  }
  return found;
}

/**
 * The convergent subjects this shape may not be mostly about, named by their KEYS.
 *
 * ‼️ THE VALIDATOR SAYS KEYS AND THE PROMPT SAYS PROSE, AND THAT IS HOW IT ALWAYS WAS. The fault
 * message is read next to its own tally ("Covered now: price (3), comparison (2)"), so naming the
 * same tokens the tally uses is what makes the two lines one thought. The PROMPT is read by a model
 * writing headings, which needs the prose. Both are derived from the one exempt list, so a shape can
 * never be told one thing and judged by another.
 */
function otherThanKeys(limits: OutlineLimits): string {
  const exempt = new Set(limits.exemptSubjects);
  const kept = ["price", "fear", "comparison", "process"].filter((k) => !exempt.has(k));
  if (kept.length === 0) return "the subjects every competing page already covers";
  if (kept.length === 1) return kept[0];
  return `${kept.slice(0, -1).join(", ")} or ${kept[kept.length - 1]}`;
}

/** The same subjects, worded for the model that has to write headings past them. */
function otherThan(limits: OutlineLimits): string {
  const exempt = new Set(limits.exemptSubjects);
  const phrases: Array<[string, string]> = [
    ["price", "what it costs"],
    ["fear", "whether it is safe or painful"],
    ["comparison", "how it compares to something else"],
    ["process", "what the appointment is like"],
  ];
  const kept = phrases.filter(([k]) => !exempt.has(k)).map(([, v]) => v);
  if (kept.length === 0) return "the things every competing page already covers";
  if (kept.length === 1) return kept[0];
  return `${kept.slice(0, -1).join(", ")} or ${kept[kept.length - 1]}`;
}

/** Rule 2d, rendered from whichever shape words this format demands. */
function shapeRule(limits: OutlineLimits): string {
  const s = limits.mandatoryShapes;
  if (s.length === 0) return "";
  const caps = s.map((w) => `"${w[0].toUpperCase()}${w.slice(1)}"`);
  const list = caps.length === 1 ? caps[0] : `${caps.slice(0, -1).join(", ")} and ${caps[caps.length - 1]}`;
  return (
    `2d. ${list.toUpperCase()} ARE ALL PRESENT. At least one heading begins with each of ` +
    `${list}. A page that only explains what a thing is has not told the reader why it matters ` +
    "to them or how it actually works."
  );
}

/** The shape block: what this format is, what it must name, and what it must not be. */
function formatBlock(format: PostFormat): string {
  const fields = format.dataset
    .map((f) => `  - ${f.key} (${f.required ? "required" : "optional"}): ${f.prompt}`)
    .join("\n");
  return [
    "",
    `THIS PAGE IS A ${format.label.toUpperCase()}. ${format.askedAs.shape}`,
    `It must name: ${format.askedAs.requires.join("; ")}.`,
    `It must not be: ${format.askedAs.refuse.join("; ")}.`,
    "",
    "WHAT THIS SHAPE HAS TO EXTRACT. Every one of these either has an answer in the evidence already,",
    "or it is a gap. Where a gap answers one of them, set \"field\" on that gap to the key:",
    fields,
  ].join("\n");
}

/**
 * The outline prompt, built from the RESOLVED limits.
 *
 * ‼️ IT TAKES THE LIMITS RATHER THAN READING OUTLINE_LIMITS, and that is the entire point of the
 * refactor. outlineFaults reads the same object, so the prompt and the validator cannot disagree
 * about how many sections a shape may have or which subjects count against its divergence floor.
 */
function outlineSystem(L: OutlineLimits, format: PostFormat | null): string {
  return `You plan one answer page for a local business's own website. You do NOT write the page.

You write its SKELETON: the headings it will have, a few short bullet points under each saying what
that part covers, and the GAPS, which are the specific things only the business can supply. A person
reads the skeleton, answers every gap out loud, and the page is then written from their answers.

So every bullet is a note about what to cover, not finished copy. And every place the page would
need a fact about this business that the evidence does not already carry is a gap.

THE RULES:

1. ${L.openingRule}
2. ${L.minSections} to ${L.maxSections} sections, AND THE SUBJECT DECIDES HOW MANY. Do not pad to reach a number and
   do not split one idea into two sections to get there. ${L.minBullets} to ${L.maxBullets} bullets each, each one short.
2a. EVERY HEADING IS A LONG-TAIL QUESTION IN HER OWN WORDS. Write the heading the way the person
   who typed the question would say it out loud, not the way a brochure would label a section.
   "How long does it take before I see anything?" and not "Timeline". No heading is one noun.
2b. EVERY SECTION CARRIES ITS OWN KEYWORD: the long-tail phrase that section is the answer to.
   Return it as "keyword" on the section. It is the search this heading wins, so it is a phrase a
   person would actually type, three words or more, and it is NOT the page's own phrase repeated.
   Two sections may not carry the same keyword.
2c. AT LEAST ${L.minDivergent} HEADINGS ARE ABOUT SOMETHING OTHER than ${otherThan(L)}. Those are
   what every competing page already covers, so a page made only of them gives an engine no
   reason to pick it. Cover them where they belong, then go past them.
${shapeRule(L)}
3. ${L.minGaps} to ${L.maxGaps} GAPS. Each has an id (G1, G2, ...), a prompt asked in the second person
   ("What do you charge for ...?"), and a scope: "client" when the answer is about the business as
   a whole (pricing, where they serve, their credentials, their policies), "page" when it is about
   this one question. Write [G1] inside the bullet that needs that answer. Every gap is referenced
   by at least one bullet, and no bullet references a gap that does not exist.
4. NOTHING INVENTED. No fact about this business that the evidence does not carry: where you would
   need one, that is a gap. No numbers that are not in the evidence. No statistics.
5. A GAP THE EVIDENCE ALREADY ANSWERS IS NOT A GAP. If a source already gives their price, pricing
   is covered; write the bullet and cite nothing, do not ask again.
6. No competitor named. No outcome promises. No links. No markdown inside headings or bullets.
7. NO EM DASHES, EN DASHES OR DOUBLE HYPHENS, anywhere. This is checked in code.
${OUTLINE_STORY_RULE}${format ? formatBlock(format) : ""}`;
}

interface DraftedOutline {
  sections: OutlineSection[];
  gaps: OutlineGap[];
  stories: unknown[];
}

/** Numbers of two or more digits that no source contains. Same rule as the magnet drafter. */
function outlineOrphans(text: string, haystack: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\$?\d[\d,]*(?:\.\d+)?%?/g)) {
    const bare = m[0].replace(/[,$%]/g, "");
    if (bare.length < 2) continue;
    if (!haystack.includes(bare)) out.push(m[0]);
  }
  return [...new Set(out)];
}

/**
 * Everything wrong with a proposed skeleton, in words, for the correction retry.
 *
 * Exported for scripts/_probe-page-plan.ts, which proves the limits without a model call.
 */
export function outlineFaults(
  v: unknown,
  numberHaystack: string,
  limits: OutlineLimits = OUTLINE_LIMITS,
  format: PostFormat | null = null
): string[] {
  const out: string[] = [];
  const d = v as Partial<DraftedOutline>;
  const L = limits;

  if (!Array.isArray(d?.sections)) return ['Return { "sections": [...], "gaps": [...] }.'];
  if (!Array.isArray(d?.gaps)) return ['"gaps" is missing. Return it as an array, even though it has to have entries.'];

  if (d.sections.length < L.minSections || d.sections.length > L.maxSections) {
    out.push(`There are ${d.sections.length} sections. Write ${L.minSections} to ${L.maxSections}.`);
  }
  if (d.gaps.length < L.minGaps || d.gaps.length > L.maxGaps) {
    out.push(`There are ${d.gaps.length} gaps. Name ${L.minGaps} to ${L.maxGaps}.`);
  }

  const gapIds = new Set<string>();
  d.gaps.forEach((g, i) => {
    const gap = g as Partial<OutlineGap>;
    const id = typeof gap?.id === "string" ? gap.id.trim() : "";
    const prompt = typeof gap?.prompt === "string" ? gap.prompt.trim() : "";
    if (!/^G[1-9]$/.test(id)) out.push(`gap ${i + 1} has id "${id}". Use G1 to G9.`);
    else if (gapIds.has(id)) out.push(`gap id ${id} is used twice.`);
    else gapIds.add(id);
    if (!prompt) out.push(`gap ${id || i + 1} has no prompt.`);
    if (prompt && hasBannedDash(prompt)) out.push(`gap ${id}'s prompt contains a dash.`);
    if (gap?.scope !== "page" && gap?.scope !== "client") {
      out.push(`gap ${id || i + 1} needs scope "page" or "client".`);
    }
    for (const n of outlineOrphans(prompt, numberHaystack)) {
      out.push(`gap ${id}'s prompt states ${n}, which no source contains.`);
    }
  });

  const referenced = new Set<string>();
  const headings: string[] = [];
  const sectionKeywords = new Map<string, number>();

  d.sections.forEach((s, i) => {
    const section = s as Partial<OutlineSection>;
    const heading = typeof section?.heading === "string" ? section.heading.trim() : "";
    if (!heading) out.push(`section ${i + 1} has no heading.`);
    else headings.push(heading);

    // ‼️ THE PER-SECTION KEYWORD IS CHECKED, NOT ASKED FOR, same doctrine as the dash rule. It is
    // written to client_pages.section_keywords and read back by keyword-placement.ts weeks later,
    // so a missing one is not a cosmetic gap: it is a placement check that silently measures
    // nothing.
    const keyword = typeof section?.keyword === "string" ? section.keyword.trim() : "";
    if (!keyword) {
      out.push(`section ${i + 1} has no keyword. Give it the long-tail phrase that section answers.`);
    } else {
      if (keyword.split(/\s+/).filter(Boolean).length < 3) {
        out.push(`section ${i + 1}'s keyword "${keyword}" is under three words. A long tail is a phrase somebody types.`);
      }
      if (hasBannedDash(keyword)) out.push(`section ${i + 1}'s keyword contains a dash.`);
      const seen = sectionKeywords.get(keyword.toLowerCase());
      if (seen) out.push(`sections ${seen} and ${i + 1} carry the same keyword "${keyword}". Each section wins its own search.`);
      else sectionKeywords.set(keyword.toLowerCase(), i + 1);
    }

    if (heading.length > L.maxHeadingChars) out.push(`section ${i + 1}'s heading is over ${L.maxHeadingChars} characters.`);
    if (/[#*_`]/.test(heading)) out.push(`section ${i + 1}'s heading contains markdown.`);
    if (hasBannedDash(heading)) out.push(`section ${i + 1}'s heading contains a dash.`);
    for (const n of outlineOrphans(heading, numberHaystack)) {
      out.push(`section ${i + 1}'s heading states ${n}, which no source contains.`);
    }

    const bullets = Array.isArray(section?.bullets) ? section.bullets : [];
    if (bullets.length < L.minBullets || bullets.length > L.maxBullets) {
      out.push(`section ${i + 1} has ${bullets.length} bullets. Write ${L.minBullets} to ${L.maxBullets}.`);
    }
    bullets.forEach((b, j) => {
      const text = typeof b === "string" ? b.trim() : "";
      const where = `section ${i + 1} bullet ${j + 1}`;
      if (!text) out.push(`${where} is empty.`);
      if (text.length > L.maxBulletChars) out.push(`${where} is over ${L.maxBulletChars} characters. It is a note, not copy.`);
      if (hasBannedDash(text)) out.push(`${where} contains a dash.`);
      if (/\]\(|https?:\/\//i.test(text)) out.push(`${where} contains a link.`);
      for (const m of text.matchAll(/\[(G\d+)\]/g)) {
        referenced.add(m[1]);
        if (!gapIds.has(m[1])) out.push(`${where} references ${m[1]}, which is not one of the gaps.`);
      }
      for (const n of outlineOrphans(text.replace(/\[G\d+\]/g, ""), numberHaystack)) {
        out.push(`${where} states ${n}, which no source contains. Make it a gap instead.`);
      }
    });
  });

  for (const id of gapIds) {
    if (!referenced.has(id)) out.push(`gap ${id} is never referenced. Put [${id}] in the bullet that needs it.`);
  }

  // ‼️ DIVERGENCE AND SHAPE ARE CHECKED ACROSS THE WHOLE OUTLINE, NOT PER SECTION, because both
  // are properties of the set. No single heading can be "not convergent enough" and no single
  // heading can supply what, why and how. Only counted when the section count is already legal,
  // so a 3-section outline gets one clear fault about its size rather than three about its shape.
  if (headings.length >= L.minSections) {
    // ‼️ THE EXEMPTION IS APPLIED HERE, BY THE CALLER, AND NEVER INSIDE convergentSubject(). A
    // comparison heading is still ABOUT comparison; what a shape changes is whether that counts
    // against it. Teaching the classifier about formats would make one function answer two
    // questions and the other readers of it would silently inherit the wrong answer.
    const exempt = new Set(L.exemptSubjects);
    const divergent = headings.filter((h) => {
      const s = convergentSubject(h);
      return s === null || exempt.has(s);
    });
    if (divergent.length < L.minDivergent) {
      const converged = headings
        .map((h) => ({ h, subject: convergentSubject(h) }))
        .filter((x): x is { h: string; subject: string } => x.subject !== null && !exempt.has(x.subject));
      const tally = [...new Set(converged.map((c) => c.subject))]
        .map((subject) => `${subject} (${converged.filter((c) => c.subject === subject).length})`)
        .join(", ");
      out.push(
        `Only ${divergent.length} of ${headings.length} headings are about something other than ` +
          `${otherThanKeys(L)}. At least ${L.minDivergent} must be. Covered now: ${tally || "none"}. ` +
          `Keep those and replace the surplus with what this subject specifically involves.`
      );
    }

    const covered = shapesCovered(headings, L.mandatoryShapes);
    const missing = L.mandatoryShapes.filter((shape) => !covered.has(shape));
    if (missing.length) {
      out.push(
        `No heading begins with ${missing.map((m) => `"${m[0].toUpperCase()}${m.slice(1)}"`).join(" or ")}. ` +
          `This page needs ${L.mandatoryShapes.map((m) => `a ${m}`).join(", ")}.`
      );
    }
  }

  // ‼️ A GAP NAMING A FIELD THIS SHAPE DOES NOT DECLARE IS A FAULT, on the same rule a dangling
  // evidence ref already follows. An absent field is a field nobody answered; an invented one is an
  // answer filed under a key that means something else, and format-dataset.ts would then record it
  // as the wrong thing entirely.
  if (format) {
    const declared = new Set(format.dataset.map((f) => f.key));
    for (const g of d.gaps as unknown as Array<Record<string, unknown>>) {
      const field = typeof g?.field === "string" ? g.field.trim() : "";
      if (field && !declared.has(field)) {
        out.push(
          `Gap ${String(g?.id ?? "?")} names field "${field}", which a ${format.label} does not ` +
            `declare. The fields are: ${[...declared].join(", ")}.`
        );
      }
    }
  }

  return out;
}

/**
 * Write the skeleton for one page. Returns it for the caller to store; never touches answer_md.
 */
export async function draftOutline(
  clientId: string,
  question: string,
  opts: { pageId: string; context?: OutlineContext | null }
): Promise<{ ok: true; outline: PageOutline } | { ok: false; error: string }> {
  if (!question.trim()) return { ok: false, error: "No question was given." };

  const g = await gather(clientId, question.trim(), null, opts.pageId, null);
  if ("error" in g) return { ok: false, error: g.error };

  const ctx = opts.context ?? null;
  const { storyContextFor } = await import("@/lib/clients/story-context");
  const story = await storyContextFor(clientId);

  const numberHaystack = [
    ...g.evidence.map((e) => e.content),
    question,
    ctx?.targetKeyword ?? "",
    ctx?.angle ?? "",
    ctx?.workingTitle ?? "",
  ]
    .join(" ")
    .replace(/[,$]/g, "");

  const lines: string[] = [
    "THE QUESTION THIS PAGE ANSWERS:",
    question.trim(),
    "",
    `THE BUSINESS: ${g.clientName}`,
  ];
  if (g.city) lines.push(`Location: ${[g.city, g.state].filter(Boolean).join(", ")}`);
  if (g.businessType) lines.push(`What they are: ${g.businessType}`);
  if (g.buyerPersona) lines.push(`Who buys and what hurts: ${g.buyerPersona}`);
  if (ctx?.workingTitle) lines.push(`Working title: ${ctx.workingTitle}`);
  if (ctx?.targetKeyword) lines.push(`The phrase this page is aimed at: ${ctx.targetKeyword}`);
  if (ctx?.angle) lines.push(`What this page gives the reader: ${ctx.angle}`);
  // ‼️ THE NARRATIVE AND THE BELIEF REACH THE DRAFTER, AND UNTIL NOW THEY NEVER DID. page_angles
  // stored both, page_dataset copied both, and the word "narrative" appeared nowhere in this file:
  // the angle arrived as one sentence and the story spine and the belief the page exists to install
  // were decided, stored, snapshotted and thrown away at the moment the page was written.
  if (ctx?.narrative) lines.push(`The story this page runs on: ${ctx.narrative}`);
  if (ctx?.indoctrination) lines.push(`The one belief this page has to install: ${ctx.indoctrination}`);
  lines.push("");

  if (g.evidence.length) {
    lines.push("EVIDENCE ALREADY ON FILE. Anything answered here is not a gap:");
    for (const e of g.evidence) {
      lines.push(`[${e.ref}] ${e.label}${e.topic ? `, on ${e.topic}` : ""}`);
      lines.push(e.content.slice(0, 1500));
      lines.push("");
    }
  } else {
    lines.push("NO EVIDENCE IS ON FILE FOR THIS BUSINESS YET. Every fact the page needs is a gap.");
  }
  lines.push(...outlineStoryLines(story, ctx?.headline ?? null));

  const refs = new Map(g.evidence.map((e) => [e.ref, e.sourceId] as const));
  const beliefIds = story.beliefs.map((b) => b.id);
  const storyArgs = { refs, beliefIds, numberHaystack };

  // Resolved ONCE, then handed to both the prompt and the validator. See limitsFor().
  const fmt = getPostFormat(ctx?.postFormat ?? null);
  const L = limitsFor(ctx?.postFormat ?? null);
  const faultsOf = (v: unknown) => [
    ...outlineFaults(v, numberHaystack, L, fmt),
    ...storyFaults(v, storyArgs),
  ];

  try {
    const res = await callClaudeJSON<DraftedOutline>({
      model: "claude-sonnet-4-6",
      system: outlineSystem(L, fmt),
      user: lines.join("\n"),
      // 14 sections with a keyword each is roughly triple the old ceiling of 5, so the old 2000
      // would truncate the JSON on a long outline and fail validation for a reason the correction
      // retry cannot fix by rewriting. Three stories of four beats add roughly a thousand more.
      maxTokens: 8000,
      temperature: 0.3,
      schemaHint:
        '{ "sections": [{ "heading": string, "keyword": string, "bullets": string[] }], "gaps": [{ "id": "G1", "prompt": string, "scope": "page" | "client", "field": string | undefined }], ' +
        '"stories": [{ "id": "T1", "title": string, "beats": [string, string, string, string], "installs": string[], "heading": string | null, "source": { "kind": "evidence", "ref": "S1" } | { "kind": "gap", "gapId": "G1" } | { "kind": "illustrative" } }] }',
      validate: (v): v is DraftedOutline => faultsOf(v).length === 0,
      describeInvalid: (v) =>
        `Fix these and return the whole skeleton again:\n${faultsOf(v)
          .map((f) => `  - ${f}`)
          .join("\n")}`,
    });

    return {
      ok: true,
      outline: {
        sections: res.data.sections.map((s) => ({
          heading: s.heading.trim(),
          keyword: (s.keyword ?? "").trim(),
          bullets: s.bullets.map((b) => b.trim()),
        })),
        gaps: res.data.gaps.map((gap) => {
          // Only kept when this shape declares it. outlineFaults has already refused an invented
          // key by here, so this is belt and braces against a shape-less run carrying one through.
          const field = typeof (gap as { field?: unknown }).field === "string"
            ? String((gap as { field?: unknown }).field).trim()
            : "";
          const declared = fmt ? new Set(fmt.dataset.map((f) => f.key)) : null;
          return {
            id: gap.id.trim(),
            prompt: gap.prompt.trim(),
            scope: gap.scope === "client" ? ("client" as const) : ("page" as const),
            ...(field && declared?.has(field) ? { field } : {}),
          };
        }),
        stories: resolveStories(res.data, refs, beliefIds),
        writtenAt: new Date().toISOString(),
      },
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
