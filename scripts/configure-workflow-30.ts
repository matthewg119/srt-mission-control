// One-shot: configure "Workflow 30 - Animated Hand-Drawn Whiteboard".
//
// A 13s / 3-shot animated workflow. Each shot is ONE hand-drawn black-marker-on-white whiteboard
// illustration; a Seedance-animated hand draws each element on-screen at the EXACT shot-relative
// second its caption drops. Timeline is a clone of "Day in the Life POV" (6 copy boxes, 13s,
// shots at 0-4 / 4-8.5 / 8.5-13). Audio is the house bed (song_master). render_spec.mode is
// "animated".
//
// Usage:  bun run scripts/configure-workflow-30.ts
// Safe to re-run (upsert by id). Self-sufficient: creates the row if the base-row SQL
// (docs/2026-07-26-workflow-30-whiteboard.sql) has not been run. upsertWorkflow only writes the
// content columns, so a re-run never wipes production_status / reference_media / approved_variations.
//
// The EXAMPLE copy below is render_spec default text only (every session regenerates the lines
// from the hooks); it exists so validateRenderSpec passes and the editor shows a real timeline.
//
// THE KEY INVARIANT: each scene's animation_prompt encodes the exact shot-relative seconds the
// hand draws each element, synced to that shot's two text drops (shot 1: 0.0s & 0.5s; shot 2:
// 0.0s & 0.8s; shot 3: 0.0s & 1.0s). generatePicturePlan preserves these verbatim (locked motion),
// and buildRenderClaudePrompt emits them into the render prompt.

import type {
  Workflow,
  CopyRole,
  RenderSpec,
  WorkflowScene,
  WorkflowCaption,
} from "../src/config/workflows";
import { upsertWorkflow, setWorkflowProfile } from "../src/lib/reel/workflow-author";

const ID = "pest_control__broll__whiteboard_drawn";

// Day-in-the-Life timing skeleton: 3 shots, 13s, two text drops per shot.
const SHOTS = [
  { i: 1, start: 0, end: 4 },
  { i: 2, start: 4, end: 8.5 },
  { i: 3, start: 8.5, end: 13 },
];

// The 6 copy boxes: an EXACT clone of the Day-in-the-Life SLOTS (at/out seconds + positions).
const COPY_STRUCTURE: CopyRole[] = [
  { key: "avatar", label: "Avatar / hook", guidance: "Name who this is for or open the hook.", shot: 1, at_second: 0, out_second: 4, position: "upper_middle" },
  { key: "pain_callout", label: "Pain callout", guidance: "One-line pain/curiosity that stops the scroll.", shot: 1, at_second: 0.5, out_second: 4, position: "center" },
  { key: "increase_pain", label: "Increase pain / escalate", guidance: "Twist the knife or raise the stakes.", shot: 2, at_second: 4, out_second: 8.5, position: "upper_middle" },
  { key: "logical_reason", label: "Logical reason", guidance: "The because: why this is real.", shot: 2, at_second: 4.8, out_second: 8.5, position: "center" },
  { key: "dream_outcome", label: "Dream outcome / payoff", guidance: "The desired result or the reveal.", shot: 3, at_second: 8.5, out_second: 13, position: "upper_middle" },
  { key: "cta", label: "CTA", guidance: "Single clear call to action.", shot: 3, at_second: 9.5, out_second: 13, position: "lower" },
];

const EXAMPLE = [
  "Pest control owners, watch this",
  "You are booked on referrals alone",
  "Then the phone just goes quiet",
  "Because no system feeds you new jobs",
  "Picture a calendar that fills itself",
  "See how, link in bio",
];

