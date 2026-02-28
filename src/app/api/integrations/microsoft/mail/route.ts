import { NextRequest, NextResponse } from "next/server";
import { microsoft } from "@/lib/microsoft";

// GET /api/integrations/microsoft/mail — Read inbox
export async function GET(request: NextRequest) {
  try {
    const top = parseInt(request.nextUrl.searchParams.get("top") || "25", 10);
    const skip = parseInt(request.nextUrl.searchParams.get("skip") || "0", 10);
    const messageId = request.nextUrl.searchParams.get("id");

    // Single message
    if (messageId) {
      const message = await microsoft.getMessage(messageId);
      return NextResponse.json(message);
    }

    // Inbox list
    const [inbox, unreadCount] = await Promise.all([
      microsoft.getInbox(top, skip),
      microsoft.getUnreadCount(),
    ]);

    return NextResponse.json({ ...inbox, unreadCount });
  } catch (error) {
    console.error("Microsoft mail GET error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch mail" },
      { status: 500 }
    );
  }
}

// POST /api/integrations/microsoft/mail — Send / Reply
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, to, subject, message, messageId, isHtml } = body;

    if (action === "reply" && messageId) {
      await microsoft.replyToMessage(messageId, message);
      return NextResponse.json({ success: true, message: "Reply sent" });
    }

    if (action === "markRead" && messageId) {
      await microsoft.markAsRead(messageId);
      return NextResponse.json({ success: true, message: "Marked as read" });
    }

    // Default: send new email
    if (!to || !subject || !message) {
      return NextResponse.json(
        { error: "to, subject, and message are required" },
        { status: 400 }
      );
    }

    await microsoft.sendMail({ to, subject, body: message, isHtml });
    return NextResponse.json({ success: true, message: "Email sent" });
  } catch (error) {
    console.error("Microsoft mail POST error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Mail operation failed" },
      { status: 500 }
    );
  }
}
