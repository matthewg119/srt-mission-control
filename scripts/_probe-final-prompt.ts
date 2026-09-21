// The one prompt for a whole lead: does it carry what we hold, and ask for exactly what we do not.
//
//   bunx tsx --env-file=.env.local scripts/_probe-final-prompt.ts
//
// ‼️ THE FAILURE THIS EXISTS TO CATCH IS ASKING FOR SOMETHING WE ALREADY HAVE. That is the
// complaint the whole feature comes from, and it is the half that rots: a field gains a writer, it
// starts arriving on file, and an ask list built from anything other than the gap list keeps
// asking for it for ever. So the assertions run in both directions, against the same context.

import { readFileSync } from "node:fs";
import path from "node:path";
import {
  held,
  missing,
  type LeadContext,
  type Held,
} from "@/lib/clients/lead-context";
import { buildFinalPrompt, finalPromptSummary, type ResearchSectionRef } from "@/lib/clients/final-prompt";
import { AVATAR_SHEET, SHORT_OFFER, BELIEF_OPENING, MAX_NECESSARY_BELIEFS } from "@/config/avatar-framework";
import { RESEARCH_SECTIONS } from "@/lib/clients/artifacts/deep-research-run";
import type { DatasetReport, FieldSpec } from "@/lib/clients/dataset-spec";
import type { ResearchContext } from "@/lib/clients/artifacts/deep-research-run";

let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}

const ROOT = path.resolve(__dirname, "..");
const SRC = readFileSync(path.join(ROOT, "src/lib/clients/final-prompt.ts"), "utf8");
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/\/\/[^\n]*/g, "");

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

function field(over: Partial<FieldSpec> & Pick<FieldSpec, "key" | "filledBy">): FieldSpec {
  return {
    dataset: "avatar",
    label: over.key,
    usedFor: "a probe",
    present: () => false,
    ...over,
  } as FieldSpec;
}

function report(gaps: FieldSpec[], total = 10, present = 4): DatasetReport {
  return {
    dataset: "avatar",
    total,
    present,
    backedByValue: 0,
    gaps: gaps.map((f) => ({ field: f, reason: "the probe said so", blocking: true })),
  };
}

const RESEARCH_CTX: ResearchContext = {
  clinicName: "Probe Clinic",
  city: "Greensboro",
  state: "NC",
  avatarLabel: "The probe buyer",
  avatarSlug: "probe-buyer",
  vertical: "med_spa",
  trade: "med spa",
  primaryTreatment: null,
  services: ["one", "two"],
  objections: "it is too expensive",
  targetPatient: "women 35 to 55",
  notWanted: "bargain hunters",
  triedBefore: "a groupon agency",
  citedDomains: ["realself.com"],
  namedInstead: ["Rival Clinic"],
};

function contextWith(over: Record<string, unknown>): LeadContext {
  return {
    clientId: "probe",
    loaded: new Set(["core", "documents", "gaps"]),
    readErrors: [],
    identity: {
      ref: { id: "probe", name: "Probe Clinic", domain: "probe.com" },
      name: "Probe Clinic",
      domain: held("probe.com", { source: "probe", why: "x" }),
      website: held("https://probe.com", { source: "probe", why: "x" }),
      vertical: held("med_spa", { source: "probe", why: "x" }),
      businessType: held("med spa", { source: "probe", why: "x" }),
      city: held("Greensboro", { source: "probe", why: "x" }),
      intakeCompletedAt: missing("never_asked", "no intake"),
      day0ArchivedAt: missing("never_asked", "no day 0"),
    },
    audiences: [],
    primaryAudience: null,
    avatar: {
      slug: held("probe-buyer", { source: "probe", why: "x" }),
      vertical: held("med_spa", { source: "probe", why: "x" }),
      research: missing("never_asked", "no research"),
      timesReused: held(0, { source: "probe", why: "x" }),
    },
    offers: [],
    primaryOffer: null,
    documents: {} as Record<string, Held<unknown>>,
    beliefs: missing("never_asked", "no beliefs"),
    ladder: missing("never_asked", "no ladder"),
    keywords: missing("never_asked", "no keywords"),
    pages: missing("never_asked", "no pages"),
    audits: missing("never_asked", "no audits"),
    research: missing("never_asked", "no pulls"),
    history: missing("never_asked", "no events"),
    gaps: held([report([])] as DatasetReport[], { source: "probe", why: "nothing evaluated" }),
    board: { steps: [], reachable: [], cursor: missing("blocked", "nothing"), blocked: [] },
    ...over,
  } as unknown as LeadContext;
}

