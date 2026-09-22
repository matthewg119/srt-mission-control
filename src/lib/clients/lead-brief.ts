// What the assistant is told about the lead before it answers.
//
// Matthew, 2026-09-16, in SRT's own step 21 thread, typed `generate pages` and was told "No med spa
// client in the system yet." Nine minutes earlier the same tail answered `anchor at 4` with an
// invented seven rung ladder and an offer to snooze a lead until 4pm.
//
// ‼️ NEITHER WAS A ROUTING BUG. `generate pages` is not a registered grammar anywhere, so it fell
// through the whole handler chain to the in-lane assistant tail, correctly. The tail then called
// askAssistant() with a general system prompt and a chat history and NOTHING about the client whose
// channel it was standing in, so the model went looking with its own lookup tools and reported what
// it found: nothing. The answer was not wrong about the search. It was answering a different
// question from the one a person standing in SRT's step 21 thread had asked.
//
// This file is that missing half. It is the ONLY thing between leadContext and the system prompt.
//
// ‼️ PURE. No DB, no network, no model call. It renders a LeadContext somebody else read.
//
// ‼️ IT REPORTS, IT DOES NOT SUMMARISE. Every line is a fact with a state attached: on file, stale,
// or missing and why. A brief that flattened "missing" into silence would let the model read an
// absence as a thing it simply had not been told, which is how it fills one in.

import type { StepKey } from "@/config/delivery-steps";
import { stepNumber } from "@/config/delivery-steps";
import { isHeld, type Held, type LeadContext } from "./lead-context";
import { gapsFrom, gapLines } from "./step-gaps";
import { grammarLine } from "./step-grammar";

/** Long enough to carry the board, short enough to leave room for the conversation. */
const MAX_CHARS = 6000;

/** One field, as one line, with its state said out loud. */
function line(label: string, h: Held<unknown>, render: (v: never) => string): string {
  if (h.state === "missing") return `- ${label}: NOT ON FILE (${h.because}). ${h.why}`;
  const body = render(h.value as never);
  return h.state === "stale" ? `- ${label}: ${body} (STALE: ${h.why})` : `- ${label}: ${body}`;
}

function plain(label: string, h: Held<string>): string {
  return line(label, h, (v: never) => String(v));
}

/**
 * The lead, for a system prompt.
 *
 * `stepKey` is the thread's step when there is one. It is not decoration: the same question means
 * different things in step 11's thread and step 21's, and the gap list is per step.
 */
