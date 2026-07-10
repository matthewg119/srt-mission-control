# SRT Drop Studio Blueprint

Paste this whole document into a new Claude session to stand up the same "paste a picture, get a finished reel" channel for a NEW avatar. It describes the system that already runs in production for pest control in Slack channel #ai-content-pest-control (repo: `srt-mission-control`, plus the `render-service/` folder inside it, a separate Vercel project).

---

## >>> PASTE YOUR NEW AVATAR KIT HERE <<<

Fill this in before sending:

- **Avatar / vertical name:** (e.g. "Med Spa Owners")
- **Who it speaks to (audience):** ...
- **Business descriptor / offer:** ...
- **3-5 of your real sales letters** (verbatim, these anchor the caption voice): ...
- **Slack channel for this avatar's drops:** #...
- **Song (optional):** a public MP3/M4A URL if this avatar gets its own sound, otherwise workflows keep their own songs

---

## 1. What the system does

One Slack channel per avatar. The operator (Matthew) pastes 1+ images and copy lines in ONE message. The bot:

1. Matches the drop against the **workflow library** (image count + line count vs each workflow's shot count + copy boxes).
2. Adapts the pasted copy into the workflow's labeled boxes (checkmark card to approve).
3. Asks **Animate or Still** (nothing renders until the operator picks).
   - **Still**: renders immediately with the still images.
   - **Animate**: writes ONE Seedance 2.0 motion prompt per image (camera/subject motion only, under 20 words, no em dashes). The operator animates each image externally (Seedance/Higgsfield), pastes the clips back into the thread, and the bot renders automatically once every shot has a clip. Partial drops: reply `render` (missing shots keep their stills) or `still` (stills only).
4. Renders a 720x1280 (9:16) 30fps MP4: shots on a fixed timeline, timed text chips, the workflow's OWN song as the main audio. Animated clips are trimmed to their shot slot and their native audio is mixed in at 5% volume as faint background.
5. Posts the MP4 + a belief-installing **sales letter caption** written in the avatar's voice (anchored on the avatar's real sales letters, never a borrowed voice).

Also running: **prompt drops** (3x/day cron posts 9 image prompts in the least-recently-used workflow's style; upload the generated images, pick copy, render) and a **feedback loop** (images replied to a finished thread become that workflow's reference images; text feedback becomes checkmark-gated style rules).

## 2. Architecture (repo: srt-mission-control)

- `src/lib/reel/drop-studio.ts`: the whole Slack conversation flow (stages: dr_fit -> dr_copy -> dr_mode -> dr_animate -> dr_render, plus pd_* for prompt drops). Clip intake at the animate gate lives here.
- `src/lib/reel/render-dispatch.ts`: `renderWorkflow(workflow, {images, copy, videos})`, ONE render build per workflow (`render_options.build`): `render_spec` (default, generic timeline engine), `render_reel` (legacy 6s single-image), or a custom endpoint slug.
- `src/lib/reel/render-client.ts`: builds the JSON payload and POSTs it to the render service.
- `src/config/workflows.ts`: workflow definitions (seeds + `workflows` DB table, DB wins).
- `src/config/verticals.ts`: avatar kits (seeds + `verticals` DB table).
- `render-service/` (SEPARATE Vercel project, deploy with `vercel --prod` inside the folder, never via git push): Python + ffmpeg. `api/render-spec.py` + `api/srt_reel/spec_engine.py` do the actual rendering and upload the MP4 to the Supabase `reels` bucket.

### Render contract (what any renderer must accept)

`POST {REEL_RENDER_URL with render-reel replaced by render-spec}` with header `x-reel-secret: $REEL_RENDER_SECRET`:

```json
{
  "song_url": "https://... or null for the house bed",
  "duration": 11.3,
  "shots": [
    { "image_url": "https://...", "video_url": "https://... (optional)", "start": 0.0, "end": 4.04 }
  ],
  "texts": [
    { "text": "...", "at_second": 0.0, "out_second": 4.04, "position": "upper_middle", "size": "medium", "pop": true }
  ],
  "voiceover": { "enabled": false }
}
```

