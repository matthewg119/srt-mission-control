// What was actually written in the documents somebody dropped on this client.
//
// ‼️ THE PROBLEM THIS FIXES, MEASURED 2026-09-18. A file dropped in a step thread is stored as
// bytes in the `onboarding` bucket and a metadata row in `client_docs`: filename, content type,
// size, which step, who uploaded it. No text, ever. Exactly one path extracts any: a drop in
// step 11's thread, which goes through storeFrameworkFile or ingestResearchFile and lands in
// audience_documents. A PDF dropped on step 6, or 10, or 21 is filename and bytes for ever, and
// every reader of client_docs in this repo (listOnboardingDocs, clientDocs, the get_client_docs
// chat tool) returns metadata alone. The model sees that a file exists and never what it says.
//
// So a prompt built to ask for what is missing would ask for things the client already answered,
// in a PDF, in the thread, three weeks ago. That is the complaint this module exists to answer.
//
// ‼️ IT EXTRACTS, IT DOES NOT READ. extractFileText runs unpdf and a docx unzipper and nothing
// else. No model is asked to transcribe anything, for the reason deck/extract.ts states in its
// own header: a model told to "transcribe this PDF" tidies punctuation, drops a stray line and
// silently fixes what it reads as a typo.
//
// The extraction goes through getOrFetch like every other pull, even though it costs no money.
// What it costs is a download and a parse of a file that cannot have changed, on every single
// prompt build, and the door is where things that should happen once live.

import { supabaseAdmin } from "@/lib/db";
import { getOrFetch, cacheKeyOf } from "@/lib/data/dataset-cache";
import { isResearchDocument } from "./research-intake";

export interface DocText {
  docId: string;
  filename: string;
  /** Which step's thread it was dropped in, when it was dropped in one. */
  stepKey: string | null;
  uploadedAt: string;
  /** What the file says. Never empty: a document with no text is not returned at all. */
  text: string;
  /** True when the text above stops before the document does. Always stated, never silent. */
  clipped: boolean;
}

/**
 * How much of one document travels.
 *
 * ‼️ A CLIP IS DECLARED OR IT IS A LIE. Forty thousand characters is roughly fifteen pages,
 * which holds every intake form, agreement, brand guide and research export seen so far, and a
 * document longer than that is usually an appendix. When it does bite, `clipped` says so and the
 * prompt prints it, because a reader who cannot tell a whole document from most of one will
 * assume the part that is missing was never there.
 */
const PER_DOC_BUDGET = 40_000;

/** Nothing expires: the bytes at a storage ref are the bytes at that storage ref. */
const DOC_TEXT_TTL_DAYS = null;

/** Thrown to decline keeping a document we could not read. getOrFetch writes nothing on a throw. */
class DocUnreadable extends Error {
  constructor(readonly why: string) {
    super(why);
    this.name = "DocUnreadable";
  }
}

/**
 * The text of one filed document, extracted at most once ever.
 *
 * Keyed on the storage ref rather than on the bytes, unlike voice-notes.ts, and the difference is
 * which cost is being avoided. There the expensive thing was the transcription and the bytes were
 * already in hand. Here the expensive thing IS the download, so a key that requires downloading
 * first would save nothing.
 *
 * client_id is the client, not null. A document somebody uploaded about their own business is
 * about that client, and this is the one lane where the research console's per-client spend view
 * should show it.
 */