export function leadBrief(ctx: LeadContext, stepKey: StepKey | null): string {
  const out: string[] = [];

  out.push("## The client this channel belongs to");
  out.push("");
  out.push(`- Name: ${ctx.identity.name}`);
  out.push(plain("Website", ctx.identity.domain));
  out.push(plain("Vertical", ctx.identity.vertical));
  out.push(plain("City", ctx.identity.city));

  // ── Where the board is ──
  out.push("");
  out.push("## The board");
  out.push("");
  if (isHeld(ctx.board.cursor)) {
    const k = ctx.board.cursor.value;
    out.push(`- The next step that can be worked on is ${stepNumber(k)}, \`${k}\`.`);
  } else {
    out.push("- No step is currently reachable.");
  }
  if (stepKey) {
    const step = ctx.board.steps.find((s) => s.key === stepKey);
    out.push(`- THIS THREAD IS STEP ${stepNumber(stepKey)}, \`${stepKey}\`${step ? `, status ${step.status}` : ""}.`);
  } else {
    out.push("- This thread is the client's header thread, not one step.");
  }
  const blocked = ctx.board.blocked.slice(0, 5);
  if (blocked.length) {
    out.push(`- Blocked: ${blocked.map((b) => `${stepNumber(b.key)} waits on ${b.on.map((k) => stepNumber(k)).join(", ")}`).join("; ")}`);
  }

  // ── What is on file ──
  out.push("");
  out.push("## What is on file");
  out.push("");
  out.push(`- Audiences: ${ctx.audiences.length}${ctx.primaryAudience ? `, primary "${ctx.primaryAudience.row.label}"` : ""}`);

  if (ctx.primaryOffer) {
    out.push(plain("The offer", ctx.primaryOffer.treatment));
    out.push(plain("Offer locked", ctx.primaryOffer.locked));
    out.push(line("Anchored at rung", ctx.primaryOffer.anchorStage, (v: never) => String(v)));
  } else {
    out.push("- The offer: NOT ON FILE. No client_offers row exists for the primary audience.");
  }

  out.push(
    line("Awareness ladder", ctx.ladder, (v: never) => {
      const l = v as unknown as { rungs: readonly unknown[]; anchoredAt: number | null };
      return `${l.rungs.length} rung(s), anchored at ${l.anchoredAt ?? "nothing yet"}`;
    })
  );
  out.push(
    line("Necessary beliefs", ctx.beliefs, (v: never) => {
      const b = v as unknown as readonly { id: string; text: string }[];
      return `${b.length} on file: ${b.map((x) => `${x.id} ${x.text}`).join(" | ").slice(0, 600)}`;
    })
  );

  for (const [kind, doc] of Object.entries(ctx.documents)) {
    out.push(line(`Document ${kind}`, doc, () => "on file"));
  }

  out.push(
    line("Keywords", ctx.keywords, (v: never) => {
      const k = v as unknown as { total: number; approved: number; byRole: Record<string, number> };
      const roles = Object.entries(k.byRole)
        .map(([r, n]) => `${r}=${n}`)
        .join(", ");
      return `${k.total} total, ${k.approved} approved${roles ? `, roles: ${roles}` : ", no role picked on any of them"}`;
    })
  );

  out.push(
    line("Pages", ctx.pages, (v: never) => {
      const p = v as unknown as readonly { status: string }[];
      if (!p.length) return "none have been drafted";
      const by = new Map<string, number>();
      for (const x of p) by.set(x.status, (by.get(x.status) ?? 0) + 1);
      return [...by].map(([s, n]) => `${n} ${s}`).join(", ");
    })
  );

  out.push(
    line("Research pulls held", ctx.research, (v: never) => {
      const r = v as unknown as readonly { kind: string; expired: boolean }[];
      return `${r.length}, ${r.filter((x) => !x.expired).length} still live`;
    })
  );

  // ── What this step still needs, in the board's own words ──
  if (stepKey) {
    const g = gapsFrom(ctx, stepKey);
    out.push("");
    out.push(`## What step ${g.number} still needs`);
    out.push("");
    // ‼️ THE BOARD'S OWN SENTENCES, NOT A PARAPHRASE. gapLines is what the card prints. If the
    // assistant described the gaps in its own words they would drift from the card in the same
    // thread, and a person would have two different answers to one question on one screen.
    for (const l of gapLines(g)) out.push(l);
  }

  if (ctx.readErrors.length) {
    out.push("");
    out.push("## Reads that FAILED");
    out.push("");
    out.push("Anything above sourced from these is unknown, not absent. Say so rather than guessing.");
    for (const e of ctx.readErrors.slice(0, 5)) out.push(`- ${e}`);
  }

  // ── What this thread actually accepts ──
  //
  // ‼️ MEASURED 2026-09-22. Somebody typed `letter approve` in step 11's thread. Nothing claimed it,
  // it reached this assistant, and the answer was "press the Approve button on the delivery board at
  // step offer_locked". There is no Approve button on any card, and the rule below saying "only name
  // a command that appears above" had nothing above it to name: the brief carried the gaps but never
  // the grammar. Now it carries both, and the buttons are stated so a fourth cannot be imagined.
  out.push("");
  out.push("## What this thread accepts");
  out.push("");
  out.push(`- Typed commands, one per message: ${grammarLine(stepKey)}`);
  out.push(
    "- Buttons on this step's card: [Done], [Skip - not applicable], [I hit a problem]. A few steps " +
      "carry one or two extras, which are visible on the card itself."
  );

  // ── The rules, last, because the last thing read is the thing followed ──
  out.push("");
  out.push("## How to use this");
  out.push("");
  out.push("- This IS the client. Do not go looking for another one and do not report that none exists.");
  out.push("- A field marked NOT ON FILE is missing. Do not fill it in, guess it, or offer an example as if it were theirs.");
  out.push("- Never state a number that is not above. There is no traffic, ranking or lead data in this system at all.");
  out.push("- Suggest, never decide. A person presses the button.");
  out.push("- Only name a command that appears above. Inventing one sends somebody to type something that does not exist.");
  out.push(
    "- The buttons are exactly the three named above. There is no Approve button, no Submit and no " +
      "Continue, on any card or any dashboard. Naming one sends somebody hunting for a control that " +
      "is not there, which is worse than saying you cannot help."
  );
  out.push(
    "- A command that belongs to another step belongs to another step's THREAD. Name that step and " +
      "its number and stop there. Never answer as though it had worked here."
  );

  const text = out.join("\n");
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n(brief truncated)` : text;
}
