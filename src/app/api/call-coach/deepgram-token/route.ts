import { NextRequest, NextResponse } from "next/server";
import {
  validateCallCoachKey,
  extractApiKey,
} from "@/lib/call-coach-auth";

/**
 * GET /api/call-coach/deepgram-token
 *
 * Returns a single-use ElevenLabs Scribe token for the extension
 * to open a real-time transcription WebSocket. The real ElevenLabs
 * API key never leaves the server.
 *
 * (Route name kept as "deepgram-token" for backwards compatibility —
 *  the extension just calls it "get STT token".)
 */
export async function GET(request: NextRequest) {
  try {
    // Authenticate
    const apiKey = extractApiKey(request);
    if (!apiKey) {
      return NextResponse.json(
        { error: "Authorization header required" },
        { status: 401 }
      );
    }

    const user = await validateCallCoachKey(apiKey);
    if (!user) {
      return NextResponse.json(
        { error: "Invalid or inactive API key" },
        { status: 401 }
      );
    }

    // Get ElevenLabs single-use token for Scribe Realtime
    const elevenLabsKey = process.env.ELEVENLABS_API_KEY;
    if (!elevenLabsKey) {
      return NextResponse.json(
        { error: "ElevenLabs not configured" },
        { status: 503 }
      );
    }

    const response = await fetch(
      "https://api.elevenlabs.io/v1/single-use-token/realtime_scribe",
      {
        method: "POST",
        headers: {
          "xi-api-key": elevenLabsKey,
        },
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("ElevenLabs token error:", response.status, errText);
      return NextResponse.json(
        { error: "Failed to generate ElevenLabs token" },
        { status: 502 }
      );
    }

    const data = await response.json();

    return NextResponse.json({
      token: data.token,
      user: user.name,
    });
  } catch (error) {
    console.error("STT token error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to generate token",
      },
      { status: 500 }
    );
  }
}
