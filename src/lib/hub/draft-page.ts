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

export interface DraftedPage {
  title: string;
  answerMd: string;
  metaDescription: string;
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
}

const SYSTEM = `You write one answer page for a local business's own website.

WHO IS READING IT. A person who typed that question into ChatGPT, Google or a search box, has
not heard of this business, and wants the question answered. Not a customer yet. Not a fan.

WHAT THE PAGE IS FOR. It is published on the business's own domain so that an AI engine
answering that question has something of theirs to cite. That only works if the page actually
answers the question. A page that answers it in one line and then sells for six paragraphs is
worth nothing to the engine and nothing to the reader.

THE RULES, and every one of them exists because breaking it is worse than a thin page.

1. ONLY WHAT YOU WERE GIVEN. Every fact about this business must come from the research below.
   No invented prices, no invented years in business, no invented certifications, staff names,
   awards, guarantees, hours or service areas. If the research does not say it, the page does
   not say it. This is published on their domain under their name and a reader can check it.

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

7. WHERE THE RESEARCH IS THIN, SAY LESS. A short honest page beats a padded one. If you can
   only write three paragraphs from what you were given, write three paragraphs.

SHAPE. Markdown. 250 to 500 words. Short paragraphs, one idea each. At most two "##" subheadings
and only if the answer genuinely has parts. No H1: the title is rendered separately. No links,
no images, no tables, no bullet list longer than five items.

TITLE. How a person would say the question, not the raw prompt string. Under 60 characters.

META DESCRIPTION. One sentence, under 155 characters, that answers the question. Not a teaser.`;

function isDrafted(v: unknown): v is DraftedPage {
  const d = v as DraftedPage;
  return (
    !!d &&
    typeof d.title === "string" &&
    d.title.trim().length > 0 &&
    d.title.length <= 90 &&
    typeof d.answerMd === "string" &&
    d.answerMd.trim().split(/\s+/).length >= 120 &&
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

function whyInvalid(v: unknown): string {
  const d = v as DraftedPage;
  if (!d || typeof d.answerMd !== "string") return "answerMd is missing.";
  const words = d.answerMd.trim().split(/\s+/).length;
  if (words < 120) return `answerMd is ${words} words. It needs at least 120.`;
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

async function gather(
  clientId: string,
  question: string,
  existingBody: string | null
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

  return {
    clientName: name,
    question,
    existingBody,
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

  if (g.research && !isThinResearch(g.research)) {
    lines.push("THEIR OWN WEBSITE. This is the ONLY source of facts about them. Everything the");
    lines.push("page asserts about this business has to be traceable to something in here.");
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
    lines.push("THEIR WEBSITE COULD NOT BE READ, so you have NO source of facts about this");
    lines.push("business beyond the three lines above. Write a page that answers the question");
    lines.push("in general terms for someone in this category and this city, and assert nothing");
    lines.push("specific about this business: no services, no prices, no history, no staff, no");
    lines.push("equipment, no hours. A shorter page is the correct outcome here.");
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
 */
export async function draftPage(
  clientId: string,
  question: string,
  opts?: { existingBody?: string | null }
): Promise<{ ok: true; page: DraftedPage } | { ok: false; error: string }> {
  if (!question.trim()) return { ok: false, error: "No question was given." };

  const g = await gather(clientId, question.trim(), opts?.existingBody?.trim() || null);
  if ("error" in g) return { ok: false, error: g.error };

  try {
    const res = await callClaudeJSON<DraftedPage>({
      model: "claude-sonnet-4-6",
      system: SYSTEM,
      user: userPrompt(g),
      maxTokens: 2000,
      temperature: 0.4,
      schemaHint: `{ "title": string, "answerMd": string, "metaDescription": string }`,
      validate: isDrafted,
      describeInvalid: whyInvalid,
    });

    return { ok: true, page: res.data };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
