-- Carry the Office Manager's tool calls and their results across conversation turns.
--
-- The tool loop in src/lib/ai.ts built tool_use / tool_result blocks, used them
-- for one request, and dropped them on return. chat_messages stored two rows of
-- plain text per turn, so a follow-up question ("give me 50 more") arrived with
-- the schema catalog, the SQL that had just run, and the rows it returned all
-- gone. The model then had to re-read the schema and re-derive the query before
-- it could do any new work, which is what exhausted the 5-round-trip budget and
-- produced "I hit the maximum number of tool calls."
--
-- Add-only. The route falls back to a text-only insert if this has not been run,
-- so the chat keeps working without it, just without memory across turns.

alter table public.chat_messages
  add column if not exists tool_blocks jsonb;

comment on column public.chat_messages.tool_blocks is
  'Anthropic tool_use / tool_result content blocks for this assistant turn, in API order. '
  'Replayed into the conversation on follow-up turns so the model keeps its working context. '
  'Large row payloads are summarised by summariseToolResult() in src/lib/ai.ts before storage.';
