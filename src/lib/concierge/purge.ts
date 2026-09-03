// The 24-hour deletion. The only thing in this repo that makes the consent copy true.
//
// ‼️ THIS FILE SHIPPED BEFORE THE UPLOAD ROUTE DID, DELIBERATELY. The widget tells a patient
// their photo is deleted within 24 hours. Nothing else in this codebase deletes anything from
// storage — `.remove(` had zero hits on main before this file existed — so there is no
// lifecycle rule, no trigger and no vendor default quietly covering for a gap here. If this
// stops running, the product is lying to people about their faces. It is scheduled hourly in
// vercel.json and it is watched.
//
// ‼️ TWO SWEEPS, AND THE SECOND ONE IS THE IMPORTANT ONE.
//
//   The TABLE sweep is the happy path: rows past photo_delete_after, deleted, stamped.
//
//   The ORPHAN sweep is what makes the promise honest. An upload that succeeds and whose
//   session INSERT then fails — a lambda killed mid-request, a constraint violation, a
//   Supabase blip — leaves an object on disk with no row pointing at it. A table-driven purge
//   cannot see it, and nobody will ever notice it, because the only way to find it is to look
//   in the bucket. It would sit there forever. So we look in the bucket.
//
// ‼️ REMOVE FIRST, STAMP SECOND, AND NEVER THE REVERSE. Clearing storage_ref before the delete
// succeeds makes the object invisible to the table sweep the instant the delete fails, which
// costs it another 24 hours on disk before the orphan sweep catches it. A row that is stamped
// but whose object survived is unrecoverable; a row that is unstamped and whose object is
// already gone is retried harmlessly on the next tick. Fail in the direction that retries.

import { supabaseAdmin } from "@/lib/db";

export const BUCKET = "concierge";

/**
 * How long a photo lives. Written onto the row at upload time rather than applied here, so the
 * deadline is a fact about the session and is auditable per row, not a constant this file could
 * quietly change for every historical scan at once.
 */
export const RETENTION_HOURS = 24;

/**
 * How long an unreferenced object gets before it is treated as debris.
 *
 * ‼️ COMFORTABLY LONGER THAN RETENTION_HOURS, AND THAT GAP IS A SAFETY MARGIN, NOT SLACK. An
 * object uploaded four seconds ago whose session row is still being inserted is not an orphan.
 * Anything still unreferenced a full day after it should already have been purged is.
 */
export const ORPHAN_GRACE_HOURS = 48;

/** Batch sizes. Small enough that one tick cannot exhaust the function's time budget. */
const TABLE_BATCH = 200;
const LIST_PAGE = 500;

export interface PurgeResult {
  dry: boolean;
  /** Rows past their deadline that still held an object. */
  due: number;
  deleted: number;
  /** Objects in the bucket with no live row pointing at them, past the grace period. */
  orphansFound: number;
  orphansDeleted: number;
  errors: string[];
}

/**
 * The storage key for a session's photo.
 *
 * ‼️ FLAT, NOT FOLDED UNDER A CLIENT ID, AND THAT IS THE OPPOSITE OF THE `onboarding` BUCKET.
 * The difference is what the bucket is FOR. `onboarding` is an archive somebody browses per
 * client, so `${clientId}/...` is worth the walk. This is a 24-hour holding pen that nothing
 * ever browses, and folding it by client would turn the orphan sweep from one paginated list
 * into an N+1 walk over every client prefix — which is exactly the sweep most likely to be
 * quietly dropped later for being slow. The key IS the session id, so orphan detection is a
 * single `in` query instead of a join.
 */
export function photoKey(sessionId: string, ext: string): string {
  return `${sessionId}.${ext.replace(/[^a-z0-9]/gi, "").toLowerCase() || "jpg"}`;
}

/** The session id a key refers to, or null if the key is not one of ours. */
function sessionIdFromKey(name: string): string | null {
  const base = name.replace(/\.[a-z0-9]+$/i, "");
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(base)
    ? base
    : null;
}

/**
 * Delete the objects, then stamp the rows that owned them.
 *
 * Returns the ids that were genuinely cleared. A key Supabase declines to remove is left
 * unstamped on purpose so the next tick tries again.
 */
