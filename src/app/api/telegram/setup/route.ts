import { NextRequest, NextResponse } from "next/server";
import { telegram } from "@/lib/telegram";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!telegram.isConfigured()) {
    return NextResponse.json(
      { error: "TELEGRAM_BOT_TOKEN not configured" },
      { status: 503 }
    );
  }

  // Use the app URL from env, or derive from request
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    `${request.nextUrl.protocol}//${request.nextUrl.host}`;
  const webhookUrl = `${appUrl}/api/telegram/webhook`;

  try {
    // Verify bot is valid
    const me = await telegram.getMe();

    // Register webhook
    const result = await telegram.setWebhook(webhookUrl);

    return NextResponse.json({
      success: true,
      bot: me,
      webhook: { url: webhookUrl, result },
      message: `Webhook registered! Your bot is now connected to Mission Control. Text it on Telegram to test.`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Setup failed" },
      { status: 500 }
    );
  }
}
