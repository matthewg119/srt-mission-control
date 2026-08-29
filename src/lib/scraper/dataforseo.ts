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
// ‼️ ONE "SERP" IS 10 RESULTS, SO `depth: 20` COSTS TWO OF THEM: $0.0012 PER QUERY, NOT $0.0006.
// Measured on the first live task_post, which returned `cost: 0.0012`. Depth 20 is kept anyway and
// the reason is the denominator rule this lane is built on: the directories component counts
// citations in the top TEN ORGANIC results, and a depth-10 request spends its ten slots on ads,
// a local pack and a knowledge graph as well as organic, so it routinely returns seven or eight
// organic rows. Scoring those as "the top 10" undercounts citations and makes an established
// business look invisible, which pushes it into the scrape pile. Paying six hundredths of a cent
// to actually see the ten results being counted is the cheap side of that trade.
//
// ‼️ A BUSINESS COSTS UP TO $0.0027, NOT $0.0012, SINCE THE GBP OPTIMIZATION AUDIT WAS ADDED. One
// SERP at depth 20 ($0.0012) plus one my_business_info profile lookup ($0.0015), so the real budget
// is about $2.70 per 1,000-company batch and `maxQueriesPerBatch` counts BUSINESSES rather than
// calls. Less than that in practice: the profile call only fires for a row whose SERP handed back a
// cid, and a row with no knowledge_graph never gets one.
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
import type { GbpProfile } from "./gbp-audit";

/**
 * The endpoints this lane uses. Same task_post/task_get shape, same queue, same billing rule, so
 * they share one client rather than getting a second copy of the retry policy, the account-refusal
 * split and the tag matching.
 *
 *   serp_organic  $0.0012 / query at depth 20   the dominance score
 *   gbp_info      $0.0015 / profile             the optimization score
 *
 * So a business costs up to $0.0027 all in, and less in practice, because the profile call only
 * fires for a row whose SERP handed back a cid.
 */
export type DfsEndpoint = "serp_organic" | "gbp_info";

/**
 * ‼️ THE COLLECT PATH IS PER ENDPOINT AND IT IS NOT `/advanced/` EVERYWHERE. The SERP API offers
 * result levels, so it collects at `task_get/advanced/{id}`. business_data has ONE level and
 * collects at `task_get/{id}`; asking it for `/advanced/` answers HTTP 404 `40400 Not Found`.
 *
 * Measured on the first live profile call, and it is the worst-shaped failure this client can have:
 * the task was created and the account was CHARGED $0.0015, and then every collection 404'd. A 404
 * is a 4xx, so `request` correctly does not retry it, `getTaskRaw` correctly reports `pending`
 * rather than inventing a verdict, and the row would have been re-polled on every tick for thirty
 * days while the money was already gone. Nothing errors anywhere. Same family as the 20100 bug: the
 * only thing that finds these is a live call.
 */
const ENDPOINTS: Record<DfsEndpoint, { base: string; collect: string }> = {
  serp_organic: {
    base: "https://api.dataforseo.com/v3/serp/google/organic",
    collect: "/task_get/advanced/",
  },
  gbp_info: {
    base: "https://api.dataforseo.com/v3/business_data/google/my_business_info",
    collect: "/task_get/",
  },
};

/**
 * Their list price for one profile lookup, for the ESTIMATE line only.
 *
 * What is RECORDED is always the `cost` the response itself carries, the same rule the SERP path
 * follows. A constant is what we expected to pay; `task.cost` is what we were actually billed, and
 * only one of those belongs in a spend column.
 */
export const GBP_INFO_COST_USD = 0.0015;

/** One SERP at depth 20, which is two of their 10-result units. See the depth note in the header. */
export const SERP_QUERY_COST_USD = 0.0012;

/**
 * What one business costs at most: one SERP plus one profile lookup.
 *
 * The ceiling, not the average. A row whose SERP returned no knowledge_graph has no cid, so no
 * profile task is ever posted for it and it costs the SERP alone. Used for the estimate printed in
 * a cap refusal, so the number a person sees is the same one the constants say.
 */
export const BUSINESS_COST_USD = SERP_QUERY_COST_USD + GBP_INFO_COST_USD;

/** Their per-POST ceiling. Over it the whole call is rejected with 40006, not truncated. */
export const TASKS_PER_POST = 100;

