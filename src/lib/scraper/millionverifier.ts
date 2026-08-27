// MillionVerifier Bulk API v2. Upload a file of addresses, poll it, download the survivors.
//
//   POST https://bulkapi.millionverifier.com/bulkapi/v2/upload?key=...   multipart file_contents
//   GET  .../bulkapi/v2/fileinfo?key=...&file_id=...
//   GET  .../bulkapi/v2/download?key=...&file_id=...&filter=ok
//
// ‼️ THIS IS THE ONLY THING IN THE SCRAPER LANE THAT SPENDS MONEY, and it is billed per address
// uploaded, not per address that comes back OK. Everything defensive here follows from that:
// `isConfigured()` so a missing key degrades to "here is clean.csv, upload it yourself" instead of
// throwing; a hard cap so a mis-parsed 90k-row file cannot be sent without somebody looking at the
// number first; and the upload happening ONCE, guarded by `mv_file_id` already being set on the
// batch row, so a retried tick cannot buy the same list twice.

const BASE = "https://bulkapi.millionverifier.com/bulkapi/v2";

/** The `status` values the API documents. `error` is theirs, not ours. */
export type MvStatus =
  | "in_queue_to_start"
  | "in_progress"
  | "finished"
  | "canceled"
  | "paused"
  | "error";

export interface MvFileInfo {
  file_id: string;
  file_name?: string;
  status: MvStatus;
  percent?: number;
  total_rows?: number;
  unique_emails?: number;
  verified?: number;
  unverified?: number;
  ok?: number;
  catch_all?: number;
  disposable?: number;
  invalid?: number;
  unknown?: number;
  estimated_time_sec?: number;
  error?: string;
}

/** Which slice of the result to download. */
export type MvFilter = "ok" | "ok_and_catch_all" | "unknown" | "invalid" | "all";

function apiKey(): string {
  return (process.env.MILLIONVERIFIER_API_KEY ?? "").trim();
}

/** No key means the lane still runs and still posts clean.csv. It just does not verify. */
export function isConfigured(): boolean {
  return apiKey().length > 0;
}

/**
 * The ceiling above which the lane asks before spending. Default 25,000.
 *
 * Not a refusal: over the cap the batch parks and the thread asks for a ✅. The number exists
 * because the expensive failure is a file whose email column was mis-resolved, which produces a
 * plausible-looking upload of every row in the export.
 */
export function maxEmails(): number {
  const raw = Number(process.env.SCRAPER_MV_MAX_EMAILS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 25000;
}

function requireKey(): string {
  const key = apiKey();
  if (!key) throw new Error("MILLIONVERIFIER_API_KEY is not set");
  return key;
}

/** Their errors come back as 403 (bad key) / 404 (no such file) with a text body. */
async function readError(res: Response, what: string): Promise<never> {
  const body = await res.text().catch(() => "");
  throw new Error(`millionverifier ${what} failed: ${res.status} ${body.slice(0, 200)}`);
}

/**
 * Upload a newline-separated list of addresses. Returns the file id to poll.
 *
 * A bare address list rather than the full clean.csv on purpose: they bill per row and every extra
 * column is a column their parser has to guess at. The join back onto our rows is by email.
 */
export async function uploadEmails(emails: string[], fileName: string): Promise<MvFileInfo> {
  const key = requireKey();
  const body = new FormData();
  body.append("file_contents", new Blob([emails.join("\n")], { type: "text/plain" }), fileName);

  const res = await fetch(`${BASE}/upload?key=${encodeURIComponent(key)}`, { method: "POST", body });
  if (!res.ok) return readError(res, "upload");
  return (await res.json()) as MvFileInfo;
}

export async function fileInfo(fileId: string): Promise<MvFileInfo> {
  const key = requireKey();
  const url = `${BASE}/fileinfo?key=${encodeURIComponent(key)}&file_id=${encodeURIComponent(fileId)}`;
  const res = await fetch(url);
  if (!res.ok) return readError(res, "fileinfo");
  return (await res.json()) as MvFileInfo;
}

/** The result file as text. `filter` decides which slice; `all` carries every verdict. */
export async function downloadResult(fileId: string, filter: MvFilter): Promise<string> {
  const key = requireKey();
  const url =
    `${BASE}/download?key=${encodeURIComponent(key)}` +
    `&file_id=${encodeURIComponent(fileId)}&filter=${encodeURIComponent(filter)}`;
  const res = await fetch(url);
  if (!res.ok) return readError(res, "download");
  return res.text();
}

/**
 * Read `filter=all` into email -> result.
 *
 * ‼️ THE COLUMN LAYOUT IS NOT CONTRACTUAL AND THIS DOES NOT ASSUME IT. It finds the cell that
 * looks like an address and takes the first cell after it that is one of their known verdicts, so
 * an extra column appearing in their export does not silently shift every verdict by one. A line
 * whose verdict cannot be identified is skipped rather than guessed at.
 */
const MV_RESULTS = new Set(["ok", "catch_all", "unknown", "invalid", "disposable"]);

export function parseResultLines(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const emailAt = cells.findIndex((c) => c.includes("@"));
    if (emailAt === -1) continue;
    const verdict = cells.slice(emailAt + 1).find((c) => MV_RESULTS.has(c.toLowerCase()));
    if (!verdict) continue;
    out.set(cells[emailAt].toLowerCase(), verdict.toLowerCase());
  }
  return out;
}
