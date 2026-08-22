// Getting the script out of whatever was dropped in Slack: pasted text, a .pdf, a .docx, a .txt.
//
// ‼️ NO MODEL RUNS HERE, and that is not an optimization. Rule 1 of this feature is that the
// script is reproduced word for word, and a model asked to "transcribe this PDF" tidies
// punctuation, drops a stray line and silently fixes what it reads as a typo. Every one of those
// is a parity failure at best and an unnoticed rewrite of Matthew's copy at worst. `unpdf` and
// `extractDocxText` return the bytes that are actually in the file.

import { extractText, getDocumentProxy } from "unpdf";
import { extractDocxText } from "@/lib/reel/docx-text";

export interface ScriptSource {
  text: string;
  /** Where it came from, for the Slack receipt. */
  origin: string;
}

const TRIGGER = /^\s*webinar\b[:,\s]*/i;

/** Strip the leading `webinar` keyword off a pasted message, leaving the script itself. */
export function stripTrigger(text: string): string {
  return text.replace(TRIGGER, "").trim();
}

export function isWebinarTrigger(text: string): boolean {
  return TRIGGER.test(text);
}

export async function extractPdfText(buf: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: true });
  return typeof text === "string" ? text : (text as string[]).join("\n");
}

export async function extractFileText(
  buf: Buffer,
  name: string,
  mime: string
): Promise<string | null> {
  const lower = (name || "").toLowerCase();
  if (mime === "application/pdf" || lower.endsWith(".pdf")) return extractPdfText(buf);
  if (mime.includes("wordprocessingml") || lower.endsWith(".docx")) return extractDocxText(buf);
  if (mime.startsWith("text/") || lower.endsWith(".txt") || lower.endsWith(".md")) {
    return buf.toString("utf8");
  }
  return null;
}

/**
 * Slack pastes long text as a `.txt` snippet rather than a message, and a script pasted under
 * `webinar` routinely trips that. So an attachment is read whenever there is one, and the typed
 * text only wins when there is nothing to read.
 */
export async function resolveScript(args: {
  text: string;
  files: Array<{ buffer: Buffer; name: string; mime: string }>;
}): Promise<ScriptSource | null> {
  for (const file of args.files) {
    const extracted = await extractFileText(file.buffer, file.name, file.mime);
    if (extracted && extracted.trim().length > 0) {
      return { text: extracted.trim(), origin: file.name || "attachment" };
    }
  }
  const typed = stripTrigger(args.text);
  if (typed.length > 0) return { text: typed, origin: "pasted in Slack" };
  return null;
}
