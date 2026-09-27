export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

interface BulkRow {
  first_name: string;
  last_name?: string;
  business_name?: string;
  email?: string;
  phone?: string;
}

// POST /api/contacts/bulk — bulk create contacts (up to 500 per batch)
//
// ‼️ IT USED TO CREATE A `deals` ROW PER CONTACT AND THAT HALF IS GONE (2026-09-27). It inserted
// `pipeline: "New Deals"`, `stage: "Open - Not Contacted"` and an `amount` per imported contact, which
// is the MCA funding pipeline, and `deals` is one of the eight wholly-funding tables being dropped.
// Matthew, 2026-09-27: "my onboarding for AEO has nothing to do with funding so make sure they dont
// even see each other I want to drop everything regarding to funding".
//
// ‼️ `amount`, `pipeline`, `stage` AND `assigned_to` ARE NO LONGER ACCEPTED, rather than accepted and
// ignored. A caller still sending them gets a 400 naming them, because silently dropping a field
// somebody supplied is how an importer looks like it worked. This route has no in-app caller, so the
// only client is a script or a person with curl.
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const rows: BulkRow[] = body.rows;

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: "rows array is required" }, { status: 400 });
    }

    if (rows.length > 500) {
      return NextResponse.json({ error: "Max 500 rows per batch" }, { status: 400 });
    }

    // ‼️ REFUSE THE FUNDING FIELDS BY NAME rather than ignoring them. See the header.
    const FUNDING_FIELDS = ["amount", "pipeline", "stage", "assigned_to"] as const;
    const sent = FUNDING_FIELDS.filter((f) => rows.some((r) => (r as unknown as Record<string, unknown>)[f] !== undefined));
    if (sent.length) {
      return NextResponse.json(
        {
          error:
            `This route creates contacts only. It no longer creates a deal per contact, so ${sent.join(", ")} ` +
            `${sent.length === 1 ? "is" : "are"} not accepted. Funding was decommissioned; remove the field(s) and retry.`,
        },
        { status: 400 }
      );
    }

    // 1. Bulk insert contacts
    const contactInserts = rows.map((r) => ({
      first_name: r.first_name || "Unknown",
      last_name: r.last_name || null,
      business_name: r.business_name || null,
      email: r.email || null,
      phone: r.phone || null,
      source: "Import",
      tags: [],
    }));

    const { data: contacts, error: contactError } = await supabaseAdmin
      .from("contacts")
      .insert(contactInserts)
      .select("id");

    if (contactError) throw contactError;
    if (!contacts || contacts.length === 0) {
      return NextResponse.json({ error: "No contacts created" }, { status: 500 });
    }

    return NextResponse.json({
      created: contacts.length,
      contacts: contacts.length,
    });
  } catch (error) {
    console.error("Bulk import error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Bulk import failed" },
      { status: 500 }
    );
  }
}
