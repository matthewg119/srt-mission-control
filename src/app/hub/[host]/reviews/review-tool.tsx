// The reviews host, server side. Resolves the destinations and hands them to the client
// component; no interactivity and no state here.

import type { HubClient } from "@/lib/hub/resolve";
import { ReviewClient, type ReviewDestination } from "./review-client";

/**
 * Where she can post, read from the client's own review_workflow bag (intake step 4 already
 * writes to it) rather than from new columns.
 *
 * Google is primary and always offered. RealSelf is offered only when a URL was configured,
 * because it is procedure-specific and a third destination needs a decision on the call.
 *
 * When no URL is configured we show the copy box and say where to paste, and we do NOT
 * construct a search link and call it their profile. Absent beats wrong: a guessed link
 * sends her to somebody else's business.
 */
function destinationsFor(client: HubClient): ReviewDestination[] {
  const workflow = (client.reviewWorkflow ?? {}) as Record<string, unknown>;
  const out: ReviewDestination[] = [];

  const google = typeof workflow.google_url === "string" ? workflow.google_url.trim() : "";
  if (google) out.push({ key: "google", label: "Post on Google", url: google });

  const realself = typeof workflow.realself_url === "string" ? workflow.realself_url.trim() : "";
  if (realself) out.push({ key: "realself", label: "Post on RealSelf", url: realself });

  return out;
}

export function ReviewTool({ client }: { client: HubClient }) {
  return (
    <ReviewClient
      businessName={client.displayName}
      clientId={client.id}
      destinations={destinationsFor(client)}
      // The spec requires Spanish for the four questions and requires it to be checked by a
      // native speaker, because a machine translation of a deliberately sentiment-neutral
      // question can land as a leading one — the one thing this tool cannot afford. So
      // Spanish is NOT generated here. English renders until reviewed copy exists, the same
      // refusal isUnwritten() already makes for an unwritten WhatsApp draft.
      needsSpanish={client.language === "es" || client.language === "both"}
    />
  );
}
