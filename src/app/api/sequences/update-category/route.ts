export const dynamic = "force-dynamic";

// POST /api/sequences/update-category
// Called by Slack button actions on enrollment confirmation cards.
// Updates the category field on an active enrollment.
//
// Body: { enrollment_id, category }

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { VEKTOR_CHANNELS } from "@/config/vektor";

const VALID_CATEGORIES = ["mca", "sba", "loc", "cre"] as const;
type Category = (typeof VALID_CATEGORIES)[number];

const CATEGORY_LABELS: Record<Category, string> = {
  mca: "💳 MCA",
  sba: "🏛 SBA",
  loc: "💰 Line of Credit",
  cre: "🏢 Commercial RE",
};

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    enrollment_id?: string;
    category?: string;
    // Slack interactive payload fields (if called directly from Slack action handler)
    slack_ts?: string;
    channel?: string;
  };

  const { enrollment_id, category } = body;

  if (!enrollment_id || !category) {
    return NextResponse.json({ error: "enrollment_id and category are required" }, { status: 400 });
  }

  if (!VALID_CATEGORIES.includes(category as Category)) {
    return NextResponse.json(
      { error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}` },
      { status: 400 }
    );
  }

  const { data: enrollment, error } = await supabaseAdmin
    .from("sequence_enrollments")
    .update({ category })
    .eq("id", enrollment_id)
    .eq("status", "active")
    .select("id, contact_name, category")
    .single();

  if (error || !enrollment) {
    return NextResponse.json(
      { error: error?.message ?? "Enrollment not found or not active" },
      { status: 404 }
    );
  }

  const catLabel = CATEGORY_LABELS[category as Category];
  const channel = VEKTOR_CHANNELS.emailDirector || VEKTOR_CHANNELS.main;
  if (channel) {
    await slack.postMessage(
      channel,
      `✅ Category updated: *${enrollment.contact_name ?? "Contact"}* → ${catLabel}`
    );
  }

  return NextResponse.json({ ok: true, enrollment_id, category });
}
