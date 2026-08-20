// Probe: which Outlook signature block the pitch lanes actually pick, and what it contains.
//
//   bunx tsx --env-file=.env.local scripts/_probe-signature.ts
//   bunx tsx --env-file=.env.local scripts/_probe-signature.ts "Some Other Block"
//
// WHY THIS EXISTS. auditSignatureHtml() looks the block up BY DISPLAY NAME
// (AUDIT_SIGNATURE_NAME, default "AI Ops") and SILENTLY falls back to the repo constant when no
// block matches. Both outcomes render a signature, so "the wrong signature" and "the block was
// never found" look identical from the outside — which is exactly the report that sent me here.
// This prints which one won, and the full list so a near-miss name is visible rather than guessed.

import { microsoft } from "../src/lib/microsoft";
import { auditSignatureHtml } from "../src/lib/audit-engine/lead-pitch";
import { EMAIL_SIGNATURE_HTML } from "../src/config/email-signature";

function textOf(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|table|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}

const indent = (s: string) => s.split("\n").map((l) => `      ${l}`).join("\n");

async function main(): Promise<void> {
  const want = process.argv[2] || process.env.AUDIT_SIGNATURE_NAME || "AI Ops";
  console.log(`Looking for the block named: "${want}"`);
  console.log(`(AUDIT_SIGNATURE_NAME is ${process.env.AUDIT_SIGNATURE_NAME ? `set to "${process.env.AUDIT_SIGNATURE_NAME}"` : "UNSET, so the code default applies"})\n`);

  const probe = await microsoft
    .rawSignaturesProbe()
    .catch((e) => ({ status: 0, ok: false, body: `error: ${(e as Error).message}` }));

  console.log(`=== Graph /me/mailboxSettings/signatures -> HTTP ${probe.status} ===`);
  if (!probe.ok) {
    // The body is capped at 500 chars by rawSignaturesProbe, which is plenty for an error.
    console.log(probe.body);
    console.log("\nMicrosoft is not answering, so every lane is on the repo fallback right now.");
    return;
  }

  // rawSignaturesProbe truncates at 500 chars, so re-fetch the parsed list by name instead of
  // trying to parse a clipped body. getSignatureByName is the same call the real code makes.
  const NAMES_TO_TRY = [want, "AI Ops", "AI Visibility", "S", "Submission", "default"];
  console.log(`\n=== resolving candidate block names ===`);
  const seen = new Set<string>();
  for (const n of NAMES_TO_TRY) {
    if (seen.has(n.toLowerCase())) continue;
    seen.add(n.toLowerCase());
    const html = await microsoft.getSignatureByName(n).catch(() => null);
    console.log(`  ${html ? "FOUND  " : "missing"}  "${n}"`);
    if (html && n.toLowerCase() === want.toLowerCase()) {
      console.log(indent(textOf(html)));
    }
  }

  const def = await microsoft.getDefaultSignature().catch(() => null);
  console.log(`\n=== the mailbox DEFAULT block ===`);
  console.log(def ? indent(textOf(def)) : "  none");

  console.log(`\n=== what auditSignatureHtml() actually returns ===`);
  const chosen = await auditSignatureHtml();
  const isFallback = chosen.trim() === EMAIL_SIGNATURE_HTML.trim();
  console.log(
    isFallback
      ? '  ❌ THE REPO FALLBACK. The Outlook block was NOT found, so every pitch is signed from code.'
      : "  ✅ a real Outlook block"
  );
  console.log(indent(textOf(chosen)));
}

main().catch((e) => {
  console.error("probe threw:", e);
  process.exit(1);
});
