import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { microsoft } from "@/lib/microsoft";
import { slack } from "@/lib/slack-bot";
import { callClaudeText } from "@/lib/claude-calls";
import { classifyInboundEmail, findContactByBusinessName, findDealSubmissionByFunder } from "@/lib/ai-intel/inbound-classifier";
import { postApprovalRequest } from "@/lib/ai-intel/slack-approval";
import { maybeFireMetaEvent } from "@/lib/ai-intel/meta-events";
import { isRoutingSubject, parseLenderChoicesFromReply } from "@/lib/ai-intel/request-lender-routing";
import { buildSubmissionPackage } from "@/lib/ai-intel/deal-submission-builder";
import { routeToChannel } from "@/config/vektor";
import { syncLenderSubmissionsSubform } from "@/lib/zoho-mca-fields";
import type { PendingActionPayload } from "@/lib/ai-intel/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const token = url.searchParams.get("validationToken");
  if (token) {
    return new NextResponse(token, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return NextResponse.json({ ok: true, endpoint: "agent/submissions" });
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const validationToken = url.searchParams.get("validationToken");
  if (validationToken) {
    return new NextResponse(validationToken, { status: 200, headers: { "Content-Type": "text/plain" } });
  }

  const body = await req.json().catch(() => null);
  if (!body || !Array.isArray(body.value)) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const results: Array<Record<string, unknown>> = [];

  for (const notification of body.value as Array<{ resource: string; subscriptionId: string; clientState?: string }>) {
    try {
      const expectedStateRow = await supabaseAdmin
        .from("integrations")
        .select("config")
        .like("name", "graph_subscription_%")
        .eq("config->>subscription_id", notification.subscriptionId)
        .maybeSingle();
      const expectedState = (expectedStateRow.data?.config as { client_state?: string } | undefined)?.client_state;
      if (expectedState && expectedState !== notification.clientState) {
        results.push({ skipped: "bad_client_state", subscription: notification.subscriptionId });
        continue;
      }

      const messageIdMatch = notification.resource.match(/messages(?:\/|\(')([^'\/]+)/);
      const messageId = messageIdMatch?.[1];
      if (!messageId) {
        results.push({ skipped: "no_message_id", resource: notification.resource });
        continue;
      }

      const mailboxMatch = notification.resource.match(/users\/([^/]+)/);
      const mailbox = mailboxMatch?.[1] ?? "submissions@srtagency.com";

      const result = await processMessage(mailbox, messageId);
      results.push(result);
    } catch (e) {
      console.error("[agent/submissions] notification error:", (e as Error).message);
      results.push({ error: (e as Error).message });
    }
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}

async function processMessage(mailbox: string, messageId: string): Promise<Record<string, unknown>> {
  const token = await getUserAccessToken();
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${mailbox}/messages/${messageId}?$select=id,subject,from,body,bodyPreview,receivedDateTime,conversationId`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.text();
    return { error: `graph_fetch_failed: ${err.slice(0, 200)}` };
  }
  const msg = (await res.json()) as {
    id: string;
    subject: string;
    from: { emailAddress: { address: string; name: string } };
    body: { content: string; contentType: string };
    bodyPreview: string;
    receivedDateTime: string;
    conversationId: string;
  };

  const bodyText = msg.body.contentType === "html" ? stripHtml(msg.body.content) : msg.body.content;
  const fromAddress = msg.from?.emailAddress?.address ?? "unknown";
  const fromDomain = fromAddress.split("@")[1]?.toLowerCase() ?? null;

  if (isRoutingSubject(msg.subject)) {
    return handleRoutingReply(msg, bodyText);
  }

  const { classification, tokens, latencyMs } = await classifyInboundEmail({
    subject: msg.subject,
    from: fromAddress,
    body: bodyText,
  });

  const contact = await findContactByBusinessName(classification.business_name);

  const { data: aiDecision } = await supabaseAdmin
    .from("ai_decisions")
    .insert({
      merchant_id: contact?.id ?? null,
      zoho_id: contact?.zoho_lead_id ?? null,
      trigger_type: "inbound_email",
      state_classified: classification.intent,
      action_taken: null,
      was_approved: null,
      reasoning: classification.summary,
      raw_response: { classification, tokens, message_id: msg.id, from: fromAddress },
      model_used: "claude-haiku-4-5-20251001",
      latency_ms: latencyMs,
    })
    .select("id")
    .single();

  const aiDecisionId = aiDecision?.id as string | undefined;

  if (!contact) {
    const channel = process.env.SLACK_AI_APPROVALS_CHANNEL || process.env.SLACK_HOT_LEADS_CHANNEL || "";
    if (channel) {
      await slack.postMessage(channel, `📬 Inbound email from ${fromAddress} — could not match to a merchant.\n*Subject:* ${msg.subject}\n*AI Summary:* ${classification.summary}`);
    }
    return { intent: classification.intent, matched: false };
  }

  const submission = await findDealSubmissionByFunder(contact.id, fromDomain);

  switch (classification.intent) {
    case "approved":
      return handleApproved({ contact, submission, classification, msg, aiDecisionId });
    case "declined":
      return handleDeclined({ contact, submission, classification, msg, aiDecisionId });
    case "stips_needed":
      return handleStipsNeeded({ contact, submission, classification, msg, aiDecisionId });
    case "counter_offer":
      return handleCounterOffer({ contact, submission, classification, msg, aiDecisionId });
    case "missing_fields":
      return handleMissingFields({ contact, submission, classification, msg, aiDecisionId, funderEmail: fromAddress });
    default:
      return handleOther({ contact, classification, msg, aiDecisionId });
  }
}

async function handleApproved(args: { contact: { id: string; business_name: string | null; zoho_lead_id: string | null }; submission: { id: string; lender_id: string | null } | null; classification: import("@/lib/ai-intel/inbound-classifier").InboundClassification; msg: { subject: string }; aiDecisionId?: string }): Promise<Record<string, unknown>> {
  if (args.submission) {
    await supabaseAdmin
      .from("deal_submissions")
      .update({
        status: "approved",
        last_funder_response_at: new Date().toISOString(),
        notes: buildNotes("Approved", args.classification),
        ...pickOfferFields(args.classification),
      })
      .eq("id", args.submission.id);
    await zohoSubformSync(args.contact.id, "handleApproved");
  }
  const channel = process.env.SLACK_AI_APPROVALS_CHANNEL || process.env.SLACK_HOT_LEADS_CHANNEL || "";
  if (channel) {
    const amt = args.classification.approved_amount ? ` for $${args.classification.approved_amount.toLocaleString()}` : "";
    await slack.postMessage(channel, `✅ *APPROVED* — ${args.contact.business_name}${amt}\n*Subject:* ${args.msg.subject}\n*Summary:* ${args.classification.summary}`);
  }
  await supabaseAdmin.from("ai_decisions").update({ action_taken: "slack_alert" }).eq("id", args.aiDecisionId ?? "");
  return { intent: "approved", business: args.contact.business_name };
}

async function handleDeclined(args: { contact: { id: string; business_name: string | null }; submission: { id: string } | null; classification: { declined_reason: string | null; summary: string }; msg: { subject: string }; aiDecisionId?: string }): Promise<Record<string, unknown>> {
  if (args.submission) {
    await supabaseAdmin
      .from("deal_submissions")
      .update({
        status: "declined",
        last_funder_response_at: new Date().toISOString(),
        notes: `Declined — ${args.classification.declined_reason ?? args.classification.summary}`,
      })
      .eq("id", args.submission.id);
    await zohoSubformSync(args.contact.id, "handleDeclined");
  }
  const metaResult = await maybeFireMetaEvent({ eventName: "DealDeclined", contactId: args.contact.id });
  await supabaseAdmin
    .from("ai_decisions")
    .update({ action_taken: "slack_alert", meta_capi_event_fired: metaResult.fired ? "DealDeclined" : `skipped:${metaResult.reason}` })
    .eq("id", args.aiDecisionId ?? "");

  const channel = process.env.SLACK_AI_APPROVALS_CHANNEL || process.env.SLACK_HOT_LEADS_CHANNEL || "";
  if (channel) {
    await slack.postMessage(channel, `❌ *DECLINED* — ${args.contact.business_name}\n*Reason:* ${args.classification.declined_reason ?? "not stated"}\n*Subject:* ${args.msg.subject}`);
  }
  return { intent: "declined", business: args.contact.business_name, meta_event: metaResult };
}

async function handleStipsNeeded(args: { contact: { id: string; business_name: string | null; zoho_lead_id: string | null }; submission: { id: string } | null; classification: { stips_required: string[]; summary: string }; msg: { subject: string }; aiDecisionId?: string }): Promise<Record<string, unknown>> {
  if (args.submission) {
    const stipsText = args.classification.stips_required.length > 0
      ? `Pending stips: ${args.classification.stips_required.join(", ")}`
      : `Pending stips: ${args.classification.summary}`;
    await supabaseAdmin
      .from("deal_submissions")
      .update({ last_funder_response_at: new Date().toISOString(), notes: stipsText })
      .eq("id", args.submission.id);
    await zohoSubformSync(args.contact.id, "handleStipsNeeded");
  }
  const payload: PendingActionPayload = {
    action_type: "update_zoho",
    zoho_id: args.contact.zoho_lead_id ?? undefined,
    stage: "Pending Stips",
    stips_required: args.classification.stips_required,
  };
  await postApprovalRequest({
    summary: `📎 *STIPS NEEDED* — ${args.contact.business_name}\n*Stips:* ${args.classification.stips_required.join(", ")}\n*Summary:* ${args.classification.summary}`,
    payload,
    merchantId: args.contact.id,
    zohoId: args.contact.zoho_lead_id ?? undefined,
    aiDecisionId: args.aiDecisionId,
  });
  await supabaseAdmin.from("ai_decisions").update({ action_taken: "draft_email" }).eq("id", args.aiDecisionId ?? "");
  return { intent: "stips_needed", business: args.contact.business_name };
}

async function handleCounterOffer(args: { contact: { id: string; business_name: string | null }; submission: { id: string } | null; classification: import("@/lib/ai-intel/inbound-classifier").InboundClassification; msg: { subject: string }; aiDecisionId?: string }): Promise<Record<string, unknown>> {
  if (args.submission) {
    await supabaseAdmin
      .from("deal_submissions")
      .update({
        status: "counter",
        last_funder_response_at: new Date().toISOString(),
        notes: buildNotes("Counter", args.classification),
        ...pickOfferFields(args.classification),
      })
      .eq("id", args.submission.id);
    await zohoSubformSync(args.contact.id, "handleCounterOffer");
  }
  const channel = process.env.SLACK_AI_APPROVALS_CHANNEL || process.env.SLACK_HOT_LEADS_CHANNEL || "";
  if (channel) {
    const details = [
      args.classification.approved_amount ? `Amount: $${args.classification.approved_amount.toLocaleString()}` : null,
      args.classification.buy_rate ? `Buy: ${args.classification.buy_rate}` : null,
      args.classification.sell_rate ? `Sell: ${args.classification.sell_rate}` : null,
      args.classification.term ? `Term: ${args.classification.term}` : null,
    ].filter(Boolean).join(" | ");
    await slack.postMessage(channel, `💬 *COUNTER OFFER* — ${args.contact.business_name}\n${details}\n*Summary:* ${args.classification.summary}`);
  }
  await supabaseAdmin.from("ai_decisions").update({ action_taken: "slack_alert" }).eq("id", args.aiDecisionId ?? "");
  return { intent: "counter_offer", business: args.contact.business_name };
}

async function handleMissingFields(args: {
  contact: { id: string; business_name: string | null; email: string | null; zoho_lead_id: string | null };
  submission: { id: string } | null;
  classification: { missing_fields: string[]; summary: string };
  msg: { subject: string };
  aiDecisionId?: string;
  funderEmail: string;
}): Promise<Record<string, unknown>> {
  const { data: contact } = await supabaseAdmin
    .from("contacts")
    .select("ssn, ein, first_name, last_name, business_name, drivers_license_uploaded, voided_check_uploaded")
    .eq("id", args.contact.id)
    .maybeSingle();

  const available: Record<string, boolean> = {
    ssn: Boolean(contact?.ssn),
    ein: Boolean(contact?.ein),
    drivers_license: Boolean(contact?.drivers_license_uploaded),
    voided_check: Boolean(contact?.voided_check_uploaded),
  };
  const missing = args.classification.missing_fields.filter((f) => !available[f]);

  if (missing.length === 0) {
    const { text: draft } = await callClaudeText({
      model: "claude-sonnet-4-6",
      system: "You are SRT Submissions responding to a funder asking for missing fields. Draft a concise, professional reply stating that the information is attached/included. Do NOT invent file names. Return plain text, no subject line.",
      user: `Funder asked for: ${args.classification.missing_fields.join(", ")}. Merchant: ${args.contact.business_name}.`,
      maxTokens: 500,
    });

    const payload: PendingActionPayload = {
      action_type: "reply_funder",
      to: args.funderEmail,
      subject: `Re: ${args.msg.subject}`,
      body: draft,
      is_html: false,
      zoho_id: args.contact.zoho_lead_id ?? undefined,
    };
    await postApprovalRequest({
      summary: `📤 *REPLY TO FUNDER READY* — ${args.contact.business_name}\nFields requested: ${args.classification.missing_fields.join(", ")}\n_All fields available in our system._`,
      payload,
      merchantId: args.contact.id,
      zohoId: args.contact.zoho_lead_id ?? undefined,
      aiDecisionId: args.aiDecisionId,
    });
  } else {
    const channel = process.env.SLACK_AI_APPROVALS_CHANNEL || process.env.SLACK_HOT_LEADS_CHANNEL || "";
    if (channel) {
      await slack.postMessage(channel, `🔍 *MISSING FIELDS* — ${args.contact.business_name}\nFunder asked for: ${args.classification.missing_fields.join(", ")}\n*Not in our system:* ${missing.join(", ")}\nReply in this thread with the missing data and I'll draft the funder reply.`);
    }
  }

  await supabaseAdmin.from("ai_decisions").update({ action_taken: "draft_email" }).eq("id", args.aiDecisionId ?? "");
  return { intent: "missing_fields", business: args.contact.business_name, missing };
}

