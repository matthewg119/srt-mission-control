import { NextResponse } from "next/server";
import { initiateRingOut, formatPhone } from "@/lib/ringcentral";

// Temporary debug endpoint — returns the raw RingOut API response
// DELETE THIS FILE after debugging
export async function GET(request: Request) {
  const url = new URL(request.url);
  const skipExt = url.searchParams.get("skipext") === "1";

  const agentPhone = process.env.RC_AGENT_NUMBER || "";
  const agentExtension = skipExt ? undefined : (process.env.RC_AGENT_EXTENSION || undefined);
  const leadPhone = "+17865909616";

  const formattedLead = formatPhone(leadPhone);

  const result = await initiateRingOut(
    agentPhone,
    formattedLead || leadPhone,
    agentExtension
  );

  return NextResponse.json({
    envCheck: {
      RC_AGENT_NUMBER: agentPhone ? `set (${agentPhone})` : "NOT SET",
      RC_AGENT_EXTENSION: agentExtension ? `set (${agentExtension})` : "NOT SET (skipped or empty)",
      RC_BUSINESS_NUMBER: process.env.RC_BUSINESS_NUMBER ? "set" : "NOT SET",
    },
    dialString: agentExtension ? `${formatPhone(agentPhone)}*${agentExtension}` : formatPhone(agentPhone),
    ringoutResult: result,
  });
}
