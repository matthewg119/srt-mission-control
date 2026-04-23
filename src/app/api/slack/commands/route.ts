import { NextRequest, NextResponse } from "next/server";
import { slack } from "@/lib/slack-bot";
import { supabaseAdmin } from "@/lib/db";
import { buildSubmissionPackage } from "@/lib/ai-intel/deal-submission-builder";
import { sendLenderRoutingRequest } from "@/lib/ai-intel/request-lender-routing";
import { microsoft } from "@/lib/microsoft";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  const signingSecret = process.env.SLACK_SIGNING_SECRET || "";
  const timestamp = req.headers.get("x-slack-request-timestamp") || "";
  const signature = req.headers.get("x-slack-signature") || "";

  if (signingSecret && timestamp && signature) {
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - parseInt(timestamp, 10)) > 300) {
      return NextResponse.json({ error: "stale_request" }, { status: 403 });
    }
    if (!slack.verifySignature(signingSecret, timestamp, rawBody, signature)) {
      return NextResponse.json({ error: "bad_signature" }, { status: 403 });
    }
  }

  const params = new URLSearchParams(rawBody);
  const text = (params.get("text") ?? "").trim();
  const userId = params.get("user_id") ?? "";
  const channelId = params.get("channel_id") ?? "";
  const responseUrl = params.get("response_url") ?? "";
  void channelId;

  const [subcommand, ...rest] = text.split(/\s+/);
  const arg = rest.join(" ").trim();

  switch ((subcommand || "").toLowerCase()) {
    case "submit":
      return handleSubmit({ merchantQuery: arg, userId, channelId, responseUrl });
    case "route":
      return handleRoute({ merchantQuery: arg, responseUrl });
    case "status":
      return handleStatus({ merchantQuery: arg });
    case "followups":
      return handleFollowups();
    case "emails":
      return handleEmails();
    case "activity":
      return handleActivity();
    case "doc":
      return handleDoc({ arg });
    default:
      return respond(`Unknown subcommand. Try: \`/srt route [merchant]\` (ask where to send), \`/srt submit [merchant]\` (auto submit to T1), \`/srt status [merchant]\`, \`/srt doc [merchant] [filename]\`, \`/srt followups\`, \`/srt emails\`, \`/srt activity\`.`);
  }
}

function respond(text: string, ephemeral = true): NextResponse {
  return NextResponse.json({ response_type: ephemeral ? "ephemeral" : "in_channel", text });
}

async function handleSubmit(args: { merchantQuery: string; userId: string; channelId: string; responseUrl: string }): Promise<NextResponse> {
  if (!args.merchantQuery) {
    return respond("Usage: `/srt submit [merchant name]`");
  }

  const { data: contact } = await supabaseAdmin
    .from("contacts")
    .select("id, business_name, zoho_lead_id")
    .ilike("business_name", `%${args.merchantQuery}%`)
    .limit(1)
    .maybeSingle();

  if (!contact) return respond(`No merchant matching "${args.merchantQuery}".`);

  const { data: deal } = await supabaseAdmin
    .from("deals")
    .select("id, amount")
    .eq("contact_id", contact.id)
    .in("stage", ["Shopping", "Underwriting", "Pre-Approved", "Approved"])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!deal) return respond(`No active deal found for ${contact.business_name}. Deal must be in Shopping/Underwriting/Pre-Approved/Approved.`);

  const { data: lenders } = await supabaseAdmin
    .from("lenders")
    .select("id")
    .eq("is_active", true)
    .eq("tier", 1)
    .limit(5);

  if (!lenders || lenders.length === 0) {
    return respond(`No active Tier-1 lenders found. Add lenders in /dashboard/lenders first.`);
  }

  void (async () => {
    try {
      const result = await buildSubmissionPackage({
        dealId: deal.id as string,
        lenderIds: lenders.map((l) => l.id as string),
        requestedAmount: (deal.amount as number) ?? 0,
        requestedBy: "slack_command",
      });
      await fetch(args.responseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          response_type: "ephemeral",
          text: result.ok
            ? `✅ Submission package built for ${contact.business_name}: ${result.pendingActionIds.length} lender drafts posted to #submissions. OneDrive: ${result.onedriveUrl ?? "(failed)"}`
            : `⚠️ Submission build failed: ${result.error}`,
        }),
      });
    } catch (e) {
      await fetch(args.responseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ response_type: "ephemeral", text: `⚠️ Build error: ${(e as Error).message}` }),
      });
    }
  })();

  return respond(`🔧 Building submission package for ${contact.business_name}... I'll post back here when drafts are ready.`);
}

