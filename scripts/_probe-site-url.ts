// siteUrl(): the one place a public page URL is built.
//
// Pure, no network, no DB. It covers the two deliveries and the index/slug split, because
// a canonical that disagrees with the served URL by one slash is a canonical pointing at a
// redirect, and that is the whole class of bug this function exists to remove.

import { siteUrl, subdomainDestination, destinationLabel, type Destination } from "../src/lib/hub/destinations";

let pass = 0;
let fail = 0;
function ok(label: string, cond: boolean, detail = ""): void {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`); }
}
function eq(label: string, got: string, want: string): void {
  ok(label, got === want, `got ${got}, want ${want}`);
}

const sub: Destination = subdomainDestination("c1", "learn.clinic.com");

const folder: Destination = {
  id: "d2",
  clientId: "c1",
  host: "clinic.com",
  kind: "hub",
  delivery: "subfolder",
  basePath: "/learn",
  publicOrigin: "https://clinic.com",
  siteKey: "clinic",
  enabled: true,
};

console.log("\nSubdomain");
eq("index keeps its trailing slash", siteUrl(sub), "https://learn.clinic.com/");
eq("a page hangs off the root", siteUrl(sub, "botox-cost"), "https://learn.clinic.com/botox-cost");
eq("an empty slug is the index", siteUrl(sub, ""), "https://learn.clinic.com/");
eq("a null slug is the index", siteUrl(sub, null), "https://learn.clinic.com/");
eq("a leading slash on the slug is absorbed", siteUrl(sub, "/botox-cost"), "https://learn.clinic.com/botox-cost");

console.log("\nSubfolder");
eq("index is the base path, no trailing slash", siteUrl(folder), "https://clinic.com/learn");
eq("a page sits under the base path", siteUrl(folder, "botox-cost"), "https://clinic.com/learn/botox-cost");
eq("an empty slug is the index", siteUrl(folder, ""), "https://clinic.com/learn");
eq("a leading slash on the slug is absorbed", siteUrl(folder, "/botox-cost"), "https://clinic.com/learn/botox-cost");

console.log("\nThe two deliveries never agree by accident");
ok("a subfolder page is not on the subdomain", !siteUrl(folder, "x").includes("learn.clinic.com"));
ok("a subdomain page is not on the apex path", !siteUrl(sub, "x").includes("clinic.com/learn"));

console.log("\nThe text files build off the same function");
eq("robots names the sitemap where it lives", siteUrl(folder, "sitemap.xml"), "https://clinic.com/learn/sitemap.xml");
eq("and on a subdomain", siteUrl(sub, "sitemap.xml"), "https://learn.clinic.com/sitemap.xml");

console.log("\nThe picker label");
eq("a subdomain reads as its hostname", destinationLabel(sub), "learn.clinic.com");
ok("a subfolder says whose site it is", destinationLabel(folder).includes("their site"), destinationLabel(folder));

console.log("\nThe synthetic preview destination");
ok("is a subdomain", subdomainDestination("c", "h.example.com").delivery === "subdomain");
ok("carries no id, because nobody chose it", subdomainDestination("c", "h.example.com").id === "");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
