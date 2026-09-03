// Does the concierge hostname get its own narrow allowlist, and does nothing else leak onto it?
//
// The classifier is pure and import-free by design ("testable in isolation on purpose", says
// its own header), so this proves the security boundary with no database and no network.
//
// Run: bun run scripts/_probe-concierge-host.ts

import { classifyHost } from "../src/lib/hub/host-classify";

process.env.CONCIERGE_HOST ||= "concierge.srtagency.com";

// Mirrors the allowlist in src/middleware.ts. Kept in step by hand on purpose: if the two ever
// disagree, this probe is the thing that says so out loud.
const CONCIERGE_FRAME = /^\/w\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;
const allowedOnConcierge = (path: string) =>
  path === "/embed.js" ||
  CONCIERGE_FRAME.test(path) ||
  path === "/api/concierge" ||
  path.startsWith("/api/concierge/");

let failures = 0;
function check(label: string, actual: unknown, expected: unknown) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${ok ? "" : `  (got ${actual}, want ${expected})`}`);
}

console.log("\nclassification");
check("concierge.srtagency.com -> concierge", classifyHost("concierge.srtagency.com"), "concierge");
check("CONCIERGE_HOST with a port", classifyHost("concierge.srtagency.com:443"), "concierge");
check("uppercase Host header", classifyHost("Concierge.SRTAgency.com"), "concierge");
check("mission.srtagency.com stays internal", classifyHost("mission.srtagency.com"), "internal");
check("learn.aclinic.com stays external", classifyHost("learn.aclinic.com"), "external");
check("localhost stays internal (dev)", classifyHost("localhost"), "internal");
check("empty host fails closed", classifyHost(""), "external");

console.log("\nthe concierge allowlist permits only the widget");
check("/embed.js", allowedOnConcierge("/embed.js"), true);
check("/w/acme-medspa", allowedOnConcierge("/w/acme-medspa"), true);
check("/api/concierge/scan", allowedOnConcierge("/api/concierge/scan"), true);

console.log("\nand refuses everything the hostname must never serve");
for (const path of [
  "/api/leads/funnel",
  "/api/scan/start",
  "/api/clients/start",
  "/api/onboarding/save",
  "/dashboard",
  "/dashboard/clients",
  "/hub/learn.aclinic.com",
  "/api/internal/hub-hit",
  "/",
  "/w/acme/../../api/leads/funnel",
  "/w/acme.php",
  "/w/acme/extra",
]) {
  check(path, allowedOnConcierge(path), false);
}

// ‼️ THE ONE THAT MATTERS MOST. Somebody whose widget 404s will reach for INTERNAL_HOSTS. If
// that ever silently wins, the whole CRM is published on a hostname pasted into third-party
// pages for a living. The classifier checks concierge BEFORE internal precisely so it cannot.
console.log("\nINTERNAL_HOSTS cannot promote the concierge host");
process.env.INTERNAL_HOSTS = "concierge.srtagency.com";
check("still concierge, not internal", classifyHost("concierge.srtagency.com"), "concierge");

console.log(failures === 0 ? "\nall checks passed\n" : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
