// Pure checks for the review link writer's parsing: which platform a pasted link belongs to, and
// which links are refused. No network, no database.
//
//   bunx tsx scripts/_probe-review-link.ts

import { parseReviewUrl, platformFromUrl } from "../src/lib/hub/review-destinations";
import { commandOwner } from "../src/lib/clients/step-commands";

let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}

const cases: Array<[string, string | null]> = [
  ["https://g.page/r/CabcDEF123/review", "google"],
  ["https://search.google.com/local/writereview?placeid=ChIJ", "google"],
  ["https://www.trustpilot.com/evaluate/srtagency.com", "trustpilot"],
  ["https://uk.trustpilot.com/review/srtagency.com", "trustpilot"],
  ["https://www.yelp.com/writeareview/biz/abc", "yelp"],
  ["https://www.facebook.com/srtagency/reviews", "facebook"],
  ["https://www.bbb.org/us/nc/greensboro/profile/x/customer-reviews", "bbb"],
  ["https://www.realself.com/find/x", "realself"],
  ["https://notgoogle.com/review", null],
  ["https://trustpilot.com.evil.io/review", null],
  ["https://srtagency.com/reviews", null],
];
for (const [url, want] of cases) {
  const got = platformFromUrl(url)?.key ?? null;
  check(`platformFromUrl ${url}`, got === want, `got ${got}`);
}

check("http refused", !parseReviewUrl("http://g.page/r/x").ok);
check("javascript refused", !parseReviewUrl("javascript:alert(1)").ok);
check("bare text refused", !parseReviewUrl("our google page").ok);
const wrapped = parseReviewUrl("<https://g.page/r/abc|g.page/r/abc>");
check("slack-wrapped link unwrapped", wrapped.ok && wrapped.value === "https://g.page/r/abc", JSON.stringify(wrapped));

check("`review link:` is owned by review_card_pdf", commandOwner("review link: https://g.page/r/x")?.step === "review_card_pdf");
check("a sentence about review links is not a command", commandOwner("the review link is broken") === null);

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nall review link checks pass");
