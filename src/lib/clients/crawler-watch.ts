// The recurring crawler-door probe: it speaks when the door CLOSES, and not otherwise.
//
// ‼️ IT RIDES AN EXISTING CRON AND MUST NOT GET ITS OWN. vercel.json already carries seventeen
// entries against a Hobby plan that documents two. The day 30/60/90 reminders made exactly this
// call and for exactly this reason; report-reminders.ts is the precedent and this sits beside it
// in the same daily run.
//
// ‼️ AND IT POSTS ON A CHANGE, NEVER ON A PASS. A message every morning saying the door is still
// open is a message nobody reads by the second week, and then the one that matters is invisible
// among them. The valuable fact is "this was open and is now shut", which is why
// client_crawler_probes is a log rather than a column.
//
// ‼️ SUBFOLDER CLIENTS FIRST, BECAUSE THEY ARE THE ONES WHO CAN CHANGE UNDER US. On a subdomain
// we generate the robots.txt and own the hostname, so it cannot close without us doing it. On a
// subfolder the file lives on a server we do not control and a plugin update can rewrite it
// overnight. A subdomain client is still read, because their main site is what the engines cite.

import { supabaseAdmin } from "@/lib/db";
import { checkDoor, recordDoor, lastDoor, doorLines } from "./crawler-door";

export interface WatchResult {
  checked: number;
  closed: string[];
  reopened: string[];
}

export async function runCrawlerWatch(opts: { dry?: boolean } = {}): Promise<WatchResult> {
  const out: WatchResult = { checked: 0, closed: [], reopened: [] };

  // Live clients with something to read. A client with no website has no door.
  const { data, error } = await supabaseAdmin
    .from("clients")
    .select("id, legal_name, dba_name, domain, website, status")
    .not("domain", "is", null);

  if (error) {
    console.error(`[crawler-watch] client read failed: ${error.message}`);
    return out;
  }

  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const clientId = String(row.id);
    const site = ((row.website as string | null) ?? (row.domain as string | null)) ?? "";
    if (!site) continue;

    const name = ((row.dba_name as string | null) || (row.legal_name as string | null)) ?? "a client";

    // The reading before this one, so a change can be told from a first sighting.
    const before = await lastDoor(clientId);

    const check = await checkDoor(site).catch(() => null);
    if (!check) continue;
    out.checked += 1;

    if (!opts.dry) await recordDoor(clientId, check);

    // ‼️ A FIRST SIGHTING IS NOT A CHANGE. A client whose door was already shut when we started
    // watching has not just broken anything, and announcing it as news would be wrong on the
    // first run for every client at once.
    if (!before) continue;

    if (check.closed && !before.closed) {
      out.closed.push(name);
      if (!opts.dry) {
        await notify(
          clientId,
          [
            `:rotating_light: *The AI crawlers can no longer read ${name}'s site.*`,
            "",
            ...doorLines(check),
            "",
            `It was open when this was last read, on ${new Date(before.checkedAt).toDateString()}.`,
            "Something changed on their side. A plugin update rewriting robots.txt is the usual cause.",
          ].join("\n")
        );
      }
    } else if (!check.closed && before.closed) {
      out.reopened.push(name);
      if (!opts.dry) {
        await notify(clientId, `:white_check_mark: *${name}'s site is readable by the AI crawlers again.*`);
      }
    }
  }

  return out;
}

/**
 * Into the client's own thread.
 *
 * ‼️ notifyThread AND NOT notifyStep. This is a fact about the client rather than about one
 * step, and it can arrive months after every step is closed. A step thread months old is a
 * thread nobody is looking at.
 */
async function notify(clientId: string, text: string): Promise<void> {
  try {
    const { notifyThread } = await import("./delivery-checklist");
    await notifyThread(clientId, text);
  } catch (e) {
    console.error(`[crawler-watch] notify failed: ${(e as Error).message}`);
  }
}
