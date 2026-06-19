// Intelligence for standalone /apply submissions (srtagency.com/apply).
//
// On each submission we: (1) search existing deals/leads for the business name
// with fuzzy/misspelling matching to confirm we don't already have it, (2) ask
// Claude what we should do with it, and (3) post a #srt-sub card with a "Check"
// button that performs the suggested action(s) and reports back exactly what it
// did. Reuses resolveLead() for the fuzzy match and callClaudeJSON() for the
// suggestion.

import { supabaseAdmin } from "@/lib/db";
import { callClaudeJSON } from "@/lib/claude-calls";
import { resolveLead } from "./build-draft";
import type { ApplySuggestedAction, ApplyDedup } from "./types";

export interface ApplyInput {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  business_name?: string;
  industry?: string;
  biz_type?: string;
  ein?: string;
  inc_date?: string;
  ownership?: string;
  biz_address?: string;
  biz_city?: string;
  biz_state?: string;
  biz_zip?: string;
  monthly_revenue?: string;
  amount_needed?: string;
  use_of_funds?: string;
  existing_loans?: string;
  funding_urgency?: string;
  [key: string]: string | undefined;
}

export interface ApplySuggestion {
  summary: string;
  actions: ApplySuggestedAction[];
}

/**
 * Confirm whether we already have this business. Exact + fuzzy match against
 * contacts/deals (resolveLead), plus a count of prior /apply submits under a
 * similar name so two owners of the same business surface as related.
 */
export async function dedupCheck(businessName: string): Promise<ApplyDedup> {
  const match = await resolveLead(businessName);

  // Prior standalone /apply submissions for the same/similar business name.
  let priorApplyCount = 0;
  const name = (businessName || "").trim();
  if (name.length >= 3) {
    const { count } = await supabaseAdmin
      .from("standalone_applications")
      .select("id", { count: "exact", head: true })
      .ilike("business_name", `%${name}%`);
    priorApplyCount = count ?? 0;
  }

  const matched = match.confidence !== "none" || priorApplyCount > 1;
  return {
    matched,
    confidence: match.confidence,
    existing_name: match.businessName,
    existing_zoho_id: match.zohoDealId || match.zohoLeadId || null,
    prior_apply_count: priorApplyCount,
  };
}

function isSuggestion(v: unknown): v is ApplySuggestion {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return typeof o.summary === "string" && Array.isArray(o.actions);
}

const VALID_KINDS = new Set(["ensure_deal", "create_zoho_lead", "add_note", "flag_duplicate"]);

