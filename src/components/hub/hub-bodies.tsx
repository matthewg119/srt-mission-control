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

// ─────────────────────────────────────────────────────────────────────────────
// The site replica. See src/lib/clients/site-replica.ts for why it exists and why it is
// never published.
// ─────────────────────────────────────────────────────────────────────────────

/** One page of the replica, as the preview needs it. */
export interface HubReplicaPage {
  id: string;
  path: string;
  navLabel: string;
  title: string;
  bodyMd: string;
}

/**
 * The replica's own navigation, rendered on every one of its pages.
 *
 * A replica with no way to move between its pages is a page, not a site, and "somewhere real to
 * walk" was the entire request. It carries their own anchor text, which is the thing that makes
 * the artifact recognisable to the person who wrote the original.
 */
function ReplicaNav({
  pages,
  current,
  href,
}: {
  pages: HubReplicaPage[];
  current: string | null;
  href: (path: string) => string;
}) {
  if (pages.length === 0) return null;
  return (
    <nav className="hub-eyebrow" aria-label="Site">
      {pages.map((p, i) => (
        <span key={p.id}>
          {i > 0 ? " · " : ""}
          {p.path === current ? <strong>{p.navLabel}</strong> : <a href={href(p.path)}>{p.navLabel}</a>}
        </span>
      ))}
    </nav>
  );
}

/**
 * One replica page.
 *
 * ‼️ NO JSON-LD, UNLIKE HubAnswerBody, AND THE ABSENCE IS CORRECT RATHER THAN UNFINISHED. That
 * component emits QAPage because an answer page IS a question and an answer, and it is indexed on
 * the client's domain. A replica of somebody's About page is neither: it is noindex, it is on our
 * hostname, and stamping QAPage on it would be a structured-data claim about a document that does
 * not exist anywhere. There is nothing to describe to a crawler that will never see it.
 */
export function HubReplicaBody({
  client,
  page,
  pages,
  href,
}: {
  client: HubClient;
  page: HubReplicaPage;
  pages: HubReplicaPage[];
  href: (path: string) => string;
}) {
  return (
    <>
      <header className="hub-head">
        <HubLogo client={client} />
        <ReplicaNav pages={pages} current={page.path} href={href} />
        <h1>{page.title}</h1>
      </header>

      <div className="hub-answer">
        {/*
          Same rule as HubAnswerBody: react-markdown without rehype-raw, so raw HTML never
          renders. The body here came from a model reading somebody else's page, which is more
          reason to keep that guard, not less.
        */}
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{page.bodyMd}</ReactMarkdown>
      </div>

      <p className="hub-foot">{client.displayName}</p>
    </>
  );
}

/** The replica's front page: their homepage, with the rest of their site listed under it. */
export function HubReplicaIndexBody({
  client,
  home,
  pages,
  href,
}: {
  client: HubClient;
  home: HubReplicaPage | null;
  pages: HubReplicaPage[];
  href: (path: string) => string;
}) {
  const where = [client.city, client.state].filter(Boolean).join(", ");

  return (
    <>
      <header className="hub-head">
        <HubLogo client={client} />
        <ReplicaNav pages={pages} current={home ? home.path : null} href={href} />
        <h1>{home?.title || client.displayName}</h1>
        {where && <p className="hub-lede">{where}</p>}
      </header>

      {home ? (
        <div className="hub-answer">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{home.bodyMd}</ReactMarkdown>
        </div>
      ) : (
        <p>Their homepage could not be read, so the replica starts at the sections below.</p>
      )}

      {pages.length > 1 && (
        <>
          <h2>The rest of the site</h2>
          <ul className="hub-list">
            {pages
              .filter((p) => p.path !== "")
              .map((p) => (
                <li key={p.id}>
                  <a href={href(p.path)}>{p.navLabel}</a>
                </li>
              ))}
          </ul>
        </>
      )}
    </>
  );
}
