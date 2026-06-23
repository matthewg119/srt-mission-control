// Smart Follow-up — the brains behind the dialer's "⚡ Smart Follow-up" button.
//
// Given a Zoho Lead OR Deal (the dialer scrapes the module + id + contact
// email/phone off the page), this:
//   1. resolves the record → contact email/first name/business name,
//   2. gathers the deal's status "across the board" (stage, last-contact gap,
//      whether bank statements / a completed package are in OneDrive),
//   3. AI-drafts the right follow-up email for that situation,
//   4. routes it for approval to BOTH surfaces (Slack card + textwin.ai bubble)
//      with a shared draft_key so approving one cancels the other.
//
// The send itself is gated — approval happens in Slack (ai_approve) or in
// textwin.ai (email/suggestions). This module never auto-sends.

import { supabaseAdmin } from "@/lib/db";
import { microsoft } from "@/lib/microsoft";
import { getLead, getDeal, searchLeads, type ZohoApiRecord } from "@/lib/zoho";
import { callClaudeJSON } from "@/lib/claude-calls";
import { postApprovalRequest } from "@/lib/ai-intel/slack-approval";
import { VEKTOR_CHANNELS } from "@/config/vektor";
import type { PendingActionPayload } from "@/lib/ai-intel/types";

export interface ResolvedRecord {
  module: "Leads" | "Deals";
  recordId: string;
  email: string | null;
  firstName: string;
  businessName: string | null;
  stage: string | null;
  amount: string | null;
  phone: string | null;
  zohoLeadId: string | null; // the Zoho id to note against (lead id, or deal id)
  contactId: string | null; // Supabase contacts.id
  conversationId: string | null; // sms_conversations.id (for the desktop bubble)
}

export interface FollowupStatus {
  stage: string | null;
  amount: string | null;
  daysSinceContact: number | null;
  statementCount: number;
  hasCompletedPackage: boolean;
  summary: string; // one-line for the dialer + ai_reason
}

export interface FollowupDraft {
  subject: string;
  body: string; // copy only — greeting + "S" signature added at send
}

// ── 1. Resolve the Zoho record → contact ───────────────────────────────────
export async function resolveRecord(input: {
  module: "Leads" | "Deals";
  recordId: string;
  email?: string | null;
  phone?: string | null;
  name?: string | null;
}): Promise<ResolvedRecord> {
  let email = (input.email ?? "").trim() || null;
  let firstName = "there";
  let businessName: string | null = (input.name ?? "").trim() || null;
  let stage: string | null = null;
  let amount: string | null = null;
  let phone = (input.phone ?? "").trim() || null;

  if (input.module === "Leads") {
    const lead = await getLead(input.recordId);
    email = email || ((lead.Email as string) ?? null);
    firstName = ((lead.First_Name as string) ?? "").trim() || "there";
    businessName = businessName || ((lead.Company as string) ?? null);
    stage = (lead.Lead_Status as string) ?? null;
    phone = phone || ((lead.Phone as string) ?? (lead.Mobile as string) ?? null);
  } else {
    const deal = await getDeal(input.recordId);
    businessName = businessName || ((deal.Deal_Name as string) ?? (asName(deal.Account_Name) ?? null));
    stage = (deal.Stage as string) ?? null;
    amount = deal.Amount != null ? String(deal.Amount) : null;
    // Deal layouts carry a Contact_Name lookup; the dialer also scrapes the
    // contact's email/phone off the page (more reliable than re-fetching).
    firstName = firstWord(asName(deal.Contact_Name)) || firstWord(input.name) || "there";
    // If the dialer didn't scrape an email, try to find the lead by business name.
    if (!email && businessName) {
      try {
        const hits = await searchLeads({ criteria: `(Company:equals:${businessName})` });
        if (hits[0]?.Email) email = hits[0].Email as string;
        if (!phone) phone = (hits[0]?.Phone as string) ?? (hits[0]?.Mobile as string) ?? phone;
      } catch {
        /* best-effort */
      }
    }
  }

  // Supabase contact: by zoho id, then email, then phone last10.
  const contact = await findContact({
    zohoLeadId: input.module === "Leads" ? input.recordId : null,
    email,
    phone,
  });

  // Find-or-create the conversation so the desktop bubble has somewhere to land.
  let conversationId: string | null = null;
  if (phone) {
    const { data: conv } = await supabaseAdmin
      .from("sms_conversations")
      .upsert(
        { phone, contact_id: contact?.id ?? null },
        { onConflict: "phone", ignoreDuplicates: false }
      )
      .select("id")
      .maybeSingle();
    conversationId = (conv?.id as string) ?? null;
  }

  return {
    module: input.module,
    recordId: input.recordId,
    email,
    firstName,
    businessName,
    stage,
    amount,
    phone,
    zohoLeadId: contact?.zoho_lead_id ?? (input.module === "Leads" ? input.recordId : null),
    contactId: contact?.id ?? null,
    conversationId,
  };
}

