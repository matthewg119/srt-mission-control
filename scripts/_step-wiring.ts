// Write the two generated board docs: docs/STEP-WIRING.md and docs/ONBOARDING-MAP.md.
//
// Matthew, 2026-09-16: "make sure the MD file specified which step is wired with each step so we can read that md
// file before doing anything else."
//
//   bunx tsx scripts/_step-wiring.ts                       write both static docs
//   bunx tsx scripts/_step-wiring.ts --check                fail when either is out of date (used by the probe)
//   bunx tsx --env-file=.env.local scripts/_step-wiring.ts --live   write docs/ONBOARDING-MAP-MEASURED.md
//
// ‼️ GENERATED, NEVER HAND-EDITED. Step numbers are array positions, so inserting a step renumbers everything
// after it; a hand-written table would be wrong the first time that happened and would keep being read anyway.
// Everything here is read out of the code: the registry, the runners, the verifiers, the card bodies, the extra
// buttons and the thread commands each step's handler accepts.
//
// ‼️ THE TWO STATIC DOCS ARE PRODUCED BY SYNCHRONOUS FUNCTIONS, AND THAT IS THE ENFORCEMENT. You cannot read a
// database synchronously, so no live number can reach a --check'ed file by accident. `--live` is the only async
// arm and the only dynamic import in this file. A measured number inside a --check'ed doc would fail the probe
// every time production changed, which is how a probe becomes something people learn to skip.

import fs from "node:fs";
import path from "node:path";
import { DELIVERY_STEPS, stepNumber, type StepKey } from "../src/config/delivery-steps";
import { STEP_NEEDS, fieldsForStep, stepsBlockedBy, type FieldRef } from "../src/lib/clients/step-needs";
import { gapsFrom, gapLines } from "../src/lib/clients/step-gaps";
import { DATASET_FIELDS, NOTHING_ON_FILE, evaluateDatasets } from "../src/lib/clients/dataset-spec";
import { RESEARCH_SECTION_KEYS } from "../src/lib/clients/artifacts/deep-research-run";
import { held, type LeadContext } from "../src/lib/clients/lead-context";

const root = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

/** ‼️ THE ONLY DOCS --check MAY READ. A live number in either fails the probe forever. */
const CHECKED_DOCS = ["docs/STEP-WIRING.md", "docs/ONBOARDING-MAP.md"] as const;
/** ‼️ NEVER IN CHECKED_DOCS. Line 1 carries the measurement date, so a byte compare is a lie by design. */
const LIVE_DOC = "docs/ONBOARDING-MAP-MEASURED.md";

const REGISTRY_PATH = "src/lib/clients/artifacts/registry.ts";
const VERIFY_PATH = "src/lib/clients/step-verify.ts";

const registry = read(REGISTRY_PATH);
const verify = read(VERIFY_PATH);
const engine = read("src/lib/clients/step-engine.ts");

/**
 * One entry of a `Record<StepKey, async ...>` table: its own body and nothing else.
 *
 * ‼️ IT STOPS AT THE ENTRY'S OWN CLOSING BRACE, NOT AT THE NEXT KEY, AND THE DIFFERENCE IS A
 * DOC-SIZED LIE. Stopping at the next key swallows the comment block written ABOVE that key, and
 * those comments name helpers on purpose: step-verify.ts explains at length why `weekly_report`
 * STOPPED using `artifactOnRecord`, so reading to the next key made step 39 (`time_log_entries`,
 * a plain count query) report "an artifact on record". Measured 2026-09-17, on the first run of
 * this refactor.
 *
 * This replaced a 1400-character window in the registry and a 700-character one in the verifiers.
 * Those numbers were not wrong so much as unfalsifiable: 700 happened to stop before that comment,
 * and nothing said it would keep doing so. An entry at two-space indent closes with `\n  },`; a
 * nested literal inside it closes deeper, so that marker is the entry boundary. The next key is
 * still consulted, for an entry with no block body, and whichever comes first wins.
 */
function bodyOf(source: string, key: string): string | null {
  const start = source.indexOf(`\n  ${key}: async`);
  if (start < 0) return null;
  const rest = source.slice(start + 1);
  const close = rest.indexOf(`\n  },`);
  const next = /\n {2}[A-Za-z0-9_]+: async/.exec(rest);
  const end = Math.min(close < 0 ? rest.length : close, next ? next.index : rest.length);
  return rest.slice(0, end);
}

/** The runner a step has, as the registry names it: the first function its arrow body awaits. */
function runnerFor(key: string): string | null {
  const body = bodyOf(registry, key);
  if (body === null) return null;
  // The imports come first in every arrow body, so they are stripped before the first real call is read.
  const call = /(?:await|return)\s+([A-Za-z0-9_]+)\(/.exec(body.replace(/await\s+import\([^)]*\)/g, ""));
  return call ? call[1] : "an inline runner";
}

