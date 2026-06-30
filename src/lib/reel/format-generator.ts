// Avatar -> 30-format calendar generator (Content Engine v2, Phase 1).
//
// generateFormatCalendar(verticalId):
//   1. Web-search REAL reference examples first (Anthropic web_search server tool), per
//      format group, storing the URLs.
//   2. ONE Claude call distills the vertical's kit (gold examples + offer + the POV transform
//      rule) into ~30 categorized formats, each with a POV scene, an open-loop hook, a
//      difficulty, and a shot_count that scales with difficulty.
//   3. Upsert into `vertical_formats` (deterministic ids so re-runs replace in place).
//
// Also exposes the rotation + Slack request grammar (`generate POV Pest Control 5 ideas`):
// pickUnusedFormats / markFormatsUsed / handleGenerateIdeas.

import { callClaudeJSON, type ClaudeModel } from "@/lib/claude-calls";
import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { stripEmDashes } from "@/lib/reel/text";
import { loadVertical, type Vertical } from "@/config/verticals";
import { POV_GLASSES_TOKEN } from "@/config/pov-style";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

function model(): ClaudeModel {
  return (process.env.ANTHROPIC_MODEL as ClaudeModel) || "claude-sonnet-4-6";
}

// The 8 universal short-form format groups (from the pest-control content library taxonomy,
// generalized so any vertical can reuse them). `theme` seeds the web-search query; `defaultDifficulty`
// is the starting point the Claude call may refine per format.
interface FormatGroup {
  key: string;
  theme: string;
  defaultDifficulty: "easy" | "medium" | "hard";
}

export const FORMAT_GROUPS: FormatGroup[] = [
  { key: "satisfying_broll", theme: "satisfying / ASMR process b-roll", defaultDifficulty: "easy" },
  { key: "pest_reveal", theme: "reveal and removal payoff", defaultDifficulty: "hard" },
  { key: "before_after", theme: "before and after transformation", defaultDifficulty: "medium" },
  { key: "equipment_tech", theme: "equipment and tech showcase", defaultDifficulty: "medium" },
  { key: "educational", theme: "educational did-you-know fact", defaultDifficulty: "medium" },
  { key: "myth_buster", theme: "myth-buster with a red X", defaultDifficulty: "medium" },
  { key: "seasonal_alert", theme: "seasonal alert with built-in urgency", defaultDifficulty: "medium" },
  { key: "prevention_tip", theme: "prevention tip / pro move", defaultDifficulty: "medium" },
];

const FORMATS_PER_GROUP = 4; // 8 groups x 4 ~= 32 formats

const SHOT_RANGE = { min: 11, max: 16 };
function clampShots(n: unknown, difficulty: string): number {
  const fallback = difficulty === "hard" ? 15 : difficulty === "medium" ? 13 : 11;
  const v = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : fallback;
  return Math.min(SHOT_RANGE.max, Math.max(SHOT_RANGE.min, v));
}
function normalizeDifficulty(d: unknown): "easy" | "medium" | "hard" {
  const s = String(d ?? "").toLowerCase();
  return s === "hard" || s === "medium" || s === "easy" ? s : "medium";
}

// ---------------------------------------------------------------------------
// 1. Web search — real reference examples per format group
// ---------------------------------------------------------------------------

/**
 * Server-side web search via Anthropic's `web_search` server tool (reuses ANTHROPIC_API_KEY).
 * Returns the result URLs. On any error or empty result we synthesize deterministic search
 * URLs so callers always have at least one reference to store.
 */
export async function webSearchReferences(query: string, max = 4): Promise<string[]> {
  const fallback = () => [
    `https://www.tiktok.com/search?q=${encodeURIComponent(query)}`,
    `https://www.youtube.com/results?search_query=${encodeURIComponent(query + " short")}`,
  ];

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return fallback();

  try {
    const res = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: model(),
        max_tokens: 1024,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }],
        messages: [
          {
            role: "user",
            content: `Find real short-form video examples (TikTok, Instagram Reels, YouTube Shorts) for: ${query}. Just search; I only need the source links.`,
          },
        ],
      }),
    });
    if (!res.ok) return fallback();

    const json = (await res.json()) as {
      content?: Array<{
        type: string;
        content?: Array<{ type?: string; url?: string }>;
      }>;
    };

    const urls: string[] = [];
    for (const block of json.content ?? []) {
      if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
        for (const r of block.content) {
          if (r && typeof r.url === "string" && r.url.startsWith("http")) urls.push(r.url);
        }
      }
    }
    const deduped = Array.from(new Set(urls)).slice(0, max);
    return deduped.length > 0 ? deduped : fallback();
  } catch (e) {
    console.error("[format-generator] webSearchReferences fell back:", (e as Error).message);
    return fallback();
  }
}

// ---------------------------------------------------------------------------
// 2. The calendar generator
// ---------------------------------------------------------------------------

interface GeneratedFormat {
  format_group: string;
  scene: string;
  hook: string;
  difficulty: "easy" | "medium" | "hard";
  shot_count: number;
}

