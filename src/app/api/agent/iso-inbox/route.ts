// Graph change notification handler for Matthew's personal inbox.
// Detects lender/funder ISO approval emails and posts a Slack card
// asking if the lender should be added to the active lender list.
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { microsoft } from "@/lib/microsoft";
import { postApprovalRequest } from "@/lib/ai-intel/slack-approval";
import { detectLenderSignup } from "@/lib/ai-intel/lender-signup-detector";
import type { PendingActionPayload } from "@/lib/ai-intel/types";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const token = new URL(req.url).searchParams.get("validationToken");
  if (token) return new NextResponse(token, { status: 200, headers: { "Content-Type": "text/plain" } });
  return NextResponse.json({ ok: true, endpoint: "agent/iso-inbox" });
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const validationToken = url.searchParams.get("validationToken");
  if (validationToken) return new NextResponse(validationToken, { status: 200, headers: { "Content-Type": "text/plain" } });

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
        results.push({ skipped: "bad_client_state" });
        continue;
      }

      const messageIdMatch = notification.resource.match(/messages(?:\/|\(')([^'\/]+)/);
      const messageId = messageIdMatch?.[1];
      if (!messageId) { results.push({ skipped: "no_message_id" }); continue; }

      const mailboxMatch = notification.resource.match(/users\/([^/]+)/);
      const mailbox = mailboxMatch?.[1];

      results.push(await processIsoInboxMessage(mailbox, messageId));
    } catch (e) {
      console.error("[agent/iso-inbox] error:", (e as Error).message);
      results.push({ error: (e as Error).message });
    }
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}

async function processIsoInboxMessage(mailbox: string | undefined, messageId: string): Promise<Record<string, unknown>> {
  const token = await getUserAccessToken();
  const mailboxPath = mailbox ? `users/${mailbox}` : "me";
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/${mailboxPath}/messages/${messageId}?$select=id,subject,from,body,bodyPreview,receivedDateTime`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return { error: `graph_fetch_failed: ${res.status}` };

  const msg = await res.json() as {
    id: string;
    subject: string;
    from: { emailAddress: { address: string; name: string } };
    body: { content: string; contentType: string };
    bodyPreview: string;
    receivedDateTime: string;
  };

  const bodyText = msg.body.contentType === "html" ? stripHtml(msg.body.content) : msg.body.content;
  const fromAddress = msg.from?.emailAddress?.address ?? "unknown";

  const { detection, latencyMs } = await detectLenderSignup({
    subject: msg.subject,
    from: fromAddress,
    body: bodyText,
  });

  if (!detection.is_signup || detection.confidence === "low") {
    return { skipped: "not_a_signup", confidence: detection.confidence, from: fromAddress };
  }

  // Check if this lender already exists in our DB (avoid duplicate cards)
  if (detection.lender_name) {
    const { data: existing } = await supabaseAdmin
      .from("lenders")
      .select("id, is_active")
      .ilike("name", `%${detection.lender_name}%`)
      .maybeSingle();

    if (existing?.is_active) {
      return { skipped: "already_active", lender: detection.lender_name };
    }
  }

  const submissionInfo = [
    detection.submission_email ? `*Submit to:* ${detection.submission_email}` : null,
    detection.cc_emails.length ? `*CC:* ${detection.cc_emails.join(", ")}` : null,
    detection.portal_url ? `*Portal:* ${detection.portal_url}` : null,
    detection.subject_line_format ? `*Subject format:* "${detection.subject_line_format}"` : null,
    detection.docs_required ? `*Docs:* ${detection.docs_required}` : null,
    detection.rep_name ? `*Rep:* ${detection.rep_name}${detection.rep_phone ? ` · ${detection.rep_phone}` : ""}` : null,
    detection.notes ? `*Notes:* ${detection.notes}` : null,
  ].filter(Boolean).join("\n");

  const summary = [
    `New lender ISO approval detected: *${detection.lender_name ?? fromAddress}*`,
    `_From: ${fromAddress} · Subject: ${msg.subject}_`,
    submissionInfo || "_No submission details extracted — check the email._",
  ].join("\n");

  const payload: PendingActionPayload = {
    action_type: "add_lender",
    lender_name: detection.lender_name ?? fromAddress,
    submission_email: detection.submission_email ?? undefined,
    cc_emails: detection.cc_emails,
    portal_url: detection.portal_url ?? undefined,
    rep_name: detection.rep_name ?? undefined,
    rep_email: detection.rep_email ?? undefined,
    subject_line_format: detection.subject_line_format ?? undefined,
    docs_required: detection.docs_required ?? undefined,
    notes: [detection.notes, detection.rep_phone ? `Rep phone: ${detection.rep_phone}` : null].filter(Boolean).join(" | ") || undefined,
    requires_matthew: true,
  };

  const result = await postApprovalRequest({
    summary,
    payload,
    category: "lender_mgmt",
  });

  return {
    lender: detection.lender_name,
    confidence: detection.confidence,
    slack_ts: result.slackTs,
    latency_ms: latencyMs,
  };
}

async function getUserAccessToken(): Promise<string> {
  const { data } = await supabaseAdmin
    .from("integrations")
    .select("config")
    .eq("name", "Microsoft 365")
    .single();
  const cfg = data?.config as { access_token?: string } | undefined;
  if (!cfg?.access_token) throw new Error("Microsoft 365 not connected");
  return cfg.access_token;
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