/** Ask Claude what to do with this application. Vektor style, no em dashes. */
export async function suggestActions(app: ApplyInput, dedup: ApplyDedup): Promise<ApplySuggestion> {
  const system = [
    "You are VeKtor, the submissions assistant for SRT Agency, a business funding broker.",
    "A new business funding application just came in through the public /apply link.",
    "Decide what we should do with it and produce a SHORT summary plus a list of concrete next actions.",
    "Style rules: short, direct, no emotion, fact + action only. Never use the em dash character; use commas, periods, or hyphens.",
    "Action kinds you may use:",
    "- create_zoho_lead: we do NOT already have this business, create a Zoho lead.",
    "- add_note: log a note on the existing record with the application details.",
    "- flag_duplicate: we likely already have this business (or the same business applied twice), flag for manual merge instead of creating a duplicate.",
    "- ensure_deal: make sure a deal/thread exists for this business.",
    "If dedup.matched is true, prefer flag_duplicate and add_note over create_zoho_lead.",
    "If dedup.matched is false, prefer create_zoho_lead and ensure_deal.",
    "Keep actions to the 1-3 that matter. Each action detail is one short line.",
  ].join("\n");

  const user = [
    `Application:`,
    `Business: ${app.business_name || "?"}`,
    `Contact: ${[app.first_name, app.last_name].filter(Boolean).join(" ") || "?"} | ${app.email || "?"} | ${app.phone || "?"}`,
    `Industry: ${app.industry || "?"} | Type: ${app.biz_type || "?"} | Started: ${app.inc_date || "?"}`,
    `Monthly revenue: ${app.monthly_revenue || "?"} | Requesting: ${app.amount_needed || "?"} | Use: ${app.use_of_funds || "?"}`,
    `Existing loans: ${app.existing_loans || "?"} | Urgency: ${app.funding_urgency || "?"}`,
    ``,
    `Dedup result: matched=${dedup.matched} confidence=${dedup.confidence} existing_name=${dedup.existing_name || "none"} prior_apply_count=${dedup.prior_apply_count ?? 0}`,
  ].join("\n");

  try {
    const { data } = await callClaudeJSON<ApplySuggestion>({
      model: "claude-sonnet-4-6",
      system,
      user,
      maxTokens: 700,
      schemaHint: `{ "summary": string, "actions": [{ "kind": "ensure_deal" | "create_zoho_lead" | "add_note" | "flag_duplicate", "detail": string }] }`,
      validate: isSuggestion,
    });
    const actions = (data.actions || [])
      .filter((a) => a && VALID_KINDS.has(a.kind))
      .slice(0, 3);
    return { summary: data.summary.trim(), actions };
  } catch (e) {
    console.error("[apply-intel] suggestActions failed, using fallback:", (e as Error).message);
    // Deterministic fallback so the card still posts if Claude is unavailable.
    return dedup.matched
      ? { summary: `Possible duplicate of ${dedup.existing_name || "an existing record"}. Review before creating a new lead.`, actions: [{ kind: "flag_duplicate", detail: "Likely existing business, flag for manual merge." }] }
      : { summary: `New application for ${app.business_name || "a business"}. No existing record found.`, actions: [{ kind: "create_zoho_lead", detail: "Create a Zoho lead from this application." }] };
  }
}

/** Slack blocks for the #srt-sub card: details + dedup verdict + AI summary + Check button. */
export function buildApplyCard(app: ApplyInput, dedup: ApplyDedup, suggestion: ApplySuggestion, onedriveLinks?: string): unknown[] {
  const biz = app.business_name || "Unknown business";
  const contact = [app.first_name, app.last_name].filter(Boolean).join(" ") || "Applicant";
  const dedupLine =
    dedup.confidence !== "none"
      ? `:warning: Possible match: *${dedup.existing_name || "existing record"}* (${dedup.confidence})`
      : (dedup.prior_apply_count && dedup.prior_apply_count > 1)
        ? `:warning: ${dedup.prior_apply_count} applications under this business name`
        : `:white_check_mark: No existing record found`;

  const actionsList = suggestion.actions.map((a) => `• *${a.kind.replace(/_/g, " ")}:* ${a.detail}`).join("\n") || "• (none)";

  const detail =
    `:page_facing_up: *New application — ${biz}*\n` +
    `*Contact:* ${contact} | ${app.email || "no email"} | ${app.phone || "no phone"}\n` +
    `*Requesting:* ${app.amount_needed || "?"} | *Revenue:* ${app.monthly_revenue || "?"}/mo | *Use:* ${app.use_of_funds || "?"}\n` +
    `${dedupLine}\n\n` +
    `*VeKtor:* ${suggestion.summary}\n` +
    `*Suggested:*\n${actionsList}` +
    (onedriveLinks ? `\n\n*OneDrive:*\n${onedriveLinks}` : "");

  return [
    { type: "section", text: { type: "mrkdwn", text: detail } },
    {
      type: "actions",
      elements: [
        { type: "button", text: { type: "plain_text", text: ":white_check_mark: Check" }, style: "primary", action_id: "apply_check", value: "apply" },
        { type: "button", text: { type: "plain_text", text: ":no_entry: Dismiss" }, style: "danger", action_id: "ai_cancel", value: "apply" },
      ],
    },
    { type: "context", elements: [{ type: "mrkdwn", text: "Click *Check* and I will run the suggested actions, then report exactly what I did." }] },
  ];
}