interface FormatGenResponse {
  formats: Array<{
    format_group?: string;
    scene?: string;
    hook?: string;
    difficulty?: string;
    shot_count?: number;
  }>;
}

function isFormatGenResponse(v: unknown): v is FormatGenResponse {
  if (typeof v !== "object" || v === null) return false;
  const f = (v as FormatGenResponse).formats;
  return Array.isArray(f) && f.every((x) => typeof x === "object" && x !== null && typeof x.scene === "string");
}

function buildGenSystem(v: Vertical, groups: Array<FormatGroup & { references: string[] }>): string {
  const styleToken = v.style_token || POV_GLASSES_TOKEN;
  const lines = [
    `You are the content engine for a ${v.business_descriptor}. You design a short-form video`,
    "calendar produced as continuous AI clips animated from a first frame, styled to look like",
    "real footage captured on Ray-Ban Meta smart glasses.",
    "",
    `The wearer is the ${v.wearer_role}. Every scene is a FIRST-PERSON personal account: we see`,
    "their own gloved hands and forearms in the lower frame performing the task. Rewrite every",
    "idea from third-person into first-person POV with the wearer's own hands doing it.",
    "",
    "GLOBAL VISUAL STYLE (kept in mind, never restate inside a scene):",
    styleToken,
    "",
    "HARD RULES for each format:",
    "- scene: ONE animation-friendly description of the action; first-person; the wearer's own",
    "  gloved hands; NO on-screen text (text is added in post). 1 to 2 sentences.",
    "- hook: the open-loop, pattern-interrupt 'wtf' line shown on the FIRST frame. It must create",
    "  curiosity and stop the scroll. 8 words or fewer. This is always shot 1's purpose.",
    "- difficulty: 'easy' (a single simple action like a spray or trap), 'medium' (a couple of",
    "  steps), or 'hard' (a multi-step reveal, e.g. pulling a brick to reach the queen).",
    "- shot_count: integer 11 to 16. easy ~= 11, medium ~= 12 to 13, hard ~= 14 to 16.",
    "- Never invent prices, guarantees, or stats you cannot support.",
    "- Never use em dashes or en dashes. Use commas, periods, or hyphens.",
    "",
    "Match the quality and voice of these gold examples:",
    JSON.stringify(v.gold_examples, null, 2),
  ];
  if (v.offer?.big_idea) {
    lines.push("", "OFFER CONTEXT (weave naturally, never hard-sell):", JSON.stringify(v.offer, null, 2));
  }
  lines.push(
    "",
    `Produce exactly ${FORMATS_PER_GROUP} formats for EACH of these ${groups.length} groups`,
    "(use the group key verbatim as format_group). Real reference examples were found online",
    "for inspiration, listed per group:",
    ...groups.map(
      (g) => `- ${g.key} (${g.theme}); refs: ${g.references.slice(0, 3).join(" , ")}`
    )
  );
  return lines.join("\n");
}

const GEN_SCHEMA_HINT =
  '{ "formats": [ { "format_group": string, "scene": string, "hook": string, ' +
  '"difficulty": "easy"|"medium"|"hard", "shot_count": number } ] }';

export interface FormatCalendarResult {
  vertical_id: string;
  created: number;
  sample: Array<{ id: string; format_group: string; difficulty: string; shot_count: number }>;
}

/** Generate (or regenerate) the ~30-format calendar for a vertical and upsert it. */
export async function generateFormatCalendar(verticalId: string): Promise<FormatCalendarResult> {
  const vertical = await loadVertical(verticalId);

  // 1. Web search per group (in parallel) for real reference examples.
  const groupsWithRefs = await Promise.all(
    FORMAT_GROUPS.map(async (g) => ({
      ...g,
      references: await webSearchReferences(`${vertical.name} ${g.theme} short form reel`),
    }))
  );

  // 2. One Claude call -> ~30 formats.
  const { data } = await callClaudeJSON<FormatGenResponse>({
    model: model(),
    system: buildGenSystem(vertical, groupsWithRefs),
    user: "Return the JSON calendar of formats now.",
    maxTokens: 6000,
    temperature: 0.7,
    schemaHint: GEN_SCHEMA_HINT,
    validate: isFormatGenResponse,
  });

  const refByGroup = new Map(groupsWithRefs.map((g) => [g.key, g.references]));
  const groupKeys = new Set(FORMAT_GROUPS.map((g) => g.key));

  // 3. Build rows with deterministic per-group ids (so re-runs replace in place).
  const perGroupSeq: Record<string, number> = {};
  const rows = data.formats
    .map((f): (GeneratedFormat & { id: string; reference_urls: string[] }) | null => {
      const group = f.format_group && groupKeys.has(f.format_group) ? f.format_group : null;
      if (!group || !f.scene) return null;
      const difficulty = normalizeDifficulty(f.difficulty);
      const seq = (perGroupSeq[group] = (perGroupSeq[group] ?? 0) + 1);
      const id = `${verticalId}_gen_${group}_${String(seq).padStart(2, "0")}`;
      const refs = refByGroup.get(group) ?? [];
      const reference_urls = refs.length > 0 ? refs : fallbackRefs(vertical.name, group);
      return {
        id,
        format_group: group,
        scene: stripEmDashes(f.scene),
        hook: stripEmDashes(f.hook ?? ""),
        difficulty,
        shot_count: clampShots(f.shot_count, difficulty),
        reference_urls,
      };
    })
    .filter((r): r is GeneratedFormat & { id: string; reference_urls: string[] } => r !== null);

  if (rows.length === 0) {
    return { vertical_id: verticalId, created: 0, sample: [] };
  }

  const { error } = await supabaseAdmin.from("vertical_formats").upsert(
    rows.map((r) => ({
      id: r.id,
      vertical_id: verticalId,
      format_group: r.format_group,
      scene: r.scene,
      hook: r.hook,
      difficulty: r.difficulty,
      shot_count: r.shot_count,
      reference_urls: r.reference_urls,
      used_at: null,
    })),
    { onConflict: "id" }
  );
  if (error) throw new Error(`vertical_formats upsert failed: ${error.message}`);

  return {
    vertical_id: verticalId,
    created: rows.length,
    sample: rows.slice(0, 5).map((r) => ({
      id: r.id,
      format_group: r.format_group,
      difficulty: r.difficulty,
      shot_count: r.shot_count,
    })),
  };
}

