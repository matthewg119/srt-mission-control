// The citation cleanup list — delivery step 14, Runner v3 section 12 (5e).
//
// Every listing that needs correcting, worst first, with the correction already written out:
// platform, tier, canonical versus listed, what to change, what access it takes, how long it
// runs. Core six first, because that is the only tier week one touches.
//
// ‼️ A LIST. NOTHING HERE SUBMITS ANYTHING.
// Runner v3 section 6: "The tool proposes; I confirm." This document is the proposal in its
// most useful form and that is the whole of its job. There is no write path to Google, Yelp or
// anyone else in this file and there must not be one — a string comparison is not grounds for
// editing a client's live listing, which is exactly why `effectiveStatus` reads the CONFIRMED
// status and nothing else.
//
// ‼️ NO NEW TABLE, DELIBERATELY.
// `nap_discrepancies` already holds every fact this list is made of. A `citation_cleanup_items`
// table would be a second copy of the same state, and the first time somebody re-ran the sweep
// the list and the sweep would start disagreeing about what is wrong. This is a RENDERED VIEW.
// Execution is recorded back on `nap_discrepancies`, where the sweep can see it.

import { supabaseAdmin } from "@/lib/db";
import { platformByKey, CORE_SIX, type PresencePlatform } from "@/config/presence-platforms";
import {
  canonicalFor,
  loadSweep,
  effectiveStatus,
  countByStatus,
  worstFirst,
  type SweepRow,
} from "../presence-sweep";
import { compareListing, canonicalLine, type Canonical, type FieldDiff } from "../nap-compare";
import {
  startDoc,
  finishDoc,
  coverHeading,
  sectionHeading,
  paragraph,
  keyValueTable,
  bulletList,
  ensureSpace,
  plainFooter,
  MUTED,
  AMBER,
  type PageState,
  type TableRow,
} from "@/lib/pdf/kit";
import { deliverArtifact } from "./deliver";
import type { AutoResult } from "./registry";

/**
 * What a fix on this row actually involves.
 *
 * `duplicate` outranks everything: two listings for one business splits the signal and no
 * amount of correcting the good one fixes it. `mismatch` is a field edit. `missing` is a
 * claim-and-create, which is slower than an edit, so it carries its own multiplier below.
 */
const ACTION: Record<Exclude<SweepRow["status"], "match" | "not_checked">, string> = {
  duplicate: "Merge or remove the duplicate, then correct whichever listing survives",
  mismatch: "Edit the fields listed below to match the canonical record",
  missing: "Claim the listing and create it from the canonical record",
};

/** A claim runs longer than an edit, and a duplicate merge longer still. */
const EFFORT_MULTIPLIER: Record<Exclude<SweepRow["status"], "match" | "not_checked">, number> = {
  duplicate: 2,
  mismatch: 1,
  missing: 1.5,
};

export interface CleanupItem {
  platform: PresencePlatform | undefined;
  platformKey: string;
  tier: "core_six" | "extended";
  status: Exclude<SweepRow["status"], "match" | "not_checked">;
  action: string;
  diffs: FieldDiff[];
  access: string;
  minutes: number | null;
}

const FIELD_LABEL: Record<FieldDiff["field"], string> = {
  name: "Name",
  address: "Address",
  phone: "Phone",
};

/**
 * Turn confirmed sweep findings into the work list.
 *
 * ‼️ Reads `effectiveStatus`, so an UNCONFIRMED proposal never reaches the list. A row the
 * comparison flagged but nobody confirmed is not work, it is a suggestion — and sending
 * somebody to edit a live Google listing off an unconfirmed suggestion is the exact failure
 * the confirm step exists to prevent.
 *
 * Exported and pure so the artifact and any future board panel derive the same list rather
 * than each computing their own.
 */
export function buildCleanupList(canonical: Canonical, rows: SweepRow[]): CleanupItem[] {
  const coreKeys = new Set(CORE_SIX.map((p) => p.key));

  const actionable = worstFirst(rows).filter((r) => {
    const s = effectiveStatus(r);
    return s === "duplicate" || s === "mismatch" || s === "missing";
  });

  const items = actionable.map((row) => {
    const status = effectiveStatus(row) as CleanupItem["status"];
    const platform = platformByKey(row.platform);

    // The correction, per field, already computed. `compareListing` is what the sweep itself
    // uses, so the list cannot describe a different diff than the sweep found.
    // A `missing` row has nothing listed to compare against, so it carries no field diffs —
    // the whole canonical record is the correction, and the PDF prints it once at the top.
    const diffs =
      status === "missing"
        ? []
        : compareListing(canonical, {
            name: row.rawName,
            address: row.rawAddress,
            phone: row.rawPhone,
          }).diffs;

    const base = platform?.minutes ?? null;

    return {
      platform,
      platformKey: row.platform,
      tier: coreKeys.has(row.platform) ? ("core_six" as const) : ("extended" as const),
      status,
      action: ACTION[status],
      diffs,
      // "unknown" rather than a plausible guess. Somebody sequencing this work needs to know
      // which rows they cannot start, and an invented answer hides exactly those.
      access: platform?.access ?? "unknown — nobody has recorded what it takes to edit this one",
      minutes: base === null ? null : Math.round(base * EFFORT_MULTIPLIER[status]),
    };
  });

  // Core six first. `worstFirst` has already ordered by severity, and this is a stable sort,
  // so within a tier the severity order survives.
  return items.sort((a, b) => (a.tier === b.tier ? 0 : a.tier === "core_six" ? -1 : 1));
}