/** Status codes that are not failures. 20000 is done; 40602 is "still queued, ask again". */
const OK = 20000;
const TASK_IN_QUEUE = 40602;
const TASK_HANDED = 40601; // "Task Handed" - accepted and running, same meaning to us as 40602.

/**
 * ‼️ `task_post` ANSWERS 20100 "Task Created", NOT 20000, AND THE ACCOUNT IS ALREADY CHARGED WHEN
 * IT DOES. Measured on the first live call after the account was verified: the task was created
 * correctly, billed, and this client threw the id away because it was only accepting 20000. That is
 * precisely the failure the `tag` and the immediate id write exist to prevent, arriving through the
 * one door nobody had checked. It produces NO error anywhere: money leaves, no company ever scores,
 * and the batch just reports everything as not measured.
 *
 * 20000 is kept alongside it because it is the documented generic success and costs nothing to
 * accept.
 */
const TASK_CREATED = 20100;

export function isTaskAccepted(statusCode: number | undefined): boolean {
  return statusCode === TASK_CREATED || statusCode === OK || statusCode === TASK_HANDED;
}

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
 * ‼️ IT COUNTS BUSINESSES, NOT CALLS, and it has done since the GBP audit was added. Each business
 * costs one SERP ($0.0012 at depth 20) plus at most one profile lookup ($0.0015), so the default
 * 1000 is about $2.70 per batch rather than $1.20. Businesses rather than dollars because the price
 * is theirs to change and the count is the thing a person can sanity-check against a file they just
 * dropped. See the depth note in the header before "correcting" any of these figures downward.
 *
 * The name is kept: renaming an env var Matthew already has set in Vercel to buy a more accurate
 * word would silently reset the cap to its default on the next deploy.
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
  return postTasksTo(
    "serp_organic",
    inputs.map((input) => ({
      tag: input.tag,
      body: {
        keyword: input.keyword.slice(0, 700),
        location_name: input.locationName || "United States",
        language_code: "en",
        depth: 20,
      },
    }))
  );
}

export interface DfsPostInput {
  /** Our `scraper_rows.id`. Rides along as `tag` so a task can be traced back without our id map. */
  tag: string;
  /** The per-endpoint half of the task object. `tag` is added here so no caller can forget it. */
  body: Record<string, unknown>;
}

/**
 * Queue up to 100 tasks against any of the endpoints above. Returns one row per input, in input order.
 *
 * This is `postTasks`'s old body with the SERP-specific fields lifted out into the caller. Nothing
 * about the accounting changed: the ceiling, the tag matching, `isTaskAccepted` and the `cost` read
 * are the same lines they were, which is the point of extending this file rather than writing a
 * second client for business_data.
 */
export async function postTasksTo(
  endpoint: DfsEndpoint,
  inputs: DfsPostInput[]
): Promise<PostedTask[]> {
  if (inputs.length === 0) return [];
  if (inputs.length > TASKS_PER_POST) {
    throw new Error("postTasksTo: " + inputs.length + " tasks, the ceiling is " + TASKS_PER_POST);
  }

  const body = inputs.map((input) => ({ ...input.body, tag: input.tag }));

  const env = await request<DfsTask>(
    ENDPOINTS[endpoint].base + "/task_post",
    { method: "POST", body: JSON.stringify(body) },
    endpoint + " task_post"
  );

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
    const ok = isTaskAccepted(task.status_code);
    return {
      tag: input.tag,
      taskId: ok && task.id ? task.id : null,
      costUsd: typeof task.cost === "number" ? task.cost : 0,
      error: ok ? null : (task.status_code ?? "?") + " " + (task.status_message ?? "unknown"),
    };
  });
}

export interface GbpPostInput {
  tag: string;
  /**
   * ‼️ AN EXACT-PROFILE KEY, `cid:...` or `place_id:...`, AND NEVER A COMPANY NAME. Built by
   * `buildProfileKeyword`. A name search silently returns a different business with a similar name
   * in a nearby city and then scores somebody else's profile against this lead: nothing errors,
   * every column fills in, and the card is about the wrong company.
   */
  keyword: string;
}

/**
 * Queue up to 100 Google Business Profile lookups.
 *
 * ‼️ `language_name` AND `location_name` ARE BOTH REQUIRED, EVEN THOUGH THE KEYWORD IS AN EXACT cid.
 * Measured on the first live call: omitting them answers `40501 Invalid Field: 'language_name'` and
 * the whole POST is rejected. That failure is the SAFE kind, which is worth writing down: the task
 * is refused before it is created, so `taskId` is null and `cost` is 0, and the null-id guard in the
 * caller means nothing is stored and nothing is spent. Compare 20100, where the opposite is true.
 *
 * There is no `depth`: business_data does not take one, and it would be meaningless here anyway.
 */
