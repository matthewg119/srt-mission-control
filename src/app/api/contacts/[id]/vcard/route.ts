export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const { data: contact, error } = await supabaseAdmin
    .from("contacts")
    .select("id, first_name, last_name, email, phone, mobile_phone, business_name, biz_address, biz_city, biz_state")
    .eq("id", id)
    .maybeSingle();

  if (error || !contact) {
    return new NextResponse("Not found", { status: 404 });
  }

  const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(" ") || "Unknown";
  const lines: string[] = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${vEscape(fullName)}`,
    `N:${vEscape(contact.last_name ?? "")};${vEscape(contact.first_name ?? "")};;;`,
  ];
  if (contact.business_name) lines.push(`ORG:${vEscape(contact.business_name)}`);
  if (contact.phone)         lines.push(`TEL;TYPE=CELL:${contact.phone}`);
  if (contact.mobile_phone)  lines.push(`TEL;TYPE=CELL:${contact.mobile_phone}`);
  if (contact.email)         lines.push(`EMAIL:${contact.email}`);
  const street = contact.biz_address ?? "";
  const city   = contact.biz_city    ?? "";
  const state  = contact.biz_state   ?? "";
  if (street || city || state) {
    lines.push(`ADR;TYPE=WORK:;;${vEscape(street)};${vEscape(city)};${vEscape(state)};;`);
  }
  lines.push("END:VCARD");

  const vcf = lines.join("\r\n");
  const slug = (contact.first_name ?? "contact").toLowerCase().replace(/\s+/g, "-");
  return new NextResponse(vcf, {
    headers: {
      "Content-Type": "text/vcard; charset=utf-8",
      "Content-Disposition": `attachment; filename="${slug}.vcf"`,
    },
  });
}

function vEscape(s: string): string {
  return s.replace(/[,;\\]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");
}
