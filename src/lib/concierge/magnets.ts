// Which free thing this visitor is offered, and what it leads to.
//
// ‼️ THE LADDER IS PURE AND THE QUERY IS ONE ROUND TRIP. Every candidate for this audience is read
// once, then rungOf() ranks them in memory. The alternative, eight sequential queries walking the
// ladder rung by rung, is eight round trips inside a chat turn AND it puts the ordering rule in
// SQL where no probe can reach it. Here the ordering is a pure function, so the whole ladder is
// proved offline with no database and no model.
//
// ‼️ NULL MEANS "ANY", NOT "UNKNOWN", AND ONLY ON THE ROW. docs/2026-09-01-concierge.sql calls this
// out as the one place in the schema where that reading holds. It is asymmetric and the asymmetry
// is the point: a row with vertical null is a deliberate wildcard, while a QUERY with vertical null
// means we do not know what this page is about, and a row that names a vertical must not match it.
// Reading the query's null as a wildcard too would offer a med spa magnet on an unclassified page.
//
// ‼️ A MAGNET IS A PROMISE. isDeliverable() drops any magnet whose asset is not actually there, so
// an unset env var removes the offer instead of shipping a button that goes nowhere. Same tri-state
// doctrine as BOOKING_LINK in config/pitch.ts and fetchSlots() in calendly.ts.

import { supabaseAdmin } from "@/lib/db";

export type Audience = "patient" | "owner";

export function isAudience(v: unknown): v is Audience {
  return v === "patient" || v === "owner";
}

export interface LeadMagnet {
  id: string;
  magnetKey: string | null;
  chainsToKey: string | null;
  audience: Audience;
  clientId: string | null;
  vertical: string | null;
  treatment: string | null;
  category: string | null;
  title: string;
  promise: string;
  assetUrl: string | null;
  conciergeEntry: string;
  sortOrder: number;
}

/** Where the visitor is standing. Nulls here mean "we do not know", never "any". */
export interface MagnetQuery {
  audience: Audience;
  clientId: string | null;
  vertical: string | null;
  treatment: string | null;
  category: string | null;
}

const COLUMNS =
  "id, magnet_key, chains_to_key, audience, client_id, vertical, treatment, category, " +
  "title, promise, asset_url, concierge_entry, sort_order";

/**
 * Magnets whose asset lives behind an env var rather than in the row.
 *
 * ‼️ THE ASSET IS NOT IN asset_url FOR THESE AND THAT IS DELIBERATE. Copying an env value into a
 * database column freezes it: the day the PDF moves, every row still points at the old file and
 * nothing in the schema can tell you. Resolving at read time means an unset or changed var takes
 * effect immediately, and unset removes the offer rather than breaking it.
 */
const ENV_ASSET: Readonly<Record<string, string>> = {
  question_20: "MEDSPA_QUESTIONS_PDF_URL",
};

/** The link this magnet hands over, or null when it is an action inside the widget. */
export function assetUrlFor(magnet: LeadMagnet): string | null {
  const key = magnet.magnetKey ?? "";
  const envName = ENV_ASSET[key];
  if (envName) {
    const value = (process.env[envName] ?? "").trim();
    return value || null;
  }
  return magnet.assetUrl?.trim() || null;
}

/**
 * Whether this magnet can actually be handed over right now.
 *
 * Only ONE thing makes a magnet undeliverable: it declares an env-backed asset and that var is not
 * set. A magnet with no asset at all is fine, because several of them are delivered as the
 * conversation itself (the competitor list) or as an action in the widget (the scan).
 */
export function isDeliverable(magnet: LeadMagnet): boolean {
  const envName = ENV_ASSET[magnet.magnetKey ?? ""];
  if (!envName) return true;
  return (process.env[envName] ?? "").trim().length > 0;
}

/**
 * How specifically this row matches, or null when it does not match at all.
 *
 * The weights reproduce the ladder docs/2026-09-01-concierge.sql documents, and fill the two holes
 * it left. Client beats everything, then vertical, then treatment, then category:
 *
 *   15  (client, vertical, treatment, category)   its rung 1
 *   14  (client, vertical, treatment, any)        its rung 2
 *    8  (client, any,      any,       any)        its rung 3
 *    7  (library, vertical, treatment, category)  its rung 4
 *    6  (library, vertical, treatment, any)       FILLED, it had no such rung
 *    5  (library, vertical, any,       category)  its rung 5
 *    4  (library, vertical, any,       any)       FILLED, it had no such rung
 *    0  (library, any,      any,       any)       its rung 6, the universal fallback
 *
 * Without the two filled rungs a library magnet scoped to a vertical, or to a vertical and a
 * treatment, is unreachable, and those are the two shapes the owner catalogue is built from.
 */
