// Read the database before you spend a dollar.
//
// Every paid pull in the colony lane goes through getOrFetch(): DataForSEO volume,
// ChatGPT fanout replays, site crawls. It reads client_datasets first and only calls
// the provider on a miss or an expiry, then records what the call cost.
//
// One consequence worth the table:
//   - Nothing is bought twice INSIDE ITS TTL. Re-running a step inside the window is free.
//
// ‼️ TWO THINGS THIS IS NOT, BOTH OF WHICH THE HEADER USED TO CLAIM. Corrected 2026-09-18 after
// an audit of the lanes routed through it.
//
// IT IS NOT AN ARCHIVE. The write below is an upsert on (client_id, kind, cache_key), and on
// conflict Postgres REPLACES the row. A re-buy after an expiry overwrites the previous answer,
// payload and all. Any lane that needs the OLD answer to survive the new one, which is every
// lane storing a measurement rather than a fact, cannot get that from this table. Routing
// run-prompts.ts here on exactly that promise was reverted for this reason.
//
// `select kind, sum(cost_usd) from client_datasets group by 1` IS NOT THE SPEND. It is the cost
// of the LAST purchase of each distinct key, so a question bought five times counts once, and a
// `force` re-buy erases the receipt it was supposed to add to. Making it real needs an
// append-only purchase row separate from the cache row, which is owed and needs a migration.
// Until then, do not put that query on a card: an undercount presented as a total is worse than
// no number, which is the rule this whole system is built on.
//
// client_id is nullable throughout. A vertical-wide pull (a market corpus, a keyword
// expansion for a whole category) belongs to no single client and is shared by all of
// them, which is the entire reason the corpus tables are keyed by vertical.

import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/db";

export interface DatasetRequest<T> {
  /** null for a pull that belongs to a vertical rather than one client. */
  clientId: string | null;
  /** Provider + endpoint, e.g. "dataforseo.search_volume", "openai.fanout". */
  kind: string;
  /** Stable identity of the INPUTS. Use cacheKeyOf() unless the input is already
   *  a short stable string. Two calls with the same key must be the same question. */
  cacheKey: string;
  /** How long the answer stays true. null or omitted = never expires. Search volume
   *  ages (30 days is sensible); a recorded fanout observation never does. */
  ttlDays?: number | null;
  provider?: string;
  params?: Record<string, unknown>;
  /**
   * Buy it again even if we hold it, and overwrite what we hold with the answer.
   *
   * ‼️ IT SKIPS THE READ, NEVER THE WRITE. The point is that the NEW answer replaces the old one
   * under the same key, so the next caller gets the corrected value instead of the stale one. The
   * alternative a caller reaches for otherwise is varying the cache key to force a miss, which
   * fills the table with keys nobody can ever look up again.
   *
   * ‼️ IT DOES NOT ADD TO THE LEDGER, AND THE HEADER EXPLAINS WHY. The upsert replaces cost_usd
   * rather than accumulating it, so a forced re-buy erases the receipt for the purchase before
   * it. That is a real gap, it is owed, and it is not something to work around here.
   *
   * For a person who has read the cached answer and wants a new one anyway: `force` on a niche
   * brief, the re-run button on the research console. Never a default, and never a retry: a failed
   * fetch throws and writes nothing, so a retry is already a miss.
   */
  force?: boolean;
  /** Called ONLY on a miss. Returns the payload and what the call actually cost. */
  fetch: () => Promise<{ payload: T; costUsd?: number }>;
}

export interface DatasetResult<T> {
  payload: T;
  /** true when this cost nothing because the database already had it. */
  cached: boolean;
  costUsd: number;
}

/** Stable cache key for a structured input. Object keys are sorted so that
 *  {a:1,b:2} and {b:2,a:1} are the same question and not two paid calls. */
