// One-time catch-up crawler for submissions@srtagency.com.
//
// Walks the last N days of inbox history, groups messages by conversation,
// classifies the newest inbound per thread, matches to a Supabase contact,
// and posts per-deal Slack approval cards in #Vektor-deals-Matt. Human 👍 applies
// the proposed Zoho Lead update via the existing approval pipeline.
//
// Usage:
//   bun run scripts/backfill-submissions-inbox.ts --dry-run
//   bun run scripts/backfill-submissions-inbox.ts --since=2026-01-21
//   bun run scripts/backfill-submissions-inbox.ts --limit=5 --conversation=<id>
//   bun run scripts/backfill-submissions-inbox.ts                    # full run
//
// Loads .env.local automatically when run via bun.

import { supabaseAdmin } from "../src/lib/db";
import { microsoft, type GraphMessage } from "../src/lib/microsoft";
import { slack } from "../src/lib/slack-bot";
import {
  classifyInboundEmail,
  findContactByBusinessName,
  type InboundClassification,
  type InboundIntent,
} from "../src/lib/ai-intel/inbound-classifier";
import { postApprovalRequest } from "../src/lib/ai-intel/slack-approval";
import { searchLeads } from "../src/lib/zoho";
import type { PendingActionPayload } from "../src/lib/ai-intel/types";

const MAILBOX = "submissions@srtagency.com";
const DEFAULT_SINCE_DAYS = 90;
const TERMINAL_STATUSES = new Set(["Funded", "Dead", "Closed Lost"]);

interface Args {
  dryRun: boolean;
  limit?: number;
  since?: string;             // ISO date, e.g. 2026-01-21
  conversation?: string;      // restrict to a single conversationId
}

function parseArgs(): Args {
  const out: Args = { dryRun: false };
  for (const a of process.argv.slice(2)) {
    if (a === "--dry-run" || a === "--dry") out.dryRun = true;
    else if (a.startsWith("--limit=")) out.limit = parseInt(a.split("=")[1], 10);
    else if (a.startsWith("--since=")) out.since = a.split("=")[1];
    else if (a.startsWith("--conversation=")) out.conversation = a.split("=")[1];
  }
  return out;
}

function defaultSinceISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - DEFAULT_SINCE_DAYS);
  return d.toISOString();
}

function isAutoReplySubject(subject: string): boolean {
  return /^(automatic reply|out of office|auto-?reply|undeliverable|delivery has failed)/i.test(subject ?? "");
}

function isAutoReplyHeaders(headers: Array<{ name: string; value: string }>): boolean {
  return headers.some((h) => {
    const n = h.name.toLowerCase();
    if (n === "auto-submitted" && /auto-replied|auto-generated/i.test(h.value)) return true;
    if (n === "x-autoreply" || n === "x-autorespond") return true;
    return false;
  });
}

function normalizeStage(intent: InboundIntent): string | null {
  switch (intent) {
    case "approved":        return "Approved";
    case "declined":        return "Declined";
    case "stips_needed":    return "Stips Pending";
    case "counter_offer":   return "Counter Offered";
    case "missing_fields":  return null;
    default:                return null;
  }
}

function buildZohoFields(c: InboundClassification): Record<string, unknown> {
  const f: Record<string, unknown> = {};
  if (c.intent === "approved" || c.intent === "counter_offer") {
    if (c.approved_amount != null) f.Approved_Amount = c.approved_amount;
    if (c.buy_rate != null) f.Factor_Rate = c.buy_rate;
    if (c.term != null) f.Term_Months = c.term;
  }
  if (c.intent === "declined" && c.declined_reason) {
    f.Decline_Reason = c.declined_reason;
  }
  if (c.intent === "stips_needed" && c.stips_required.length) {
    f.Stips_Required = c.stips_required.join("; ");
  }
  return f;
}

