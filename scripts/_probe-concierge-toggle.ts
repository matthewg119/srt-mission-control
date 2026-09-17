// Can the concierge actually be switched on and off, and does the switch tell the truth?
//
//   bunx tsx --env-file=.env.local scripts/_probe-concierge-toggle.ts
//
// ‼️ READ-ONLY, WITH NO --run ESCAPE HATCH, AND THAT IS DELIBERATE. Every other probe that writes
// guards it behind a flag. This one cannot have one: the thing it would exercise is a switch that
// puts a widget on, or takes it off, somebody else's live website. A probe that flips it is a probe
// that can take a client's concierge down at 2am because a cron ran the wrong script. The write
// path is verified by reading the source, the refusal rules and the pure copy; the flip itself is
// verified by a person pressing it once.
//
// Without --env-file=.env.local the Supabase reads return nothing at all. Not an error. Nothing.

import { readFileSync } from "fs";
import { supabaseAdmin } from "@/lib/db";
import { stepNumber, DELIVERY_STEPS } from "@/config/delivery-steps";
import { switchLines, conciergeSwitchState, type ConciergeSwitchState } from "@/lib/clients/concierge-enabled";

let failed = 0;
function check(what: string, ok: boolean, detail = ""): void {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail && !ok ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}

const SRT_SLUG = "srt-agency-llc";

function src(path: string): string {
  return readFileSync(path, "utf8");
}

function base(over: Partial<ConciergeSwitchState> = {}): ConciergeSwitchState {
  return {
    enabled: true,
    live: true,
    addonStatus: "included",
    audienceConfirmedAt: "2026-09-01T00:00:00Z",
    bookingMode: "link",
    bookingUrl: "https://example.com/book",
    bookingPhone: null,
    allowedOrigins: ["https://example.com"],
    slug: "example",
    ...over,
  };
}

