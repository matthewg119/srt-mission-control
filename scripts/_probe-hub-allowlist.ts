/**
 * Probe: what a client-controlled hostname gets, for any path.
 *
 *   bun run scripts/_probe-hub-allowlist.ts
 *
 * Needs no database, no network and no Next runtime. Pure string work, which is exactly why the
 * decision lives in src/lib/hub/hub-paths.ts instead of inline in middleware.
 *
 * ‼️ WHAT IS BEING DEFENDED. learn.{aclient}.com, and a Launch Lane client's own apex, answer on
 * the SAME deployment as the internal CRM. This decision is what stops a hostname somebody
 * else's registrar controls from reaching /api/clients/start or /api/scan/* -- both public by
 * design and session-free, so on a client hostname they would be a lead-injection endpoint and a
 * model-spend faucet.
 *
 * ‼️ IT TESTS THE WHOLE DECISION, NOT A PIECE OF IT, AND THAT IS DELIBERATE.
 * An earlier version of this probe asserted that `/dashboard` was REFUSED. It is not, it is
 * served, and it is harmless for a completely different reason: everything served is rewritten
 * into /hub/{host}/..., where it can only ever be a lookup for a page belonging to that host's
 * client. Testing the shape check alone produced a confident, wrong statement about the security
 * model, and "fixing" the code to match would have removed the real protection in favour of a
 * denylist. Hence externalPathDecision(), and hence neutralisedByRewrite() below.
 *
 * ‼️ IT PROVES THE DECISION, NOT THE DEPLOYMENT. It cannot see middleware's matcher, the host
 * classification, or whether the route behind a served path 404s for the wrong kind of host.
 * Those need real requests. This is the half provable offline, and the half where a
 * one-character regex edit does the damage.
 */

import {
  externalPathDecision,
  isConciergePath,
  hubRewritePath,
  HUB_API,
} from "../src/lib/hub/hub-paths";

let failures = 0;

function served(path: string, why: string): void {
  if (externalPathDecision(path) === "rewrite") console.log(`  ok    serves  ${path.padEnd(34)} ${why}`);
  else {
    failures += 1;
    console.error(`  FAIL  REFUSED ${path.padEnd(34)} should be served: ${why}`);
  }
}

function refused(path: string, why: string): void {
  if (externalPathDecision(path) === "refuse") console.log(`  ok    404s    ${path.padEnd(34)} ${why}`);
  else {
    failures += 1;
    console.error(`  FAIL  REACHED ${path.padEnd(34)} MUST 404: ${why}`);
  }
}

/**
 * A path that IS served, and is harmless only because of where it is rewritten to.
 *
 * Asserting "refused" for these would encode a belief that is false. The rewrite is the
 * protection; the shape check never claimed to be one.
 */
function neutralisedByRewrite(path: string, why: string): void {
  const decision = externalPathDecision(path);
  const target = hubRewritePath("learn.aclient.example", path);
  const ok =
    decision === "rewrite" && target.startsWith("/hub/learn.aclient.example/") && target !== path;
  if (ok) console.log(`  ok    rewrites ${path.padEnd(12)} -> ${target.padEnd(42)} ${why}`);
  else {
    failures += 1;
    console.error(`  FAIL  ${path} decided "${decision}" -> ${target}: ${why}`);
  }
}

console.log("\nExternal host: the whole path decision\n");
console.log("SERVED AS HUB CONTENT");
served("/", "the index");
served("/robots.txt", "generated per host");
served("/sitemap.xml", "generated per host");
served("/llms.txt", "generated per host");
served("/pricing", "a one-segment hub slug");
served("/about", "a site marketing page");
served("/water-damage-restoration", "a long slug");
served("/answers", "the answer index on a site host");
served("/answers/how-much-does-it-cost", "an answer page on a site host");

console.log("\n404s OUTRIGHT");
refused("/dashboard/clients", "the CRM, two segments");
refused("/api/clients/start", "public by design, session-free: lead injection");
refused("/api/scan/run", "public by design, session-free: model-spend faucet");
refused("/api/onboarding/save", "public by design, session-free");
refused("/api/leads/funnel", "public by design, session-free");
refused("/api/internal/hub-hit", "two segments, and it writes to the database");
refused("/hub", "the internal rewrite target is not a public route");
refused("/hub/learn.someone.com", "would let one host address another host's subtree");

