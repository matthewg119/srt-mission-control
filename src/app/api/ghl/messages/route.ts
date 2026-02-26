import { NextRequest, NextResponse } from "next/server";
import { ghlMessaging } from "@/lib/ghl-messaging";

// GET — List conversations or messages for a conversation
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const conversationId = searchParams.get("conversationId");
    const action = searchParams.get("action") || "conversations";

    if (action === "messages" && conversationId) {
      const data = await ghlMessaging.getMessages(conversationId, {
        limit: 50,
      });
      return NextResponse.json(data);
    }

    // Default: list conversations
    const data = await ghlMessaging.getConversations({
      limit: 50,
    });
    return NextResponse.json(data);
  } catch (error) {
    console.error("GHL messages GET error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch messages" },
      { status: 500 }
    );
  }
}

// POST — Send a message
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { contactId, type, message, subject } = body;

    if (!contactId || !type || !message) {
      return NextResponse.json(
        { error: "Missing required fields: contactId, type, message" },
        { status: 400 }
      );
    }

    const result = await ghlMessaging.sendMessage({
      contactId,
      type,
      message,
      subject,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("GHL messages POST error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to send message" },
      { status: 500 }
    );
  }
}
