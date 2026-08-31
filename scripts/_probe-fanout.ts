// Probe: does the OpenAI Responses API actually hand back the fanout queries?
//
// The whole colony lane rests on one assumption: that `web_search_call.action.query`
// is populated on the model the audit engine actually runs. OpenAI's docs hedge
// ("will usually, but not always, include the search queries"), and run-prompts.ts
// defaults to gpt-4.1-mini with OPENAI_AUDIT_MODEL unset in production. So this is
// checked against live output before a single line is built on top of it.
//
// Prints the shape, never the key. Run:  bun scripts/_probe-fanout.ts [model]

import { readFileSync } from "node:fs";
import { join } from "node:path";

function loadEnv(file: string): void {
  let text: string;
  try {
    text = readFileSync(join(process.cwd(), file), "utf8");
  } catch {
    return;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)="?(.*?)"?$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

loadEnv(".env.pulled");
loadEnv(".env.local");

const MODEL = process.argv[2] || process.env.OPENAI_AUDIT_MODEL || "gpt-4.1-mini";

// A realistic local-business prompt, the same shape run-prompts.ts sends
// (city prefix included, exactly as `runOpenAI` builds its input).
const CITY = "Greensboro, NC";
const PROMPT = "What's the best med spa near me for Botox?";

interface Action {
  type?: string;
  query?: string;
  queries?: string[];
  sources?: unknown[];
  [k: string]: unknown;
}
interface OutputItem {
  type?: string;
  action?: Action;
  content?: { type?: string; text?: string; annotations?: { type?: string; url?: string }[] }[];
}

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("OPENAI_API_KEY not set. Run `vercel env pull .env.pulled --environment=production`.");
    process.exit(1);
  }

  console.log(`model:  ${MODEL}`);
  console.log(`prompt: I'm in ${CITY}. ${PROMPT}`);
  console.log("");

  const started = Date.now();
  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      input: `I'm in ${CITY}. ${PROMPT}`,
      tools: [{ type: "web_search" }],
      include: ["web_search_call.action.sources"],
    }),
  });

  const json = (await res.json()) as { output?: OutputItem[]; error?: { message?: string } };
  const ms = Date.now() - started;

  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${json.error?.message ?? "unknown"}`);
    process.exit(1);
  }

  const output = json.output ?? [];
  console.log(`HTTP 200 in ${ms}ms, ${output.length} output items`);
  console.log(`item types: ${output.map((o) => o.type ?? "?").join(", ")}`);
  console.log("");

  const searchCalls = output.filter((o) => o.type === "web_search_call");
  console.log(`=== web_search_call items: ${searchCalls.length} ===`);

  let queriesFound = 0;
  let sourcesFound = 0;
  searchCalls.forEach((item, i) => {
    const action = item.action ?? {};
    console.log(`  [${i}] action keys: ${Object.keys(action).join(", ") || "(none)"}`);
    console.log(`      action.type: ${String(action.type)}`);
    if (typeof action.query === "string") {
      queriesFound++;
      console.log(`      action.query: ${JSON.stringify(action.query)}`);
    }
    if (Array.isArray(action.queries)) {
      queriesFound += action.queries.length;
      console.log(`      action.queries: ${JSON.stringify(action.queries)}`);
    }
    if (Array.isArray(action.sources)) {
      sourcesFound += action.sources.length;
      console.log(`      action.sources: ${action.sources.length} url(s)`);
    }
    if (action.query === undefined && action.queries === undefined) {
      console.log(`      !! no query/queries on this action`);
    }
  });

  const messageItems = output.filter((o) => o.type === "message");
  const citations = new Set<string>();
  for (const item of messageItems) {
    for (const content of item.content ?? []) {
      for (const ann of content.annotations ?? []) {
        if (ann.type === "url_citation" && ann.url) citations.add(ann.url);
      }
    }
  }

  console.log("");
  console.log("=== verdict ===");
  console.log(`fanout queries recovered: ${queriesFound}`);
  console.log(`action.sources urls:      ${sourcesFound}`);
  console.log(`url_citation annotations: ${citations.size}   (what run-prompts.ts stores today)`);
  console.log("");
  if (queriesFound > 0) {
    console.log(`PASS - ${MODEL} returns fanout queries. Piece A is viable as planned.`);
  } else if (searchCalls.length === 0) {
    console.log(`INCONCLUSIVE - the model did not search at all for this prompt. Retry or try another prompt.`);
  } else {
    console.log(`FAIL - ${MODEL} searched but exposed no queries. Try a newer model: bun scripts/_probe-fanout.ts gpt-5.5`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
