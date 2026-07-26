-- Workflow 30: Animated Hand-Drawn Whiteboard  (complete, self-contained seed).
--
-- A 13s / 3-shot workflow where each shot is a hand-drawn black-marker-on-white whiteboard
-- illustration that a Seedance-animated hand draws on-screen, each element landing exactly when
-- its caption drops. Timeline is a clone of "Day in the Life POV" (6 copy boxes, 13s, shots at
-- 0-4 / 4-8.5 / 8.5-13); audio is the house bed (song_master); render_spec.mode is "animated".
--
-- This ONE statement seeds the whole workflow (row + copy_structure + render_spec + scenes +
-- captions + description + visual_rules). No bun script required; scripts/configure-workflow-30.ts
-- writes the exact same thing if you prefer to run it that way. category = 'broll' (not 'pov') so
-- the aspect defaults to 9:16 and enrichScene treats it as b-roll, not gloved-hands POV.
--
-- KEY INVARIANT: each scene.animation_prompt encodes the exact shot-relative seconds the hand
-- draws each element, synced to that shot's two text drops (shot 1: 0.0s & 0.5s; shot 2: 0.0s &
-- 0.8s; shot 3: 0.0s & 1.0s). The app preserves these verbatim and emits them into the render.
--
-- JSONB literals are dollar-quoted ($j$...$j$) so apostrophes need no escaping.
-- Idempotent: on conflict it updates the content columns. Safe to run more than once.

