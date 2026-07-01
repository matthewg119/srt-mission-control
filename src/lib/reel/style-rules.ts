// Style Rules — the ✅-gated, two-tier tuning memory for the content engine.
//
// The operator reacts to a drop, then replies with plain-language feedback in the thread
// ("make the furnace look older, and put some plates on the shelf so it isn't empty"). We
// distill that into one or more concrete, imperative rules, post a "save these? ✅" card, and
// only flip them 'active' once the operator reacts ✅. Active rules are read back into the
// image-scene enrichment (prompt-enrich.ts) and the bug-reveal edit/copy builders, so the next
// drop obeys them. Empty/absent table -> "" everywhere, so behavior is byte-identical to today.
//
// State lives in the `style_rules` table (docs/2026-07-01-style-rules.sql).

import { callClaudeJSON, type ClaudeModel } from "@/lib/claude-calls";
import { slack } from "@/lib/slack-bot";
import { supabaseAdmin } from "@/lib/db";
import { stripEmDashes } from "@/lib/reel/text";
import { DEFAULT_VERTICAL_ID } from "@/config/verticals";

function model(): ClaudeModel {
  return (process.env.ANTHROPIC_MODEL as ClaudeModel) || "claude-sonnet-4-6";
}

export type RuleScope = "brand" | "format";

export interface StyleRule {
  id: string;
  vertical_id: string;
  scope: RuleScope;
  format_group: string | null;
  rule: string;
  status: "pending" | "active" | "archived";
}

interface StyleRuleRow {
  id: string;
  vertical_id: string;
  scope: string;
  format_group: string | null;
  rule: string;
  status: string;
}

// ---- Read: active rules -> prompt block --------------------------------------------------

/**
 * Load the ACTIVE style rules for a vertical: all brand rules plus the format rules whose
 * format_group matches. Best-effort: returns [] when the table is empty/absent or on error.
 */
export async function loadActiveStyleRules(
  verticalId: string = DEFAULT_VERTICAL_ID,
  formatGroup?: string
): Promise<StyleRule[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from("style_rules")
      .select("id,vertical_id,scope,format_group,rule,status")
      .eq("vertical_id", verticalId)
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .limit(60);
    if (error || !Array.isArray(data)) return [];
    return (data as StyleRuleRow[])
      .filter((r) => r.scope === "brand" || (r.scope === "format" && (!formatGroup || r.format_group === formatGroup)))
      .map((r) => ({
        id: r.id,
        vertical_id: r.vertical_id,
        scope: r.scope === "format" ? "format" : "brand",
        format_group: r.format_group,
        rule: r.rule,
        status: "active",
      }));
  } catch (e) {
    console.error("[style-rules] loadActiveStyleRules fell back to empty:", (e as Error).message);
    return [];
  }
}

/**
 * Render the active rules as a compact instruction block for a generation prompt. Returns ""
 * when there are none, so callers stay byte-identical to today until the operator approves a rule.
 */
export async function loadStyleRulesText(
  verticalId: string = DEFAULT_VERTICAL_ID,
  formatGroup?: string
): Promise<string> {
  const rules = await loadActiveStyleRules(verticalId, formatGroup);
  if (rules.length === 0) return "";
  const lines = rules.map((r) => `- ${stripEmDashes(r.rule)}`);
  return ["Operator style rules (follow every one that applies):", ...lines].join("\n");
}

// ---- Distill: feedback reply -> candidate rules ------------------------------------------

export interface CandidateRule {
  scope: RuleScope;
  format_group: string | null;
  rule: string;
}

interface DistillResult {
  intent: "tune" | "remix" | "other";
  rules: CandidateRule[];
}

function isDistillResult(v: unknown): v is DistillResult {
  if (typeof v !== "object" || v === null) return false;
  const d = v as DistillResult;
  if (d.intent !== "tune" && d.intent !== "remix" && d.intent !== "other") return false;
  if (!Array.isArray(d.rules)) return false;
  return d.rules.every(
    (r) =>
      r &&
      typeof r.rule === "string" &&
      (r.scope === "brand" || r.scope === "format")
  );
}

/**
 * Classify a drop-thread reply and, if it is tuning feedback, extract concrete style rules.
 * `intent` is 'remix' when the operator is just asking for fresh options (let the remix handler
 * take it), 'other' when it is neither, and 'tune' when there are real corrections to save.
 */
export async function distillFeedbackToRules(args: {
  text: string;
  formatGroup: string;
  verticalId?: string;
}): Promise<DistillResult> {
  const system = [
    "You turn an operator's plain-language feedback on an AI-generated content image into concrete,",
    "reusable STYLE RULES for future image generations. The images are first-person Ray-Ban Meta POV",
    `pest-control shots. The current format group is "${args.formatGroup}".`,
    "",
    "Classify the reply's intent:",
    "- 'remix'  = they only want fresh/different options regenerated (e.g. 'give me more', 'try again',",
    "             'different ones'), with no specific correction to remember. Return rules: [].",
    "- 'tune'   = they gave at least one concrete visual/style correction worth remembering",
    "             (e.g. 'make the furnace look older', 'the shelf is too empty, add some plates',",
    "             'houses look too clean and new'). Extract each as its own rule.",
    "- 'other'  = neither (a question, a pick like 'I like 3', small talk). Return rules: [].",
    "",
    "For each rule when intent='tune':",
    "- rule: ONE imperative sentence a prompt-writer can apply directly, generalized beyond this one",
    "  image (e.g. 'Show older, lived-in homes with worn paint and aged fixtures, not new construction').",
    "- scope: 'format' if it is specific to this kind of reveal shot, 'brand' if it should apply to ALL",
    "  of our pest-control content. Default to 'format' when unsure.",
    "- format_group: the current format group when scope='format', otherwise null.",
    "",
    "Never invent corrections the operator did not imply. Never use em dashes or en dashes.",
  ].join("\n");

  const { data } = await callClaudeJSON<DistillResult>({
    model: model(),
    system,
    user: [`Operator reply:`, args.text.trim().slice(0, 1200), "", "Return the classification + rules as JSON."].join("\n"),
    maxTokens: 900,
    temperature: 0.2,
    schemaHint:
      '{ "intent": "tune"|"remix"|"other", "rules": [ { "scope": "brand"|"format", "format_group": string|null, "rule": string } ] }',
    validate: isDistillResult,
  });

  return {
    intent: data.intent,
    rules: data.rules
      .map((r): CandidateRule => ({
        scope: r.scope === "brand" ? "brand" : "format",
        format_group: r.scope === "brand" ? null : r.format_group ?? args.formatGroup,
        rule: stripEmDashes(r.rule).trim(),
      }))
      .filter((r) => r.rule.length > 0),
  };
}