export function cacheKeyOf(input: unknown): string {
  return createHash("sha256").update(stableStringify(input)).digest("hex").slice(0, 40);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

async function note(kind: string, detail: string, meta: Record<string, unknown>): Promise<void> {
  try {
    await supabaseAdmin.from("system_logs").insert({
      event_type: "dataset_cache_degraded",
      description: `dataset-cache (${kind}): ${detail}`,
      metadata: { kind, detail, ...meta },
    });
  } catch {
    // Never let the logger be the thing that breaks a paid call.
  }
}

/**
 * Consult the database, then the provider.
 *
 * If client_datasets is unreachable (most likely: the migration has not been run yet)
 * this DEGRADES to a live fetch rather than failing the caller — but it says so in
 * system_logs, because a silently uncached lane quietly spends real money on every
 * re-run and that is exactly the failure the table exists to prevent.
 */
export async function getOrFetch<T>(req: DatasetRequest<T>): Promise<DatasetResult<T>> {
  const { clientId, kind, cacheKey } = req;

  let query = supabaseAdmin
    .from("client_datasets")
    .select("id, payload, expires_at, hit_count, cost_usd")
    .eq("kind", kind)
    .eq("cache_key", cacheKey);
  // PostgREST needs is-null, not eq-null, for the vertical-wide rows.
  query = clientId === null ? query.is("client_id", null) : query.eq("client_id", clientId);

  // A forced re-buy asks nobody. The write below still runs, so the corrected answer lands under
  // the same key and the next caller gets it. What it does NOT do is add a second row: see the
  // header on why that makes the cost column the last purchase rather than the total.
  const { data: hit, error: readError } = req.force
    ? { data: null, error: null }
    : await query.maybeSingle();

  if (readError) {
    await note(kind, `read failed, falling through to a PAID call: ${readError.message}`, {
      client_id: clientId,
      cache_key: cacheKey,
    });
    const fresh = await req.fetch();
    return { payload: fresh.payload, cached: false, costUsd: fresh.costUsd ?? 0 };
  }

  const live = hit && (!hit.expires_at || new Date(hit.expires_at as string) > new Date());
  if (live) {
    // Best-effort usage counter; a failure here must not turn a hit into a paid miss.
    void supabaseAdmin
      .from("client_datasets")
      .update({ hit_count: ((hit.hit_count as number) ?? 0) + 1 })
      .eq("id", hit.id as string)
      .then(undefined, () => undefined);
    return { payload: hit.payload as T, cached: true, costUsd: 0 };
  }

  const fresh = await req.fetch();
  const costUsd = fresh.costUsd ?? 0;
  const ttlDays = req.ttlDays ?? null;
  const expiresAt = ttlDays === null ? null : new Date(Date.now() + ttlDays * 86_400_000).toISOString();

  const { error: writeError } = await supabaseAdmin.from("client_datasets").upsert(
    {
      client_id: clientId,
      kind,
      cache_key: cacheKey,
      params: req.params ?? {},
      payload: fresh.payload as unknown,
      provider: req.provider ?? null,
      cost_usd: costUsd,
      hit_count: 0,
      fetched_at: new Date().toISOString(),
      expires_at: expiresAt,
    },
    { onConflict: "client_id,kind,cache_key" }
  );

  if (writeError) {
    // The money is already spent. Losing the receipt means the next run pays again,
    // so this is worth a log even though the caller gets its answer.
    await note(kind, `paid call succeeded but was NOT cached: ${writeError.message}`, {
      client_id: clientId,
      cache_key: cacheKey,
      cost_usd: costUsd,
    });
  }

  return { payload: fresh.payload, cached: false, costUsd };
}

/** What this lane has spent, for a client or across all of them. */
export async function spendSoFar(clientId: string | null): Promise<{ kind: string; costUsd: number }[]> {
  let q = supabaseAdmin.from("client_datasets").select("kind, cost_usd");
  if (clientId !== null) q = q.eq("client_id", clientId);
  const { data, error } = await q;
  if (error || !data) return [];
  const totals = new Map<string, number>();
  for (const row of data) {
    const kind = row.kind as string;
    totals.set(kind, (totals.get(kind) ?? 0) + Number(row.cost_usd ?? 0));
  }
  return [...totals.entries()].map(([kind, costUsd]) => ({ kind, costUsd })).sort((a, b) => b.costUsd - a.costUsd);
}
