const TIERS = [
  {
    name: "Core AI Visibility",
    price: "$349/month",
    ctaLabel: "Get Core AI Visibility",
    checkoutUrl: "https://buy.stripe.com/dRm14o85j8AL95H1PY3AY00",
    bullets: [
      "AI visibility monitoring: 40 real buyer questions tracked monthly across ChatGPT, Perplexity, Gemini & Google AI.",
      "Website optimized for AI engines: schema, structured data, Google Business Profile & directory cleanup.",
      "Review management: we monitor, answer & quote reviews from your real customers.",
      "Monthly progress scorecard from a neutral, dated account.",
    ],
  },
  {
    name: "Complete AI Visibility",
    price: "$499/month",
    ctaLabel: "Get Complete AI Visibility",
    checkoutUrl: "https://buy.stripe.com/aFa14odpD8AL6XzfGO3AY01",
    bullets: [
      "Everything in Core Visibility.",
      "Forum & community outreach: we research the questions your buyers ask on Reddit and forums and draft the answers.",
      "Review engine: we make it effortless for your real customers to leave detailed, quotable reviews AI engines actually cite.",
      "Third-party citation building: directories, listings & mentions on the sources AI trusts most.",
      "Competitor tracking in your monthly report: who's taking your answers, and your share of them month over month.",
    ],
  },
] as const;

export function PricingCta() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {TIERS.map((tier) => (
        <div key={tier.name} className="flex flex-col gap-3 rounded-lg border border-surface-border bg-surface p-4">
          <a
            href={tier.checkoutUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="block w-full rounded-lg bg-reef py-3 text-center text-sm font-semibold text-midnight transition hover:opacity-90"
          >
            {tier.ctaLabel}
          </a>
          <div className="text-sm text-text-secondary">
            <p className="font-semibold text-text-primary">{tier.name}</p>
            <p className="mb-2 text-text-primary">{tier.price}</p>
            <ul className="list-disc space-y-1 pl-4">
              {tier.bullets.map((bullet) => (
                <li key={bullet}>{bullet}</li>
              ))}
            </ul>
          </div>
        </div>
      ))}
    </div>
  );
}