async function handleRoute(args: { merchantQuery: string; responseUrl: string }): Promise<NextResponse> {
  if (!args.merchantQuery) return respond("Usage: `/srt route [merchant name]` — VeKtor emails submissions@ asking which lender(s) to send to.");

  const { data: contact } = await supabaseAdmin
    .from("contacts")
    .select("id, business_name, industry, monthly_revenue, use_of_funds, zoho_lead_id")
    .ilike("business_name", `%${args.merchantQuery}%`)
    .limit(1)
    .maybeSingle();

  if (!contact) return respond(`No merchant matching "${args.merchantQuery}".`);

  const { data: deal } = await supabaseAdmin
    .from("deals")
    .select("id, amount")
    .eq("contact_id", contact.id)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!deal) return respond(`No deal for ${contact.business_name}.`);

  const { data: lastSubmission } = await supabaseAdmin
    .from("deal_submissions")
    .select("onedrive_folder_url")
    .eq("merchant_id", contact.id)
    .not("onedrive_folder_url", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  void (async () => {
    const res = await sendLenderRoutingRequest({
      dealId: deal.id as string,
      contactId: contact.id as string,
      businessName: (contact.business_name as string) ?? "Merchant",
      amountRequested: (deal.amount as number) ?? 0,
      industry: (contact.industry as string) ?? null,
      useOfFunds: (contact.use_of_funds as string) ?? null,
      monthlyRevenue: (contact.monthly_revenue as number) ?? null,
      onedriveFolderUrl: (lastSubmission?.onedrive_folder_url as string) ?? null,
    });

    await fetch(args.responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        response_type: "ephemeral",
        text: res.ok
          ? `✅ Routing request sent to submissions@srtagency.com for ${contact.business_name}. Reply to that email with the lender names and VeKtor will build + post drafts for approval.`
          : `⚠️ Could not send routing request: ${res.error}`,
      }),
    });
  })();

  return respond(`📧 Sending routing request for ${contact.business_name} to submissions@srtagency.com...`);
}

async function handleStatus(args: { merchantQuery: string }): Promise<NextResponse> {
  if (!args.merchantQuery) return respond("Usage: `/srt status [merchant name]`");

  const { data: contact } = await supabaseAdmin
    .from("contacts")
    .select("id, business_name, first_name, last_name, email, phone, created_at")
    .ilike("business_name", `%${args.merchantQuery}%`)
    .limit(1)
    .maybeSingle();

  if (!contact) return respond(`No merchant matching "${args.merchantQuery}".`);

  const [dealRes, seqRes, submissionRes] = await Promise.all([
    supabaseAdmin.from("deals").select("stage, pipeline, amount, updated_at").eq("contact_id", contact.id).order("updated_at", { ascending: false }).limit(1).maybeSingle(),
    supabaseAdmin.from("sequence_enrollments").select("email_sequences(name), current_step, status").eq("contact_id", contact.id).eq("status", "active"),
    supabaseAdmin.from("deal_submissions").select("status, lenders(name), submitted_at, last_funder_response_at").eq("merchant_id", contact.id).order("submitted_at", { ascending: false }).limit(5),
  ]);

  const deal = dealRes.data as { stage: string; pipeline: string; amount: number; updated_at: string } | null;
  const seqs = (seqRes.data ?? []) as unknown as Array<{ email_sequences: { name: string } | null; current_step: number; status: string }>;
  const submissions = (submissionRes.data ?? []) as unknown as Array<{ status: string; lenders: { name: string } | null; submitted_at: string | null; last_funder_response_at: string | null }>;

  const lines = [
    `*${contact.business_name ?? `${contact.first_name} ${contact.last_name}`}*`,
    contact.email ? `📧 ${contact.email}` : null,
    contact.phone ? `📞 ${contact.phone}` : null,
    deal ? `*Stage:* ${deal.stage} (${deal.pipeline})  |  *Amount:* $${(deal.amount ?? 0).toLocaleString()}  |  *Updated:* ${new Date(deal.updated_at).toLocaleDateString()}` : "*No active deal.*",
    seqs.length > 0 ? `*Sequences:* ${seqs.map((s) => `${s.email_sequences?.name ?? "?"} (step ${s.current_step})`).join(", ")}` : "*No active sequences.*",
    submissions.length > 0
      ? `*Submissions:*\n${submissions.map((s) => `  • ${s.lenders?.name ?? "?"} — ${s.status}${s.submitted_at ? ` (sent ${new Date(s.submitted_at).toLocaleDateString()})` : ""}`).join("\n")}`
      : "*No submissions yet.*",
  ].filter(Boolean).join("\n");

  return respond(lines);
}