export function rungOf(magnet: LeadMagnet, q: MagnetQuery): number | null {
  if (magnet.audience !== q.audience) return null;

  // A row belonging to another client is not in this conversation at all.
  if (magnet.clientId !== null && magnet.clientId !== q.clientId) return null;

  let score = magnet.clientId !== null ? 8 : 0;

  const axis = (rowValue: string | null, queryValue: string | null, weight: number): boolean => {
    if (rowValue === null) return true; // wildcard on the row
    if (queryValue === null) return false; // unknown on the query never matches a named row
    if (rowValue.toLowerCase() !== queryValue.toLowerCase()) return false;
    score += weight;
    return true;
  };

  if (!axis(magnet.vertical, q.vertical, 4)) return null;
  if (!axis(magnet.treatment, q.treatment, 2)) return null;
  if (!axis(magnet.category, q.category, 1)) return null;

  return score;
}

/**
 * Rank candidates for one query, most specific first. Pure, so the probe proves the ladder offline.
 *
 * ‼️ sort_order IS NOT OPTIONAL AS A TIE BREAK, and magnet_key behind it is not either. Two magnets
 * at the same rung with no deterministic order means the CTA on a cached page changes between
 * renders, which reads to a client as a broken site. The SQL comment on sort_order says exactly
 * this; the third key is here because two library rows can legitimately share a sort_order.
 */
export function rankMagnets(candidates: LeadMagnet[], q: MagnetQuery): LeadMagnet[] {
  return candidates
    .map((m) => ({ m, rung: rungOf(m, q) }))
    .filter((x): x is { m: LeadMagnet; rung: number } => x.rung !== null)
    .sort(
      (a, b) =>
        b.rung - a.rung ||
        a.m.sortOrder - b.m.sortOrder ||
        (a.m.magnetKey ?? "").localeCompare(b.m.magnetKey ?? "")
    )
    .map((x) => x.m);
}

function toMagnet(row: Record<string, unknown>): LeadMagnet | null {
  const audience = row.audience;
  if (!isAudience(audience)) return null;
  const title = typeof row.title === "string" ? row.title : "";
  const promise = typeof row.promise === "string" ? row.promise : "";
  const entry = typeof row.concierge_entry === "string" ? row.concierge_entry : "";
  if (!title || !promise || !entry) return null;

  const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

  return {
    id: String(row.id),
    magnetKey: str(row.magnet_key),
    chainsToKey: str(row.chains_to_key),
    audience,
    clientId: str(row.client_id),
    vertical: str(row.vertical),
    treatment: str(row.treatment),
    category: str(row.category),
    title,
    promise,
    assetUrl: str(row.asset_url),
    conciergeEntry: entry,
    sortOrder: typeof row.sort_order === "number" ? row.sort_order : 100,
  };
}

/** Every active magnet this conversation could possibly reach. One query, then rank in memory. */
async function candidatesFor(q: MagnetQuery): Promise<LeadMagnet[]> {
  let query = supabaseAdmin
    .from("lead_magnets")
    .select(COLUMNS)
    .eq("active", true)
    .eq("audience", q.audience);

  // The library plus this client's own rows. `or` rather than two queries so the ranking sees one
  // list and cannot prefer a library row simply because it arrived first.
  query = q.clientId ? query.or(`client_id.is.null,client_id.eq.${q.clientId}`) : query.is("client_id", null);

  const { data, error } = await query;
  if (error || !data) {
    console.error(`[concierge] candidatesFor: ${error?.message ?? "no rows"}`);
    return [];
  }
  return (data as unknown as Record<string, unknown>[])
    .map(toMagnet)
    .filter((m): m is LeadMagnet => m !== null);
}

export interface ResolveOptions {
  /** magnet_keys already handed over in this session. Never offered twice. */
  exclude?: readonly string[];
}

/** The best magnet for where this visitor is standing, or null when nothing is deliverable. */
export async function resolveMagnet(
  q: MagnetQuery,
  opts: ResolveOptions = {}
): Promise<LeadMagnet | null> {
  const exclude = new Set(opts.exclude ?? []);
  const ranked = rankMagnets(await candidatesFor(q), q);
  return (
    ranked.find((m) => isDeliverable(m) && !(m.magnetKey && exclude.has(m.magnetKey))) ?? null
  );
}

/**
 * One named magnet, for following a chain.
 *
 * Audience-scoped, so a chain can never hop the firewall into the other catalogue even if a row is
 * seeded with a key that exists on both sides.
 */
export async function magnetByKey(key: string, audience: Audience): Promise<LeadMagnet | null> {
  const { data } = await supabaseAdmin
    .from("lead_magnets")
    .select(COLUMNS)
    .eq("magnet_key", key)
    .eq("audience", audience)
    .eq("active", true)
    .order("sort_order", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  const magnet = toMagnet(data as unknown as Record<string, unknown>);
  return magnet && isDeliverable(magnet) ? magnet : null;
}

/** The next magnet in the chain, or null when this one ends at the ask. */
export async function nextInChain(
  magnet: LeadMagnet,
  opts: ResolveOptions = {}
): Promise<LeadMagnet | null> {
  if (!magnet.chainsToKey) return null;
  if (opts.exclude?.includes(magnet.chainsToKey)) return null;
  return magnetByKey(magnet.chainsToKey, magnet.audience);
}
