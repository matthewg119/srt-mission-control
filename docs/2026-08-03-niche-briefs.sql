-- Niche-level avatar sets: 3 worst customers, 3 best, and the pick. ADD ONLY, safe to re-run.
--
-- Why this is keyed on the NICHE and not the report: the avatars for two landscapers are the
-- same avatars. Only the scorecard changes between them. Caching by vertical is what makes
-- prospect #2 in a niche cost nothing, which is the difference between a pitch taking a couple
-- of minutes and taking an afternoon.
--
-- Room is left here for the rest of the intel brief (pains, horror stories, night questions,
-- objections) to land in the same row later, since it caches on exactly the same key.

create table if not exists niche_briefs (
  id            uuid primary key default gen_random_uuid(),

  -- vertical_slug from the audit, falling back to business_type, lowercased.
  niche_key     text        not null,
  business_type text,

  -- { "worst": [{ "label","whyItHurts","economics","ownersSay" } x3],
  --   "best":  [{ "label","ticket","whyHighRoi","aiQuestion" } x3],
  --   "pick": 1..3, "pickWhy": text, "isReposition": bool }
  --
  -- `best[].aiQuestion` is load-bearing: it becomes the "I asked ChatGPT for ___ and
  -- {Business} came up" line inside the dream-lead image.
  avatars       jsonb       not null,

  -- Freshness is read in code (NICHE_BRIEF_TTL_DAYS in src/config/pitch.ts, 30 days). A
  -- regeneration overwrites this rather than inserting a second row for the niche.
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- One row per niche. The upsert in niche-avatars.ts targets this constraint by name, so a
-- forced regeneration replaces the stale set instead of racing it.
create unique index if not exists niche_briefs_niche_key_idx on niche_briefs (niche_key);