- URLs only (Supabase public URLs), bodies must stay under ~4.5 MB.
- A shot with `video_url` renders the clip in place of the still, trimmed to the slot, holding the last frame if short; its own audio is mixed at 5% under the song.
- Output: 720x1280, 30fps, H.264; response `{ "url": "...mp4", "duration": n, "engine_version": "..." }`.
- Any input resolution/aspect is cover-cropped to 9:16. Best clip export: 9:16 at 720p or higher. 480p 3:4 works but gets upscaled ~2x and loses ~25% of its width.

## 3. The current workflows (the shared library)

Workflows live under ONE library vertical (`pest_control` today) and are SHARED by every avatar: same song, same shot timeline, same image slots. Only the copy (refit per drop into the labeled boxes) and the caption voice (per-avatar sales letters) change per avatar.

### Workflow 2 (`pest_control__broll__6hl_propaganda`) - the main one
- 3 shots, 11.3s total: shot 1 = 0 to 4.04s, shot 2 = 4.04 to 8.02s, shot 3 = 8.02 to 11.3s.
- Its own ~11s song (public URL in `song_ref`), the main audio track.
- 7 timed copy boxes (this is the "different text per avatar" part):
  1. Avatar (0 to 4.04s, upper_side): who this is for
  2. Pain callout (0.03 to 4.04s, upper_middle): scroll-stopping pain line
  3. Increase pain / cost (2.04 to 4.04s, upper_middle)
  4. Increase pain / category (4.04 to 8.02s, upper_middle)
  5. Logical reason (6.04 to 8.02s, center): the "because"
  6. Dream outcome (8.302 to 11.3s, upper_middle)
  7. CTA (10.02 to 11.3s, center)
- Renders via the generic `render_spec` build. Works with 3 stills OR 3 animated clips.

### Workflow 2.1 (`pest_control__broll__6hl_propaganda_vo`)
- Workflow 2 exactly, plus a TTS voiceover that reads each line aloud as it appears, music ducked to 30% under the voice.

### Shabang (`pest_control__reel__shabang`) - the original
- 1 image, 6s, house song bed. 4 boxes: Label, Hook, Payoff, CTA. Legacy `render_reel` build (fixed template).

### Wasp Nest POV (`pest_control__pov__wasp_nest`)
- 4-shot 8s seeded first-person Meta-glasses POV storyboard (find nest, climb, bag it, clean reveal).

## 4. Adding a NEW avatar channel (SQL paste, no deploy)

The channel-to-avatar wiring lives on the `verticals` table:

- `slack_drop_channel_id`: the Slack channel whose drops run through drop studio
- `owner_vertical_id`: the avatar whose voice writes the post-render sales letter (usually itself)
- `workflow_vertical_id`: whose workflow library the drops match against (point it at `pest_control` to reuse the shared library: same songs, same timelines, only text differs)
- `sales_letter_examples`: 3-5 real letters; WITHOUT these the bot refuses to write captions (it never borrows a voice) and tells you to paste letters, then reply `caption` in the thread

Steps:
1. Create the Slack channel and invite the bot.
2. Insert/update the `verticals` row with the kit (name, audience, business descriptor, beliefs/offer) + the three wiring columns above + sales letters. See `docs/2026-07-10-drop-channel-verticals.sql` for the column definitions.
3. Drop an image + copy in the channel. Everything else (fit menu, copy adaptation, animate gate, render, caption) works with zero code changes.

## 5. Adding a NEW workflow (counts for every avatar automatically)

A workflow is a row in `workflows`: shot timeline (`render_spec.shots`), timed text boxes (`copy_structure` + `render_spec.texts`), a song (`song_ref` URL), and `render_options`. Because every avatar's channel points at the shared library (`workflow_vertical_id`), a new workflow is instantly available to ALL avatars; each drop refits the operator's pasted lines into the boxes, so the same audio + image structure carries different text per avatar. The Workflow Builder channel (#agent-wokrflow-creator) productizes new ones from a dropped example.

## 6. Environment

- `REEL_RENDER_URL`, `REEL_RENDER_SECRET`: render service endpoint + auth
- `SLACK_BOT_TOKEN` (+ events URL wired to `/api/slack/events`)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (reels bucket + tables)
- `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` (copy, motion prompts, sales letters)
