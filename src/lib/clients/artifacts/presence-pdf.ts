// The presence and consistency report — delivery step 6, Runner v3 section 3c.
//
// "Same generator and visual treatment as the AI visibility audit report" — that is
// @/lib/pdf/kit, which is the audit scorecard's own primitives lifted out so there is one
// visual language rather than two.
//
// Contents, per section 3c: canonical NAP block · summary counts by status with core six and
// extended SEPARATED · every finding worst-first with canonical versus listed side by side and
// the screenshot inline · which platforms were automated, which manual, which skipped and why.
//
// ‼️ "NOT CHECKED" NEVER RENDERS AS "NO ISSUES FOUND", AND THIS FILE IS WHERE THAT IS ENFORCED.
// Today nothing is keyed, so a freshly seeded client has nineteen rows of 'not_checked'. The
// tempting render for that is a clean page with no findings on it, which a client would
// reasonably read as "we looked everywhere and you are fine". So the summary leads with the
// number NOT checked whenever there are any, and the per-platform table prints the words "not
// checked" in amber rather than leaving the row blank.
//
// This PDF is findings section 2's evidence, and it is attached to it rather than folded in.

import { supabaseAdmin } from "@/lib/db";
import { platformByKey } from "@/config/presence-platforms";
import { canonicalFor, loadSweep, effectiveStatus, countByStatus, worstFirst, type SweepRow } from "../presence-sweep";
import { canonicalAddress, type Canonical } from "../nap-compare";
import { signedDocUrl } from "../onboarding-docs";
import {
  startDoc,
  finishDoc,
  coverHeading,
  sectionHeading,
  paragraph,
  keyValueTable,
  bulletList,
  image,
  fidelityFooter,
  ensureSpace,
  MUTED,
  AMBER,
  RED,
  REEF,
  type PageState,
  type TableRow,
} from "@/lib/pdf/kit";
import { deliverArtifact } from "./deliver";

const STATUS_WORDS: Record<SweepRow["status"], string> = {
  match: "matches",
  mismatch: "does not match",
  duplicate: "DUPLICATE listings",
  missing: "no listing found",
  not_checked: "not checked",
};

const STATUS_TONE: Record<SweepRow["status"], TableRow["tone"]> = {
  match: "good",
  mismatch: "warn",
  duplicate: "bad",
  missing: "warn",
  not_checked: "normal",
};