/** Which thread commands reach which step. Hand-kept, because a handler decides it in code, not in a table. */
const COMMANDS: Record<string, string[]> = {
  avatar_confirmed: ["`avatar: <label>`", "[Avatar] buttons"],
  avatar_harvest: ["`research:` or a dropped file", "`prompt`, `prompt short`, `run`", "`avatar sheet:`, `short offer:`, `beliefs:`", "`share research`, `share sheet`"],
  offer_locked: ["`offer:`", "`terms:`", "`outcome:`", "`price:`", "[Call now]", "`review platform: <name>`, `review link: <url>`"],
  keyword_set: ["`keywords approve`", "`keywords drop N`", "`keywords add:`", "`keywords more <category>`"],
  custom_question_set: ["`objection: <what they said>`", "`objection: ... | belief: <key>`"],
  hub_preview: ["`universe <name>`", "`template <name>`", "`skin reset`", "`pick 1|2|3`", "paste a screenshot"],
  review_tool_preview: ["`review link: <url>`", "[Paste review link]", "`universe <name>`"],
  review_card_pdf: ["`review link: <url>`", "[Paste review link]"],
  concierge_preview: ["[Include concierge (add-on)] / [Not now, install later]", "[Patient lane] / [Owner lane]", "`concierge install`", "[Character menu] / [Skip, keep the default]", "`mascot`, `mascot concepts`", "`mascot pick a, b, c`, `mascot <key>`, `mascot skip`", "`mascot corner bottom-left`", "paste art with `mascot <key> <state>`"],
  site_replica: ["`universe <name>`", "paste a screenshot"],
  pre_call_pages: [
    "`ladder`, `ladder pick <1-5>`, `anchor at <1-5>`, `ladder problem aware`",
    "`headlines`, `headlines pick 4, 9, 12, ...` (seven)",
    "`emotional:` then one question per line",
    "[Anchor at N], [Pillar N], [Supports: pick for me]",
    "`pillar: <rank>` / `pillar: auto`",
    "`supports: 3, 7, 12` / `supports auto`",
    "`guarantee:`, `outcome:`, `price:`",
    "`plan`, `plan new`, `plan approve`, `plan swap N`, `plan drop N`, `plan edit N: ...`",
    "`anchor`, `anchor: <key>`",
    "`research:` (page batch)",
    "`headline N`, `skeleton N`",
  ],
  concierge_live: ["`concierge install`"],
};

/** A pipe inside a cell ends the cell, so every one is escaped. */
function cell(v: string): string {
  return v.replace(/\|/g, "\\|");
}

function cardCase(key: string): boolean {
  return engine.includes(`case "${key}":`);
}

function verifierKind(key: string): string {
  const body = bodyOf(verify, key);
  if (body === null) return verify.includes(`\n  ${key}:`) ? "yes" : "none";
  if (/artifactOnRecord/.test(body)) return "an artifact on record";
  if (/threadHas|uploadsFor/.test(body)) return "evidence in its thread";
  return "a system check";
}

