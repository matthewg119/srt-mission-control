import { updateLead } from "./zoho";

export interface MCAOffer {
  factorRate?: number;
  totalPayback?: number;
  dailyPayment?: number;
  weeklyPayment?: number;
  termMonths?: number;
  netFunded?: number;
  useOfFunds?: string;
}

export async function syncMCAOfferToZoho(zohoLeadId: string, offer: MCAOffer): Promise<void> {
  const updates: Record<string, unknown> = {};

  if (offer.factorRate !== undefined) updates.MCA_Factor_Rate = offer.factorRate;
  if (offer.totalPayback !== undefined) updates.MCA_Total_Payback = offer.totalPayback;
  if (offer.dailyPayment !== undefined) updates.MCA_Daily_Payment = offer.dailyPayment;
  if (offer.weeklyPayment !== undefined) updates.MCA_Weekly_Payment = offer.weeklyPayment;
  if (offer.termMonths !== undefined) updates.MCA_Term_Months = offer.termMonths;
  if (offer.netFunded !== undefined) updates.MCA_Net_Funded = offer.netFunded;
  if (offer.useOfFunds !== undefined) updates.MCA_Use_Of_Funds = offer.useOfFunds;

  if (Object.keys(updates).length === 0) return;

  await updateLead(zohoLeadId, updates as Parameters<typeof updateLead>[1]);
}
