// Does every step card end by saying what the person actually has to do?
//
//   bunx tsx --env-file=.env.local scripts/_probe-do-this-now.ts
//
// Pure except for the last section, which reads audience_documents for one client. Nothing writes.
//
// ‼️ THE CHECK THAT MATTERS IS "EVERY COMMAND NAMED IS A REAL ONE". A card that invents a command
// is worse than a card that says nothing: somebody types it, nothing happens, and they stop reading
// the block. So every backticked `thing:` in the table is grepped back out of src/, and a bullet
// that names a command nobody implemented fails this probe.

import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { supabaseAdmin } from "@/lib/db";
import { DELIVERY_STEPS, stepNumber, type StepKey } from "@/config/delivery-steps";
import { STEP_ACTIONS, doThisNowLines, readinessFor, stepsWithoutAnAction } from "@/lib/clients/do-this-now";

let failed = 0;
function check(what: string, ok: boolean, detail = ""): void {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail && !ok ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}

/** Every .ts/.tsx under src/, concatenated once, so the command grep is one pass. */
function allSource(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) allSource(p, acc);
    else if (/\.tsx?$/.test(p)) acc.push(readFileSync(p, "utf8"));
  }
  return acc;
}

// Slack's own budget. bodySections splits on line boundaries under this, so a single block that
// exceeds it cannot be split and fails the whole message.
const SECTION_BUDGET = 2900;

async function main() {
  const SRC = allSource("src").join("\n");

  // ── 1. Coverage ───────────────────────────────────────────────────────────
  console.log("\n1. every step on the board has one");

  const missing = stepsWithoutAnAction();
  check("no step is without an action", missing.length === 0, missing.join(", "));
  check(
    "the table has exactly the board's steps",
    Object.keys(STEP_ACTIONS).length === DELIVERY_STEPS.length,
    `${Object.keys(STEP_ACTIONS).length} vs ${DELIVERY_STEPS.length}`
  );
  const strays = Object.keys(STEP_ACTIONS).filter((k) => !DELIVERY_STEPS.some((s) => s.key === k));
  check("no entry names a step that does not exist", strays.length === 0, strays.join(", "));

  // ── 2. The copy ───────────────────────────────────────────────────────────
  console.log("\n2. what each block says");

  for (const step of DELIVERY_STEPS) {
    const lines = doThisNowLines(step.key as StepKey);
    const block = lines.join("\n");
    const n = stepNumber(step.key as StepKey);

    if (!lines.length) {
      check(`${n}. ${step.key} renders a block`, false);
      continue;
    }
    if (block.includes("—")) {
      check(`${n}. ${step.key} carries no banned dash`, false);
      continue;
    }
    if (block.length > SECTION_BUDGET) {
      check(`${n}. ${step.key} fits one Slack section`, false, `${block.length} chars`);
      continue;
    }
    if (!/^\*Do this now:\*/.test(lines[0])) {
      check(`${n}. ${step.key} leads with the heading`, false, lines[0]);
      continue;
    }
    const bullets = lines.slice(1);
    if (bullets.length < 1 || bullets.length > 6) {
      check(`${n}. ${step.key} has between 1 and 6 bullets`, false, String(bullets.length));
      continue;
    }
    check(`${n}. ${step.key}`, true);
  }

  // ── 3. Every named command is real ────────────────────────────────────────
  console.log("\n3. every command a bullet names exists in the code");

  // A command, as these bullets write them: a backticked phrase of lowercase words, optionally
  // ending in a colon, optionally followed by a placeholder. `<what they sell>` is an argument, not
  // a command, so only the head is checked.
  const COMMAND = /`([a-z][a-z0-9 _]*:?)(?:\s*<[^`]*>|[^`]*)?`/g;
  const seen = new Set<string>();

  for (const [key, action] of Object.entries(STEP_ACTIONS)) {
    for (const bullet of action.bullets) {
      for (const m of bullet.matchAll(COMMAND)) {
        const cmd = m[1].trim();
        if (!cmd || seen.has(`${key}:${cmd}`)) continue;
        seen.add(`${key}:${cmd}`);

        // The literal string has to appear in src/ somewhere: in a regex, a help line, or a parser.
        // Spaces are the fragile part (a regex writes `\s+`), so the first word alone is the floor.
        const head = cmd.split(/[\s:]/)[0];
        const found = SRC.includes(cmd) || SRC.includes(head);
        check(`${key}: \`${cmd}\``, found, "named in a bullet, not found in src/");
      }
    }
  }
  console.log(`        ${seen.size} distinct commands named across the board.`);

  // ── 4. The readiness line ─────────────────────────────────────────────────
  console.log("\n4. the dataset count, where a step carries one");

  const lib = readFileSync("src/lib/clients/do-this-now.ts", "utf8");
  check("a failed read returns null rather than zero", /return null;/.test(lib) && /readiness read failed/.test(lib));
  check("it counts stored kinds, not typed prefixes", /superseded_at/.test(lib));

  const withCount = doThisNowLines("avatar_harvest" as StepKey, {
    readiness: { label: "Documents", have: 2, need: 4, missing: ["short offer", "beliefs"] },
  });
  check(
    "a partial count names what is missing",
    withCount.some((l) => /Documents: 2 of 4\. Still missing: short offer, beliefs\./.test(l)),
    withCount.join(" | ")
  );
  const whole = doThisNowLines("avatar_harvest" as StepKey, {
    readiness: { label: "Documents", have: 4, need: 4, missing: [] },
  });
  check("a full count says so", whole.some((l) => /Documents: 4 of 4\. All in\./.test(l)));
  check(
    "no readiness means no line",
    !doThisNowLines("avatar_harvest" as StepKey).some((l) => /Documents:/.test(l))
  );

  // ── 5. It is wired into the one place every card goes through ─────────────
  console.log("\n5. where it is added");

  const engine = readFileSync("src/lib/clients/step-engine.ts", "utf8");
  check("postStep adds it", /doThisNowLines/.test(engine));
  check(
    "it defers to an arm that already says it",
    /!body\.some\(\(line\) => line\.includes\("\*Do this now:\*"\)\)/.test(engine)
  );
  check(
    "it sits above the Next footer",
    engine.indexOf('line.includes("*Do this now:*")') < engine.indexOf('line.includes("*Next:*")')
  );
  check(
    "it can never fail the card",
    /do-this-now failed for/.test(engine),
    "a stalled board is worse than a card with no block"
  );

  // ── 6. Live, read only ────────────────────────────────────────────────────
  console.log("\n6. against the live database");

  const { data: srt } = await supabaseAdmin
    .from("clients")
    .select("id")
    .eq("slug", "srt-agency-llc")
    .maybeSingle();

  if (!srt) {
    check("srt-agency-llc resolves", false);
  } else {
    check("srt-agency-llc resolves", true);
    const r = await readinessFor(srt.id as string, "avatar_harvest" as StepKey);
    check("the avatar readiness reads", r !== null, "null means the select failed");
    if (r) console.log(`        ${r.label}: ${r.have} of ${r.need}. Missing: ${r.missing.join(", ") || "none"}.`);
    const none = await readinessFor(srt.id as string, "call_held" as StepKey);
    check("a step with no dataset returns null", none === null);
  }

  console.log(failed === 0 ? "\nAll checks passed.\n" : `\n${failed} FAILED\n`);
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
