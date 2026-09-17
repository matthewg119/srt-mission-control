// Does the board ask for what is missing, and only for what is missing?
//
//   bunx tsx --env-file=.env.local scripts/_probe-gaps.ts
//
// Sections 1 to 6 are pure: the declaration, the copy, and a context built by hand. Section 7 reads
// production for one client. Nothing writes.
//
// ‼️ THE TWO CHECKS THAT MATTER. First, every command a gap names must exist in src/: a card that
// invents a command is worse than a card that says nothing, because somebody types it, nothing
// happens, and they stop reading the block. Second, a field already on file must never be asked for
// again: that is the entire promise of scanning before asking, and it is the one a person notices
// being broken on the very first card.

import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { supabaseAdmin } from "@/lib/db";
import { DELIVERY_STEPS, stepNumber, type StepKey } from "@/config/delivery-steps";
import { DATASET_FIELDS, evaluateDatasets, type DatasetReport, type DatasetSnapshot, type FieldSpec } from "@/lib/clients/dataset-spec";
import { RESEARCH_SECTION_KEYS } from "@/lib/clients/artifacts/deep-research-run";
import { commandOwner } from "@/lib/clients/step-commands";
import {
  STEP_NEEDS,
  fieldFor,
  fieldsForStep,
  stepsBlockedBy,
  stepsWithNothing,
  unknownFieldRefs,
  type FieldRef,
} from "@/lib/clients/step-needs";
import { gapLines, gapsFrom, type StepGaps } from "@/lib/clients/step-gaps";
import { gapPromptMessage, gapPromptOfferLine, gapPromptsFor } from "@/lib/clients/gap-prompts";
import { leadContext, ALL_SLICES, held, missing, type LeadContext } from "@/lib/clients/lead-context";

let failed = 0;
function check(what: string, ok: boolean, detail = ""): void {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail && !ok ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}

/** Every .ts/.tsx under src/, concatenated once. Same one pass _probe-do-this-now.ts makes. */
function allSource(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) allSource(p, acc);
    else if (/\.tsx?$/.test(p)) acc.push(readFileSync(p, "utf8"));
  }
  return acc;
}

/** Slack's real ceiling is 3000 and bodySections splits under 2900. */
const SECTION_BUDGET = 2900;

/** A newline, without an escape. Escapes are how three regexes in this file got mangled. */
const NL = String.fromCharCode(10);

/**
 * A context carrying nothing but what gapsFrom reads.
 *
 * ‼️ gapsFrom TOUCHES EXACTLY TWO FIELDS: `board.steps` for the label, and `gaps` for what is missing.
 * Building the whole LeadContext by hand would be forty lines of fiction that rot the moment a field
 * is added, so this names the two and casts, and the cast is the documentation.
 */
function contextWith(reports: DatasetReport[], readable = true): LeadContext {
  return {
    board: { steps: DELIVERY_STEPS.map((s) => ({ key: s.key as StepKey, label: s.label })) },
    gaps: readable
      ? held(reports, { source: "dataset-spec", why: "no dataset could be evaluated" })
      : missing("unreadable", "the datasets could not be evaluated"),
  } as unknown as LeadContext;
}

/**
 * A client who has answered nothing, evaluated for real.
 *
 * ‼️ REAL REASONS, NOT INVENTED ONES. The command check below is only worth running against the
 * sentences dataset-spec actually writes; a synthetic reason would assert that the probe's own
 * placeholder exists in src/, which is true and meaningless.
 */
const NOTHING_ANSWERED: DatasetSnapshot = {
  audience: { label: "probe", isPrimary: true, stance: "patient", hasVocabulary: false, buyerMarket: null, hardLines: 0, confirmedAt: null },
  avatar: { researchText: null, vocQuotes: 0, approvedNumbers: 0, keywordRows: 0, keywordRowsWithUrl: 0 },
  offer: { applies: true, treatment: null, terms: 0, positioning: null, magnetKey: null, lockedAt: null, outcomePromise: null, price: null },
  documents: { avatarSheet: null, shortOffer: null, beliefs: 0, letterApproved: false },
  audit: { linked: true, pickedAvatar: false, buyerMap: false },
  reviews: 0,
};

