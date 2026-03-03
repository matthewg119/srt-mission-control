/**
 * Lead validation & bot protection for /api/leads/* endpoints.
 * Shared by both capture and application routes.
 */

// ── Rate-limit store (in-memory, per serverless instance) ──

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

// Clean up stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap) {
    if (now > entry.resetAt) rateLimitMap.delete(key);
  }
}, 5 * 60 * 1000);

// ── CORS ──

export const LEAD_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://srtagency.com",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  Vary: "Origin",
};

/**
 * Return the right CORS origin header based on the request.
 * Allows srtagency.com and www.srtagency.com; rejects everything else.
 */
export function getCorsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin") || "";
  const allowed = ["https://srtagency.com", "https://www.srtagency.com"];

  if (allowed.includes(origin)) {
    return { ...LEAD_CORS_HEADERS, "Access-Control-Allow-Origin": origin };
  }

  // For non-browser requests (no Origin header) allow through — these are
  // server-to-server or curl calls. The browser will block cross-origin anyway.
  if (!origin) {
    return LEAD_CORS_HEADERS;
  }

  // Unknown origin — still return headers but with the default domain.
  // The browser will block the response because the origin doesn't match.
  return LEAD_CORS_HEADERS;
}

// ── Validation helpers ──

/** Check if a string has at least one vowel (basic gibberish detection) */
function hasVowels(str: string): boolean {
  return /[aeiouAEIOU]/.test(str);
}

/** Known invalid / unassigned US area codes (not exhaustive, but covers common bot patterns) */
const INVALID_AREA_CODES = new Set([
  "000", "100", "200", "211", "311", "411", "511", "544", "555",
  "611", "711", "811", "911",
]);

function extractAreaCode(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  // US numbers: 10 digits or 11 (with leading 1)
  if (digits.length === 10) return digits.slice(0, 3);
  if (digits.length === 11 && digits[0] === "1") return digits.slice(1, 4);
  return null;
}

// ── Main validation ──

export interface ValidationResult {
  valid: boolean;
  /** If invalid, a human-readable reason (logged, not returned to bots) */
  reason?: string;
  /** If true, return a fake 200 to fool the bot */
  silentReject?: boolean;
}

interface LeadFields {
  name?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  /** Honeypot field — should always be empty for real users */
  website?: string;
}

/**
 * Validate a lead submission for bot / spam patterns.
 * Returns { valid: true } for real leads, or a rejection reason for bots.
 */
export function validateLeadSubmission(fields: LeadFields): ValidationResult {
  // 1. Honeypot — if filled, it's a bot (hidden field real users never see)
  if (fields.website) {
    return { valid: false, reason: "Honeypot field filled", silentReject: true };
  }

  // 2. Name validation
  const fullName = fields.name || [fields.firstName, fields.lastName].filter(Boolean).join(" ");
  if (fullName) {
    // Reject names with no vowels and > 5 chars (e.g. "CnwiuZQVCYofuPJoeUAQt")
    // Short names like "Mr. X" are fine
    if (fullName.length > 10 && !hasVowels(fullName)) {
      return { valid: false, reason: `Name has no vowels: "${fullName}"`, silentReject: true };
    }

    // Reject single-word names over 15 characters (likely random strings)
    if (!fullName.includes(" ") && fullName.length > 15) {
      return { valid: false, reason: `Single-word name too long: "${fullName}"`, silentReject: true };
    }

    // Reject names that are mostly non-alpha characters
    const alphaRatio = (fullName.match(/[a-zA-Z]/g) || []).length / fullName.length;
    if (fullName.length > 5 && alphaRatio < 0.5) {
      return { valid: false, reason: `Name is mostly non-alpha: "${fullName}"`, silentReject: true };
    }
  }

  // 3. Phone validation — reject known-invalid US area codes
  const phone = fields.phone;
  if (phone) {
    const areaCode = extractAreaCode(phone);
    if (areaCode && INVALID_AREA_CODES.has(areaCode)) {
      return { valid: false, reason: `Invalid area code: ${areaCode}`, silentReject: true };
    }
  }

  // 4. Email validation — basic format check
  const email = fields.email;
  if (email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return { valid: false, reason: `Invalid email format: "${email}"` };
    }
  }

  return { valid: true };
}

/**
 * Check rate limit for an IP address.
 * Returns true if the request should be allowed, false if rate-limited.
 */
export function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  entry.count++;
  if (entry.count > RATE_LIMIT_MAX) {
    return false;
  }

  return true;
}

/**
 * Extract the client IP from the request headers.
 */
export function getClientIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}
