// The duplicate onboarding warning, as a Slack card. Pure, so the probe can read it without Slack.
//
// Posted by provision.ts when a client was started through a door that could not ask first (the public
// /start page, a signed agreement). The Start pilot form asks before creating anything and never posts this.

import type { SlackBlock } from "@/lib/slack-bot";
import type { DuplicateMatch } from "@/lib/clients/archive";

export const IMPORT_ARCHIVE_ACTION = "client_import_archive";
export const KEEP_FRESH_ACTION = "client_import_fresh";

export function duplicateCardBlocks(args: {
  clientId: string;
  name: string;
  board: string;
  matches: readonly DuplicateMatch[];
}): { text: string; blocks: SlackBlock[] } {
  const text = `:warning: Possible duplicate onboarding: ${args.name}`;
  const blocks: SlackBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `:warning: *Possible duplicate onboarding: <${args.board}|${args.name}>*\n` +
          "This new client matches one we already have. Import the archived one's data to reactivate it, " +
          "or keep this onboarding fresh.",
      },
    },
  ];

  for (const m of args.matches.slice(0, 5)) {
    const line =
      m.kind === "client"
        ? `*${m.name}* is a LIVE client (<${m.detail}|board>), matched on ${m.reasons.join(", ")}. If this is the same business, stop this onboarding.`
        : `*${m.name}*, ${m.detail}, matched on ${m.reasons.join(", ")}. Importing brings back ${m.carries}.`;
    blocks.push({ type: "section", text: { type: "mrkdwn", text: line } });
    if (m.kind === "archive") {
      blocks.push({
        type: "actions",
        elements: [
          {
            type: "button",
            action_id: IMPORT_ARCHIVE_ACTION,
            style: "primary",
            text: { type: "plain_text", text: "Import data from duplicate", emoji: true },
            value: `${args.clientId}:${m.id}`,
          },
          {
            type: "button",
            action_id: KEEP_FRESH_ACTION,
            text: { type: "plain_text", text: "Keep it fresh", emoji: true },
            value: `${args.clientId}:${m.id}`,
          },
        ],
      });
    }
  }
  return { text, blocks };
}

/** "<clientId>:<archiveId>" from a button value, or null. */
export function readImportValue(value: string | null | undefined): { clientId: string; archiveId: string } | null {
  const m = /^([0-9a-f-]{36}):([0-9a-f-]{36})$/i.exec((value ?? "").trim());
  return m ? { clientId: m[1], archiveId: m[2] } : null;
}
