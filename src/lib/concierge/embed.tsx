// Putting the widget on a page we render ourselves.
//
// ‼️ THE HUB LAYOUT ASKS FOR THIS BY CLIENT ID, AND THE LOOKUP LIVES HERE RATHER THAN THERE.
// HubClient carries no slug, and the honest options were to widen resolve.ts (shared with the
// preview renderers and two other lanes) or to answer the question inside this lane. This is the
// second one. It costs one indexed read inside a render that is already cached for 300 seconds.
//
// ‼️ IT RENDERS NOTHING WHEN THE WIDGET IS OFF, and off is the default. A client whose
// concierge_live step has not run must see no trace of it on their live site, not a hidden div and
// not a script that fetches and then removes itself.

import { supabaseAdmin } from "@/lib/db";
import { conciergeOrigin } from "./origin";

export { conciergeOrigin };

interface Embeddable {
  slug: string;
}

/**
 * The tenant slug for a widget that may render here, or null. One query, one row, no join beyond
 * the slug.
 *
 * `allowDisabled` is the preview lane and ONLY the preview lane. It relaxes exactly one thing,
 * the `enabled` flag; a client with no concierge_configs row at all still renders nothing,
 * because there is no widget to preview. See the `preview` prop below.
 */
async function embeddableClient(
  clientId: string,
  allowDisabled: boolean
): Promise<Embeddable | null> {
  const { data, error } = await supabaseAdmin
    .from("concierge_configs")
    .select("enabled, clients!inner(slug)")
    .eq("client_id", clientId)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as unknown as Record<string, unknown>;
  if (row.enabled !== true && !allowDisabled) return null;

  const client = (Array.isArray(row.clients) ? row.clients[0] : row.clients) as
    | Record<string, unknown>
    | undefined;
  const slug = typeof client?.slug === "string" ? client.slug : null;
  return slug ? { slug } : null;
}

export interface ConciergeEmbedProps {
  clientId: string;
  /** The theme of the page they are reading, so the magnet matches the post. */
  category?: string | null;
  /**
   * The magnet this page was written toward, from `client_pages.lead_magnet_key`.
   *
   * ‼️ IT OUTRANKS `category` RATHER THAN REFINING IT. A category is a hint the ladder ranks over;
   * a key is a decision made before the page was drafted, and draft-page.ts wrote the copy to earn
   * that specific offer. A page whose body ends where one magnet begins must not be answered with
   * a different one because a ranking preferred it.
   */
  magnetKey?: string | null;
  /**
   * A signed preview token, which makes a SWITCHED-OFF widget render.
   *
   * ‼️ ONLY /preview/[token] MAY PASS THIS, AND IT IS NOT A WAY TO TURN THE WIDGET ON. `enabled`
   * keeps its exact meaning: it is the only thing that puts this on a client's real website, it
   * still defaults false, and nothing in the preview lane flips it. What the token says is
   * narrower, and the API routes verify it themselves rather than trusting this tag: "whoever
   * opened this page holds a link we minted for this client in the last fourteen days".
   *
   * It exists because `concierge_preview` promises a widget that can be demoed on the call and
   * every route refused one. See src/lib/concierge/preview-grant.ts.
   */
  preview?: string | null;
}

/**
 * The loader tag, or nothing.
 *
 * ‼️ A PLAIN <script src>, NOT next/script AND NOT INLINE CODE. next/script would pull a client
 * component into a layout that is otherwise entirely server-rendered, and an inline script would
 * need a CSP nonce threaded through a file this lane does not own. A src tag in the initial HTML
 * executes normally and document.currentScript is set for it, which is how embed.js reads its own
 * data attributes.
 */
export async function ConciergeEmbed({
  clientId,
  category,
  magnetKey,
  preview,
}: ConciergeEmbedProps) {
  const token = preview?.trim() || null;
  const client = await embeddableClient(clientId, token !== null);
  if (!client) return null;

  // ‼️ ON THE src, NOT IN A data- ATTRIBUTE. embed.js copies query params off its own script URL
  // into the frame URL and into its config fetch, which are the two places that have to carry it.
  // A data- attribute would need threading through both by hand.
  const src = token
    ? `${conciergeOrigin()}/embed.js?pt=${encodeURIComponent(token)}`
    : `${conciergeOrigin()}/embed.js`;

  return (
    <script
      async
      src={src}
      data-client={client.slug}
      {...(category ? { "data-category": category } : {})}
      {...(magnetKey ? { "data-magnet": magnetKey } : {})}
    />
  );
}
