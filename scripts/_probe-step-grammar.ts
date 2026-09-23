// Does every step thread say what it takes, and does nothing typed at it land nowhere?
//
//   bunx tsx --env-file=.env.local scripts/_probe-step-grammar.ts
//
// Pure except the last section, which reads one client. Nothing writes.
//
// ‼️ THE CHECK THAT MATTERS IS §2. Every thread handler gates on a step key and returns null off it.
// On 2026-09-22 sixteen handlers did that and the wrong-thread pointer knew about six of them, so
// `letter approve` typed in step 11 matched nothing, reached the assistant, and came back as an
// invented Approve button. §2 greps those gates back out of src/ and fails when the step a handler
// gates on carries no spec pointing at that handler. A seventeenth handler cannot quietly become the
// seventh gap: the probe goes red the moment its gate exists and its grammar does not.

import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { supabaseAdmin } from "@/lib/db";
import { DELIVERY_STEPS, stepNumber, type StepKey } from "@/config/delivery-steps";
import {
  ANY_THREAD_COMMANDS,
  STEP_COMMANDS,
  commandish,
  commandsFor,
  grammarLine,
  ownersOf,
  stepsAccepting,
  stepsWithoutGrammar,
  type CommandSpec,
} from "@/lib/clients/step-grammar";
import { commandOwner, misroutedCommand } from "@/lib/clients/step-commands";
import { STEP_ACTIONS } from "@/lib/clients/do-this-now";

let failed = 0;
function check(what: string, ok: boolean, detail = ""): void {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail && !ok ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}

/** Every .ts/.tsx under a directory, with its repo-relative path. */
function sourceFiles(dir: string, acc: Array<[string, string]> = []): Array<[string, string]> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, acc);
    else if (/\.tsx?$/.test(p)) acc.push([p.split("\\").join("/"), readFileSync(p, "utf8")]);
  }
  return acc;
}

/** Every spec in the table, once, with the steps that hold it. */
function allSpecs(): CommandSpec[] {
  const out: CommandSpec[] = [];
  for (const step of DELIVERY_STEPS) {
    for (const spec of STEP_COMMANDS[step.key as StepKey] ?? []) {
      if (!out.includes(spec)) out.push(spec);
    }
  }
  return out;
}

/**
 * Files whose step gate is about a FILE somebody dropped, not about typed words.
 *
 * ‼️ AN ALLOW-LIST, NOT A PATTERN. mascot-art.ts gates on step 18 exactly the way mascot-studio.ts
 * does, but what it claims is an image with a character named beside it. There is no command to put
 * in the table for it, and inventing one would put a word on a card that the thread does not take.
 */
const FILE_GATED = new Set(["src/lib/clients/mascot-art.ts"]);

/**
 * Handlers that deliberately run in EVERY thread of a client.
 *
 * ‼️ EXPLICIT, SO THAT "NO GATE FOUND" CANNOT MEAN "THE PROBE STOPPED WORKING". Without this list a
 * rewritten gate would silently turn §2 green by dropping out of the grep.
 */
const ANY_THREAD_HANDLERS = new Set([
  "src/lib/clients/gap-thread.ts",
  "src/lib/clients/concierge-addon.ts",
]);

