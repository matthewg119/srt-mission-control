// Data layer for #srt-sub bank-statement drops (Submissions draft + Vektor thread controls).
//
// One PDF drop becomes one statement_drops row keyed by its Slack thread. The row
// holds enough context to rebuild the Outlook draft with a different month count,
// resolve a name mismatch via a thread "override", and let Vektor answer questions
// about the analysis in-thread. Statement bytes are NOT stored — only Slack file
// references; the bytes are re-downloaded from Slack on rebuild.
//
// Intentionally standalone (no FK to deals/contacts) — see the SQL migration.

import { supabaseAdmin } from "@/lib/db";

/** A statement file reference (bytes re-downloaded from Slack on rebuild). */
export interface StatementFileRef {
  name: string;
  slack_url: string;   // url_private_download
  month: string | null; // YYYY-MM (best-effort), for sorting/trimming
}

export interface AppFileRef {
  name: string;
  slack_url: string;
}

export type StatementDropStatus = "built" | "awaiting_name_confirm" | "dnq";

export interface StatementDropRow {
  id: string;
  slack_channel: string | null;
  slack_thread_ts: string;
  business_name: string | null;
  account_holder: string | null;
  subject: string | null;
  status: StatementDropStatus;
  metrics_json: Record<string, unknown> | null;
  statements_json: StatementFileRef[] | null;
  app_json: AppFileRef | null;
  months_limit: number | null;
  email_note: string | null;        // merchant note rendered under the deposit table
  zoho_lead_id: string | null;
  zoho_deal_id: string | null;
}

const ROW_COLS =
  "id, slack_channel, slack_thread_ts, business_name, account_holder, subject, status, metrics_json, statements_json, app_json, months_limit, email_note, zoho_lead_id, zoho_deal_id";

/**
 * Upsert the drop row for a thread. Idempotent on slack_thread_ts — a re-drop in
 * the same thread overwrites the stored context.
 */
export async function createStatementDrop(input: {
  slackChannel: string;
  slackThreadTs: string;
  businessName: string | null;
  accountHolder: string | null;
  subject: string | null;
  status: StatementDropStatus;
  metricsJson: Record<string, unknown> | null;
  statementsJson: StatementFileRef[];
  appJson: AppFileRef | null;
  monthsLimit: number | null;
  emailNote: string | null;
  zohoLeadId: string | null;
  zohoDealId: string | null;
}): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("statement_drops")
    .upsert(
      {
        slack_channel: input.slackChannel,
        slack_thread_ts: input.slackThreadTs,
        business_name: input.businessName,
        account_holder: input.accountHolder,
        subject: input.subject,
        status: input.status,
        metrics_json: input.metricsJson,
        statements_json: input.statementsJson,
        app_json: input.appJson,
        months_limit: input.monthsLimit,
        email_note: input.emailNote,
        zoho_lead_id: input.zohoLeadId,
        zoho_deal_id: input.zohoDealId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "slack_thread_ts" }
    )
    .select("id")
    .maybeSingle();

  if (error) {
    console.warn("[statement-drops] upsert failed:", error.message);
    return null;
  }
  return (data?.id as string) ?? null;
}

export async function getStatementDropByThread(threadTs: string): Promise<StatementDropRow | null> {
  const { data } = await supabaseAdmin
    .from("statement_drops")
    .select(ROW_COLS)
    .eq("slack_thread_ts", threadTs)
    .maybeSingle();
  return (data as StatementDropRow | null) ?? null;
}

export async function updateStatementDrop(
  threadTs: string,
  patch: Partial<{
    business_name: string | null;
    account_holder: string | null;
    subject: string | null;
    status: StatementDropStatus;
    months_limit: number | null;
    email_note: string | null;
  }>
): Promise<void> {
  await supabaseAdmin
    .from("statement_drops")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("slack_thread_ts", threadTs);
}
