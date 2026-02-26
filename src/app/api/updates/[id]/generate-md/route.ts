import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { isAIConfigured, streamChatResponse } from "@/lib/ai";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;

    // Fetch update with its tasks
    const { data: update, error: updateError } = await supabaseAdmin
      .from("updates")
      .select("*")
      .eq("id", id)
      .single();

    if (updateError || !update) {
      return NextResponse.json(
        { error: "Update not found" },
        { status: 404 }
      );
    }

    const { data: tasks } = await supabaseAdmin
      .from("update_tasks")
      .select("*")
      .eq("update_id", id)
      .order("sort_order", { ascending: true });

    // Build the task list for the prompt
    const taskList =
      tasks && tasks.length > 0
        ? tasks
            .map(
              (t, i) =>
                `${i + 1}. ${t.task}${t.file_path ? ` (File: ${t.file_path})` : ""}${t.notes ? ` — Notes: ${t.notes}` : ""}`
            )
            .join("\n")
        : "No specific tasks defined yet.";

    const prompt = `Generate a CLAUDE.md instruction file for Claude Code to implement the following update.

UPDATE: ${update.version} — ${update.title}
DESCRIPTION: ${update.description || "No description provided."}
STATUS: ${update.status}
TARGET DATE: ${update.target_date || "Not set"}

TASKS:
${taskList}

Generate a comprehensive CLAUDE.md file that includes:
1. A clear title and objective section
2. The tech stack context (Next.js App Router, TypeScript, Tailwind, shadcn/ui, Supabase, NextAuth v5)
3. Step-by-step implementation instructions for each task
4. File paths that need to be created or modified
5. Any database schema changes needed
6. Testing instructions
7. Deployment notes

Format it as a proper Markdown file that Claude Code can follow as instructions. Be specific about file paths, code patterns, and the project's conventions. The project uses:
- src/app/ for pages (App Router)
- src/components/ for React components
- src/lib/ for utilities and services
- src/config/ for configuration
- src/app/api/ for API routes
- Supabase for database (use supabaseAdmin from @/lib/db)
- shadcn/ui components in src/components/ui/`;

    const messages = [{ role: "user" as const, content: prompt }];
    const systemPrompt =
      "You are a senior full-stack developer generating precise implementation instructions for Claude Code. Output only the CLAUDE.md content in Markdown format. Be specific, actionable, and thorough.";

    const anthropicResponse = await streamChatResponse(messages, systemPrompt);

    if (!anthropicResponse.ok) {
      const errorText = await anthropicResponse.text();
      console.error("Anthropic API error:", errorText);
      return NextResponse.json(
        { error: "AI generation failed", details: errorText },
        { status: 502 }
      );
    }

    // Read the full streamed response to extract text
    const reader = anthropicResponse.body?.getReader();
    if (!reader) {
      return NextResponse.json(
        { error: "No response stream from AI" },
        { status: 502 }
      );
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let generatedContent = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;

        const jsonStr = trimmed.slice(6);
        if (jsonStr === "[DONE]") continue;

        try {
          const event = JSON.parse(jsonStr);
          if (
            event.type === "content_block_delta" &&
            event.delta?.type === "text_delta" &&
            event.delta.text
          ) {
            generatedContent += event.delta.text;
          }
        } catch {
          // Skip malformed JSON
        }
      }
    }

    // Process any remaining buffer
    if (buffer.trim()) {
      const lines = buffer.split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const jsonStr = trimmed.slice(6);
        if (jsonStr === "[DONE]") continue;
        try {
          const event = JSON.parse(jsonStr);
          if (
            event.type === "content_block_delta" &&
            event.delta?.type === "text_delta" &&
            event.delta.text
          ) {
            generatedContent += event.delta.text;
          }
        } catch {
          // Skip malformed JSON
        }
      }
    }

    // Save to database
    const { error: saveError } = await supabaseAdmin
      .from("updates")
      .update({
        claude_code_instructions: generatedContent,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (saveError) {
      console.error("Failed to save instructions:", saveError);
      return NextResponse.json(
        {
          error: "Generated content but failed to save",
          content: generatedContent,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      content: generatedContent,
      saved: true,
    });
  } catch (error) {
    console.error("Generate MD error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate instructions" },
      { status: 500 }
    );
  }
}