async function main() {
  const FILES = sourceFiles("src");
  const SRC = FILES.map(([, body]) => body).join("\n");
  const SPECS = allSpecs();

  // ── 1. Coverage ───────────────────────────────────────────────────────────
  console.log("\n1. every step on the board has an entry");

  const missing = stepsWithoutGrammar();
  check("no step is without an entry", missing.length === 0, missing.join(", "));
  check(
    "the table has exactly the board's steps",
    Object.keys(STEP_COMMANDS).length === DELIVERY_STEPS.length,
    `${Object.keys(STEP_COMMANDS).length} vs ${DELIVERY_STEPS.length}`
  );
  const strays = Object.keys(STEP_COMMANDS).filter((k) => !DELIVERY_STEPS.some((s) => s.key === k));
  check("no entry names a step that does not exist", strays.length === 0, strays.join(", "));

  const withGrammar = DELIVERY_STEPS.filter((s) => (STEP_COMMANDS[s.key as StepKey] ?? []).length);
  console.log(
    `        ${withGrammar.length} of ${DELIVERY_STEPS.length} steps take typed commands; ` +
      `${SPECS.length} distinct commands, ${ANY_THREAD_COMMANDS.length} of them in any thread.`
  );

  // ── 2. Every handler's gate is represented ────────────────────────────────
  console.log("\n2. every step a handler gates on carries that handler's grammar");

  // Resolve `const X = "step_key"` and `const X = new Set([...])` across the whole of src/, so a
  // gate written against a named constant can be read the same way a literal one is.
  const constStep = new Map<string, string>();
  const constSet = new Map<string, string[]>();
  for (const [, body] of FILES) {
    for (const m of body.matchAll(/(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*=\s*"([a-z0-9_]+)"/g)) {
      constStep.set(m[1], m[2]);
    }
    for (const m of body.matchAll(
      /(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*=\s*new Set\(\[([\s\S]*?)\]\)/g
    )) {
      constSet.set(m[1], [...m[2].matchAll(/"([a-z0-9_]+)"/g)].map((x) => x[1]));
    }
  }
  // isSkinStep is a named predicate over one of those sets. Followed by hand because it is the one
  // gate written as a function call rather than as a comparison.
  const SKIN = constSet.get("SKIN_STEPS") ?? [];
  check("SKIN_STEPS resolved", SKIN.length > 0, "isSkinStep gates cannot be read without it");

  /** step key to the handler files that gate on it and return null. */
  const gates = new Map<string, Set<string>>();
  function addGate(step: string, file: string): void {
    if (!DELIVERY_STEPS.some((s) => s.key === step)) return;
    if (!gates.has(step)) gates.set(step, new Set());
    gates.get(step)!.add(file);
  }

  for (const [path, body] of FILES) {
    if (!/^src\/lib\/clients\//.test(path) && !path.endsWith("src/app/api/slack/events/route.ts")) continue;
    if (path.endsWith("src/lib/clients/step-grammar.ts")) continue;

    // `if (input.stepKey !== "x") return null;` and the named-constant form.
    for (const m of body.matchAll(
      /(?:input|args)\.stepKey\s*!==\s*(?:"([a-z0-9_]+)"|([A-Z][A-Z0-9_]*))\)\s*return null/g
    )) {
      addGate(m[1] ?? constStep.get(m[2]) ?? "", path);
    }
    // `if (!args.stepKey || !SET.has(args.stepKey)) return null;`
    for (const m of body.matchAll(/!\s*([A-Z][A-Z0-9_]*)\.has\((?:input|args)\.stepKey\)\)\s*return null/g)) {
      for (const step of constSet.get(m[1]) ?? []) addGate(step, path);
    }
    // `if (!isSkinStep(input.stepKey)) return null;`
    if (/!isSkinStep\((?:input|args)\.stepKey\)\)\s*return null/.test(body)) {
      for (const step of SKIN) addGate(step, path);
    }
    // The inline gates in the events route: `client.stepKey === "x" && /^word$/i.test(userText)`.
    //
    // ‼️ THE REGEX ON userText IS REQUIRED AND IS NOT BELT AND BRACES. The route branches on a step
    // key in five other places that have nothing to do with typed words: routing a research paste,
    // attributing a screenshot to a platform, filing an audit. Matching the key alone made §2 demand
    // a command grammar for presence_sweep_manual and review_audit, whose threads take pictures.
    for (const m of body.matchAll(
      /client\.stepKey\s*===\s*"([a-z0-9_]+)"\s*&&[\s\S]{0,400}?\.test\(userText\)/g
    )) {
      if (path.endsWith("events/route.ts")) addGate(m[1], path);
    }
  }

  check("gates were found at all", gates.size > 0, "the grep stopped matching, which turns §2 green");

  let gateChecks = 0;
  for (const [step, files] of [...gates.entries()].sort()) {
    for (const file of [...files].sort()) {
      if (FILE_GATED.has(file)) continue;
      gateChecks++;
      const specs = STEP_COMMANDS[step as StepKey] ?? [];
      const owned = specs.some((s) => s.implementedIn === file || s.gatedIn === file);
      check(
        `${stepNumber(step as StepKey)}. ${step} carries ${file.replace("src/lib/clients/", "")}`,
        owned,
        "a handler gates on this step and no spec points back at it"
      );
    }
  }
  console.log(`        ${gateChecks} handler gates checked across ${gates.size} steps.`);

  // ── 2b. The probe fails when the probe stops working ──────────────────────
  console.log("\n2b. every thread handler was either gated or declared any-thread");

  for (const [path, body] of FILES) {
    if (!/^src\/lib\/clients\//.test(path)) continue;
    const handlers = [...body.matchAll(/export async function (handle[A-Za-z]*(?:ThreadReply|Reply))\s*\(/g)];
    if (!handlers.length) continue;
    if (ANY_THREAD_HANDLERS.has(path) || FILE_GATED.has(path)) continue;
    const gated = [...gates.values()].some((files) => files.has(path));
    check(
      `${path.replace("src/lib/clients/", "")} is gated on a step`,
      gated,
      `${handlers.map((h) => h[1]).join(", ")} answers in every thread, or its gate stopped matching`
    );
  }

  // ── 3. Every spec's regex lives where it says ─────────────────────────────
  console.log("\n3. every command is implemented where the table says it is");

  for (const spec of [...SPECS, ...ANY_THREAD_COMMANDS]) {
    const head = /([a-z]{3,})/.exec(spec.test.source.replace(/\\[sbdwSBDW]/g, " "));
    const body = FILES.find(([p]) => p.endsWith(spec.implementedIn))?.[1];
    if (!body) {
      check(`\`${spec.label}\` -> ${spec.implementedIn}`, false, "no such file");
      continue;
    }
    check(
      `\`${spec.label}\` -> ${spec.implementedIn.replace("src/lib/clients/", "")}`,
      !head || body.toLowerCase().includes(head[1].toLowerCase()),
      `"${head?.[1]}" is not in that file`
    );
  }

  // ── 4. The printed label is a command the parser would take ───────────────
  console.log("\n4. every label satisfies its own test");

  for (const spec of [...SPECS, ...ANY_THREAD_COMMANDS]) {
    check(`\`${spec.label}\``, spec.test.test(spec.label), "the label drifted from the regex");
  }

  // ── 5. The hand-argued exclusions survived the derivation ─────────────────
  console.log("\n5. the sentences that are NOT commands, carried over from OWNERS");

  for (const t of [
    "mascot ideas please",
    "keywords check",
    "keywords matter less than people think",
    "plan ahead for the call",
    "the review link is broken",
    "mascot spa-otter",
    "the editorial team",
  ]) {
    check(`"${t}" is not a command anywhere`, ownersOf(t) === null, String(ownersOf(t)?.spec.label));
  }

  // ── 6. commandish, both directions ────────────────────────────────────────
  console.log("\n6. what the backstop claims, and what it leaves to the assistant");

  const K = "avatar_harvest" as StepKey;
  for (const [t, want] of [
    ["approve", "move_on"],
    ["done", "move_on"],
    ["next", "move_on"],
    ["move on", "move_on"],
    ["help", "move_on"],
    ["prompt", "this_thread"],
    ["beliefs:", "this_thread"],
    ["letter approve", "this_thread"],
    ["keywords aprove", "shaped"],
    ["letter aprove", "shaped"],
  ] as const) {
    const got = commandish(t, K);
    check(`"${t}" is ${want}`, got?.kind === want, String(got?.kind));
  }

  for (const t of [
    "can you approve this?",
    "I think we are done.",
    "what do you think about the offer",
    "laser hair removal",
    "best keyword ideas",
    "thoughts on the offer",
    "mascot ideas please",
    "1. one\n2. two\n3. three\n4. four\n5. five",
  ]) {
    const got = commandish(t, K);
    check(`"${t.split("\n")[0]}" reaches the assistant`, got === null, String(got?.kind));
  }

  // ── 7. The contracts five other probes already pin ────────────────────────
  console.log("\n7. commandOwner still answers exactly as it did");

  for (const [t, want] of [
    ["ladder pick 4", "pre_call_pages"],
    ["anchor at 4", "pre_call_pages"],
    ["rung 4", "pre_call_pages"],
    ["plan approve", "pre_call_pages"],
    ["guarantee: we fix it free", "pre_call_pages"],
    ["review link: https://g.page/x", "review_card_pdf"],
    ["review platform: Trustpilot", "review_card_pdf"],
    ["terms: AEO, ChatGPT SEO", "offer_locked"],
    ["keywords add:\n1. x", "keyword_set"],
    ["mascot", "concierge_preview"],
    ["mascot concepts", "concierge_preview"],
    ["mascot skip", "concierge_preview"],
  ] as const) {
    check(`"${t.split("\n")[0]}" belongs to ${want}`, commandOwner(t)?.step === want, String(commandOwner(t)?.step));
  }
  check("`letter approve` now has an owner at all", commandOwner("letter approve")?.step === "offer_locked");

  // ── 8. A command several steps accept is misrouted in neither ─────────────
  console.log("\n8. a shared command points only from a thread that does not take it");

  const cid = "00000000-0000-0000-0000-000000000000";
  for (const [step, want] of [
    ["review_card_pdf", false],
    ["referral_engine_handed", false],
    ["referral_engine_preview", false],
    ["offer_locked", false],
    ["nap_sweep", true],
  ] as const) {
    const p = await misroutedCommand({ clientId: cid, stepKey: step, text: "review link: https://g.page/x" });
    check(`review link in ${step} ${want ? "points" : "is at home"}`, Boolean(p) === want);
  }
  for (const [step, want] of [
    ["offer_locked", false],
    ["avatar_harvest", false],
    ["pre_call_pages", true],
  ] as const) {
    const p = await misroutedCommand({ clientId: cid, stepKey: step, text: "letter approve" });
    check(`letter approve in ${step} ${want ? "points" : "is at home"}`, Boolean(p) === want);
  }
  check(
    "the letter is accepted by exactly step 10 and step 11",
    JSON.stringify(stepsAccepting(STEP_COMMANDS.offer_locked.find((s) => s.label === "letter approve")!)) ===
      JSON.stringify(["offer_locked", "avatar_harvest"])
  );

  // ── 9. Where it is wired ──────────────────────────────────────────────────
  console.log("\n9. the order of the branches in the events route");

  const route = readFileSync("src/app/api/slack/events/route.ts", "utf8");
  const at = (s: string) => route.indexOf(s);
  check("the backstop is wired at all", at("unclaimedReply") > 0);
  if (at("unclaimedReply") > 0) {
    check("it runs after the pasted-list pointer", at("pastedListPointer") < at("unclaimedReply"));
    check("it runs after the avatar handler", at("handleAvatarThreadReply") < at("unclaimedReply"));
    check("it runs after the audience handler", at("handleAudienceThreadReply") < at("unclaimedReply"));
    check("it runs after the upload capture", at("captureOnboardingUploads(") < at("unclaimedReply"));
    check("it runs BEFORE the assistant", at("unclaimedReply") < at("askAssistant("));
    // ‼️ THE GATE EXPRESSION, NOT THE BARE CALL. The branch above the assistant explains in a
    // comment why it sits outside this gate, and matching `isAIConfigured()` alone found that
    // comment rather than the `if`.
    check(
      "it is not inside the isAIConfigured gate",
      at("unclaimedReply") < at("&& isAIConfigured()"),
      "with no model key a step thread would fall to the top-level ephemeral instead"
    );
  }

  const brief = readFileSync("src/lib/clients/lead-brief.ts", "utf8");
  check("the brief names the three real buttons", /step_done|\[Done\]/.test(brief) && /I hit a problem/.test(brief));
  check("the brief forbids inventing one", /no Approve button|There is no Approve/i.test(brief));
  check("the brief prints this thread's grammar", /grammarLine/.test(brief));

  // ── 10. The cards and the table agree ─────────────────────────────────────
  console.log("\n10. every command a card names is one its own thread takes");

  const COMMAND = /`([a-z][a-z0-9 _]*:?)(?:\s*<[^`]*>|[^`]*)?`/g;
  for (const step of DELIVERY_STEPS) {
    const key = step.key as StepKey;
    const action = STEP_ACTIONS[key];
    if (!action) continue;
    for (const bullet of action.bullets) {
      // ‼️ A BULLET THAT SAYS WHERE ELSE THE COMMAND GOES IS EXEMPT, AND THAT IS THE POINT RATHER
      // THAN A LOOPHOLE. step 32 names `draft`, `check` and `polish`, which live in the page studio
      // channel and do nothing in this thread. The fix for that is not to hide the words, it is to
      // say where they work. A bullet that names the other place has done exactly that; a bullet
      // that names a command with no such qualifier is still claiming this thread takes it.
      if (/not here|channel|studio/i.test(bullet)) continue;
      for (const m of bullet.matchAll(COMMAND)) {
        const cmd = m[1].trim();
        if (!cmd) continue;
        const takes = commandsFor(key).some((s) => s.test.test(cmd) || s.label.startsWith(cmd));
        check(`${stepNumber(key)}. ${key}: \`${cmd}\``, takes, "named on the card, not taken by this thread");
      }
    }
  }

  console.log("\n10b. every command the table calls card-worthy is on the card");
  // ‼️ THE CARD OF THE STEP IT POINTS AT, NOT OF EVERY STEP THAT TAKES IT. A command's home is one
  // step; the others accept it as a convenience. `letter approve` belongs to step 10 and step 11
  // takes it because step 11 is blocked on it, so step 10's card is the one that has to say so.
  // Demanding it on every accepting card would push three cards past the six-bullet cap to repeat
  // something the backstop's grammar line already prints in full.
  for (const spec of SPECS) {
    if (!spec.mustBeOnTheCard) continue;
    const home = spec.pointAt ?? stepsAccepting(spec)[0];
    const bullets = (STEP_ACTIONS[home]?.bullets ?? []).join(" ");
    const head = spec.label.split(/[<]/)[0].trim().replace(/:$/, "");
    check(`${stepNumber(home)}. ${home} names \`${head}\``, bullets.includes(head), "missing from Do this now");
  }

  // ── 11. The buttons a backstop would re-post ──────────────────────────────
  console.log("\n11. against the live database");

  const { data: srt } = await supabaseAdmin
    .from("clients")
    .select("id")
    .eq("slug", "srt-agency-llc")
    .maybeSingle();

  if (!srt) {
    check("srt-agency-llc resolves", false);
  } else {
    check("srt-agency-llc resolves", true);
    let stepActionBlocks:
      | ((c: string, s: string | null, b: string[]) => Promise<unknown[] | null>)
      | null = null;
    try {
      ({ stepActionBlocks } = await import("@/lib/clients/step-engine"));
    } catch {
      /* not built yet */
    }
    if (!stepActionBlocks) {
      check("stepActionBlocks is exported", false, "step-engine.ts has not been changed yet");
    } else {
      const kit = (await stepActionBlocks(srt.id as string, "avatar_harvest", ["x"])) as Array<
        Record<string, unknown>
      > | null;
      check("a live step renders a kit", Array.isArray(kit) && kit.length > 0);
      if (Array.isArray(kit)) {
        const actions = kit[kit.length - 1] as { type?: string; elements?: Array<Record<string, string>> };
        check("the last block is the buttons", actions?.type === "actions", String(actions?.type));
        const ids = (actions?.elements ?? []).map((e) => e.action_id);
        check(
          "the three standard buttons lead",
          ids.slice(0, 3).join(",") === "step_done,step_skip,step_problem",
          ids.join(",")
        );
        // ‼️ THE THREE STANDARD BUTTONS ONLY. The per-step extras deliberately carry a different
        // value: `avatar_reuse_research` is just the client id, `avatar_pick` is id:slot:label.
        // deliveryStepAction is the one that splits on `clientId:stepKey`, and it handles only
        // these three, so they are the contract a re-posted kit has to keep.
        const bad = (actions?.elements ?? [])
          .filter((e) => ["step_done", "step_skip", "step_problem"].includes(String(e.action_id)))
          .filter((e) => {
            const [c, k] = String(e.value ?? "").split(":");
            return c !== (srt.id as string) || !DELIVERY_STEPS.some((s) => s.key === k);
          });
        check("each standard button carries this client and a real step", bad.length === 0, JSON.stringify(bad));
        const extrasHaveClient = (actions?.elements ?? [])
          .filter((e) => !["step_done", "step_skip", "step_problem"].includes(String(e.action_id)))
          .every((e) => String(e.value ?? "").startsWith(srt.id as string));
        check("each extra button carries this client too", extrasHaveClient);
      }
      check("a null step renders nothing", (await stepActionBlocks(srt.id as string, null, ["x"])) === null);
    }
  }

  // A sample of the copy, so a human reading the run can see what it now says.
  console.log("\n   grammar lines, as a thread would print them:");
  for (const k of ["offer_locked", "avatar_harvest", "keyword_set", "call_booked"] as StepKey[]) {
    console.log(`     ${stepNumber(k)}. ${k}: ${grammarLine(k).slice(0, 150)}`);
  }

  console.log(failed === 0 ? "\nAll checks passed.\n" : `\n${failed} FAILED\n`);
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
