/**
 * The quality gate, exercised against real rows.
 *
 *   bunx tsx --env-file=.env.local scripts/_probe-page-gate.ts [clientId]
 *
 * !! WITHOUT --env-file=.env.local THIS RETURNS NOTHING. Not an error, nothing: supabaseAdmin
 * builds with undefined credentials and every query comes back empty. Same trap every other
 * probe in this folder carries.
 *
 * !! IT WRITES AND THEN DELETES. It creates a throwaway client_pages row and its sources,
 * runs the gate against them, and removes both in a finally block. It never touches a page
 * anybody wrote and it never publishes anything: runGate only inserts a page_gate_runs row,
 * which cascades away with the page.
 *
 * The model half is skipped by default (skipModel), so this runs in about a second and costs
 * nothing. Pass --model to include the read-through.
 */

import { supabaseAdmin } from "../src/lib/db";
import { runGate, hashBody } from "../src/lib/hub/page-gate";
import { recordSource } from "../src/lib/clients/page-evidence";

// ‼️ RESOLVED BY SLUG, NOT PINNED TO AN ID. This used to hold the literal
// a11e0bda-46e9-4d90-94ff-54e47c244f23, and that row does not exist any more: SRT Agency was
// re-onboarded and `clients.slug` is the unique provisioning claim, so a re-onboard produces a
// NEW id under the SAME slug. A pinned id therefore rots silently and every check in this probe
// reports missing data rather than a wrong id.
const DEFAULT_SLUG = "srt-agency-llc";

async function defaultClientId(): Promise<string> {
  const { data } = await supabaseAdmin
    .from("clients")
    .select("id")
    .eq("slug", DEFAULT_SLUG)
    .maybeSingle();
  if (!data) throw new Error(`no clients row with slug ${DEFAULT_SLUG}; pass a client id instead`);
  return data.id as string;
}
const WITH_MODEL = process.argv.includes("--model");

let failures = 0;