const BASE = {
  research: RESEARCH_CTX,
  docs: [],
  sections: RESEARCH_SECTIONS as readonly ResearchSectionRef[],
  avatarSheet: AVATAR_SHEET,
  shortOffer: SHORT_OFFER,
  beliefOpening: BELIEF_OPENING,
  maxBeliefs: MAX_NECESSARY_BELIEFS,
};

function build(ctx: LeadContext, over: Record<string, unknown> = {}) {
  return buildFinalPrompt({ ctx, ...BASE, ...over } as Parameters<typeof buildFinalPrompt>[0]);
}

async function main() {
  console.log("\n1. it argues, it does not read");
  // Same enforcement suggestions.ts carries: a builder with no db handle cannot quietly become a
  // second read model, and a builder with no model call cannot invent what it could not find.
  check("no database handle", !/supabaseAdmin/.test(CODE));
  check("no table is named", !/\.from\(/.test(CODE));
  check("nothing is written", !/\.(insert|update|upsert|delete)\(/.test(CODE));
  check("it calls no model", !/callClaude/.test(CODE));
  check("it posts nothing", !/slack\.|postClientReply|uploadFile/.test(CODE));
  check("no em dash", !SRC.includes("—"));

  console.log("\n2. it refuses rather than degrading");
  const unreadable = build(contextWith({ gaps: missing("unreadable", "the datasets could not be evaluated") }));
  check("unreadable datasets refuse", !unreadable.ok);
  check(
    "and the refusal says unknown, not empty",
    !unreadable.ok && /unknown rather than empty/i.test(unreadable.error)
  );
  const noAvatar = build(contextWith({}), { research: null });
  check("no confirmed avatar refuses", !noAvatar.ok);
  check("and it says why that matters", !noAvatar.ok && /vertical/i.test(noAvatar.error));

  console.log("\n3. it asks for what is missing, with the report's own numbers");
  // Sections 4, 9 and 12, deliberately not contiguous and deliberately including a scriptOnly one.
  const wanted = [RESEARCH_SECTIONS[3], RESEARCH_SECTIONS[8], RESEARCH_SECTIONS[11]];
  const withGaps = contextWith({
    gaps: held(
      [
        report(
          wanted.map((s) =>
            field({ key: `f_${s.key}`, filledBy: { kind: "research", sectionKey: s.key, asked: true } })
          )
        ),
      ],
      { source: "probe", why: "x" }
    ),
  });
  const asked = build(withGaps);
  check("it builds", asked.ok);
  if (asked.ok) {
    check(
      "the numbers are the report's, not 1 2 3",
      asked.prompt.sectionNumbers.join(",") === wanted.map((s) => s.number).join(","),
      asked.prompt.sectionNumbers.join(",")
    );
    for (const s of wanted) {
      check(`section ${s.number} is asked by its heading`, asked.prompt.body.includes(`${s.number}. ${s.heading}`));
    }
    // ‼️ THE RENUMBERING BUG, ASSERTED DIRECTLY. A subset renumbered from 1 files section 12's
    // answer under section 1, permanently, and it looks completely fine in the prompt.
    check("nothing was renumbered from 1", !asked.prompt.body.includes(`1. ${wanted[0].heading}`));
  }

  console.log("\n4. it never asks for what is on file");
  // The same shape as above with NO gaps: every field is present, so nothing may be asked for.
  const nothingMissing = build(contextWith({ gaps: held([report([], 10, 10)], { source: "probe", why: "x" }) }));
  check("it still builds", nothingMissing.ok);
  if (nothingMissing.ok) {
    check("it asks for nothing", nothingMissing.prompt.asks === 0);
    check("no research section is named", nothingMissing.prompt.sectionNumbers.length === 0);
    check(
      "and it says so out loud",
      /Every field this prompt can ask another person for is already answered/i.test(nothingMissing.prompt.body)
    );
    for (const s of RESEARCH_SECTIONS) {
      if (nothingMissing.prompt.body.includes(`${s.number}. ${s.heading}`)) {
        check(`section ${s.number} must not appear`, false);
        break;
      }
    }
  }

  console.log("\n5. a field only Matthew can answer is named as his, never researched");
  const mine = build(
    contextWith({
      gaps: held(
        [
          report([
            field({
              key: "price",
              dataset: "offer",
              label: "the price",
              filledBy: { kind: "step", step: "offer_locked", how: "`price:` on step 10", built: true },
            }),
          ]),
        ],
        { source: "probe", why: "x" }
      ),
    })
  );
  check("it builds", mine.ok);
  if (mine.ok) {
    check("it is listed as mine", mine.prompt.mine.length === 1);
    check("under a heading that says not for you", /NOT FOR YOU/.test(mine.prompt.body));
    check("and it is not counted as an ask", mine.prompt.asks === 0);
  }

  console.log("\n6. the templates come back pre-filled, headings intact");
  const sheetGap = field({
    key: "fears",
    filledBy: { kind: "document", doc: "avatar_sheet", answer: ["fears"] },
  });
  const partial = build(
    contextWith({
      gaps: held([report([sheetGap])], { source: "probe", why: "x" }),
      documents: {
        avatar_sheet: held(
          {
            id: "d1",
            kind: "avatar_sheet",
            content: "whatever",
            // Two shapes on purpose: "fears" is a plain list section, and "goals" is a section
            // with sub-labels answered as free prose, which is what a person who ignored the
            // labels actually produces. Both are answered and neither may be asked for again.
            parsed: {
              sections: { goals: "to look like herself again", fears: "that it will look obvious" },
              subs: { "demographics.age_range": "35 to 55" },
            },
          },
          { source: "probe", why: "x" }
        ),
      },
    })
  );
  check("it builds", partial.ok);
  if (partial.ok) {
    check("a sub-labelled section answered as prose is carried", partial.prompt.body.includes("to look like herself again"));
    check("a plain section's answer is carried", partial.prompt.body.includes("that it will look obvious"));
    check("a sub-label answer is carried under its label", partial.prompt.body.includes("Age range: 35 to 55"));
    // ‼️ THE POINT OF ALL THREE: none of those placeholders may survive next to their answer.
    check("the placeholder it replaced is gone", !partial.prompt.body.includes("[Short-term goal 1]"));
    // ‼️ readTemplateDocument refuses a paste matching fewer than half the headings, so a prompt
    // handing back only the gaps would produce an answer the system then rejects.
    for (const s of AVATAR_SHEET) {
      if (!partial.prompt.body.includes(s.heading)) {
        check(`every heading survives (${s.heading})`, false);
        break;
      }
    }
    check("every heading survives", AVATAR_SHEET.every((s) => partial.prompt.body.includes(s.heading)));
  }

  console.log("\n7. what we hold travels, and a clip is declared");
  const long = "x".repeat(70_000);
  const carried = build(
    contextWith({
      gaps: held([report([sheetGap])], { source: "probe", why: "x" }),
      beliefs: held([{ id: "B1", text: "I believe that it is not my fault" }], { source: "probe", why: "x" }),
      documents: {
        deep_research: held({ id: "d2", kind: "deep_research", content: long, parsed: null }, { source: "probe", why: "x" }),
      },
    }),
    { docs: [{ docId: "f1", filename: "intake.pdf", stepKey: "intake_received", uploadedAt: "", text: "she said she wants to look rested", clipped: false }] }
  );
  check("it builds", carried.ok);
  if (carried.ok) {
    check("the belief travels with its id", carried.prompt.body.includes("B1: I believe that it is not my fault"));
    check("the owner's own words travel", carried.prompt.body.includes("it is too expensive"));
    check("the uploaded document's TEXT travels", carried.prompt.body.includes("she said she wants to look rested"));
    check("a clip is declared", carried.prompt.clipped.length > 0);
    check("and the file says what was shortened", /WHAT WAS SHORTENED TO FIT/.test(carried.prompt.body));
    check("the clip names the source", carried.prompt.clipped.some((c) => /research already on file/i.test(c)));
  }

  console.log("\n8. nothing renders as a broken value");
  const all = [asked, nothingMissing, mine, partial, carried]
    .filter((r): r is Extract<typeof r, { ok: true }> => r.ok)
    .map((r) => r.prompt.body + " " + finalPromptSummary(r.prompt))
    .join(" ");
  check("nothing renders as undefined", !all.includes("undefined"));
  check("nothing renders as NaN", !all.includes("NaN"));
  check("nothing renders as [object Object]", !all.includes("[object Object]"));

  console.log("\n9. the paste-back prefixes are the live ones");
  // ‼️ GREPPED OUT OF src/, THE WAY _probe-gaps.ts CHECKS ITS COMMANDS. A prompt telling somebody
  // to answer with a prefix nothing parses is a prompt whose answer is silently dropped.
  const intake = readFileSync(path.join(ROOT, "src/lib/clients/research-intake.ts"), "utf8");
  const framework = readFileSync(path.join(ROOT, "src/lib/clients/avatar-framework.ts"), "utf8");
  check("`research:` is parsed", /research\\s\*:/.test(intake) || /research\s*\\s\*:/.test(intake) || intake.includes("RESEARCH_PREFIX"));
  check("`avatar sheet:` is parsed", /avatar\\s\+sheet/.test(framework));
  check("`short offer:` is parsed", /short\\s\+offer/.test(framework));
  check("`beliefs:` is parsed", /beliefs\\s\*:/.test(framework));
  if (asked.ok) {
    check("the prompt names the research prefix", asked.prompt.body.includes("`research:`"));
  }
  if (partial.ok) {
    check("the prompt names the avatar sheet prefix", partial.prompt.body.includes("`avatar sheet:`"));
  }

  console.log("\n10. the document read actually runs against the real database");
  // ‼️ THIS SECTION EXISTS BECAUSE THE FIRST VERSION SHIPPED BROKEN AND EVERY CHECK ABOVE PASSED.
  // doc-text.ts selected client_docs.created_at, which does not exist: one unknown column fails
  // the WHOLE PostgREST select, supabase-js RETURNS that error instead of throwing it, and
  // docTextsFor returned [] for ever. The prompt still built, still read well, and simply never
  // carried a single uploaded document. Nothing pure can catch that, so this half is live.
  const { supabaseAdmin } = await import("@/lib/db");
  const { docTextsFor } = await import("@/lib/clients/doc-text");

  const columns = /\.select\(\s*"([^"]+)"/.exec(
    readFileSync(path.join(ROOT, "src/lib/clients/doc-text.ts"), "utf8")
  )?.[1];
  check("doc-text names its columns in one select", Boolean(columns), columns ?? "none found");
  if (columns) {
    const { error } = await supabaseAdmin.from("client_docs").select(columns).limit(1);
    check("every column it asks for exists", !error, error?.message ?? "");
  }

  const { data: srt } = await supabaseAdmin
    .from("clients")
    .select("id")
    .eq("slug", "srt-agency-llc")
    .maybeSingle();
  if (srt?.id) {
    const docs = await docTextsFor(srt.id as string);
    // Not an assertion about HOW MANY: a client may genuinely have none. The assertion is that the
    // call completed and returned the shape, which is what the broken version could not do.
    check("docTextsFor runs against a real client", Array.isArray(docs), `${docs.length} readable`);
    check("every returned document has text", docs.every((d) => d.text.trim().length > 0));
  } else {
    console.log("  ..    srt-agency-llc not found, skipping the live read");
  }

  console.log(`\n${failed === 0 ? "ALL GREEN" : `${failed} FAILED`}\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
