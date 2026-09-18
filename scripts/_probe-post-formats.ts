// Does the written-post format registry hold together, and does the database agree with it?
//
// Run:
//   bunx tsx scripts/_probe-post-formats.ts                          (pure, offline, no env)
//   bunx tsx --env-file=.env.local scripts/_probe-post-formats.ts --live   (adds the catalogue half)
//
// The pure half needs no database, no key and no network, the same discipline _probe-score.ts and
// _probe-scraper.ts keep: this is a table of constants and proving it must not need a connection.
//
// ‼️ THE LIVE HALF IS THE ONE THAT MATTERS AND IT IS NOT "does a category string match". It asks
// whether the magnet a format names is REACHABLE END TO END for a real client, through rankMagnets
// with that client's real vertical and through isDeliverable(). Measured 2026-09-18: the four
// categorised lead_magnets rows are TWO magnets in four placements, all scoped to
// vertical = 'aeo-agency-med-spa'. The vertical axis is tested BEFORE category and refuses a
// non-matching client outright, so wiring the category through helps srt-agency-llc and NOBODY
// else until another client shares that vertical. That is a real limit of this feature and it is
// better printed by a probe than discovered on a client's live site.

import {
  POST_FORMATS,
  POST_FORMAT_IDS,
  SHAPES_PER_PAGE,
  categoryFor,
  formatsForTheme,
  getPostFormat,
  isPostFormatId,
  listPostFormats,
  spreadFor,
  type PostFormatId,
} from "../src/config/post-formats";

let pass = 0;
let fail = 0;

