export const dynamic = "force-dynamic";
export const maxDuration = 60;
import { NextRequest, NextResponse } from "next/server";
import { launchWorkflowInSlack } from "@/lib/reel/workflow-pipeline";

// POST — "Run in Slack" from the app: kick a #content-full session pre-set to this workflow. The
// app observes; Slack runs. Returns the thread ts so the UI can confirm/deep-link.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const res = await launchWorkflowInSlack(params.id);
    if (!res.ok) {
      return NextResponse.json(
        { error: "Could not launch. Check SLACK_CONTENT_FULL_CHANNEL and that the workflow exists." },
        { status: 400 }
      );
    }
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
