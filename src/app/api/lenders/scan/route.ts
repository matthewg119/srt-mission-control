import { NextRequest, NextResponse } from "next/server";

const MAX_SIZE = 5 * 1024 * 1024; // 5MB

export async function POST(req: NextRequest) {
  try {
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicApiKey) {
      return NextResponse.json({ error: "Missing ANTHROPIC_API_KEY" }, { status: 500 });
    }

    const formData = await req.formData();
    const file = formData.get("image") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No image file provided" }, { status: 400 });
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json({ error: "File too large. Maximum 5MB." }, { status: 400 });
    }

    const allowedTypes = ["image/png", "image/jpeg", "image/webp", "image/gif"];
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ error: "Unsupported image type. Use PNG, JPG, WEBP, or GIF." }, { status: 400 });
    }

    // Convert to base64
    const arrayBuffer = await file.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString("base64");
    const mediaType = file.type as "image/png" | "image/jpeg" | "image/webp" | "image/gif";

    // Call Claude Vision
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicApiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2048,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: mediaType, data: base64 },
              },
              {
                type: "text",
                text: `You are analyzing a lender rate sheet / spec sheet for a business financing brokerage. Extract all lender information you can find and return ONLY valid JSON (no markdown, no explanation) in this exact format:

{
  "name": "Lender Name",
  "min_credit_score": 550,
  "min_monthly_revenue": 10000,
  "max_amount": 500000,
  "min_time_in_business_months": 6,
  "max_negative_days": 5,
  "products": ["Working Capital", "Term Loan", "Line of Credit", "Equipment Financing", "Invoice Factoring", "SBA Loan", "Revenue Based"],
  "submission_email": "submissions@lender.com",
  "portal_url": "https://portal.lender.com",
  "notes": "Any additional details, restrictions, special programs, or rates mentioned",
  "tier": 2,
  "response_time_days": 2
}

Rules:
- products array: only use these exact values: "Working Capital", "Term Loan", "Line of Credit", "Equipment Financing", "Invoice Factoring", "SBA Loan", "Revenue Based"
- tier: 1 = A Paper (prime lenders, 650+ credit), 2 = B Paper (near-prime, 550-649), 3 = High Risk (sub-prime, 500+)
- min_monthly_revenue: convert to dollars (e.g. "$15K/mo" → 15000)
- max_amount: convert to dollars (e.g. "$500K" → 500000, "$2M" → 2000000)
- min_time_in_business_months: convert years to months if needed
- Set any field to null if not found in the image
- For notes: include rates, fees, special programs, restricted industries, or other details not captured by other fields
- Return ONLY the JSON object, nothing else`,
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Claude Vision API error:", errorText);
      return NextResponse.json({ error: "Failed to analyze image. Try a clearer image." }, { status: 500 });
    }

    const data = await response.json();
    const textContent = data.content?.find((c: { type: string }) => c.type === "text")?.text || "";

    // Parse the JSON from Claude's response
    let lender;
    try {
      // Try to extract JSON from the response (in case Claude wraps it)
      const jsonMatch = textContent.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found");
      lender = JSON.parse(jsonMatch[0]);
    } catch {
      console.error("Failed to parse Claude response:", textContent);
      return NextResponse.json({ error: "Could not extract lender data from image. Try a clearer image." }, { status: 422 });
    }

    return NextResponse.json({ success: true, lender });
  } catch (error) {
    console.error("Scan error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
