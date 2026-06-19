// iMessage bridge remote control — Slack-driven restart / doctor / resync.
//
// The Mac bridge sits behind NAT and can't accept inbound connections, but it
// already polls GET /api/imessage/outbox every ~10s. We piggyback control
// commands onto that poll: Slack enqueues a command here, the outbox GET returns
// + clears the queue (takePendingCommands), the bridge executes it and acks via
// the outbox POST. "Restart" works because the bridge runs under launchd with
// KeepAlive=true — process.exit(0) is immediately respawned.
//
// Storage: the queue lives in the existing integrations row
// name='Mac iMessage Bridge' under config.pending_commands — no migration needed.
// Single Mac + single operator, so the read-modify-write race window is benign.

import { supabaseAdmin } from "@/lib/db";

const BRIDGE_NAME = "Mac iMessage Bridge";

export type BridgeCommandType = "restart" | "doctor" | "resync";

export interface BridgeCommand {
  id: string;
  type: BridgeCommandType;
  requested_by?: string;
  created_at: string;
}

export interface BridgeStatus {
  status: "online" | "offline";
  last_seen: string | null;
  seconds_since: number | null;
}

function genId(): string {
  return `cmd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function readQueue(config: Record<string, unknown> | null | undefined): BridgeCommand[] {
  const q = config && (config as Record<string, unknown>).pending_commands;
  return Array.isArray(q) ? (q as BridgeCommand[]) : [];
}

/** Queue a command for the Mac bridge to pick up on its next outbox poll. */
export async function enqueueBridgeCommand(
  type: BridgeCommandType,
  requestedBy?: string
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const { data: row, error } = await supabaseAdmin
    .from("integrations")
    .select("id, config")
    .eq("name", BRIDGE_NAME)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };

  const cmd: BridgeCommand = {
    id: genId(),
    type,
    requested_by: requestedBy,
    created_at: new Date().toISOString(),
  };
  const config = (row?.config as Record<string, unknown> | null) ?? {};
  const queue = readQueue(config);
  queue.push(cmd);
  const newConfig = { ...config, pending_commands: queue };

  if (row) {
    const { error: upErr } = await supabaseAdmin
      .from("integrations")
      .update({ config: newConfig })
      .eq("id", row.id);
    if (upErr) return { ok: false, error: upErr.message };
  } else {
    const { error: insErr } = await supabaseAdmin
      .from("integrations")
      .insert({ name: BRIDGE_NAME, type: "Communication", status: "connected", config: newConfig });
    if (insErr) return { ok: false, error: insErr.message };
  }
  return { ok: true, id: cmd.id };
}

/** Return AND clear the pending command queue (called by the outbox GET). */
export async function takePendingCommands(): Promise<BridgeCommand[]> {
  const { data: row } = await supabaseAdmin
    .from("integrations")
    .select("id, config")
    .eq("name", BRIDGE_NAME)
    .maybeSingle();
  if (!row) return [];
  const config = (row.config as Record<string, unknown> | null) ?? {};
  const queue = readQueue(config);
  if (queue.length === 0) return [];
  await supabaseAdmin
    .from("integrations")
    .update({ config: { ...config, pending_commands: [] } })
    .eq("id", row.id);
  return queue;
}

/** Online if the heartbeat (last_sync) is within 45s — mirrors /api/imessage/status. */
export async function getBridgeStatus(): Promise<BridgeStatus> {
  const { data } = await supabaseAdmin
    .from("integrations")
    .select("last_sync")
    .eq("name", BRIDGE_NAME)
    .maybeSingle();
  const lastSync = (data?.last_sync as string | null) ?? null;
  const secondsSince = lastSync ? (Date.now() - new Date(lastSync).getTime()) / 1000 : null;
  const status = secondsSince != null && secondsSince < 45 ? "online" : "offline";
  return { status, last_seen: lastSync, seconds_since: secondsSince != null ? Math.round(secondsSince) : null };
}

function humanAgo(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

/** One-line status string for Slack. */
export function formatBridgeStatusLine(s: BridgeStatus): string {
  if (s.status === "online") {
    return `🟢 *Bridge online* — last heartbeat ${s.seconds_since ?? 0}s ago`;
  }
  if (!s.last_seen) return `🔴 *Bridge offline* — no heartbeat ever recorded`;
  const ago = s.seconds_since != null ? humanAgo(s.seconds_since) : "?";
  return `🔴 *Bridge offline* — last heartbeat ${ago} ago (${new Date(s.last_seen).toLocaleString()})`;
}

/** The four control buttons, reused on the doctor card + the /srt bridge card. */
export function bridgeActionElements(): Array<Record<string, unknown>> {
  return [
    { type: "button", text: { type: "plain_text", text: "🔄 Restart", emoji: true }, style: "primary", action_id: "bridge_restart", value: "restart" },
    { type: "button", text: { type: "plain_text", text: "🩺 Re-run doctor", emoji: true }, action_id: "bridge_doctor", value: "doctor" },
    { type: "button", text: { type: "plain_text", text: "♻️ Resync", emoji: true }, action_id: "bridge_resync", value: "resync" },
    { type: "button", text: { type: "plain_text", text: "📡 Status", emoji: true }, action_id: "bridge_status", value: "status" },
  ];
}
