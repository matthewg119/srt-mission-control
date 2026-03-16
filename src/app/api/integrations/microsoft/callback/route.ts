import { NextRequest, NextResponse } from "next/server";
import { exchangeCodeForTokens } from "@/lib/microsoft";
import { supabaseAdmin } from "@/lib/db";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");
  console.log("[Microsoft OAuth] Callback received, code:", code ? "present" : "missing", "error:", error || "none");

  const dashboardUrl =
    (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000") +
    "/dashboard/integrations";

  if (error || !code) {
    console.error("Microsoft OAuth error:", error);
    return NextResponse.redirect(
      `${dashboardUrl}?ms_error=${encodeURIComponent(error || "No code returned")}`
    );
  }

  try {
    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code);

    const now = Math.floor(Date.now() / 1000);

    // Get user profile to store email
    const profileRes = await fetch("https://graph.microsoft.com/v1.0/me", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = profileRes.ok ? await profileRes.json() : {};

    // Upsert into integrations table
    const { data: existing } = await supabaseAdmin
      .from("integrations")
      .select("id")
      .eq("name", "Microsoft 365")
      .single();

    const config = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: String(now + tokens.expires_in),
      email: profile.mail || profile.userPrincipalName || "",
      display_name: profile.displayName || "",
    };

    if (existing) {
      await supabaseAdmin
        .from("integrations")
        .update({
          status: "connected",
          config,
          last_sync: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", existing.id);
    } else {
      await supabaseAdmin.from("integrations").insert({
        name: "Microsoft 365",
        type: "Email",
        status: "connected",
        config,
        last_sync: new Date().toISOString(),
      });
    }

    // Log the connection
    await supabaseAdmin.from("system_logs").insert({
      event_type: "integration_connected",
      description: `Microsoft 365 connected: ${config.email || "unknown email"}`,
      metadata: { email: config.email, displayName: config.display_name },
    });

    return NextResponse.redirect(`${dashboardUrl}?ms_connected=true`);
  } catch (err) {
    console.error("Microsoft OAuth callback error:", err);
    return NextResponse.redirect(
      `${dashboardUrl}?ms_error=${encodeURIComponent(err instanceof Error ? err.message : "OAuth failed")}`
    );
  }
}