function itemBlock(state: PageState, item: CleanupItem, n: number) {
  ensureSpace(state, 34);

  const label = item.platform?.label ?? item.platformKey;
  const tier = item.tier === "core_six" ? "CORE SIX" : "extended";
  sectionHeading(state, `${n}. ${label}  (${tier})`);

  const rows: TableRow[] = [
    {
      label: "Finding",
      value:
        item.status === "duplicate"
          ? "Duplicate listings"
          : item.status === "missing"
            ? "No listing found"
            : "Does not match the canonical record",
      tone: item.status === "duplicate" ? "bad" : "warn",
    },
    { label: "Do this", value: item.action },
    { label: "Access", value: item.access },
    {
      label: "Time",
      value: item.minutes === null ? "unknown" : `about ${item.minutes} min`,
    },
  ];
  keyValueTable(state, rows, { labelWidth: 26 });

  if (item.diffs.length) {
    bulletList(
      state,
      item.diffs.map(
        (d) =>
          `${FIELD_LABEL[d.field]} — should be "${d.canonical}", currently "${d.listed}"` +
          (d.note ? ` (${d.note})` : "")
      ),
      { size: 9 }
    );
  }
}

/**
 * ‼️ IT READS THE SCREENSHOTS BEFORE IT BUILDS THE LIST, AND THAT ORDER IS THE FIX.
 *
 * This document read "0 confirmed findings to correct, with 18 platforms still unchecked" on a
 * client whose step 5 thread held eighteen screenshots of those exact listings. Nothing was
 * wrong with the PDF: it reads confirmed_status, correctly, and nothing had ever turned a
 * picture into one. So the pass runs first, every attributed screenshot becomes a PROPOSED
 * status, the thread gets one card with a Confirm button on it, and the list below is built
 * from whatever a person has confirmed by then.
 *
 * On the first run that is usually still nothing, and the PDF still says so. The difference is
 * that confirming is now one tap on a card in the thread rather than eighteen rows of a form.
 */
async function proposeFromScreenshots(clientId: string, clientName: string): Promise<void> {
  const { proposeListingStatuses, formatCleanupProposals } = await import("../listing-read");
  const { notifyStep } = await import("../step-board");

  const pass = await proposeListingStatuses(clientId);
  if (!pass.ok) {
    console.error(`[citation-cleanup] proposal pass failed for ${clientId}: ${pass.error}`);
    return;
  }
  if (!pass.proposed.length && !pass.unreadable.length) return;

  const rows = await loadSweep(clientId);
  const body = formatCleanupProposals(rows);
  if (!body.length && !pass.unreadable.length) return;

  const lines = [`*Listings read from the sweep screenshots — ${clientName}*`, "", ...body];

  if (pass.unreadable.length) {
    lines.push(
      "",
      `${pass.unreadable.length} screenshot${pass.unreadable.length === 1 ? "" : "s"} could not be read as a listing: ` +
        pass.unreadable.map((u) => `${platformByKey(u.platform)?.label ?? u.platform} (${u.evidence})`).join(", ") +
        ". Those platforms stay at \"not checked\", which is the honest answer."
    );
  }

  if (pass.alreadyConfirmed.length) {
    lines.push(
      "",
      `${pass.alreadyConfirmed.length} platform${pass.alreadyConfirmed.length === 1 ? " was" : "s were"} already confirmed by a person and were left alone.`
    );
  }

  const board = `${process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com"}/dashboard/clients/${clientId}`;
  lines.push(
    "",
    `Row by row instead: ${board}`,
    "Confirming writes `confirmed_status` and stamps who confirmed it. Until then every one of",
    "these reads as \"not checked\" on the client PDF, which is what it is."
  );

  const text = lines.join("\n");

  await notifyStep(clientId, "citation_cleanup_list", text, [
    { type: "section", text: { type: "mrkdwn", text: text.slice(0, 2900) } },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Confirm all as read" },
          style: "primary",
          action_id: "cleanup_confirm_all",
          value: clientId,
        },
      ],
    },
  ]).catch((e) => console.error("[citation-cleanup] proposals card failed:", (e as Error).message));
}