async function handleFollowups(): Promise<NextResponse> {
  const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const cutoff48h = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

  const [submissions, staleDeals] = await Promise.all([
    supabaseAdmin
      .from("deal_submissions")
      .select("id, amount_requested, submitted_at, lenders(name), contacts:merchant_id(business_name)")
      .eq("status", "pending")
      .is("last_funder_response_at", null)
      .lt("submitted_at", cutoff24h)
      .order("submitted_at", { ascending: true })
      .limit(20),
    supabaseAdmin
      .from("deals")
      .select("id, stage, amount, updated_at, contacts!inner(business_name)")
      .in("stage", ["Approved", "Pre-Approved", "Contracts Out"])
      .lt("updated_at", cutoff48h)
      .order("updated_at", { ascending: true })
      .limit(20),
  ]);

  const subs = (submissions.data ?? []) as unknown as Array<{ amount_requested: number | null; submitted_at: string; lenders: { name: string } | null; contacts: { business_name: string } | null }>;
  const stale = (staleDeals.data ?? []) as unknown as Array<{ stage: string; amount: number; updated_at: string; contacts: { business_name: string } }>;

  const subLines = subs.length === 0 ? "_No lender follow-ups due._" : subs.map((s) => {
    const hrs = Math.floor((Date.now() - new Date(s.submitted_at).getTime()) / (1000 * 60 * 60));
    return `  • ${s.contacts?.business_name ?? "?"} @ ${s.lenders?.name ?? "?"} ($${(s.amount_requested ?? 0).toLocaleString()}) — ${hrs}h silent`;
  }).join("\n");

  const staleLines = stale.length === 0 ? "_No stale approved deals._" : stale.map((d) => {
    const days = Math.floor((Date.now() - new Date(d.updated_at).getTime()) / (1000 * 60 * 60 * 24));
    return `  • ${d.contacts.business_name} — ${d.stage} ($${(d.amount ?? 0).toLocaleString()}) — ${days}d stale`;
  }).join("\n");

  return respond(`*Follow-ups due:*\n\n*Lenders silent 24h+:*\n${subLines}\n\n*Approved deals stale 48h+:*\n${staleLines}`);
}

