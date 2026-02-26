import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

const SEED_TEMPLATES = [
  // === NEW DEALS PIPELINE ===
  {
    name: "New Lead Welcome SMS",
    slug: "new-lead-welcome-sms",
    type: "SMS",
    category: "New Lead",
    subject: null,
    body: `Hi {{first_name}}, thanks for reaching out to SRT Agency! We specialize in helping businesses like {{business_name}} get the funding they need. One of our specialists will be reaching out shortly. Reply STOP to opt out.`,
    variables: ["first_name", "business_name"],
  },
  {
    name: "New Lead Welcome Email",
    slug: "new-lead-welcome-email",
    type: "Email",
    category: "New Lead",
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
    name: "No Contact Follow-Up SMS",
    slug: "no-contact-followup-sms",
    type: "SMS",
    category: "No Contact",
    subject: null,
    body: `Hi {{first_name}}, this is {{agent_name}} from SRT Agency. We tried reaching you about your funding request for {{business_name}}. When's a good time to connect? Call or text me back at {{agent_phone}}.`,
    variables: ["first_name", "agent_name", "business_name", "agent_phone"],
  },
  {
    name: "No Contact Follow-Up Email",
    slug: "no-contact-followup-email",
    type: "Email",
    category: "No Contact",
    subject: "We Tried Reaching You — SRT Agency",
    body: `Hi {{first_name}},

We've been trying to reach you regarding your business funding inquiry for {{business_name}}.

We'd love to help you explore your options. Please let us know a convenient time to connect, or simply reply to this email.

If you're no longer interested, no worries — just let us know.

Best,
{{agent_name}}
SRT Agency
{{agent_phone}}`,
    variables: ["first_name", "business_name", "agent_name", "agent_phone"],
  },
  {
    name: "Interested — Next Steps SMS",
    slug: "interested-next-steps-sms",
    type: "SMS",
    category: "Interested",
    subject: null,
    body: `Great news {{first_name}}! To move forward with funding for {{business_name}}, we'll need a few documents. Check your email for the full list. Any questions, text me here. — {{agent_name}}, SRT Agency`,
    variables: ["first_name", "business_name", "agent_name"],
  },
  {
    name: "Converted to Active Deal SMS",
    slug: "converted-active-sms",
    type: "SMS",
    category: "Converted",
    subject: null,
    body: `{{first_name}}, your application for {{business_name}} has been moved to our active pipeline! Our underwriting team is reviewing your file. We'll keep you updated on every step. — {{agent_name}}, SRT Agency`,
    variables: ["first_name", "business_name", "agent_name"],
  },
  {
    name: "DNQ Notification Email",
    slug: "dnq-notification-email",
    type: "Email",
    category: "DNQ",
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
    name: "Pre-Approval Congrats SMS",
    slug: "pre-approval-congrats-sms",
    type: "SMS",
    category: "Pre-Approval",
    subject: null,
    body: `Exciting news {{first_name}}! {{business_name}} has been pre-approved for funding. We're preparing your file for underwriting. I'll be in touch with next steps. — {{agent_name}}, SRT Agency`,
    variables: ["first_name", "business_name", "agent_name"],
  },
  {
    name: "Pre-Approval Email",
    slug: "pre-approval-email",
    type: "Email",
    category: "Pre-Approval",
    subject: "Pre-Approval Confirmation — {{business_name}}",
    body: `Hi {{first_name}},

Great news — {{business_name}} has been pre-approved for business funding!

Your file is now being prepared for our underwriting team. Here's what to expect:

1. **Underwriting Review** — Our team will review your complete application
2. **Lender Matching** — We'll match you with the best lender options
3. **Approval & Terms** — You'll receive specific approval amounts and terms

To keep things moving quickly, please ensure all requested documents have been submitted. If anything is missing, we'll reach out right away.

Thank you for choosing SRT Agency!

Best,
{{agent_name}}
{{agent_phone}}`,
    variables: ["first_name", "business_name", "agent_name", "agent_phone"],
  },
  {
    name: "Submitted to Lenders SMS",
    slug: "submitted-lenders-sms",
    type: "SMS",
    category: "Submitted",
    subject: null,
    body: `Update on {{business_name}}: Your application has been submitted to our lending partners! We typically hear back within 24-48 hours. I'll reach out as soon as we have a decision. — {{agent_name}}, SRT Agency`,
    variables: ["business_name", "agent_name"],
  },
  {
    name: "Submitted to Lenders Email",
    slug: "submitted-lenders-email",
    type: "Email",
    category: "Submitted",
    subject: "Your Application Has Been Submitted — {{business_name}}",
    body: `Hi {{first_name}},

Your funding application for {{business_name}} has been submitted to our lending partners.

**What happens now:**
- Lenders will review your application (typically 24-48 hours)
- You may receive verification calls — please answer unfamiliar numbers
- We'll notify you immediately once we have a decision

**Important:** Please avoid applying for additional credit during this time, as it can impact your approval.

We're working hard to get you the best possible terms. Hang tight!

Best,
{{agent_name}}
SRT Agency
{{agent_phone}}`,
    variables: ["first_name", "business_name", "agent_name", "agent_phone"],
  },
  {
    name: "Approved SMS",
    slug: "approved-sms",
    type: "SMS",
    category: "Approved",
    subject: null,
    body: `🎉 {{first_name}}, {{business_name}} has been APPROVED for {{approved_amount}} with {{approved_lender}}! Check your email for the full details and next steps. — {{agent_name}}, SRT Agency`,
    variables: ["first_name", "business_name", "approved_amount", "approved_lender", "agent_name"],
  },
  {
    name: "Approved Email",
    slug: "approved-email",
    type: "Email",
    category: "Approved",
    subject: "APPROVED — {{business_name}} Funding Approval",
    body: `Hi {{first_name}},

Congratulations! {{business_name}} has been approved for business funding!

**Approval Details:**
- **Amount:** {{approved_amount}}
- **Lender:** {{approved_lender}}

**Next Steps:**
1. Review the approval terms carefully
2. We'll send over the contracts for your signature
3. Once signed, funding is typically disbursed within 24-48 hours

If you have any questions about the terms, don't hesitate to reach out. We're here to make sure you're comfortable with everything.

Congratulations again!

Best,
{{agent_name}}
SRT Agency
{{agent_phone}}`,
    variables: ["first_name", "business_name", "approved_amount", "approved_lender", "agent_name", "agent_phone"],
  },
  {
    name: "Contracts Out SMS",
    slug: "contracts-out-sms",
    type: "SMS",
    category: "Contracts Out",
    subject: null,
    body: `{{first_name}}, the contracts for {{business_name}} are ready for signature! Check your email for signing instructions. Please complete ASAP to avoid delays. Questions? Call me at {{agent_phone}}. — {{agent_name}}`,
    variables: ["first_name", "business_name", "agent_phone", "agent_name"],
  },
  {
    name: "Contracts Reminder SMS",
    slug: "contracts-reminder-sms",
    type: "SMS",
    category: "Contracts Out",
    subject: null,
    body: `Friendly reminder {{first_name}} — your funding contracts for {{business_name}} are still waiting for your signature. Let's get this wrapped up so we can get you funded! Need help? Call {{agent_phone}}.`,
    variables: ["first_name", "business_name", "agent_phone"],
  },
  {
    name: "Contracts In — Funding Soon SMS",
    slug: "contracts-in-sms",
    type: "SMS",
    category: "Contracts In",
    subject: null,
    body: `{{first_name}}, we've received your signed contracts for {{business_name}}! Funding is being processed and typically takes 24-48 hours. We'll notify you the moment it hits your account. — {{agent_name}}, SRT Agency`,
    variables: ["first_name", "business_name", "agent_name"],
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

If you know any other business owners who could benefit from funding, we'd love a referral. 😊

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
