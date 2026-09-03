// The attribution rules, proved against the REAL database.
//
//   npx tsx --env-file=.env.local scripts/_probe-attribution-live.ts
//
// ‼️ THIS IS THE HALF _probe-attribution.ts CANNOT DO, AND IT IS THE HALF THAT MATTERS.
// That probe reads docs/2026-09-03-attribution.sql as TEXT and asserts the generated expression
// is written down. Text is not behaviour. A column can be declared generated in a file that was
// never run, or run against a database where an older version of the table already existed and
// `create table if not exists` quietly did nothing. Only Postgres can answer whether
// `qualified` is actually generated and whether the CHECK constraints actually refuse.
//
// ‼️ IT WRITES AND DELETES ITS OWN ROWS, ON A REAL CLIENT, AND IT CLEANS UP IN `finally`.
// Same shape as _probe-page-gate.ts. Every row it writes carries is_test = true, so even a
// crash between the insert and the delete leaves rows that every report already filters out.

import { supabaseAdmin } from "../src/lib/db";

const TEST_CODE = "probe-attribution";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (detail) console.log(`      ${detail}`);
}

/** Insert and return the row, or return the error message. Never throws. */
async function insert(row: Record<string, unknown>) {
  const { data, error } = await supabaseAdmin
    .from("attribution_bookings")
    .insert({ ...row, is_test: true, test_code: TEST_CODE })
    .select("id, count_basis, self_report, ai_evidence, qualified")
    .maybeSingle();
  return { row: data as Record<string, unknown> | null, error: error?.message ?? null };
}

