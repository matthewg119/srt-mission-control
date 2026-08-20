// Read-only probe of mailbox rotation. Touches nothing: it reads today's real send counts and
// then re-runs the SAME selection logic against synthetic counts to prove the boundaries.
//
//   bunx tsx --env-file=.env.local scripts/_probe-rotation.ts

import { mailboxHeadroom, chooseOutreachMailbox, mailboxLine } from "@/lib/followup-operator/mailboxes";
import { outreachMailboxes } from "@/config/outreach-mailboxes";

function simulate(used: Record<string, number>) {
  const configured = outreachMailboxes();
  const headroom = configured.map((m) => {
    const u = used[m.address] ?? 0;
    return { address: m.address, used: u, cap: m.dailyCap, left: Math.max(0, m.dailyCap - u), full: u >= m.dailyCap };
  });
  const open = headroom.find((h) => !h.full);
  const chosen = open ? configured.find((m) => m.address === open.address) ?? null : null;
  return mailboxLine(chosen, headroom);
}

async function main() {
  const configured = outreachMailboxes();
  console.log("\nCONFIGURED (ordered):");
  for (const m of configured) console.log(`  ${m.address}  cap ${m.dailyCap}/day`);

  console.log("\nLIVE, today:");
  console.log(" ", mailboxLine((await chooseOutreachMailbox()).chosen, await mailboxHeadroom()));
  for (const h of await mailboxHeadroom()) {
    console.log(`  ${h.address.padEnd(30)} used ${h.used}/${h.cap}  left ${h.left}${h.full ? "  FULL" : ""}`);
  }

  const [a, b] = configured.map((m) => m.address);
  console.log("\nBOUNDARIES (simulated counts, nothing written):");
  console.log("  empty            ->", simulate({}));
  console.log("  first 1 short    ->", simulate({ [a]: configured[0].dailyCap - 1 }));
  console.log("  first FULL       ->", simulate({ [a]: configured[0].dailyCap }));
  console.log("  first FULL, 2nd 4->", simulate({ [a]: configured[0].dailyCap, [b]: 4 }));
  console.log("  BOTH full        ->", simulate({ [a]: configured[0].dailyCap, [b]: configured[1].dailyCap }));
  console.log("  over cap         ->", simulate({ [a]: configured[0].dailyCap + 7, [b]: configured[1].dailyCap }));
  console.log("");
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