function check(name: string, ok: boolean, detail: string): void {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${name}\n         ${detail}`);
  if (!ok) failures++;
}

interface Case {
  name: string;
  body: string;
  sources: string[];
  /** The check key expected to fail, and the verdict the whole run should reach. */
  expectFail: string | null;
  expectVerdict: "pass" | "warn" | "block";
}

const CASES: Case[] = [
  {
    name: "an invented price blocks",
    // 4200 appears nowhere in the sources. This is the failure the whole layer exists for.
    body:
      "We treat this the same way for every patient who walks in. The consultation is free and " +
      "the treatment itself runs about 4200 dollars depending on how much area we are covering. " +
      "Most people come back twice in the first year, and we tell them that up front rather than " +
      "letting them find out later. We do not book anybody who has not had the consultation, " +
      "because the plan depends entirely on what we see in the room on the day.",
    sources: [
      "We do the consultation free, always have. The plan depends on what we see in the room, so we will not book somebody sight unseen. Most patients are back twice in the first year and we say so up front.",
    ],
    expectFail: "orphan_numbers",
    expectVerdict: "block",
  },
  {
    name: "no evidence at all blocks",
    body:
      "This is a common question and the answer depends on your situation. A qualified provider " +
      "will walk you through the options and help you decide what is right for you. Every person " +
      "is different and there is no single answer that fits everybody who asks about this.",
    sources: [],
    expectFail: "no_evidence",
    expectVerdict: "block",
  },
  {
    name: "a thin page warns and still publishes",
    body: "We do the consultation free, always have. The plan depends on what we see on the day.",
    sources: [
      "We do the consultation free, always have. The plan depends on what we see in the room on the day.",
    ],
    expectFail: "thin",
    expectVerdict: "warn",
  },
  {
    name: "an evidenced page passes",
    body:
      "The consultation is free, and it has been since we opened. What happens after it depends " +
      "entirely on what we see in the room on the day, which is why we will not book anybody " +
      "sight unseen. Most patients come back twice in the first year. We tell people that at the " +
      "consultation rather than letting them find it out on the second visit, because the second " +
      "visit is the one people are not expecting and it is the one that loses their trust when " +
      "nobody warned them. If you are deciding whether to come in, the consultation costs you " +
      "nothing and it is the only honest way to answer this question for your own case.",
    sources: [
      "We do the consultation free, always have. The plan depends on what we see in the room on the day, so we will not book somebody sight unseen. Most patients are back twice in the first year and we say so up front rather than letting them find out on the second visit, because that is the visit that loses their trust if nobody warned them.",
    ],
    expectFail: null,
    expectVerdict: "pass",
  },
];

async function main(): Promise<void> {
  const passed = process.argv.find((a) => a.includes("-") && a.length === 36);
  const clientId = passed ?? (await defaultClientId());

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, legal_name")
    .eq("id", clientId)
    .maybeSingle();

  if (!client) {
    console.error(
      `No client ${clientId}. Either the id is wrong or .env.local was not passed, which ` +
        `returns nothing rather than failing.`
    );
    process.exit(1);
  }

  console.log(`Client: ${client.legal_name as string}`);
  console.log(`Model read-through: ${WITH_MODEL ? "on" : "off (pass --model to include it)"}\n`);

  // hashBody is the reliability of the whole gate, so it is asserted before anything else.
  check(
    "hashBody ignores whitespace but not words",
    hashBody("a  b\nc") === hashBody("a b c") && hashBody("a b c") !== hashBody("a b d"),
    "Re-wrapping a paragraph keeps a verdict; changing a word invalidates it."
  );

  for (const c of CASES) {
    const slug = `probe-gate-${Math.abs(hashBody(c.name).slice(0, 8).split("").reduce((a, ch) => a + ch.charCodeAt(0), 0))}`;
    let pageId: string | null = null;

    try {
      const { data: page, error } = await supabaseAdmin
        .from("client_pages")
        .insert({
          client_id: clientId,
          slug,
          title: `PROBE ${c.name}`,
          question: "How much does the consultation cost and what happens after it?",
          answer_md: c.body,
          status: "draft",
        })
        .select("id")
        .maybeSingle();

      if (error || !page?.id) {
        check(c.name, false, `Could not create the probe page: ${error?.message ?? "no id"}`);
        continue;
      }
      pageId = page.id as string;

      for (const text of c.sources) {
        await recordSource({
          clientId,
          pageId,
          sourceType: "CLIENT_VOICE",
          sourceContent: text,
          topic: "probe",
          collectedVia: "slack_typed",
        });
      }

      const res = await runGate(clientId, pageId, { skipModel: !WITH_MODEL, runBy: "probe" });
      if (!res.ok) {
        check(c.name, false, `The gate did not run: ${res.error}`);
        continue;
      }

      const failed = res.run.checks.filter((x) => x.status === "fail").map((x) => x.key);
      const verdictOk = res.run.verdict === c.expectVerdict;
      const failOk = c.expectFail === null ? failed.length === 0 : failed.includes(c.expectFail);

      check(
        c.name,
        verdictOk && failOk,
        `verdict ${res.run.verdict} (wanted ${c.expectVerdict}), failed [${failed.join(", ") || "none"}]` +
          (c.expectFail ? ` (wanted ${c.expectFail} among them)` : " (wanted none)")
      );
    } finally {
      // The gate run cascades with the page, and page_sources cascades too.
      if (pageId) await supabaseAdmin.from("client_pages").delete().eq("id", pageId);
    }
  }

  // ‼️ THE DASH RAIL, AND THE ONE THING THAT IS NOT A DASH.
  // copy-guard's BANNED includes `--`, so a markdown horizontal rule reads as punctuation and the
  // replica drafter rejected any section carrying one. Measured on srtagency.com 2026-09-04: four
  // of seven pages dropped, Home and Pricing among them, and not one of them contained an em dash.
  // The retry made it worse, rewriting "Founding Offer - 5 spots" as "Founding Offer. 5 spots",
  // because a model told its copy has a banned dash starts editing hyphens that were never wrong.
  //
  // withoutRules() exempts a line that is nothing but hyphens, and nothing else. These cases are
  // the proof that the exemption did not become a hole.
  {
    const { withoutRules } = await import("../src/lib/hub/draft-replica");
    const { hasBannedDash } = await import("../src/lib/copy-guard");
    const cases: Array<[string, string, boolean]> = [
      ["a horizontal rule is not a dash", "copy.\n\n---\n\n## Heading", false],
      ["an indented rule is not a dash", "copy\n\n   ---   \n\nmore", false],
      ["a longer rule is not a dash", "copy\n\n----\n\nmore", false],
      ["a single hyphen is still fine", "Founding Offer - 5 spots", false],
      ["an em dash is still rejected", "copy \u2014 more", true],
      ["an en dash is still rejected", "5\u201310 here", true],
      ["a horizontal bar is still rejected", "copy \u2015 more", true],
      ["a double hyphen in prose is still rejected", "copy -- more", true],
      ["--- inside a sentence is still rejected", "he said ---no", true],
      ["a rule does not hide a real dash beside it", "a\n\n---\n\nb \u2014 c", true],
    ];
    for (const [name, input, shouldReject] of cases) {
      check(name, hasBannedDash(withoutRules(input)) === shouldReject, JSON.stringify(input));
    }
  }

  console.log(`\n${failures === 0 ? "All green." : `${failures} failing.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