// Synchronous deterministic fallback refs (kept out of the hot path above).
function fallbackRefs(name: string, group: string): string[] {
  const q = `${name} ${group}`;
  return [`https://www.tiktok.com/search?q=${encodeURIComponent(q)}`];
}

// ---------------------------------------------------------------------------
// 3. Rotation + Slack request grammar
// ---------------------------------------------------------------------------

export interface VerticalFormatRow {
  id: string;
  format_group: string | null;
  scene: string;
  hook: string | null;
  difficulty: string;
  shot_count: number;
}

/** Pick `n` formats, preferring never-used then least-recently-used, with light shuffle. */
export async function pickUnusedFormats(verticalId: string, n: number): Promise<VerticalFormatRow[]> {
  const { data } = await supabaseAdmin
    .from("vertical_formats")
    .select("id,format_group,scene,hook,difficulty,shot_count")
    .eq("vertical_id", verticalId)
    .order("used_at", { ascending: true, nullsFirst: true })
    .limit(Math.max(n * 4, n));

  const pool = (data as VerticalFormatRow[] | null) ?? [];
  // Shuffle the eligible pool so we don't always return the same head, then take n.
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}

/** Mark formats as used (rotation). */
export async function markFormatsUsed(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    await supabaseAdmin
      .from("vertical_formats")
      .update({ used_at: new Date().toISOString() })
      .in("id", ids);
  } catch (e) {
    console.error("[format-generator] markFormatsUsed failed:", (e as Error).message);
  }
}

/** Resolve a free-typed vertical name ("Pest Control") to a verticals row id. */
export async function resolveVerticalId(name: string): Promise<string> {
  const trimmed = name.trim();
  const slug = trimmed.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  try {
    const byId = await supabaseAdmin.from("verticals").select("id").eq("id", slug).maybeSingle();
    if (byId.data?.id) return byId.data.id as string;
    const byName = await supabaseAdmin.from("verticals").select("id").ilike("name", trimmed).maybeSingle();
    if (byName.data?.id) return byName.data.id as string;
  } catch (e) {
    console.error("[format-generator] resolveVerticalId failed:", (e as Error).message);
  }
  return slug;
}

/** Slack: post `count` rotation-aware format ideas for a vertical as numbered options. */
export async function handleGenerateIdeas(args: {
  channel: string;
  threadTs: string;
  verticalId: string;
  count: number;
}): Promise<void> {
  const { channel, threadTs, verticalId, count } = args;
  const vertical = await loadVertical(verticalId);
  const picks = await pickUnusedFormats(verticalId, Math.min(9, Math.max(1, count)));

  if (picks.length === 0) {
    await slack.postThreadReply(
      channel,
      threadTs,
      `No formats yet for *${vertical.name}*. Drop the avatar kit (Avatar + 6 Beliefs + Offer) in #content-analyzer to build the calendar.`
    );
    return;
  }

  const body = picks
    .map((p, i) => {
      const meta = `${p.difficulty}, ${p.shot_count} shots${p.format_group ? `, ${p.format_group}` : ""}`;
      const hook = p.hook ? `\n   hook: ${p.hook}` : "";
      return `*${i + 1}.* ${p.scene}${hook}\n   _${meta}_`;
    })
    .join("\n\n");

  await slack.postThreadReply(channel, threadTs, `POV *${vertical.name}*, ${picks.length} ideas:\n\n${body}`);
  await markFormatsUsed(picks.map((p) => p.id));
}
