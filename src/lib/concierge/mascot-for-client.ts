// Resolving a mascot key to its files, for a key that may not be in the code.
//
// ‼️ TWO KINDS OF MASCOT, ONE LOOKUP, AND THE ORDER MATTERS. A built-in is a static import resolved by
// mascotAssets(): served from /_next/static with a content hash, cached forever, no function invocation
// per page view on somebody else's website. A character generated for one client cannot be that, because
// adding it would mean a commit and a deploy per client, so its files live in the public `reels` bucket
// and its row carries the URLs. Built-ins are checked first so a client cannot shadow a shipped
// character with a half-finished row of their own.
//
// ‼️ IT VALIDATES RATHER THAN CASTS. The row is jsonb written by the paste-back handler, and the widget
// on a client's live website is what consumes it. A row missing `idle` returns null and the corner falls
// back to the plain pill, which is the same answer the widget already has for a tenant with no mascot.

import { supabaseAdmin } from "@/lib/db";
import { mascotAssets, type MascotAssets, type MascotClip } from "./mascot";

function url(v: unknown): string | null {
  return typeof v === "string" && /^https?:\/\//i.test(v) ? v : null;
}

function clips(v: unknown): MascotClip[] {
  if (!Array.isArray(v)) return [];
  const out: MascotClip[] = [];
  for (const raw of v) {
    const c = raw as { src?: unknown; ms?: unknown };
    const src = url(c?.src);
    const ms = typeof c?.ms === "number" && c.ms > 0 ? Math.min(c.ms, 30_000) : 8000;
    if (src) out.push({ src, ms });
  }
  return out.slice(0, 6);
}

function fromRow(raw: unknown): MascotAssets | null {
  const a = (raw ?? {}) as Record<string, unknown>;
  const idle = url(a.idle);
  const still = url(a.still) ?? idle;
  if (!idle || !still) return null;
  const width = typeof a.width === "number" && a.width > 0 ? a.width : 160;
  const height = typeof a.height === "number" && a.height > 0 ? a.height : 160;
  const egg = (a.easterEgg ?? null) as { src?: unknown; ms?: unknown } | null;
  const eggClips = egg ? clips([egg]) : [];
  return {
    idle,
    // A character with no talking clip keeps waving while it speaks, which is what the blue alien does
    // in code for the same reason. Better than a corner that goes still the moment it says something.
    talk: url(a.talk) ?? idle,
    still,
    width,
    height,
    flourishes: clips(a.flourishes),
    easterEgg: eggClips[0] ?? null,
  };
}

/**
 * The files for this client's mascot key, built-in or generated, or null for the plain pill.
 *
 * One indexed read, and only for a key the code does not already know, so an unchanged client never
 * touches the database for this.
 */
export async function mascotForClient(clientId: string, key: string | null): Promise<MascotAssets | null> {
  if (!key) return null;
  const builtin = mascotAssets(key);
  if (builtin) return builtin;

  const { data } = await supabaseAdmin
    .from("mascot_concepts")
    .select("assets")
    .eq("client_id", clientId)
    .eq("key", key)
    .maybeSingle();

  return data ? fromRow(data.assets) : null;
}
