// Structured data for the hub.
//
// This is not decoration. A local business page that an AI engine can parse into an entity
// — name, address, phone, and the question this page answers — is the difference between
// being quoted and being skipped. It is v1 for the same reason robots.txt is.
//
// Every field is omitted when absent rather than emitted empty. A LocalBusiness with
// "addressLocality": "" is worse than one without the key: it asserts a blank.

import type { HubClient } from "@/lib/hub/resolve";

type Json = Record<string, unknown>;

function prune(obj: Json): Json {
  const out: Json = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined || v === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === "object" && !Array.isArray(v) && Object.keys(v as Json).length === 0) continue;
    out[k] = v;
  }
  return out;
}

export function localBusinessJsonLd(client: HubClient, host: string): Json {
  const address = prune({
    "@type": "PostalAddress",
    streetAddress: [client.addressLine1, client.addressLine2].filter(Boolean).join(", ") || null,
    addressLocality: client.city,
    addressRegion: client.state,
    postalCode: client.postalCode,
    addressCountry: client.addressLine1 || client.city ? "US" : null,
  });

  return prune({
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: client.displayName,
    // The hub is a page ABOUT the business, not the business's main site. `url` points at
    // the hub because that is the page this markup describes; `sameAs` carries their real
    // website so an engine can join the two into one entity rather than inventing a second.
    url: `https://${host}/`,
    sameAs: client.website ? [client.website] : [],
    telephone: client.phone,
    email: client.email,
    address: Object.keys(address).length > 1 ? address : null,
  });
}

/**
 * A QAPage, for a page that genuinely answers ONE question.
 *
 * ‼️ THIS USED TO BE THE ONLY CHOICE HERE, AND THE 2023 REASONING THAT MADE IT SO IS STILL TRUE.
 * It read: Google restricted FAQPage RICH RESULTS to authoritative government and health sites in
 * 2023, and a page that answers exactly one question is a QAPage by definition. Both halves still
 * hold. What changed on 2026-09-14 is the page, not the rule: an outline is now 6 to 14 sections,
 * each one a long-tail question with its own keyword, so most pages are no longer one question
 * with one answer and calling them a QAPage would describe something that is not there.
 *
 * ‼️ THE RICH-RESULT RESTRICTION IS NOT A REASON TO AVOID FAQPage HERE, and reading it as one was
 * the trap. The audience for this markup is an engine PARSING the page to answer somebody, not
 * Google deciding whether to draw an accordion in a blue link. Losing a rich result we were never
 * eligible for costs nothing; describing fourteen question-and-answer pairs as one costs the thing
 * the markup exists for.
 *
 * So: multi-section pages get Article plus FAQPage, single-question pages keep QAPage, and
 * `schemaForPage` below is the one place that decides which.
 */
export function questionAnswerJsonLd(args: {
  question: string;
  answerText: string;
  url: string;
  authorName: string;
  datePublished: string | null;
}): Json {
  return prune({
    "@context": "https://schema.org",
    "@type": "QAPage",
    mainEntity: prune({
      "@type": "Question",
      name: args.question,
      answerCount: 1,
      acceptedAnswer: prune({
        "@type": "Answer",
        text: args.answerText,
        url: args.url,
        author: { "@type": "Organization", name: args.authorName },
      }),
    }),
    datePublished: args.datePublished,
  });
}

/** One "## " heading and the prose under it. Mirrors bodySections() in draft-page.ts. */
export interface SchemaSection {
  heading: string;
  body: string;
}

/**
 * The page itself, as a thing with an author, a subject and a date.
 *
 * ‼️ `headline` IS THE H1 AND `name` IS THE TITLE, AND THEY ARE DIFFERENT STRINGS ON PURPOSE.
 * page_plan carries both for the reason the migration comment gives: working_title carries the
 * KEYWORD and is what internal link anchors show, headline carries the PAIN and is what the reader
 * sees. Collapsing them here would tell an engine the page is called something no link calls it.
 *
 * No `image`, no `Person` author. Same refusal hub-bodies.tsx already records for Person: nothing
 * structured is on file, and a name pulled from intake's free-text credentials would be invented.
 */
