import { supabaseAdmin } from "@/lib/db";
import { microsoft } from "@/lib/microsoft";
import { DEFAULTS } from "@/config/defaults";

const ROUTING_SUBJECT_PREFIX = "[VeKtor Routing]";

export function isRoutingSubject(subject: string | undefined | null): boolean {
  if (!subject) return false;
  return subject.includes(ROUTING_SUBJECT_PREFIX);
}

export function buildRoutingSubject(businessName: string): string {
  return `${ROUTING_SUBJECT_PREFIX} ${businessName} — where should I send this deal?`;
}

export async function sendLenderRoutingRequest(opts: {
  dealId: string;
  contactId: string;
  businessName: string;
  amountRequested: number;
  industry: string | null;
  useOfFunds: string | null;
  monthlyRevenue: number | null;
  onedriveFolderUrl: string | null;
  bankStatementReportPreview?: string | null;
}): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const subject = buildRoutingSubject(opts.businessName);

  const body = `VeKtor has a submission package ready and is waiting for you to choose which lender(s) to send it to.

Deal Summary
------------
Business:        ${opts.businessName}
Amount Needed:   $${opts.amountRequested.toLocaleString()}
Industry:        ${opts.industry ?? "—"}
Use of Funds:    ${opts.useOfFunds ?? "—"}
Monthly Revenue: ${opts.monthlyRevenue ? `$${opts.monthlyRevenue.toLocaleString()}` : "—"}

Documents
---------
OneDrive folder: ${opts.onedriveFolderUrl ?? "(not created yet)"}

${opts.bankStatementReportPreview ? `Bank Statement Analysis (preview)\n---------------------------------\n${opts.bankStatementReportPreview.slice(0, 1500)}\n\n` : ""}
Reply to this email with the lender names you want to submit to. Examples:
  - "Send to Legend and Fundbox"
  - "Tier 1 only"
  - "Legend, Yellowstone, Forward"

VeKtor will match the names to the lender database, draft the submission email, and post to #Vektor-deals-Matt for final approval before sending anything.

— VeKtor
SRT Agency's AI Intelligence Layer`;

  try {
    await microsoft.sendMail({
      to: DEFAULTS.submissionsFromAddress,
      subject,
      body,
      isHtml: false,
    });
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  await supabaseAdmin.from("ai_decisions").insert({
    merchant_id: opts.contactId,
    trigger_type: "slack_command",
    state_classified: "routing_request",
    action_taken: "slack_alert",
    reasoning: `VeKtor sent routing request to submissions@ for ${opts.businessName}`,
    raw_response: {
      business: opts.businessName,
      amount: opts.amountRequested,
      onedrive: opts.onedriveFolderUrl,
    },
    model_used: "n/a",
  });

  return { ok: true };
}

export async function parseLenderChoicesFromReply(replyBody: string): Promise<{
  lender_ids: string[];
  matched_names: string[];
  unmatched: string[];
  note: string | null;
}> {
  // Extract optional note: text after "note:" or "/ note" separator
  let note: string | null = null;
  let lenderText = replyBody.slice(0, 2000);
  const noteMatch = replyBody.match(/(?:\/\s*note\s*:?|^note\s*:)(.*)/im);
  if (noteMatch) {
    note = noteMatch[1].trim() || null;
    lenderText = replyBody.slice(0, noteMatch.index).trim();
  }

  const text = lenderText.toLowerCase();

  const { data: lenders } = await supabaseAdmin
    .from("lenders")
    .select("id, name, tier")
    .eq("is_active", true);

  const rows = (lenders ?? []) as Array<{ id: string; name: string; tier: number }>;

  const tierOnly = text.match(/tier\s*([123])\s*only/i);
  if (tierOnly) {
    const tier = Number(tierOnly[1]);
    const matches = rows.filter((l) => l.tier === tier);
    return {
      lender_ids: matches.map((l) => l.id),
      matched_names: matches.map((l) => l.name),
      unmatched: [],
      note,
    };
  }

  const matched: Array<{ id: string; name: string }> = [];
  const unmatched: string[] = [];

  const tokens = text
    .replace(/[.,!?;\n]+/g, " ")
    .split(/\s+and\s+|\s*,\s*|\s+or\s+|\s{2,}/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);

  for (const token of tokens) {
    const hit = rows.find((l) => {
      const lower = l.name.toLowerCase();
      return lower.includes(token) || token.includes(lower);
    });
    if (hit && !matched.find((m) => m.id === hit.id)) {
      matched.push({ id: hit.id, name: hit.name });
    }
  }

  const pronounced = matched.map((m) => m.name.toLowerCase());
  for (const token of tokens) {
    if (token.length < 4) continue;
    if (!pronounced.some((n) => n.includes(token) || token.includes(n))) {
      if (!["tier", "only", "send", "all", "the", "to", "for"].includes(token) && !unmatched.includes(token)) {
        unmatched.push(token);
      }
    }
  }

  return {
    lender_ids: matched.map((m) => m.id),
    matched_names: matched.map((m) => m.name),
    unmatched: unmatched.slice(0, 5),
    note,
  };
}
