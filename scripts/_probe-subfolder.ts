// The subfolder door, and the two rules that keep it from being a hole.
//
// Run: bun run scripts/_probe-subfolder.ts        (pure, offline)
//
// ‼️ THE PATTERNS ARE RE-DECLARED HERE, NOT IMPORTED, AND THAT IS DELIBERATE. middleware.ts
// runs on the Edge runtime and importing it into a Node probe drags `next/server` and the auth
// stack in with it. What this checks is that the SHAPE of the rule is right, so the pattern is
// copied and this comment is the instruction to copy it again if it changes. The same trade
// _probe-post-formats.ts makes for CONVERGENT_SUBJECTS.
//
// If you edit SITE_PATH or HUB_SLUG in middleware.ts and not here, this probe goes green while
// describing a middleware that no longer exists. Read both.

import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;
function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) {
    pass++;
    console.log(`  ok    ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? ` :: ${detail}` : ""}`);
  }
}
function section(t: string): void {
  console.log(`\n${t}`);
}

const MW = readFileSync("src/middleware.ts", "utf8");

// Copied from middleware.ts. See the header.
const SITE_PATH =
  /^\/s\/[a-z0-9][a-z0-9-]{0,62}(?:\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?|\/(?:robots\.txt|sitemap\.xml|llms\.txt))?$/;
const HUB_SLUG = /^\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

// ── 1. The pattern in the file is the pattern being tested ──────────────────
section("1. the copy here matches the one in middleware.ts");

ok("SITE_PATH is declared in middleware.ts", /const SITE_PATH = /.test(MW));
ok(
  "and its source is byte-identical to the copy in this probe",
  MW.includes(SITE_PATH.source),
  "the two have drifted. Copy the one in middleware.ts into this file."
);

// ── 2. ‼️ /s/* IS UNREACHABLE FROM OUTSIDE, AND NOT BY ITS OWN RULE ──────────
//
// The external branch's allowlist is `path === "/" || HUB_FILES.has(path) || HUB_SLUG.test(path)`.
// HUB_SLUG forbids a slash, so a two-segment path can never match it. That is what makes the
// subfolder door refused on every client-controlled hostname without a rule of its own -- the
// same mechanism that already keeps /api/internal/hub-hit off those hosts.
section("2. the external allowlist cannot reach it");

for (const p of ["/s/clinic", "/s/clinic/botox-cost", "/s/clinic/sitemap.xml"]) {
  ok(`HUB_SLUG refuses ${p}`, !HUB_SLUG.test(p));
}
ok("HUB_SLUG still allows an ordinary hub page", HUB_SLUG.test("/botox-cost"));

// ‼️ `/s` ON ITS OWN IS A HUB SLUG AND THAT IS CORRECT, NOT A LEAK. It is one segment, so on an
// external host it is rewritten to /hub/{host}/s and looked up as a page slug -- a client is
// perfectly entitled to publish a page there. The subfolder door needs a KEY after it, which
// takes it to two segments, which is what HUB_SLUG refuses.
ok("`/s` alone is an ordinary hub slug, not the door", HUB_SLUG.test("/s") && !SITE_PATH.test("/s"));

// ── 3. The shape of a legal subfolder path ──────────────────────────────────
section("3. what the door accepts");

for (const p of [
  "/s/clinic",
  "/s/clinic/botox-cost",
  "/s/test-clinic/what-to-expect",
  "/s/clinic/robots.txt",
  "/s/clinic/sitemap.xml",
  "/s/clinic/llms.txt",
]) {
  ok(`accepts ${p}`, SITE_PATH.test(p));
}

// ── 4. ‼️ And what it must never accept ─────────────────────────────────────
section("4. what it refuses");

for (const p of [
  "/s",                               // no key
  "/s/",                              // no key
  "/s/clinic/a/b",                    // two levels: the hub is one level of slugs
  "/s/clinic/../api/chat",            // traversal
  "/s/clinic/../../dashboard",        // traversal
  "/s/clinic/foo.php",                // a dot outside the three named files
  "/s/clinic/.env",                   // a dotfile
  "/s/CLINIC",                        // uppercase key
  "/s/clinic/Botox",                  // uppercase slug
  "/s/clinic%2f..%2fapi",             // encoded traversal
  "/s/-clinic",                       // a key cannot start with a hyphen
  "/s/clinic/sitemap.xml/extra",      // a file is the last segment or nothing
]) {
  ok(`refuses ${p}`, !SITE_PATH.test(p), "it matched");
}

// ── 5. ‼️ THE SECRET, AND THAT UNSET IS CLOSED ──────────────────────────────
//
// Internal hosts include *.vercel.app, where the inner Host header is caller-controlled. With
// no secret check, /s/{key} on a deployment URL is a way to read any client's pages by guessing
// a key. With a check that treats "unset" as "no check", a deployment missing the variable is
// the same hole wearing a config problem.
section("5. the secret, and unset is closed");

ok("the branch reads HUB_PROXY_SECRET", /process\.env\.HUB_PROXY_SECRET/.test(MW));
ok("it compares an x-hub-proxy header", /x-hub-proxy/.test(MW));
ok(
  "an unset secret refuses rather than allows",
  /if \(!secret \|\| req\.headers\.get\("x-hub-proxy"\) !== secret\) return notFound/.test(MW),
  "the guard is not a falsy-secret-means-skip"
);

// ── 6. Our copy is never the indexable one ──────────────────────────────────
section("6. our copy is noindex");

ok("middleware sets x-robots-tag on the response", /x-robots-tag/.test(MW) && /noindex/.test(MW));
ok(
  "the page sets robots index:false in its metadata too",
  /robots: \{ index: false, follow: false \}/.test(
    readFileSync("src/app/s/[siteKey]/[[...slug]]/page.tsx", "utf8")
  )
);
ok(
  "and its canonical points at the client's own origin",
  /alternates: \{ canonical: (url|siteUrl\(destination\)) \}/.test(
    readFileSync("src/app/s/[siteKey]/[[...slug]]/page.tsx", "utf8")
  )
);

// ── 7. The branch sits on the INTERNAL side ─────────────────────────────────
section("7. the branch is on the internal side");

const external = MW.indexOf('if (hostClass === "external")');
const site = MW.indexOf('if (path === "/s" || path.startsWith("/s/"))');
const internalMarker = MW.indexOf("// ── INTERNAL:");
ok("the external branch exists", external > 0);
ok("the internal marker exists", internalMarker > 0);
ok("the subfolder branch is AFTER the internal marker", site > internalMarker, `${site} vs ${internalMarker}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