// One hand-drawn whiteboard illustration per shot. image_prompt sets the LOOK; animation_prompt
// carries the LOCKED draw beats (shot-relative seconds) that must survive prompt regeneration.
const SCENES: WorkflowScene[] = [
  {
    role: "draw the setup (box + arrow)",
    image_prompt:
      "Hand-drawn black dry-erase marker illustration on a clean white whiteboard, vertical 9:16. A simple labeled box on the left and a circled keyword on the right joined by a hand-drawn arrow; loose confident marker strokes, slight ink texture, black marker only, a hand holding the marker resting near the bottom of frame. Keep generous empty white space in the upper third and lower third for the caption overlays. Do NOT bake the caption copy into the drawing.",
    animation_prompt:
      "Locked-off static camera on the whiteboard, NO camera movement. DRAW TIMING (shot-relative, locked): at 0.0s the marker hand draws the first element (the labeled box) in one confident stroke; at 0.5s the hand draws the arrow into the circled keyword. Ink appears exactly as the marker moves; the hand and marker stay visible. The two draw beats land at 0.0s and 0.5s to sync with this shot's two text drops.",
    duration_seconds: 4,
    image_url: null,
    image_approved: false,
  },
  {
    role: "grow the diagram (second row)",
    image_prompt:
      "Same white whiteboard, hand-drawn black marker, vertical 9:16. The diagram grows: a second row of two boxes joined by arrows, and one key word underlined twice for emphasis. Loose marker strokes, black marker only, the marker hand near the bottom of frame. Keep clear white space in the upper and lower thirds for captions. Do NOT bake the caption copy into the drawing.",
    animation_prompt:
      "Locked-off static camera, NO camera movement. DRAW TIMING (shot-relative, locked): at 0.0s the marker hand draws the third element (the second-row box and its arrow); at 0.8s the hand underlines the key word twice. Ink appears as drawn; the hand and marker stay visible. The two draw beats land at 0.0s and 0.8s to sync with this shot's two text drops.",
    duration_seconds: 4.5,
    image_url: null,
    image_approved: false,
  },
  {
    role: "draw the payoff + CTA",
    image_prompt:
      "Same white whiteboard, hand-drawn black marker, vertical 9:16. The payoff: a big hand-drawn circle around the final outcome word and a bold arrow pointing down to a hand-drawn call-to-action bracket near the bottom. Loose confident strokes, black marker only, the marker hand near the bottom of frame. Keep the lower third open for the CTA caption. Do NOT bake the caption copy into the drawing.",
    animation_prompt:
      "Locked-off static camera, NO camera movement. DRAW TIMING (shot-relative, locked): at 0.0s the marker hand draws the big circle around the outcome word; at 1.0s the hand draws the bold arrow down to the CTA bracket. Ink appears as drawn; the hand and marker stay visible. The two draw beats land at 0.0s and 1.0s to sync with this shot's two text drops.",
    duration_seconds: 4.5,
    image_url: null,
    image_approved: false,
  },
];

const RENDER_SPEC: RenderSpec = {
  mode: "animated",
  song_ref: "song_master",
  duration_seconds: 13,
  shots: SHOTS,
  texts: COPY_STRUCTURE.map((r, i) => ({
    n: i + 1,
    text: EXAMPLE[i],
    at_second: r.at_second ?? 0,
    out_second: r.out_second,
    position: r.position,
    role: r.key,
  })),
};

const CAPTIONS: WorkflowCaption[] = COPY_STRUCTURE.map((r, i) => ({
  text: EXAMPLE[i],
  at_second: r.at_second ?? 0,
}));

const VISUAL_RULES = [
  "Every shot is a hand-drawn black dry-erase marker illustration on a plain white whiteboard: boxes, arrows, circled keywords, simple stick figures, handwritten diagram labels. No photographic elements; black marker only (one accent color at most).",
  "It must read as a human hand actively sketching the diagram: the marker and hand are visible and the ink appears stroke by stroke.",
  "One continuous whiteboard across all three shots (same board, same marker); the diagram builds shot to shot, matching the shot cuts at 4s and 8.5s.",
  "Leave generous empty white space (upper third and lower third) clear for the timed caption overlays; never bake the caption copy into the drawing (handwritten diagram labels are fine, the caption text is not).",
  "ANIMATION IS SECOND-ACCURATE AND LOCKED: each shot's animation_prompt encodes the exact shot-relative seconds each element is drawn, synced to that shot's text drops (shot 1 at 0.0s and 0.5s, shot 2 at 0.0s and 0.8s, shot 3 at 0.0s and 1.0s). These second markers must be reproduced verbatim in any regenerated animation prompt.",
  "9:16 vertical.",
];

async function main() {
  const wf: Workflow = {
    id: ID,
    vertical_id: "pest_control",
    name: "Workflow 30 - Animated Hand-Drawn Whiteboard",
    category: "broll",
    subcategory: "whiteboard",
    status: "active",
    scenes: SCENES,
    captions: CAPTIONS,
    copy_structure: COPY_STRUCTURE,
    render_spec: RENDER_SPEC,
    song_ref: "song_master",
    render_sequences: [],
    render_options: { min_shots: 3, max_shots: 3, aspect: "9:16", provider: "openai" },
    example_video_url: null,
    example_storyboard: null,
    shot_screenshots: [],
    source_kind: "authored",
    source_example_id: null,
  };

  if (await upsertWorkflow(wf)) {
    await setWorkflowProfile(ID, {
      description:
        "13s 3-shot animated hand-drawn whiteboard: a black marker draws each diagram element in sync with the copy drops, house bed, 9:16.",
      visual_rules: VISUAL_RULES,
    });
    console.log(`configured ${ID}`);
  } else {
    console.error(`failed to configure ${ID}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
