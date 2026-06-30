// Avatar kit ingest (Content Engine v2, Phase 1).
//
// Drop a vertical "kit" (Avatar research PDF + 6 Beliefs PDF + Offer sheet .docx) and this
// route distills it into a `verticals` row, then triggers generateFormatCalendar() to build
// the ~30-format calendar.
//
// Two entry paths:
//   - Direct POST  (primary; what the verify step uses): JSON body with `vertical` + `files`.
//   - Slack hand-off: a `slack_file` block (url_private_download + channel/thread) posted by
//     the #content-analyzer file_shared dispatch in src/app/api/slack/events/route.ts.

import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { callClaudeJSON, type ClaudeModel, type ClaudeDocumentInput } from "@/lib/claude-calls";
import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { stripEmDashes } from "@/lib/reel/text";
import { extractDocxText } from "@/lib/reel/docx-text";
import { generateFormatCalendar } from "@/lib/reel/format-generator";
import { DEFAULT_VERTICAL_ID } from "@/config/verticals";
import { POV_GLASSES_TOKEN } from "@/config/pov-style";

export const runtime = "nodejs";
export const maxDuration = 300; // 8 web searches + a large distill/generate Claude call

function model(): ClaudeModel {
  return (process.env.ANTHROPIC_MODEL as ClaudeModel) || "claude-sonnet-4-6";
}

interface FileInput {
  filename?: string;
  mime?: string;
  b64?: string;
  url?: string;
}

interface VerticalInput {
  id?: string;
  name?: string;
  audience?: string;
  business_descriptor?: string;
  wearer_role?: string;
  style_token?: string;
  soul_id?: string;
}

interface SlackFileInput {
  url_private_download?: string;
  name?: string;
  mimetype?: string;
  channel?: string;
  thread_ts?: string;
}

interface IngestBody {
  vertical?: VerticalInput;
  files?: FileInput[];
  slack_file?: SlackFileInput;
}

// --- The distilled kit -------------------------------------------------------
interface DistilledKit {
  avatar_summary: string;
  beliefs: string[];
  offer: {
    ump?: string;
    ums?: string;
    big_idea?: string;
    belief_chains?: unknown;
    objections?: unknown;
    headlines?: unknown;
  };
  style_token?: string;
  business_descriptor?: string;
  wearer_role?: string;
}

function isDistilledKit(v: unknown): v is DistilledKit {
  if (typeof v !== "object" || v === null) return false;
  const k = v as DistilledKit;
  return typeof k.avatar_summary === "string" && Array.isArray(k.beliefs) && typeof k.offer === "object" && k.offer !== null;
}

const DISTILL_SCHEMA_HINT =
  '{ "avatar_summary": string, "beliefs": [string] (the 6 ordered beliefs), ' +
  '"offer": { "ump": string, "ums": string, "big_idea": string, "belief_chains": any, "objections": any, "headlines": any }, ' +
  '"style_token": string (a first-person POV visual style token), ' +
  '"business_descriptor": string, "wearer_role": string }';

function isPdf(f: { filename?: string; mime?: string }): boolean {
  return (f.mime ?? "").includes("pdf") || /\.pdf$/i.test(f.filename ?? "");
}
function isDocx(f: { filename?: string; mime?: string }): boolean {
  return (f.mime ?? "").includes("wordprocessingml") || /\.docx$/i.test(f.filename ?? "");
}

async function toBuffer(f: FileInput): Promise<Buffer | null> {
  try {
    if (f.b64) return Buffer.from(f.b64, "base64");
    if (f.url) {
      const res = await fetch(f.url);
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    }
  } catch (e) {
    console.error("[ingest-avatar] toBuffer failed:", (e as Error).message);
  }
  return null;
}

function stripOffer(offer: DistilledKit["offer"]): DistilledKit["offer"] {
  const s = (x?: string) => (typeof x === "string" ? stripEmDashes(x) : x);
  return { ...offer, ump: s(offer.ump), ums: s(offer.ums), big_idea: s(offer.big_idea) };
}

