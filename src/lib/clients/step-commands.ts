// A step command typed in the wrong step's thread.
//
// ‼️ MEASURED BEFORE IT WAS WRITTEN (2026-09-11). A card keeps the number it was posted with, and
// inserting steps renumbers the board, so after the prep call moved to step 11 the channel still
// held a card reading "11. Findings written up" (now step 13) and one reading "14. Citation
// cleanup list" (now 17). Matthew replied `terms:` in the first and pasted two keyword lists into
// the second, exactly as he had been told to by number. Neither is a command in those threads, so
// both fell through to the general assistant, which answered each with an essay, and nothing was
// saved. The reply looked like the system working.
//
// So a line that is unmistakably a command for ANOTHER step now gets a pointer to that step and
// an explicit "nothing was saved", never an answer. The patterns are the same anchored forms the
// owning handlers accept, so a sentence that merely mentions keywords or a plan still reaches the
// assistant.

import { supabaseAdmin } from "@/lib/db";
import { slackThreadLink } from "@/lib/slack-bot";
import { DELIVERY_STEPS, isStepKey, stepNumber, type StepKey } from "@/config/delivery-steps";

const OWNERS: ReadonlyArray<{ test: RegExp; step: StepKey; what: string }> = [
  { test: /^\s*[`*_]*(offer|terms)\s*:/i, step: "offer_locked", what: "The offer and the words customers use for it" },
  {
    test: /^\s*[`*_]*keywords\s+(approve\b|drop\s+\d|add\s*:|more\s+\S|check\b)/i,
    step: "keyword_set",
    what: "Keyword commands",
  },
  {
    test: /^\s*[`*_]*(plan(\s+(new|approve|(drop|swap)\s+\d{1,2}|edit\s+\d{1,2}\s*:.+))?|anchor(\s*:\s*\S+)?)\s*[`*_]*\s*$/i,
    step: "pre_call_pages",
    what: "Plan commands",
  },
];

/** Which step a command belongs to, or null when the text is not one. Pure, for the probe. */
export function commandOwner(text: string): { step: StepKey; what: string } | null {
  const hit = OWNERS.find((o) => o.test.test(text.trim()));
  return hit ? { step: hit.step, what: hit.what } : null;
}

/** The pointer to post, or null when the command is in the right thread or is not a command. */
export async function misroutedCommand(input: {
  clientId: string;
  stepKey: string | null;
  text: string;
}): Promise<string | null> {
  const owner = commandOwner(input.text);
  if (!owner || input.stepKey === owner.step) return null;

  const label = DELIVERY_STEPS.find((s) => s.key === owner.step)?.label ?? owner.step;
  const { data } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("slack_anchor_ts")
    .eq("client_id", input.clientId)
    .eq("step_key", owner.step)
    .maybeSingle();

  const { channelFor } = await import("./step-board");
  const channel = await channelFor(input.clientId);
  const ts = (data as { slack_anchor_ts?: string | null } | null)?.slack_anchor_ts ?? null;
  const here = input.stepKey && isStepKey(input.stepKey) ? ` This thread is step ${stepNumber(input.stepKey)}.` : "";

  return [
    `:point_right: *Nothing was saved.* ${owner.what} go in *step ${stepNumber(owner.step)}, ${label}*, not here.${here}`,
    ts && channel
      ? `Its thread: ${slackThreadLink(channel, ts)}`
      : "That step has not been posted yet. Its card appears in this channel when the board reaches it.",
  ].join("\n");
}