async function removeAndStamp(
  rows: Array<{ id: string; storage_ref: string }>,
  dry: boolean,
  errors: string[]
): Promise<number> {
  if (!rows.length) return 0;
  if (dry) return rows.length;

  const { error } = await supabaseAdmin.storage.from(BUCKET).remove(rows.map((r) => r.storage_ref));

  // ‼️ AN ERROR HERE STAMPS NOTHING. Supabase does not fail on a key that is already absent,
  // so a genuine error means the objects are probably still there. Stamping now would hide
  // them from the table sweep and hand them to the orphan sweep a day later.
  if (error) {
    errors.push(`storage.remove failed for ${rows.length} objects: ${error.message}`);
    return 0;
  }

  const { error: updateError } = await supabaseAdmin
    .from("concierge_sessions")
    .update({
      storage_ref: null,
      photo_deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .in(
      "id",
      rows.map((r) => r.id)
    );

  // The bytes are gone, which is the part that matters. An un-stamped row is cosmetic and is
  // caught next tick: storage_ref is still set, so it is still on the worklist, and the remove
  // is idempotent.
  if (updateError) {
    errors.push(`objects deleted but rows not stamped: ${updateError.message}`);
    return 0;
  }

  return rows.length;
}

/** Rows past their deadline that still hold an object. Drives concierge_sessions_purge_idx. */
async function sweepTable(dry: boolean, errors: string[]): Promise<{ due: number; deleted: number }> {
  const { data, error } = await supabaseAdmin
    .from("concierge_sessions")
    .select("id, storage_ref")
    .not("storage_ref", "is", null)
    .is("photo_deleted_at", null)
    .lte("photo_delete_after", new Date().toISOString())
    .limit(TABLE_BATCH);

  if (error) {
    errors.push(`worklist query failed: ${error.message}`);
    return { due: 0, deleted: 0 };
  }

  const rows = (data ?? []) as Array<{ id: string; storage_ref: string }>;
  const deleted = await removeAndStamp(rows, dry, errors);
  return { due: rows.length, deleted };
}

/**
 * Objects nothing points at.
 *
 * Lists the bucket, keeps anything older than the grace period, and asks the table which of
 * those are still legitimately held. Whatever is left is debris from a failed insert.
 */
async function sweepOrphans(
  dry: boolean,
  errors: string[]
): Promise<{ found: number; deleted: number }> {
  const cutoff = Date.now() - ORPHAN_GRACE_HOURS * 3_600_000;
  const stale: string[] = [];

  for (let offset = 0; ; offset += LIST_PAGE) {
    const { data, error } = await supabaseAdmin.storage
      .from(BUCKET)
      .list("", { limit: LIST_PAGE, offset, sortBy: { column: "created_at", order: "asc" } });

    if (error) {
      errors.push(`bucket list failed at offset ${offset}: ${error.message}`);
      break;
    }

    const page = data ?? [];
    for (const obj of page) {
      // A row with no id is a prefix, not an object. Nothing writes prefixes here, but a
      // stray folder must not be mistaken for a file and handed to remove().
      if (!obj.name || !obj.id) continue;
      const created = obj.created_at ? new Date(obj.created_at).getTime() : NaN;
      // ‼️ AN UNREADABLE created_at IS SKIPPED, NEVER TREATED AS OLD. Guessing in this
      // direction deletes a photo somebody is currently looking at.
      if (!Number.isFinite(created) || created > cutoff) continue;
      stale.push(obj.name);
    }

    // Sorted ascending by age, so the first page that runs out of stale objects ends the walk.
    if (page.length < LIST_PAGE || stale.length === 0) break;
    if (page.every((o) => !o.created_at || new Date(o.created_at).getTime() > cutoff)) break;
  }

  if (!stale.length) return { found: 0, deleted: 0 };

  // Which of these does a live row still legitimately hold? Keys are session ids, so this is
  // one query rather than a join.
  const ids = stale.map(sessionIdFromKey).filter((v): v is string => v !== null);
  const held = new Set<string>();

  if (ids.length) {
    const { data, error } = await supabaseAdmin
      .from("concierge_sessions")
      .select("storage_ref")
      .in("id", ids)
      .not("storage_ref", "is", null);

    // ‼️ A FAILED LOOKUP ABORTS THE SWEEP. It must never fall through to "nothing is held",
    // which would delete every photo in the bucket including ones inside their 24 hours.
    if (error) {
      errors.push(`orphan ownership check failed, sweep skipped: ${error.message}`);
      return { found: stale.length, deleted: 0 };
    }
    for (const row of data ?? []) {
      if (row.storage_ref) held.add(row.storage_ref as string);
    }
  }

  const orphans = stale.filter((name) => !held.has(name));
  if (!orphans.length || dry) return { found: orphans.length, deleted: dry ? orphans.length : 0 };

  const { error } = await supabaseAdmin.storage.from(BUCKET).remove(orphans);
  if (error) {
    errors.push(`orphan remove failed for ${orphans.length} objects: ${error.message}`);
    return { found: orphans.length, deleted: 0 };
  }
  return { found: orphans.length, deleted: orphans.length };
}

export async function purgeConciergePhotos(dry = false): Promise<PurgeResult> {
  const errors: string[] = [];
  const table = await sweepTable(dry, errors);
  const orphans = await sweepOrphans(dry, errors);

  return {
    dry,
    due: table.due,
    deleted: table.deleted,
    orphansFound: orphans.found,
    orphansDeleted: orphans.deleted,
    errors,
  };
}
