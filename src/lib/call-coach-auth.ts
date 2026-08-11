import { supabaseAdmin } from "./db";

export interface CallCoachUser {
  id: string;
  name: string;
}

/**
 * In-process cache of validated keys.
 *
 * ‼️ This sits on the critical path of a LIVE CALL. Every suggestion used to block on a Supabase
 * round trip before the Anthropic request was even opened, so the prospect's pause was padded by
 * a database query on every single turn, dozens of times per call, for an answer that changes
 * approximately never.
 *
 * Negative results are cached too, and deliberately: without that, a wrong or revoked key turns
 * every retry into a fresh query, which is the one case where the lookup is both useless and
 * unbounded.
 *
 * Trade: a revoked key keeps working for up to TTL_MS. That is the right call for a single
 * operator internal tool, and it is bounded and stated rather than accidental. If this ever
 * serves more than a handful of people, move revocation to an explicit bust rather than
 * shortening the TTL.
 *
 * Lambda-local, so it dies with the instance. No invalidation story is needed beyond the TTL.
 */
const TTL_MS = 5 * 60 * 1000;
const keyCache = new Map<string, { user: CallCoachUser | null; at: number }>();

/**
 * Validate a Call Coach API key and return the user.
 * Returns null if the key is invalid or inactive.
 */
export async function validateCallCoachKey(
  apiKey: string
): Promise<CallCoachUser | null> {
  if (!apiKey || apiKey.length < 10) return null;

  const hit = keyCache.get(apiKey);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.user;

  const { data, error } = await supabaseAdmin
    .from("call_coach_users")
    .select("id, name, is_active")
    .eq("api_key", apiKey)
    .single();

  // A transient Supabase failure is NOT cached as a negative. Caching it would lock the coach
  // out for five minutes over one blip, mid-call, with no way to recover but waiting.
  if (error && !data) return null;

  const user =
    !data || !data.is_active ? null : { id: data.id, name: data.name };

  keyCache.set(apiKey, { user, at: Date.now() });
  return user;
}

/**
 * Extract the API key from the Authorization header.
 * Expects: "Bearer <api_key>"
 */
export function extractApiKey(request: Request): string | null {
  const auth = request.headers.get("Authorization");
  if (!auth) return null;

  if (auth.startsWith("Bearer ")) {
    return auth.slice(7).trim();
  }

  return auth.trim();
}
