import { NextResponse } from "next/server";
import { getAuthUrl } from "@/lib/microsoft";

export async function GET() {
  const url = getAuthUrl();
  return NextResponse.redirect(url);
}
