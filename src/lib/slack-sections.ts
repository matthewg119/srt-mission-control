// Splitting a card body across Slack sections, on line boundaries.
//
// ‼️ SLACK'S LIMIT IS 3,000 CHARACTERS PER SECTION AND EXCEEDING IT FAILS THE WHOLE MESSAGE, not the
// section. `invalid_blocks`, nothing posted, and the only sign is a line in a server log. The step
// board hit this for real: the presence sweep card was already at 2,988 characters for a SHORT
// business name, and the name is interpolated into all nineteen search strings.
//
// ‼️ THIS IS THE FOURTH PLACE THAT WOULD HAVE NEEDED THIS FUNCTION, AND THE FIRST THAT EXPORTS IT.
// step-engine.ts, rerun-gaps.ts and policy-scan.ts each carry a private copy of the same 2,900
// constant and the same buf/size/flush loop. A fifth private copy is how one of them quietly gets a
// different budget. The three existing ones are deliberately left alone: moving them is a change to
// three shipped cards for no behaviour, and this module exists so the number stops multiplying from
// here rather than to relitigate what already works.

import type { SlackBlock } from "@/lib/slack-bot";

/**
 * Slack's hard limit is 3,000. This is the house budget and the other three copies use the same
 * number, which is the only reason they can be said to agree.
 */
export const SECTION_LIMIT = 2900;

/**
 * Split a body across as many sections as it needs, ON LINE BOUNDARIES.
 *
 * Never mid-line: these bodies carry search phrases, URLs and DNS values that get read aloud or
 * pasted, and a value broken across two Slack blocks is a value somebody pastes wrong. A single line
 * longer than the limit is passed through whole and would still fail the message, but nothing here
 * generates one, and truncating a phrase to make a card send is the worse failure: it would post a
 * keyword that does not exist.
 */
export function bodySections(body: readonly string[]): SlackBlock[] {
  const out: SlackBlock[] = [];
  let buf: string[] = [];
  let size = 0;

  const flush = () => {
    if (!buf.length) return;
    out.push({ type: "section", text: { type: "mrkdwn", text: buf.join("\n") } });
    buf = [];
    size = 0;
  };

  for (const line of body) {
    if (buf.length && size + line.length + 1 > SECTION_LIMIT) flush();
    buf.push(line);
    size += line.length + 1;
  }
  flush();
  return out;
}

/**
 * A Slack button label, inside the length Slack accepts.
 *
 * ‼️ OVER 75 CHARACTERS IS REJECTED AND TAKES THE WHOLE MESSAGE WITH IT. Truncated at 67 plus an
 * ellipsis, the same numbers step-engine.ts uses, and for the same reason: these labels carry
 * keyword phrases that a model wrote and nobody capped.
 */
export function buttonLabel(text: string): string {
  const t = text.trim();
  return t.length > 70 ? `${t.slice(0, 67)}...` : t;
}
