// The rows of a client's site replica, and the only path that writes them.
//
// ‼️ THERE IS NO PUBLISH FUNCTION HERE AND THERE MUST NEVER BE ONE.
//
// hub/pages.ts has savePage and setPublished, and page-gate.ts's hole-check exists because
// setPublished must have exactly one caller. This file is the deliberate opposite shape: a
// replica page has no status, no published_at, no slug on a client host and no route that could
// serve it on one. It is rendered by /preview/{token}?kind=site and by nothing else.
//
// If you are here to add "publish the replica to learn.{domain}", read the header of
// src/lib/clients/site-replica.ts first. The answer is in it, and it is no.
//
// ‼️ NO unstable_cache, UNLIKE hub/pages.ts. Those reads are on an ISR page serving crawler
// traffic. These are on a force-dynamic preview somebody opens on a call after we just rebuilt
// it, and a cached replica is a replica that shows the previous run's pages.

import { supabaseAdmin } from "@/lib/db";

export interface ReplicaPage {
  id: string;
  clientId: string;
  /** The page on THEIR site this shadows. */
  sourceUrl: string;
  /** The anchor text from their own navigation. */
  navLabel: string;
  /** Their path, slashes intact. The homepage is the empty string. */
  path: string;
  title: string;
  bodyMd: string;
  /**
   * The offer this page was written toward, by `lead_magnets.magnet_key`.
   *
   * ‼️ THE SAME COLUMN MEANING AND THE SAME KEY SPACE AS client_pages.lead_magnet_key, ON
   * PURPOSE. A replica page and a hub page make the identical decision and it is answered by the
   * identical code: offerForPage() in lib/concierge/for-client.ts. Null means the ladder decides.
   * A second mechanism for "which free thing does this page offer" is the thing this comment
   * exists to prevent.
   */
  leadMagnetKey: string | null;
  navOrder: number;
  sourceId: string | null;
  updatedAt: string | null;
}

// ONE STRING LITERAL. supabase-js parses this at the type level and a concatenation widens to
// `string`, which turns every read into GenericStringError. Same trap as hub/pages.ts.
const COLUMNS =
  "id, client_id, source_url, nav_label, path, title, body_md, lead_magnet_key, nav_order, source_id, updated_at";

function toReplica(row: Record<string, unknown>): ReplicaPage {
  return {
    id: row.id as string,
    clientId: row.client_id as string,
    sourceUrl: (row.source_url as string) ?? "",
    navLabel: (row.nav_label as string) ?? "",
    path: (row.path as string) ?? "",
    title: (row.title as string) ?? "",
    bodyMd: (row.body_md as string) ?? "",
    leadMagnetKey: (row.lead_magnet_key as string | null) ?? null,
    navOrder: typeof row.nav_order === "number" ? row.nav_order : 0,
    sourceId: (row.source_id as string | null) ?? null,
    updatedAt: (row.updated_at as string | null) ?? null,
  };
}

/**
 * Every replica page for one client, in their own navigation order.
 *
 * Throws rather than returning [], for the reason listPublished gives: an empty list renders as
 * "this replica has no pages", and showing that to a client on a call during a database blip is
 * a worse lie than an error page.
 */
export async function listReplica(clientId: string): Promise<ReplicaPage[]> {
  const { data, error } = await supabaseAdmin
    .from("client_replica_pages")
    .select(COLUMNS)
    .eq("client_id", clientId)
    .order("nav_order", { ascending: true });

  if (error) throw new Error(`[hub/replica-pages] list failed: ${error.message}`);
  return (data ?? []).map((r) => toReplica(r as Record<string, unknown>));
}

export interface SaveReplicaInput {
  clientId: string;
  sourceUrl: string;
  navLabel: string;
  path: string;
  title: string;
  bodyMd: string;
  leadMagnetKey?: string | null;
  navOrder: number;
  sourceId?: string | null;
}

/**
 * Write one replica page, replacing whatever was there for that path.
 *
 * ‼️ upsert ON (client_id, path) RATHER THAN insert, BECAUSE THE RUNNER IS RE-RUNNABLE. A client
 * who redesigns their site in week two gets a fresh replica by un-ticking the step, and a second
 * run must refresh the page rather than collide on the unique index. Same idempotence
 * recordWebsiteSnapshot has for the evidence row underneath it.
 */
export async function saveReplicaPage(
  input: SaveReplicaInput
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { data, error } = await supabaseAdmin
    .from("client_replica_pages")
    .upsert(
      {
        client_id: input.clientId,
        source_url: input.sourceUrl,
        nav_label: input.navLabel,
        path: input.path,
        title: input.title,
        body_md: input.bodyMd,
        lead_magnet_key: input.leadMagnetKey?.trim() || null,
        nav_order: input.navOrder,
        source_id: input.sourceId ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "client_id,path" }
    )
    .select("id")
    .maybeSingle();

  if (error) {
    // 42P01. The table is created by docs/2026-09-04-site-replica.sql, and saying so beats
    // somebody reading a PostgREST error and assuming the whole lane is broken. Same courtesy
    // provisionConcierge extends for concierge_configs.
    if (error.code === "42P01") {
      return {
        ok: false,
        error:
          "client_replica_pages does not exist. docs/2026-09-04-site-replica.sql has not been run.",
      };
    }
    return { ok: false, error: error.message };
  }

  const id = data?.id as string | undefined;
  return id ? { ok: true, id } : { ok: false, error: "The replica page was not saved." };
}

/**
 * Drop replica rows whose source URL is no longer in their navigation.
 *
 * A site that removes a service page should not keep a shadow of it: walking a page on a call
 * that no longer exists on their own site is the exact opposite of "something real to walk".
 * Called by the runner with the URLs it just wrote.
 */
export async function pruneReplica(clientId: string, keepUrls: string[]): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from("client_replica_pages")
    .select("id, source_url")
    .eq("client_id", clientId);

  if (error) return 0;

  const keep = new Set(keepUrls);
  const stale = (data ?? [])
    .filter((r) => !keep.has(r.source_url as string))
    .map((r) => r.id as string);

  if (stale.length === 0) return 0;

  const { error: delError } = await supabaseAdmin
    .from("client_replica_pages")
    .delete()
    .in("id", stale);

  return delError ? 0 : stale.length;
}
