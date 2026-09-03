// The concierge questions the rest of the app asks about a client it holds by id.
//
// ‼️ A SEPARATE FILE BECAUSE OF WHO ASKS. config.ts resolves a tenant by SLUG, which is what the
// widget has: the loader on somebody's page carries `data-client`, and everything downstream of it
// is slug-shaped. The board, the drafter and the publish gate all hold a client id instead, and
// none of them wants the rest of a ConciergeConfig. Widening loadConciergeConfig to take either
// would put a second lookup path on the file that the public widget route depends on.
//
// ‼️ IT ANSWERS "NO WIDGET" RATHER THAN GUESSING. A client with no concierge_configs row, or a row
// whose audience is unreadable, gets null and an empty list. magnetByKey is audience-scoped so a
// chain cannot cross between the owner and patient catalogues, and defaulting an audience here
// would open exactly that hole from the other side.

import { supabaseAdmin } from "@/lib/db";
import {
  isAudience,
  listMagnetsFor,
  magnetByKey,
  resolveMagnet,
  type Audience,
  type LeadMagnet,
  type MagnetChoice,
} from "./magnets";

export interface ConciergeTenant {
  audience: Audience;
  vertical: string | null;
  enabled: boolean;
}

/** The widget's own row, or null when this client has no widget at all. */
export async function conciergeTenant(clientId: string): Promise<ConciergeTenant | null> {
  const { data } = await supabaseAdmin
    .from("concierge_configs")
    .select("audience, vertical, enabled")
    .eq("client_id", clientId)
    .maybeSingle();

  if (!data) return null;
  const audience = data.audience;
  if (!isAudience(audience)) return null;

  return {
    audience,
    vertical: typeof data.vertical === "string" && data.vertical.trim() ? data.vertical : null,
    enabled: data.enabled === true,
  };
}

/** Which catalogue this client's widget speaks from, or null when it has no widget at all. */
export async function audienceForClient(clientId: string): Promise<Audience | null> {
  return (await conciergeTenant(clientId))?.audience ?? null;
}

/**
 * Every magnet a page for this client could be drafted toward.
 *
 * An empty list is a real answer and the board shows it rather than hiding the picker: it is the
 * only place a person finds out that this client's concierge was never provisioned.
 */
export async function magnetsForClient(clientId: string): Promise<MagnetChoice[]> {
  const audience = await audienceForClient(clientId);
  return audience ? listMagnetsFor(audience, clientId) : [];
}

/** What a page would actually offer, and whether anybody chose it. */
export interface PageOffer {
  magnet: LeadMagnet | null;
  /** True when the page names its own magnet. False means the ladder picked, or nothing did. */
  chosen: boolean;
}

/**
 * The free thing this page will really put on its pill.
 *
 * ‼️ IT ANSWERS THE QUESTION THE GATE ASKS, WHICH IS NOT "IS A KEY SET". A page with no key is
 * fine when the ladder still reaches something: the offer is generic, not absent. A page where
 * neither the key nor the ladder resolves anything is the state this whole lane exists to catch,
 * because the launcher still renders and still says something, so the visitor is shown a button
 * that hands over nothing. isDeliverable() in magnets.ts refuses that one magnet at a time; this
 * is the same doctrine asked about a whole page before it goes live.
 *
 * ‼️ category IS null HERE ON PURPOSE, AND IT IS THE HONEST READING. The live page passes no
 * category either (nothing writes one onto client_pages), so a lattice answer computed with one
 * would describe a page that does not exist. When that changes, it changes in both places.
 */
export async function offerForPage(clientId: string, magnetKey: string | null): Promise<PageOffer> {
  const tenant = await conciergeTenant(clientId);
  if (!tenant) return { magnet: null, chosen: false };

  const key = magnetKey?.trim();
  if (key) {
    const named = await magnetByKey(key, tenant.audience);
    // A named key that resolves nothing does NOT silently fall back to the ladder. The row was
    // deactivated, renamed or its asset env var went away, and quietly offering something else
    // under a decision somebody made is worse than saying the decision no longer holds.
    return { magnet: named, chosen: true };
  }

  return {
    magnet: await resolveMagnet({
      audience: tenant.audience,
      clientId,
      vertical: tenant.vertical,
      treatment: null,
      category: null,
    }),
    chosen: false,
  };
}
