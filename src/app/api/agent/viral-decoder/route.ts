import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { slack, SlackBlock } from "@/lib/slack-bot";
import { supabaseAdmin } from "@/lib/db";
import { VIRAL_DECODER_SYSTEM_PROMPT } from "@/config/viral-video-decoder-prompt";
import { createRecords, slideSection } from "@/lib/airtable";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

interface SlackContentFile {
  id: string;
  name?: string;
  mimetype?: string;
  url_private?: string;
}

interface DecoderPackage {
  concept_summary: string;
  target_persona: string;
  sticky_caption: string;
  voiceover_script: Array<{ t: string; emotion: string; line: string }>;
  runtime_seconds: number;
  slides: Array<{
    n: number;
    duration_seconds: number;
    role: string;
    image_prompt: string;
    animation_prompt: string;
    audio_beat: string;
    cut_style: string;
  }>;
  assembly_timeline_markdown: string;
  music: {
    mood: string;
    elevenlabs_prompt: string;
    sfx: string[];
  };
  estimated_cost_usd: number;
  vary_next_time: string;
}

const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

export async function POST(request: NextRequest) {
  const body = (await request.json()) as {
    channel: string;
    thread_ts: string;
    user_id?: string;
    brief: string;
    files: SlackContentFile[];
    parent_package_id?: string | null;
    regenerate_feedback?: string | null;
    auto_render?: boolean;
  };

  const { channel, thread_ts: threadTs, brief } = body;
  const files = body.files ?? [];
  const parentPackageId = body.parent_package_id ?? null;
  const regenFeedback = body.regenerate_feedback ?? null;
  const autoRender = body.auto_render === true;

  let parentPackage: DecoderPackage | null = null;
  let parentBrief: string | null = null;
  if (parentPackageId) {
    const { data } = await supabaseAdmin
      .from("content_packages")
      .select("brief, package_json")
      .eq("id", parentPackageId)
      .maybeSingle();
    if (data) {
      parentPackage = (data.package_json as DecoderPackage) ?? null;
      parentBrief = (data.brief as string) ?? null;
    }
  }

  if (!channel || !threadTs) {
    return NextResponse.json({ error: "channel and thread_ts required" }, { status: 400 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    await slack.postThreadReply(channel, threadTs, "⚠️ ANTHROPIC_API_KEY not set.");
    return NextResponse.json({ error: "ANTHROPIC_API_KEY missing" }, { status: 500 });
  }

  const imageBlocks: Anthropic.ImageBlockParam[] = [];
  for (const f of files) {
    const mime = (f.mimetype ?? "").toLowerCase();
    if (!IMAGE_MIMES.has(mime) || !f.url_private) continue;
    try {
      const buf = await slack.downloadFile(f.url_private);
      imageBlocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: mime as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
          data: buf.toString("base64"),
        },
      });
    } catch (e) {
      console.error("[viral-decoder] image download failed:", (e as Error).message);
    }
  }

  const userContent: Anthropic.ContentBlockParam[] = [];
  if (imageBlocks.length > 0) userContent.push(...imageBlocks);

  let userText: string;
  if (parentPackage) {
    userText = [
      `This is a REGENERATION. Previous package:`,
      "```json",
      JSON.stringify(parentPackage, null, 2),
      "```",
      `Original brief: ${parentBrief ?? "(none)"}`,
      `Matthew's feedback on what to change: ${(regenFeedback ?? brief).trim()}`,
      ``,
      `Produce a new complete JSON production package that addresses the feedback. Keep what was working; change only what was flagged. Return JSON only.`,
    ].join("\n");
  } else if (brief.trim().length > 0) {
    userText = `Brief from Matthew: ${brief.trim()}\n\nReturn the complete JSON production package per the schema in your system prompt. No preamble.`;
  } else {
    userText = `No written brief. Use the attached reference screenshots to decode the storyboard, then produce a complete JSON production package per your system prompt. Pick a fresh revenue-based-funding persona (blue-collar operator with sub-600 credit preferred).`;
  }

  userContent.push({ type: "text", text: userText });

  const anthropic = new Anthropic();
  const start = Date.now();

  let raw: string;
  try {
    const response = await anthropic.messages.create({
      model: "claude-opus-4-7",
      max_tokens: 8000,
      system: [
        {
          type: "text",
          text: VIRAL_DECODER_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [{ role: "user", content: userContent }],
    });
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") throw new Error("no text in response");
    raw = textBlock.text;
  } catch (e) {
    await slack.postThreadReply(
      channel,
      threadTs,
      `⚠️ Claude call failed: ${(e as Error).message}`
    );
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  let pkg: DecoderPackage;
  try {
    const jsonText = extractJson(raw);
    pkg = JSON.parse(jsonText) as DecoderPackage;
  } catch (e) {
    await slack.postThreadReply(
      channel,
      threadTs,
      `⚠️ Couldn't parse decoder JSON (${(e as Error).message}). Raw output:\n\`\`\`\n${raw.slice(0, 2500)}\n\`\`\``
    );
    return NextResponse.json({ error: "json_parse" }, { status: 500 });
  }

  const blocks = buildDecoderBlocks(pkg);
  const postResult = (await slack.postThreadReply(
    channel,
    threadTs,
    `📝 ${pkg.concept_summary}`,
    blocks
  )) as { ok?: boolean; ts?: string };

  // Persist so the reaction handler + #content-full pipeline can re-use it.
  let packageId: string | null = null;
  try {
    const { data: inserted } = await supabaseAdmin
      .from("content_packages")
      .insert({
        slack_channel: channel,
        slack_thread_ts: threadTs,
        slack_package_ts: postResult.ts ?? null,
        brief: parentBrief ?? brief,
        image_count: imageBlocks.length,
        package_json: pkg,
        latency_ms: Date.now() - start,
        model: "claude-opus-4-7",
        status: autoRender ? "approved" : "awaiting_approval",
        resolved_at: autoRender ? new Date().toISOString() : null,
        parent_package_id: parentPackageId,
        regenerate_feedback: regenFeedback,
      })
      .select("id")
      .maybeSingle();
    packageId = (inserted?.id as string | undefined) ?? null;
    // Mark the parent as fully regenerated so stray thread replies don't
    // bounce back into the regen loop a second time.
    if (parentPackageId) {
      await supabaseAdmin
        .from("content_packages")
        .update({ status: "killed", resolved_at: new Date().toISOString() })
        .eq("id", parentPackageId)
        .eq("status", "regenerating");
    }
  } catch (e) {
    console.error("[viral-decoder] persist failed:", (e as Error).message);
  }

  // Push slides to Airtable kanban if configured
  if (packageId && process.env.AIRTABLE_API_TOKEN && process.env.AIRTABLE_SLIDES_TABLE_ID) {
    void (async () => {
      try {
        const scriptTitle = pkg.concept_summary.slice(0, 80);
        const records = pkg.slides.map((slide) => ({
          fields: {
            "Script Title": scriptTitle,
            "Slide #": slide.n,
            "Section": slideSection(slide.n),
            "Image Prompt": slide.image_prompt,
            "Animation Prompt": slide.animation_prompt,
            "Duration (s)": slide.duration_seconds,
            "Status": "Draft",
            "Package ID": packageId,
          },
        }));
        await createRecords(process.env.AIRTABLE_SLIDES_TABLE_ID!, records);
        console.log(`[viral-decoder] pushed ${records.length} slides to Airtable pkg=${packageId}`);
      } catch (e) {
        console.error("[viral-decoder] Airtable push failed:", (e as Error).message);
      }
    })();
  }

  // Auto-render path: skip the 👍 gate and fire the video pipeline directly.
  // Used by the daily-content-ideas cron posting into #content-full.
  if (autoRender && packageId) {
    const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    void fetch(`${siteUrl}/api/agent/video-pipeline`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ package_id: packageId, approved_by: "cron:daily-content-ideas" }),
    }).catch((e) => console.error("[viral-decoder] auto-render kickoff failed:", (e as Error).message));
    await slack.postThreadReply(
      channel,
      threadTs,
      `🤖 Auto-approved (daily cron) — firing video pipeline now.`
    );
  }

  return NextResponse.json({ ok: true, package: pkg, package_id: packageId });
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return trimmed;
  // Strip markdown fence if Claude wrapped the JSON.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return fenced[1].trim();
  // Find first { and last }.
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1);
  throw new Error("no JSON object found in Claude output");
}

