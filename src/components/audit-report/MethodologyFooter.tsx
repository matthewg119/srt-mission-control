export function MethodologyFooter({ createdAt }: { createdAt: string }) {
  const date = new Date(createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  return (
    <footer className="border-t border-border-subtle pt-4 text-xs leading-relaxed text-text-secondary">
      Run on {date} via the official OpenAI API with web search — neutral account, no personalization. This reflects
      what a new customer sees, not what you see on your own device.
    </footer>
  );
}
