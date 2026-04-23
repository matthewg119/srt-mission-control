// Pre-Approved stage handler — fires when a deal's Zoho stage flips to
// "Pre-Approved". Two gates:
//   1. Count PDFs in Deals/{business_name}/Bank Statements. If <3, send an
//      urgent Slack DM to Matthew and STOP — don't create the channel yet.
//   2. If ≥3, ensure a dedicated per-deal Slack channel exists.
//
// Idempotent: guarded by deals.slack_deal_channel_id so repeated Pre-Approved
// events won't create duplicate channels.

import { supabaseAdmin } from "@/lib/db";
import { microsoft } from "@/lib/microsoft";
import { slack } from "@/lib/slack-bot";
import { ensureDealChannel } from "./deal-channel";

const REQUIRED_BANK_STMTS = 3;

export interface PreApprovedResult {
  dealId: string;
  bankStmtCount: number;
  channelCreated: boolean;
  channelId: string | null;
  channelName: string | null;
  gated: boolean;
  gateReason?: string;
}

export async function onPreApproved(dealId: string): Promise<PreApprovedResult> {
  const { data: deal } = await supabaseAdmin
    .from("deals")
    .select("id, amount, slack_deal_channel_id, contacts:contact_id(business_name, zoho_lead_id, first_name, last_name)")
    .eq("id", dealId)
    .maybeSingle();

  if (!deal) {
    return { dealId, bankStmtCount: 0, channelCreated: false, channelId: null, channelName: null, gated: true, gateReason: "deal_not_found" };
  }

  const contact = (deal as unknown as { contacts: { business_name: string | null; zoho_lead_id: string | null; first_name: string | null; last_name: string | null } | null }).contacts;
  const businessName = contact?.business_name ?? `${contact?.first_name ?? ""} ${contact?.last_name ?? ""}`.trim() ?? "Unknown";

  const bankStmtCount = await countBankStatements(businessName);

  if (bankStmtCount < REQUIRED_BANK_STMTS) {
    await pingMatthewForStatements({
      dealId,
      businessName,
      zohoLeadId: contact?.zoho_lead_id ?? null,
      found: bankStmtCount,
      required: REQUIRED_BANK_STMTS,
    });
    return {
      dealId,
      bankStmtCount,
      channelCreated: false,
      channelId: null,
      channelName: null,
      gated: true,
      gateReason: `bank_stmts_insufficient:${bankStmtCount}/${REQUIRED_BANK_STMTS}`,
    };
  }

  // ≥3 bank statements — proceed to create the deal channel.
  const result = await ensureDealChannel(dealId);
  return {
    dealId,
    bankStmtCount,
    channelCreated: result.created,
    channelId: result.channelId,
    channelName: result.channelName,
    gated: false,
  };
}

async function countBankStatements(businessName: string): Promise<number> {
  const folderPath = `Deals/${businessName}/Bank Statements`;
  try {
    const children = await microsoft.listFolderChildren(folderPath);
    return children.filter((c) => c.isFile && /\.pdf$/i.test(c.name)).length;
  } catch (e) {
    console.warn("[pre-approved] bank-stmt count failed:", (e as Error).message);
    return 0;
  }
}

async function pingMatthewForStatements(opts: {
  dealId: string;
  businessName: string;
  zohoLeadId: string | null;
  found: number;
  required: number;
}): Promise<void> {
  const matthewDM = process.env.SLACK_VEKTOR_MATTHEW_DM || "";
  const fallbackChannel = process.env.SLACK_VEKTOR_DEALS_CHANNEL || process.env.SLACK_HOT_LEADS_CHANNEL || "";
  const channel = matthewDM || fallbackChannel;

  if (!channel) {
    console.warn("[pre-approved] no channel to warn about missing bank stmts");
    return;
  }

  const zohoLink = opts.zohoLeadId
    ? `<https://crm.zoho.com/crm/org/_/tab/Leads/${opts.zohoLeadId}|Open in Zoho>`
    : "";
  const mcLink = `<https://mission.srtagency.com/dashboard/deals/${opts.dealId}|Open in Mission Control>`;

  const text = `🚨 *Pre-Approved but missing bank statements* — ${opts.businessName}\nFound *${opts.found}* PDFs in \`Deals/${opts.businessName}/Bank Statements\`, need *${opts.required}*.\nRequest them from the merchant before we can open the deal channel.\n${zohoLink} • ${mcLink}`;

  await slack.postMessage(channel, text);
}