export function articleJsonLd(args: {
  headline: string;
  name: string;
  description: string | null;
  url: string;
  authorName: string;
  datePublished: string | null;
  dateModified: string | null;
  about: string | null;
}): Json {
  return prune({
    "@context": "https://schema.org",
    "@type": "Article",
    headline: args.headline,
    name: args.name,
    description: args.description,
    url: args.url,
    mainEntityOfPage: { "@type": "WebPage", "@id": args.url },
    author: { "@type": "Organization", name: args.authorName },
    publisher: { "@type": "Organization", name: args.authorName },
    datePublished: args.datePublished,
    dateModified: args.dateModified ?? args.datePublished,
    about: args.about,
  });
}

/**
 * Every "## " heading as a question, with the prose under it as its answer.
 *
 * ‼️ THE HEADINGS ARE ALREADY LONG-TAIL QUESTIONS, WHICH IS THE ONLY REASON THIS IS HONEST.
 * OUTLINE_SYSTEM requires each heading to be phrased as a question a person would type, so an
 * FAQPage here describes the page that exists rather than dressing up a list of topics as
 * questions. If that rule is ever relaxed, this has to go with it: an "FAQ" whose questions are
 * nouns is markup asserting something false.
 *
 * Returns null below two pairs, because a "frequently asked questions" block with one entry is a
 * QAPage wearing the wrong type.
 */
export function faqJsonLd(sections: readonly SchemaSection[]): Json | null {
  const pairs = sections
    .map((s) => ({ heading: s.heading.trim(), body: s.body.trim() }))
    .filter((s) => s.heading !== "" && s.body !== "");

  if (pairs.length < 2) return null;

  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: pairs.map((s) => ({
      "@type": "Question",
      name: s.heading,
      acceptedAnswer: { "@type": "Answer", text: s.body },
    })),
  };
}

/**
 * Which schema this page gets. The ONE place that decides.
 *
 * ‼️ THE SECTION COUNT DECIDES, NOT THE PAGE'S ORIGIN. A page dictated straight into the body by
 * the provider can have twelve headings and a planned page can end up with one. What the markup
 * has to describe is the document that exists, so it is read off the body every time.
 *
 * Two or more answerable sections: Article plus FAQPage, because the page is a resource made of
 * question-and-answer pairs and both facts are worth stating. Fewer: QAPage, unchanged since 2023.
 */
export function schemaForPage(args: {
  sections: readonly SchemaSection[];
  question: string;
  headline: string | null;
  title: string;
  answerText: string;
  metaDescription: string | null;
  url: string;
  authorName: string;
  datePublished: string | null;
  dateModified: string | null;
  targetKeyword: string | null;
}): Json[] {
  const faq = faqJsonLd(args.sections);
  if (!faq) {
    return [
      questionAnswerJsonLd({
        question: args.question,
        answerText: args.answerText,
        url: args.url,
        authorName: args.authorName,
        datePublished: args.datePublished,
      }),
    ];
  }

  return [
    articleJsonLd({
      headline: args.headline?.trim() || args.question,
      name: args.title,
      description: args.metaDescription,
      url: args.url,
      authorName: args.authorName,
      datePublished: args.datePublished,
      dateModified: args.dateModified,
      about: args.targetKeyword,
    }),
    faq,
  ];
}

/**
 * A BreadcrumbList: hub index, pillar, this page.
 *
 * ‼️ THE HIERARCHY LIVES HERE AND IN LINKS, NEVER IN THE PATH. HUB_SLUG in middleware.ts forbids a
 * slash on a client host, so /pillar/support cannot exist, and this is how an engine still learns
 * that a support sits under its pillar. `item` must be absolute: a relative URL here is ignored.
 */
export function breadcrumbJsonLd(items: Array<{ name: string; url: string }>): Json {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: it.url,
    })),
  };
}

/**
 * Serialise for a <script type="application/ld+json">.
 *
 * `<` is escaped so a stray "</script>" inside a client's own copy cannot close the tag
 * early and turn their answer text into markup. React escapes children, but this goes in
 * through dangerouslySetInnerHTML, which is the one place it does not.
 */
export function jsonLdScript(data: Json): string {
  return JSON.stringify(data).replace(/</g, "\u003c");
}
