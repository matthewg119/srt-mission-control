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
 * A QAPage, not an FAQPage.
 *
 * Google restricted FAQPage rich results to authoritative government and health sites in
 * 2023, and a page that answers exactly one question is a QAPage by definition. The markup
 * still parses as a question-and-answer pair for engines that read it directly, which is
 * the audience that matters here.
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
