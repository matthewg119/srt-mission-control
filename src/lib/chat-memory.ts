// One place that knows how a conversation is stored, for every surface the assistant answers on.
//
// ‼️ THE MEMORY WAS SILENTLY BROKEN ON EVERY SURFACE EXCEPT THE DASHBOARD, AND IT LOOKED FINE.
// Measured 2026-09-11: `chat_conversations.id` is a uuid column, and Slack passed
// `slack-C0BLK797PNU-1757...`, Telegram passed `telegram-12345`, and the web popup passed the
// literal string "chat-popup". Postgres rejects each of those as a uuid, so:
//
//   - every history read matched nothing and the assistant started from zero each time;
//   - every write failed, and the failures were inside `try { } catch { }` blocks that cannot
//     catch them, because supabase-js RETURNS errors rather than throwing. Nothing was logged.
//
// So the assistant in a client's step thread had no memory of the message before it, and nobody
// could tell, because an assistant with no memory still answers.
//
// ‼️ AND NOTHING WAS KEYED TO A CLIENT. Matthew: "all of the data of each customer (inside Slack
// or Mission Control) needs to be saved with its specific dataset". A conversation that happens in
// a client's step thread is ABOUT that client, and until now nothing recorded which one, so none
// of it could ever be read back per client.
//
// The fix is a mapping, not a new store: `chat_conversations.external_key` holds the surface's own
// id ("slack-C…-1757…"), `id` stays the uuid everything already joins on, and `client_id` says
// whose conversation it is. docs/2026-09-12-data-layer.sql adds all three.

import crypto from "crypto";
import { supabaseAdmin } from "@/lib/db";

/** Which surface a conversation happened on. `brain_trust:<agent>` carries its agent. */
export type ChatSurface = "web" | "slack" | "telegram" | string;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

/**
 * The uuid for a surface's own conversation key, creating the row the first time.
 *
 * A key that IS already a uuid is passed straight through: the dashboard has always minted one
 * client-side and there is nothing to map.
 *
 * ‼️ SELECT THEN INSERT, NOT UPSERT, AND THE PRIMARY KEY IS WHY. An upsert on external_key would
 * have to send an `id`, and on a conflict that id would be written over the existing row's primary
 * key, which every chat_messages row already points at. Selecting first means an existing
 * conversation keeps the id its history hangs off.
 */
export async function conversationFor(args: {
  externalKey: string;
  surface: ChatSurface;
  title?: string | null;
  clientId?: string | null;
}): Promise<string | null> {
  const key = args.externalKey.trim();
  if (!key) return null;
  if (UUID.test(key)) return key;

  const found = await findConversation(key);
  if (found) {
    // Only the things that can legitimately change. The title is left alone: it is the first
    // thing that was said, and a conversation is easier to find by how it started.
    if (args.clientId) {
      await supabaseAdmin
        .from("chat_conversations")
        .update({ client_id: args.clientId, updated_at: new Date().toISOString() })
        .eq("id", found)
        .is("client_id", null);
    }
    return found;
  }

  const id = crypto.randomUUID();
  const { error } = await supabaseAdmin.from("chat_conversations").insert({
    id,
    external_key: key,
    surface: args.surface,
    client_id: args.clientId ?? null,
    title: (args.title ?? key).slice(0, 200),
    updated_at: new Date().toISOString(),
  });

  if (!error) return id;

  // 23505: something else created it between the select and the insert. Read it back rather than
  // failing, because both racers are the same person typing twice.
  if ((error as { code?: string }).code === "23505") return (await findConversation(key)) ?? null;

  console.error("[chat-memory] could not open a conversation:", error.message);
  return null;
}

/** The uuid for a key, or null. Never creates anything. */
export async function findConversation(externalKey: string): Promise<string | null> {
  const key = externalKey.trim();
  if (!key) return null;
  if (UUID.test(key)) return key;

  const { data, error } = await supabaseAdmin
    .from("chat_conversations")
    .select("id")
    .eq("external_key", key)
    .maybeSingle();

  if (error) {
    console.error("[chat-memory] conversation lookup failed:", error.message);
    return null;
  }
  return (data?.id as string | null) ?? null;
}

/**
 * The last `limit` turns, oldest first.
 *
 * ‼️ NEWEST N, THEN REVERSED. Slack and Telegram both asked for `order(created_at asc).limit(20)`,
 * which is the FIRST twenty messages of the conversation, not the last: once a thread passed
 * twenty turns the assistant was reading the opening exchange forever and never saw the message
 * before the one it was answering.
 */
export async function loadHistory(conversationId: string | null, limit = 20): Promise<ChatTurn[]> {
  if (!conversationId) return [];

  const { data, error } = await supabaseAdmin
    .from("chat_messages")
    .select("role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[chat-memory] history read failed:", error.message);
    return [];
  }

  return (data ?? [])
    .reverse()
    .map((m) => ({ role: m.role as "user" | "assistant", content: (m.content as string) ?? "" }))
    .filter((m) => m.content.length > 0);
}

/**
 * Store both halves of one exchange.
 *
 * ‼️ ERRORS ARE READ. supabase-js resolves with `{ error }` instead of throwing, so every
 * `try { await insert } catch {}` in this codebase was a comment rather than a handler. The write
 * that matters most is the one nobody notices failing.
 */
export async function saveTurn(args: {
  conversationId: string | null;
  userText: string;
  assistantText: string;
  toolBlocks?: unknown[] | null;
}): Promise<void> {
  if (!args.conversationId) return;

  const rows: Array<Record<string, unknown>> = [
    { conversation_id: args.conversationId, role: "user", content: args.userText },
    {
      conversation_id: args.conversationId,
      role: "assistant",
      content: args.assistantText,
      tool_blocks: args.toolBlocks && args.toolBlocks.length > 0 ? args.toolBlocks : null,
    },
  ];

  const { error } = await supabaseAdmin.from("chat_messages").insert(rows);
  if (!error) {
    await touch(args.conversationId);
    return;
  }

  // tool_blocks is added by docs/2026-08-21-chat-tool-blocks.sql. Without it the chat is degraded
  // (no working context across turns) rather than broken, so the text still goes in.
  const retry = await supabaseAdmin
    .from("chat_messages")
    .insert(rows.map(({ tool_blocks: _drop, ...rest }) => rest));

  if (retry.error) console.error("[chat-memory] turn not saved:", retry.error.message);
  else await touch(args.conversationId);
}

async function touch(conversationId: string): Promise<void> {
  await supabaseAdmin
    .from("chat_conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId);
}
