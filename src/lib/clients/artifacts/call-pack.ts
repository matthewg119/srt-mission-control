// The call pack: four documents, one step, one thread.
//
// Matthew, 2026-09-12: "we can merge everything that goes in the call pack and keep the rest."
// `presence_pdf` and `findings_doc` were delivery steps of their own until that day. Each
// produced a PDF that nobody reads on its own, each had its own anchor, its own tick and its own
// refusal, and all four of these documents are picked up together when somebody prepares for the
// call. Three ticks over the parts said less than one tick over the bundle.
//
// ‼️ THIS FILE EXISTS SO THE FILENAMES HAVE ONE SOURCE, AND THAT IS NOT TIDINESS.
// The verifier cannot ask `client_docs` which of the four a row is: there is no kind column, and
// adding one would mean a migration plus a backfill for every document ever filed. So it matches
// on the filename prefix. A generator that changed its filename without changing the prefix here
// would make the verifier refuse a document that is sitting right there, so both sides read these
// constants and neither writes a filename of its own.

/** Which step the pack is filed against. The key is unchanged; renaming one orphans every row. */
export const CALL_PACK_STEP_KEY = "call_sheet";

export interface CallPackDoc {
  /** What the thread, the note and the refusal call it. */
  label: string;
  /** Everything before the client name. The verifier matches a filename with startsWith. */
  prefix: string;
}

/**
 * The four, in the order the runner generates them.
 *
 * ‼️ THE ORDER IS LOAD BEARING and the runner's comment says why: the findings document links
 * the presence PDF, and the call sheet runs last because `deliverArtifact` overwrites the step's
 * output_ref every time it is called, so the last one to run is the one the step points at.
 */
export const CALL_PACK_DOCS = {
  presence: { label: "Presence and consistency", prefix: "Presence and consistency - " },
  findings: { label: "Findings", prefix: "Findings - " },
  questions: { label: "Closing questions", prefix: "Closing questions (internal) - " },
  sheet: { label: "Call sheet", prefix: "Call sheet (internal) - " },
} as const satisfies Record<string, CallPackDoc>;

export type CallPackDocKey = keyof typeof CALL_PACK_DOCS;

/** The one place a call pack filename is built. */
export function callPackFilename(doc: CallPackDocKey, clientName: string): string {
  return `${CALL_PACK_DOCS[doc].prefix}${clientName}.pdf`;
}

/** Which of the four a stored filename is, or null when it is something else entirely. */
export function callPackDocOf(filename: string): CallPackDocKey | null {
  const name = filename ?? "";
  for (const key of Object.keys(CALL_PACK_DOCS) as CallPackDocKey[]) {
    if (name.startsWith(CALL_PACK_DOCS[key].prefix)) return key;
  }
  return null;
}
