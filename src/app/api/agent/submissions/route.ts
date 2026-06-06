export const dynamic = "force-dynamic";
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
import { addNoteResilient } from "@/lib/zoho";
import type { PendingActionPayload } from "@/lib/ai-intel/types";
import { DEFAULTS } from "@/config/defaults";
import {
  createEmailSubmission,
  setEmailSubmissionThread,
  setEmailSubmissionStatus,
  setSuggestedLenderIds,
  findEmailSubmissionForFunderReply,
  updateFunderReplyStatus,
  type EmailSubmissionRow,
} from "@/lib/ai-intel/email-submissions";
import { analyzeBankStatements } from "@/lib/ai-intel/bank-statement-analyzer";
import { suggestFundersForDeal } from "@/lib/ai-intel/suggest-funders";
import { isAppFile } from "@/lib/ai-intel/build-draft";

/**
 * True when this is Matthew's own "New Deal — {Business}" intake email (the trigger
 * for the verbatim-forward flow), as opposed to a funder reply. Requires BOTH an
 * allow-listed sender (SUBMISSIONS_INTERNAL_SENDERS) AND a subject starting "New Deal".
 */
function isNewDealEmail(from: string, subject: string | undefined | null): boolean {
  if (!subject || !/^\s*new\s+deal\b/i.test(subject)) return false;
  const allow = (process.env.SUBMISSIONS_INTERNAL_SENDERS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allow.length === 0) return false;
  return allow.includes(from.toLowerCase());
}

function parseBusinessFromNewDealSubject(subject: string): string {
  return subject.replace(/^\s*new\s+deal\b\s*[—:\-–]*\s*/i, "").trim() || subject.trim();
}

export const runtime = "nodejs";
// New-Deal emails trigger bank-statement analysis + funder matching (postReadyToShop),
// which can exceed 60s for deals with several statements. Match the other analysis routes.
export const maxDuration = 300;