function buildNote(c: InboundClassification, fromAddress: string, receivedDateTime: string): { title: string; content: string } {
  const when = receivedDateTime.slice(0, 10);
  const from = fromAddress;
  let body = "";
  switch (c.intent) {
    case "approved":
      body = `APPROVED by ${from} on ${when}. $${c.approved_amount ?? "?"} @ buy ${c.buy_rate ?? "?"}/sell ${c.sell_rate ?? "?"}, term ${c.term ?? "?"}. ${c.summary}`;
      break;
    case "declined":
      body = `DECLINED by ${from} on ${when}. Reason: ${c.declined_reason ?? "not stated"}. ${c.summary}`;
      break;
    case "stips_needed":
      body = `STIPS from ${from} on ${when}:\n- ${c.stips_required.join("\n- ")}\n${c.summary}`;
      break;
    case "counter_offer":
      body = `COUNTER from ${from} on ${when}. $${c.approved_amount ?? "?"} @ buy ${c.buy_rate ?? "?"} / sell ${c.sell_rate ?? "?"}, term ${c.term ?? "?"}. ${c.summary}`;
      break;
    case "missing_fields":
      body = `Funder ${from} needs: ${c.missing_fields.join(", ")}. ${c.summary}`;
      break;
    default:
      body = c.summary;
  }
  return { title: `Backfill: ${c.intent}`, content: body };
}

interface ThreadCandidate {
  msg: GraphMessage;
  fromAddress: string;
  fromDomain: string | null;
}

async function fetchCandidates(since: string, conversationFilter?: string, limit?: number): Promise<ThreadCandidate[]> {
  const filter = `receivedDateTime ge ${since} and isDraft eq false`;
  const byConvo = new Map<string, GraphMessage>();
  let scanned = 0;

  for await (const msg of microsoft.listMessages({ mailbox: MAILBOX, folder: "inbox", filter, top: 100 })) {
    scanned++;
    if (scanned % 100 === 0) process.stdout.write(`  scanned ${scanned}...\n`);

    if (conversationFilter && msg.conversationId !== conversationFilter) continue;

    const fromAddress = msg.from?.emailAddress?.address ?? "";
    if (!fromAddress) continue;
    if (fromAddress.toLowerCase().endsWith("@srtagency.com")) continue; // outbound copy

    const existing = byConvo.get(msg.conversationId);
    if (!existing || new Date(msg.receivedDateTime) > new Date(existing.receivedDateTime)) {
      byConvo.set(msg.conversationId, msg);
    }
  }

  console.log(`  scanned ${scanned} messages, ${byConvo.size} unique conversations`);

  const candidates = [...byConvo.values()]
    .filter((m) => !isAutoReplySubject(m.subject ?? ""))
    .map((m) => {
      const fromAddress = m.from.emailAddress.address;
      const fromDomain = fromAddress.split("@")[1]?.toLowerCase() ?? null;
      return { msg: m, fromAddress, fromDomain };
    });

  return typeof limit === "number" ? candidates.slice(0, limit) : candidates;
}

interface DealProposal {
  zohoLeadId: string;
  businessName: string | null;
  contactId: string;
  classification: InboundClassification;
  msg: GraphMessage;
  fromAddress: string;
  aiDecisionId: string | null;
  zohoFields: Record<string, unknown>;
  proposedStage: string | null;
  note: { title: string; content: string };
  currentStage: string | null;
}

