import { supabaseAdmin } from "./db";

type AlertSeverity = "info" | "warning" | "error" | "critical";

/**
 * Write a system alert to the system_alerts table.
 * Silent-fails — never throws, never blocks the calling function.
 */
export async function systemAlert(
  title: string,
  message: string,
  source: string,
  severity: AlertSeverity = "error"
): Promise<void> {
  try {
    await supabaseAdmin.from("system_alerts").insert({
      title,
      message,
      source,
      severity,
    });
  } catch {
    // Silent fail — alerts should never crash the main flow
  }
}
