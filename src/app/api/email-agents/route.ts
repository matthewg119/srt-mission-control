import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { microsoft } from "@/lib/microsoft";

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("email_drafts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw error;
    return NextResponse.json({ drafts: data || [] });
  } catch {
    // Table may not exist yet — return empty
    return NextResponse.json({ drafts: [] });
  }
}

export async function PATCH(req: NextRequest) {
  const { id, action, subject, body } = await req.json();

  if (action === "approve") {
    // Fetch the draft
    const { data: draft, error: fetchErr } = await supabaseAdmin
      .from("email_drafts")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchErr || !draft) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    // Send the email via Microsoft 365
    try {
      await microsoft.sendMail({
        to: draft.to_email as string,
        subject: draft.subject as string,
        body: draft.body as string,
        isHtml: false,
      });
    } catch (err) {
      return NextResponse.json({ error: `Failed to send: ${(err as Error).message}` }, { status: 500 });
    }

    // Mark draft as sent
    const { data: updated, error: updateErr } = await supabaseAdmin
      .from("email_drafts")
      .update({ status: "sent", updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    // If there's a linked deal_submissions record, mark it as pending (awaiting reply)
    const dealData = draft.deal_data as { submission_id?: string; lender_name?: string } | null;
    if (dealData?.submission_id) {
      await supabaseAdmin
        .from("deal_submissions")
        .update({ status: "pending", submitted_at: new Date().toISOString() })
        .eq("id", dealData.submission_id);
    }

    // Log it
    await supabaseAdmin.from("system_logs").insert({
      event_type: "lender_submission_sent",
      description: `Submission email sent: ${draft.subject}`,
      metadata: { draftId: id, to: draft.to_email, submissionId: dealData?.submission_id },
    });

    return NextResponse.json({ draft: updated });
  }

  if (action === "edit") {
    const updates: Record<string, string> = {};
    if (subject) updates.subject = subject;
    if (body) updates.body = body;

    const { data, error } = await supabaseAdmin
      .from("email_drafts")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ draft: data });
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}
