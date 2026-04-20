import { supabaseAdmin } from "@/lib/db";
import { callClaudeJSON } from "@/lib/claude-calls";

export type InboundIntent =
  | "missing_fields"
  | "approved"
  | "declined"
  | "stips_needed"
  | "counter_offer"
  | "other";

export interface InboundClassification {
  intent: InboundIntent;
  business_name: string | null;
  missing_fields: string[];
  approved_amount: number | null;
  factor_rate: number | null;
  term_months: number | null;
  declined_reason: string | null;
  stips_required: string[];
  summary: string;
}

const SCHEMA_HINT = `{
  "intent": "missing_fields" | "approved" | "declined" | "stips_needed" | "counter_offer" | "other",
  "business_name": string | null,
  "missing_fields": string[],
  "approved_amount": number | null,
  "factor_rate": number | null,
  "term_months": number | null,
  "declined_reason": string | null,
  "stips_required": string[],
  "summary": string
}`;

const SYSTEM_PROMPT = `You classify inbound emails from MCA funders/lenders responding to SRT Agency deal submissions. You extract structured data.

intents:
- missing_fields: Funder is asking for missing docs/info (SSN, EIN, bank statements, driver's license, voided check, articles of organization, etc.)
- approved: Deal is approved with terms offered.
- declined: Funder declined the deal.
- stips_needed: Funder approved pending stipulations (common: more bank statements, proof of ownership, landlord verification).
- counter_offer: Funder offering different terms than requested (amount, rate, or term).
- other: Anything else (spam, confirmation, intros, etc.)

Extract business_name from the email content (subject or body) — this is the merchant whose deal the funder is responding to.
For missing_fields, list the specific fields as short keywords ("ssn", "ein", "bank_3mo", "drivers_license", "articles_of_org", "voided_check").
For stips_needed, list stipulations.
summary is one sentence.`;

export async function classifyInboundEmail(email: { subject: string; from: string; body: string }): Promise<{
  classification: InboundClassification;
  tokens: { input: number; output: number };
  latencyMs: number;
  raw: string;
}> {
  const trimmedBody = email.body.length > 8000 ? email.body.slice(0, 8000) + "\n...[truncated]" : email.body;

  const user = `From: ${email.from}
Subject: ${email.subject}

Body:
${trimmedBody}`;

  const result = await callClaudeJSON<InboundClassification>({
    model: "claude-haiku-4-5-20251001",
    system: SYSTEM_PROMPT,
    user,
    schemaHint: SCHEMA_HINT,
    maxTokens: 1000,
    temperature: 0.1,
    validate: isClassification,
  });

  return {
    classification: result.data,
    tokens: { input: result.usage.input_tokens, output: result.usage.output_tokens },
    latencyMs: result.latencyMs,
    raw: result.raw,
  };
}

function isClassification(v: unknown): v is InboundClassification {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  const validIntents = ["missing_fields", "approved", "declined", "stips_needed", "counter_offer", "other"];
  return typeof r.intent === "string" && validIntents.includes(r.intent as string) && typeof r.summary === "string";
}

export async function findContactByBusinessName(businessName: string | null): Promise<{ id: string; zoho_lead_id: string | null; business_name: string | null; email: string | null } | null> {
  if (!businessName || businessName.trim().length < 3) return null;

  const { data, error } = await supabaseAdmin
    .from("contacts")
    .select("id, zoho_lead_id, business_name, email")
    .ilike("business_name", `%${businessName.trim()}%`)
    .limit(3);

  if (error || !data || data.length === 0) return null;
  if (data.length === 1) return data[0] as { id: string; zoho_lead_id: string | null; business_name: string | null; email: string | null };

  const exact = data.find((c) => (c.business_name as string)?.toLowerCase() === businessName.trim().toLowerCase());
  if (exact) return exact as { id: string; zoho_lead_id: string | null; business_name: string | null; email: string | null };

  return data[0] as { id: string; zoho_lead_id: string | null; business_name: string | null; email: string | null };
}

export async function findDealSubmissionByFunder(contactId: string, funderEmailDomain: string | null): Promise<{ id: string; lender_id: string | null } | null> {
  const { data: submissions } = await supabaseAdmin
    .from("deal_submissions")
    .select("id, lender_id, lenders(submission_email)")
    .eq("merchant_id", contactId)
    .eq("status", "pending")
    .order("submitted_at", { ascending: false });

  if (!submissions || submissions.length === 0) return null;

  if (funderEmailDomain) {
    const typed = submissions as unknown as Array<{ id: string; lender_id: string | null; lenders: { submission_email: string | null } | null }>;
    const matched = typed.find((s) => {
      const lenderEmail = s.lenders?.submission_email;
      if (!lenderEmail) return false;
      const lenderDomain = lenderEmail.split("@")[1]?.toLowerCase();
      return lenderDomain === funderEmailDomain.toLowerCase();
    });
    if (matched) return { id: matched.id, lender_id: matched.lender_id };
  }

  return { id: submissions[0].id as string, lender_id: submissions[0].lender_id as string | null };
}
