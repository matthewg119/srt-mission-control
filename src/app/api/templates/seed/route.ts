import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

const SEED_TEMPLATES = [
  // === NEW DEALS PIPELINE ===
  {
    name: "New Lead Welcome SMS",
    slug: "new-lead-welcome-sms",
    type: "SMS",
    category: "Open - Not Contacted",
    subject: null,
    body: `Hi {{first_name}}, thanks for reaching out to SRT Agency! We specialize in helping businesses like {{business_name}} get the funding they need. One of our specialists will be reaching out shortly. Reply STOP to opt out.`,
    variables: ["first_name", "business_name"],
  },
  {
    name: "New Lead Welcome Email",
    slug: "new-lead-welcome-email",
    type: "Email",
    category: "Open - Not Contacted",
    subject: "Welcome to SRT Agency — Your Funding Journey Starts Here",
    body: `Hi {{first_name}},

Thank you for your interest in business funding through SRT Agency.

We received your information for {{business_name}} and one of our funding specialists will be reviewing your profile shortly.

Here's what happens next:
1. We'll review your application details
2. A specialist will contact you to discuss your funding needs
3. We'll match you with the best lending options available

If you have any questions in the meantime, feel free to reply to this email or call us directly.

Best regards,
{{agent_name}}
SRT Agency
{{agent_phone}}`,
    variables: ["first_name", "business_name", "agent_name", "agent_phone"],
  },
  {
    name: "Contacted Follow-Up SMS",
    slug: "contacted-followup-sms",
    type: "SMS",
    category: "Working - Contacted",
    subject: null,
    body: `Hi {{first_name}}, this is {{agent_name}} from SRT Agency. Great speaking with you about funding for {{business_name}}. As discussed, here are the next steps. Call or text me at {{agent_phone}} if you have questions.`,
    variables: ["first_name", "agent_name", "business_name", "agent_phone"],
  },
  {
    name: "Contacted Follow-Up Email",
    slug: "contacted-followup-email",
    type: "Email",
    category: "Working - Contacted",
    subject: "Next Steps for {{business_name}} — SRT Agency",
    body: `Hi {{first_name}},

Great connecting with you about business funding for {{business_name}}.

As discussed, here are the next steps to move forward:
1. Complete the application if you haven't already
2. Gather your most recent 3 months of bank statements
3. We'll review everything and match you with the best options

If you have any questions, don't hesitate to reach out.

Best,
{{agent_name}}
SRT Agency
{{agent_phone}}`,
    variables: ["first_name", "business_name", "agent_name", "agent_phone"],
  },
  {
    name: "Application Sent SMS",
    slug: "application-sent-sms",
    type: "SMS",
    category: "Working - Application Out",
    subject: null,
    body: `Hi {{first_name}}, we've sent the application for {{business_name}} to your email. Please complete it at your earliest convenience so we can get the ball rolling! — {{agent_name}}, SRT Agency`,
    variables: ["first_name", "business_name", "agent_name"],
  },
  {
    name: "Converted to Active Deal SMS",
    slug: "converted-active-sms",
    type: "SMS",
    category: "Converted",
    subject: null,
    body: `{{first_name}}, your application for {{business_name}} has been moved to our active pipeline! Our team is reviewing your file. We'll keep you updated on every step. — {{agent_name}}, SRT Agency`,
    variables: ["first_name", "business_name", "agent_name"],
  },
  {
    name: "Not Converted Email",
    slug: "not-converted-email",
    type: "Email",
    category: "Closed - Not Converted",
    subject: "Update on Your Funding Application — SRT Agency",
    body: `Hi {{first_name}},

Thank you for your interest in business funding for {{business_name}}.

After reviewing your application, we're unable to move forward with traditional funding options at this time. This could be due to several factors including time in business, revenue requirements, or credit profile.

However, we don't give up easily. Here are some alternatives we can explore:
- Revenue-based financing options
- Merchant cash advance products
- Equipment financing (if applicable)
- Building your business credit profile for future funding

Would you like to discuss any of these options? Just reply to this email or call us.

Best regards,
{{agent_name}}
SRT Agency`,
    variables: ["first_name", "business_name", "agent_name"],
  },

  // === ACTIVE DEALS PIPELINE ===
  {
    name: "Contract In SMS",
    slug: "contract-in-sms",
    type: "SMS",
    category: "Contract In",
    subject: null,
    body: `{{first_name}}, we've received your contracts for {{business_name}}! Our team is reviewing everything now. We'll reach out if we need any additional documentation. — {{agent_name}}, SRT Agency`,
    variables: ["first_name", "business_name", "agent_name"],
  },
  {
    name: "Contract In Email",
    slug: "contract-in-email",
    type: "Email",
    category: "Contract In",
    subject: "Contracts Received — {{business_name}}",
    body: `Hi {{first_name}},

We've received the contracts for {{business_name}}. Our team is now reviewing everything to make sure it's all in order.

Here's what happens next:
1. We'll verify all documentation is complete
2. If any stipulations are needed, we'll reach out right away
3. Once everything is satisfied, we'll schedule your funding call

Thank you for your patience. We're working to get you funded as quickly as possible.

Best,
{{agent_name}}
SRT Agency
{{agent_phone}}`,
    variables: ["first_name", "business_name", "agent_name", "agent_phone"],
  },
  {
    name: "Pending Stips SMS",
    slug: "pending-stips-sms",
    type: "SMS",
    category: "Pending Stips",
    subject: null,
    body: `{{first_name}}, we need a few more documents for {{business_name}} before we can move forward. Check your email for the details. The sooner we get these, the faster we can fund! — {{agent_name}}, SRT Agency`,
    variables: ["first_name", "business_name", "agent_name"],
  },
  {
    name: "Pending Stips Email",
    slug: "pending-stips-email",
    type: "Email",
    category: "Pending Stips",
    subject: "Documents Needed — {{business_name}}",
    body: `Hi {{first_name}},

We're almost there! To continue processing the funding for {{business_name}}, we need the following stipulations satisfied:

Please gather and send these documents as soon as possible. The faster we receive them, the sooner we can get you funded.

You can reply to this email with the documents attached, or call us if you have any questions.

Best,
{{agent_name}}
SRT Agency
{{agent_phone}}`,
    variables: ["first_name", "business_name", "agent_name", "agent_phone"],
  },
  {
    name: "Stips Reminder SMS",
    slug: "stips-reminder-sms",
    type: "SMS",
    category: "Pending Stips",
    subject: null,
    body: `Friendly reminder {{first_name}} — we're still waiting on documents for {{business_name}}. Let's get these wrapped up so we can move to funding! Need help? Call {{agent_phone}}.`,
    variables: ["first_name", "business_name", "agent_phone"],
  },
  {
    name: "Funding Call SMS",
    slug: "funding-call-sms",
    type: "SMS",
    category: "Funding Call",
    subject: null,
    body: `{{first_name}}, your funding call for {{business_name}} is being scheduled! You'll receive a call from the lender to verify your information. Please answer all unfamiliar numbers. — {{agent_name}}, SRT Agency`,
    variables: ["first_name", "business_name", "agent_name"],
  },
  {
    name: "In Funding SMS",
    slug: "in-funding-sms",
    type: "SMS",
    category: "In Funding",
    subject: null,
    body: `Great news {{first_name}}! {{business_name}} is now in the funding process. Funds typically arrive within 24-48 hours. We'll notify you the moment it lands. — {{agent_name}}, SRT Agency`,
    variables: ["first_name", "business_name", "agent_name"],
  },
  {
    name: "In Funding Email",
    slug: "in-funding-email",
    type: "Email",
    category: "In Funding",
    subject: "Funding in Progress — {{business_name}}",
    body: `Hi {{first_name}},

Exciting news — the funding for {{business_name}} is now being processed!

Funds are typically disbursed within 24-48 business hours. You'll receive a notification when the funds hit your account.

If you have any questions during this time, don't hesitate to reach out.

Best,
{{agent_name}}
SRT Agency
{{agent_phone}}`,
    variables: ["first_name", "business_name", "agent_name", "agent_phone"],
  },
  {
    name: "Funded Congratulations SMS",
    slug: "funded-congrats-sms",
    type: "SMS",
    category: "Funded",
    subject: null,
    body: `🎉 Congratulations {{first_name}}! {{business_name}} has been funded! The funds should be in your account. It's been a pleasure working with you. If you ever need anything, don't hesitate to reach out. — {{agent_name}}, SRT Agency`,
    variables: ["first_name", "business_name", "agent_name"],
  },
  {
    name: "Funded Congratulations Email",
    slug: "funded-congrats-email",
    type: "Email",
    category: "Funded",
    subject: "Congratulations — {{business_name}} Has Been Funded!",
    body: `Hi {{first_name}},

Congratulations! The funding for {{business_name}} has been completed and the funds have been disbursed to your account.

**What's Next:**
- Payments will begin according to your contract terms
- Keep our contact info handy — we're always here to help
- When you're ready for additional funding in the future, reach out to us first

It's been a pleasure working with you. We wish {{business_name}} continued success!

If you know any other business owners who could benefit from funding, we'd love a referral.

Best regards,
{{agent_name}}
SRT Agency
{{agent_phone}}
{{agent_email}}`,
    variables: ["first_name", "business_name", "agent_name", "agent_phone", "agent_email"],
  },
];

export async function POST() {
  try {
    // Check if templates already exist
    const { count } = await supabaseAdmin
      .from("message_templates")
      .select("*", { count: "exact", head: true });

    if (count && count > 0) {
      return NextResponse.json({
        message: `${count} templates already exist. Skipping seed.`,
        seeded: 0,
      });
    }

    const { data, error } = await supabaseAdmin
      .from("message_templates")
      .insert(SEED_TEMPLATES)
      .select();

    if (error) throw error;

    return NextResponse.json({
      message: `Seeded ${data?.length || 0} templates successfully.`,
      seeded: data?.length || 0,
    });
  } catch (error) {
    console.error("Template seed error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to seed templates" },
      { status: 500 }
    );
  }
}