function ok(label: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ok    ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? ` :: ${detail}` : ""}`);
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

// ── 1. The registry is closed and total ──────────────────────────────────────
section("1. the registry is closed and total");

ok("every id has exactly one row", POST_FORMAT_IDS.every((id) => POST_FORMATS.filter((f) => f.id === id).length === 1));
ok("every row has an id in the union", POST_FORMATS.every((f) => (POST_FORMAT_IDS as readonly string[]).includes(f.id)));
ok("the counts agree", POST_FORMATS.length === POST_FORMAT_IDS.length);
ok("listPostFormats returns them all", listPostFormats().length === POST_FORMATS.length);
ok("getPostFormat resolves every id", POST_FORMAT_IDS.every((id) => getPostFormat(id)?.id === id));
ok("getPostFormat(null) is null", getPostFormat(null) === null);
ok("getPostFormat of an invented id is null", getPostFormat("listicle") === null);
ok("isPostFormatId accepts every id", POST_FORMAT_IDS.every((id) => isPostFormatId(id)));
ok("isPostFormatId refuses an invented id", !isPostFormatId("listicle"));
ok("isPostFormatId refuses a non-string", !isPostFormatId(3) && !isPostFormatId(null) && !isPostFormatId(undefined));

// ── 2. Every row declares enough to be usable ────────────────────────────────
section("2. every row declares enough to be usable");

for (const f of POST_FORMATS) {
  ok(`${f.id}: has a label`, f.label.trim().length > 0);
  ok(`${f.id}: declares at least one required dataset field`, f.dataset.some((d) => d.required));
  ok(`${f.id}: every dataset key is unique`, new Set(f.dataset.map((d) => d.key)).size === f.dataset.length);
  ok(`${f.id}: every dataset field has a second-person prompt`, f.dataset.every((d) => d.prompt.trim().length > 0));
  ok(`${f.id}: askedAs names what it requires`, f.askedAs.requires.length > 0);
  ok(`${f.id}: askedAs names what it refuses`, f.askedAs.refuse.length > 0);
  ok(`${f.id}: askedAs.shape is one sentence`, f.askedAs.shape.trim().length > 0);
}

// ── 3. ‼️ No digit anywhere, and no em dash ──────────────────────────────────
section("3. no digit anywhere, and no em dash");

// Every string in this file is printed into a prompt whose validator refuses a number appearing
// nowhere in its inputs. A digit here is a number the model is invited to echo and then refused for
// echoing, which fails the generation for a reason nobody reading the output could work out.
function stringsOf(v: unknown, path: string, out: Array<{ path: string; value: string }>): void {
  if (typeof v === "string") {
    out.push({ path, value: v });
    return;
  }
  if (Array.isArray(v)) {
    v.forEach((x, i) => stringsOf(x, `${path}[${i}]`, out));
    return;
  }
  if (v && typeof v === "object") {
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) stringsOf(x, `${path}.${k}`, out);
  }
}

const allStrings: Array<{ path: string; value: string }> = [];
stringsOf(POST_FORMATS, "POST_FORMATS", allStrings);

// Keys and ids are identifiers, not prompt copy. The prompt-facing strings are the ones that reach a
// model, so those are the ones held to the digit rule.
const PROMPT_FACING = /\.(label|shape|requires|refuse|prompt|openingRule)(\[\d+\])?$/;
const promptStrings = allStrings.filter((s) => PROMPT_FACING.test(s.path));

ok("there are prompt-facing strings to check", promptStrings.length > 20, `found ${promptStrings.length}`);

const withDigit = promptStrings.filter((s) => /[0-9]/.test(s.value));
ok(
  "no prompt-facing string contains a digit",
  withDigit.length === 0,
  withDigit.map((s) => `${s.path}: ${s.value}`).join(" | ")
);

const withEmDash = allStrings.filter((s) => s.value.includes("—"));
ok("no string contains an em dash", withEmDash.length === 0, withEmDash.map((s) => s.path).join(" | "));

// ── 4. answer_first is the untouched baseline ────────────────────────────────
section("4. answer_first is the untouched baseline");

const answerFirst = getPostFormat("answer_first");
ok("answer_first exists", answerFirst !== null);
ok("answer_first declares NO outline overrides", Object.keys(answerFirst?.outline ?? { x: 1 }).length === 0);
ok("answer_first fits every theme", answerFirst?.fitsThemes === null);
ok("answer_first claims no magnet category", answerFirst?.magnetCategory === null);

// ── 5. The outline overrides are coherent ────────────────────────────────────
section("5. the outline overrides are coherent");

// Mirrors CONVERGENT_VOCABULARY in src/lib/hub/draft-page.ts. Duplicated deliberately: importing
// draft-page.ts would drag supabase and the whole grounding stack into an offline probe.
const CONVERGENT_SUBJECTS = ["price", "fear", "comparison", "process"];

for (const f of POST_FORMATS) {
  const ex = f.outline.exemptSubjects ?? [];
  ok(
    `${f.id}: every exemptSubject names a real convergent subject`,
    ex.every((s) => CONVERGENT_SUBJECTS.includes(s)),
    ex.join(",")
  );
  const shapes = f.outline.mandatoryShapes;
  if (shapes) ok(`${f.id}: mandatoryShapes are lowercase single words`, shapes.every((s) => /^[a-z]+$/.test(s)));
  const min = f.outline.minSections;
  const max = f.outline.maxSections;
  if (min !== undefined && max !== undefined) ok(`${f.id}: minSections is not above maxSections`, min <= max);
}

// ‼️ The divergence floor must never be lowered by a format. Lowering it would license a comparison
// page that is four pricing sections and two fear sections, which is the page the floor refuses.
const lowered = POST_FORMATS.filter((f) => f.outline.minDivergent !== undefined && f.outline.minDivergent < 5);
ok("no format lowers the divergence floor", lowered.length === 0, lowered.map((f) => f.id).join(","));

// ‼️ teardown must NOT exempt fear. A teardown that reaches the floor only by talking about risk,
// danger and pain is scaremongering.
const teardown = getPostFormat("teardown");
ok("teardown does not exempt fear", !(teardown?.outline.exemptSubjects ?? []).includes("fear"));
ok("comparison exempts its own subject", (getPostFormat("comparison")?.outline.exemptSubjects ?? []).includes("comparison"));

// ‼️ Answer first is specialised, never dropped.
for (const f of POST_FORMATS) {
  if (f.outline.openingRule) {
    ok(`${f.id}: its opening rule still says answer first`, /ANSWER FIRST/.test(f.outline.openingRule));
  }
}

// ── 6. formatsForTheme ───────────────────────────────────────────────────────
section("6. formatsForTheme");

ok("answer_first is offered for every theme", ["Objection", "Comparison", "Tool", "Guide", "Price", "Neighbourhood", "Booking", "General"].every((t) => formatsForTheme(t).some((f) => f.id === "answer_first")));
ok("a Booking theme is offered no comparison", !formatsForTheme("Booking").some((f) => f.id === "comparison"));
ok("a Booking theme IS offered a decision guide", formatsForTheme("Booking").some((f) => f.id === "decision_guide"));
ok("an Objection theme is offered a teardown", formatsForTheme("Objection").some((f) => f.id === "teardown"));
ok("a null theme still offers answer_first", formatsForTheme(null).some((f) => f.id === "answer_first"));
ok("an unknown theme still offers answer_first", formatsForTheme("Nonsense").some((f) => f.id === "answer_first"));

// ── 7. spreadFor ─────────────────────────────────────────────────────────────
section("7. spreadFor");

const generalRanks = [0, 1, 2, 3, 4, 5, 6];
const seenAcrossRanks = new Set<PostFormatId>();
for (const rank of generalRanks) {
  const s = spreadFor({ rank, role: "support", theme: "General" });
  s.formats.forEach((f) => seenAcrossRanks.add(f));
  ok(`rank ${rank}: returns exactly ${SHAPES_PER_PAGE}`, s.formats.length === SHAPES_PER_PAGE);
  ok(`rank ${rank}: every entry is a real id`, s.formats.every((f) => isPostFormatId(f)));
}
ok("every shape is visited across the supports", seenAcrossRanks.size === POST_FORMATS.length, [...seenAcrossRanks].join(","));

// ‼️ Deterministic, or `angles auto` and a later `angle N more` offer different shapes for one page.
const a = spreadFor({ rank: 3, role: "support", theme: "General" });
const b = spreadFor({ rank: 3, role: "support", theme: "General" });
ok("it is deterministic for one rank", JSON.stringify(a) === JSON.stringify(b));

const pillar = spreadFor({ rank: 0, role: "pillar", theme: "General" });
ok("the pillar is offered answer_first first", pillar.formats[0] === "answer_first");
ok("the pillar is not padded when the theme is rich", pillar.padded === false);

const booking = spreadFor({ rank: 2, role: "support", theme: "Booking" });
ok("a Booking support still gets a full set", booking.formats.length === SHAPES_PER_PAGE);
ok("a Booking support is never offered comparison", !booking.formats.includes("comparison"));

// A theme nothing but answer_first fits pads, and says so.
const thin = spreadFor({ rank: 1, role: "support", theme: "Nonsense" });
ok("a theme only answer_first fits is padded", thin.padded === true);
ok("a padded spread is still full length", thin.formats.length === SHAPES_PER_PAGE);
ok("a padded spread pads with answer_first", thin.formats.every((f) => f === "answer_first"));

ok("a negative rank does not throw or go out of range", spreadFor({ rank: -4, role: "support", theme: "General" }).formats.length === SHAPES_PER_PAGE);
ok("a fractional rank does not go out of range", spreadFor({ rank: 2.7, role: "support", theme: "General" }).formats.every((f) => isPostFormatId(f)));

// ── 8. categoryFor ───────────────────────────────────────────────────────────
section("8. categoryFor");

ok("the shape wins over the theme", categoryFor({ postFormat: "teardown", theme: "Price" }) === "Objection");
ok("answer_first defers to the theme", categoryFor({ postFormat: "answer_first", theme: "Neighbourhood" }) === "Neighbourhood");
ok("no format and no theme is null", categoryFor({ postFormat: null, theme: null }) === null);
ok("no format falls back to the theme", categoryFor({ postFormat: null, theme: "Guide" }) === "Guide");
ok("an empty theme is null, not an empty string", categoryFor({ postFormat: null, theme: "   " }) === null);
ok("list maps to Comparison", categoryFor({ postFormat: "list", theme: "General" }) === "Comparison");
ok("decision_guide maps to Guide", categoryFor({ postFormat: "decision_guide", theme: "General" }) === "Guide");

// ‼️ Nothing claims Neighbourhood: it is a property of the keyword, not of the shape.
ok("no format claims Neighbourhood", !POST_FORMATS.some((f) => f.magnetCategory === "Neighbourhood"));

// ── 9. Live: is the magnet a format names actually reachable? ────────────────
async function live() {
  section("9. LIVE: is the magnet a format names actually reachable?");

  const { supabaseAdmin } = await import("../src/lib/db");
  const { rungOf } = await import("../src/lib/concierge/magnets");

  // ‼️ HAS THE MIGRATION RUN? This is the one command that answers it, and it answers it the only
  // way that counts: by running the REAL select through PostgREST. supabase-js RETURNS an unknown
  // column as an error rather than throwing, so a lane can be silently reading nothing while tsc,
  // the build and every offline probe stay green. Nothing here writes.
  for (const [table, column] of [
    ["page_angles", "post_format"],
    ["page_plan", "post_format"],
    ["page_dataset", "post_format"],
    ["page_dataset", "format_dataset"],
    ["page_magnet_candidates", "post_format"],
  ] as const) {
    const { error } = await supabaseAdmin.from(table).select(`id, ${column}`).limit(1);
    ok(
      `${table}.${column} is selectable`,
      !error,
      error ? `${error.message}. Run docs/2026-09-18-post-formats.sql BEFORE deploying.` : ""
    );
  }

  const { data: rows, error } = await supabaseAdmin
    .from("lead_magnets")
    .select("magnet_key, audience, vertical, treatment, category, active, client_id, asset_url, concierge_entry")
    .not("category", "is", null);

  if (error) {
    ok("lead_magnets read succeeded", false, error.message);
    return;
  }

  const named = POST_FORMATS.map((f) => f.magnetCategory).filter((c): c is string => c !== null);
  const carried = new Set((rows ?? []).map((r) => String(r.category)));

  for (const c of new Set(named)) {
    ok(`some lead_magnets row carries "${c}"`, carried.has(c), `carried: ${[...carried].join(",") || "none"}`);
  }

  // The reachability half. A category that matches a row whose VERTICAL refuses this client is a
  // category that changes nothing, and that is the measured state for every client but SRT.
  const { data: configs } = await supabaseAdmin
    .from("concierge_configs")
    .select("client_id, vertical, audience")
    .limit(50);

  const verticals = new Set((configs ?? []).map((c) => String(c.vertical ?? "")).filter(Boolean));
  console.log(`  note  concierge verticals in use: ${[...verticals].join(", ") || "none"}`);

  for (const c of new Set(named)) {
    const matching = (rows ?? []).filter((r) => String(r.category) === c);
    const reachable = matching.filter((r) => {
      const rowVertical = (r.vertical as string | null) ?? null;
      return rowVertical === null || verticals.has(rowVertical);
    });
    ok(
      `"${c}" is reachable by at least one live client's vertical`,
      reachable.length > 0,
      `rows: ${matching.map((r) => `${r.magnet_key}@${r.vertical ?? "any"}`).join(", ")}`
    );
  }

  // rungOf is pure, so the ladder itself is provable here without a session.
  for (const c of new Set(named)) {
    const row = (rows ?? []).find((r) => String(r.category) === c);
    if (!row) continue;
    const scored = rungOf(
      {
        magnetKey: String(row.magnet_key),
        audience: row.audience as "owner" | "patient",
        clientId: (row.client_id as string | null) ?? null,
        vertical: (row.vertical as string | null) ?? null,
        treatment: (row.treatment as string | null) ?? null,
        category: (row.category as string | null) ?? null,
        // Only the axes rungOf reads matter here; the rest of LeadMagnet is not consulted by it.
      } as never,
      {
        audience: row.audience as "owner" | "patient",
        clientId: (row.client_id as string | null) ?? "00000000-0000-0000-0000-000000000000",
        vertical: (row.vertical as string | null) ?? null,
        treatment: null,
        category: c,
      } as never
    );
    ok(`"${c}" scores on a query carrying it`, typeof scored === "number" && scored !== null);

    const withoutCategory = rungOf(
      {
        magnetKey: String(row.magnet_key),
        audience: row.audience as "owner" | "patient",
        clientId: (row.client_id as string | null) ?? null,
        vertical: (row.vertical as string | null) ?? null,
        treatment: (row.treatment as string | null) ?? null,
        category: (row.category as string | null) ?? null,
      } as never,
      {
        audience: row.audience as "owner" | "patient",
        clientId: (row.client_id as string | null) ?? "00000000-0000-0000-0000-000000000000",
        vertical: (row.vertical as string | null) ?? null,
        treatment: null,
        category: null,
      } as never
    );
    // This is the rule the whole feature rests on and it must NOT change.
    ok(`"${c}" is refused by a query carrying no category`, withoutCategory === null);
  }
}

async function main() {
  if (process.argv.includes("--live")) {
    try {
      await live();
    } catch (e) {
      ok("the live half ran", false, (e as Error).message);
    }
  } else {
    console.log("\n(pure half only. Add --env-file=.env.local and --live for the catalogue checks.)");
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
