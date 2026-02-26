export const runtime = "edge";

import { NextRequest, NextResponse } from "next/server";
import { isAIConfigured, buildSystemPrompt, streamChatResponse } from "@/lib/ai";

export async function POST(request: NextRequest) {
  try {
    if (!isAIConfigured()) {
      return NextResponse.json(
        {
          error: "AI_NOT_CONFIGURED",
          message:
            "Anthropic API key not configured. Add your API key in Settings > AI Configuration.",
        },
        { status: 503 }
      );
    }

    const body = await request.json();
    const { messages } = body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json(
        { error: "Messages array is required" },
        { status: 400 }
      );
    }

    const systemPrompt = await buildSystemPrompt();
    const anthropicResponse = await streamChatResponse(messages, systemPrompt);

    if (!anthropicResponse.ok) {
      const errorText = await anthropicResponse.text();
      console.error("Anthropic API error:", errorText);
      return NextResponse.json(
        { error: "AI request failed", details: errorText },
        { status: 502 }
      );
    }

    const anthropicBody = anthropicResponse.body;
    if (!anthropicBody) {
      return NextResponse.json(
        { error: "No response stream from AI" },
        { status: 502 }
      );
    }

    // Transform the Anthropic SSE stream into a plain text stream
    const reader = anthropicBody.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const stream = new ReadableStream({
      async pull(controller) {
        try {
          const { done, value } = await reader.read();

          if (done) {
            // Process any remaining buffer
            if (buffer.trim()) {
              processSSEBuffer(buffer, controller);
            }
            controller.close();
            return;
          }

          buffer += decoder.decode(value, { stream: true });

          // Process complete SSE lines
          const lines = buffer.split("\n");
          // Keep the last incomplete line in the buffer
          buffer = lines.pop() || "";

          for (const line of lines) {
            processSSELine(line, controller);
          }
        } catch (error) {
          console.error("Stream processing error:", error);
          controller.error(error);
        }
      },
      cancel() {
        reader.cancel();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    console.error("Chat POST error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Chat request failed" },
      { status: 500 }
    );
  }
}

function processSSEBuffer(
  buffer: string,
  controller: ReadableStreamDefaultController
) {
  const lines = buffer.split("\n");
  for (const line of lines) {
    processSSELine(line, controller);
  }
}

function processSSELine(
  line: string,
  controller: ReadableStreamDefaultController
) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data: ")) return;

  const jsonStr = trimmed.slice(6);
  if (jsonStr === "[DONE]") return;

  try {
    const event = JSON.parse(jsonStr);

    if (
      event.type === "content_block_delta" &&
      event.delta?.type === "text_delta" &&
      event.delta.text
    ) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(event.delta.text));
    }
  } catch {
    // Non-JSON data line or malformed JSON; skip silently
  }
}