async function lookupLenderName(lenderId: string | null): Promise<string> {
  if (!lenderId) return "—";
  const { data } = await supabaseAdmin
    .from("lenders")
    .select("name")
    .eq("id", lenderId)
    .maybeSingle();
  return (data?.name as string | null) ?? "—";
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const token = url.searchParams.get("validationToken");
  if (token) {
    return new NextResponse(token, { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  // Manual replay of a single message (e.g. mail that arrived before a fix was deployed).
  // createEmailSubmission is idempotent on original_message_id, so this is safe to re-run.
  const reprocess = url.searchParams.get("reprocess");
  if (reprocess) {
    const secret = process.env.CRON_SECRET;
    const auth = req.headers.get("authorization") ?? "";
    const qsecret = url.searchParams.get("secret") ?? "";
    if (secret && auth !== `Bearer ${secret}` && qsecret !== secret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const mailbox = url.searchParams.get("mailbox") || "submissions@srtagency.com";
    try {
      const result = await processMessage(mailbox, reprocess);
      return NextResponse.json({ ok: true, reprocessed: reprocess, result });
    } catch (e) {
      return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
    }
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
      try {
        await supabaseAdmin.from("system_logs").insert({
          event_type: "submissions_webhook_error",
          description: `Notification handling threw: ${(e as Error).message}`,
          metadata: { subscription: notification.subscriptionId, resource: notification.resource },
        });
      } catch {
        /* logging is best-effort */
      }
      results.push({ error: (e as Error).message });
    }
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}

async function processMessage(mailbox: string, messageId: string): Promise<Record<string, unknown>> {
  const token = await microsoft.getAccessToken();
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${mailbox}/messages/${messageId}?$select=id,subject,from,body,bodyPreview,receivedDateTime,conversationId`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.text();
    // Surface the failure — a silent early return here is exactly what hid the
    // expired-token webhook failures (no log, no Slack post).
    try {
      await supabaseAdmin.from("system_logs").insert({
        event_type: "submissions_webhook_error",
        description: `Graph fetch failed (${res.status}) for ${mailbox}/${messageId}`,
        metadata: { mailbox, message_id: messageId, status: res.status, error: err.slice(0, 300) },
      });
    } catch {
      /* logging is best-effort */
    }
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

  // Observability: record every inbound + the branch it routes to, so failures aren't invisible.
  const newDeal = isNewDealEmail(fromAddress, msg.subject);
  const routing = isRoutingSubject(msg.subject);
  try {
    await supabaseAdmin.from("system_logs").insert({
      event_type: "submissions_webhook",
      description: `Inbound to ${mailbox}: "${msg.subject}" from ${fromAddress} → ${newDeal ? "new_deal" : routing ? "routing" : "classify"}`,
      metadata: {
        message_id: msg.id,
        from: fromAddress,
        subject: msg.subject,
        is_new_deal: newDeal,
        is_routing: routing,
        allow_count: (process.env.SUBMISSIONS_INTERNAL_SENDERS || "").split(",").map((s) => s.trim()).filter(Boolean).length,
      },
    });
  } catch (e) {
    console.warn("[agent/submissions] system_logs insert failed:", (e as Error).message);
  }

  // Matthew's own "New Deal — {Business}" intake email → start the verbatim-forward flow.
  if (newDeal) {
    return handleNewDealEmail(mailbox, msg, fromAddress);
  }

  if (isRoutingSubject(msg.subject)) {
    return handleRoutingReply(msg, bodyText);
  }

  const { classification, tokens, latencyMs } = await classifyInboundEmail({
    subject: msg.subject,
    from: fromAddress,
    body: bodyText,
  });

  // Funder reply to an email-driven deal? These have no Zoho contact, so match the
  // email_submissions tracking table first (by conversationId / business / domain).
  const emailSubMatch = await findEmailSubmissionForFunderReply({
    conversationId: msg.conversationId ?? null,
    businessName: classification.business_name,
    funderDomain: fromDomain,
  });
  if (emailSubMatch) {
    return handleFunderReplyForEmailSubmission({
      submission: emailSubMatch.submission,
      funderRowId: emailSubMatch.funderRowId,
      classification,
      msg,
      fromAddress,
      fromDomain,
    });
  }

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
  const lenderName = await lookupLenderName(args.submission?.lender_id ?? null);
  const amt = args.classification.approved_amount ? `$${args.classification.approved_amount.toLocaleString()}` : "—";
  const rate = args.classification.buy_rate ?? args.classification.sell_rate;
  const rateStr = rate ? String(rate) : "—";
  const termStr = args.classification.term ?? "—";
  const noteContent = `${amt} @ ${rateStr} / ${termStr}`;
  await writeFunderReplyNote({
    zohoId: args.contact.zoho_lead_id,
    businessName: args.contact.business_name,
    lenderName,
    status: "Approved",
    content: replyBullets(args.classification),
  });
  await postFunderReplyToDealChannel({
    contactId: args.contact.id,
    headline: `🎉 *APPROVED* — ${args.contact.business_name} · ${lenderName ?? "lender"}`,
    body: replyBullets(args.classification),
    fallbackIntent: "approved",
  });
  await dmMatthewApprovalReminder({
    businessName: args.contact.business_name,
    zohoLeadId: args.contact.zoho_lead_id,
    lenderName,
    offer: noteContent,
  });
  await supabaseAdmin.from("ai_decisions").update({ action_taken: "slack_alert" }).eq("id", args.aiDecisionId ?? "");
  return { intent: "approved", business: args.contact.business_name };
}

async function dmMatthewApprovalReminder(opts: {
  businessName: string | null;
  zohoLeadId: string | null;
  lenderName: string;
  offer: string;
}): Promise<void> {
  const matthewDM = process.env.SLACK_VEKTOR_MATTHEW_DM || "";
  if (!matthewDM) {
    console.warn("[handleApproved] SLACK_VEKTOR_MATTHEW_DM not set — skipping approval reminder DM");
    return;
  }
  const zohoLink = opts.zohoLeadId
    ? `<https://crm.zoho.com/crm/org/_/tab/Leads/${opts.zohoLeadId}|Open in Zoho>`
    : "";
  const lines = [
    `✅ *Approval received* — ${opts.businessName ?? "unknown merchant"}`,
    `Lender: ${opts.lenderName === "—" ? "unknown" : opts.lenderName}`,
    `Offer: ${opts.offer}`,
    "",
    `👉 Update Zoho stage to *Approved* to fire Meta CAPI \`DealApproved\``,
    zohoLink,
  ].filter(Boolean);
  try {
    await slack.postMessage(matthewDM, lines.join("\n"));
  } catch (e) {
    console.warn("[handleApproved] DM to Matthew failed:", (e as Error).message);
  }
}

async function handleDeclined(args: { contact: { id: string; business_name: string | null; zoho_lead_id: string | null }; submission: { id: string; lender_id: string | null } | null; classification: import("@/lib/ai-intel/inbound-classifier").InboundClassification; msg: { subject: string }; aiDecisionId?: string }): Promise<Record<string, unknown>> {
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

  const lenderName = await lookupLenderName(args.submission?.lender_id ?? null);
  const reason = args.classification.declined_reason ?? args.classification.summary;
  await writeFunderReplyNote({
    zohoId: args.contact.zoho_lead_id,
    businessName: args.contact.business_name,
    lenderName,
    status: "Declined",
    content: replyBullets(args.classification),
  });
  await postFunderReplyToDealChannel({
    contactId: args.contact.id,
    headline: `⛔ *DECLINED* — ${args.contact.business_name} · ${lenderName ?? "lender"}`,
    body: replyBullets(args.classification),
    fallbackIntent: "declined",
  });
  return { intent: "declined", business: args.contact.business_name, meta_event: metaResult };
}

async function handleStipsNeeded(args: { contact: { id: string; business_name: string | null; zoho_lead_id: string | null }; submission: { id: string; lender_id: string | null } | null; classification: import("@/lib/ai-intel/inbound-classifier").InboundClassification; msg: { subject: string }; aiDecisionId?: string }): Promise<Record<string, unknown>> {
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
  const lenderName = await lookupLenderName(args.submission?.lender_id ?? null);
  const stipsList = args.classification.stips_required.length > 0
    ? args.classification.stips_required.join(", ")
    : args.classification.summary;
  await writeFunderReplyNote({
    zohoId: args.contact.zoho_lead_id,
    businessName: args.contact.business_name,
    lenderName,
    status: "Stips",
    content: replyBullets(args.classification),
  });
  const payload: PendingActionPayload = {
    action_type: "update_zoho",
    zoho_id: args.contact.zoho_lead_id ?? undefined,
    stage: "Pending Stips",
    stips_required: args.classification.stips_required,
  };
  await postApprovalRequest({
    summary: `📎 *STIPS NEEDED* — ${args.contact.business_name} · ${lenderName ?? "lender"}\n*Stips:* ${stipsList}\n*Summary:* ${args.classification.summary}`,
    payload,
    merchantId: args.contact.id,
    zohoId: args.contact.zoho_lead_id ?? undefined,
    aiDecisionId: args.aiDecisionId,
  });
  await supabaseAdmin.from("ai_decisions").update({ action_taken: "draft_email" }).eq("id", args.aiDecisionId ?? "");
  return { intent: "stips_needed", business: args.contact.business_name };
}

async function handleCounterOffer(args: { contact: { id: string; business_name: string | null; zoho_lead_id: string | null }; submission: { id: string; lender_id: string | null } | null; classification: import("@/lib/ai-intel/inbound-classifier").InboundClassification; msg: { subject: string }; aiDecisionId?: string }): Promise<Record<string, unknown>> {
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
  const lenderName = await lookupLenderName(args.submission?.lender_id ?? null);
  const details = [
    args.classification.approved_amount ? `$${args.classification.approved_amount.toLocaleString()}` : null,
    args.classification.buy_rate ? `@ ${args.classification.buy_rate}` : null,
    args.classification.term ? `/ ${args.classification.term}` : null,
  ].filter(Boolean).join(" ");
  await writeFunderReplyNote({
    zohoId: args.contact.zoho_lead_id,
    businessName: args.contact.business_name,
    lenderName,
    status: "Counter",
    content: replyBullets(args.classification),
  });
  await postFunderReplyToDealChannel({
    contactId: args.contact.id,
    headline: `💬 *COUNTER OFFER* — ${args.contact.business_name} · ${lenderName ?? "lender"}`,
    body: replyBullets(args.classification),
    fallbackIntent: "counter",
  });
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

// ── Email-driven deal shopping (verbatim forward) ──

async function handleNewDealEmail(
  mailbox: string,
  msg: {
    id: string;
    subject: string;
    body: { content: string; contentType: string };
    conversationId: string;
  },
  fromAddress: string,
): Promise<Record<string, unknown>> {
  const business = parseBusinessFromNewDealSubject(msg.subject);
  const htmlBody = msg.body.content ?? "";

  const { id, created } = await createEmailSubmission({
    businessName: business,
    originalMessageId: msg.id,
    conversationId: msg.conversationId ?? null,
    mailbox,
    subject: msg.subject,
    htmlBody,
    fromAddress,
  });

  // Duplicate Graph notification for the same email — already captured, don't re-post.
  if (!created) {
    return { intent: "new_deal", business, deduped: true };
  }

  const channel = process.env.SLACK_SUB_CHANNEL || "C0AJXH7PTBM";
  const text =
    `📦 *New Deal — ${business}* — ready to show.\n` +
    "Reply in this thread with the funder name(s) to send to " +
    "(e.g. `Lexio, CFG, Bitty`) and I'll forward this exact package to each.";

  let threadTs: string | null = null;
  let postedChannel = channel;
  try {
    const resp = (await slack.postMessage(channel, text)) as { ok?: boolean; ts?: string; channel?: string };
    if (resp?.ts) {
      threadTs = resp.ts;
      postedChannel = resp.channel || channel;
      await setEmailSubmissionThread(id, postedChannel, resp.ts);
    }
  } catch (e) {
    console.error("[handleNewDealEmail] Slack post failed:", (e as Error).message);
  }

  // Read the attached statements and suggest which funders to shop. Best-effort: any
  // failure leaves the parent message (which already explains how to name funders) intact.
  if (threadTs) {
    await postReadyToShop({
      emailSubmissionId: id,
      business,
      channel: postedChannel,
      threadTs,
      messageId: msg.id,
      mailbox,
    }).catch((e) => console.warn("[handleNewDealEmail] ready-to-shop failed:", (e as Error).message));
  }

  return { intent: "new_deal", business, email_submission_id: id, slack_thread_ts: threadTs };
}

/**
 * Analyze the New-Deal email's bank statements, ask the AI matcher which funders fit, and
 * post a "🎯 Ready to shop" reply with the suggestions. Stores the suggested funder ids so a
 * later `go`/`all` reply knows who to forward to. Silent no-op if there are no statements to
 * read or no funders fit — the parent message still tells Matthew he can name funders.
 */
async function postReadyToShop(args: {
  emailSubmissionId: string;
  business: string;
  channel: string;
  threadTs: string;
  messageId: string;
  mailbox: string;
}): Promise<void> {
  const raw = await microsoft.getMessageAttachments(args.messageId, args.mailbox);
  const pdfs = raw.filter(
    (a) => a.contentBytes && (a.contentType === "application/pdf" || /\.pdf$/i.test(a.name)),
  );
  const statements = pdfs
    .filter((a) => !isAppFile(a.name))
    .map((a) => ({ name: a.name, buffer: Buffer.from(a.contentBytes, "base64") }));
  if (statements.length === 0) return;

  const analysis = await analyzeBankStatements(statements);
  const { suggested, avoid } = await suggestFundersForDeal(analysis.report, args.business);
  if (suggested.length === 0) return;

  await setSuggestedLenderIds(args.emailSubmissionId, suggested.map((s) => s.id));

  const lines = [
    `🎯 *Ready to shop — ${args.business}*`,
    `Suggested (${suggested.length}):`,
    ...suggested.map((s) => `• *${s.name}*${s.reason ? ` — ${s.reason}` : ""}`),
  ];
  if (avoid.length > 0) {
    lines.push(`⚠️ Skip: ${avoid.map((a) => `${a.name}${a.reason ? ` (${a.reason})` : ""}`).join(", ")}`);
  }
  lines.push("Reply `go`/`all` to send to all suggested, or name funders (e.g. `Velocity, CFG, Lexio`).");

  await slack.postThreadReply(args.channel, args.threadTs, lines.join("\n"));
}

async function handleFunderReplyForEmailSubmission(args: {
  submission: EmailSubmissionRow;
  funderRowId: string | null;
  classification: import("@/lib/ai-intel/inbound-classifier").InboundClassification;
  msg: { id: string; subject: string };
  fromAddress: string;
  fromDomain: string | null;
}): Promise<Record<string, unknown>> {
  const { submission, classification } = args;
  const funderName = await lookupFunderName(args.funderRowId, args.fromAddress);

  const { emoji, label, detail, status, draftReply } = describeFunderReply(classification);

  await updateFunderReplyStatus({
    funderRowId: args.funderRowId,
    emailSubmissionId: submission.id,
    funderDomain: args.fromDomain,
    status,
    replyMessageId: args.msg.id,
    notes: detail,
  });

  const channel = submission.slack_channel || process.env.SLACK_SUB_CHANNEL || "C0AJXH7PTBM";
  const threadTs = submission.slack_thread_ts ?? undefined;
  const headline = `${emoji} *${label}* — ${submission.business_name} · ${funderName}`;
  const bodyLines = `${headline}\n${replyBullets(classification)}`;

  try {
    if (threadTs) {
      await slack.postThreadReply(channel, threadTs, bodyLines);
    } else {
      await slack.postMessage(channel, bodyLines);
    }
  } catch (e) {
    console.error("[handleFunderReplyForEmailSubmission] thread post failed:", (e as Error).message);
  }

  // Mirror the funder reply into Zoho so the deal history is tracked there too.
  // Email-driven deals have no Zoho link on the email_submissions row, so match the
  // merchant by business name (handles minor spelling/casing differences).
  try {
    const contact = await findContactByBusinessName(submission.business_name);
    const zStatus: "Approved" | "Declined" | "Counter" | "Stips" | null =
      classification.intent === "approved" ? "Approved"
      : classification.intent === "declined" ? "Declined"
      : classification.intent === "counter_offer" ? "Counter"
      : (classification.intent === "stips_needed" || classification.intent === "missing_fields") ? "Stips"
      : null;
    if (zStatus) {
      await writeFunderReplyNote({
        zohoId: contact?.zoho_lead_id ?? null,
        businessName: submission.business_name,
        lenderName: funderName,
        status: zStatus,
        content: replyBullets(classification),
      });
    }
  } catch (e) {
    console.warn("[handleFunderReplyForEmailSubmission] Zoho note failed:", (e as Error).message);
  }

  // (Suggested auto-reply drafts removed per Matthew — funder replies just post to the
  // thread + Zoho note; he replies to funders himself.)

  // Once any funder responds, the deal is actively in market.
  if (submission.status === "awaiting_funders") {
    await setEmailSubmissionStatus(submission.id, "forwarded");
  }

  return { intent: classification.intent, business: submission.business_name, source: "email_submission" };
}

async function lookupFunderName(funderRowId: string | null, fallbackEmail: string): Promise<string> {
  if (funderRowId) {
    const { data } = await supabaseAdmin
      .from("email_submission_funders")
      .select("funder_name")
      .eq("id", funderRowId)
      .maybeSingle();
    const name = data?.funder_name as string | null;
    if (name) return name;
  }
  return fallbackEmail;
}

function describeFunderReply(
  c: import("@/lib/ai-intel/inbound-classifier").InboundClassification,
): { emoji: string; label: string; detail: string; status: string; draftReply: boolean } {
  switch (c.intent) {
    case "approved": {
      const amt = c.approved_amount ? `$${c.approved_amount.toLocaleString()}` : "—";
      const rate = c.buy_rate ?? c.sell_rate;
      const detail = `Offer: ${amt} @ ${rate ?? "—"} / ${c.term ?? "—"}`;
      return { emoji: "🎉", label: "APPROVED", detail, status: "approved", draftReply: true };
    }
    case "declined":
      return { emoji: "⛔", label: "DECLINED", detail: `Reason: ${c.declined_reason ?? c.summary}`, status: "declined", draftReply: true };
    case "stips_needed":
      return {
        emoji: "📎",
        label: "STIPS NEEDED",
        detail: c.stips_required.length > 0 ? `Stips: ${c.stips_required.join(", ")}` : c.summary,
        status: "stips",
        draftReply: true,
      };
    case "counter_offer": {
      const details = [
        c.approved_amount ? `$${c.approved_amount.toLocaleString()}` : null,
        c.buy_rate ? `@ ${c.buy_rate}` : null,
        c.term ? `/ ${c.term}` : null,
      ].filter(Boolean).join(" ");
      return { emoji: "💬", label: "COUNTER OFFER", detail: details || c.summary, status: "counter", draftReply: true };
    }
    case "missing_fields":
      return {
        emoji: "🔍",
        label: "DOCS REQUESTED",
        detail: c.missing_fields.length > 0 ? `Requested: ${c.missing_fields.join(", ")}` : c.summary,
        status: "stips",
        draftReply: true,
      };
    default:
      return { emoji: "📨", label: "REPLY", detail: c.summary, status: "sent", draftReply: false };
  }
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

/**
 * 3-6 concise bullets summarizing a funder's reply. Used for BOTH the Slack post and the Zoho
 * note. Prefers the model's `bullets` (from the same classification call — no extra LLM round-trip),
 * falling back to structured lines + a trimmed summary when the model didn't return any.
 */
function replyBullets(c: import("@/lib/ai-intel/inbound-classifier").InboundClassification): string {
  const fmt = (arr: string[]) => arr.slice(0, 6).map((x) => `• ${x.replace(/^[•\-\s]+/, "")}`).join("\n");

  const fromModel = (c.bullets ?? []).map((x) => x.trim()).filter(Boolean);
  if (fromModel.length >= 3) return fmt(fromModel);

  const money = (n: number | null) => (n ? `$${n.toLocaleString()}` : null);
  const b: string[] = [...fromModel];
  switch (c.intent) {
    case "approved": {
      const rate = c.buy_rate ?? c.sell_rate;
      b.push(`Approved${money(c.approved_amount) ? ` ${money(c.approved_amount)}` : ""}`);
      if (rate || c.term) b.push(`Terms: ${rate ?? "—"}${c.term ? ` / ${c.term}` : ""}`);
      break;
    }
    case "declined":
      b.push("Declined");
      if (c.declined_reason) b.push(`Reason: ${c.declined_reason}`);
      break;
    case "stips_needed":
      b.push("Stips needed");
      if (c.stips_required.length) b.push(`Need: ${c.stips_required.slice(0, 5).join(", ")}`);
      break;
    case "counter_offer": {
      const offer = [money(c.approved_amount), c.buy_rate ? `@ ${c.buy_rate}` : null, c.term ? `/ ${c.term}` : null].filter(Boolean).join(" ");
      b.push("Counter offer");
      if (offer) b.push(`Offer: ${offer}`);
      break;
    }
    case "missing_fields":
      b.push("Docs requested");
      if (c.missing_fields.length) b.push(`Requested: ${c.missing_fields.slice(0, 5).join(", ")}`);
      break;
  }
  if (b.length < 3 && c.summary) {
    const s = c.summary.trim();
    b.push(s.length > 160 ? `${s.slice(0, 157)}…` : s);
  }
  return fmt(b);
}

async function zohoSubformSync(merchantId: string, caller: string): Promise<void> {
  try {
    await syncLenderSubmissionsSubform(merchantId);
  } catch (e) {
    console.warn(`[${caller}] Zoho subform sync failed:`, (e as Error).message);
  }
}

async function writeFunderReplyNote(args: {
  zohoId: string | null;
  businessName?: string | null;
  lenderName: string;
  status: "Approved" | "Declined" | "Counter" | "Stips";
  content: string;
}): Promise<void> {
  if (!args.zohoId && !args.businessName) return;
  const lender = args.lenderName === "—" ? "Lender" : args.lenderName;
  try {
    // Resilient: writes to the Lead, or the converted Deal (by business name) if the lead was converted.
    const r = await addNoteResilient({
      zohoLeadId: args.zohoId,
      businessName: args.businessName,
      title: `${lender} — ${args.status}`,
      content: args.content,
    });
    if (!r.ok) console.warn(`[submissions] funder note not written (${args.status}) for ${args.businessName ?? args.zohoId}`);
  } catch (e) {
    console.warn(`[submissions] writeFunderReplyNote(${args.status}) failed:`, (e as Error).message);
  }
}

async function postFunderReplyToDealChannel(args: {
  contactId: string;
  headline: string;
  body: string;
  fallbackIntent: "approved" | "declined" | "counter";
}): Promise<void> {
  const { data: deal } = await supabaseAdmin
    .from("deals")
    .select("slack_deal_channel_id")
    .eq("contact_id", args.contactId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const channelId = (deal?.slack_deal_channel_id as string | null) ?? null;
  const fallback = process.env.SLACK_AI_APPROVALS_CHANNEL || process.env.SLACK_HOT_LEADS_CHANNEL || "";
  const target = channelId || fallback;
  if (!target) return;
  await slack.postMessage(target, `${args.headline}\n${args.body}`);
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
