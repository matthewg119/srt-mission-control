// Read-only: what the lead page's Website field accepts and what it rejects.
import { normalizeTarget, normalizeErrorMessage } from "@/lib/scan/normalize";
const cases = [
  "irmgroup.com",
  "  HTTP://WWW.IrmGroup.com/about?x=1  ",
  "not a website",
  "localhost",
  "169.254.169.254",
  "acme",
  "srtagency.com/",
];
for (const c of cases) {
  const r = normalizeTarget(c);
  console.log(JSON.stringify(c).padEnd(42), "->", r.ok ? r.target.website : "REJECT: " + normalizeErrorMessage(r.error));
}
