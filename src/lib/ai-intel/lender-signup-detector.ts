import { callClaudeJSON } from "@/lib/claude-calls";

export interface LenderSignupDetection {
  is_signup: boolean;
  lender_name: string | null;
  submission_email: string | null;
  cc_emails: string[];
  portal_url: string | null;
  rep_name: string | null;
  rep_email: string | null;
  rep_phone: string | null;
  subject_line_format: string | null;
  docs_required: string | null;
  notes: string | null;
  confidence: "high" | "medium" | "low";
}

const SCHEMA_HINT = `{
  "is_signup": boolean,
  "lender_name": string | null,
  "submission_email": string | null,
  "cc_emails": string[],
  "portal_url": string | null,
  "rep_name": string | null,
  "rep_email": string | null,
  "rep_phone": string | null,
  "subject_line_format": string | null,
  "docs_required": string | null,
  "notes": string | null,
  "confidence": "high" | "medium" | "low"
}`;

const SYSTEM_PROMPT = `You analyze emails to detect if they are ISO/broker approval or onboarding emails from MCA (Merchant Cash Advance) funders/lenders.

SRT Agency is a Merchant Cash Advance broker. Matthew is the ISO rep who signs up with funders to submit deals.

A LENDER SIGN-UP email is one where:
- A funder/lender is welcoming Matthew as an ISO partner
- They are saying he is approved / onboarded / ready to submit deals
- They are providing submission instructions (email, CC, subject line format, required docs)
- They are sending a signed ISO/broker agreement confirmation

NOT a sign-up email:
- Deal approval/decline emails (for a specific merchant)
- Internal SRT emails
- Marketing/promotional emails
- Software platforms (DocuSign, SignNow, etc.) unless the attached document is specifically an ISO agreement
- Stips requests, counter offers, missing field requests for existing deals

Extract:
- lender_name: The funder/lender company name
- submission_email: The email address to send new deals to
- cc_emails: Any CC email addresses for submissions
- portal_url: Web portal URL for deal submissions if mentioned
- rep_name: The ISO rep's name at the lender (the person emailing Matthew)
- rep_email: The ISO rep's email
- rep_phone: The ISO rep's phone number
- subject_line_format: Exact subject line format for submissions (e.g. "New Deal. Merchant Name")
- docs_required: What documents to include with submissions (e.g. "signed app + 3 months bank statements")
- notes: Any important requirements, restrictions, spiffs, or notes (max 200 chars)
- confidence: high if clearly a sign-up/welcome email, medium if likely, low if uncertain

If is_signup is false, set all other fields to null/[].`;

function isDetection(v: unknown): v is LenderSignupDetection {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return typeof r.is_signup === "boolean" && typeof r.confidence === "string";
}

export async function detectLenderSignup(email: {
  subject: string;
  from: string;
  body: string;
}): Promise<{ detection: LenderSignupDetection; latencyMs: number }> {
  const trimmedBody = email.body.length > 6000 ? email.body.slice(0, 6000) + "\n...[truncated]" : email.body;

  const result = await callClaudeJSON<LenderSignupDetection>({
    model: "claude-haiku-4-5-20251001",
    system: SYSTEM_PROMPT,
    user: `From: ${email.from}\nSubject: ${email.subject}\n\nBody:\n${trimmedBody}`,
    schemaHint: SCHEMA_HINT,
    maxTokens: 800,
    temperature: 0.1,
    validate: isDetection,
  });

  return { detection: result.data, latencyMs: result.latencyMs };
}
