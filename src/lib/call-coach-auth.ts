import { supabaseAdmin } from "./db";

export interface CallCoachUser {
  id: string;
  name: string;
}

/**
 * Validate a Call Coach API key and return the user.
 * Returns null if the key is invalid or inactive.
 */
export async function validateCallCoachKey(
  apiKey: string
): Promise<CallCoachUser | null> {
  if (!apiKey || apiKey.length < 10) return null;

  const { data, error } = await supabaseAdmin
    .from("call_coach_users")
    .select("id, name, is_active")
    .eq("api_key", apiKey)
    .single();

  if (error || !data || !data.is_active) return null;

  return { id: data.id, name: data.name };
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