export async function generateCitationCleanupList(clientId: string): Promise<AutoResult> {
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, legal_name, dba_name, city, state")
    .eq("id", clientId)
    .maybeSingle();

  if (!client) return { ok: false, error: "Client not found." };

  const canonical = await canonicalFor(clientId);
  if (!canonical) {
    return {
      ok: false,
      error:
        "No canonical NAP on file, so there is nothing to correct listings AGAINST. " +
        "Finish intake first — the cleanup list is meaningless without it.",
    };
  }

  // The read pass runs BEFORE the rows are loaded, so a screenshot confirmed in this same
  // session is in the list rather than in the next run of it.
  await proposeFromScreenshots(clientId, (client.dba_name || client.legal_name || "Client") as string);

  const rows = await loadSweep(clientId);
  const counts = countByStatus(rows);
  const items = buildCleanupList(canonical, rows);

  const name = (client.dba_name || client.legal_name || "Client") as string;
  // plainFooter rather than fidelityFooter, and the distinction is not cosmetic. A fidelity
  // line states which engines produced a document. Nothing here came from an engine: this is
  // the manual sweep's confirmed findings rearranged into work. Printing an engine count on
  // it would attribute the list to a measurement that never happened.
  const state: PageState = startDoc({
    title: `${name} — citation cleanup list`,
    footer: plainFooter(`${name} — citation cleanup list · internal`),
  });

  coverHeading(state, {
    eyebrow: "Citation cleanup list",
    title: name,
    subtitle:
      "Every listing with a confirmed finding against it, worst first, with the correction already written out.",
  });

  paragraph(
    state,
    "Every listing below has a CONFIRMED finding against it. Work core six first, top to bottom. " +
      "Nothing here has been submitted anywhere: this is the list, and a person does the work.",
    { size: 9.5 }
  );

  sectionHeading(state, "Canonical record");
  paragraph(state, canonicalLine(canonical), { size: 9.5 });
  paragraph(state, "Every correction below makes a listing match this line, exactly.", {
    color: MUTED,
    size: 9,
  });

  // ‼️ THE NOT-CHECKED COUNT LEADS, and it is the same rule the presence PDF enforces.
  // The sweep is manual and today mostly unchecked, so a list built from confirmed findings
  // is SHORT for a reason that has nothing to do with the listings being correct. A short
  // list with no explanation reads as "barely anything to fix", which is the opposite of
  // what it means.
  if (counts.not_checked > 0) {
    sectionHeading(state, "How much of this is actually known");
    paragraph(
      state,
      `${counts.not_checked} of the ${rows.length} platforms have not been checked yet. ` +
        `They cannot appear on this list, because there is no confirmed finding to put on it. ` +
        `The list gets longer as the sweep gets finished, and a short list here is a statement ` +
        `about how far the sweep has got rather than about the state of the listings.`,
      { color: AMBER, bold: true, size: 9.5 }
    );
  }

  if (!items.length) {
    sectionHeading(state, "Nothing to correct yet");
    paragraph(
      state,
      counts.not_checked > 0
        ? "No confirmed findings so far, and most platforms are still unchecked. This is not a clean bill of health, it is an unfinished sweep."
        : "Every checked platform matches the canonical record. Re-run this after the next sweep.",
      { color: counts.not_checked > 0 ? AMBER : MUTED }
    );
  } else {
    const core = items.filter((i) => i.tier === "core_six").length;
    const known = items.filter((i) => i.minutes !== null);
    const totalMinutes = known.reduce((sum, i) => sum + (i.minutes ?? 0), 0);

    sectionHeading(state, "The work");
    // The estimate covers only the rows whose platform carries a `minutes` value. Saying so
    // matters: a total that quietly excluded four rows would be read as covering all of them.
    const effort =
      known.length === 0
        ? " No time estimate: none of these platforms has one recorded."
        : known.length === items.length
          ? ` Roughly ${Math.round(totalMinutes / 60 * 10) / 10} hours of work.`
          : ` Roughly ${Math.round(totalMinutes / 60 * 10) / 10} hours across ${known.length} of them; the other ${items.length - known.length} have no time recorded.`;

    paragraph(
      state,
      `${items.length} listing${items.length === 1 ? "" : "s"} to correct, ${core} of them core six.` + effort,
      { size: 9.5 }
    );

    items.forEach((item, i) => itemBlock(state, item, i + 1));
  }

  sectionHeading(state, "Before any of this is executed");
  bulletList(state, [
    "Corrections need the access named against each row. Ask for all of them at once on the call rather than one at a time.",
    "The Day-0 archive has to exist first. Correcting a listing changes what the engines see, and the baseline every later scorecard is measured against cannot be recovered afterwards.",
    "Extended-tier rows are the implementation list, not week one. Fixing a Manta listing and fixing a Google one are not equivalent work.",
  ]);

  const buffer = finishDoc(state);

  const delivered = await deliverArtifact({
    clientId,
    stepKey: "citation_cleanup_list",
    filename: `${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-citation-cleanup.pdf`,
    buffer,
    message:
      `*Citation cleanup list — ${name}*\n` +
      `${items.length} confirmed finding${items.length === 1 ? "" : "s"} to correct` +
      (counts.not_checked > 0 ? `, with ${counts.not_checked} platforms still unchecked.` : ".") +
      `\nNothing has been submitted. This is the list; the work is manual and gated on the Day-0 archive.`,
  });

  if (!delivered.ok) return { ok: false, error: delivered.error };

  return {
    ok: true,
    docId: delivered.docId,
    note:
      `Citation cleanup list built: ${items.length} to correct` +
      (counts.not_checked > 0 ? `, ${counts.not_checked} platforms not yet checked.` : "."),
  };
}
