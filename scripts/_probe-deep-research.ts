/**
 * Run step 10's researcher against a client and print what came back.
 *
 * ‼️ THE POINT IS THE WALL CLOCK. The eight sections run in parallel inside a 300s maxDuration
 * with the citations harvest, the PDF render and a Slack round trip sharing that budget. If this
 * says much over ~150s, the section timeout needs lowering or the run needs splitting across cron
 * invocations the way audit/process does — check it here before wiring it to a live board.
 *
 * The second thing to look at is the phrase count. Haiku with the basic web_search tool is the
 * known weak spot: if the ranked list comes back with paraphrases rather than verbatim buyer
 * wording, swap RESEARCH_MODEL and RESEARCH_TOOL in deep-research-run.ts together.
 *
 *   bun scripts/_probe-deep-research.ts <clientId> [--prompt-only]
 *
 * --prompt-only prints the prompt and its character count and exits without spending a token.
 * That is the DEFAULT path since 2026-08-28: the step posts this prompt and runs nothing. The
 * no-flag form below is the `run` keyword, which is now opt-in and is what the wall-clock and
 * phrase-count notes above are about.
 */
const CLIENT_ID = process.argv[2];
const PROMPT_ONLY = process.argv.includes("--prompt-only");

if (!CLIENT_ID) {
  console.error("usage: bun scripts/_probe-deep-research.ts <clientId> [--prompt-only]");
  process.exit(1);
}

// ‼️ THIS `export {}` IS LOAD-BEARING AND MUST NOT BE TIDIED AWAY. Every import in this file is a
// dynamic `await import()` inside main(), so without a top-level import or export TypeScript treats
// the file as a GLOBAL SCRIPT rather than a module. Its `main` then shares one scope with every
// other global-script probe in scripts/, and the second one to exist makes `next build` fail
// repo-wide with "Duplicate function implementation" pointing here, at a file that did not change.
// Making this one a module means a new probe can never break the build by picking the same name.
export {};

async function main() {
  const { buildContext, buildCompactPrompt, runDeepResearch } = await import(
    "../src/lib/clients/artifacts/deep-research-run"
  );

  const built = await buildContext(CLIENT_ID);
  if (!built.ok) {
    console.error(`context refused: ${built.error}`);
    process.exit(1);
  }

  console.log("─".repeat(70));
  console.log(`client:  ${built.ctx.clinicName}`);
  console.log(`avatar:  ${built.ctx.avatarLabel}  (${built.ctx.avatarSlug})`);
  console.log(`vertical:${built.ctx.vertical}`);
  console.log(`seeds:   ${built.ctx.citedDomains.join(", ") || "none"}`);
  console.log(`rivals:  ${built.ctx.namedInstead.join(", ") || "none"}`);
  console.log("─".repeat(70));

  if (PROMPT_ONLY) {
    const prompt = buildCompactPrompt(built.ctx);
    console.log(prompt);
    console.log();
    console.log("─".repeat(70));
    console.log(`${prompt.length} characters. Slack truncates a message over 4,000, and the step`);
    console.log("posts this inside one, so anything near that ceiling is a bug not a preference.");
    return;
  }

  // ‼️ THE HARVEST RUNS FIRST, BECAUSE THAT IS THE ORDER THE REGISTRY USES. The ranker reads
  // question_bank for harvested phrases; skipping this here made the probe measure a run with an
  // empty harvest block, which is not the run production does.
  const { runHarvest } = await import("../src/lib/clients/harvest");
  const h = await runHarvest(CLIENT_ID);
  console.log(`harvest: ok=${h.ok} phrases=${h.phrases ?? 0} pages=${h.pages ?? 0}${h.error ? ` error=${h.error}` : ""}`);

  const started = Date.now();
  const result = await runDeepResearch(CLIENT_ID);
  const elapsed = Math.round((Date.now() - started) / 1000);

  console.log("\n" + "─".repeat(70));
  console.log(`ok:       ${result.ok}`);
  console.log(`elapsed:  ${elapsed}s   ${elapsed > 200 ? "‼️ TOO SLOW for the 300s cascade" : "(fits the cascade)"}`);
  console.log(`docId:    ${result.docId ?? "none"}`);
  if (result.error) console.log(`error:    ${result.error}`);
  console.log("─".repeat(70));
  console.log(result.note ?? "(no note)");

  // What actually landed in the shared corpus, which is what the [Done] gate counts.
  const { supabaseAdmin } = await import("../src/lib/db");
  const { count } = await supabaseAdmin
    .from("question_bank")
    .select("id", { count: "exact", head: true })
    .eq("vertical", built.ctx.vertical)
    .eq("avatar", built.ctx.avatarSlug)
    .eq("source", "deep_research");

  console.log(`\nquestion_bank deep_research rows for this avatar: ${count ?? 0}`);
  console.log(count ? "The [Done] gate is satisfied." : "‼️ The gate will still refuse [Done].");
}

main().catch((e) => {
  console.error("threw:", e);
  process.exit(1);
});
