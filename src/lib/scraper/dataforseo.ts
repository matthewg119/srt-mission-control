// DataForSEO SERP API v3, Google Organic, STANDARD queue.
//
//   POST https://api.dataforseo.com/v3/serp/google/organic/task_post        up to 100 tasks
//   GET  https://api.dataforseo.com/v3/serp/google/organic/task_get/advanced/{id}
//
// ‼️ THIS IS THE SECOND THING IN THE SCRAPER LANE THAT SPENDS MONEY, and like MillionVerifier it is
// billed on the way IN. Verified against their current docs on 2026-08-28 rather than assumed:
//
//   Standard queue   $0.0006 / SERP   100 tasks per POST   ~5 min
//   Priority queue   $0.0012 / SERP   100 tasks per POST   ~1 min
//   Live Advanced    $0.002  / SERP     1 task  per call   ~6 s
//
// Standard was Matthew's call. The lane already owns a resumable stage machine and a 5-minute cron,
// which is exactly the shape an async queue wants, and the 3.3x saving is real on a 1,000-company
// cap.
//
// ‼️ CHARGED AT task_post, NEVER AT task_get. Results are free to collect for 30 days. Three guards
// follow from that and all three are load-bearing: the per-batch cap is checked BEFORE the first
// POST; a task is only posted for a row whose `dataforseo_task_id` is still null, the same shape as
// MillionVerifier's `mv_file_id` guard, so a retried tick cannot buy the same list twice; and the
// per-task `cost` the response carries is summed onto the batch, so what was spent is RECORDED
// rather than estimated.
//
// ‼️ `tasks_ready` IS DELIBERATELY NOT USED. It is an account-wide collect-once queue, so a task
// collected by anything else is a company that silently never scores, and the money is already
// gone. Polling `task_get` by the id we stored is free, authoritative, and has no account-wide
// coupling at all. An unfinished task answers 40602 "Task In Queue", which is a clean "not ready"
// rather than an error.

import type { SerpPayload } from "./score";

const BASE = "https://api.dataforseo.com/v3/serp/google/organic";

/** Their per-POST ceiling. Over it the whole call is rejected with 40006, not truncated. */
export const TASKS_PER_POST = 100;

/** Status codes that are not failures. 20000 is done; 40602 is "still queued, ask again". */
const OK = 20000;
const TASK_IN_QUEUE = 40602;
const TASK_HANDED = 40601; // "Task Handed" - accepted and running, same meaning to us as 40602.

function login(): string {
  return (process.env.DATAFORSEO_LOGIN ?? "").trim();
}

function password(): string {
  return (process.env.DATAFORSEO_PASSWORD ?? "").trim();
}

/** No credentials means the lane still runs and still posts the file. It just does not score. */
export function isConfigured(): boolean {
  return login().length > 0 && password().length > 0;
}

/**
 * The per-batch spend ceiling, in QUERIES not dollars.
 *
 * Queries rather than dollars because the price is theirs to change and the count is the thing a
 * person can sanity-check against a file they just dropped. At the standard rate the default is
 * about $0.60.
 */
export function maxQueriesPerBatch(): number {
  const raw = Number(process.env.DATAFORSEO_MAX_QUERIES_PER_BATCH);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 1000;
}

function authHeader(): string {
  if (!isConfigured()) throw new Error("DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD are not set");
  return "Basic " + Buffer.from(login() + ":" + password()).toString("base64");
}

interface DfsEnvelope<T> {
  status_code?: number;
  status_message?: string;
  tasks?: T[];
}

interface DfsTask {
  id?: string;
  status_code?: number;
  status_message?: string;
  cost?: number;
  data?: Record<string, unknown>;
  result?: Array<{ items?: unknown[] | null }> | null;
}

/**
 * The account itself cannot spend right now: unverified, suspended, or out of funds.
 *
 * ‼️ THIS IS A CONFIGURATION STATE, NOT A DATA FAULT, AND THE DIFFERENCE DECIDES WHETHER A BATCH
 * SURVIVES. Measured on the first live call: a brand new DataForSEO account authenticates fine and
 * answers the free endpoints, then refuses `task_post` with `40104 Please verify your account`.
 * Treated as an ordinary failure that killed the batch, every file dropped before somebody clicked
 * a link in their user panel would have to be re-dropped afterwards. Treated as a state, the batch
 * parks at `scoring` and the next cron tick picks it up by itself the moment the account clears.
 * Same family as `isConfigured()` returning false for a missing key.
 */
export class DataForSeoAccountError extends Error {}

/** Their codes for "the account cannot spend", as opposed to "this request was malformed". */
const ACCOUNT_CODES = new Set([40100, 40101, 40104, 40200, 40201, 40202, 40203]);

function isAccountRefusal(status: number, body: string): boolean {
  if (status === 401 || status === 402) return true;
  const code = /"status_code"\s*:\s*(\d+)/.exec(body);
  return code ? ACCOUNT_CODES.has(Number(code[1])) : false;
}

/**
 * One request, with retries on 5xx ONLY.
 *
 * ‼️ A 4xx IS OUR REQUEST BEING WRONG AND REPEATING IT JUST BURNS THE RATE LIMIT. Only a server
 * fault or a transport failure is worth asking again about. Same split `callClaudeJSON` draws.
 */