async function main() {
  const args = parseArgs();
  const since = args.since ? new Date(args.since).toISOString() : defaultSinceISO();

  console.log("VeKtor Inbox Backfill");
  console.log("─────────────────────");
  console.log(`Mailbox:      ${MAILBOX}`);
  console.log(`Since:        ${since}`);
  console.log(`Dry run:      ${args.dryRun}`);
  if (args.limit) console.log(`Limit:        ${args.limit}`);
  if (args.conversation) console.log(`Conversation: ${args.conversation}`);
  console.log("");

  const approvalChannel = process.env.SLACK_VEKTOR_DEALS_CHANNEL;
  if (!approvalChannel && !args.dryRun) {
    console.error("SLACK_VEKTOR_DEALS_CHANNEL is not set. Refusing to post approval cards. Run with --dry-run to continue.");
    process.exit(1);
  }

  console.log("Step 1/6: fetching inbox pages…");
  const candidates = await fetchCandidates(since, args.conversation, args.limit);
  console.log(`  ${candidates.length} candidate threads after auto-reply filter\n`);

  console.log("Step 2/6: fetching bodies, classifying, matching…");
  const proposals: DealProposal[] = [];
  const orphans: Array<{ business: string | null; from: string; subject: string; intent: InboundIntent }> = [];
  const skipped: Array<{ reason: string; subject: string; from: string }> = [];

  for (let i = 0; i < candidates.length; i++) {
    const { msg, fromAddress } = candidates[i];
    process.stdout.write(`  [${i + 1}/${candidates.length}] ${fromAddress.padEnd(40).slice(0, 40)} `);

    let body: { body: string; conversationId: string; internetMessageHeaders: Array<{ name: string; value: string }> };
    try {
      body = await microsoft.getMessageBody(msg.id, MAILBOX);
    } catch (e) {
      console.log(`body-fetch-error: ${(e as Error).message}`);
      skipped.push({ reason: "body_fetch_error", subject: msg.subject, from: fromAddress });
      continue;
    }

    if (isAutoReplyHeaders(body.internetMessageHeaders)) {
      console.log("auto-reply (headers)");
      skipped.push({ reason: "auto_reply_header", subject: msg.subject, from: fromAddress });
      continue;
    }

    const { classification, tokens, latencyMs } = await classifyInboundEmail({
      subject: msg.subject,
      from: fromAddress,
      body: body.body,
    });

    if (classification.intent === "other") {
      console.log("other");
      skipped.push({ reason: "intent_other", subject: msg.subject, from: fromAddress });
      continue;
    }

    const contact = await findContactByBusinessName(classification.business_name);
    if (!contact || !contact.zoho_lead_id) {
      console.log(`orphan (${classification.intent})`);
      orphans.push({
        business: classification.business_name,
        from: fromAddress,
        subject: msg.subject,
        intent: classification.intent,
      });
      if (!args.dryRun) {
        await supabaseAdmin.from("ai_decisions").insert({
          merchant_id: contact?.id ?? null,
          zoho_id: contact?.zoho_lead_id ?? null,
          trigger_type: "inbound_email",
          state_classified: classification.intent,
          action_taken: "backfill_orphan",
          was_approved: null,
          reasoning: classification.summary,
          raw_response: { classification, tokens, message_id: msg.id, from: fromAddress, backfill: true },
          model_used: "claude-haiku-4-5-20251001",
          latency_ms: latencyMs,
        });
      }
      continue;
    }

    // Zoho freshness check.
    let currentStage: string | null = null;
    try {
      const leads = await searchLeads({ criteria: `(id:equals:${contact.zoho_lead_id})` });
      currentStage = (leads[0]?.Lead_Status as string | undefined) ?? null;
    } catch {
      // Zoho search failures are non-fatal — still worth surfacing the card.
    }
    if (currentStage && TERMINAL_STATUSES.has(currentStage)) {
      console.log(`skip (stage=${currentStage})`);
      skipped.push({ reason: `stale_stage_${currentStage}`, subject: msg.subject, from: fromAddress });
      continue;
    }

    // Idempotency: same message + lead + intent already queued?
    const { data: existingPending } = await supabaseAdmin
      .from("pending_slack_actions")
      .select("id, status")
      .eq("zoho_id", contact.zoho_lead_id)
      .eq("payload->>backfill_message_id", msg.id)
      .maybeSingle();
    if (existingPending) {
      console.log(`already-queued (${existingPending.status})`);
      skipped.push({ reason: "already_queued", subject: msg.subject, from: fromAddress });
      continue;
    }

    const ai = args.dryRun
      ? { id: null as string | null }
      : (
          await supabaseAdmin
            .from("ai_decisions")
            .insert({
              merchant_id: contact.id,
              zoho_id: contact.zoho_lead_id,
              trigger_type: "inbound_email",
              state_classified: classification.intent,
              action_taken: "backfill_proposed",
              was_approved: null,
              reasoning: classification.summary,
              raw_response: { classification, tokens, message_id: msg.id, from: fromAddress, backfill: true },
              model_used: "claude-haiku-4-5-20251001",
              latency_ms: latencyMs,
            })
            .select("id")
            .single()
        ).data ?? { id: null };

    proposals.push({
      zohoLeadId: contact.zoho_lead_id,
      businessName: contact.business_name,
      contactId: contact.id,
      classification,
      msg,
      fromAddress,
      aiDecisionId: (ai?.id as string | undefined) ?? null,
      zohoFields: buildZohoFields(classification),
      proposedStage: normalizeStage(classification.intent),
      note: buildNote(classification, fromAddress, msg.receivedDateTime),
      currentStage,
    });
    console.log(`queued (${classification.intent})`);
  }

  // Merge multiple proposals for the same lead — keep the highest-priority intent,
  // append older ones into the note so no context is lost.
  const PRIORITY: Record<InboundIntent, number> = {
    approved: 5,
    counter_offer: 4,
    declined: 3,
    stips_needed: 2,
    missing_fields: 1,
    other: 0,
  };
  const merged = new Map<string, DealProposal>();
  for (const p of proposals) {
    const existing = merged.get(p.zohoLeadId);
    if (!existing) {
      merged.set(p.zohoLeadId, p);
      continue;
    }
    const [winner, loser] = PRIORITY[p.classification.intent] > PRIORITY[existing.classification.intent]
      ? [p, existing]
      : [existing, p];
    winner.note = {
      title: winner.note.title,
      content: `${winner.note.content}\n\n— Older thread (${loser.classification.intent}): ${loser.note.content}`,
    };
    merged.set(p.zohoLeadId, winner);
  }
  const finalProposals = [...merged.values()];

  console.log(`\nSummary: ${finalProposals.length} approval cards, ${orphans.length} orphans, ${skipped.length} skipped.\n`);

  if (args.dryRun) {
    console.log("── Proposed updates (dry run) ──");
    for (const p of finalProposals) {
      console.log(`\n• ${p.businessName} (zoho=${p.zohoLeadId})`);
      console.log(`  stage: ${p.currentStage ?? "?"} → ${p.proposedStage ?? "(unchanged)"}`);
      console.log(`  fields: ${JSON.stringify(p.zohoFields)}`);
      console.log(`  note: ${p.note.content.slice(0, 160)}…`);
    }
    console.log(`\n── Orphans (${orphans.length}) ──`);
    for (const o of orphans) console.log(`  ${o.business ?? "(no match)"} — ${o.from} — ${o.subject}`);
    console.log(`\n── Skipped (${skipped.length}) ──`);
    const reasonCounts: Record<string, number> = {};
    for (const s of skipped) reasonCounts[s.reason] = (reasonCounts[s.reason] ?? 0) + 1;
    for (const [r, n] of Object.entries(reasonCounts)) console.log(`  ${r}: ${n}`);
    console.log("\nDry run complete. No Slack posts, no Zoho writes, no pending_slack_actions created.");
    return;
  }

  console.log("Step 3/6: posting parent summary to Slack…");
  const parentText = `:mailbox: *VeKtor inbox backfill* — ${finalProposals.length} deals / ${orphans.length} orphans / ${skipped.length} skipped\nMailbox: ${MAILBOX} · Since: ${since.slice(0, 10)} · Each card below is independent — :+1: to apply.`;
  const parentResp = (await slack.postMessage(approvalChannel!, parentText)) as { ok: boolean; ts?: string };
  if (!parentResp.ok || !parentResp.ts) {
    console.error("Failed to post parent summary. Aborting.");
    process.exit(1);
  }
  const parentTs = parentResp.ts;

  console.log(`Step 4/6: posting ${finalProposals.length} approval cards as thread replies…`);
  let posted = 0;
  for (const p of finalProposals) {
    const payload: PendingActionPayload = {
      action_type: "update_zoho",
      zoho_id: p.zohoLeadId,
      stage: p.proposedStage ?? undefined,
      zoho_fields: p.zohoFields,
      note: p.note,
      backfill_message_id: p.msg.id,
      backfill_conversation_id: p.msg.conversationId,
    };

    const blocks = buildCardBlocks(p);

    const result = await postApprovalRequest({
      summary: `${p.classification.intent.toUpperCase()} — ${p.businessName ?? "(no name)"}`,
      payload,
      merchantId: p.contactId,
      zohoId: p.zohoLeadId,
      aiDecisionId: p.aiDecisionId ?? undefined,
      channel: approvalChannel,
      threadTs: parentTs,
      blocks,
    });

    if (result.pendingActionId) posted++;
    else console.error(`  failed to post card for ${p.businessName}: ${result.skipped}`);
  }
  console.log(`  ${posted}/${finalProposals.length} cards posted`);

  console.log("Step 5/6: posting orphans digest…");
  if (orphans.length > 0) {
    const shown = orphans.slice(0, 25);
    const overflow = orphans.length - shown.length;
    const lines = shown.map((o) => `• *${o.business ?? "(no business)"}* — ${o.intent} — ${o.from} — _${o.subject.slice(0, 80)}_`);
    const digest = `:ghost: *${orphans.length} orphan email(s)* — no Supabase contact match\n${lines.join("\n")}${overflow > 0 ? `\n…and ${overflow} more (see ai_decisions table with action_taken='backfill_orphan')` : ""}`;
    await slack.postThreadReply(approvalChannel!, parentTs, digest);
  }

  console.log("Step 6/6: done.");
  console.log(`\nApproval cards: ${posted} in #${approvalChannel}  (ts ${parentTs})`);
  console.log("👍 each card in Slack to apply to Zoho. Re-running this script is safe — already-queued cards will be skipped.");
}

