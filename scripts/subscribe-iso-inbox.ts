// One-shot: subscribe Matthew's personal Outlook inbox to the iso-inbox webhook.
// Run with: bun run scripts/subscribe-iso-inbox.ts
import crypto from "crypto";
import { supabaseAdmin } from "../src/lib/db";
import { microsoft } from "../src/lib/microsoft";

const APP_URL = "https://mission.srtagency.com";
const PERSONAL_EMAIL = "matthewmzts@gmail.com";
const NOTIFICATION_PATH = "/api/agent/iso-inbox";
const INTEGRATION_NAME = `graph_subscription_${PERSONAL_EMAIL.replace(/[^a-z0-9]/gi, "_")}`;

async function main() {
  console.log(`Subscribing ${PERSONAL_EMAIL} inbox → ${APP_URL}${NOTIFICATION_PATH}`);

  const { data: existing } = await supabaseAdmin
    .from("integrations")
    .select("config")
    .eq("name", INTEGRATION_NAME)
    .maybeSingle();

  if (existing?.config?.subscription_id) {
    console.log("Deleting existing subscription:", existing.config.subscription_id);
    try { await microsoft.deleteSubscription(existing.config.subscription_id as string); }
    catch (e) { console.warn("Delete failed (may already be expired):", (e as Error).message); }
  }

  const clientState = crypto.randomBytes(24).toString("hex");

  const sub = await microsoft.createSubscription({
    resource: `users/${PERSONAL_EMAIL}/messages`,
    changeType: "created",
    notificationUrl: `${APP_URL}${NOTIFICATION_PATH}`,
    clientState,
    expirationMinutes: 60 * 24 * 3,
  });

  await supabaseAdmin
    .from("integrations")
    .upsert(
      {
        name: INTEGRATION_NAME,
        config: {
          subscription_id: sub.id,
          resource: sub.resource,
          mailbox: PERSONAL_EMAIL,
          notification_path: NOTIFICATION_PATH,
          client_state: clientState,
          expires_at: sub.expirationDateTime,
        },
        status: "connected",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "name" }
    );

  console.log("✓ Subscription created");
  console.log(`  ID:      ${sub.id}`);
  console.log(`  Expires: ${sub.expirationDateTime}`);
  console.log(`  Mailbox: ${PERSONAL_EMAIL}`);
  console.log(`  Handler: ${APP_URL}${NOTIFICATION_PATH}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