async function request<T>(url: string, init: RequestInit, what: string): Promise<DfsEnvelope<T>> {
  const MAX_ATTEMPTS = 3;
  let lastError = "";
  let accountRefusal = false;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        headers: { Authorization: authHeader(), "Content-Type": "application/json", ...(init.headers ?? {}) },
      });
    } catch (e) {
      // A transport failure is a failure to ASK, so it is retried like a 5xx.
      lastError = (e as Error).message;
      if (attempt === MAX_ATTEMPTS) break;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
      continue;
    }

    if (res.ok) return (await res.json()) as DfsEnvelope<T>;

    const body = (await res.text().catch(() => "")).slice(0, 300);
    lastError = res.status + " " + body;
    // 403 carries BOTH "your account is not verified" and ordinary refusals, so the body's
    // status_code is what separates them rather than the HTTP status alone.
    accountRefusal = isAccountRefusal(res.status, body);
    if (res.status < 500) break;
    if (attempt === MAX_ATTEMPTS) break;
    await new Promise((r) => setTimeout(r, 1000 * attempt));
  }

  const message = "dataforseo " + what + " failed: " + lastError;
  throw accountRefusal ? new DataForSeoAccountError(message) : new Error(message);
}

/** The human half of a `DataForSeoAccountError`, for the thread. */
export function accountRefusalHint(message: string): string {
  if (message.includes("40104")) {
    return "The DataForSEO account is not verified yet. Verify it at https://app.dataforseo.com and this batch picks itself up on the next tick, nothing needs re-dropping.";
  }
  if (/402(0[0-3])?/.test(message)) {
    return "The DataForSEO account is out of funds. Top it up and this batch picks itself up on the next tick.";
  }
  return "DataForSEO refused the account rather than the request. Nothing was spent and nothing was lost; fix it at https://app.dataforseo.com and this batch resumes on the next tick.";
}

export interface PostTaskInput {
  /** Our `scraper_rows.id`. Rides along as `tag` so a task can be traced back without our id map. */
  tag: string;
  keyword: string;
  /** Free text like "Charlotte,North Carolina,United States". Falls back to the whole US. */
  locationName?: string | null;
}

export interface PostedTask {
  tag: string;
  taskId: string | null;
  costUsd: number;
  error: string | null;
}

/**
 * Queue up to 100 SERPs. Returns one row per input, in input order.
 *
 * ‼️ A TASK POSTED WHOSE ID IS NEVER STORED IS MONEY SPENT ON A COMPANY THAT NEVER SCORES, and it
 * leaves no trace anywhere. Two things defend that: the `tag` is our row id and DataForSEO echoes
 * it in `data`, so a response can always be matched back even if the array order surprised us; and
 * the caller writes the ids immediately, before doing anything else with them.
 *
 * A per-task failure is returned as a row with a null taskId rather than throwing, because 99 good
 * tasks in one POST must not be lost to the hundredth being malformed.
 */
export async function postTasks(inputs: PostTaskInput[]): Promise<PostedTask[]> {
  if (inputs.length === 0) return [];
  if (inputs.length > TASKS_PER_POST) {
    throw new Error("postTasks: " + inputs.length + " tasks, the ceiling is " + TASKS_PER_POST);
  }

  const body = inputs.map((input) => ({
    keyword: input.keyword.slice(0, 700),
    location_name: input.locationName || "United States",
    language_code: "en",
    depth: 20,
    tag: input.tag,
  }));

  const env = await request<DfsTask>(BASE + "/task_post", { method: "POST", body: JSON.stringify(body) }, "task_post");

  // Match on the echoed tag, never on array position. Position is not contractual and a silent
  // off-by-one here files every SERP against the wrong company.
  const byTag = new Map<string, DfsTask>();
  for (const task of env.tasks ?? []) {
    const tag = task.data && typeof task.data.tag === "string" ? task.data.tag : null;
    if (tag) byTag.set(tag, task);
  }

  return inputs.map((input) => {
    const task = byTag.get(input.tag);
    if (!task) {
      return { tag: input.tag, taskId: null, costUsd: 0, error: "no task came back for this row" };
    }
    const ok = task.status_code === OK || task.status_code === TASK_HANDED;
    return {
      tag: input.tag,
      taskId: ok && task.id ? task.id : null,
      costUsd: typeof task.cost === "number" ? task.cost : 0,
      error: ok ? null : (task.status_code ?? "?") + " " + (task.status_message ?? "unknown"),
    };
  });
}

export type TaskState = "ready" | "pending" | "failed";

export interface TaskResult {
  state: TaskState;
  payload: SerpPayload | null;
  error: string | null;
}

/**
 * Collect one task. Free, and the result stays fetchable for 30 days.
 *
 * ‼️ "STILL IN THE QUEUE" AND "THIS TASK FAILED" ARE DIFFERENT ANSWERS and collapsing them is the
 * expensive mistake here: a pending task read as failed abandons a SERP that was already paid for.
 * 40601/40602 are `pending` and the next tick asks again; everything else non-20000 is `failed`.
 *
 * A 20000 with no result array is `ready` with an empty payload, not an error. It means the SERP
 * genuinely came back with nothing, which `scoreSerp` turns into a null score rather than a zero.
 */
export async function getTask(taskId: string): Promise<TaskResult> {
  let env: DfsEnvelope<DfsTask>;
  try {
    env = await request<DfsTask>(BASE + "/task_get/advanced/" + encodeURIComponent(taskId), { method: "GET" }, "task_get");
  } catch (e) {
    // A failure to ASK is not a verdict. Pending, so the next tick tries again.
    return { state: "pending", payload: null, error: (e as Error).message };
  }

  const task = (env.tasks ?? [])[0];
  if (!task) return { state: "pending", payload: null, error: "no task in the response" };

  if (task.status_code === TASK_IN_QUEUE || task.status_code === TASK_HANDED) {
    return { state: "pending", payload: null, error: null };
  }
  if (task.status_code !== OK) {
    return {
      state: "failed",
      payload: null,
      error: (task.status_code ?? "?") + " " + (task.status_message ?? "unknown"),
    };
  }

  const items = (task.result ?? [])[0]?.items ?? [];
  return { state: "ready", payload: { items: items as SerpPayload["items"] }, error: null };
}
