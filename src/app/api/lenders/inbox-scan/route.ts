// Bulk-scan Matthew's inbox for lender ISO/onboarding emails.
// Searches the last 18 months for emails with ISO/partner/onboarding keywords,
// runs each through the lender-signup-detector, deduplicates by lender name,
// and returns a formatted table + raw JSON.
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { detectLenderSignup } from "@/lib/ai-intel/lender-signup-detector";

export const runtime = "nodejs";
export const maxDuration = 120;

const GRAPH_URL = "https://graph.microsoft.com/v1.0";

// Individual keyword searches that catch ISO/onboarding emails
// Graph API $search uses simple quoted keyword strings
const SEARCH_KEYWORDS = [
  "ISO approved",
  "ISO partner welcome",
  "ISO onboarding",
  "broker agreement signed",
  "submission instructions",
  "ISO portal access",
  "welcome aboard ISO",
  "funding partner approved",
];

async function getAccessToken(): Promise<string> {
  const { data } = await supabaseAdmin
    .from("integrations")
    .select("config")
    .eq("name", "Microsoft 365")
    .single();
  const cfg = data?.config as { access_token?: string } | undefined;
  if (!cfg?.access_token) throw new Error("Microsoft 365 not connected");
  return cfg.access_token;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

interface GraphMsg {
  id: string;
  subject: string;
  from: { emailAddress: { address: string } };
  bodyPreview: string;
  receivedDateTime: string;
  body?: { content: string; contentType: string };
}

async function searchMessages(token: string, keyword: string): Promise<GraphMsg[]> {
  // Graph API $search uses simple quoted keyword — can't combine with $orderby
  const params = new URLSearchParams({
    $search: `"${keyword}"`,
    $top: "25",
    $select: "id,subject,from,receivedDateTime,bodyPreview",
  });
  const res = await fetch(`${GRAPH_URL}/me/messages?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}`, ConsistencyLevel: "eventual" },
  });
  if (!res.ok) {
    console.warn(`[inbox-scan] search failed for "${keyword}":`, res.status, await res.text().catch(() => ""));
    return [];
  }
  const data = await res.json() as { value?: GraphMsg[] };
  return data.value ?? [];
}

async function fetchBody(token: string, messageId: string): Promise<string> {
  const res = await fetch(`${GRAPH_URL}/me/messages/${messageId}?$select=body`, {
    headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.body-content-type="text"' },
  });
  if (!res.ok) return "";
  const data = await res.json() as { body?: { content?: string; contentType?: string } };
  const content = data.body?.content ?? "";
  return data.body?.contentType === "html" ? stripHtml(content) : content;
}

export async function GET() {
  try {
    const token = await getAccessToken();

    // Collect unique message IDs across all search queries
    const seen = new Set<string>();
    const candidates: GraphMsg[] = [];

    for (const query of SEARCH_KEYWORDS) {
      const msgs = await searchMessages(token, query);
      for (const m of msgs) {
        if (!seen.has(m.id)) {
          seen.add(m.id);
          candidates.push(m);
        }
      }
    }

    // Run each candidate through the signup detector
    type Detection = {
      lender_name: string | null;
      submission_email: string | null;
      cc_emails: string[];
      portal_url: string | null;
      rep_name: string | null;
      rep_email: string | null;
      rep_phone: string | null;
      subject_line_format: string | null;
      docs_required: string | null;
      notes: string | null;
      confidence: "high" | "medium" | "low";
      receivedDateTime?: string;
    };

    const detectedByName = new Map<string, Detection>();

    for (const msg of candidates) {
      const body = await fetchBody(token, msg.id);
      const { detection } = await detectLenderSignup({
        subject: msg.subject,
        from: msg.from?.emailAddress?.address ?? "",
        body: body || msg.bodyPreview,
      });

      if (!detection.is_signup || detection.confidence === "low") continue;

      const key = (detection.lender_name ?? msg.from.emailAddress.address).toLowerCase().trim();
      // Keep the most recent / highest confidence version
      if (!detectedByName.has(key) || detection.confidence === "high") {
        detectedByName.set(key, { ...detection, receivedDateTime: msg.receivedDateTime });
      }
    }

    const results = Array.from(detectedByName.values()).sort((a, b) =>
      (a.lender_name ?? "").localeCompare(b.lender_name ?? "")
    );

    // Format as a plain-text table for easy reading
    const tableHeader = [
      "Lender Name",
      "Rep Name",
      "Rep Email",
      "Submission Email",
      "CC Emails",
      "Portal URL",
      "Subject Format",
      "Docs Required",
      "Notes",
      "Confidence",
    ].join(" | ");

    const tableRows = results.map((r) =>
      [
        r.lender_name ?? "Unknown",
        r.rep_name ?? "",
        r.rep_email ?? "",
        r.submission_email ?? "",
        r.cc_emails.join("; "),
        r.portal_url ?? "",
        r.subject_line_format ?? "",
        r.docs_required ?? "",
        r.notes ?? "",
        r.confidence,
      ].join(" | ")
    );

    return NextResponse.json({
      scanned: candidates.length,
      found: results.length,
      table: [tableHeader, ...tableRows].join("\n"),
      lenders: results,
    });
  } catch (err) {
    console.error("[lenders/inbox-scan]", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