interface ContactRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  zoho_lead_id: string | null;
  email: string | null;
}

const CONTACT_COLS = "id, first_name, last_name, business_name, zoho_lead_id, email";

async function findContact(opts: {
  zohoLeadId: string | null;
  email: string | null;
  phone: string | null;
}): Promise<ContactRow | null> {
  if (opts.zohoLeadId) {
    const { data } = await supabaseAdmin
      .from("contacts")
      .select(CONTACT_COLS)
      .eq("zoho_lead_id", opts.zohoLeadId)
      .maybeSingle();
    if (data) return data as ContactRow;
  }
  if (opts.email) {
    const { data } = await supabaseAdmin
      .from("contacts")
      .select(CONTACT_COLS)
      .ilike("email", opts.email)
      .maybeSingle();
    if (data) return data as ContactRow;
  }
  if (opts.phone) {
    const last10 = opts.phone.replace(/\D/g, "").slice(-10);
    if (last10.length === 10) {
      const { data } = await supabaseAdmin
        .from("contacts")
        .select(CONTACT_COLS)
        .or(`phone_last10.eq.${last10},mobile_last10.eq.${last10}`)
        .limit(1)
        .maybeSingle();
      if (data) return data as ContactRow;
    }
  }
  return null;
}

// ── 2. Gather status across the board ───────────────────────────────────────
export async function gatherStatus(rec: ResolvedRecord): Promise<FollowupStatus> {
  const daysSinceContact = await lastContactGapDays(rec.contactId, rec.conversationId);
  const { statementCount, hasCompletedPackage } = await onedrivePackageStatus(rec.businessName);

  const parts: string[] = [];
  if (rec.stage) parts.push(rec.stage);
  parts.push(
    statementCount > 0 ? `${statementCount} bank statement${statementCount === 1 ? "" : "s"} on file` : "no statements on file"
  );
  if (hasCompletedPackage) parts.push("package complete");
  if (daysSinceContact != null) {
    parts.push(daysSinceContact === 0 ? "spoke today" : `last contact ${daysSinceContact}d ago`);
  } else {
    parts.push("no prior contact logged");
  }

  return {
    stage: rec.stage,
    amount: rec.amount,
    daysSinceContact,
    statementCount,
    hasCompletedPackage,
    summary: parts.join(" · "),
  };
}

