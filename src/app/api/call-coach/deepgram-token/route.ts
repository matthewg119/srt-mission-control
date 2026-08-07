export const dynamic = "force-dynamic";
/**
 * ‼️ LOAD-BEARING, and the same trap as the /scan routes.
 *
 * `dynamic = "force-dynamic"` governs the ROUTE cache. It does NOT cover the DATA cache, and Next
 * patches the global `fetch` this route uses to mint the ElevenLabs token. Without this the token
 * request is served from that cache and EVERY caller gets the SAME `sutkn_...` string back.
 *
 * ElevenLabs realtime tokens are SINGLE USE, so a cached one is worse than a stale read: the first
 * caller spends it, and every connection after that is closed with
 * `{"message_type":"auth_error","error":"You must be authenticated to use this endpoint."}`.
 * The extension surfaces that as "Auth rejected by ElevenLabs" with a live call already dialed, and
 * nothing about it points at a cache. Symptom to recognise: the route returns 200 with a valid-
 * looking token and `X-Vercel-Cache: BYPASS`, but four calls in a row return an identical token.
 */
export const fetchCache = "force-no-store";
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
        // Belt and braces with `fetchCache` above. A minted single-use token is the one kind of
        // response that must never be reused, so it says so at the call site too.
        cache: "no-store",
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("ElevenLabs token error:", response.status, errText);
      // The upstream status rides along. It is the difference between "the key is wrong" (401),
      // "out of credits" (429) and "ElevenLabs is down" (5xx), and without it the extension shows
      // one opaque "Token server error (502)" for all three while the phone is ringing.
      return NextResponse.json(
        { error: `Failed to generate ElevenLabs token (upstream ${response.status})` },
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