function table(): string {
  const rows = DELIVERY_STEPS.map((s, i) => {
    const runner = runnerFor(s.key);
    return [
      `| ${i + 1} | \`${s.key}\` | ${s.label} | ${s.phase} | ${s.mode ?? (s.auto ? "auto" : "manual")} |`,
      `${runner ? `\`${runner}()\`` : "none"} | ${verifierKind(s.key)} | ${cardCase(s.key) ? "yes" : "default"} |`,
      `${cell((COMMANDS[s.key] ?? []).join("<br>") || "Done / Skip / I hit a problem")} |`,
      `${(s.blockedBy ?? []).map((b) => `\`${b}\``).join(", ") || "nothing"} |`,
    ].join(" ");
  });
  return [
    "| # | key | label | phase | mode | runner | [Done] checks | card body | what its thread takes | waits on |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// The onboarding map: what each step reads, writes, refuses on, and would ask
// ─────────────────────────────────────────────────────────────────────────────

/** Every .ts under src/, read once, so "who else reads this table" is one pass and not 41. */
function sourceFiles(): Array<{ rel: string; text: string }> {
  const out: Array<{ rel: string; text: string }> = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) out.push({ rel, text: read(rel) });
    }
  };
  walk("src");
  return out;
}

const SRC = sourceFiles();

/** `${...}` is a value this generator cannot know, so it is named as a hole rather than guessed. */
function tidy(s: string): string {
  return s
    .replace(/\$\{[^}]*\}/g, "<...>")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The module a step's runner delegates to, as the registry's own dynamic import names it.
 *
 * Every registry entry is two lines: a dynamic import and a call. The tables a step touches are in
 * THAT module, not in the entry, so the entry is only useful as a pointer to it.
 */
function runnerModule(key: string): string | null {
  const body = bodyOf(registry, key);
  if (body === null) return null;
  const m = /await\s+import\(\s*["']([^"']+)["']\s*\)/.exec(body);
  if (!m) return null;
  const spec = m[1];
  const base = path.posix.dirname(REGISTRY_PATH);
  const rel = spec.startsWith("@/") ? `src/${spec.slice(2)}` : spec.startsWith(".") ? path.posix.normalize(`${base}/${spec}`) : null;
  if (!rel) return null;
  for (const ext of [".ts", ".tsx", "/index.ts"]) {
    if (fs.existsSync(path.join(root, rel + ext))) return rel + ext;
  }
  return null;
}

/**
 * Tables a module touches, split by whether it writes to them.
 *
 * ‼️ MODULE-WIDE, NOT FUNCTION-WIDE, AND THE DOC SAYS SO. Following one exported function's call
 * graph would need a type checker; naming the module's tables is coarser and true. A table counted
 * as written wherever it is also read, because "this step can change this table" is the fact a
 * reader of this map is after.
 */
function tablesIn(source: string): { reads: string[]; writes: string[] } {
  const reads = new Set<string>();
  const writes = new Set<string>();
  const re = /\.from\(\s*["'`]([a-z_]+)["'`]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const after = source.slice(m.index, m.index + 240);
    if (/\.\s*(insert|update|upsert|delete)\s*\(/.test(after)) writes.add(m[1]);
    else reads.add(m[1]);
  }
  for (const w of writes) reads.delete(w);
  return { reads: [...reads].sort(), writes: [...writes].sort() };
}

/**
 * What a verifier says it looked at when it refuses.
 *
 * notYet(checked, found, todo): the first argument is the system's own words for the evidence it
 * went looking for, which is a better answer to "what does this step refuse on" than anything this
 * generator could compose. A ternary is read through to its first branch.
 */
function refusalsIn(body: string): string[] {
  const out: string[] = [];
  const re = /notYet\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const tail = body.slice(m.index + m[0].length, m.index + 500);
    const lit = /^[\s(]*(?:[A-Za-z0-9_.]+\s*\?\s*)?(["'`])([\s\S]*?)\1/.exec(tail);
    if (lit) out.push(tidy(lit[2]));
  }
  return [...new Set(out)].filter(Boolean);
}

/** Files other than the writer that select from a table. A table nobody reads is a finding. */
function readersOf(table: string, exclude: readonly string[]): string[] {
  const needle = new RegExp(`\\.from\\(\\s*["'\`]${table}["'\`]\\s*\\)`);
  return SRC.filter((f) => !exclude.includes(f.rel) && needle.test(f.text) && /\.select\(/.test(f.text)).map((f) => f.rel);
}

/**
 * A context carrying nothing but what gapsFrom reads, with nothing on file.
 *
 * ‼️ gapsFrom TOUCHES EXACTLY TWO FIELDS: `board.steps` for the label and `gaps` for what is
 * missing. Building a whole LeadContext by hand would be forty lines of fiction, so this names the
 * two and casts, and the cast is the documentation. _probe-gaps.ts makes the same cast and runs
 * gapsFrom for real, so a third field would break there loudly rather than here silently.
 */
function everyQuestionContext(): LeadContext {
  return {
    board: { steps: DELIVERY_STEPS.map((s) => ({ key: s.key as StepKey, label: s.label })) },
    gaps: held(evaluateDatasets(NOTHING_ON_FILE, RESEARCH_SECTION_KEYS), {
      source: "dataset-spec",
      why: "no dataset could be evaluated",
    }),
  } as unknown as LeadContext;
}

/** Which step fills which declared field, inverted once so "what does this unblock" is a lookup. */
const DATASET_FILLERS = (() => {
  const out = new Map<string, FieldRef[]>();
  for (const f of DATASET_FIELDS) {
    if (f.filledBy.kind !== "step") continue;
    const list = out.get(f.filledBy.step) ?? [];
    list.push(`${f.dataset}.${f.key}` as FieldRef);
    out.set(f.filledBy.step, list);
  }
  return out;
})();

function mapSections(): string {
  const ctx = everyQuestionContext();
  const blocks: string[] = [];

  for (const step of DELIVERY_STEPS) {
    const key = step.key as StepKey;
    const n = stepNumber(key);
    const modulePath = runnerModule(step.key);
    const runner = runnerFor(step.key);
    const tables = modulePath ? tablesIn(read(modulePath)) : { reads: [], writes: [] };
    const vBody = bodyOf(verify, step.key);
    const vTables = vBody ? tablesIn(vBody) : { reads: [], writes: [] };
    const refusals = vBody ? refusalsIn(vBody) : [];
    const need = STEP_NEEDS[key];
    const { needs, wants } = fieldsForStep(key);

    const waitedOnBy = DELIVERY_STEPS.filter((s) => (s.blockedBy ?? []).includes(step.key)).map((s) => `${stepNumber(s.key as StepKey)} \`${s.key}\``);
    const fills = DATASET_FILLERS.get(step.key) ?? [];
    const unlocks = [...new Set(fills.flatMap((ref) => stepsBlockedBy(ref)))]
      .filter((k) => k !== key)
      .map((k) => `${stepNumber(k)} \`${k}\``)
      .sort();

    const downstream: string[] = [];
    if (waitedOnBy.length) {
      downstream.push(
        waitedOnBy.length === 1
          ? `step ${waitedOnBy[0]} declares it waits on this`
          : `steps ${waitedOnBy.join(", ")} declare they wait on this`
      );
    }
    if (unlocks.length) {
      downstream.push(`the fields it fills unblock step${unlocks.length === 1 ? "" : "s"} ${unlocks.join(", ")}`);
    }
    for (const t of tables.writes) {
      const others = readersOf(t, modulePath ? [modulePath] : []);
      downstream.push(
        others.length
          ? `\`${t}\` is selected in ${others.length} other file(s), e.g. \`${others.slice(0, 3).join("`, `")}\``
          : `‼️ \`${t}\` is written here and **selected nowhere else**`
      );
    }
    if (!downstream.length) downstream.push("nothing downstream declares a dependency on it");

    const questions = gapLines(gapsFrom(ctx, key), Infinity);

    blocks.push(
      [
        `### ${n}. \`${step.key}\``,
        "",
        `${step.label}`,
        "",
        "| | |",
        "| --- | --- |",
        `| Phase, mode | ${step.phase}, ${step.mode ?? (step.auto ? "auto" : "manual")} |`,
        `| Waits on | ${(step.blockedBy ?? []).map((b) => `\`${b}\``).join(", ") || "nothing"} |`,
        `| Runner | ${runner ? `\`${runner}()\`${modulePath ? ` in \`${modulePath}\`` : ""}` : "none"} |`,
        `| Writes | ${tables.writes.map((t) => `\`${t}\``).join(", ") || "nothing"} |`,
        `| Reads | ${cell(tables.reads.map((t) => `\`${t}\``).join(", ") || "nothing")} |`,
        `| [Done] reads | ${vTables.reads.concat(vTables.writes).map((t) => `\`${t}\``).join(", ") || "no table"} |`,
        `| Dataset fields | ${need.kind === "nothing" ? "none: " + need.why : `${needs.length} needed, ${wants.length} wanted`} |`,
        `| Downstream | ${cell(downstream.join("; "))} |`,
        "",
        "**[Done] refuses on:**",
        "",
        refusals.length ? refusals.map((r) => `- ${r}`).join("\n") : "- nothing: this verifier never calls `notYet`",
        "",
        "**What it would have to ask, with nothing on file:**",
        "",
        "```",
        questions.join("\n"),
        "```",
      ].join("\n")
    );
  }

  return blocks.join("\n\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// The paid-pull inventory: every place the system buys something from the web
// ─────────────────────────────────────────────────────────────────────────────

interface PaidPull {
  lane: string;
  file: string;
  /** The exported function that makes the call. Asserted to exist in the file. */
  fn: string;
  provider: string;
  /** Where the raw response survives, as `table.column`, or null when it does not. */
  survives: string | null;
  /**
   * The file that persists it, when that is not the file that fetches it.
   *
   * ‼️ USUALLY A DIFFERENT FILE, AND THAT IS THE POINT. run-prompts.ts buys the answer and
   * run-batch.ts stores it; classify.ts buys and run-audit-pipeline.ts stores. Asserting the
   * fetching file names the table failed on six of these rows, correctly: the gap between buying
   * and keeping is exactly where a raw response gets dropped.
   */
  storedBy?: string;
  /**
   * Why this site is deliberately NOT routed through getOrFetch. Absent means it is still owed.
   *
   * ‼️ A THIRD STATE, BECAUSE "no" AND "no, AND HERE IS WHY" ARE DIFFERENT FACTS. Without it the
   * table reads as twenty-two sites owed, and the next session routes a 2MB homepage blob into a
   * jsonb column that a written decision says must never hold one. An exemption is a decision with
   * a reason attached; a blank is a to-do.
   */
  exempt?: string;
  /**
   * Still owed, and what stopped it, when somebody has actually looked.
   *
   * ‼️ A FOURTH STATE, AND IT EXISTS BECAUSE THE THIRD ONE WAS BEING MISUSED. An exemption says "we
   * decided not to"; this says "we tried, and here is the shape of the problem". The three rows
   * carrying it are all two-phase providers: the money goes at a post or a submit and the answer
   * arrives at a later collect or a webhook, so getOrFetch, whose fetch() must RETURN the payload,
   * cannot wrap either half on its own.
   *
   * Writing it down is the point. Wrapping the collect half keyed on the task id would flip the
   * grepped column to "yes" and save nothing at all, and the next reader would see a routed lane
   * and move on. A blank row invites that; this row refuses it.
   */
  owedWhy?: string;
}

/**
 * Declared, because no grep can find them all.
 *
 * ‼️ A `fetch(` CENSUS WAS TRIED FIRST AND IT LIED. Matching `fetch("https://...")` under src/lib
 * and src/app/api returns forty files and MISSES run-prompts.ts, dataforseo.ts, outscraper.ts and
 * site-research.ts, every one of which builds its URL in a variable or goes through a timeout
 * wrapper. A completeness check that silently omits the four biggest spenders is worse than none.
 *
 * The census below keys on CREDENTIALS instead: a provider you pay needs a key, so a new provider
 * is a new credential-shaped env var, and one that is classified nowhere fails --check by name.
 */
const PAID_PULLS: readonly PaidPull[] = [
  { lane: "audit engine", file: "src/lib/audit-engine/run-prompts.ts", fn: "runOpenAI", provider: "openai responses + web_search", survives: "audit_runs.raw_response", storedBy: "src/lib/audit-engine/run-batch.ts" },
  { lane: "audit engine", file: "src/lib/audit-engine/search-research.ts", fn: "researchViaSearch", provider: "openai", survives: "client_datasets.payload" },
  { lane: "audit engine", file: "src/lib/audit-engine/claude-research.ts", fn: "researchViaClaudeDetailed", provider: "anthropic + web_search", survives: "client_datasets.payload" },
  { lane: "audit engine", file: "src/lib/audit-engine/classify.ts", fn: "classifyBusiness", provider: "anthropic", survives: "audit_reports.classification", storedBy: "src/lib/audit-engine/run-audit-pipeline.ts" },
  { lane: "audit engine", file: "src/lib/audit-engine/extract-recommended.ts", fn: "extractRecommendedBatch", provider: "anthropic", survives: "audit_runs.recommended", storedBy: "src/lib/audit-engine/run-batch.ts" },
  { lane: "audit engine", file: "src/lib/audit-engine/intel-brief.ts", fn: "getIntelBrief", provider: "anthropic + web_search", survives: "niche_briefs.brief" },
  { lane: "audit engine", file: "src/lib/audit-engine/site-research.ts", fn: "researchWebsite", provider: "the prospect's own site", survives: "audit_reports.site_crawl", storedBy: "src/lib/audit-engine/run-audit-pipeline.ts", exempt: "SiteResearch carries homepageHtml, 150KB to 2MB of raw markup. storableCrawl() drops it from audit_reports.site_crawl for that exact reason, and four live readers still need it in memory, so neither the full shape nor the stored shape can be the cached payload" },
  { lane: "audit engine", file: "src/lib/audit-engine/robots-check.ts", fn: "checkRobots", provider: "the prospect's own robots.txt", survives: "audit_reports.robots_check", storedBy: "src/lib/audit-engine/run-audit-pipeline.ts" },
  { lane: "shared", file: "src/lib/claude-calls.ts", fn: "callClaudeJSON", provider: "anthropic", survives: null, exempt: "a generic transport for 75 callers, not a question. Caching here would serve one module's generation to another and freeze deliberately varied output; the callers that ARE stable questions cache themselves, which is what claude-research.ts does" },
  { lane: "onboarding", file: "src/lib/clients/artifacts/deep-research-run.ts", fn: "runDeepResearch", provider: "anthropic + web_search", survives: "question_bank" },
  { lane: "onboarding", file: "src/lib/clients/harvest.ts", fn: "runHarvest", provider: "the client's own site", survives: "question_bank" },
  { lane: "onboarding", file: "src/lib/clients/doc-text.ts", fn: "docTextsFor", provider: "our own storage bucket", survives: "client_datasets.payload", storedBy: "src/lib/data/dataset-cache.ts" },
  { lane: "onboarding", file: "src/lib/clients/site-intel.ts", fn: "gatherSiteIntel", provider: "rdap + the client's own site", survives: "clients" },
  { lane: "onboarding", file: "src/lib/clients/geocode.ts", fn: "geocodeAddress", provider: "us census geocoder", survives: "clients.market_center_lat", storedBy: "src/lib/clients/provision.ts" },
  { lane: "onboarding", file: "src/lib/clients/voice-notes.ts", fn: "transcribeAudio", provider: "openai whisper", survives: "client_docs.transcript" },
  { lane: "scraper", file: "src/lib/scraper/dataforseo.ts", fn: "postTasks", provider: "dataforseo", survives: null , owedWhy: "‼️ TWO-PHASE, AND THAT IS WHY IT IS STILL OWED AFTER THE OTHERS LANDED. The money goes at task_post and the answer arrives at a later task_get, so getOrFetch, whose fetch() must return the payload, cannot wrap either half alone. Wrapping task_get keyed on the task id would flip this column to yes and save nothing, because a task id is minted fresh on every post. The real unit is the SERP for {keyword, location, language, depth}, consulted BEFORE posting, which needs a read half and a write half rather than one read-through door" },
  { lane: "scraper", file: "src/lib/outscraper.ts", fn: "submitMapsSearch", provider: "outscraper", survives: "raw_leads.raw", storedBy: "src/lib/scraper/pull.ts" , owedWhy: "‼️ TWO-PHASE VIA WEBHOOK. submitMapsSearch returns only a requestId; the results arrive at the webhook handler minutes later, so the function that spends the money never sees the answer. Same missing shape as dataforseo: the payload has to be filed at the handler under the question the submit asked" },
  { lane: "scraper", file: "src/lib/scraper/millionverifier.ts", fn: "uploadEmails", provider: "millionverifier", survives: "scraper_rows.mv_result", storedBy: "src/lib/scraper/store.ts" , owedWhy: "‼️ TWO-PHASE, AND A DIFFERENT UNIT AGAIN. Upload, poll, download: billed per row, so the cacheable question is one EMAIL ADDRESS, while the API's unit is a file. Routing it means splitting a file result back into per-address answers as it lands" },
  { lane: "scraper", file: "src/lib/scraper/mx.ts", fn: "hasMx", provider: "cloudflare dns-over-https", survives: "client_datasets.payload", storedBy: "src/lib/data/dataset-cache.ts" },
  { lane: "scraper", file: "src/lib/scraper/enrich.ts", fn: "enrichOne", provider: "site crawl (ours, free). No paid rung signed", survives: "raw_leads.enrich_attempts + sendable_leads.attempts", storedBy: "src/lib/scraper/listprep.ts", owedWhy: "‼️ THE FIRST SINGLE-PHASE PULL IN THIS TABLE, AND THEREFORE THE FIRST GENUINELY ROUTABLE ONE. Unlike dataforseo, outscraper and millionverifier, the function that spends the cost (a page fetch) also SEES the answer, and a business's published email is a stable answer keyed on one website URL. Nothing structural is in the way; it simply has not been routed through getOrFetch yet. ‼️ AND IT INTRODUCES NO CREDENTIAL, so PULL_CREDENTIALS does not grow and `--check` will NOT fail by name on this row. It is owed by memory alone, which is exactly why it is written down here" },
  { lane: "media", file: "src/lib/providers/image-gen.ts", fn: "generateImages", provider: "openai images, higgsfield, elevenlabs", survives: null, exempt: "returns image bytes and URLs, not a JSON answer, and a second render of the same prompt is wanted rather than deduplicated" },
  { lane: "media", file: "src/lib/reel/motion-adapter.ts", fn: "getMotionAdapter", provider: "elevenlabs, fal.ai, higgsfield", survives: null, exempt: "returns MP4 bytes. Same reason as image-gen" },
  { lane: "hub", file: "src/lib/hub/vercel-domains.ts", fn: "attachHost", provider: "vercel domains", survives: "client_hosts", storedBy: "src/lib/hub/vercel-domains.ts", exempt: "a mutation, not a pull: it attaches a domain. Caching a write would skip the write" },
];

/**
 * Credential-shaped env vars that do NOT buy data from a provider, and why.
 *
 * ‼️ EVERY ONE IS CLASSIFIED OR --check FAILS BY NAME. This is the anti-rot half: a provider added
 * next month arrives with a key, and a key nobody has classified stops the build of this doc.
 */
const NOT_A_PULL: Record<string, string> = {
  AUDIT_INTERNAL_SECRET: "our own routes authenticating to each other",
  CRON_SECRET: "our own cron authenticating to our own routes",
  CLIENT_LINK_SECRET: "signs the preview tokens we mint",
  MEDSPA_LINK_SECRET: "signs our own funnel links",
  FUNNEL_NOTIFY_SECRET: "our own funnel calling our own route",
  PLAYBOOK_UPDATE_SECRET: "our own route",
  REEL_RENDER_SECRET: "our own render service",
  LEAD_THREAD_API_KEY: "our own lead-thread route",
  SPEED_TO_LEAD_API_KEY: "our own speed-to-lead route",
  SUPABASE_SERVICE_ROLE_KEY: "our own database",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "our own database",
  SLACK_BOT_TOKEN: "Slack is where we talk, not somewhere we buy data",
  SLACK_SIGNING_SECRET: "verifies Slack's signature on the way in",
  TELEGRAM_BOT_TOKEN: "a chat transport",
  MICROSOFT_CLIENT_SECRET: "our own mailbox and OneDrive",
  MS_CALENDAR_CLIENT_SECRET: "our own calendar",
  CALENDLY_API_TOKEN: "our own booking calendar",
  RC_APP_CLIENT_SECRET: "our own phone system",
  RC_WEBPHONE_CLIENT_SECRET: "our own phone system",
  STRIPE_SECRET_KEY: "taking money, not spending it",
  STRIPE_WEBHOOK_SECRET: "verifies Stripe's signature on the way in",
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "public by design, and it takes money rather than spending it",
  META_ADS_TOKEN: "our own ad account",
  META_CAPI_TOKEN: "sends conversions out, pulls nothing in",
  FB_APP_SECRET: "verifies Meta's signature on the way in",
  FB_PAGE_ACCESS_TOKEN: "our own page",
  FB_WEBHOOK_VERIFY_TOKEN: "verifies Meta's webhook handshake",
  GITHUB_TOKEN: "our own repository",
  HUB_VERCEL_TOKEN: "our own hosting, and its pull site is inventoried above",
  AIRTABLE_API_TOKEN: "our own base",
  AIRTABLE_WEBHOOK_SECRET: "verifies Airtable's signature on the way in",
  IMESSAGE_WEBHOOK_SECRET: "verifies our own bridge on the way in",
  LOOPMESSAGE_AUTH_KEY: "a message transport",
  LOOPMESSAGE_SECRET_KEY: "a message transport",
  LOOPMESSAGE_WEBHOOK_SECRET: "verifies LoopMessage on the way in",
  OUTSCRAPER_WEBHOOK_SECRET: "verifies Outscraper's callback; the pull itself is inventoried above",
  REACHINBOX_WEBHOOK_SECRET: "verifies ReachInbox on the way in",
};

/** Credentials that belong to a provider we buy from. Each must appear in PAID_PULLS' providers. */
const PULL_CREDENTIALS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "DATAFORSEO_PASSWORD",
  "OUTSCRAPER_API_KEY",
  "MILLIONVERIFIER_API_KEY",
  "ELEVENLABS_API_KEY",
  "FAL_KEY",
  "HF_CREDENTIALS",
];

/** Every credential-shaped env var actually referenced in src/. */
function credentialsInUse(): string[] {
  const found = new Set<string>();
  const re = /process\.env\.([A-Z0-9_]*(?:API_KEY|_KEY|_TOKEN|_SECRET|CREDENTIALS|_PASSWORD))/g;
  for (const f of SRC) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(f.text)) !== null) found.add(m[1]);
  }
  return [...found].sort();
}