async function lastContactGapDays(
  contactId: string | null,
  conversationId: string | null
): Promise<number | null> {
  const stamps: number[] = [];
  if (conversationId) {
    const { data } = await supabaseAdmin
      .from("sms_messages")
      .select("created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data?.created_at) stamps.push(new Date(data.created_at as string).getTime());
  }
  if (contactId) {
    const { data: convs } = await supabaseAdmin
      .from("email_conversations")
      .select("id")
      .eq("contact_id", contactId);
    const ids = (convs ?? []).map((c) => c.id as string);
    if (ids.length > 0) {
      const { data } = await supabaseAdmin
        .from("email_messages")
        .select("created_at")
        .in("conversation_id", ids)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (data?.created_at) stamps.push(new Date(data.created_at as string).getTime());
    }
  }
  if (stamps.length === 0) return null;
  const newest = Math.max(...stamps);
  return Math.max(0, Math.floor((Date.now() - newest) / 86_400_000));
}

async function onedrivePackageStatus(
  businessName: string | null
): Promise<{ statementCount: number; hasCompletedPackage: boolean }> {
  if (!businessName) return { statementCount: 0, hasCompletedPackage: false };
  const biz = businessName.replace(/[<>:"/\\|?*]/g, "_");
  let statementCount = 0;
  let hasCompletedPackage = false;
  try {
    const stmts = await microsoft.listFolderChildren(`Deals/${biz}/Bank Statements`);
    statementCount = stmts.filter(
      (c) => c.isFile && (c.name || "").toLowerCase().endsWith(".pdf")
    ).length;
  } catch {
    /* folder may not exist yet */
  }
  try {
    const pkg = await microsoft.listFolderChildren(`Deals/${biz}/Completed Package`);
    hasCompletedPackage = pkg.some((c) => c.isFile && (c.name || "").toLowerCase().endsWith(".pdf"));
  } catch {
    /* no package yet */
  }
  return { statementCount, hasCompletedPackage };
}

// ── 3. AI-draft the follow-up ───────────────────────────────────────────────
const DRAFT_SYSTEM = `You are Matthew Garcia, Senior Capital Strategist at SRT Agency, a business-financing brokerage. You write short, warm-but-direct follow-up emails to small-business owners about their funding application.

Rules:
- Write ONLY the body copy. Do NOT include a greeting ("Hello X,") or any signature/sign-off — both are added automatically.
- Keep it under 110 words. One clear ask.
- Never use the em dash character. Use commas, periods, or hyphens.
- Match the email to the situation you are given:
  • No bank statements on file → ask them to send the last 3 to 4 months of business bank statements (PDF), or finish at srtagency.com/fullapp. This is the most common blocker.
  • Statements on file but it has been 10+ days since contact → friendly check-in, confirm they still want funding, state the next step.
  • Package complete / approved / pre-approved stage → congratulate, lay out the next step to finalize.
  • Otherwise → a brief, helpful nudge to keep momentum.
- Sound like a person, not a template. No emojis.`;

export async function draftFollowup(
  rec: ResolvedRecord,
  status: FollowupStatus
): Promise<FollowupDraft> {
  const user = JSON.stringify({
    first_name: rec.firstName,
    business_name: rec.businessName,
    stage: status.stage,
    amount_requested: status.amount,
    days_since_last_contact: status.daysSinceContact,
    bank_statements_on_file: status.statementCount,
    completed_package_on_file: status.hasCompletedPackage,
  });

  const { data } = await callClaudeJSON<FollowupDraft>({
    model: "claude-sonnet-4-6",
    system: DRAFT_SYSTEM,
    user,
    maxTokens: 600,
    temperature: 0.5,
    schemaHint: `{ "subject": "string", "body": "string (body copy only, no greeting, no signature)" }`,
    validate: (p): p is FollowupDraft =>
      typeof (p as FollowupDraft)?.subject === "string" && typeof (p as FollowupDraft)?.body === "string",
  });

  // Strip any stray em dashes the model slipped in (belt + braces on the rule).
  return {
    subject: data.subject.replace(/—/g, "-").trim(),
    body: data.body.replace(/—/g, "-").trim(),
  };
}

// ── 4. Route to BOTH approval surfaces ──────────────────────────────────────
export async function routeFollowup(
  rec: ResolvedRecord,
  status: FollowupStatus,
  draft: FollowupDraft
): Promise<{ slackTs: string | null; draftKey: string; bubble: boolean }> {
  if (!rec.email) {
    throw new Error("no_email_on_record");
  }
  const draftKey = `sf_${rec.recordId}_${Date.now()}`;
  const fromMailbox = process.env.LEADS_MAILBOX || "matthew@srtagency.com";
  const fullBody = `Hello ${rec.firstName},\n\n${draft.body}`;

  const noteTitle = `Email sent — ${draft.subject}`;
  const noteContent = `Smart Follow-up sent to ${rec.email} from ${fromMailbox}. Status: ${status.summary}.`;

  const payload: PendingActionPayload & { draft_key?: string } = {
    action_type: "send_email",
    to: rec.email,
    subject: draft.subject,
    body: fullBody,
    signature_name: "S",
    from_mailbox: fromMailbox,
    zoho_id: rec.zohoLeadId ?? undefined,
    contact_id: rec.contactId ?? undefined,
    note: { title: noteTitle, content: noteContent },
    draft_key: draftKey,
  };

  const summary = [
    `⚡ *Smart Follow-up* for *${rec.businessName || rec.firstName || rec.email}*`,
    `_${status.summary}_`,
    ``,
    `*To:* ${rec.email}`,
    `*Subject:* ${draft.subject}`,
    "```",
    `Hello ${rec.firstName},`,
    ``,
    draft.body,
    "```",
    `_+ your Outlook "S" signature (appended on send)_`,
  ].join("\n");

  const card = await postApprovalRequest({
    summary,
    payload,
    channel: VEKTOR_CHANNELS.emailDirector || undefined,
    category: "working_lead",
    zohoId: rec.zohoLeadId ?? undefined,
    merchantId: rec.contactId ?? undefined,
  });

  // textwin.ai / extension surface — a 'suggested' email_outbox row. The "sf_"
  // draft_key prefix marks it as a dialer follow-up (LiveInbox shows the ⚡ cue).
  // Best-effort: a missing column / table must not fail the Slack route.
  let bubble = false;
  if (rec.contactId) {
    try {
      await supabaseAdmin.from("email_outbox").insert({
        conversation_id: rec.conversationId,
        contact_id: rec.contactId,
        to_address: rec.email,
        subject: draft.subject,
        body: fullBody,
        signature_name: "S",
        status: "suggested",
        ai_reason: status.summary,
        draft_key: draftKey,
      });
      bubble = true;
    } catch (e) {
      console.warn("[smart-followup] email_outbox suggestion skipped:", (e as Error).message);
    }
  }

  return { slackTs: card.slackTs, draftKey, bubble };
}

// ── helpers ─────────────────────────────────────────────────────────────────
// Zoho lookup fields come back as { id, name } objects (or a bare string).
function asName(v: unknown): string | null {
  if (!v) return null;
  if (typeof v === "string") return v;
  if (typeof v === "object" && v !== null && "name" in v) {
    return String((v as { name?: unknown }).name ?? "") || null;
  }
  return null;
}
function firstWord(v: unknown): string {
  const s = asName(v) ?? (typeof v === "string" ? v : "");
  return (s || "").trim().split(/\s+/)[0] || "";
}