async function handleOther(args: { contact: { business_name: string | null }; classification: { summary: string }; msg: { subject: string }; aiDecisionId?: string }): Promise<Record<string, unknown>> {
  const channel = process.env.SLACK_AI_APPROVALS_CHANNEL || process.env.SLACK_HOT_LEADS_CHANNEL || "";
  if (channel) {
    await slack.postMessage(channel, `📨 Unclassified inbound — ${args.contact.business_name}\n*Subject:* ${args.msg.subject}\n*AI Summary:* ${args.classification.summary}`);
  }
  await supabaseAdmin.from("ai_decisions").update({ action_taken: "slack_alert" }).eq("id", args.aiDecisionId ?? "");
  return { intent: "other", business: args.contact.business_name };
}

async function handleRoutingReply(msg: { subject: string; body: { content: string; contentType: string } }, bodyText: string): Promise<Record<string, unknown>> {
  const subjectMatch = msg.subject.match(/\[VeKtor Routing\]\s*(.+?)\s*—/);
  const businessName = subjectMatch?.[1] ?? null;
  if (!businessName) return { skipped: "no_business_in_subject" };

  const { data: contact } = await supabaseAdmin
    .from("contacts")
    .select("id, zoho_lead_id, business_name")
    .ilike("business_name", `%${businessName}%`)
    .limit(1)
    .maybeSingle();

  if (!contact) return { skipped: "contact_not_found", business: businessName };

  const { data: deal } = await supabaseAdmin
    .from("deals")
    .select("id, amount")
    .eq("contact_id", contact.id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!deal) return { skipped: "deal_not_found", business: businessName };

  const choice = await parseLenderChoicesFromReply(bodyText);
  const channel = routeToChannel("deal_submission");

  if (choice.lender_ids.length === 0) {
    if (channel) {
      await slack.postMessage(channel, `🤔 VeKtor got a routing reply for *${businessName}* but couldn't match any lenders.\nReply text: "${bodyText.slice(0, 300)}"\nTry: \`Send to Legend and Fundbox\` or \`Tier 1 only\`.`);
    }
    return { skipped: "no_lender_match", business: businessName, unmatched: choice.unmatched };
  }

  if (channel) {
    await slack.postMessage(channel, `🎯 Routing confirmed for *${businessName}*: ${choice.matched_names.join(", ")}${choice.unmatched.length ? `\n(Unmatched tokens: ${choice.unmatched.join(", ")})` : ""}\n_Building submission drafts now..._`);
  }

  const result = await buildSubmissionPackage({
    dealId: deal.id as string,
    lenderIds: choice.lender_ids,
    requestedAmount: (deal.amount as number) ?? 0,
    requestedBy: "slack_command",
  });

  return {
    intent: "routing_reply",
    business: businessName,
    lenders: choice.matched_names,
    submission_drafts: result.pendingActionIds.length,
    onedrive: result.onedriveUrl,
  };
}

