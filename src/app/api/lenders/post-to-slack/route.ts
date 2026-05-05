import { NextRequest, NextResponse } from "next/server";
import { slack, type SlackBlock } from "@/lib/slack-bot";

const SRT_SUB_CHANNEL = "C0AJXH7PTBM";

interface DealSummary {
  business: string | null;
  amount: number;
  credit_score: number | null;
  monthly_revenue: number | null;
  tib_months: number | null;
  position: string;
  industry: string | null;
  use_of_funds: string | null;
}

interface LenderMatch {
  lender_id: string;
  name: string;
  tier_label: string;
  match_score: number;
  reasons: string[];
  warnings: string[];
  factor_rate_used: number;
  payback_amount: number;
  term_months: number;
  daily_payment: number;
  weekly_payment: number;
  submission_email: string | null;
  rep_name: string | null;
}

function fmt(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export async function POST(req: NextRequest) {
  try {
    const { deal_summary, top3, channel } = await req.json() as {
      deal_summary: DealSummary;
      top3: LenderMatch[];
      channel?: string;
    };

    const targetChannel = channel ?? SRT_SUB_CHANNEL;
    const ds = deal_summary;

    const headerLines = [
      ds.business ? `*${ds.business}*` : "*New Deal Routing Request*",
      ds.amount ? `Amount: $${fmt(ds.amount)}` : null,
      ds.credit_score ? `Credit: ${ds.credit_score}` : null,
      ds.monthly_revenue ? `Revenue: $${fmt(ds.monthly_revenue)}/mo` : null,
      ds.tib_months ? `TIB: ${ds.tib_months} months` : null,
      ds.position ? `Position: ${ds.position}` : null,
      ds.industry ? `Industry: ${ds.industry}` : null,
      ds.use_of_funds ? `Use of funds: ${ds.use_of_funds}` : null,
    ].filter(Boolean).join("\n");

    const blocks: SlackBlock[] = [
      {
        type: "section",
        text: { type: "mrkdwn", text: `:moneybag: *Vektor Deal Routing — Top 3 Suggestions*\n\n${headerLines}` },
      },
      { type: "divider" },
    ];

    top3.forEach((l, i) => {
      const medal = i === 0 ? ":first_place_medal:" : i === 1 ? ":second_place_medal:" : ":third_place_medal:";
      const calcLines = ds.amount
        ? [
            `Factor: *${l.factor_rate_used}×*  →  Payback: *$${fmt(l.payback_amount)}*`,
            `Term: ~${l.term_months} months  |  Daily: *$${fmt(l.daily_payment)}*  |  Weekly: *$${fmt(l.weekly_payment)}*`,
          ]
        : [];
      const reasonText = l.reasons.map((r) => `• ${r}`).join("\n");
      const warnText = l.warnings.length > 0 ? `\n:warning: ${l.warnings.join(" | ")}` : "";

      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: [
            `${medal} *${i + 1}. ${l.name}*  \`${l.tier_label}\`  — *${l.match_score}% match*`,
            reasonText,
            ...calcLines,
            l.submission_email ? `Submit: \`${l.submission_email}\`` : "",
            l.rep_name ? `Rep: ${l.rep_name}` : "",
            warnText,
          ].filter(Boolean).join("\n"),
        },
      });

      if (i < top3.length - 1) blocks.push({ type: "divider" });
    });

    blocks.push(
      { type: "divider" },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: "React :white_check_mark: to approve & submit all three, or reply with lender names to send to specific ones.",
        },
      }
    );

    await slack.postMessage(targetChannel, `:moneybag: Vektor Deal Routing — ${ds.business ?? "New Deal"}`, blocks);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[post-to-slack]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Slack post failed" }, { status: 500 });
  }
}
