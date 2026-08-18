// The hub index, and the branch between the two kinds of host.
//
// Middleware cannot tell a hub host from a reviews host: it has no database, by design. So
// learn.{domain} and reviews.{domain} both arrive here and the split happens once the row
// is resolved.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolveHost } from "@/lib/hub/resolve";
import { listPublished } from "@/lib/hub/pages";
import { localBusinessJsonLd, jsonLdScript } from "@/lib/hub/jsonld";
import { ReviewTool } from "./reviews/review-tool";

export const revalidate = 300;

interface Props {
  params: { host: string };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const host = decodeURIComponent(params.host);
  const resolved = await resolveHost(host);
  if (resolved.status !== "ok") return { robots: { index: false, follow: false } };

  const { client, kind } = resolved;

  if (kind === "reviews") {
    return {
      title: `Share your experience · ${client.displayName}`,
      robots: { index: false, follow: false },
    };
  }

  const where = [client.city, client.state].filter(Boolean).join(", ");
  return {
    title: {
      absolute: where
        ? `${client.displayName} · Questions and answers · ${where}`
        : `${client.displayName} · Questions and answers`,
    },
    description: `Straight answers to the questions people actually ask about ${client.displayName}${where ? ` in ${where}` : ""}.`,
    alternates: { canonical: `https://${host}/` },
    robots: { index: true, follow: true },
  };
}

export default async function HubIndex({ params }: Props) {
  const host = decodeURIComponent(params.host);
  const resolved = await resolveHost(host);
  if (resolved.status !== "ok") notFound();

  const { client, kind } = resolved;

  if (kind === "reviews") {
    return <ReviewTool client={client} />;
  }

  const pages = await listPublished(client.id);
  const where = [client.city, client.state].filter(Boolean).join(", ");

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLdScript(localBusinessJsonLd(client, host)) }}
      />

      <p className="hub-eyebrow">{where || "Questions and answers"}</p>
      <h1>{client.displayName}</h1>
      <p className="hub-lede">
        Straight answers to the questions people actually ask, written out in full so they
        can be read and quoted.
      </p>

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