function buildDecoderBlocks(pkg: DecoderPackage): SlackBlock[] {
  const voiceoverText = pkg.voiceover_script
    .map((l) => `\`${l.t}\` _(${l.emotion})_ ${l.line}`)
    .join("\n");

  const imagePromptsText = pkg.slides
    .map((s) => `*Slide ${s.n} — ${s.role} (${s.duration_seconds}s):*\n${s.image_prompt}`)
    .join("\n\n");

  const animationPromptsText = pkg.slides
    .map((s) => `*Slide ${s.n}:* ${s.animation_prompt}`)
    .join("\n\n");

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "🎬 Viral Video Package", emoji: true },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*Concept:* ${pkg.concept_summary}\n*Persona:* ${pkg.target_persona}\n*Runtime:* ${pkg.runtime_seconds}s  •  *Est. cost:* $${pkg.estimated_cost_usd.toFixed(2)}` },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*🎯 Sticky caption*\n> ${pkg.sticky_caption}` },
    },
    { type: "divider" },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*🎙️ Voiceover script*\n${truncate(voiceoverText, 2800)}` },
    },
    { type: "divider" },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*🎨 Image prompts (slide-by-slide)*\n${truncate(imagePromptsText, 2800)}` },
    },
    { type: "divider" },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*🎬 Animation prompts (slide-by-slide)*\n${truncate(animationPromptsText, 2800)}` },
    },
    { type: "divider" },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*🎞️ Assembly timeline*\n${truncate(pkg.assembly_timeline_markdown, 2800)}` },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*🎵 Music / SFX*\n${pkg.music.mood}\n_ElevenLabs prompt:_ \`${pkg.music.elevenlabs_prompt}\`\n_SFX:_ ${pkg.music.sfx.join(" • ")}` },
    },
    {
      type: "context",
      elements: [
        { type: "mrkdwn", text: `👍 approve  •  ✏️ regenerate with feedback  •  🚫 kill  •  _next time:_ ${pkg.vary_next_time}` },
      ],
    },
  ];
  return blocks;
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 12)}…\n_(truncated)_`;
}
