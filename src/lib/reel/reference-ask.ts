// The daily "feed me examples" ask.
//
// The shot grammar (src/config/shot-grammar.ts) fixes variety, but variety is not the same
// as looking real. What makes a generated frame read as photographed is grounding it on
// actual photographs, and the only person who has those is the operator. So once a morning,
// before the drop, this posts one message per drop channel asking for a handful of real
// reference shots or reel links.
//
// Anything dropped into that thread is filed through the SAME path the drop lane already
// uses (resolveDropMedia -> saveContentExample), so `loadReferenceFrames` starts feeding it
// back into the next drop's prompts. Typed feedback in the thread becomes candidate
// style_rules behind the existing checkmark gate. Nothing here generates or renders.

import { slack } from "@/lib/slack-bot";
import { supabaseAdmin } from "@/lib/db";
import { resolveDropMedia, type DroppedFile } from "@/lib/reel/drop-studio";
import {
  saveContentExample,
  countReferencesInSection,
  pruneReferencesToCap,
  HOOK_SECTION,
} from "@/lib/reel/content-examples";
import { distillFeedbackToRules, savePendingRules } from "@/lib/reel/style-rules";
import { stripEmDashes } from "@/lib/reel/text";
import { loadVertical } from "@/config/verticals";
import { SUBJECTS, CAPTURE, type ShotLane } from "@/config/shot-grammar";

/** How many references we want per lane before the ask goes quiet about it. */
const TARGET_PER_LANE = 30;

// A reference lane is a shot-grammar lane OR the hook, which is not a ShotLane: the hook is
// one dealt shot with its own look, not a subject library to draw from.
type ReferenceLane = ShotLane | "hook";

const LANES: Array<{ lane: ReferenceLane; label: string; wanted: string }> = [
  {
    lane: "owner",
    label: "the owner's world",
    wanted:
      "counters, back rooms, parking lots, paperwork, phones, storefronts, anything that looks like a real business on a slow day",
  },
  {
    lane: "treatment",
    label: "the treatment room",
    wanted:
      "trays, handpieces, chairs, towels, carts, the room mid-work, shot the way you would actually shoot it",
  },
  {
    lane: "hook",
    label: "the hook (scene 1)",
    wanted:
      "a treatment actually happening, botox, HIFU, filler or laser, the way a patient gets photographed: her face in frame, the injector as gloved hands, clean and cinematic",
  },
];

export function sectionFor(lane: ReferenceLane): string {
  return lane === "hook" ? HOOK_SECTION : `broll/${lane}`;
}

interface AskRow {
  channel: string;
  vertical_id: string;
  thread_ts: string;
  section: string;
}

/**
 * Post today's ask into one drop channel and remember its thread so replies can be claimed.
 * Returns ok:false with a reason rather than throwing - the cron reports per channel.
 */
export async function runReferenceAsk(args: {
  channel: string;
  verticalId: string;
}): Promise<{ ok: boolean; error?: string; skipped?: boolean }> {
  const { channel, verticalId } = args;
  const vertical = await loadVertical(verticalId);

  const counts = await Promise.all(
    LANES.map(async (l) => ({ ...l, have: await countReferencesInSection(verticalId, sectionFor(l.lane)) }))
  );
  const thin = counts.filter((c) => c.have < TARGET_PER_LANE);

  // Both lanes full: say so once and stop asking for more of the same.
  const lines: string[] = [];
  if (!thin.length) {
    lines.push(
      `*Reference library is full* for *${vertical.name}* - ${TARGET_PER_LANE}+ in both lanes.`,
      "Drop new shots any time and they replace the oldest. Otherwise nothing needed today."
    );
  } else {
    lines.push(`*Feed the model* - reference shots for *${vertical.name}*.`);
    lines.push(
      "Drop 3 to 5 real photos in this thread (yours, a competitor's, anything you saved off Instagram). They get filed and every prompt after that is grounded on them."
    );
    lines.push("");
    for (const c of thin) {
      lines.push(`• *${c.label}* - ${c.have}/${TARGET_PER_LANE} on file. Want: ${c.wanted}.`);
    }
    lines.push("");
    lines.push(
      `_Grounding beats instructions: ${SUBJECTS.length} subjects and ${CAPTURE.length} capture formats are already in the grammar, but only your photos tell it what real looks like._`
    );
    lines.push("_You can also just type what is wrong with the last batch. Corrections become saved style rules behind the checkmark._");
  }

  const posted = (await slack.postMessage(channel, lines.join("\n"))) as { ts?: string } | null;
  if (!posted?.ts) return { ok: false, error: "could not post the reference ask" };

  // Only track a thread we actually want replies on.
  if (thin.length) {
    const row: AskRow = {
      channel,
      vertical_id: verticalId,
      thread_ts: posted.ts,
      section: sectionFor(thin[0].lane),
    };
    try {
      const { error } = await supabaseAdmin.from("reference_asks").insert(row);
      if (error) return { ok: false, error: `posted but could not track the thread: ${error.message}` };
    } catch (e) {
      return { ok: false, error: `posted but could not track the thread: ${(e as Error).message}` };
    }
  }
  return { ok: true, skipped: thin.length === 0 };
}

