-- 2026-09-16: the concierge mascot becomes a choice, and the launcher becomes movable.
--
-- Matthew, 2026-09-16: "always give me the 6 prompts to select the different concepts for AI concierge
-- avatars so they can select from a few options ... make sure we have at least 3 options for avatars
-- selected for that specific client ... and I need to be able to show them 3 preview links with each one
-- ... make sure we save all of the stuff as datasets to automate this concierge avatar thing selection."
--
-- Two sections, every statement idempotent (re-running is safe):
--   A. mascot_concepts: the catalogue, per client and built-in, with the prompts that made each one
--   B. concierge_configs: the three-way shortlist and the resting corner
--
-- ‼️ RUN THIS BEFORE THE DEPLOY THAT READS IT. loadConciergeConfig selects mascot_candidates and
-- launcher_corner by name on the busiest route in the lane, and one unknown column fails the whole
-- PostgREST select, which stops every widget loading rather than only the new part.
--
-- Runner: bun run scripts/db.ts --file=docs/2026-09-16-mascot-catalogue.sql [--dry]


-- =====================================================================
-- A. THE CATALOGUE
-- =====================================================================
--
-- One row is one character: what it is, the prompt that generated its art, the prompt for each
-- animation state, and where the finished files ended up.
--
-- ‼️ A BUILT-IN ROW CARRIES NO FILES, AND client_id IS NULL FOR IT. The wizard cat and the blue alien are
-- static imports in src/lib/concierge/mascot, served from /_next/static with a content hash and no
-- function invocation per page view. Their rows exist so the menu can describe them and so the prompts
-- that made them are not lost, not so the widget can find them: mascotAssets() is still the only thing
-- that resolves a built-in key. A GENERATED row is the opposite, and `assets` is where its files live.
create table if not exists public.mascot_concepts (
  id            uuid primary key default gen_random_uuid(),
  -- NULL means built-in: available to every client, owned by none.
  client_id     uuid references public.clients (id) on delete cascade,
  key           text not null,
  name          text not null,
  blurb         text,
  -- Who this character was drawn for, so the menu does not offer a med spa's patients an agency mascot.
  audience      text check (audience is null or audience in ('patient', 'owner')),
  vertical      text,
  -- The prompt as it should be pasted into the image tool, house style included.
  image_prompt  text,
  -- {idle, talk, wand_throw, ...} -> the video prompt for that state.
  state_prompts jsonb not null default '{}'::jsonb,
  -- The MascotAssets shape the widget consumes: {idle, talk, still, width, height, flourishes, easterEgg},
  -- every URL public and in the `reels` bucket. Empty until the art is pasted back. Read and validated by
  -- src/lib/concierge/mascot-for-client.ts, never cast.
  assets        jsonb not null default '{}'::jsonb,
  source        text not null default 'generated' check (source in ('builtin', 'generated')),
  status        text not null default 'proposed' check (status in ('proposed', 'ready', 'picked', 'dropped')),
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One key per client, and one key across the built-ins. COALESCE rather than two partial indexes so
-- there is a single rule: a client may name a character the same thing a built-in is named, and that is
-- deliberate, because a generated wizard cat for one clinic is not the shared one.
create unique index if not exists mascot_concepts_key
  on public.mascot_concepts (coalesce(client_id, '00000000-0000-0000-0000-000000000000'::uuid), key);
create index if not exists mascot_concepts_client on public.mascot_concepts (client_id, created_at desc);
alter table public.mascot_concepts enable row level security;

-- The two that ship in the repo. Described here, resolved from code.
insert into public.mascot_concepts (client_id, key, name, blurb, audience, source, status, image_prompt, state_prompts)
select null, 'wizard-cat', 'Wizard cat',
       'An orange tabby in a star cloak with a wand. 16-bit pixel art. SRT own mascot.',
       'owner', 'builtin', 'ready',
       '16-bit pixel art sprite of a cute orange tabby cat wizard in a purple star hat and teal star cloak, holding a gold star wand, full body, facing camera, on a white and light grey transparency checkerboard background',
       '{"idle":"the cat stands and breathes, wand held at its side","talk":"the cat speaks, wand held at its side","wand_throw":"the cat throws the wand spinning overhead and catches it","tail_stand":"the cat balances on its coiled spring tail and bounces","tail_hold":"the cat holds the wand up with its tail and casts a burst of sparks"}'::jsonb
where not exists (select 1 from public.mascot_concepts where client_id is null and key = 'wizard-cat');

insert into public.mascot_concepts (client_id, key, name, blurb, audience, source, status, image_prompt, state_prompts)
select null, 'blue-alien', 'Blue alien',
       'A friendly blue alien. 3D render. The default for a new client.',
       'owner', 'builtin', 'ready',
       'full body 3D render of a friendly blue alien with a large head and black eyes, wearing dark trousers, standing, facing camera, on a plain white background',
       '{"idle":"the alien stands and waves","talk":"the alien speaks and gestures with one hand","boombox":"the alien shoulders a boombox, throws a peace sign and folds its arms to the beat"}'::jsonb
where not exists (select 1 from public.mascot_concepts where client_id is null and key = 'blue-alien');


-- =====================================================================
-- B. THE SHORTLIST AND THE CORNER
-- =====================================================================
--
-- ‼️ THREE CANDIDATES ARE NOT A CHOICE, WHICH IS WHY THEY ARE A SEPARATE COLUMN FROM `mascot`.
-- Matthew picks three before the call and posts a preview link for each; the client picks one ON the
-- call and that one is written to `mascot`. Folding the shortlist into `mascot` would put an unchosen
-- character on a live page the moment the widget went live.
alter table public.concierge_configs add column if not exists mascot_candidates jsonb not null default '[]'::jsonb;

-- Which corner the launcher rests in. Four values, never free coordinates: the panel is 580px tall and
-- opens on the far side of the launcher from the nearest edge, so the corner decides a layout and not
-- just an offset. See src/app/embed.js/route.ts.
alter table public.concierge_configs add column if not exists launcher_corner text not null default 'bottom-right';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'concierge_configs_launcher_corner_check') then
    alter table public.concierge_configs add constraint concierge_configs_launcher_corner_check
      check (launcher_corner in ('bottom-right', 'bottom-left', 'top-right', 'top-left'));
  end if;
end $$;

-- ‼️ THE COLUMN DEFAULT STAYS 'wizard-cat' AND THE NEW DEFAULT IS WRITTEN BY STEP 18 INSTEAD.
-- Matthew asked for the alien to be "the default of new clients". Changing the column default would
-- change nothing already written, and rewriting live rows to chase it would swap the character on any
-- client already showing a cat. So the forward default lives in DEFAULT_MASCOT in
-- src/lib/concierge/mascot/index.ts, which step 18 writes when nobody has chosen, and SRT keeps its cat
-- because its row already says so.


-- ── Verify ──────────────────────────────────────────────────────────────────
-- select key, source, status, assets from public.mascot_concepts where client_id is null;
-- select c.slug, cc.mascot, cc.mascot_candidates, cc.launcher_corner
--   from public.concierge_configs cc join public.clients c on c.id = cc.client_id;