async function main() {
  // ── 1. The step exists and is still manual ────────────────────────────────
  console.log("\n1. the step the switch belongs to");

  const live = DELIVERY_STEPS.find((s) => s.key === "concierge_live");
  check("concierge_live is on the board", Boolean(live));
  check("it is still mode=manual", live?.mode === "manual", String(live?.mode));
  check(
    "it is still blocked by subdomain_live and call_held",
    (live?.blockedBy ?? []).includes("subdomain_live") && (live?.blockedBy ?? []).includes("call_held"),
    (live?.blockedBy ?? []).join(",")
  );
  check("stepNumber resolves it", stepNumber("concierge_live") > 0, String(stepNumber("concierge_live")));

  // ── 2. The copy ───────────────────────────────────────────────────────────
  console.log("\n2. what the switch says, and what it warns about");

  const onClean = switchLines(base(), "@matthew");
  check("ON says it is on", onClean[0].includes("ON"));
  check("a clean ON carries no warning", !onClean.some((l) => l.includes(":warning:")), onClean.join(" | "));

  const onNoAudience = switchLines(base({ audienceConfirmedAt: null }), "@matthew");
  check(
    "an unconfirmed audience warns",
    onNoAudience.some((l) => l.includes(":warning:") && /audience/i.test(l))
  );

  const onNoBooking = switchLines(
    base({ bookingMode: "none", bookingUrl: null, bookingPhone: null }),
    "@matthew"
  );
  check(
    "no booking destination warns",
    onNoBooking.some((l) => l.includes(":warning:") && /booking/i.test(l))
  );

  const onNoOrigins = switchLines(base({ allowedOrigins: [] }), "@matthew");
  check(
    "an empty origin list warns rather than reading as 'none'",
    onNoOrigins.some((l) => l.includes(":warning:") && /allowed_origins/.test(l))
  );

  const off = switchLines(base({ enabled: false, live: false }), "@matthew");
  check("OFF says it is off", off[0].includes("OFF"));
  check(
    "OFF carries no warnings at all",
    !off.some((l) => l.includes(":warning:")),
    "the kill switch must never lecture"
  );
  check(
    "OFF says the pages are unaffected",
    off.some((l) => /pages, magnets and plan are unaffected/i.test(l))
  );

  const everyLine = [...onClean, ...onNoAudience, ...onNoBooking, ...onNoOrigins, ...off];
  check("no line carries a banned dash", !everyLine.some((l) => l.includes("—")));
  check(
    "the step number is interpolated, never literal",
    everyLine.some((l) => l.includes(`Step ${stepNumber("concierge_live")}`))
  );

  // ── 3. The refusal rules, read off the source ─────────────────────────────
  console.log("\n3. the rules the write path enforces");

  const lib = src("src/lib/clients/concierge-enabled.ts");
  check("turning ON refuses a declined add-on", /args\.enabled && before\.addonStatus === "declined"/.test(lib));
  check(
    "the refusal names the fix",
    /concierge install/.test(lib),
    "a refusal without the undo is a dead end"
  );
  check("a missing row refuses rather than inserting one", /this client has no concierge row yet/.test(lib));
  check("it writes enabled and updated_at only", /update\(\{ enabled: args\.enabled, updated_at/.test(lib));
  check("it never writes addon_status", !/update\([^)]*addon_status/.test(lib));
  check("it busts the concierge-config tag", /revalidateTag\("concierge-config"\)/.test(lib));
  check("it logs to client_events", /logClientEvent/.test(lib));
  // ‼️ THE ASYMMETRY IS THE DESIGN, SO IT IS ASSERTED DIRECTLY RATHER THAN COUNTED. Every line that
  // tests for a declined add-on must also test args.enabled on the same line: that is what makes the
  // gate apply to turning ON and never to turning OFF. A kill switch that can decline to fire is not
  // one, and this is the check that would catch somebody "tidying" the condition out of the guard.
  const declinedGates = lib
    .split("\n")
    .filter((l) => /addonStatus === "declined"/.test(l) && !l.trimStart().startsWith("//"));
  check("something gates on a declined add-on", declinedGates.length > 0);
  check(
    "OFF is not gated on the add-on",
    declinedGates.every((l) => /args\.enabled\s*&&/.test(l)),
    declinedGates.find((l) => !/args\.enabled\s*&&/.test(l))?.trim() ?? ""
  );

  // ── 4. The doors ──────────────────────────────────────────────────────────
  console.log("\n4. the two surfaces, and what guards them");

  const route = src("src/app/api/clients/[id]/concierge/route.ts");
  check("the dashboard route checks the session itself", /const session = await auth\(\)/.test(route));
  check("it 401s without one", /status: 401/.test(route));
  check(
    "it demands a real boolean",
    /typeof body\.enabled !== "boolean"/.test(route),
    "a truthy check would let the string \"false\" switch a widget on"
  );
  check("it is not under the public api/concierge prefix", !route.includes("previewGrant"));

  const actions = src("src/app/api/slack/actions/route.ts");
  check('the slack switch registers "concierge_enable"', /case "concierge_enable":/.test(actions));
  check('the slack switch registers "concierge_disable"', /case "concierge_disable":/.test(actions));
  check(
    "neither slack button ticks the step",
    !/concierge_enable[\s\S]{0,1400}setDeliveryStep/.test(actions),
    "a green tick over unchecked work is the worst bug this design can have"
  );
  check(
    "it reposts the card in place",
    /concierge_enable[\s\S]{0,1600}postStep\(clientId, "concierge_live"\)/.test(actions)
  );

  const engine = src("src/lib/clients/step-engine.ts");
  check("the step card offers the pair", /step\.key === "concierge_live"/.test(engine));
  check(
    "it offers none when there is no row",
    /if \(!state\) return \[\];/.test(engine),
    "buttons that refuse on every press read as broken"
  );

  const form = src("src/app/dashboard/clients/[id]/concierge-form.tsx");
  check("the panel reports live, not the raw column", /view\.live \?/.test(form));
  check("the panel says it does not tick the step", /does not tick step/.test(form));

  // ── 5. Production, read only ──────────────────────────────────────────────
  console.log("\n5. what the switch reads on the live database");

  const { data: srt } = await supabaseAdmin
    .from("clients")
    .select("id, slug")
    .eq("slug", SRT_SLUG)
    .maybeSingle();

  if (!srt) {
    check(`${SRT_SLUG} resolves`, false, "resolve by slug, never a pinned id: SRT has been re-onboarded twice");
  } else {
    check(`${SRT_SLUG} resolves`, true);
    const state = await conciergeSwitchState(srt.id as string);
    check("it has a concierge row", Boolean(state), "step 18 creates it");
    if (state) {
      console.log(
        `        enabled=${state.enabled}  live=${state.live}  addon=${state.addonStatus}  ` +
          `booking=${state.bookingMode}  origins=${state.allowedOrigins.length}  ` +
          `audience_confirmed=${state.audienceConfirmedAt ? "yes" : "no"}`
      );
      check(
        "live agrees with enabled and the add-on",
        state.live === (state.enabled && state.addonStatus !== "declined")
      );
      check("the slug came back with it", Boolean(state.slug), "the embed snippet needs it");
    }
  }

  // How many clients would this switch have anything to act on.
  const { count: rows } = await supabaseAdmin
    .from("concierge_configs")
    .select("client_id", { count: "exact", head: true });
  const { count: on } = await supabaseAdmin
    .from("concierge_configs")
    .select("client_id", { count: "exact", head: true })
    .eq("enabled", true);
  console.log(`\n        ${rows ?? 0} concierge rows, ${on ?? 0} with enabled = true.`);

  console.log(failed === 0 ? "\nAll checks passed.\n" : `\n${failed} FAILED\n`);
  if (failed) process.exit(1);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