/** The tracked ask for a thread, or null when the thread is not one of ours. */
async function askForThread(channel: string, threadTs: string): Promise<AskRow | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("reference_asks")
      .select("channel,vertical_id,thread_ts,section")
      .eq("channel", channel)
      .eq("thread_ts", threadTs)
      .maybeSingle();
    if (error || !data) return null;
    return data as AskRow;
  } catch {
    return null;
  }
}

/**
 * Which lane a reply is filing into. The operator can say so ("treatment room" / "owner"),
 * otherwise it lands in whichever lane the ask led with.
 */
function laneFromText(text: string, fallback: string): string {
  const t = text.toLowerCase();
  // Hook words are tested FIRST: "botox in the treatment room" is a hook reference, and the
  // treatment pattern below would otherwise claim it and file a face-forward clinic portrait
  // as documentary B-roll realism.
  if (/\bhook\b|\bbotox\b|\bhifu\b|\bfiller\b|\blaser\b|\binject(ing|ion|able)?\b|\bnurse\b/.test(t))
    return sectionFor("hook");
  if (/\btreat(ment)?\b|\broom\b|\bchair\b|\bclinical\b/.test(t)) return sectionFor("treatment");
  if (/\bowner\b|\bbusiness\b|\bfront\b|\boffice\b/.test(t)) return sectionFor("owner");
  return fallback;
}

/**
 * Claim files replied into a reference-ask thread. Returns false for every other thread so
 * the existing hook-studio / drop-studio routers keep their own.
 */
export async function handleReferenceAskFileDrop(args: {
  channel: string;
  threadTs: string;
  files: DroppedFile[];
  text: string;
}): Promise<boolean> {
  const ask = await askForThread(args.channel, args.threadTs);
  if (!ask) return false;

  const media = await resolveDropMedia(args.files);
  if (!media.length) {
    await slack.postThreadReply(
      args.channel,
      args.threadTs,
      "Could not read those files. Images work best; a video gets filed as its first frame."
    );
    return true;
  }

  const section = laneFromText(args.text, ask.section);
  const note = stripEmDashes(args.text).slice(0, 200);
  // ‼️ A hook reference is NOT a realism reference and must never carry that label. A clean,
  // cinematic, face-forward clinic portrait is the exact opposite of what REALISM_TAIL asks
  // for, and loadReferenceFrames feeds `realism_reference` rows to the B-roll lane as its
  // answer to "what does real look like". Only loadHookFrames reads these, by section.
  const isHook = section === HOOK_SECTION;
  const labels = isHook
    ? ["hook_reference", "operator_feedback", section]
    : ["realism_reference", "operator_feedback", section];
  for (const m of media) {
    await saveContentExample({
      verticalId: ask.vertical_id,
      sourcePath: m.url,
      storyboard: { hook: note || section, shots: [] },
      labels,
      difficulty: "medium",
      frameUrls: [m.url],
      section,
    });
  }
  const pruned = await pruneReferencesToCap(ask.vertical_id, section, TARGET_PER_LANE);
  const have = await countReferencesInSection(ask.vertical_id, section);

  try {
    await supabaseAdmin
      .from("reference_asks")
      .update({ saved_count: have })
      .eq("thread_ts", args.threadTs);
  } catch {
    // Counter only. Not worth failing the save the operator can see landed.
  }

  await slack.postThreadReply(
    args.channel,
    args.threadTs,
    `Filed ${media.length} reference${media.length === 1 ? "" : "s"} under *${section}* (${have} on file${pruned ? `, ${pruned} archived past the cap` : ""}). The next drop's prompts are grounded on them.`
  );
  return true;
}

/**
 * Claim typed replies in a reference-ask thread and turn concrete corrections into pending
 * style rules behind the same checkmark gate the drop lane uses.
 */
export async function handleReferenceAskReply(args: {
  channel: string;
  threadTs: string;
  text: string;
}): Promise<boolean> {
  const ask = await askForThread(args.channel, args.threadTs);
  if (!ask) return false;
  try {
    const distilled = await distillFeedbackToRules({
      text: args.text,
      formatGroup: "broll",
      verticalId: ask.vertical_id,
    });
    if (distilled.intent !== "tune" || distilled.rules.length === 0) {
      await slack.postThreadReply(
        args.channel,
        args.threadTs,
        "Nothing concrete to save in that. Drop photos, or tell me what specifically was wrong with a shot."
      );
      return true;
    }
    const lines = distilled.rules.map((r, i) => {
      const tag = r.scope === "brand" ? "brand" : r.format_group ?? "broll";
      return `${i + 1}. [${tag}] ${r.rule}`;
    });
    const card = (await slack.postThreadReply(
      args.channel,
      args.threadTs,
      [
        "*Keep these style rules?* React with the checkmark to save them for future drops, or the no-entry sign to discard.",
        ...lines,
      ].join("\n")
    )) as { ts?: string } | null;
    if (card?.ts) {
      await savePendingRules(distilled.rules, {
        verticalId: ask.vertical_id,
        channel: args.channel,
        threadTs: args.threadTs,
        proposalTs: card.ts,
      });
    }
    return true;
  } catch (e) {
    console.error("[reference-ask] feedback distill failed:", (e as Error).message);
    return true;
  }
}
