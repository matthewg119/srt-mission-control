// Probe for the Email hook lane's PURE logic — angle selection, the fraction, and the bold path.
//
// These are the parts that decide what a stranger is told about their own business, and all of
// them are pure, so they are checkable without spending an engine call. The model-facing half
// (runHookCheck, draftHookPitch) needs live keys and is verified by pressing the button.
//
//   bunx tsx --env-file=.env.local scripts/_probe-hook-pitch.ts

import {
  pickHookAngle,
  fractionPhrase,
  hookCheckContext,
  toSlackBold,
  type HookCheck,
} from "../src/lib/audit-engine/hook-pitch";
import { buildPitchHtml } from "../src/lib/audit-engine/lead-pitch";
import { hookFractionLine } from "../src/config/pitch";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
}

function base(over: Partial<HookCheck> = {}): HookCheck {
  return {
    businessName: "Velasquez Gutierrez Electrical",
    trade: "electrical contractor",
    city: "Bakersfield, CA",
    website: "https://example.com",
    results: [],
    measuredCount: 0,
    appearedCount: 0,
    topRival: null,
    siteSignals: [],
    robots: null,
    readTheirPages: true,
    ...over,
  };
}

const miss = (prompt: string, named: string[] = []) => ({ prompt, appeared: false, named });
const hit = (prompt: string) => ({ prompt, appeared: true, named: [] });
const dead = (prompt: string) => ({ prompt, appeared: null, named: [] });

// ── 1. Angle selection ───────────────────────────────────────────────────────

check(
  "miss + rival -> rival-substitute",
  pickHookAngle(
    base({
      results: [miss("q1", ["Electrical ASAP"]), miss("q2", ["Electrical ASAP"])],
      measuredCount: 2,
      topRival: { name: "Electrical ASAP", count: 2 },
    })
  ).id,
  "rival-substitute"
);

check(
  "miss, no rival -> buying-question",
  pickHookAngle(base({ results: [miss("q1")], measuredCount: 1 })).id,
  "buying-question"
);

// ‼️ The mirror gate. A business that came back in everything must NEVER be told it is missing.
check(
  "clean sweep, clean site -> present-but-thin",
  pickHookAngle(base({ results: [hit("q1"), hit("q2")], measuredCount: 2, appearedCount: 2 })).id,
  "present-but-thin"
);

check(
  "clean sweep + site finding -> site-signal",
  pickHookAngle(
    base({
      results: [hit("q1")],
      measuredCount: 1,
      appearedCount: 1,
      siteSignals: [{ kind: "stale_copyright", detail: "footer says 2019" }],
    })
  ).id,
  "site-signal"
);

// A rival that exists but was never actually named must not unlock the naming angle.
check(
  "miss + rival present but site clean still names the rival",
  pickHookAngle(
    base({
      results: [miss("q1", ["Acme"])],
      measuredCount: 1,
      topRival: { name: "Acme", count: 1 },
    })
  ).id,
  "rival-substitute"
);

// ── 2. The fraction: the no_data rule ────────────────────────────────────────
// Four questions asked, ONE got no answer. The denominator must be 3, not 4 — counting the dead
// call as a miss is exactly the defect that once published a fabricated 0/100.

const withDead = base({
  results: [miss("q1", ["Electrical ASAP"]), miss("q2"), hit("q3"), dead("q4")],
  measuredCount: 3,
  appearedCount: 1,
  topRival: { name: "Electrical ASAP", count: 1 },
});

check("fraction excludes the unanswered call", fractionPhrase(withDead), "You came back in 1 of the 3 searches I ran");
check("fraction wording comes from the constant", fractionPhrase(withDead), hookFractionLine(1, 3));

const ctx = hookCheckContext(withDead);
check("context hands over the finished phrase", ctx.includes("You came back in 1 of the 3 searches I ran"), true);
check("context forbids a percentage", ctx.includes("do not convert it to a percentage"), true);
check("context forbids customising the line", ctx.includes("do not customise it to this business"), true);
check("context marks the dead call as proving nothing", ctx.includes("NO ANSWER came back"), true);
check("context names the one permitted rival", ctx.includes("The one rival you may name: Electrical ASAP"), true);

// A clean site must forbid the tease outright rather than staying silent about it.
const cleanSite = hookCheckContext(base({ results: [miss("q1")], measuredCount: 1 }));
check("clean site forbids the tease", cleanSite.includes("found NOTHING wrong with it"), true);

const dirtySite = hookCheckContext(
  base({
    results: [miss("q1")],
    measuredCount: 1,
    siteSignals: [{ kind: "no_schema", detail: "no structured data anywhere on the page" }],
  })
);
check("site finding licenses the tease", dirtySite.includes("You may tease"), true);
check("site finding is withheld from the reader", dirtySite.includes("do NOT state it"), true);

// ── 3. Bold, end to end ──────────────────────────────────────────────────────

check("slack bold", toSlackBold("a **(for another client)** b"), "a *(for another client)* b");

const html = buildPitchHtml("Hello Antonio,\n\n\"panel upgrade\" **(for another client)**", "<sig/>");
check("outlook renders strong", html.includes("<strong>(for another client)</strong>"), true);
check("outlook keeps no literal asterisks", html.includes("**"), false);

// ‼️ The safety property: bold runs AFTER escaping, so nothing can inject a tag.
const nasty = buildPitchHtml("**<script>alert(1)</script>**", "");
check("html is escaped before bolding", nasty.includes("&lt;script&gt;"), true);
check("no live script tag survives", nasty.includes("<script>"), false);

// An unclosed marker must not swallow the rest of the email.
const unclosed = buildPitchHtml("one ** two\n\nthree", "");
check("unclosed bold is left alone", unclosed.includes("<strong>"), false);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} FAILED.`);
process.exit(failures === 0 ? 0 : 1);
