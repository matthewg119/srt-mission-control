// One answer page. The unit the whole hub exists to publish.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { resolveHost } from "@/lib/hub/resolve";
import { getPublished } from "@/lib/hub/pages";
import { questionAnswerJsonLd, jsonLdScript } from "@/lib/hub/jsonld";

export const revalidate = 300;

interface Props {
  params: { host: string; slug: string };
}

/**
 * A plain-text rendering of the answer, for the JSON-LD `text` field and the meta
 * description. Markdown syntax in either is noise to an engine, so the markers come out
 * while the words stay in.
 */
function plainText(md: string): string {
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

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const host = decodeURIComponent(params.host);
  const resolved = await resolveHost(host);
  // A reviews host has no slug pages at all: it is one tool on one URL.
  if (resolved.status !== "ok" || resolved.kind !== "hub") {
    return { robots: { index: false, follow: false } };
  }

  const page = await getPublished(resolved.client.id, params.slug);
  if (!page) return { robots: { index: false, follow: false } };

  return {
    title: page.title,
    description: page.metaDescription || truncate(plainText(page.answerMd), 155),
    // The canonical is on the CLIENT's host. Never mission.srtagency.com, which is
    // noindex, and never their main site, which does not have this page.
    alternates: { canonical: `https://${host}/${page.slug}` },
    robots: { index: true, follow: true },
    openGraph: {
      type: "article",
      title: page.title,
      url: `https://${host}/${page.slug}`,
      siteName: resolved.client.displayName,
    },
  };
}

export default async function HubPage({ params }: Props) {
  const host = decodeURIComponent(params.host);
  const resolved = await resolveHost(host);
  if (resolved.status !== "ok" || resolved.kind !== "hub") notFound();

  const { client } = resolved;
  const page = await getPublished(client.id, params.slug);
  if (!page) notFound();

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

      <p className="hub-eyebrow">
        <a href="/">{client.displayName}</a>
      </p>
      <h1>{page.title}</h1>
      {page.question !== page.title && <p className="hub-lede">{page.question}</p>}

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
