import { NextResponse } from "next/server";
import { getAuthUrl } from "@/lib/microsoft";

export async function GET() {
  // Validate required env vars before redirecting
  if (!process.env.MICROSOFT_CLIENT_ID || !process.env.MICROSOFT_CLIENT_SECRET) {
    const dashboardUrl =
      (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000") +
      "/dashboard/integrations";
    return NextResponse.redirect(
      `${dashboardUrl}?ms_error=${encodeURIComponent(
        "Microsoft 365 is not configured. Set MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET in environment variables."
      )}`
    );
  }

  const url = getAuthUrl();
  console.log("[Microsoft OAuth] Redirecting to auth URL, redirect_uri:",
    (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000") + "/api/integrations/microsoft/callback"
  );
  return NextResponse.redirect(url);
}
