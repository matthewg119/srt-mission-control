/**
 * Lead quality scoring — 0 to 100
 * Higher score = better quality lead for follow-up prioritization
 */
export interface LeadScoreInput {
  email?: string | null;
  phone?: string | null;
  locationUS?: string | null;     // "yes"/"no"
  revenue120k?: string | null;    // "yes"/"no" (monthly $15k+ qualifier)
  checkingAccount?: string | null; // "yes"/"no"
  creditScore?: string | null;    // "750+","700-749","650-699","600-649","550-599","500-549","Below 500"
  amountNeeded?: string | null;   // e.g. "$50,000"
  fbc?: string | null;            // Facebook click ID (from Meta ad)
}

export function calculateLeadScore(input: LeadScoreInput): number {
  let score = 0;

  if (input.email) score += 20;
  if (input.phone) score += 15;
  if (input.locationUS === "yes") score += 10;
  if (input.revenue120k === "yes") score += 20;
  if (input.checkingAccount === "yes") score += 10;

  // Credit score
  if (input.creditScore) {
    const cs = input.creditScore.toLowerCase();
    if (cs.startsWith("750")) score += 15;
    else if (cs.startsWith("700")) score += 12;
    else if (cs.startsWith("650")) score += 8;
    else if (cs.startsWith("600")) score += 5;
  }

  // Amount sweet spot ($25k - $500k)
  if (input.amountNeeded) {
    const amt = parseFloat(input.amountNeeded.replace(/[^0-9.]/g, "")) || 0;
    if (amt >= 25000 && amt <= 500000) score += 10;
  }

  return Math.min(score, 100);
}

export function resolveAdSource(fbc?: string | null, source?: string | null): string {
  if (fbc && fbc.startsWith("fb.")) return "meta";
  if (source?.toLowerCase().includes("facebook") || source?.toLowerCase().includes("meta")) return "meta";
  if (source?.toLowerCase().includes("organic") || source?.toLowerCase().includes("google")) return "organic";
  return "direct";
}