console.log("\nSERVED, AND NEUTRALISED BY THE REWRITE (not by a denylist)");
neutralisedByRewrite("/dashboard", "becomes a page-slug lookup, never the CRM");
neutralisedByRewrite("/login", "becomes a page-slug lookup, never the login form");
neutralisedByRewrite("/api", "one segment, no slash: a page-slug lookup");

console.log("\nFORWARDED WITH A HEADER");
for (const name of HUB_API) {
  const d = externalPathDecision(name);
  if (d === "forward_api") console.log(`  ok    ${name} is forwarded, not rewritten`);
  else {
    failures += 1;
    console.error(`  FAIL  ${name} decided "${d}"`);
  }
}

// ‼️ THE SET IS NAMES AND NOT A PREFIX, AND THIS IS WHAT HOLDS THAT LINE. HUB_API grew from one
// string to two on 2026-10-05, and the failure to guard against is the next person "simplifying"
// it into a startsWith, which would publish every present and future route under /api/hub/ on
// every hostname a client's registrar points at us. A sibling that was never listed must refuse.
{
  const unlisted = "/api/hub/reviews/export";
  const d = externalPathDecision(unlisted);
  if (d === "refuse") console.log(`  ok    ${unlisted} is refused: the set is names, not a prefix`);
  else {
    failures += 1;
    console.error(`  FAIL  ${unlisted} decided "${d}". HUB_API has become a prefix.`);
  }
}

console.log("\nTRAVERSAL AND SHAPE");
refused("/foo.php", "a dot");
refused("/a/b", "two segments that are not /answers/*");
refused("/answers/a/b", "three segments");
refused("/answers/", "trailing slash is not a slug");
refused("/answers/foo.php", "a dot in the answer slug");
refused("/../dashboard", "traversal");
refused("/hub/../dashboard", "traversal out of the refused hub prefix");
refused("/answers/../../api/clients/start", "traversal through the answers prefix");
refused("/%2e%2e/dashboard", "percent-encoded traversal");
refused("/Answers/x", "uppercase: paths arrive already-normalised, so this is a miss");
refused("/-leading-hyphen", "must start alphanumeric");
refused("/trailing-hyphen-", "must end alphanumeric");
refused("/answersx/y", "the literal prefix must be the whole segment");
refused("/xanswers/y", "ditto, the other way round");
refused("/w/some-client", "the concierge frame is not served on a client hostname");
refused("/embed.js", "the loader belongs to the concierge host only");
refused("", "an empty path is not the index");

console.log("\nCONCIERGE HOST");
{
  const ok = (p: string) => {
    if (isConciergePath(p)) console.log(`  ok    allows  ${p}`);
    else {
      failures += 1;
      console.error(`  FAIL  REFUSED ${p}`);
    }
  };
  const no = (p: string, why: string) => {
    if (!isConciergePath(p)) console.log(`  ok    refuses ${p.padEnd(30)} ${why}`);
    else {
      failures += 1;
      console.error(`  FAIL  ALLOWED ${p.padEnd(30)} ${why}`);
    }
  };
  ok("/embed.js");
  ok("/w/a-client");
  ok("/api/concierge");
  ok("/api/concierge/turn");
  no("/dashboard", "the CRM");
  no("/api/clients/start", "not a concierge route");
  no("/w/../api/clients/start", "traversal");
  no("/w/foo.php", "a dot");
  no("/", "the widget host has no index");
}

console.log("\nREWRITE TARGET");
{
  const cases: [string, string, string][] = [
    ["learn.x.com", "/", "/hub/learn.x.com"],
    ["learn.x.com", "/pricing", "/hub/learn.x.com/pricing"],
    ["x.com", "/answers/slug", "/hub/x.com/answers/slug"],
    ["x.com", "/robots.txt", "/hub/x.com/robots.txt"],
  ];
  for (const [host, path, want] of cases) {
    const got = hubRewritePath(host, path);
    if (got === want) console.log(`  ok    ${host}${path} -> ${got}`);
    else {
      failures += 1;
      console.error(`  FAIL  ${host}${path} -> ${got}, wanted ${want}`);
    }
  }
  // The host is in the PATH and not a header because Next's full-route cache keys on pathname.
  const a = hubRewritePath("one.example", "/pricing");
  const b = hubRewritePath("two.example", "/pricing");
  if (a !== b) console.log("  ok    two hosts sharing a path get disjoint rewrite targets");
  else {
    failures += 1;
    console.error("  FAIL  two hosts collide on one cache key");
  }
}

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
