// Art pasted back into step 18's thread becomes a character the widget can wear.
//
// Matthew, 2026-09-16: "I need to paste the images generated back as jpg or whatever screenshots".
//
// ‼️ AN IMAGE IS USED AS IT IS AND A CLIP IS PARKED, AND THAT SPLIT IS NOT LAZINESS. Turning a generated
// video into a transparent looping WebP means ffmpeg, numpy and Pillow (scripts/mascot/key-mascot.py),
// and none of the three exists on the serverless runtime this handler runs in. An image already IS the
// finished asset when it has an alpha channel, so it goes straight onto the character. A clip is stored
// in the same bucket under source/ and the reply says the one command that turns it into an asset. The
// alternative, silently accepting a video the widget cannot show, is a corner that stays empty with
// nothing anywhere saying why.
//
// ‼️ THE BUCKET IS `reels`, WHICH IS PUBLIC, AND THAT IS THE POINT. These files are loaded by an <img>
// on a client's own website from an origin that is not ours. `onboarding` is private with ten minute
// signed URLs and holds a client's business records; a mascot is our own artwork and belongs where every
// other public render already lives.

import { supabaseAdmin } from "@/lib/db";
import { MASCOT_STEP, readMascotIntent } from "./mascot-grammar";

export { readMascotIntent } from "./mascot-grammar";

const BUCKET = "reels";

