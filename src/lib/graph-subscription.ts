// Shared (re)creation of the Microsoft Graph change-notification subscription that
// drives the submissions@ inbox → /api/agent/submissions webhook. Used by both the
// manual subscribe route and the renew cron's self-heal path, so the create+persist
// logic lives in exactly one place.
//
// Why this exists: subscriptions are delegated (tied to the signed-in Microsoft 365
// token) and Microsoft silently drops them when the token lapses or on a lifecycle
// event. Our integrations row can still claim a future `expires_at` while the
// subscription no longer exists on Microsoft's side — so "renew only" is not enough;
// we must be able to re-create a missing one.

import crypto from "crypto";
import { supabaseAdmin } from "@/lib/db";
import { microsoft } from "@/lib/microsoft";

export const DEFAULT_SUBSCRIPTION_MAILBOX = "submissions@srtagency.com";
export const DEFAULT_SUBSCRIPTION_PATH = "/api/agent/submissions";

/** integrations.name for a mailbox's subscription row (no unique constraint — update by name). */
export function subscriptionIntegrationName(mailbox: string): string {
  return `graph_subscription_${mailbox.replace(/[^a-z0-9]/gi, "_")}`;
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";
}

interface SubscriptionConfig {
  subscription_id: string;
  resource: string;
  mailbox: string;
  notification_path: string;
  client_state: string;
  expires_at: string;
}

/**
 * Delete any prior subscription (best-effort), create a fresh 3-day subscription,
 * and persist the live id/clientState/expiry to the integrations row. Throws if the
 * Graph create or the DB write fails.
 */
export async function recreateSubscription(
  mailbox: string = DEFAULT_SUBSCRIPTION_MAILBOX,
  notificationPath: string = DEFAULT_SUBSCRIPTION_PATH,
): Promise<{ id: string; expires_at: string; mailbox: string }> {
  const integrationName = subscriptionIntegrationName(mailbox);

  const { data: existing } = await supabaseAdmin
    .from("integrations")
    .select("config")
    .eq("name", integrationName)
    .maybeSingle();

  const existingId = (existing?.config as { subscription_id?: string } | undefined)?.subscription_id;
  if (existingId) {
    try {
      await microsoft.deleteSubscription(existingId);
    } catch (e) {
      // Already gone (the common case here) or transient — re-creating regardless.
      console.warn("[graph-subscription] stale delete failed:", (e as Error).message);
    }
  }

  const clientState = crypto.randomBytes(24).toString("hex");
  const sub = await microsoft.createSubscription({
    resource: `users/${mailbox}/messages`,
    changeType: "created",
    notificationUrl: `${appUrl()}${notificationPath}`,
    clientState,
    expirationMinutes: 60 * 24 * 3,
  });

  const config: SubscriptionConfig = {
    subscription_id: sub.id,
    resource: sub.resource,
    mailbox,
    notification_path: notificationPath,
    client_state: clientState,
    expires_at: sub.expirationDateTime,
  };
  const row = { name: integrationName, config, status: "connected", updated_at: new Date().toISOString() };

  // integrations.name has no unique constraint, so an onConflict upsert would no-op
  // and leave the stale id; update-by-name (or insert when absent) instead.
  const persist = existing
    ? await supabaseAdmin.from("integrations").update(row).eq("name", integrationName)
    : await supabaseAdmin.from("integrations").insert(row);
  if (persist.error) {
    throw new Error(`subscription created but DB write failed: ${persist.error.message}`);
  }

  return { id: sub.id, expires_at: sub.expirationDateTime, mailbox };
}