function buildCardBlocks(p: DealProposal): unknown[] {
  const c = p.classification;
  const fieldLines = [
    p.proposedStage ? `• \`Lead_Status\` → *${p.proposedStage}*${p.currentStage ? ` _(was ${p.currentStage})_` : ""}` : null,
    ...Object.entries(p.zohoFields).map(([k, v]) => `• \`${k}\` → ${typeof v === "number" ? v.toLocaleString() : String(v)}`),
  ].filter(Boolean);

  return [
    { type: "header", text: { type: "plain_text", text: `:mailbox: ${p.businessName ?? "(no name)"}`, emoji: true } },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Intent:* \`${c.intent}\`  |  *From:* ${p.fromAddress}  |  *Received:* ${p.msg.receivedDateTime.slice(0, 10)}`,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Proposed Zoho changes:*\n${fieldLines.join("\n") || "_(note only)_"}\n\n*Note to add:*\n> ${p.note.content.slice(0, 500)}`,
      },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `> ${c.summary}\n${p.msg.webLink ? `<${p.msg.webLink}|Open email in Outlook>` : ""}` },
    },
    {
      type: "actions",
      elements: [
        { type: "button", text: { type: "plain_text", text: ":thumbsup: Approve" }, style: "primary", action_id: "ai_approve", value: "pending" },
        { type: "button", text: { type: "plain_text", text: ":pencil2: Edit" }, action_id: "ai_edit", value: "pending" },
        { type: "button", text: { type: "plain_text", text: ":no_entry: Skip" }, style: "danger", action_id: "ai_cancel", value: "pending" },
      ],
    },
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: `msg \`${p.msg.id.slice(0, 10)}\` · convo \`${p.msg.conversationId.slice(0, 10)}\` · decision \`${p.aiDecisionId ?? "?"}\`` },
      ],
    },
  ];
}

main().catch((e) => {
  console.error("\nFatal error:", e);
  process.exit(1);
});