// ---- Save (pending) + approve (active) ---------------------------------------------------

/** Insert candidate rules as 'pending', tagged with the proposal card ts for ✅ routing. */
export async function savePendingRules(
  candidates: CandidateRule[],
  ctx: { verticalId?: string; channel: string; threadTs: string; proposalTs: string }
): Promise<number> {
  if (candidates.length === 0) return 0;
  const rows = candidates.map((c) => ({
    vertical_id: ctx.verticalId ?? DEFAULT_VERTICAL_ID,
    scope: c.scope,
    format_group: c.scope === "brand" ? null : c.format_group,
    rule: c.rule,
    status: "pending",
    source_thread_ts: ctx.threadTs,
    slack_channel: ctx.channel,
    proposal_ts: ctx.proposalTs,
  }));
  const { error } = await supabaseAdmin.from("style_rules").insert(rows);
  if (error) {
    console.error("[style-rules] savePendingRules failed:", error.message);
    return 0;
  }
  return rows.length;
}

/** Approve (or discard) the pending rules attached to a proposal card. Returns how many changed. */
export async function resolvePendingRulesByProposal(proposalTs: string, approve: boolean): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from("style_rules")
    .select("id")
    .eq("proposal_ts", proposalTs)
    .eq("status", "pending");
  if (error || !Array.isArray(data) || data.length === 0) return 0;
  const ids = (data as Array<{ id: string }>).map((r) => r.id);
  const patch = approve
    ? { status: "active", approved_at: new Date().toISOString() }
    : { status: "archived" };
  const { error: upErr } = await supabaseAdmin.from("style_rules").update(patch).in("id", ids);
  if (upErr) {
    console.error("[style-rules] resolvePendingRulesByProposal failed:", upErr.message);
    return 0;
  }
  return ids.length;
}

// ---- Slack handlers ----------------------------------------------------------------------

// Match set shared with the other content handlers.
const APPROVE_REACTIONS = new Set(["white_check_mark", "heavy_check_mark", "ballot_box_with_check"]);
const DISCARD_REACTIONS = new Set(["no_entry", "no_entry_sign", "x", "wastebasket"]);

/**
 * Reaction on a "save these style rules?" proposal card: ✅ activates the pending rules, 🚫
 * discards them. Self-routes by proposal_ts, so it is a no-op for any other message. Returns
 * true when it acted.
 */
export async function handleStyleRuleApproval(args: {
  reaction: string;
  slackTs: string;
  channel: string;
}): Promise<boolean> {
  const approve = APPROVE_REACTIONS.has(args.reaction);
  const discard = DISCARD_REACTIONS.has(args.reaction);
  if (!approve && !discard) return false;

  // Cheap guard: only touch the DB when a proposal actually matches this ts.
  const { data } = await supabaseAdmin
    .from("style_rules")
    .select("id")
    .eq("proposal_ts", args.slackTs)
    .eq("status", "pending")
    .limit(1);
  if (!Array.isArray(data) || data.length === 0) return false;

  const n = await resolvePendingRulesByProposal(args.slackTs, approve);
  if (n === 0) return false;

  await slack.postThreadReply(
    args.channel,
    args.slackTs,
    approve
      ? `✅ Saved ${n} style rule${n === 1 ? "" : "s"}. Future drops will follow ${n === 1 ? "it" : "them"}.`
      : `🚫 Discarded ${n} proposed rule${n === 1 ? "" : "s"}.`
  );
  return true;
}

/** Render the active rules for a `rules` command reply. Returns a human-readable summary. */
export async function summarizeActiveRules(verticalId: string = DEFAULT_VERTICAL_ID): Promise<string> {
  const rules = await loadActiveStyleRules(verticalId);
  if (rules.length === 0) return "No active style rules yet. Reply to a drop with feedback to add one.";
  const brand = rules.filter((r) => r.scope === "brand");
  const byFormat = new Map<string, StyleRule[]>();
  for (const r of rules.filter((r) => r.scope === "format")) {
    const k = r.format_group ?? "format";
    byFormat.set(k, [...(byFormat.get(k) ?? []), r]);
  }
  const out: string[] = ["*Active style rules:*"];
  if (brand.length) {
    out.push("*Brand (all content):*", ...brand.map((r) => `• ${r.rule}`));
  }
  for (const [group, rs] of byFormat) {
    out.push(`*${group}:*`, ...rs.map((r) => `• ${r.rule}`));
  }
  return out.join("\n");
}
