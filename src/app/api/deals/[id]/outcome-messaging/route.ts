import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { generateDeclineSMSOptions, generateApprovalPresentations, pickDeclineImage } from "@/lib/ai-intel/deal-outcome-messaging";
import { routeToChannel } from "@/config/vektor";
import { postApprovalRequest } from "@/lib/ai-intel/slack-approval";
import type { PendingActionPayload } from "@/lib/ai-intel/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  kind: "decline" | "approval";
  reason?: string;
  offer?: {
    amount_approved: number;
    total_payback?: number;
    factor_rate?: number;
    term_months?: number;
    daily_payment?: number;
    weekly_payment?: number;
    use_of_funds?: string;
  };
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json()) as Body;

  const { data: deal } = await supabaseAdmin
    .from("deals")
    .select("id, contact_id, amount, contacts!inner(id, first_name, business_name, email, phone, zoho_lead_id)")
    .eq("id", id)
    .maybeSingle();

  if (!deal) return NextResponse.json({ error: "deal_not_found" }, { status: 404 });

  const contact = (deal as unknown as { contacts: { id: string; first_name: string | null; business_name: string | null; email: string | null; phone: string | null; zoho_lead_id: string | null } }).contacts;

  if (body.kind === "decline") {
    return handleDecline(deal.id as string, contact, body.reason ?? "no fit with current funders");
  }
  if (body.kind === "approval") {
    if (!body.offer) return NextResponse.json({ error: "offer required for approval" }, { status: 400 });
    return handleApproval(deal.id as string, contact, body.offer);
  }

  return NextResponse.json({ error: "invalid_kind" }, { status: 400 });
}

async function handleDecline(dealId: string, contact: { id: string; first_name: string | null; business_name: string | null; phone: string | null; zoho_lead_id: string | null }, reason: string): Promise<NextResponse> {
  const options = await generateDeclineSMSOptions({
    firstName: contact.first_name ?? "",
    businessName: contact.business_name ?? "Your business",
    reasonSummary: reason,
  });

  const imageUrl = await pickDeclineImage();
  const channel = routeToChannel("deal_declined");

  await supabaseAdmin.from("ai_decisions").insert({
    merchant_id: contact.id,
    zoho_id: contact.zoho_lead_id,
    trigger_type: "webhook_zoho",
    state_classified: "declined",
    action_taken: "draft_email",
    reasoning: `Generated 2 decline SMS options${imageUrl ? " + decline image" : ""}`,
    raw_response: { options, image_url: imageUrl, reason },
    model_used: "claude-haiku-4-5-20251001",
  });

  const payload: PendingActionPayload = {
    action_type: "send_email",
    subject: `Update on your ${contact.business_name} funding request`,
    body: options.softer,
    to: contact.phone ?? undefined,
    is_html: false,
    zoho_id: contact.zoho_lead_id ?? undefined,
    decline_options: options,
    decline_image_url: imageUrl ?? undefined,
    deal_id: dealId,
  };

  const summary = `❌ *Decline — pick a message for ${contact.business_name}*
Reason: ${reason}

*Option A (softer):*
${options.softer}

*Option B (direct):*
${options.direct}

${imageUrl ? `Image: ${imageUrl}` : "_No decline image configured — set VEKTOR_DECLINE_IMAGE_URLS in env._"}

Click 👍 on the one you want. Default is Option A (softer).`;

  if (channel) {
    await postApprovalRequest({
      summary,
      payload,
      merchantId: contact.id,
      zohoId: contact.zoho_lead_id ?? undefined,
      channel,
      category: "deal_declined",
    });
  }

  if (imageUrl && channel) {
    await slack.postMessage(channel, imageUrl);
  }

  return NextResponse.json({ ok: true, options, image_url: imageUrl });
}

async function handleApproval(dealId: string, contact: { id: string; first_name: string | null; business_name: string | null; email: string | null; zoho_lead_id: string | null }, offer: NonNullable<Body["offer"]>): Promise<NextResponse> {
  const set = await generateApprovalPresentations({
    firstName: contact.first_name ?? "",
    businessName: contact.business_name ?? "your business",
    amountApproved: offer.amount_approved,
    termMonths: offer.term_months ?? null,
    factorRate: offer.factor_rate ?? null,
    dailyPayment: offer.daily_payment ?? null,
    weeklyPayment: offer.weekly_payment ?? null,
    totalPayback: offer.total_payback ?? null,
    useOfFunds: offer.use_of_funds ?? null,
  });

  await supabaseAdmin.from("ai_decisions").insert({
    merchant_id: contact.id,
    zoho_id: contact.zoho_lead_id,
    trigger_type: "webhook_zoho",
    state_classified: "approved_no_response",
    action_taken: "draft_email",
    reasoning: `Opus 4.7 generated 3 approval presentations for ${contact.business_name}`,
    raw_response: { options: set.options, offer },
    model_used: "claude-opus-4-7",
  });

  const channel = routeToChannel("deal_approved");
  if (!channel) return NextResponse.json({ ok: true, options: set.options });

  for (let i = 0; i < set.options.length; i++) {
    const opt = set.options[i];
    const payload: PendingActionPayload = {
      action_type: "send_email",
      subject: opt.email_subject,
      body: opt.email_body,
      to: contact.email ?? undefined,
      is_html: false,
      zoho_id: contact.zoho_lead_id ?? undefined,
      deal_id: dealId,
      amount: offer.amount_approved,
      requires_matthew: offer.amount_approved > 50_000,
      presentation_label: opt.label,
      presentation_sms: opt.sms,
    };
    const summary = `🎯 *Approval Option ${i + 1}/3: ${opt.label}* — ${contact.business_name}
_Angle:_ ${opt.angle}

*Email Subject:* ${opt.email_subject}
*Email Body:*
\`\`\`
${opt.email_body}
\`\`\`

*SMS (${opt.sms.length} chars):*
> ${opt.sms}

Click 👍 on the option you want to use.`;
    await postApprovalRequest({
      summary,
      payload,
      merchantId: contact.id,
      zohoId: contact.zoho_lead_id ?? undefined,
      channel,
      category: "deal_approved",
    });
  }

  return NextResponse.json({ ok: true, options_posted: 3 });
}
