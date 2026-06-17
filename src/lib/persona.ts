// Persona + voice retrieval for the SMS/iMessage draft engine.
//
// Persona prompts now live in the DB (bot_persona) so they can be trained live
// without a deploy. Voice examples (real incoming->reply pairs) are retrieved by
// pg_trgm similarity on the inbound text and injected as few-shot examples so the
// bot replies in Matthew's real texting voice.
//
// Both functions are best-effort: if the tables are empty or a query fails, the
// engine falls back to the hardcoded prompts in sms-ai-engine.ts.

import { supabaseAdmin } from "@/lib/db";

// Single tenant for now. Resolved to a uuid lazily and cached for the process.
export const DEFAULT_TENANT_SLUG = "srt";
let _tenantIdCache: Record<string, string> = {};

export async function resolveTenantId(slug: string = DEFAULT_TENANT_SLUG): Promise<string | null> {
  if (_tenantIdCache[slug]) return _tenantIdCache[slug];
  try {
    const { data } = await supabaseAdmin
      .from("tenants")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (data?.id) {
      _tenantIdCache[slug] = data.id as string;
      return data.id as string;
    }
  } catch (err) {
    console.error("[persona] resolveTenantId error:", err);
  }
  return null;
}

export interface PersonaBundle {
  base: string | null; // stage = null adaptive/base prompt
  byStage: Record<number, string>; // stages 1..4
  styleProfile: Record<string, unknown> | null; // from the base/active row
}

/**
 * Load the active persona for a tenant. Returns null if no rows exist (caller
 * then falls back to the hardcoded prompts).
 */
export async function loadPersona(tenantId: string): Promise<PersonaBundle | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("bot_persona")
      .select("stage, prompt, style_profile")
      .eq("tenant_id", tenantId)
      .eq("is_active", true);
    if (error || !data || data.length === 0) return null;

    const byStage: Record<number, string> = {};
    let base: string | null = null;
    let styleProfile: Record<string, unknown> | null = null;
    for (const row of data) {
      const stage = row.stage as number | null;
      if (stage == null) {
        base = row.prompt as string;
        styleProfile = (row.style_profile as Record<string, unknown> | null) ?? styleProfile;
      } else {
        byStage[stage] = row.prompt as string;
        // Prefer a base style profile, but fall back to any stage's profile.
        if (!styleProfile) styleProfile = (row.style_profile as Record<string, unknown> | null) ?? null;
      }
    }
    return { base, byStage, styleProfile };
  } catch (err) {
    console.error("[persona] loadPersona error:", err);
    return null;
  }
}

export interface VoiceExample {
  incoming: string;
  reply: string;
}

/**
 * Retrieve the top-K most similar past (incoming -> reply) pairs for a given
 * inbound message via the match_voice_examples pg_trgm RPC. Goldens are
 * force-included by the function. Returns [] on any failure.
 */
export async function matchVoiceExamples(
  tenantId: string,
  queryText: string,
  k = 6
): Promise<VoiceExample[]> {
  if (!queryText?.trim()) return [];
  try {
    const { data, error } = await supabaseAdmin.rpc("match_voice_examples", {
      query_text: queryText,
      p_tenant_id: tenantId,
      match_count: k,
    });
    if (error || !data) return [];
    return (data as { incoming: string; reply: string }[]).map((r) => ({
      incoming: r.incoming,
      reply: r.reply,
    }));
  } catch (err) {
    console.error("[persona] matchVoiceExamples error:", err);
    return [];
  }
}

/**
 * Render a style-profile JSON into a short instruction block for the system
 * prompt. Returns "" when there's nothing useful.
 */
export function renderStyleProfile(style: Record<string, unknown> | null | undefined): string {
  if (!style || typeof style !== "object") return "";
  const lines: string[] = [];
  if (typeof style.avg_len === "number") lines.push(`- Typical reply length: ~${style.avg_len} characters.`);
  if (typeof style.emoji_freq === "string") lines.push(`- Emoji use: ${style.emoji_freq}.`);
  if (Array.isArray(style.traits) && style.traits.length) lines.push(`- Voice traits: ${style.traits.join(", ")}.`);
  if (Array.isArray(style.banned_phrases) && style.banned_phrases.length)
    lines.push(`- Never use these phrases: ${style.banned_phrases.join(", ")}.`);
  if (typeof style.notes === "string" && style.notes.trim()) lines.push(`- ${style.notes.trim()}`);
  if (!lines.length) return "";
  return `\n\nStyle profile (match this):\n${lines.join("\n")}`;
}

/**
 * Render retrieved voice examples into a few-shot block for the system prompt.
 * Caps total length so a few long pairs don't blow the token budget. Returns ""
 * when there are no examples.
 */
export function renderVoiceExamples(examples: VoiceExample[], maxChars = 1600): string {
  if (!examples.length) return "";
  const blocks: string[] = [];
  let used = 0;
  for (const ex of examples) {
    const block = `Them: ${ex.incoming}\nMatthew: ${ex.reply}`;
    if (used + block.length > maxChars && blocks.length > 0) break;
    blocks.push(block);
    used += block.length;
  }
  return (
    `\n\nHere is how Matthew has really replied to similar messages. Match this voice — ` +
    `tone, length, punctuation, slang, capitalization. Do NOT copy verbatim and do NOT reuse ` +
    `the specific facts (names, numbers, deals) from these examples:\n\n${blocks.join("\n\n")}`
  );
}
