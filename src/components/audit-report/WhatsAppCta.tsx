export function WhatsAppCta() {
  const message = encodeURIComponent("I saw my AI visibility report — walk me through it");
  return (
    <a
      href={`https://api.whatsapp.com/send/?text=${message}`}
      className="block w-full rounded-lg bg-reef py-3 text-center text-sm font-semibold text-midnight transition hover:opacity-90"
    >
      Message us on WhatsApp
    </a>
  );
}
