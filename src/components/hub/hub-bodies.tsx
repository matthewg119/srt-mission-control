// The hub's rendered markup, shared by the LIVE route and the PREVIEW route.
//
// ‼️ THIS FILE EXISTS SO A PREVIEW CANNOT LIE.
//
// Runner v3 5f/5g: "Identical build to production. Do NOT create a separate demo mode with
// different copy." A preview that renders its own copy of the markup is a demo mode with
// extra steps — it drifts one commit at a time, and it drifts silently, because nobody
// looks at a preview again after the call it was built for.
//
// So the live page and the preview both render THESE components. The only things a caller
// varies are the two that genuinely differ:
//   - `pages`, because the preview shows drafts and the live route shows published only
//   - `host`, because JSON-LD and canonicals need the client's hostname, which the preview
//     composes rather than resolves
//
// Nothing here reads a request, a header or a session. Given the same props it produces
// the same HTML, which is the only thing that makes a preview worth showing to a client.

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { HubClient } from "@/lib/hub/resolve";
import { localBusinessJsonLd, questionAnswerJsonLd, jsonLdScript } from "@/lib/hub/jsonld";

export interface HubBodyPage {
  id: string;
  slug: string;
  title: string;
  question: string;
}

export interface HubAnswerPage {
  slug: string;
  title: string;
  question: string;
  answerMd: string;
  publishedAt: string | null;
}

/**
 * A plain-text rendering of the answer, for the JSON-LD `text` field and the meta
 * description. Markdown syntax in either is noise to an engine, so the markers come out
 * while the words stay in.
 *
 * Shared rather than duplicated because generateMetadata and the JSON-LD both need it, and
 * two copies that diverge would put one string in the description and a different one in
 * the schema.
 */
export function plainText(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/[*_`>#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * The client's mark, when a confirmed theme carries one.
 *
 * Plain <img>, not next/image: this is a third-party URL on the client's own CDN, and
 * routing it through the optimizer would put every hub page's header behind our image
 * pipeline for no benefit. Height is capped in CSS so a 2000px logo cannot own the page.
 * alt is the business name because that is what the mark says.
 */
function HubLogo({ client }: { client: HubClient }) {
  if (!client.theme?.logoUrl) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="hub-logo" src={client.theme.logoUrl} alt={client.displayName} />;
}

/** The index: who they are, what has been answered, and the canonical NAP. */
export function HubIndexBody({
  client,
  host,
  pages,
}: {
  client: HubClient;
  host: string;
  pages: HubBodyPage[];
}) {
  const where = [client.city, client.state].filter(Boolean).join(", ");

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(localBusinessJsonLd(client, host)) }}
      />

      {/*
        ‼️ THE MASTHEAD IS WRAPPED, AND THE WRAPPER IS THE ONLY THING TEMPLATES ADDED TO THIS
        FILE. A template that wants a header band or a centred masthead has nothing to grab
        when the logo, eyebrow, h1 and lede are four loose siblings of the answer list.
        <header> rather than <div> because it is one, and this page is read by crawlers.
        Nothing inside it moved, so the heading order and the JSON-LD above are unchanged.
      */}
      <header className="hub-head">
        <HubLogo client={client} />
        <p className="hub-eyebrow">{where || "Questions and answers"}</p>
        <h1>{client.displayName}</h1>
        <p className="hub-lede">
          Straight answers to the questions people actually ask, written out in full so they
          can be read and quoted.
        </p>
      </header>

      {pages.length > 0 ? (
        <>
          <h2>Answers</h2>
          <ul className="hub-list">
            {pages.map((page) => (
              <li key={page.id}>
                <a href={`/${page.slug}`}>
                  {page.title}
                  <span className="hub-q">{page.question}</span>
                </a>
              </li>
            ))}
          </ul>
        </>
      ) : (
        // Deliberately not an error and not an empty page. A hub goes live the day the
        // CNAME resolves, which is days before the first page is written, and a bare 404
        // during that window is what makes a client think nothing was built.
        <p>New answers are being added here. Check back shortly.</p>
      )}

      <dl className="hub-nap">
        {(client.addressLine1 || client.city) && (
          <>
            <dt>Address</dt>
            <dd>
              {[client.addressLine1, client.addressLine2].filter(Boolean).join(", ")}
              {(client.addressLine1 || client.addressLine2) && <br />}
              {[where, client.postalCode].filter(Boolean).join(" ")}
            </dd>
          </>
        )}
        {client.phone && (
          <>
            <dt>Phone</dt>
            <dd>
              <a href={`tel:${client.phone}`}>{client.phone}</a>
            </dd>
          </>
        )}
        {client.website && (
          <>
            <dt>Website</dt>
            <dd>
              <a href={client.website}>{client.website.replace(/^https?:\/\//, "")}</a>
            </dd>
          </>
        )}
      </dl>
    </>
  );
}

/** One answer page. The unit the whole hub exists to publish. */
export function HubAnswerBody({
  client,
  host,
  page,
}: {
  client: HubClient;
  host: string;
  page: HubAnswerPage;
}) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: jsonLdScript(
            questionAnswerJsonLd({
              question: page.question,
              answerText: plainText(page.answerMd),
              url: `https://${host}/${page.slug}`,
              authorName: client.displayName,
              datePublished: page.publishedAt,
            })
          ),
        }}
      />

      {/* Same wrapper as the index, for the same reason. See HubIndexBody. */}
      <header className="hub-head">
        <HubLogo client={client} />
        <p className="hub-eyebrow">
          <a href="/">{client.displayName}</a>
        </p>
        <h1>{page.title}</h1>
        {page.question !== page.title && <p className="hub-lede">{page.question}</p>}
      </header>

      <div className="hub-answer">
        {/*
          react-markdown does not render raw HTML unless rehype-raw is added, and it is
          deliberately not added. Page bodies are typed by a person into a form and then
          served on a client's own domain under their name; a paste that carried a <script>
          through would be an XSS on their site, not ours.
        */}
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{page.answerMd}</ReactMarkdown>
      </div>

      <p className="hub-foot">
        {page.publishedAt
          ? `Published ${new Date(page.publishedAt).toLocaleDateString("en-US", {
              year: "numeric",
              month: "long",
              day: "numeric",
            })} by ${client.displayName}.`
          : client.displayName}
      </p>
    </>
  );
}