insert into workflows (
  id, vertical_id, name, category, subcategory, status, source_kind,
  song_ref, render_options, copy_structure, render_spec, scenes, captions,
  description, visual_rules
)
values (
  'pest_control__broll__whiteboard_drawn', 'pest_control',
  'Workflow 30 - Animated Hand-Drawn Whiteboard', 'broll', 'whiteboard', 'active', 'authored',
  'song_master',
  $j${"min_shots":3,"max_shots":3,"aspect":"9:16","provider":"openai"}$j$::jsonb,
  $j$[
    {"key":"avatar","label":"Avatar / hook","guidance":"Name who this is for or open the hook.","shot":1,"at_second":0,"out_second":4,"position":"upper_middle"},
    {"key":"pain_callout","label":"Pain callout","guidance":"One-line pain/curiosity that stops the scroll.","shot":1,"at_second":0.5,"out_second":4,"position":"center"},
    {"key":"increase_pain","label":"Increase pain / escalate","guidance":"Twist the knife or raise the stakes.","shot":2,"at_second":4,"out_second":8.5,"position":"upper_middle"},
    {"key":"logical_reason","label":"Logical reason","guidance":"The because: why this is real.","shot":2,"at_second":4.8,"out_second":8.5,"position":"center"},
    {"key":"dream_outcome","label":"Dream outcome / payoff","guidance":"The desired result or the reveal.","shot":3,"at_second":8.5,"out_second":13,"position":"upper_middle"},
    {"key":"cta","label":"CTA","guidance":"Single clear call to action.","shot":3,"at_second":9.5,"out_second":13,"position":"lower"}
  ]$j$::jsonb,
  $j${
    "mode":"animated","song_ref":"song_master","duration_seconds":13,
    "shots":[{"i":1,"start":0,"end":4},{"i":2,"start":4,"end":8.5},{"i":3,"start":8.5,"end":13}],
    "texts":[
      {"n":1,"text":"Pest control owners, watch this","at_second":0,"out_second":4,"position":"upper_middle","role":"avatar"},
      {"n":2,"text":"You are booked on referrals alone","at_second":0.5,"out_second":4,"position":"center","role":"pain_callout"},
      {"n":3,"text":"Then the phone just goes quiet","at_second":4,"out_second":8.5,"position":"upper_middle","role":"increase_pain"},
      {"n":4,"text":"Because no system feeds you new jobs","at_second":4.8,"out_second":8.5,"position":"center","role":"logical_reason"},
      {"n":5,"text":"Picture a calendar that fills itself","at_second":8.5,"out_second":13,"position":"upper_middle","role":"dream_outcome"},
      {"n":6,"text":"See how, link in bio","at_second":9.5,"out_second":13,"position":"lower","role":"cta"}
    ]
  }$j$::jsonb,
  $j$[
    {
      "role":"draw the setup (box + arrow)",
      "image_prompt":"Hand-drawn black dry-erase marker illustration on a clean white whiteboard, vertical 9:16. A simple labeled box on the left and a circled keyword on the right joined by a hand-drawn arrow; loose confident marker strokes, slight ink texture, black marker only, a hand holding the marker resting near the bottom of frame. Keep generous empty white space in the upper third and lower third for the caption overlays. Do NOT bake the caption copy into the drawing.",
      "animation_prompt":"Locked-off static camera on the whiteboard, NO camera movement. DRAW TIMING (shot-relative, locked): at 0.0s the marker hand draws the first element (the labeled box) in one confident stroke; at 0.5s the hand draws the arrow into the circled keyword. Ink appears exactly as the marker moves; the hand and marker stay visible. The two draw beats land at 0.0s and 0.5s to sync with this shot's two text drops.",
      "duration_seconds":4,"image_url":null,"image_approved":false
    },
    {
      "role":"grow the diagram (second row)",
      "image_prompt":"Same white whiteboard, hand-drawn black marker, vertical 9:16. The diagram grows: a second row of two boxes joined by arrows, and one key word underlined twice for emphasis. Loose marker strokes, black marker only, the marker hand near the bottom of frame. Keep clear white space in the upper and lower thirds for captions. Do NOT bake the caption copy into the drawing.",
      "animation_prompt":"Locked-off static camera, NO camera movement. DRAW TIMING (shot-relative, locked): at 0.0s the marker hand draws the third element (the second-row box and its arrow); at 0.8s the hand underlines the key word twice. Ink appears as drawn; the hand and marker stay visible. The two draw beats land at 0.0s and 0.8s to sync with this shot's two text drops.",
      "duration_seconds":4.5,"image_url":null,"image_approved":false
    },
    {
      "role":"draw the payoff + CTA",
      "image_prompt":"Same white whiteboard, hand-drawn black marker, vertical 9:16. The payoff: a big hand-drawn circle around the final outcome word and a bold arrow pointing down to a hand-drawn call-to-action bracket near the bottom. Loose confident strokes, black marker only, the marker hand near the bottom of frame. Keep the lower third open for the CTA caption. Do NOT bake the caption copy into the drawing.",
      "animation_prompt":"Locked-off static camera, NO camera movement. DRAW TIMING (shot-relative, locked): at 0.0s the marker hand draws the big circle around the outcome word; at 1.0s the hand draws the bold arrow down to the CTA bracket. Ink appears as drawn; the hand and marker stay visible. The two draw beats land at 0.0s and 1.0s to sync with this shot's two text drops.",
      "duration_seconds":4.5,"image_url":null,"image_approved":false
    }
  ]$j$::jsonb,
  $j$[
    {"text":"Pest control owners, watch this","at_second":0},
    {"text":"You are booked on referrals alone","at_second":0.5},
    {"text":"Then the phone just goes quiet","at_second":4},
    {"text":"Because no system feeds you new jobs","at_second":4.8},
    {"text":"Picture a calendar that fills itself","at_second":8.5},
    {"text":"See how, link in bio","at_second":9.5}
  ]$j$::jsonb,
  '13s 3-shot animated hand-drawn whiteboard: a black marker draws each diagram element in sync with the copy drops, house bed, 9:16.',
  $j$[
    "Every shot is a hand-drawn black dry-erase marker illustration on a plain white whiteboard: boxes, arrows, circled keywords, simple stick figures, handwritten diagram labels. No photographic elements; black marker only (one accent color at most).",
    "It must read as a human hand actively sketching the diagram: the marker and hand are visible and the ink appears stroke by stroke.",
    "One continuous whiteboard across all three shots (same board, same marker); the diagram builds shot to shot, matching the shot cuts at 4s and 8.5s.",
    "Leave generous empty white space (upper third and lower third) clear for the timed caption overlays; never bake the caption copy into the drawing (handwritten diagram labels are fine, the caption text is not).",
    "ANIMATION IS SECOND-ACCURATE AND LOCKED: each shot's animation_prompt encodes the exact shot-relative seconds each element is drawn, synced to that shot's text drops (shot 1 at 0.0s and 0.5s, shot 2 at 0.0s and 0.8s, shot 3 at 0.0s and 1.0s). These second markers must be reproduced verbatim in any regenerated animation prompt.",
    "9:16 vertical."
  ]$j$::jsonb
)
on conflict (id) do update set
  name           = excluded.name,
  category       = excluded.category,
  subcategory    = excluded.subcategory,
  status         = excluded.status,
  source_kind    = excluded.source_kind,
  song_ref       = excluded.song_ref,
  render_options = excluded.render_options,
  copy_structure = excluded.copy_structure,
  render_spec    = excluded.render_spec,
  scenes         = excluded.scenes,
  captions       = excluded.captions,
  description    = excluded.description,
  visual_rules   = excluded.visual_rules,
  updated_at     = now();