async function getUserAccessToken(): Promise<string> {
  const { data } = await supabaseAdmin
    .from("integrations")
    .select("config")
    .eq("name", "Microsoft 365")
    .single();
  const cfg = data?.config as { access_token?: string; refresh_token?: string; expires_at?: string } | undefined;
  if (!cfg?.access_token) throw new Error("Microsoft 365 not connected");
  return cfg.access_token;
}

function pickOfferFields(c: import("@/lib/ai-intel/inbound-classifier").InboundClassification): Record<string, number | string | null> {
  const out: Record<string, number | string | null> = {};
  if (c.approved_amount != null) out.approved_amount = c.approved_amount;
  if (c.buy_rate != null) out.buy_rate = c.buy_rate;
  if (c.sell_rate != null) out.sell_rate = c.sell_rate;
  if (c.term != null) out.term = c.term;
  return out;
}

function buildNotes(label: "Approved" | "Counter", c: import("@/lib/ai-intel/inbound-classifier").InboundClassification): string {
  const parts: string[] = [label];
  if (c.summary) parts.push(c.summary);
  return parts.join(" — ");
}

async function zohoSubformSync(merchantId: string, caller: string): Promise<void> {
  try {
    await syncLenderSubmissionsSubform(merchantId);
  } catch (e) {
    console.warn(`[${caller}] Zoho subform sync failed:`, (e as Error).message);
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}