async function handleEmails(): Promise<NextResponse> {
  const soon = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const [pending, enrollments] = await Promise.all([
    supabaseAdmin
      .from("pending_slack_actions")
      .select("id, payload, merchant_id, contacts:merchant_id(business_name)")
      .eq("action_type", "send_email")
      .eq("status", "pending")
      .limit(20),
    supabaseAdmin
      .from("sequence_enrollments")
      .select("contact_name, next_send_at, email_sequences(name), current_step")
      .eq("status", "active")
      .lt("next_send_at", soon)
      .order("next_send_at", { ascending: true })
      .limit(20),
  ]);

  const pend = (pending.data ?? []) as unknown as Array<{ payload: { subject?: string }; contacts: { business_name: string } | null }>;
  const enr = (enrollments.data ?? []) as unknown as Array<{ contact_name: string | null; next_send_at: string; email_sequences: { name: string } | null; current_step: number }>;

  const pendLines = pend.length === 0 ? "_No pending AI-drafted emails._" : pend.map((p) => `  • ${p.contacts?.business_name ?? "?"} — "${p.payload.subject ?? "(no subject)"}"`).join("\n");

  const enrLines = enr.length === 0 ? "_No sequence emails due in next 24h._" : enr.map((e) => `  • ${e.contact_name ?? "?"} — ${e.email_sequences?.name ?? "?"} step ${e.current_step + 1} @ ${new Date(e.next_send_at).toLocaleString()}`).join("\n");

  return respond(`*Emails queued:*\n\n*Pending AI approval:*\n${pendLines}\n\n*Sequence drips (24h):*\n${enrLines}`);
}

async function handleDoc(args: { arg: string }): Promise<NextResponse> {
  if (!args.arg) {
    return respond('Usage: `/srt doc "Joes Pizza" bank statement` — searches the OneDrive deal folder for a file.');
  }

  // Parse: either `"Merchant Name" query terms` or `Merchant query terms`
  let merchantQuery: string;
  let query: string;
  const quoted = args.arg.match(/^"([^"]+)"\s*(.*)$/);
  if (quoted) {
    merchantQuery = quoted[1].trim();
    query = quoted[2].trim();
  } else {
    const parts = args.arg.split(/\s+/);
    merchantQuery = parts[0];
    query = parts.slice(1).join(" ").trim();
  }

  if (!merchantQuery) return respond("Couldn't parse merchant name. Try `/srt doc \"Joes Pizza\" bank statement`.");

  const { data: contact } = await supabaseAdmin
    .from("contacts")
    .select("id, business_name")
    .ilike("business_name", `%${merchantQuery}%`)
    .limit(1)
    .maybeSingle();

  if (!contact) return respond(`No merchant matching "${merchantQuery}".`);
  const merchantName = (contact.business_name as string) ?? merchantQuery;

  const folderPath = `Deals/${merchantName}`;
  try {
    const matches = await microsoft.searchDrive(query || "statement", folderPath);
    const topFiles = matches
      .filter((m) => m.parentPath?.toLowerCase().startsWith(`/${folderPath.toLowerCase()}`) || m.parentPath?.toLowerCase().startsWith(folderPath.toLowerCase()))
      .slice(0, 5);

    if (topFiles.length === 0) {
      return respond(`No files matching "${query}" in OneDrive \`Deals/${merchantName}/\`.`);
    }

    const lines = topFiles.map((f) => `• <${f.webUrl}|${f.name}> — \`${f.parentPath ?? ""}\``).join("\n");
    return respond(`*Files in Deals/${merchantName}/:*\n${lines}`);
  } catch (e) {
    return respond(`⚠️ OneDrive search failed: ${(e as Error).message}`);
  }
}

async function handleActivity(): Promise<NextResponse> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [leadsRes, submissionsRes, callsRes, decisionsRes] = await Promise.all([
    supabaseAdmin.from("contacts").select("id", { count: "exact", head: true }).gte("created_at", since),
    supabaseAdmin.from("deal_submissions").select("id", { count: "exact", head: true }).gte("submitted_at", since),
    supabaseAdmin.from("call_log").select("id", { count: "exact", head: true }).gte("created_at", since),
    supabaseAdmin.from("ai_decisions").select("id", { count: "exact", head: true }).gte("created_at", since),
  ]);

  const text = `*Last 24h:*
  • New leads: ${leadsRes.count ?? 0}
  • Deals submitted: ${submissionsRes.count ?? 0}
  • Calls logged: ${callsRes.count ?? 0}
  • AI decisions: ${decisionsRes.count ?? 0}`;

  return respond(text);
}