export async function postGbpInfoTasks(inputs: GbpPostInput[]): Promise<PostedTask[]> {
  return postTasksTo(
    "gbp_info",
    inputs.map((input) => ({
      tag: input.tag,
      body: {
        keyword: input.keyword.slice(0, 700),
        language_name: "English",
        location_name: "United States",
      },
    }))
  );
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
  const raw = await getTaskRaw("serp_organic", taskId);
  if (raw.state !== "ready") {
    return { state: raw.state, payload: null, error: raw.error };
  }
  const first = (raw.result ?? [])[0] as { items?: unknown[] | null } | undefined;
  return { state: "ready", payload: { items: (first?.items ?? []) as SerpPayload["items"] }, error: null };
}

export interface RawTaskResult {
  state: TaskState;
  /** `task.result` whole, undecoded. Each endpoint puts its payload somewhere different inside it. */
  result: unknown[] | null;
  error: string | null;
}

/**
 * Collect one task from any endpoint. This is `getTask`'s old body with one change: it hands back
 * `task.result` WHOLE instead of reaching into `result[0].items`.
 *
 * That matters because business_data does not nest its payload under `items` the way the SERP
 * endpoint does, and a shared decoder that assumed it would return an empty profile for every row
 * with no error anywhere. Each caller decodes its own shape, right above where it knows what it
 * asked for.
 */
export async function getTaskRaw(endpoint: DfsEndpoint, taskId: string): Promise<RawTaskResult> {
  let env: DfsEnvelope<DfsTask>;
  try {
    env = await request<DfsTask>(
      ENDPOINTS[endpoint].base + ENDPOINTS[endpoint].collect + encodeURIComponent(taskId),
      { method: "GET" },
      endpoint + " task_get"
    );
  } catch (e) {
    // A failure to ASK is not a verdict. Pending, so the next tick tries again.
    return { state: "pending", result: null, error: (e as Error).message };
  }

  const task = (env.tasks ?? [])[0];
  if (!task) return { state: "pending", result: null, error: "no task in the response" };

  if (task.status_code === TASK_IN_QUEUE || task.status_code === TASK_HANDED) {
    return { state: "pending", result: null, error: null };
  }
  if (task.status_code !== OK) {
    return {
      state: "failed",
      result: null,
      error: (task.status_code ?? "?") + " " + (task.status_message ?? "unknown"),
    };
  }

  return { state: "ready", result: (task.result ?? []) as unknown[], error: null };
}

export interface GbpInfoResult {
  state: TaskState;
  /** The profile object, or null. Null with state `ready` means Google returned no profile. */
  payload: GbpProfile | null;
  error: string | null;
}

/**
 * Collect one Google Business Profile lookup.
 *
 * ‼️ BOTH PLAUSIBLE SHAPES ARE ACCEPTED, and that is the cheapest insurance available on a response
 * nobody in this repo has read yet. DataForSEO nests some business_data payloads at
 * `result[0].items[0]` and returns others as `result[0]` itself. Reading only one of them would
 * leave every profile component unmeasured on every row, with no error anywhere and a score quietly
 * computed off the two things we could still see. That is the `google_reviews` failure exactly, one
 * endpoint over, so it gets the `RATING_TYPES` treatment: widen WHERE we look, never loosen what
 * counts as measured.
 *
 * A `ready` with no profile is `payload: null` and NOT an error. It means Google has no profile
 * under that key, which is a real finding rather than a failure to look.
 */
export async function getGbpInfoTask(taskId: string): Promise<GbpInfoResult> {
  const raw = await getTaskRaw("gbp_info", taskId);
  if (raw.state !== "ready") return { state: raw.state, payload: null, error: raw.error };

  const first = (raw.result ?? [])[0];
  if (!first || typeof first !== "object") return { state: "ready", payload: null, error: null };

  const wrapper = first as { items?: unknown[] | null };
  const nested = Array.isArray(wrapper.items) ? wrapper.items[0] : null;
  const profile = nested && typeof nested === "object" ? nested : first;

  return { state: "ready", payload: profile as GbpProfile, error: null };
}