async function main() {
  // Any client will do: nothing here reads the client, it is a foreign key.
  const { data: client, error: clientErr } = await supabaseAdmin
    .from("clients")
    .select("id, legal_name")
    .limit(1)
    .maybeSingle();
  if (clientErr || !client) {
    console.log("No clients row to hang test bookings off. Nothing to prove; not a failure.");
    return;
  }
  const clientId = client.id as string;
  console.log(`Using client ${clientId} (${client.legal_name ?? "?"}), rows flagged is_test.\n`);

  try {
    // ── The tables exist and carry the columns the code expects ──
    for (const t of ["attribution_sessions", "attribution_bookings", "attribution_monthly"]) {
      const { error } = await supabaseAdmin.from(t).select("id").limit(1);
      check(`${t} exists and is readable`, !error, error?.message ?? "");
    }

    // ── THE MAIN RULE, four ways ──

    const pixel = await insert({ client_id: clientId, count_basis: "pixel_only", ai_evidence: false });
    check(
      "a pixel booking inserts and comes back NOT qualified",
      pixel.row?.qualified === false,
      pixel.error ?? JSON.stringify(pixel.row)
    );

    // ‼️ THE LOCK. If this INSERT succeeds, the constraint is missing and a pixel row can be
    // dressed up as AI evidence. It must be refused by the database, not by the route.
    const pixelLying = await insert({
      client_id: clientId,
      count_basis: "pixel_only",
      ai_evidence: true,
    });
    check(
      "the database REFUSES a pixel booking that claims AI evidence",
      pixelLying.row === null && Boolean(pixelLying.error),
      pixelLying.error ?? "IT WAS ACCEPTED. attribution_bookings_pixel_no_evidence is missing."
    );

    // ‼️ THE GENERATED COLUMN, PROVED BY TRYING TO WRITE IT. If `qualified` is an ordinary
    // column this insert succeeds and the whole design is decoration: any writer could set it.
    const forced = await supabaseAdmin
      .from("attribution_bookings")
      .insert({
        client_id: clientId,
        count_basis: "pixel_only",
        ai_evidence: false,
        qualified: true,
        is_test: true,
        test_code: TEST_CODE,
      })
      .select("id, qualified")
      .maybeSingle();
    check(
      "the database REFUSES a hand-written `qualified`, so it is genuinely generated",
      forced.data === null && Boolean(forced.error),
      forced.error?.message ??
        "IT WAS ACCEPTED. `qualified` is an ordinary column and any writer can set it."
    );

    // ── The two bases that may count ──

    const assistantAi = await insert({
      client_id: clientId,
      count_basis: "assistant",
      self_report: "ai",
      ai_evidence: true,
    });
    check(
      "a Concierge booking whose patient said AI IS qualified",
      assistantAi.row?.qualified === true,
      assistantAi.error ?? JSON.stringify(assistantAi.row)
    );

    const assistantFriend = await insert({
      client_id: clientId,
      count_basis: "assistant",
      self_report: "friend_family",
      ai_evidence: false,
    });
    check(
      "a Concierge booking whose patient said friend or family is NOT qualified",
      assistantFriend.row?.qualified === false,
      assistantFriend.error ?? JSON.stringify(assistantFriend.row)
    );

    const selfAi = await insert({
      client_id: clientId,
      count_basis: "self_reported",
      self_report: "ai",
      ai_evidence: true,
    });
    check(
      "the clinic's own form counts when the patient said AI",
      selfAi.row?.qualified === true,
      selfAi.error ?? JSON.stringify(selfAi.row)
    );

    // ‼️ 'self_reported' WITH NO ANSWER IS A ROW CLAIMING EVIDENCE IT DOES NOT HOLD.
    const selfBlank = await insert({
      client_id: clientId,
      count_basis: "self_reported",
      ai_evidence: false,
    });
    check(
      "the database REFUSES a self_reported booking with no answer on it",
      selfBlank.row === null && Boolean(selfBlank.error),
      selfBlank.error ?? "IT WAS ACCEPTED. attribution_bookings_self_report_present is missing."
    );

    const badBasis = await insert({ client_id: clientId, count_basis: "vibes" });
    check(
      "the database REFUSES an unknown count_basis",
      badBasis.row === null && Boolean(badBasis.error),
      badBasis.error ?? "IT WAS ACCEPTED. attribution_bookings_basis_check is missing."
    );

    // ── The count query is what the guarantee reads, and a test row must not move it ──
    const { count: qualifiedTest } = await supabaseAdmin
      .from("attribution_bookings")
      .select("id", { count: "exact", head: true })
      .eq("client_id", clientId)
      .eq("qualified", true)
      .eq("is_test", false);
    check(
      "the real qualified count for this client is unmoved by the test rows just written",
      (qualifiedTest ?? 0) === 0,
      `real qualified bookings: ${qualifiedTest}. Two of the rows above ARE qualified, and both are is_test.`
    );

    // ── The session tri-state ──
    const sess = await supabaseAdmin
      .from("attribution_sessions")
      .insert({
        client_id: clientId,
        session_key: `probe-${Date.now()}`,
        referrer_kind: "ai",
        ai_engine: "chatgpt",
        is_test: true,
        test_code: TEST_CODE,
      })
      .select("id, referrer_kind, ai_engine")
      .maybeSingle();
    check("an ai session with an engine inserts", Boolean(sess.data), sess.error?.message ?? "");

    const contradiction = await supabaseAdmin
      .from("attribution_sessions")
      .insert({
        client_id: clientId,
        session_key: `probe-bad-${Date.now()}`,
        referrer_kind: "ai",
        ai_engine: null,
        is_test: true,
        test_code: TEST_CODE,
      })
      .select("id")
      .maybeSingle();
    check(
      "the database REFUSES an 'ai' verdict with no engine behind it",
      contradiction.data === null && Boolean(contradiction.error),
      contradiction.error?.message ??
        "IT WAS ACCEPTED. A row can now answer 'was this AI' two ways."
    );
  } finally {
    const b = await supabaseAdmin.from("attribution_bookings").delete({ count: "exact" }).eq("test_code", TEST_CODE);
    const s = await supabaseAdmin.from("attribution_sessions").delete({ count: "exact" }).eq("test_code", TEST_CODE);
    console.log(`\nCleaned up: ${b.count ?? 0} booking(s), ${s.count ?? 0} session(s).`);
  }

  console.log("");
  if (failures) {
    console.log(`${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("All checks passed.");
}

main();
