import { NextResponse } from "next/server";

const BASE_URL = "https://services.leadconnectorhq.com";

export async function GET() {
  const apiKey = process.env.GHL_API_KEY || "";
  const locationId = process.env.GHL_LOCATION_ID || "";

  const results: Record<string, unknown> = {
    hasApiKey: !!apiKey,
    apiKeyLast4: apiKey ? "..." + apiKey.slice(-4) : "(empty)",
    hasLocationId: !!locationId,
    locationId: locationId || "(empty)",
  };

  // Test 1: Search contacts (simplest read operation)
  try {
    const res = await fetch(`${BASE_URL}/contacts/?locationId=${locationId}&limit=1`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Version: "2021-07-28",
      },
    });
    const body = await res.text();
    results.searchContacts = {
      status: res.status,
      statusText: res.statusText,
      body: body.slice(0, 500),
    };
  } catch (err) {
    results.searchContacts = { error: err instanceof Error ? err.message : String(err) };
  }

  // Test 2: Create a test contact
  try {
    const res = await fetch(`${BASE_URL}/contacts/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Version: "2021-07-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        locationId,
        firstName: "GHL_TEST",
        lastName: "DELETE_ME",
        email: "ghl-test-delete-me@srtagency.com",
        tags: ["test-delete"],
      }),
    });
    const body = await res.text();
    results.createContact = {
      status: res.status,
      statusText: res.statusText,
      body: body.slice(0, 500),
    };
  } catch (err) {
    results.createContact = { error: err instanceof Error ? err.message : String(err) };
  }

  return NextResponse.json(results, { status: 200 });
}
