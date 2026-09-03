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

/** The tenant slug for an enabled widget, or null. One query, one row, no join beyond the slug. */
async function embeddableClient(clientId: string): Promise<Embeddable | null> {
  const { data, error } = await supabaseAdmin
    .from("concierge_configs")
    .select("enabled, clients!inner(slug)")
    .eq("client_id", clientId)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as unknown as Record<string, unknown>;
  if (row.enabled !== true) return null;

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
export async function ConciergeEmbed({ clientId, category }: ConciergeEmbedProps) {
  const client = await embeddableClient(clientId);
  if (!client) return null;

  return (
    <script
      async
      src={`${conciergeOrigin()}/embed.js`}
      data-client={client.slug}
      {...(category ? { "data-category": category } : {})}
    />
  );
}
