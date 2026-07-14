export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { checkRateLimit, getClientIp, getCorsHeaders } from "@/lib/lead-validation";
import { slack } from "@/lib/slack-bot";
import { systemAlert } from "@/lib/notify";

// Newsletter signups are contacts-only: no deal, no sequences, no CAPI,
// no speed-to-lead. Repeat subscribes are idempotent (200, tag union).

const EMAIL_REGEX = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length < 6 || email.length > 254) return null;
  if (!EMAIL_REGEX.test(email)) return null;
  const [local, domain] = email.split("@");
  if (email.includes("..")) return null;
  if (local.startsWith(".") || local.endsWith(".")) return null;
  if (domain.startsWith(".") || domain.startsWith("-")) return null;
  return email;
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: getCorsHeaders(request) });
}

export async function POST(request: NextRequest) {
  const corsHeaders = getCorsHeaders(request);
  const clientIp = getClientIp(request);

  try {
    if (!checkRateLimit(clientIp)) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429, headers: corsHeaders }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { email: rawEmail, website, sourceUrl } = body || {};

    // Honeypot: pretend success so bots don't adapt
    if (website) {
      return NextResponse.json({ success: true }, { headers: corsHeaders });
    }

    const email = normalizeEmail(rawEmail);
    if (!email) {
      return NextResponse.json(
        { error: "Invalid email" },
        { status: 400, headers: corsHeaders }
      );
    }

    let isNew = false;
    const { data: existing } = await supabaseAdmin
      .from("contacts")
      .select("id, tags")
      .eq("email", email)
      .maybeSingle();

    if (existing) {
      const tags: string[] = Array.isArray(existing.tags) ? existing.tags : [];
      if (!tags.includes("newsletter")) {
        await supabaseAdmin
          .from("contacts")
          .update({
            tags: [...tags, "newsletter"],
            updated_at: new Date().toISOString(),
          })
          .eq("id", existing.id);
      }
    } else {
      isNew = true;
      const { error: insertErr } = await supabaseAdmin.from("contacts").insert({
        first_name: "",
        last_name: "",
        email,
        source: "Newsletter Signup",
        tags: ["newsletter"],
      });
      if (insertErr) throw new Error(insertErr.message);
    }

    try {
      await supabaseAdmin.from("system_logs").insert({
        event_type: "newsletter_subscribe",
        description: `Newsletter signup: ${email}${isNew ? "" : " (existing contact)"}`,
        metadata: { email, sourceUrl: sourceUrl || null, clientIp, isNew },
      });
    } catch {
      /* best-effort */
    }

    const hotLeadsChannel = process.env.SLACK_HOT_LEADS_CHANNEL || "";
    const slackText = `:email: *New newsletter subscriber:* ${email}${sourceUrl ? ` (from ${sourceUrl})` : ""}`;
    if (hotLeadsChannel) {
      slack.postMessage(hotLeadsChannel, slackText).catch(() => {});
    } else {
      systemAlert("Newsletter Signup", slackText, "newsletter/subscribe", "info").catch(() => {});
    }

    return NextResponse.json({ success: true }, { headers: corsHeaders });
  } catch (error) {
    console.error("Newsletter subscribe error:", error);
    return NextResponse.json(
      { error: "Subscribe failed" },
      { status: 500, headers: corsHeaders }
    );
  }
}