async function textOfDoc(args: {
  clientId: string;
  docId: string;
  filename: string;
  contentType: string;
  storageRef: string;
}): Promise<{ text: string; clipped: boolean } | null> {
  try {
    const { payload } = await getOrFetch<{ text: string; clipped: boolean }>({
      clientId: args.clientId,
      kind: "storage.doc_text",
      cacheKey: cacheKeyOf({ storageRef: args.storageRef, budget: PER_DOC_BUDGET }),
      ttlDays: DOC_TEXT_TTL_DAYS,
      provider: "direct",
      params: { filename: args.filename, storageRef: args.storageRef },
      fetch: async () => {
        const dl = await supabaseAdmin.storage.from("onboarding").download(args.storageRef);
        if (dl.error || !dl.data) {
          throw new DocUnreadable(dl.error?.message ?? "the stored file could not be read");
        }

        const { extractFileText } = await import("@/lib/deck/extract");
        const full = (await extractFileText(
          Buffer.from(await dl.data.arrayBuffer()),
          args.filename,
          args.contentType
        )) ?? "";

        // An empty extraction is "we could not read it", not "it says nothing". A scanned PDF is
        // the usual cause and it is worth re-trying after somebody re-uploads a text one, so it
        // is never kept.
        if (!full.trim()) throw new DocUnreadable("no text could be extracted");

        return {
          payload: { text: full.slice(0, PER_DOC_BUDGET), clipped: full.length > PER_DOC_BUDGET },
          // Free: a download and a parse. The zero is a measurement, not an unpriced call.
          costUsd: 0,
        };
      },
    });
    return payload;
  } catch {
    // A document that cannot be read is left out entirely rather than represented by an empty
    // string, so a caller counting what it holds is not counting a blank.
    return null;
  }
}

/**
 * Every readable document filed against this client, with what it says.
 *
 * Images and screenshots are skipped by the same test the research intake uses, so a presence
 * screenshot dropped on step 5 does not arrive as an empty document.
 *
 * ‼️ ORDERED OLDEST FIRST, because the prompt that consumes this reads in that order and the
 * intake form is the document somebody wants first, not last.
 */
export async function docTextsFor(clientId: string, opts: { limit?: number } = {}): Promise<DocText[]> {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);

  // ‼️ uploaded_at, NOT created_at, AND THE DIFFERENCE WAS A SILENT NO-OP. client_docs has no
  // created_at column (docs/2026-08-16-client-onboarding.sql:247), one unknown column fails the
  // WHOLE PostgREST select, and supabase-js RETURNS that error rather than throwing it, so this
  // function returned [] and the whole feature did nothing while every test above it passed.
  // Measured against production 2026-09-18, after the first version shipped.
  const { data, error } = await supabaseAdmin
    .from("client_docs")
    .select("id, filename, content_type, storage_ref, delivery_step_key, uploaded_at, transcript")
    .eq("client_id", clientId)
    .order("uploaded_at", { ascending: true })
    .limit(limit);

  if (error) {
    // Never silent. A read that failed is not a client with no documents, and the difference is
    // the whole of what this module is for.
    console.error(`[doc-text] client_docs read failed: ${error.message}`);
    return [];
  }
  if (!data) return [];

  const out: DocText[] = [];
  for (const row of data) {
    const filename = (row.filename as string | null) ?? "";
    const contentType = (row.content_type as string | null) ?? "";
    const storageRef = row.storage_ref as string | null;
    const uploadedAt = (row.uploaded_at as string | null) ?? "";
    const stepKey = (row.delivery_step_key as string | null) ?? null;

    // A voice note already has its words, written at transcription time. Reading the audio bytes
    // again would extract nothing, and the transcript is the document.
    const transcript = (row.transcript as string | null) ?? null;
    if (transcript && transcript.trim()) {
      out.push({
        docId: row.id as string,
        filename: filename || "voice note",
        stepKey,
        uploadedAt,
        text: transcript.slice(0, PER_DOC_BUDGET),
        clipped: transcript.length > PER_DOC_BUDGET,
      });
      continue;
    }

    if (!storageRef) continue;
    if (!isResearchDocument(filename, contentType)) continue;

    const read = await textOfDoc({ clientId, docId: row.id as string, filename, contentType, storageRef });
    if (!read) continue;

    out.push({
      docId: row.id as string,
      filename: filename || "a filed document",
      stepKey,
      uploadedAt,
      text: read.text,
      clipped: read.clipped,
    });
  }

  return out;
}