function emptyReports(): DatasetReport[] {
  return evaluateDatasets(NOTHING_ANSWERED, RESEARCH_SECTION_KEYS);
}

/** One report whose gaps are exactly the named fields. Everything else counts as on file. */
function reportsMissing(refs: readonly FieldRef[]): DatasetReport[] {
  const specs = refs.map(fieldFor).filter((f): f is FieldSpec => f !== null);
  return (["avatar", "audience", "offer"] as const).map((dataset) => {
    const mine = specs.filter((f) => f.dataset === dataset);
    return {
      dataset,
      total: DATASET_FIELDS.filter((f) => f.dataset === dataset).length,
      present: 0,
      gaps: mine.map((field) => ({ field, reason: `\`${field.key}:\` in this thread`, blocking: false })),
    };
  });
}

async function main() {
  const SRC = allSource("src").join("\n");

  // ── 1. The declaration covers the board ───────────────────────────────────
  console.log("\n1. every step is declared");

  check(
    "the table has exactly the board's steps",
    Object.keys(STEP_NEEDS).length === DELIVERY_STEPS.length,
    `${Object.keys(STEP_NEEDS).length} vs ${DELIVERY_STEPS.length}`
  );
  const strays = Object.keys(STEP_NEEDS).filter((k) => !DELIVERY_STEPS.some((s) => s.key === k));
  check("no entry names a step that does not exist", strays.length === 0, strays.join(", "));

  // ‼️ THE CHECK THAT STOPS THE SLOWEST ROT. A renamed key in dataset-spec.ts would silently delete a
  // step's requirement, and the step would go on reporting that it needs nothing at all.
  const unknown = unknownFieldRefs();
  check("every ref names a declared field", unknown.length === 0, unknown.join(", "));

  // The two declarations must agree: a field that says it blocks a step is a field that step needs.
  let blockMismatch = 0;
  for (const f of DATASET_FIELDS) {
    for (const step of f.blocks ?? []) {
      const ref = `${f.dataset}.${f.key}` as FieldRef;
      if (!stepsBlockedBy(ref).includes(step as StepKey)) {
        blockMismatch++;
        check(`${ref} declares blocks=${step} and the step needs it`, false);
      }
    }
  }
  check("every declared `blocks` is also a `needs`", blockMismatch === 0);

  // ── 2. The steps that ask for nothing ─────────────────────────────────────
  console.log("\n2. the steps that ask for nothing, and why");

  const nothing = stepsWithNothing();
  const empty = nothing.filter((n) => !n.why.trim() || /TODO|FIXME|\?\?\?/i.test(n.why));
  check("every one says why", empty.length === 0, empty.map((e) => e.key).join(", "));
  console.log(`        ${nothing.length} of ${DELIVERY_STEPS.length} steps ask for no dataset field:`);
  for (const n of nothing) console.log(`          ${n.key.padEnd(26)} ${n.why}`);

  // ── 3. Every command named is a real one ──────────────────────────────────
  console.log(`
3. the commands`);

  // Every command a card could print, taken from the gaps a client who has answered nothing produces.
  const named = new Map<string, StepKey>();
  for (const step of DELIVERY_STEPS) {
    const key = step.key as StepKey;
    const g = gapsFrom(contextWith(emptyReports()), key);
    for (const gap of g.gaps) for (const cmd of gap.fill.commands) if (!named.has(cmd)) named.set(cmd, key);
  }
  check("the board names commands at all", named.size > 0, `${named.size}`);
  console.log(`        ${named.size} distinct command(s) named across the board`);

  for (const [cmd] of named) {
    // Deliberately loose, the same floor _probe-do-this-now.ts sets: spaces are the fragile part
    // because a regex writes \s+, so the first word alone is what is asserted.
    const head = cmd.split(/[\s:]/)[0];
    check(`\`${cmd}\` exists in src/`, SRC.includes(cmd) || SRC.includes(head));
  }

  // ‼️ AND IT MUST BE TYPED WHERE THE CARD SENDS SOMEBODY. step-commands.ts owns the wrong-thread
  // pointer; a command the card names that misroutedCommand would bounce is a card telling a person
  // to type something that answers "nothing was saved".
  for (const [cmd] of named) {
    const owner = commandOwner(cmd);
    if (!owner) continue; // Not a thread command at all (a button, or a word inside a sentence).
    check(`\`${cmd}\` is owned by a real step`, DELIVERY_STEPS.some((s) => s.key === owner.step), owner.step);
  }

  // ── 4. A field on file is never asked for again ───────────────────────────
  console.log("\n4. it does not ask for what we already hold");

  const sheetRef = "avatar.age_range" as FieldRef;
  const withGap = gapsFrom(contextWith(reportsMissing([sheetRef])), "avatar_harvest" as StepKey);
  check("a missing field is asked for", withGap.gaps.some((x) => x.ref === sheetRef));

  const nothingMissing = gapsFrom(contextWith(reportsMissing([])), "avatar_harvest" as StepKey);
  check("a field on file is not asked for", !nothingMissing.gaps.some((x) => x.ref === sheetRef));
  check("and the step then reports it is complete", nothingMissing.gaps.length === 0, `${nothingMissing.gaps.length} gaps`);
  check(
    "and says so rather than printing an empty list",
    gapLines(nothingMissing).some((l) => /has everything it needs/.test(l))
  );

  // ── 5. A missing field is never filled with a default ─────────────────────
  console.log("\n5. nothing is invented");

  const src = readFileSync("src/lib/clients/step-gaps.ts", "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/\/\/[^\n]*/g, "");
  check("no gap value is coalesced to a placeholder", !/\.value\s*\?\?/.test(code));
  check("it never writes", !/\.\s*(insert|update|upsert|delete|rpc)\s*\(/.test(code));
  // Every rendered line must trace to a reason dataset-spec wrote, never to a literal here.
  const invented = gapLines(withGap).filter((l) => /\bTODO\b|\bTBD\b|unknown field/i.test(l));
  check("no rendered line invents a placeholder", invented.length === 0, invented[0] ?? "");

  // ── 6. Every step renders, inside the budget, with no em dash ─────────────
  console.log("\n6. the copy, for all 41");

  for (const step of DELIVERY_STEPS) {
    const key = step.key as StepKey;
    const g = gapsFrom(contextWith(emptyReports()), key);
    const lines = gapLines(g);
    const block = lines.join("\n");
    const n = stepNumber(key);
    if (!lines.length) check(`step ${n} ${key} says something`, false);
    if (block.includes("—")) check(`step ${n} ${key} has no em dash`, false, block.slice(0, 60));
    if (block.length > SECTION_BUDGET) check(`step ${n} ${key} fits a Slack section`, false, `${block.length} chars`);
  }
  check("every step renders a block", true);
  check("no block carries an em dash", true);
  check("every block fits one Slack section", true);

  // An unreadable dataset is never rendered as a question.
  const unreadable = gapsFrom(contextWith([], false), "avatar_harvest" as StepKey);
  check("an unreadable dataset produces no questions", unreadable.gaps.length === 0);
  check("and says it could not be read", gapLines(unreadable).some((l) => /could not be read/.test(l)));
  check("and names no arrow", !gapLines(unreadable).some((l) => l.includes("→")));

  // ── 7. Live ───────────────────────────────────────────────────────────────
  console.log("\n7. against the real client");

  const { data: srt } = await supabaseAdmin.from("clients").select("id").eq("slug", "srt-agency-llc").maybeSingle();
  if (!srt) {
    check("srt-agency-llc resolves", false, "no row for that slug");
    return done();
  }
  check("srt-agency-llc resolves", true);
  const ctx = await leadContext((srt as { id: string }).id, { include: ALL_SLICES });

  const eleven = gapsFrom(ctx, "avatar_harvest" as StepKey);
  const asks = (g: StepGaps) => g.gaps.map((x) => x.ref);
  // ‼️ THE WHOLE W2 CONTRACT IN ONE ASSERTION. SRT pasted its deep research and has pasted nothing
  // else, so the card must ask for the three documents and must NOT ask for the research.
  check("it asks for the avatar sheet", asks(eleven).includes("avatar.age_range" as FieldRef));
  check("it asks for the short offer", asks(eleven).includes("offer.big_idea" as FieldRef));
  check("it asks for the beliefs", asks(eleven).includes("offer.necessary_beliefs" as FieldRef));
  check(
    "it does NOT ask for the research already on file",
    !asks(eleven).includes("avatar.who_buys" as FieldRef),
    "the deep research is stored and was asked for anyway"
  );

  console.log(`\n        step 11 says:\n`);
  for (const l of gapLines(eleven)) console.log(`          ${l}`);

  // The step the board is parked on, and the one stuck at `running`. Neither may throw.
  for (const key of ["pre_call_pages", "review_card_pdf"] as StepKey[]) {
    let ok = true;
    try {
      gapLines(gapsFrom(ctx, key));
    } catch {
      ok = false;
    }
    check(`${key} returns a list rather than throwing`, ok);
  }

  const twentyOne = gapsFrom(ctx, "pre_call_pages" as StepKey);
  // Production's own refusal on this step names the beliefs: "0 necessary beliefs".
  check(
    "step 21 names the beliefs, which is what production refuses on",
    asks(twentyOne).includes("offer.necessary_beliefs" as FieldRef)
  );
  console.log(`\n        step 21 says:\n`);
  for (const l of gapLines(twentyOne)) console.log(`          ${l}`);

  // ── 8. The prompts handed back ────────────────────────────────────────────
  console.log(`
8. the prompts it hands back`);

  const built = await gapPromptsFor((srt as { id: string }).id, "avatar_harvest" as StepKey, ctx);
  if (!built.ok) {
    check("prompts are offered for step 11", false, built.error);
  } else {
    check("prompts are offered for step 11", built.prompts.length > 0, `${built.prompts.length}`);
    const research = built.prompts.find((p) => p.key === "research");
    check("one of them is the research prompt", Boolean(research));

    if (research) {
      // ‼️ THE NUMBERS ARE THE CONTRACT. The paste parser maps section N to RESEARCH_SECTION_KEYS[N-1],
      // so a partial prompt renumbered from 1 would file section 10's answer as section 1's. SRT has
      // sections 1 to 9 on file, so the prompt must start at 10 and must NOT contain a "1." ask.
      // ‼️ THE NUMBERS ARE THE CONTRACT. The paste parser maps section N to RESEARCH_SECTION_KEYS[N-1],
      // so a partial prompt renumbered from 1 would file section 10's answer under section 1. SRT has
      // sections 1 to 9 on file, so this prompt must start at 10 and must not carry a "1." ask.
      // Written with a newline constant rather than a regex literal: the escape is the fragile part.
      check("it keeps the original section numbers", research.body.includes(NL + "10. "), research.body.slice(-200));
      check(
        "it does not ask for a section already on file",
        !research.body.includes(NL + "1. "),
        "section 1 is answered and was asked for anyway"
      );
      // The whole point of pre-filling: it carries what we already own about this lead.
      check("it carries the lead's own facts", research.body.includes("SRT Agency"));
      check("it says the numbers are deliberate", research.body.includes("sequential on purpose"));
    }

    for (const p of built.prompts) {
      check(`\`${p.key}\` prompt has a body`, p.body.trim().length > 40, `${p.body.length} chars`);
      check(`\`${p.key}\` prompt says how to send it back`, /\`/.test(p.pasteBack), p.pasteBack);
      if (p.body.includes("—")) check(`\`${p.key}\` prompt has no em dash`, false);
    }
    check("no prompt carries an em dash", !built.prompts.some((p) => p.body.includes("—")));

    // A prompt is thousands of characters, so it is its own message and never part of a card.
    const msg = gapPromptMessage(built.prompts[0]);
    check("the message is fenced so it copies whole", msg.includes("```"));
    const line = gapPromptOfferLine(built.prompts);
    check("the card line stays one line", Boolean(line && !line.includes(String.fromCharCode(10))), line ?? "null");
    check("and fits a Slack section", Boolean(line && line.length < SECTION_BUDGET));
  }

  done();
}

function done(): void {
  console.log(failed === 0 ? "\nAll checks passed.\n" : `\n${failed} FAILED\n`);
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
