const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL || "";

/**
 * Send a notification to Slack via Incoming Webhook.
 * Silent-fail — never crashes the main flow.
 */
export async function notifySlack(text: string): Promise<void> {
  if (!SLACK_WEBHOOK_URL) return;
  try {
    await fetch(SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch {
    // Silent fail — Slack notifications should never crash the main flow
  }
}

/** Format a new lead capture notification */
export function formatLeadCapture(data: {
  name: string;
  email?: string;
  phone?: string;
  message?: string;
}): string {
  const lines = [`🟢 *New Lead: ${data.name}*`];
  if (data.email) lines.push(`Email: ${data.email}`);
  if (data.phone) lines.push(`Phone: ${data.phone}`);
  if (data.message) lines.push(`Message: ${data.message.slice(0, 200)}`);
  lines.push("Source: Contact Form");
  return lines.join("\n");
}

/** Format an application completion notification */
export function formatApplicationComplete(data: {
  name: string;
  businessName?: string;
  amountNeeded?: string;
  email?: string;
  phone?: string;
}): string {
  const lines = [`🟢 *Application Completed: ${data.name}*`];
  if (data.businessName) lines.push(`Business: ${data.businessName}`);
  if (data.amountNeeded) lines.push(`Amount: ${data.amountNeeded}`);
  if (data.email) lines.push(`Email: ${data.email}`);
  if (data.phone) lines.push(`Phone: ${data.phone}`);
  lines.push("Source: Application (100%)");
  return lines.join("\n");
}
