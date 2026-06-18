export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { processInboundForBankStatements } from "@/lib/ai-intel/inbound-bank-statements";
import { ingestLeadEmail } from "@/lib/ai-intel/inbound-email-ingest";

// Graph change-notification webhook for Matthew's mailbox (matthew@srtagency.com).
// A CRM lead emailing bank statements here fires this; we run the OneDrive +
// analyzer pipeline and post a gated follow-up suggestion. The subscription is
// created once via POST /api/integrations/microsoft/subscribe with
// { mailbox: "matthew@srtagency.com", notificationPath: "/api/agent/bank-statements-inbound" }
// and self-heals through the existing graph-subscription-renew cron.
export const runtime = "nodejs";
// Downloading + uploading several PDFs and running the analyzer trigger can exceed
// 60s; match the other analysis routes.
export const maxDuration = 300;

const LEADS_MAILBOX = process.env.LEADS_MAILBOX || "matthew@srtagency.com";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  // Graph subscription validation handshake.
  const token = url.searchParams.get("validationToken");
  if (token) {
    return new NextResponse(token, { status: 200, headers: { "Content-Type": "text/plain" } });
  }

  // Manual replay of a single message (e.g. one that arrived before deploy, or to
  // re-test). processInboundForBankStatements is idempotent on the message id.
  const reprocess = url.searchParams.get("reprocess");
  if (reprocess) {
    const secret = process.env.CRON_SECRET;
    const auth = req.headers.get("authorization") ?? "";
    const qsecret = url.searchParams.get("secret") ?? "";
    if (secret && auth !== `Bearer ${secret}` && qsecret !== secret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const mailbox = url.searchParams.get("mailbox") || LEADS_MAILBOX;
    try {
      const result = await processInboundForBankStatements(mailbox, reprocess);
      return NextResponse.json({ ok: true, reprocessed: reprocess, result });
    } catch (e) {
      return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true, endpoint: "agent/bank-statements-inbound" });
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

  const results: unknown[] = [];

  for (const notification of body.value as Array<{ resource: string; subscriptionId: string; clientState?: string }>) {
    try {
      // Validate clientState against the stored subscription config (same gate as
      // the submissions webhook) so a stray POST can't drive the pipeline.
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
      const mailbox = mailboxMatch?.[1] ?? LEADS_MAILBOX;

      // One subscription on Matthew's mailbox drives BOTH concerns:
      //  • ingest the inbound lead email into the textwin.ai unified inbox, and
      //  • run the bank-statement pipeline if it carries statement PDFs.
      // Both are idempotent; the email ingest is best-effort so it never blocks
      // the statement path.
      const ingest = await ingestLeadEmail(mailbox, messageId).catch((e) => ({
        status: "skipped" as const,
        reason: `ingest_threw:${(e as Error).message}`,
      }));
      const result = await processInboundForBankStatements(mailbox, messageId);
      results.push({ email_ingest: ingest, bank_statements: result });
    } catch (e) {
      console.error("[bank-statements-inbound] notification error:", (e as Error).message);
      try {
        await supabaseAdmin.from("system_logs").insert({
          event_type: "bank_statements_inbound_error",
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