/** Core: distill the kit -> upsert verticals row -> generate calendar. */
async function ingestKit(params: {
  verticalId: string;
  meta: VerticalInput;
  documents: ClaudeDocumentInput[];
  docText: string;
  avatarDocUrl?: string | null;
}) {
  const { verticalId, meta, documents, docText, avatarDocUrl } = params;

  const userText = [
    "Distill this vertical kit into the structured JSON below.",
    "The PDFs hold the Avatar research and the 6 Beliefs (DERRIBAR -> CONSTRUIR pairs).",
    docText
      ? "\nThe offer sheet text (UMP / UMS / Big Idea / belief-chains / objections / headlines):\n" + docText.slice(0, 12000)
      : "",
    "\nReturn exactly 6 beliefs in order. Never use em dashes or en dashes.",
  ].join("\n");

  const { data } = await callClaudeJSON<DistilledKit>({
    model: model(),
    system:
      "You are a brand strategist distilling a marketing kit (Avatar voice-of-customer research, " +
      "6 core beliefs, and an offer sheet) into a compact structured persona for a short-form video engine. " +
      "Be faithful to the source documents; do not invent claims, prices, or guarantees.",
    user: userText,
    documents: documents.length > 0 ? documents : undefined,
    maxTokens: 3500,
    temperature: 0.3,
    schemaHint: DISTILL_SCHEMA_HINT,
    validate: isDistilledKit,
  });

  const beliefs = data.beliefs.slice(0, 6).map((b) => stripEmDashes(String(b)));
  const styleToken = stripEmDashes(meta.style_token || data.style_token || POV_GLASSES_TOKEN);
  const name = meta.name || verticalId.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const row = {
    id: verticalId,
    name,
    audience: meta.audience ?? null,
    status: "active",
    business_descriptor: meta.business_descriptor || data.business_descriptor || "business",
    wearer_role: meta.wearer_role || data.wearer_role || "specialist",
    avatar_doc_url: avatarDocUrl ?? null,
    avatar_summary: stripEmDashes(data.avatar_summary),
    beliefs,
    offer: stripOffer(data.offer ?? {}),
    style_token: styleToken,
    soul_id: meta.soul_id ?? null,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabaseAdmin.from("verticals").upsert(row, { onConflict: "id" });
  if (error) throw new Error(`verticals upsert failed: ${error.message}`);

  const calendar = await generateFormatCalendar(verticalId);
  return { distilled: { beliefs: beliefs.length }, ...calendar };
}

/** Best-effort: upload the first kit file to the `reels` bucket for avatar_doc_url. */
async function uploadAvatarDoc(buf: Buffer, filename: string, mime: string): Promise<string | null> {
  try {
    const ext = (filename.split(".").pop() || "bin").toLowerCase();
    const key = `kits/${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`;
    const up = await supabaseAdmin.storage.from("reels").upload(key, buf, { contentType: mime, upsert: true });
    if (up.error) return null;
    return supabaseAdmin.storage.from("reels").getPublicUrl(key).data.publicUrl;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  let body: IngestBody;
  try {
    body = (await req.json()) as IngestBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  // --- Slack hand-off path: single dropped file -> background ingest + thread reply ----
  if (body.slack_file?.url_private_download) {
    const sf = body.slack_file;
    const verticalId = body.vertical?.id || DEFAULT_VERTICAL_ID;
    waitUntil(
      (async () => {
        try {
          const buf = await slack.downloadFile(sf.url_private_download!);
          const fileMeta = { filename: sf.name, mime: sf.mimetype };
          const documents: ClaudeDocumentInput[] = isPdf(fileMeta)
            ? [{ media_type: "application/pdf", data: buf.toString("base64"), title: sf.name }]
            : [];
          const docText = isDocx(fileMeta) ? extractDocxText(buf) : isPdf(fileMeta) ? "" : buf.toString("utf8");
          const avatarDocUrl = await uploadAvatarDoc(buf, sf.name || "kit", sf.mimetype || "application/octet-stream");
          const result = await ingestKit({
            verticalId,
            meta: body.vertical ?? {},
            documents,
            docText,
            avatarDocUrl,
          });
          if (sf.channel && sf.thread_ts) {
            await slack.postThreadReply(
              sf.channel,
              sf.thread_ts,
              `Kit ingested for *${verticalId}*. Built ${result.created} content formats. Try \`generate POV ${verticalId.replace(/_/g, " ")} 5 ideas\`.`
            );
          }
        } catch (e) {
          console.error("[ingest-avatar] slack path failed:", (e as Error).message);
          if (sf.channel && sf.thread_ts) {
            await slack
              .postThreadReply(sf.channel, sf.thread_ts, `Kit ingest failed: ${(e as Error).message}`)
              .catch(() => {});
          }
        }
      })()
    );
    return NextResponse.json({ ok: true, async: true, vertical_id: verticalId });
  }

  // --- Direct POST path: full kit, awaited so the response carries the counts ----------
  const files = Array.isArray(body.files) ? body.files : [];
  if (files.length === 0) {
    return NextResponse.json({ ok: false, error: "no files provided" }, { status: 400 });
  }
  const verticalId = body.vertical?.id || DEFAULT_VERTICAL_ID;

  const documents: ClaudeDocumentInput[] = [];
  const docTexts: string[] = [];
  let avatarDocUrl: string | null = null;

  for (const f of files) {
    const buf = await toBuffer(f);
    if (!buf) continue;
    if (isPdf(f)) {
      documents.push({ media_type: "application/pdf", data: buf.toString("base64"), title: f.filename });
      if (!avatarDocUrl) avatarDocUrl = await uploadAvatarDoc(buf, f.filename || "avatar.pdf", "application/pdf");
    } else if (isDocx(f)) {
      const t = extractDocxText(buf);
      if (t) docTexts.push(t);
    } else {
      docTexts.push(buf.toString("utf8"));
    }
  }

  if (documents.length === 0 && docTexts.length === 0) {
    return NextResponse.json({ ok: false, error: "no readable kit content (PDF/docx)" }, { status: 400 });
  }

  try {
    const result = await ingestKit({
      verticalId,
      meta: body.vertical ?? {},
      documents,
      docText: docTexts.join("\n\n"),
      avatarDocUrl,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("[ingest-avatar] direct path failed:", (e as Error).message);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
