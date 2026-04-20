import { callClaudeJSON, callClaudeText } from "@/lib/claude-calls";

export interface DeclineSMSOptions {
  softer: string;
  direct: string;
}

const DECLINE_SCHEMA = `{
  "softer": string,
  "direct": string
}`;

export async function generateDeclineSMSOptions(args: {
  firstName: string;
  businessName: string;
  reasonSummary: string;
}): Promise<DeclineSMSOptions> {
  const system = `You are Benjamin at SRT Agency. Draft 2 SMS options to notify a merchant their funding request was declined. Rules:

1. Under 160 characters each so they fit in one SMS.
2. "softer" — warm, keeps the door open, hints at future fit.
3. "direct" — no-nonsense, clear the answer is no, offers a quick call.
4. No emojis. No subject line. Sign as "- Benjamin, SRT".
5. Don't mention specific lender names.
6. Don't overpromise future approvals.

Return JSON with keys "softer" and "direct".`;

  const user = `Merchant first name: ${args.firstName}
Business: ${args.businessName}
Decline reason (internal, don't repeat verbatim): ${args.reasonSummary}`;

  const result = await callClaudeJSON<DeclineSMSOptions>({
    model: "claude-haiku-4-5-20251001",
    system,
    user,
    schemaHint: DECLINE_SCHEMA,
    maxTokens: 500,
    temperature: 0.4,
    validate: (v): v is DeclineSMSOptions => {
      const r = v as Record<string, unknown>;
      return typeof r?.softer === "string" && typeof r?.direct === "string";
    },
  });

  return result.data;
}

export interface ApprovalPresentation {
  label: string;
  angle: string;
  sms: string;
  email_subject: string;
  email_body: string;
}

export interface ApprovalPresentationSet {
  options: [ApprovalPresentation, ApprovalPresentation, ApprovalPresentation];
}

const APPROVAL_SCHEMA = `{
  "options": [
    {
      "label": string (e.g., "The quick win", "The strategic"),
      "angle": string (2-sentence angle explanation for the rep),
      "sms": string (under 160 chars),
      "email_subject": string,
      "email_body": string (3-6 sentences, friendly, signed "Benjamin")
    },
    { ...same shape... },
    { ...same shape... }
  ]
}`;

export async function generateApprovalPresentations(args: {
  firstName: string;
  businessName: string;
  amountApproved: number;
  termMonths: number | null;
  factorRate: number | null;
  dailyPayment: number | null;
  weeklyPayment: number | null;
  totalPayback: number | null;
  useOfFunds: string | null;
  knownObjections?: string[];
}): Promise<ApprovalPresentationSet> {
  const system = `You are a senior MCA closer at SRT Agency. A deal just got approved. You're drafting 3 DISTINCT options for Benjamin to choose between when presenting the offer to the merchant.

Each option should attack from a different angle. Examples:
- "The quick win": emphasize speed, today's decision, momentum.
- "The strategic": frame the capital as fuel for a specific growth move tied to their use of funds.
- "The protector": frame as leaving room for working capital / reserves / lower stress.
Or any 3 that fit the deal context.

For each option produce:
- label (e.g., "The quick win")
- angle (2 sentences — explain to Benjamin *why* this angle)
- sms (under 160 chars, no emojis, signed "- Benjamin, SRT")
- email_subject
- email_body (3-6 sentences, friendly, direct, no fluff, signed "— Benjamin")

Do NOT invent terms not provided. Use the numbers given. Round payment amounts to whole dollars when speaking.`;

  const user = `Merchant: ${args.firstName} at ${args.businessName}
Approved amount: $${args.amountApproved.toLocaleString()}
Total payback: ${args.totalPayback ? `$${args.totalPayback.toLocaleString()}` : "—"}
Factor rate: ${args.factorRate ?? "—"}
Term: ${args.termMonths ? `${args.termMonths} months` : "—"}
Daily payment: ${args.dailyPayment ? `$${args.dailyPayment.toLocaleString()}` : "—"}
Weekly payment: ${args.weeklyPayment ? `$${args.weeklyPayment.toLocaleString()}` : "—"}
Use of funds: ${args.useOfFunds ?? "—"}
Known objections: ${args.knownObjections?.join(", ") ?? "none yet"}`;

  const result = await callClaudeJSON<ApprovalPresentationSet>({
    model: "claude-opus-4-7",
    system,
    user,
    schemaHint: APPROVAL_SCHEMA,
    maxTokens: 3000,
    temperature: 0.6,
    validate: (v): v is ApprovalPresentationSet => {
      const r = v as { options?: unknown };
      return Array.isArray(r.options) && r.options.length === 3;
    },
  });

  return result.data;
}

export async function pickDeclineImage(): Promise<string | null> {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://mission.srtagency.com";
  const manifest = process.env.VEKTOR_DECLINE_IMAGE_URLS;
  if (!manifest) return null;

  const urls = manifest.split(",").map((u) => u.trim()).filter(Boolean);
  if (urls.length === 0) return null;

  const pick = urls[Math.floor(Math.random() * urls.length)];
  if (pick.startsWith("http")) return pick;
  return `${base}${pick.startsWith("/") ? "" : "/"}${pick}`;
}

export { callClaudeText };
