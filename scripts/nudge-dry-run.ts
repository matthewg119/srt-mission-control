// The nudge sender's --dry-run. Queues nothing, sends nothing, claims no day.
//
//   bunx tsx --env-file=.env.local scripts/nudge-dry-run.ts

import { runNudgeSend, formatNudgeDryRun } from "@/lib/outreach-sender";
import { selectNudgeCandidates } from "@/lib/outreach-sender/select";
import { etDateKey } from "@/lib/followup-operator/cadence";
import { buildPacingReport } from "@/lib/outreach-sender/pacing";
import { mailboxHeadroom } from "@/lib/followup-operator/mailboxes";

async function main() {
  const now = new Date();
  const sel = await selectNudgeCandidates(now);
  const label = `${etDateKey(new Date(sel.windowStart))} 00:00 ET .. 24:00 ET`;
  const result = await runNudgeSend({ dry: true });
  console.log(formatNudgeDryRun(result, label));

  console.log("MAILBOX HEADROOM RIGHT NOW:");
  for (const h of await mailboxHeadroom(now)) {
    console.log(`  ${h.address.padEnd(30)} ${h.used}/${h.cap} used, ${h.left} left${h.full ? "  FULL" : ""}`);
  }
  console.log("");
  console.log("PACING REPORT, as it would post:");
  console.log("-".repeat(78));
  console.log((await buildPacingReport(now)).text);
  console.log("-".repeat(78));
  console.log("");
}

main().catch((e) => { console.error("FAILED:", e instanceof Error ? e.message : e); process.exit(1); });
