export interface RepProfile {
  id: string;
  name: string;
  title: string;
  phone: string;
  email: string;
  fax?: string;
}

export const BENJAMIN: RepProfile = {
  id: "benjamin",
  name: process.env.BENJAMIN_NAME ?? "Benjamin",
  title: "Senior Capital Specialist",
  phone: process.env.BENJAMIN_PHONE ?? "(786) 282-2937",
  email: process.env.BENJAMIN_EMAIL ?? "benjamin@srtagency.com",
  fax: "(252) 556-1444",
};

export const MATTHEW: RepProfile = {
  id: "matthew",
  name: process.env.MATTHEW_NAME ?? "Matthew Garcia",
  title: "AI Visibility Specialist",
  phone: process.env.MATTHEW_PHONE ?? "336-833-2303",
  email: process.env.MATTHEW_EMAIL ?? "matthew@srtagency.com",
  fax: "(252) 556-1444",
};

export const DEFAULT_REP: RepProfile = BENJAMIN;

export const SRT_COMPANY = {
  name: "SRT Agency",
  tagline: "Search Retrieval Tactics",
  fax: "(252) 556-1444",
  applyUrl: "https://srtagency.com/audit",
  portalUrl: "https://portal.srtagency.com",
};

export function getRep(id: string): RepProfile | undefined {
  if (id === "benjamin") return BENJAMIN;
  if (id === "matthew") return MATTHEW;
  return undefined;
}
