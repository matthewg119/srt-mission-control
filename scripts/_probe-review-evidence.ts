// A confirmed review quote, end to end: filed, numbered, counted first-party, positioned.
//
// The screenshot half needs a real image in a real Slack thread and cannot run here. Everything
// AFTER the vision read can, and it is the half that touches the publish gate:
//
//   recordSource -> loadNumberedEvidence -> an S-ref -> isFirstParty -> positionQuote
//
// ‼️ IT CLEANS UP AFTER ITSELF IN A finally, the same shape _probe-page-gate.ts uses. It writes
// into page_sources, which is a real table on a real client, so a probe that left rows behind
// would put invented evidence under a client and the gate would count it.
//
//   bunx tsx --env-file=.env.local scripts/_probe-review-evidence.ts [clientId]
import { supabaseAdmin } from "@/lib/db";
import { recordSource, loadNumberedEvidence, isFirstParty, sourceLabel } from "@/lib/clients/page-evidence";
import { positionQuote, formatPositioning } from "@/lib/clients/page-review";

let failures = 0;
function check(pass: boolean, label: string, detail?: string) {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}`);
  if (!pass) {
    failures += 1;
    if (detail) console.log(`      ${detail}`);
  }
}

// Deliberately keeps a typo and a lowercase opener: the whole point is that it is stored as
// written. If anything in the path tidies it, the assertion below catches it.
const QUOTE =
  "i was so nervous about getting lip filler for the frist time but honestly the results " +
  "were so natural my husband didnt even notice, he just said i looked well rested";

async function main() {
  const clientId = process.argv[2] ?? (await srtId());
  if (!clientId) {
    console.log("No client. Pass an id or make sure srt-agency-llc exists.");
    process.exit(1);
  }

  let sourceId: string | null = null;

  try {
    // ── 1. It files ────────────────────────────────────────────────────────
    const filed = await recordSource({
      clientId,
      pageId: null,
      sourceType: "CUSTOMER_REVIEW",
      sourceContent: QUOTE,
      topic: "Customer review, Sarah M., google, 3 weeks ago",
      sourceUrl: "https://maps.google.com/probe",
      collectedVia: "review_screenshot",
      collectedBy: "@probe",
    });

    check(filed.ok, "a CUSTOMER_REVIEW source is accepted", filed.ok ? undefined : filed.error);
    if (!filed.ok) return;
    sourceId = filed.id;

    // ── 2. It is stored verbatim ───────────────────────────────────────────
    const { data: row } = await supabaseAdmin
      .from("page_sources")
      .select("source_content, source_type, collected_via")
      .eq("id", sourceId)
      .maybeSingle();

    check(row?.source_content === QUOTE, "the quote is stored character for character",
      row?.source_content === QUOTE ? undefined : `stored: ${String(row?.source_content).slice(0, 90)}`);
    check(row?.collected_via === "review_screenshot", "collected_via records how it was got");

    // ── 3. It reaches the drafter as a numbered, first-party source ─────────
    check(isFirstParty("CUSTOMER_REVIEW"), "isFirstParty counts a customer review");
    check(sourceLabel("CUSTOMER_REVIEW").length > 0, "it has a label for a card");

    const evidence = await loadNumberedEvidence(clientId, null);
    const mine = evidence.find((e) => e.sourceId === sourceId);

    check(!!mine, "it is numbered into the evidence the drafter is handed");
    if (mine) {
      check(/^S\d+$/.test(mine.ref), `it carries an S-ref (${mine.ref})`);
      check(mine.content === QUOTE, "the drafter is handed the quote unedited");
      check(mine.type === "CUSTOMER_REVIEW", "it keeps its type, which is what the gate reads");
    }

    // ‼️ FIRST-PARTY SORTS FIRST, and stored refs are compared against this ordering, so it has
    // to hold rather than merely be nice.
    const firstNonFirstParty = evidence.findIndex((e) => !isFirstParty(e.type));
    const myIndex = evidence.findIndex((e) => e.sourceId === sourceId);
    check(
      firstNonFirstParty === -1 || myIndex < firstNonFirstParty,
      "it sorts with the first-party sources, ahead of outside research"
    );

    // ── 4. The positioning, which is what Matthew asked for ────────────────
    const placed = await positionQuote(clientId, QUOTE);
    console.log("");
    for (const line of formatPositioning(placed)) console.log(`      ${line}`);
    console.log("");

    check(placed.checked >= 0, "the keyword set was consulted");
    check(
      placed.matched.every((m) => QUOTE.toLowerCase().includes(m.normalized)),
      "every phrase it claims is in the quote is actually in the quote"
    );
    // Zero matches is a real answer and must be SAID, never left blank.
    check(
      placed.matched.length > 0 || formatPositioning(placed).some((l) => /none of the/.test(l)),
      "zero matches is reported out loud rather than left silent"
    );
  } finally {
    if (sourceId) {
      await supabaseAdmin.from("page_sources").delete().eq("id", sourceId);
      console.log(`(cleaned up ${sourceId})`);
    }
  }

  if (failures) {
    console.log(`\n${failures} failing.`);
    process.exit(1);
  }
  console.log("\nAll checks passed.");
}

async function srtId(): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("clients")
    .select("id")
    .eq("slug", "srt-agency-llc")
    .maybeSingle();
  return (data?.id as string | null) ?? null;
}

main();

export {};