/** Download a filed screenshot so it can be embedded. Null on anything that is not an image. */
async function screenshotBytes(docId: string | null): Promise<Buffer | null> {
  if (!docId) return null;
  try {
    const url = await signedDocUrl(docId);
    if (!url) return null;
    const res = await fetch(url);
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

function tierBlock(state: PageState, label: string, rows: SweepRow[], context: string) {
  sectionHeading(state, label);
  paragraph(state, context, { color: MUTED, size: 9 });

  const counts = countByStatus(rows);
  const summary: string[] = [];
  if (counts.match) summary.push(`${counts.match} match`);
  if (counts.mismatch) summary.push(`${counts.mismatch} do not match`);
  if (counts.duplicate) summary.push(`${counts.duplicate} with duplicate listings`);
  if (counts.missing) summary.push(`${counts.missing} with no listing`);

  // ‼️ The not-checked count is stated FIRST and on its own line whenever it is non-zero.
  // Buried at the end of a list it reads as a footnote; a client has to see how much of their
  // own presence has not been looked at before they read anything else about it.
  if (counts.not_checked) {
    paragraph(
      state,
      // Worded to avoid the phrase "no issues found" even in a sentence disclaiming it, so the
      // test can assert that string never appears anywhere in a rendered client PDF at all.
      // An invariant you can grep for is worth more than one you have to reason about.
      `${counts.not_checked} of these ${rows.length} have not been checked yet. That is not a finding that they are correct, and nothing below claims it is.`,
      { color: AMBER, bold: true, size: 9.5 }
    );
  }
  paragraph(state, summary.length ? summary.join(" · ") : "Nothing has been checked on this tier yet.", {
    size: 9.5,
  });

  const table: TableRow[] = rows.map((r) => {
    const p = platformByKey(r.platform);
    const status = effectiveStatus(r);
    const detail =
      status === "not_checked" && r.skipReason ? `not checked — ${r.skipReason}` : STATUS_WORDS[status];
    return { label: p?.label ?? r.platform, value: detail, tone: STATUS_TONE[status] };
  });
  keyValueTable(state, table, { labelWidth: 60 });
}

async function findingsBlock(state: PageState, canonical: Canonical, rows: SweepRow[]) {
  const findings = worstFirst(rows).filter((r) => {
    const s = effectiveStatus(r);
    return s === "duplicate" || s === "mismatch" || s === "missing";
  });

  sectionHeading(state, "Every finding, worst first");

  if (!findings.length) {
    paragraph(
      state,
      "No confirmed findings yet. That is because the sweep has not been completed, not because nothing was found.",
      { color: AMBER }
    );
    return;
  }

  const canonAddr = canonicalAddress(canonical);

  for (const row of findings) {
    const p = platformByKey(row.platform);
    const status = effectiveStatus(row);
    ensureSpace(state, 34);

    paragraph(state, `${p?.label ?? row.platform} — ${STATUS_WORDS[status]}`, {
      bold: true,
      color: status === "duplicate" ? RED : AMBER,
      size: 10.5,
      gap: 1,
    });
    paragraph(state, p?.tier === "core_six" ? "Core six" : "Extended, context only", {
      color: MUTED,
      size: 8,
      gap: 2,
    });

    if (status === "missing") {
      paragraph(state, "There is no listing for this business on this platform.", { size: 9 });
    } else {
      // Side by side, and the listed value is the RAW published string. This is the whole
      // argument of findings section 2: their address appears several different ways.
      keyValueTable(
        state,
        [
          { label: "Name, as published", value: row.rawName ?? "not recorded", tone: "warn" },
          { label: "Name, canonical", value: canonical.name },
          { label: "Address, as published", value: row.rawAddress ?? "not recorded", tone: "warn" },
          { label: "Address, canonical", value: canonAddr },
          { label: "Phone, as published", value: row.rawPhone ?? "not recorded", tone: "warn" },
          { label: "Phone, canonical", value: canonical.phone ?? "not recorded" },
        ],
        { labelWidth: 46, size: 8.5 }
      );
    }

    if (row.listingUrl) paragraph(state, row.listingUrl, { color: REEF, size: 8, gap: 2 });

    const shot = await screenshotBytes(row.screenshotRef);
    if (shot || row.screenshotRef) {
      image(state, shot, {
        maxH: 70,
        caption: `Screenshot, ${p?.label ?? row.platform}, taken ${row.checkedAt?.slice(0, 10) ?? "date not recorded"}`,
        fallbackLabel: "Screenshot on file but not renderable here",
      });
    } else {
      paragraph(state, "No screenshot has been filed for this finding.", {
        color: MUTED,
        italic: true,
        size: 8,
      });
    }
  }
}

export async function renderPresencePdf(args: {
  clientName: string;
  canonical: Canonical;
  rows: SweepRow[];
  engines: string[];
  questionSetVersions: string[];
  /**
   * The state of the manual sweep STEP, as opposed to the state of the eighteen rows.
   *
   * ‼️ WITHOUT THIS, A SKIPPED SWEEP AND AN UNFINISHED ONE RENDER IDENTICALLY. This document is
   * shown to the client on the onboarding call, and the gate is four distinct platforms out of
   * nineteen, so FIFTEEN unchecked rows is not an edge case, it is the ordinary state of this
   * page. "Why is most of this blank" is therefore a question it has to answer on its face. A
   * row-level count cannot: the rows look the same whether the sweep was skipped or simply is
   * not finished. Only the step knows whether somebody decided not to do this.
   *
   * The counts printed below are derived from the rows themselves, so they stay correct at any
   * gate. What the gate changed is how LOUD this has to be, not what it says.
   *
   * OPTIONAL, because scripts/test-onboarding-artifacts.ts calls this function directly with a
   * fixed argument object and must keep compiling.
   */
  manualSweep?: {
    status: string;
    skippedReason: string | null;
    completedAt: string | null;
    completedBy: string | null;
  } | null;
}): Promise<Buffer> {
  const state = startDoc({
    title: `${args.clientName} — presence and consistency`,
    // The fidelity footer carries no engine results on this document, but Artifact Templates
    // section 1 asks for it on every artifact so the reader can tell which run this belongs to.
    footer: fidelityFooter({
      questions: 20,
      engines: args.engines,
      date: new Date(),
      questionSetVersions: args.questionSetVersions,
      note: "presence sweep is manual, no provider keyed",
    }),
  });

  coverHeading(state, {
    eyebrow: "Presence and consistency",
    title: args.clientName,
    subtitle:
      "What the internet currently publishes about this business, and where those records disagree with each other.",
  });

  // ‼️ THE STEP'S STATE, ON THE FACE OF THE DOCUMENT, BEFORE ANY FINDING.
  //
  // The wording cannot be copied from step-board.ts or delivery-checklist.ts even though it is
  // saying the same thing, and that is not a style choice: scripts/test-onboarding-artifacts.ts
  // asserts the string "no issues found" appears NOWHERE in a rendered client PDF, in any
  // casing, including inside a sentence disclaiming it. That invariant is grep-able on purpose.
  // The Slack copy contains the phrase. Say the same thing without it.
  const sweepStatus = args.manualSweep?.status ?? null;
  if (sweepStatus === "skipped") {
    paragraph(
      state,
      'The manual half of this sweep was marked not applicable, so every platform below reads as "not checked". Nothing on these pages is a statement that these listings are correct.',
      { color: AMBER, bold: true, size: 10 }
    );
  } else if (sweepStatus && sweepStatus !== "complete") {
    paragraph(
      state,
      'The manual half of this sweep is still open. Anything marked "not checked" below has not been looked at yet.',
      { color: AMBER, bold: true, size: 10 }
    );
  }

  sectionHeading(state, "The canonical record");
  paragraph(
    state,
    "This is what every listing is compared against. It is confirmed aloud, field by field, on the onboarding call.",
    { color: MUTED, size: 9 }
  );
  keyValueTable(state, [
    { label: "Business name", value: args.canonical.name },
    { label: "Address", value: canonicalAddress(args.canonical) },
    { label: "Phone", value: args.canonical.phone ?? "not recorded" },
  ]);

  const core = args.rows.filter((r) => r.tier === "core_six");
  const extended = args.rows.filter((r) => r.tier === "extended");

  tierBlock(
    state,
    "Core six",
    core,
    "Google, Apple, Bing, Yelp, RealSelf and Facebook. These are the ones the engines lean on, and the only ones corrected in week one."
  );
  tierBlock(
    state,
    "Extended",
    extended,
    "Twelve smaller directories. Reported for context. Anything broken here goes on the longer implementation list, not the week-one cleanup."
  );

  await findingsBlock(state, args.canonical, args.rows);

  sectionHeading(state, "How this was checked");

  // The step-level statement, said again where the reader is asking the question. Same
  // constraint as the cover: the phrase "no issues found" may not appear on this page at all.
  if (sweepStatus === "skipped") {
    const when = args.manualSweep?.completedAt?.slice(0, 10) ?? "a date that was not recorded";
    const who = args.manualSweep?.completedBy ?? "somebody";
    paragraph(
      state,
      `The manual sweep step was skipped on ${when} by ${who}. A skipped step reads as "not checked" everywhere, and that is an absence of evidence, never evidence of correctness.`,
      { color: AMBER, bold: true, size: 9.5 }
    );
    paragraph(
      state,
      args.manualSweep?.skippedReason
        ? `Reason recorded: ${args.manualSweep.skippedReason}`
        : "No reason was recorded.",
      { color: MUTED, size: 9 }
    );
  }

  // ‼️ DERIVED, NEVER A CONSTANT. The gate moved from eighteen files to six named platforms to
  // any four distinct ones, and this paragraph stayed correct through all three because it
  // counts the rows in front of it rather than quoting a number from the config.
  const automated = args.rows.filter((r) => r.source === "api").length;
  const skipped = args.rows.filter((r) => effectiveStatus(r) === "not_checked");
  bulletList(state, [
    `${automated} of ${args.rows.length} platforms were checked through an official API.`,
    "The rest were checked by hand: a person searched the platform and screenshotted the result.",
    "No platform was scraped, and no automated querying was run against any site whose terms prohibit it.",
    skipped.length
      ? `${skipped.length} platforms have not been checked. They appear above as "not checked". That is not a finding of correctness.`
      : "Every platform was checked.",
  ]);

  if (skipped.some((s) => s.skipReason)) {
    paragraph(state, "Skipped, and why:", { bold: true, size: 9.5 });
    bulletList(
      state,
      skipped
        .filter((s) => s.skipReason)
        .map((s) => `${platformByKey(s.platform)?.label ?? s.platform}: ${s.skipReason}`),
      { color: MUTED, size: 9 }
    );
  }

  return finishDoc(state);
}

/** Step 6. */
export async function generatePresencePdf(
  clientId: string
): Promise<{ ok: boolean; error?: string; docId?: string }> {
  const canonical = await canonicalFor(clientId);
  if (!canonical) return { ok: false, error: "client not found" };

  const rows = await loadSweep(clientId);
  if (!rows.length) {
    return { ok: false, error: "the sweep has not been seeded, so there is nothing to report on" };
  }

  const { data: report } = await supabaseAdmin
    .from("audit_reports")
    .select("engines")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: versions } = await supabaseAdmin
    .from("question_set_versions")
    .select("version")
    .eq("vertical", "med_spa");

  // The manual sweep STEP, not its rows. A skipped step and an unfinished one leave the
  // eighteen rows looking identical, and this document is shown to the client on the call.
  const { data: sweepStep } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("status, skipped_reason, completed_at, completed_by")
    .eq("client_id", clientId)
    .eq("step_key", "presence_sweep_manual")
    .maybeSingle();

  let buffer: Buffer;
  try {
    buffer = await renderPresencePdf({
      clientName: canonical.name,
      canonical,
      rows,
      engines: ((report?.engines as string[] | null) ?? ["chatgpt_web"]),
      questionSetVersions: (versions ?? []).map((v) => v.version as string),
      manualSweep: sweepStep
        ? {
            status: sweepStep.status as string,
            skippedReason: (sweepStep.skipped_reason as string | null) ?? null,
            completedAt: (sweepStep.completed_at as string | null) ?? null,
            completedBy: (sweepStep.completed_by as string | null) ?? null,
          }
        : null,
    });
  } catch (e) {
    return { ok: false, error: `render failed: ${(e as Error).message}` };
  }

  const counts = countByStatus(rows);
  const message = [
    `:clipboard: Presence and consistency report for *${canonical.name}*.`,
    `${counts.mismatch} do not match · ${counts.duplicate} duplicates · ${counts.missing} missing · ${counts.not_checked} NOT CHECKED.`,
    counts.not_checked
      ? "The not-checked ones print as \"not checked\" on the client PDF. Finish the manual sweep before this goes out."
      : "Every platform has been checked and confirmed.",
  ].join("\n");

  const result = await deliverArtifact({
    clientId,
    stepKey: "presence_pdf",
    filename: `Presence and consistency - ${canonical.name}.pdf`,
    buffer,
    message,
  });

  return { ok: result.ok, error: result.error, docId: result.docId };
}