function paidPullSection(): string {
  const problems: string[] = [];

  // ‼️ THE DECLARATION IS VERIFIED, NOT TRUSTED. A rename that leaves this table behind is exactly
  // how an inventory becomes decoration.
  for (const p of PAID_PULLS) {
    if (!fs.existsSync(path.join(root, p.file))) {
      problems.push(`${p.file} does not exist`);
      continue;
    }
    const text = read(p.file);
    if (!text.includes(p.fn)) problems.push(`${p.file} does not contain ${p.fn}`);
    const table = p.survives?.split(".")[0];
    const keeper = p.storedBy ?? p.file;
    if (table) {
      if (!fs.existsSync(path.join(root, keeper))) problems.push(`${keeper} does not exist, but the inventory says it stores ${table}`);
      else if (!read(keeper).includes(table)) problems.push(`${keeper} never names ${table}, but the inventory says the response survives there`);
    }
  }

  const unclassified = credentialsInUse().filter((c) => !(c in NOT_A_PULL) && !PULL_CREDENTIALS.includes(c));
  for (const c of unclassified) {
    problems.push(`${c} is a credential nobody has classified: add it to PULL_CREDENTIALS or to NOT_A_PULL with a reason`);
  }

  if (problems.length) {
    console.error("The paid-pull inventory is out of date:");
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  const withDoor = PAID_PULLS.filter((p) => {
    const body = read(p.file);
    return /getOrFetch\s*[<(]/.test(body);
  });

  const exempt = PAID_PULLS.filter((p) => p.exempt);
  const owed = PAID_PULLS.filter((p) => !p.exempt && !/getOrFetch\s*[<(]/.test(read(p.file)));

  const rows = PAID_PULLS.map((p) => {
    const routed = /getOrFetch\s*[<(]/.test(read(p.file));
    const through = routed
      ? "**yes**"
      : p.exempt
        ? `no, deliberately: ${p.exempt}`
        : p.owedWhy
          ? `**owed**: ${p.owedWhy}`
          : "**owed**";
    const where = p.survives
      ? `\`${p.survives}\`${p.storedBy && p.storedBy !== p.file ? `, written by \`${p.storedBy}\`` : ""}`
      : "**nowhere**";
    return `| ${p.lane} | \`${p.file}\` | \`${p.fn}()\` | ${p.provider} | ${cell(through)} | ${where} |`;
  });

  return [
    `**${PAID_PULLS.length} sites: ${withDoor.length} through \`getOrFetch()\`, ${exempt.length} deliberately exempt, ${owed.length} still owed.**`,
    "",
    "‼️ **An exemption is a decision, not a to-do.** `site-research.ts` carries `homepageHtml`, 150KB",
    "to 2MB of raw markup that `storableCrawl()` already drops from `audit_reports.site_crawl` for",
    "that exact reason, and four live readers still need it in memory; caching it would put the one",
    "blob this system has a written decision against into a jsonb column. `claude-calls.ts` is a",
    "transport for 75 callers rather than a question. Routing either one would be a regression that",
    "looks like progress, so the reason travels in the table.",
    "",
    "‼️ **An owed row that says WHY is a row somebody has looked at.** The three scraper providers",
    "below are all two-phase: the money goes at a `task_post` or a `submit`, and the answer arrives",
    "at a later collect or a webhook. `getOrFetch`'s `fetch()` has to RETURN the payload, so it",
    "cannot wrap either half on its own, and wrapping the collect half keyed on the task id would",
    "flip the grepped column to yes while saving nothing, because a task id is minted fresh on every",
    "post. Routing them needs a read half and a write half against the same table and the same key",
    "discipline, which is a door this repo does not have yet.",
    "",
    "Every row is declared and then verified: the file has to exist, it has to contain the named",
    "function, and the file claimed to keep the response has to name that table. The `getOrFetch`",
    "column is grepped and never written by hand, so a lane routed through the door flips its own",
    "column in this table the moment the code lands.",
    "",
    "‼️ **Buying and keeping are usually different files**, and that gap is where a raw response",
    "gets dropped. `run-prompts.ts` buys the fanout answer and `run-batch.ts` stores it;",
    "`classify.ts` buys the classification and `run-audit-pipeline.ts` stores it. The first version",
    "of this check asserted the fetching file named the table and failed on six rows, correctly.",
    "",
    "| lane | file | call | provider | through the door | raw response survives |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
    "A pull that survives **nowhere** is bought and thrown away. `select kind, sum(cost_usd) from",
    "client_datasets group by 1` is only a real number once every row above says yes.",
    "",
    "### The census behind this table",
    "",
    "A `fetch(\"https://...\")` grep was tried first and it lied: forty files, missing `run-prompts.ts`,",
    "`dataforseo.ts`, `outscraper.ts` and `site-research.ts`, every one of which builds its URL in a",
    "variable or goes through a timeout wrapper. A completeness check that omits the four biggest",
    "spenders is worse than no check.",
    "",
    "So the census keys on credentials instead. A provider you pay needs a key, so a new provider is a",
    "new credential-shaped env var, and one classified neither as a paid provider nor as something",
    "else fails `--check` **by name**. There is no way to add a paid provider to this repo quietly.",
  ].join("\n");
}

const MAP_DOC = `# The onboarding map

**Generated by \`bunx tsx scripts/_step-wiring.ts\`. Do not edit by hand.** Its companion
\`docs/STEP-WIRING.md\` says what runs each step; this file says what each step needs, what it
touches, what it refuses on, and every question it would have to ask to become completable.

Nothing here is authored. The questions are \`gapLines()\` run against a client who has answered
nothing, so this file and a step's Slack card cannot disagree: they are the same function. The
fields come from \`STEP_NEEDS\` in \`src/lib/clients/step-needs.ts\`, which is
\`Record<StepKey, StepNeed>\` and therefore fails the build until a new step says what it needs.

**Read this before adding a step, a field or a question.** A step whose output nothing reads is
either dead or a gap, and both are findings; the Downstream row is where that shows up.

## How to read it

- **Writes / Reads** are the tables the runner's MODULE touches, not just the function the registry
  names. Following one function's call graph would need a type checker; naming the module is
  coarser and true. A table appears under Writes wherever it is also read.
- **[Done] refuses on** is the first argument of every \`notYet()\` in that step's verifier: the
  system's own words for the evidence it went looking for.
- **What it would have to ask** is every ask, not the first five. A card prints at most five; this
  file passes \`Infinity\` because it has no card to overflow.
- Live row counts are NOT here. They are in \`docs/ONBOARDING-MAP-MEASURED.md\`, which carries its
  measurement date on line 1 and is deliberately not checked for drift.

## Every place the system buys something from the web

${paidPullSection()}

## The steps

${mapSections()}
`;

// ─────────────────────────────────────────────────────────────────────────────

const DOC = `# The board, step by step

**Generated by \`bunx tsx scripts/_step-wiring.ts\`. Do not edit by hand.** Step numbers are positions in
\`src/config/delivery-steps.ts\`, so inserting a step renumbers every step after it. Read this file before
changing anything about a step: it says what runs it, what its [Done] checks, and what its thread accepts.

What each step NEEDS, and every question it would have to ask, is its companion \`docs/ONBOARDING-MAP.md\`.

## Re-running a step

| where | what to type | what happens |
| --- | --- | --- |
| in a step's thread | \`rerun\` | that step runs again, its card updates in place, notes land in the same thread |
| anywhere in the client's channel | \`rerun step 13\` | step 13 runs again with a NEW card at the bottom of the channel |
| anywhere in the client's channel | \`rerun 18-21\` | each step in the range, in order, each with a new card at the bottom |

The old thread is kept and gets one line linking to the new card. A re-run clears the tick, the verification and
any error, then runs the step's runner; it never deletes a decision a person made (approved keywords, a picked
anchor, a frozen \`custom_v1\`). Steps with no runner just get their card again.

Every re-run then says what that step is still missing, in the step's own thread: \`gapLines\`' own bullets, and
under them any EARLIER step that is declared to write one of the missing fields, with \`rerun N\` and a button for
it. It proposes and never re-runs anything itself. A step with everything on file says so, because silence would
mean either that or a block that failed to render.

Behind it: \`src/lib/clients/step-rerun.ts\`, \`src/lib/clients/rerun-gaps.ts\` (pure) and
\`/api/internal/rerun-steps\` (one step per request, because a range is minutes of work).

## Every step

${table()}

## The files a step touches

- **The list itself:** \`src/config/delivery-steps.ts\` (order, phase, mode, blockedBy). \`stepNumber()\` is the
  only honest source of a step's number.
- **Runners:** \`src/lib/clients/artifacts/registry.ts\` maps a step key to the function that generates it.
- **[Done]:** \`src/lib/clients/step-verify.ts\`, one verifier per step key, and the build fails without one.
- **Cards:** \`src/lib/clients/step-engine.ts\` (\`instructionsFor\` for the body, \`extraActionsFor\` for buttons).
- **Threads:** \`src/app/api/slack/events/route.ts\` dispatches to each step's handler; a command typed in the
  wrong thread gets a pointer from \`src/lib/clients/step-commands.ts\`.
- **The board in Slack:** \`src/lib/clients/step-board.ts\` (anchors, marks, \`notifyStep\`).
`;

/**
 * Compare the TEXT, not the line endings.
 *
 * ‼️ core.autocrlf=true MAKES THIS CHECK FAIL ON EVERY WINDOWS CHECKOUT OTHERWISE, and it fails
 * claiming drift that does not exist. Git materialises the file with CRLF, writeFileSync produces LF,
 * so a byte comparison reports all 77 lines changed on a file nobody has touched. Measured 2026-09-17:
 * 11,925 bytes on disk against 11,848 generated, a difference of exactly one byte per line. A probe
 * that cries drift on a clean tree is one people learn to skip, which is worse than not having it.
 */
const CR = String.fromCharCode(13);
const sameText = (a: string, b: string) => a.split(CR).join("") === b.split(CR).join("");

/** Write it, or report whether it is current. Returns false only when --check found drift. */
function writeOrCheck(rel: string, body: string, checking: boolean): boolean {
  const out = path.join(root, rel);
  if (!checking) {
    fs.writeFileSync(out, body);
    console.log(`wrote ${rel}`);
    return true;
  }
  const current = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : "";
  if (!sameText(current, body)) {
    console.error(`${rel} is out of date. Run: bunx tsx scripts/_step-wiring.ts`);
    return false;
  }
  console.log(`${rel} is current`);
  return true;
}

const BODIES: Record<(typeof CHECKED_DOCS)[number], string> = {
  "docs/STEP-WIRING.md": DOC,
  "docs/ONBOARDING-MAP.md": MAP_DOC,
};

async function main(): Promise<void> {
  const checking = process.argv.includes("--check");
  const live = process.argv.includes("--live");

  if (live && checking) {
    console.error(`${LIVE_DOC} is never checked: it changes every time production does.`);
    process.exit(2);
  }

  if (live) {
    // ‼️ THE ONLY ASYNC ARM AND THE ONLY DYNAMIC IMPORT. Everything above is synchronous, which is
    // what makes it impossible for a live number to reach a --check'ed doc.
    const { measuredMap } = await import("./_onboarding-map-live");
    const got = await measuredMap();
    if (!got.ok) {
      console.error(got.error);
      process.exit(1);
    }
    fs.writeFileSync(path.join(root, LIVE_DOC), got.body);
    console.log(`wrote ${LIVE_DOC}`);
    return;
  }

  // ‼️ BOTH DOCS ARE REPORTED BEFORE EXITING. A check that stops at the first failure teaches people
  // to regenerate twice and read neither verdict.
  let ok = true;
  for (const rel of CHECKED_DOCS) ok = writeOrCheck(rel, BODIES[rel], checking) && ok;
  if (!ok) process.exit(1);
  if (!checking) console.log(`${DELIVERY_STEPS.length} steps`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
