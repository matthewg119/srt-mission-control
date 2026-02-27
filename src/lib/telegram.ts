// Max Telegram message length
const MAX_LENGTH = 4096;

function getApi(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN || "";
  return `https://api.telegram.org/bot${token}`;
}

export const telegram = {
  /** Send a text message. Auto-splits if too long. */
  async sendMessage(chatId: number | string, text: string): Promise<void> {
    const api = getApi();
    const chunks = splitMessage(text);
    for (const chunk of chunks) {
      await fetch(`${api}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: chunk,
          parse_mode: "Markdown",
        }),
      });
    }
  },

  /** Send a "typing..." indicator */
  async sendTyping(chatId: number | string): Promise<void> {
    await fetch(`${getApi()}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action: "typing" }),
    });
  },

  /** Register webhook URL with Telegram */
  async setWebhook(url: string, secret?: string): Promise<Record<string, unknown>> {
    const body: Record<string, unknown> = { url };
    if (secret) body.secret_token = secret;
    const res = await fetch(`${getApi()}/setWebhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.json();
  },

  /** Remove webhook */
  async deleteWebhook(): Promise<Record<string, unknown>> {
    const res = await fetch(`${getApi()}/deleteWebhook`, { method: "POST" });
    return res.json();
  },

  /** Check bot info */
  async getMe(): Promise<Record<string, unknown>> {
    const res = await fetch(`${getApi()}/getMe`);
    return res.json();
  },

  /** Check if bot token is configured */
  isConfigured(): boolean {
    const token = process.env.TELEGRAM_BOT_TOKEN || "";
    return !!token && token.trim().length > 0;
  },
};

function splitMessage(text: string): string[] {
  if (text.length <= MAX_LENGTH) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= MAX_LENGTH) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf("\n", MAX_LENGTH);
    if (splitAt < MAX_LENGTH * 0.5) splitAt = MAX_LENGTH;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }
  return chunks;
}
