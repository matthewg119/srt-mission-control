import { NextResponse } from "next/server";
import { initiateRingOut, formatPhone } from "@/lib/ringcentral";

// Temporary debug endpoint — returns the raw RingOut API response
// DELETE THIS FILE after debugging
export async function GET() {
  const agentPhone = process.env.RC_AGENT_NUMBER || "";
  const agentExtension = process.env.RC_AGENT_EXTENSION || "";
  const leadPhone = "+17865909616";

  const formattedLead = formatPhone(leadPhone);

  const result = await initiateRingOut(
    agentPhone,
    formattedLead || leadPhone,
    agentExtension || undefined
  );

  return NextResponse.json({
    envCheck: {
      RC_AGENT_NUMBER: agentPhone ? `set (${agentPhone})` : "NOT SET",
      RC_AGENT_EXTENSION: agentExtension ? `set (${agentExtension})` : "NOT SET",
      RC_BUSINESS_NUMBER: process.env.RC_BUSINESS_NUMBER ? "set" : "NOT SET",
    },
    ringoutResult: result,
  });
}
