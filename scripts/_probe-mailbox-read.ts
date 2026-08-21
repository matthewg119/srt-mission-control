// Probe: can we actually READ every mailbox in the rotation?
//
//   bunx tsx --env-file=.env.local scripts/_probe-mailbox-read.ts
//
// READ ONLY. It lists at most one message per mailbox per folder and writes nothing.
//
// This exists because of one assumption the sweeps now depend on. sent-sweep.ts and
// reply-sweep.ts loop outreachMailboxes() instead of reading /me, which is what makes the
// rotation's daily caps real — a send from submissions@ lands in submissions@'s Sent Items and
// /me never sees it, so reading /me alone left that mailbox's used count at 0 forever and, once
// matthew@ hit its cap, every pitch went out from submissions@ uncapped.
//
// The delegated token needs Mail.Read.Shared for a mailbox other than the connected account. If
// it does not have it, the sweep throws, which is the correct behaviour — it leaves the watermark
// alone and re-reads the window next run rather than reporting a silent "0 new messages". But it
// throws EVERY run, so the ladder stops entirely. Better to find out here.

import { microsoft } from "../src/lib/microsoft";
import { outreachMailboxes, toGraphMailbox, connectedMailbox } from "../src/config/outreach-mailboxes";

async function readOne(mailbox: string | undefined, folder: string | null): Promise<string> {
  try {
    for await (const msg of microsoft.listMessages({ mailbox, folder, top: 1, select: ["id", "subject", "receivedDateTime"] })) {
      return `ok — newest: ${(msg.subject ?? "(no subject)").slice(0, 50)} @ ${msg.receivedDateTime ?? "?"}`;
    }
    return "ok — readable, but empty in this window";
  } catch (e) {
    return `FAILED — ${(e as Error).message}`;
  }
}

async function main(): Promise<void> {
  const boxes = outreachMailboxes();
  console.log(`connected account: ${connectedMailbox()}`);
  console.log(`rotation: ${boxes.map((b) => `${b.address}:${b.dailyCap}`).join(", ")}\n`);

  let allOk = true;
  for (const box of boxes) {
    const graph = toGraphMailbox(box.address);
    const via = graph ? `/users/${graph}` : "/me";
    console.log(`${box.address}  (${via})`);

    // Both reads the sweeps actually perform: Sent Items for the budget ledger, all-folders for
    // replies. A mailbox readable for one and not the other is worth seeing separately.
    const sent = await readOne(graph, "sentitems");
    const inbound = await readOne(graph, null);
    console.log(`  sent items : ${sent}`);
    console.log(`  all folders: ${inbound}\n`);
    if (sent.startsWith("FAILED") || inbound.startsWith("FAILED")) allOk = false;
  }

  console.log(
    allOk
      ? "✅ every rotation mailbox is readable — the sweeps can attribute touches honestly"
      : "❌ a rotation mailbox is NOT readable. Grant Mail.Read.Shared on it, or drop it from\n" +
          "   OUTREACH_MAILBOXES until you do: the sweeps will throw on it every run and the\n" +
          "   follow-up ladder stops for everybody."
  );
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => {
  console.error("\n💥 probe threw:", e);
  process.exit(1);
});
