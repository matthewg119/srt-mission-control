-- SMS Simulator + Voice Bot + Live Persona — migration
-- Apply in Supabase SQL Editor. Idempotent / safe to re-run.
--
-- Adds:
--   tenants            — multi-tenant root (SRT is the only tenant for now)
--   voice_examples     — real (incoming -> reply) pairs the bot mimics (few-shot corpus)
--   bot_persona        — live-editable stage prompts + style profile (out of code)
--   sim_conversations  — 6-phone simulator sandbox threads
--   sim_messages       — simulator messages (never touches sms_messages)
--   match_voice_examples() — pg_trgm top-K retrieval RPC

-- ============================================================
-- tenants: every new table references this. Seed one SRT row.
-- ============================================================
CREATE TABLE IF NOT EXISTS tenants (
  id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  slug       text UNIQUE NOT NULL,                 -- 'srt'
  name       text NOT NULL,
  created_at timestamptz DEFAULT now()
);
INSERT INTO tenants (slug, name) VALUES ('srt', 'SRT Agency')
  ON CONFLICT (slug) DO NOTHING;

-- pg_trgm is already enabled on this project (see 2026-04-18 migration); re-assert.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- voice_examples: few-shot corpus. `incoming` is the retrieval key,
-- `reply` is the real human voice we want the bot to imitate.
-- Sources: 'imessage' (extract.py JSONL) and 'sms_messages' (approved replies).
-- ============================================================
CREATE TABLE IF NOT EXISTS voice_examples (
  id                uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES tenants(id),
  source            text NOT NULL,                 -- 'imessage' | 'sms_messages'
  incoming          text NOT NULL,                 -- message replied TO (retrieval key)
  reply             text NOT NULL,                 -- the real human reply (voice to mimic)
  contact_hash      text,                          -- anonymized id from extract.py; null for sms
  char_len          int,
  ts                timestamptz,
  stage             int,                           -- nullable
  is_golden         boolean DEFAULT false,         -- curator exemplar; force-included in retrieval
  is_active         boolean DEFAULT true,          -- soft-disable bad pairs
  source_message_id uuid,                          -- sms_messages.id when source='sms_messages'
  metadata          jsonb,
  created_at        timestamptz DEFAULT now()
);

-- Idempotent continuous-append: one voice row per approved outbound message.
CREATE UNIQUE INDEX IF NOT EXISTS voice_examples_source_msg_idx
  ON voice_examples (source_message_id) WHERE source_message_id IS NOT NULL;
-- Trigram retrieval over the inbound text.
CREATE INDEX IF NOT EXISTS voice_examples_incoming_trgm
  ON voice_examples USING gin (incoming gin_trgm_ops);
CREATE INDEX IF NOT EXISTS voice_examples_tenant_active_idx
  ON voice_examples (tenant_id, is_active);

-- ============================================================
-- bot_persona: live-editable persona. One ACTIVE row per (tenant, stage).
-- stage 1..4 = funnel stage prompt; stage NULL = adaptive/base prompt.
-- Empty table => engine falls back to the hardcoded prompts in code.
-- ============================================================
CREATE TABLE IF NOT EXISTS bot_persona (
  id            uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id),
  stage         int,                               -- 1..4, or NULL = adaptive/base
  prompt        text NOT NULL,
  style_profile jsonb,                             -- { avg_len, emoji_freq, banned_phrases, traits }
  is_active     boolean DEFAULT true,
  version       int DEFAULT 1,
  updated_by    text,
  updated_at    timestamptz DEFAULT now(),
  created_at    timestamptz DEFAULT now()
);
-- NULL stage is otherwise distinct under a unique index, so COALESCE it.
CREATE UNIQUE INDEX IF NOT EXISTS bot_persona_active_stage_idx
  ON bot_persona (tenant_id, COALESCE(stage, -1)) WHERE is_active = true;

-- ============================================================
-- Simulator sandbox — fully separate from sms_conversations / sms_messages.
-- ============================================================
CREATE TABLE IF NOT EXISTS sim_conversations (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id),
  phone_slot  int NOT NULL,                        -- 1..6
  label       text,
  stage       int,                                 -- per-phone stage (1..4 or NULL=adaptive)
  mode        text DEFAULT 'test',                 -- 'test' | 'train'
  created_at  timestamptz DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS sim_conversations_slot_idx
  ON sim_conversations (tenant_id, phone_slot);

CREATE TABLE IF NOT EXISTS sim_messages (
  id                  uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sim_conversation_id uuid NOT NULL REFERENCES sim_conversations(id) ON DELETE CASCADE,
  direction           text NOT NULL,               -- 'inbound' (you-as-merchant) | 'outbound' (bot)
  body                text NOT NULL,
  is_golden           boolean DEFAULT false,        -- promotable into voice_examples
  edited_from         text,                         -- original draft if curator edited it
  created_at          timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sim_messages_conv_idx
  ON sim_messages (sim_conversation_id, created_at);

-- ============================================================
-- Retrieval RPC: top-K voice examples by trigram similarity to the inbound text.
-- Goldens are force-included (short merchant texts often score below the 0.3
-- default `%` threshold). If recall is still low, switch `%` to `<%`
-- (word_similarity) or lower pg_trgm.word_similarity_threshold.
-- ============================================================
CREATE OR REPLACE FUNCTION match_voice_examples(
  query_text  text,
  p_tenant_id uuid,
  match_count int DEFAULT 6
)
RETURNS TABLE (incoming text, reply text, sim real, is_golden boolean)
LANGUAGE sql STABLE AS $$
  SELECT ve.incoming, ve.reply, similarity(ve.incoming, query_text) AS sim, ve.is_golden
  FROM voice_examples ve
  WHERE ve.tenant_id = p_tenant_id
    AND ve.is_active = true
    AND (ve.incoming % query_text OR ve.is_golden = true)
  ORDER BY ve.is_golden DESC, sim DESC
  LIMIT match_count;
$$;