/** What the widget can display directly. */
const IMAGE_TYPES = new Set(["image/png", "image/webp", "image/gif"]);
/** Displayable, but with no transparency, so the reply says so. */
const FLAT_TYPES = new Set(["image/jpeg", "image/jpg"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);

export interface MascotFile {
  id: string;
  name?: string;
  mimetype?: string;
  filetype?: string;
  url_private_download?: string;
  url_private?: string;
}

export function hasMascotArt(files: MascotFile[]): boolean {
  return files.some((f) => {
    const t = (f.mimetype ?? "").toLowerCase();
    return IMAGE_TYPES.has(t) || FLAT_TYPES.has(t) || VIDEO_TYPES.has(t);
  });
}

/**
 * The intrinsic size, read from the file's own header.
 *
 * Only PNG and GIF are parsed, because they are two fixed offsets each and cover what an image tool
 * hands back. Anything else takes the square default: the widget sets height in CSS and leaves width
 * auto, so these numbers only pre-empt a layout shift and being wrong costs a reflow, not a broken
 * corner.
 */
function dimensions(buf: Buffer, mime: string): { width: number; height: number } {
  try {
    if (mime === "image/png" && buf.length > 24 && buf.toString("ascii", 12, 16) === "IHDR") {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    }
    if (mime === "image/gif" && buf.length > 10) {
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    }
  } catch {
    /* a header we cannot read is not a reason to refuse the art */
  }
  return { width: 160, height: 160 };
}

function extensionFor(mime: string, name: string): string {
  const fromName = (name.split(".").pop() ?? "").toLowerCase();
  if (/^[a-z0-9]{2,4}$/.test(fromName)) return fromName;
  return mime.split("/")[1] ?? "bin";
}

interface Stored {
  state: string;
  url: string;
  width: number;
  height: number;
  kind: "image" | "flat" | "video";
}

/**
 * File one or more attachments against a character.
 *
 * Returns null when this is not a mascot paste, so the caller falls through to the ordinary capture.
 */
export async function handleMascotArt(args: {
  clientId: string;
  stepKey: string | null;
  text: string;
  files: MascotFile[];
  by: string;
}): Promise<{ message: string } | null> {
  if (args.stepKey !== MASCOT_STEP) return null;
  const intent = readMascotIntent(args.text);
  if (!intent || !hasMascotArt(args.files)) return null;

  const { data: row } = await supabaseAdmin
    .from("mascot_concepts")
    .select("id, name, assets")
    .eq("client_id", args.clientId)
    .eq("key", intent.key)
    .maybeSingle();
  if (!row) {
    return {
      message:
        `:warning: Nothing filed. This client has no character called \`${intent.key}\`. ` +
        "`mascot` lists them, `mascot concepts` writes six new ones.",
    };
  }

  const { slack } = await import("@/lib/slack-bot");
  const stored: Stored[] = [];
  const problems: string[] = [];

  for (const f of args.files) {
    const mime = (f.mimetype ?? "").toLowerCase();
    const isImage = IMAGE_TYPES.has(mime);
    const isFlat = FLAT_TYPES.has(mime);
    const isVideo = VIDEO_TYPES.has(mime);
    if (!isImage && !isFlat && !isVideo) continue;

    const href = f.url_private_download ?? f.url_private;
    if (!href) {
      problems.push(`${f.name ?? f.id} had no download link`);
      continue;
    }

    let buf: Buffer;
    try {
      buf = await slack.downloadFile(href);
    } catch (e) {
      problems.push(`${f.name ?? f.id}: ${(e as Error).message}`);
      continue;
    }

    const ext = extensionFor(mime, f.name ?? "");
    // A clip is parked under source/ and is not an asset: it still has its background baked in.
    const path = isVideo
      ? `mascots/${args.clientId}/source/${intent.key}-${intent.state}.${ext}`
      : `mascots/${args.clientId}/${intent.key}-${intent.state}.${ext}`;

    const up = await supabaseAdmin.storage.from(BUCKET).upload(path, buf, { contentType: mime, upsert: true });
    if (up.error) {
      problems.push(`${f.name ?? f.id}: ${up.error.message}`);
      continue;
    }
    const url = supabaseAdmin.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
    const size = dimensions(buf, mime);
    stored.push({ state: intent.state, url, ...size, kind: isVideo ? "video" : isFlat ? "flat" : "image" });
  }

  if (stored.length === 0) {
    return { message: `:warning: Nothing filed.${problems.length ? ` ${problems.join("; ")}.` : ""}` };
  }

  const assets = { ...((row.assets ?? {}) as Record<string, unknown>) };
  const usable = stored.filter((s) => s.kind !== "video");
  for (const s of usable) {
    if (s.state === "flourish" || s.state === "easter") {
      const clip = { src: s.url, ms: 8000 };
      if (s.state === "easter") {
        assets.easterEgg = clip;
      } else {
        const list = Array.isArray(assets.flourishes) ? (assets.flourishes as unknown[]) : [];
        assets.flourishes = [...list.filter((c) => (c as { src?: string }).src !== s.url), clip].slice(0, 6);
      }
      continue;
    }
    assets[s.state] = s.url;
    // ‼️ THE FIRST IDLE IS ALSO THE STILL, UNLESS ONE WAS GIVEN. The still is what a reader with
    // prefers-reduced-motion sees and what holds the corner before the animation loads, so a character
    // with an idle and no still would show nothing at all to those readers rather than a frame of it.
    if (s.state === "idle" && !assets.still) assets.still = s.url;
    if (!assets.width || !assets.height) {
      assets.width = s.width;
      assets.height = s.height;
    }
  }

  const ready = typeof assets.idle === "string";
  await supabaseAdmin
    .from("mascot_concepts")
    .update({ assets, status: ready ? "ready" : "proposed", updated_at: new Date().toISOString() })
    .eq("id", row.id);

  const lines: string[] = [
    `:white_check_mark: *${usable.length || stored.length} file${stored.length === 1 ? "" : "s"} filed against ${row.name}* by ${args.by}.`,
  ];
  for (const s of usable) lines.push(`  • \`${s.state}\`: ${s.url}`);

  const flat = usable.filter((s) => s.kind === "flat");
  if (flat.length) {
    lines.push(
      ":warning: A JPG has no transparency, so that one shows as a rectangle in the corner. A PNG with a transparent background is what the widget wants."
    );
  }

  const videos = stored.filter((s) => s.kind === "video");
  for (const v of videos) {
    lines.push(
      `:clapper: \`${v.state}\` is a clip, so it is parked and not live yet: it still has its background painted in. Keyed locally with:`,
      "```" + `python scripts/mascot/key-mascot.py <the file> ${intent.key}-${v.state} --height 160 --fps 10 --once --no-still` + "```"
    );
  }

  if (problems.length) lines.push(`:warning: ${problems.join("; ")}.`);

  if (ready) {
    const { mascotPreviewUrl } = await import("./mascot-studio");
    const url = await mascotPreviewUrl(args.clientId, intent.key);
    lines.push("", `${row.name} is ready to preview.${url ? ` ${url}` : ""}`);
  } else {
    lines.push("", `Still needs an \`idle\`. Paste it with \`mascot ${intent.key} idle\` and the file attached.`);
  }

  const { logClientEvent } = await import("./client-events");
  await logClientEvent({
    clientId: args.clientId,
    stepKey: MASCOT_STEP,
    source: "slack",
    kind: "file",
    author: args.by,
    text: `mascot art: ${intent.key} ${intent.state}`,
    payload: { handler: "mascot-art", key: intent.key, state: intent.state, stored: stored.length },
  }).catch(() => {});

  return { message: lines.join("\n") };
}
