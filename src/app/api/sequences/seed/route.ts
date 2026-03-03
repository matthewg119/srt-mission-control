import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

/**
 * Seeds all 4 email sequences with their steps.
 * Safe to call multiple times — uses upsert on slug.
 */
export async function POST() {
  try {
    const results: Record<string, unknown>[] = [];

    for (const seq of SEQUENCES) {
      // Upsert the sequence
      const { data: sequence, error: seqError } = await supabaseAdmin
        .from("email_sequences")
        .upsert(
          {
            name: seq.name,
            slug: seq.slug,
            trigger_tag: seq.trigger_tag,
            cancel_tag: seq.cancel_tag,
            is_active: true,
          },
          { onConflict: "slug" }
        )
        .select()
        .single();

      if (seqError || !sequence) {
        results.push({ slug: seq.slug, error: seqError?.message || "Failed to create" });
        continue;
      }

      // Delete existing steps and re-insert
      await supabaseAdmin
        .from("email_sequence_steps")
        .delete()
        .eq("sequence_id", sequence.id);

      const stepRows = seq.steps.map((step, i) => ({
        sequence_id: sequence.id,
        step_number: i + 1,
        delay_minutes: step.delay_minutes,
        subject: step.subject,
        body: step.body,
      }));

      const { error: stepsError } = await supabaseAdmin
        .from("email_sequence_steps")
        .insert(stepRows);

      results.push({
        slug: seq.slug,
        id: sequence.id,
        steps: stepRows.length,
        error: stepsError?.message,
      });
    }

    return NextResponse.json({
      message: "Sequences seeded",
      results,
      total_sequences: SEQUENCES.length,
      total_emails: SEQUENCES.reduce((sum, s) => sum + s.steps.length, 0),
    });
  } catch (error) {
    console.error("Sequence seed error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Seed failed" },
      { status: 500 }
    );
  }
}

// ── Sequence Definitions ──

interface SequenceStep {
  delay_minutes: number;
  subject: string;
  body: string;
}

interface SequenceDefinition {
  name: string;
  slug: string;
  trigger_tag: string | null;
  cancel_tag: string | null;
  steps: SequenceStep[];
}

const MINUTES = 1;
const HOURS = 60;
const DAYS = 60 * 24;

const SEQUENCES: SequenceDefinition[] = [
  // ═══════════════════════════════════════════════════════════
  // SEQUENCE 1: Website Lead Nurture (20 emails)
  // Trigger: website-lead tag | No cancel tag
  // ═══════════════════════════════════════════════════════════
  {
    name: "Website Lead Nurture",
    slug: "website-lead-nurture",
    trigger_tag: "website-lead",
    cancel_tag: null,
    steps: [
      {
        delay_minutes: 1 * DAYS,
        subject: "Welcome to SRT Agency — Here's What We Do",
        body: `<p>Hi {{first_name}},</p>
<p>Thanks for reaching out to SRT Agency! We help business owners like you access the funding they need to grow.</p>
<p>Whether you need working capital, equipment financing, or an expansion loan — we work with 75+ lenders to find the best fit for your business.</p>
<p><strong>Here's what makes us different:</strong></p>
<ul>
<li>No hard credit pull to get started</li>
<li>Approval in as fast as 24 hours</li>
<li>Funding from $10K to $5M+</li>
</ul>
<p>Ready to see what you qualify for? <a href="https://srtagency.com/apply">Start your application here</a> — it takes less than 5 minutes.</p>
<p>Best,<br>The SRT Agency Team</p>`,
      },
      {
        delay_minutes: 3 * DAYS,
        subject: "How Business Funding Actually Works (Quick Guide)",
        body: `<p>Hi {{first_name}},</p>
<p>A lot of business owners think getting funding means going to a bank and waiting weeks. That's the old way.</p>
<p><strong>Here's how it works with SRT Agency:</strong></p>
<ol>
<li><strong>Apply online</strong> — 5-minute application, no hard credit pull</li>
<li><strong>We match you</strong> — Our team reviews your profile against 75+ lenders</li>
<li><strong>Get offers</strong> — Compare terms and pick what works for you</li>
<li><strong>Get funded</strong> — Money in your account, often within 24-48 hours</li>
</ol>
<p>No obligation, no pressure. Just options.</p>
<p><a href="https://srtagency.com/apply">See what you qualify for →</a></p>
<p>— SRT Agency</p>`,
      },
      {
        delay_minutes: 5 * DAYS,
        subject: "What Type of Funding Is Right for Your Business?",
        body: `<p>Hi {{first_name}},</p>
<p>Not all business funding is the same. Here's a quick breakdown of what's available:</p>
<ul>
<li><strong>Term Loans</strong> — Fixed payments, great for planned investments</li>
<li><strong>Revenue-Based Financing</strong> — Payments flex with your sales</li>
<li><strong>Equipment Financing</strong> — Fund specific purchases, use equipment as collateral</li>
<li><strong>Lines of Credit</strong> — Draw funds as needed, only pay on what you use</li>
<li><strong>SBA Loans</strong> — Government-backed, lowest rates (longer process)</li>
</ul>
<p>Not sure which is right for you? That's exactly what we help with. <a href="https://srtagency.com/apply">Apply and we'll match you</a>.</p>
<p>— SRT Agency</p>`,
      },
      {
        delay_minutes: 7 * DAYS,
        subject: "Real Talk: What Lenders Actually Look At",
        body: `<p>Hi {{first_name}},</p>
<p>Wondering if you'll qualify? Here's what lenders actually care about:</p>
<ul>
<li><strong>Monthly revenue</strong> — Most lenders want $10K+/month</li>
<li><strong>Time in business</strong> — 6+ months for most options, 2+ years for the best rates</li>
<li><strong>Credit score</strong> — Matters less than you think. We have options for 500+</li>
<li><strong>Bank statements</strong> — Shows cash flow health (this is the big one)</li>
</ul>
<p><strong>The #1 mistake?</strong> Assuming you won't qualify. Many business owners are surprised at what's available to them.</p>
<p><a href="https://srtagency.com/apply">Find out in 5 minutes →</a></p>
<p>— SRT Agency</p>`,
      },
      {
        delay_minutes: 10 * DAYS,
        subject: "5 Ways Business Owners Use Funding to Grow",
        body: `<p>Hi {{first_name}},</p>
<p>Our clients use funding for all kinds of growth moves:</p>
<ol>
<li><strong>Inventory stocking</strong> — Buy in bulk, negotiate better prices</li>
<li><strong>Hiring</strong> — Bring on the team you need to scale</li>
<li><strong>Marketing</strong> — Invest in ads, campaigns, and brand building</li>
<li><strong>Equipment</strong> — Upgrade your tools and increase capacity</li>
<li><strong>Cash flow smoothing</strong> — Bridge gaps between invoices and expenses</li>
</ol>
<p>What would you do with an extra $50K–$500K in your business?</p>
<p><a href="https://srtagency.com/apply">Let's find out what you qualify for →</a></p>
<p>— SRT Agency</p>`,
      },
      {
        delay_minutes: 13 * DAYS,
        subject: "The Cost of Waiting (Real Numbers)",
        body: `<p>Hi {{first_name}},</p>
<p>Every month you wait to fund your growth costs you money. Here's the math:</p>
<p>If funding helps you generate even 10% more revenue per month, and your business does $50K/mo — that's <strong>$5,000/month</strong> in growth you're leaving on the table.</p>
<p>Over 6 months of waiting? That's $30,000 in missed opportunity.</p>
<p>The application takes 5 minutes. The approval can happen in 24 hours. The funding can hit your account in 48 hours.</p>
<p><a href="https://srtagency.com/apply">Start now — no obligation →</a></p>
<p>— SRT Agency</p>`,
      },
      {
        delay_minutes: 16 * DAYS,
        subject: "Common Funding Myths (Busted)",
        body: `<p>Hi {{first_name}},</p>
<p>Let's clear up some myths we hear every day:</p>
<p><strong>❌ "I need perfect credit"</strong><br>Nope. We work with scores as low as 500.</p>
<p><strong>❌ "I need to put up collateral"</strong><br>Most of our products are unsecured.</p>
<p><strong>❌ "It takes weeks to get approved"</strong><br>Most approvals happen within 24 hours.</p>
<p><strong>❌ "Banks are the only option"</strong><br>We work with 75+ alternative lenders with better approval rates.</p>
<p><strong>❌ "Applying hurts my credit"</strong><br>Our initial review is a soft pull only.</p>
<p><a href="https://srtagency.com/apply">See the truth for yourself →</a></p>
<p>— SRT Agency</p>`,
      },
      {
        delay_minutes: 19 * DAYS,
        subject: "Quick Question, {{first_name}}",
        body: `<p>Hi {{first_name}},</p>
<p>I wanted to check in — is business funding something you're still exploring?</p>
<p>If you have any questions at all, just reply to this email. Our team is here to help, no strings attached.</p>
<p>If the timing isn't right, that's totally fine too. We'll be here when you're ready.</p>
<p>— The SRT Agency Team</p>`,
      },
      {
        delay_minutes: 22 * DAYS,
        subject: "How {{first_name}}'s Competitors Are Getting Ahead",
        body: `<p>Hi {{first_name}},</p>
<p>Here's something to think about: your competitors are investing in growth right now.</p>
<p>They're using business funding to:</p>
<ul>
<li>Outspend you on marketing</li>
<li>Hire faster</li>
<li>Stock more inventory</li>
<li>Upgrade their equipment</li>
</ul>
<p>You don't need to fall behind. A 5-minute application could change the trajectory of your business.</p>
<p><a href="https://srtagency.com/apply">Level the playing field →</a></p>
<p>— SRT Agency</p>`,
      },
      {
        delay_minutes: 25 * DAYS,
        subject: "What $50K Could Do for Your Business",
        body: `<p>Hi {{first_name}},</p>
<p>Imagine having an extra $50,000 in your business account tomorrow. What would you do with it?</p>
<ul>
<li>Launch that marketing campaign you've been planning?</li>
<li>Hire the team member you desperately need?</li>
<li>Buy inventory at bulk pricing?</li>
<li>Finally upgrade your equipment?</li>
</ul>
<p>$50K is on the lower end of what our clients typically qualify for. Many get approved for $100K–$500K+.</p>
<p><a href="https://srtagency.com/apply">Find out your number →</a></p>
<p>— SRT Agency</p>`,
      },
      {
        delay_minutes: 28 * DAYS,
        subject: "Revenue-Based Financing: The Smart Alternative",
        body: `<p>Hi {{first_name}},</p>
<p>If traditional loans feel too rigid, revenue-based financing might be perfect for you.</p>
<p><strong>How it works:</strong></p>
<ul>
<li>You receive a lump sum of capital</li>
<li>Repayment is a small % of your daily/weekly revenue</li>
<li>Slow month? Lower payments. Big month? Pay it off faster</li>
<li>No fixed monthly payment stress</li>
</ul>
<p>It's the most flexible funding option for businesses with consistent revenue.</p>
<p><a href="https://srtagency.com/apply">See if you qualify →</a></p>
<p>— SRT Agency</p>`,
      },
      {
        delay_minutes: 31 * DAYS,
        subject: "Month-End Special: Priority Review for New Applications",
        body: `<p>Hi {{first_name}},</p>
<p>We're prioritizing new applications this week. If you apply now, our team will personally review your file within 24 hours and get you matched with the best lender options available.</p>
<p><strong>What you need to apply:</strong></p>
<ul>
<li>Business name and contact info</li>
<li>Approximate monthly revenue</li>
<li>How much funding you need</li>
</ul>
<p>That's it. No documents needed upfront. No hard credit pull.</p>
<p><a href="https://srtagency.com/apply">Get your priority review →</a></p>
<p>— SRT Agency</p>`,
      },
      {
        delay_minutes: 34 * DAYS,
        subject: "The One Thing Holding Most Business Owners Back",
        body: `<p>Hi {{first_name}},</p>
<p>After helping hundreds of business owners get funded, we've noticed one thing that holds most people back:</p>
<p><strong>They don't think they'll qualify.</strong></p>
<p>The truth? 73% of our applicants get at least one offer. And many who thought they'd get rejected end up qualifying for more than they expected.</p>
<p>The only way to know is to apply. It's free, takes 5 minutes, and doesn't affect your credit.</p>
<p><a href="https://srtagency.com/apply">What do you have to lose? →</a></p>
<p>— SRT Agency</p>`,
      },
      {
        delay_minutes: 37 * DAYS,
        subject: "New Lender Partners = More Options for You",
        body: `<p>Hi {{first_name}},</p>
<p>We recently added several new lending partners to our network, which means more options and better terms for our clients.</p>
<p><strong>New options include:</strong></p>
<ul>
<li>Lower minimum credit score requirements</li>
<li>Higher funding amounts (up to $5M)</li>
<li>Longer repayment terms</li>
<li>Industry-specific programs</li>
</ul>
<p>Even if you checked before and didn't see the right fit — it's worth looking again.</p>
<p><a href="https://srtagency.com/apply">Explore new options →</a></p>
<p>— SRT Agency</p>`,
      },
      {
        delay_minutes: 40 * DAYS,
        subject: "Tax Season Tip: Use Funding Strategically",
        body: `<p>Hi {{first_name}},</p>
<p>Quick tax tip: many business funding costs are tax-deductible as business expenses. This means the effective cost of your funding could be lower than you think.</p>
<p>Smart business owners use funding to:</p>
<ul>
<li>Invest in deductible expenses before year-end</li>
<li>Smooth cash flow during tax payment periods</li>
<li>Fund growth that generates more revenue (and deductions)</li>
</ul>
<p><em>(Always consult your accountant for specific tax advice.)</em></p>
<p><a href="https://srtagency.com/apply">Plan your funding strategy →</a></p>
<p>— SRT Agency</p>`,
      },
      {
        delay_minutes: 43 * DAYS,
        subject: "Still Thinking About Funding, {{first_name}}?",
        body: `<p>Hi {{first_name}},</p>
<p>I notice you haven't started an application yet, and that's completely fine. Everyone moves at their own pace.</p>
<p>But I want to make sure you know: there's zero risk in applying. Here's our guarantee:</p>
<ul>
<li>✅ No hard credit pull</li>
<li>✅ No obligation to accept any offer</li>
<li>✅ No fees unless you choose to move forward</li>
<li>✅ 5 minutes of your time, max</li>
</ul>
<p>If you have questions first, just reply to this email. We're happy to chat.</p>
<p><a href="https://srtagency.com/apply">Apply risk-free →</a></p>
<p>— SRT Agency</p>`,
      },
      {
        delay_minutes: 46 * DAYS,
        subject: "Lines of Credit: Your Business Safety Net",
        body: `<p>Hi {{first_name}},</p>
<p>A business line of credit is like having a safety net for your company. Here's why smart business owners get one even when they don't "need" funding:</p>
<ul>
<li><strong>Only pay on what you use</strong> — Draw funds as needed</li>
<li><strong>Emergency buffer</strong> — Unexpected expenses won't derail you</li>
<li><strong>Opportunity fund</strong> — Jump on deals when they appear</li>
<li><strong>Builds business credit</strong> — Responsible use improves your profile</li>
</ul>
<p>Lines from $10K–$250K are available. <a href="https://srtagency.com/apply">See what you qualify for →</a></p>
<p>— SRT Agency</p>`,
      },
      {
        delay_minutes: 49 * DAYS,
        subject: "Your Personalized Funding Estimate",
        body: `<p>Hi {{first_name}},</p>
<p>Based on what we typically see for businesses like yours, here's a rough idea of what might be available:</p>
<table style="border-collapse:collapse;width:100%">
<tr style="background:#0B1426;color:white"><th style="padding:8px;text-align:left">Monthly Revenue</th><th style="padding:8px;text-align:left">Typical Funding Range</th></tr>
<tr><td style="padding:8px;border:1px solid #ddd">$10K–$25K</td><td style="padding:8px;border:1px solid #ddd">$15K–$75K</td></tr>
<tr><td style="padding:8px;border:1px solid #ddd">$25K–$50K</td><td style="padding:8px;border:1px solid #ddd">$50K–$200K</td></tr>
<tr><td style="padding:8px;border:1px solid #ddd">$50K–$100K</td><td style="padding:8px;border:1px solid #ddd">$100K–$500K</td></tr>
<tr><td style="padding:8px;border:1px solid #ddd">$100K+</td><td style="padding:8px;border:1px solid #ddd">$250K–$5M+</td></tr>
</table>
<p>Want to know your exact number? <a href="https://srtagency.com/apply">Apply now — it's free →</a></p>
<p>— SRT Agency</p>`,
      },
      {
        delay_minutes: 52 * DAYS,
        subject: "Last Chance: Free Funding Consultation",
        body: `<p>Hi {{first_name}},</p>
<p>I wanted to extend a personal offer: a <strong>free, no-obligation funding consultation</strong> with our team.</p>
<p>In 15 minutes, we'll:</p>
<ul>
<li>Review your business situation</li>
<li>Identify the best funding options for you</li>
<li>Give you a realistic expectation of amounts and terms</li>
<li>Answer any questions you have</li>
</ul>
<p>No sales pitch. Just honest advice from people who do this every day.</p>
<p>Reply to this email or <a href="https://srtagency.com/apply">start your application</a> and we'll call you within 24 hours.</p>
<p>— SRT Agency</p>`,
      },
      {
        delay_minutes: 55 * DAYS,
        subject: "We're Still Here When You're Ready",
        body: `<p>Hi {{first_name}},</p>
<p>This is our last scheduled email, but we're not going anywhere.</p>
<p>Whenever you're ready to explore business funding — whether that's tomorrow or six months from now — SRT Agency will be here to help.</p>
<p><strong>Bookmark this for later:</strong> <a href="https://srtagency.com/apply">srtagency.com/apply</a></p>
<p>If you ever have a question, just reply to any of our emails. A real person will get back to you.</p>
<p>Wishing you and your business all the best,<br>The SRT Agency Team</p>`,
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // SEQUENCE 2: Application Completed Nurture (20 emails)
  // Trigger: application tag | No cancel tag
  // ═══════════════════════════════════════════════════════════
  {
    name: "Application Completed Nurture",
    slug: "application-completed-nurture",
    trigger_tag: "application-completed",
    cancel_tag: null,
    steps: [
      {
        delay_minutes: 5 * MINUTES,
        subject: "Application Received — Here's What Happens Next",
        body: `<p>Hi {{first_name}},</p>
<p>Thank you for submitting your business funding application with SRT Agency! We've received everything and your file is now being reviewed.</p>
<p><strong>What happens next:</strong></p>
<ol>
<li><strong>Review</strong> — Our team reviews your application (typically within a few hours)</li>
<li><strong>Matching</strong> — We match your profile with our 75+ lending partners</li>
<li><strong>Offers</strong> — You'll receive your funding options</li>
<li><strong>Funding</strong> — Once you accept, funds are typically deposited in 24-48 hours</li>
</ol>
<p>In the meantime, having your <strong>last 3 months of bank statements</strong> ready will speed things up significantly.</p>
<p>We'll be in touch soon!</p>
<p>— The SRT Agency Team</p>`,
      },
      {
        delay_minutes: 3 * DAYS,
        subject: "Your Application Update + Document Checklist",
        body: `<p>Hi {{first_name}},</p>
<p>Your application is being matched with our lending partners. To speed up your approval, please have these documents ready:</p>
<p><strong>Required:</strong></p>
<ul>
<li>✅ Last 3 months of business bank statements (PDF)</li>
</ul>
<p><strong>Helpful (if available):</strong></p>
<ul>
<li>Business tax returns (most recent year)</li>
<li>Profit & loss statement</li>
<li>Business license or articles of incorporation</li>
</ul>
<p>You can reply to this email with any documents, or we'll request them when it's time.</p>
<p>— SRT Agency</p>`,
      },
      {
        delay_minutes: 5 * DAYS,
        subject: "Quick Tip: How to Get the Best Funding Terms",
        body: `<p>Hi {{first_name}},</p>
<p>While your application is being processed, here are some tips to maximize your funding terms:</p>
<ol>
<li><strong>Keep your bank balance healthy</strong> — Lenders look at your average daily balance</li>
<li><strong>Minimize NSF/overdraft fees</strong> — These are red flags for lenders</li>
<li><strong>Have consistent deposits</strong> — Regular revenue patterns look great</li>
<li><strong>Prepare your documents early</strong> — Fast responses lead to faster funding</li>
</ol>
<p>Questions? Just reply to this email.</p>
<p>— SRT Agency</p>`,
      },
      {
        delay_minutes: 7 * DAYS,
        subject: "What Our Clients Say About Working With Us",
        body: `<p>Hi {{first_name}},</p>
<p>We know trust matters when it comes to business funding. Here's what some of our recent clients have to say:</p>
<blockquote style="border-left:3px solid #00C9A7;padding-left:12px;margin:12px 0">
<p>"SRT Agency got me funded in 48 hours when my bank said it would take 6 weeks. Game changer for my business."</p>
</blockquote>
<blockquote style="border-left:3px solid #00C9A7;padding-left:12px;margin:12px 0">
<p>"I was nervous about the process, but the team walked me through everything. No surprises, no hidden fees."</p>
</blockquote>
<blockquote style="border-left:3px solid #00C9A7;padding-left:12px;margin:12px 0">
<p>"I didn't think I'd qualify with my credit score, but they found me three different options. Highly recommend."</p>
</blockquote>
<p>Your application is in good hands. We'll be in touch with updates soon.</p>
<p>— SRT Agency</p>`,
      },
      {
        delay_minutes: 10 * DAYS,
        subject: "Have Your Bank Statements Ready?",
        body: `<p>Hi {{first_name}},</p>
<p>A quick reminder — the fastest way to move your application forward is to have your <strong>last 3 months of business bank statements</strong> ready.</p>
<p><strong>How to get them:</strong></p>
<ul>
<li>Log into your online banking</li>
<li>Go to Statements or Documents</li>
<li>Download the last 3 months as PDF</li>
</ul>
<p>You can reply to this email with them attached, and we'll add them to your file.</p>
<p>— SRT Agency</p>`,
      },
      {
        delay_minutes: 13 * DAYS,
        subject: "Understanding Your Funding Offers",
        body: `<p>Hi {{first_name}},</p>
<p>When you receive your funding offers, here's how to evaluate them:</p>
<ul>
<li><strong>Factor rate vs. APR</strong> — Factor rates (1.1–1.5) are common for short-term; APR for term loans</li>
<li><strong>Payment frequency</strong> — Daily, weekly, or monthly? Pick what matches your cash flow</li>
<li><strong>Term length</strong> — Shorter terms = higher payments but less total cost</li>
<li><strong>Prepayment penalty</strong> — Some lenders let you save by paying early</li>
<li><strong>Total cost of capital</strong> — This is the real number to compare</li>
</ul>
<p>We'll walk you through every offer and help you pick the best option. No pressure, ever.</p>
<p>— SRT Agency</p>`,
      },
      {
        delay_minutes: 16 * DAYS,
        subject: "Application Status Check-In",
        body: `<p>Hi {{first_name}},</p>
<p>Just checking in on your application. Here's where things stand:</p>
<p>If you've already been in contact with our team — great! We're working on getting you the best options.</p>
<p>If you haven't heard from us yet, it might be because we need additional information. Please reply to this email or give us a call so we can move things forward.</p>
<p>We want to make sure your application doesn't stall — your business growth shouldn't have to wait.</p>
<p>— SRT Agency</p>`,
      },
      {
        delay_minutes: 19 * DAYS,
        subject: "Multiple Offers? Here's How to Choose",
        body: `<p>Hi {{first_name}},</p>
<p>Many of our clients receive 2-4 different funding offers. That's a good problem to have! Here's our framework for choosing:</p>
<ol>
<li><strong>Total cost</strong> — What's the total you'll repay? Lower is better</li>
<li><strong>Cash flow fit</strong> — Can your business comfortably handle the payments?</li>
<li><strong>Speed</strong> — How fast do you need the money?</li>
<li><strong>Flexibility</strong> — Can you prepay? Refinance later?</li>
</ol>
<p>We're here to help you compare. Don't make this decision alone — reply and we'll walk through your options together.</p>
<p>— SRT Agency</p>`,
      },
      {
        delay_minutes: 22 * DAYS,
        subject: "The #1 Thing That Delays Funding",
        body: `<p>Hi {{first_name}},</p>
<p>Want to know what delays most funding applications? <strong>Missing or incomplete bank statements.</strong></p>
<p>Lenders need to see your cash flow, and they won't make offers without it. If you haven't sent yours yet, now is the time.</p>
<p><strong>What we need:</strong></p>
<ul>
<li>Last 3 months of business bank statements</li>
<li>PDF format (downloaded from your bank's website)</li>
<li>All pages included (don't skip any)</li>
</ul>
<p>Reply with your statements and we'll fast-track your review.</p>
<p>— SRT Agency</p>`,
      },
      {
        delay_minutes: 25 * DAYS,
        subject: "Funding Timeline: What to Expect This Week",
        body: `<p>Hi {{first_name}},</p>
<p>Here's a realistic timeline for the funding process:</p>
<table style="border-collapse:collapse;width:100%">
<tr style="background:#1B65A7;color:white"><th style="padding:8px">Step</th><th style="padding:8px">Timeline</th></tr>
<tr><td style="padding:8px;border:1px solid #ddd">Application review</td><td style="padding:8px;border:1px solid #ddd">Same day</td></tr>
<tr><td style="padding:8px;border:1px solid #ddd">Bank statement review</td><td style="padding:8px;border:1px solid #ddd">24 hours</td></tr>
<tr><td style="padding:8px;border:1px solid #ddd">Lender offers</td><td style="padding:8px;border:1px solid #ddd">24-48 hours</td></tr>
<tr><td style="padding:8px;border:1px solid #ddd">Contract signing</td><td style="padding:8px;border:1px solid #ddd">Same day as acceptance</td></tr>
<tr><td style="padding:8px;border:1px solid #ddd">Funding</td><td style="padding:8px;border:1px solid #ddd">24-48 hours after signing</td></tr>
</table>
<p>The clock starts when we have your bank statements. Let's get moving!</p>
<p>— SRT Agency</p>`,
      },
      {
        delay_minutes: 28 * DAYS,
        subject: "Did You Know? You Can Stack Funding",
        body: `<p>Hi {{first_name}},</p>
<p>Here's something most business owners don't know: you can often combine multiple funding products for maximum capital.</p>
<p><strong>Common stacking strategies:</strong></p>
<ul>
<li>Term loan + line of credit (stability + flexibility)</li>
<li>Revenue advance + equipment financing (working capital + assets)</li>
<li>SBA loan + bridge funding (long-term + immediate needs)</li>
</ul>
<p>If your initial funding amount isn't enough, ask us about stacking options.</p>
<p>— SRT Agency</p>`,
      },
      {
        delay_minutes: 31 * DAYS,
        subject: "Quick Check: Do You Have Questions?",
        body: `<p>Hi {{first_name}},</p>
<p>It's been a few weeks since you applied. I want to make sure nothing is holding you back.</p>
<p><strong>Common questions we get:</strong></p>
<ul>
<li>"Will this affect my credit?" — No. We do a soft pull only</li>
<li>"What if I don't like the offers?" — No obligation. Walk away at any time</li>
<li>"How much does this cost me?" — Our service is free to you. Lenders pay us</li>
<li>"Can I still qualify with [X issue]?" — Usually yes. Let's talk about it</li>
</ul>
<p>Reply with any questions. We're here to help.</p>
<p>— SRT Agency</p>`,
      },
      {
        delay_minutes: 34 * DAYS,
        subject: "Renewing Funding: Plan for the Future",
        body: `<p>Hi {{first_name}},</p>
<p>Here's something to keep in mind: once you successfully repay your first round of funding, you become eligible for <strong>better terms and higher amounts</strong> on round two.</p>
<p>Many of our clients use a strategy called "renewal stacking":</p>
<ol>
<li>Get initial funding</li>
<li>Use it to grow revenue</li>
<li>Repay (or get 50%+ through repayment)</li>
<li>Renew for a larger amount at better terms</li>
</ol>
<p>It's a growth flywheel. And it starts with your first approval.</p>
<p>— SRT Agency</p>`,
      },
      {
        delay_minutes: 37 * DAYS,
        subject: "Your Application Is Still Active",
        body: `<p>Hi {{first_name}},</p>
<p>Just a heads up — your application with SRT Agency is still active and ready to be processed.</p>
<p>If life got busy (we get it), here's all you need to do to pick back up:</p>
<ol>
<li>Reply to this email</li>
<li>Attach your last 3 months of bank statements</li>
<li>We'll take it from there</li>
</ol>
<p>That's it. No need to re-apply. We have your info on file.</p>
<p>— SRT Agency</p>`,
      },
      {
        delay_minutes: 40 * DAYS,
        subject: "Business Growth Doesn't Wait",
        body: `<p>Hi {{first_name}},</p>
<p>Every day that passes is a day your competitors might be investing in their growth while you're still thinking about it.</p>
<p>We've helped businesses just like yours get funded quickly and painlessly. The process is simple, the risk is zero (no obligation to accept any offer), and the upside is unlimited.</p>
<p>Reply to this email or call us to get your application moving. Your business deserves it.</p>
<p>— SRT Agency</p>`,
      },
      {
        delay_minutes: 43 * DAYS,
        subject: "New Funding Programs Available",
        body: `<p>Hi {{first_name}},</p>
<p>We've recently added new funding programs that might be a great fit for your business:</p>
<ul>
<li><strong>Startup Friendly</strong> — Options for businesses with as little as 3 months in operation</li>
<li><strong>High-Ticket</strong> — Funding up to $5M for established businesses</li>
<li><strong>Same-Day Funding</strong> — Emergency capital when you need it NOW</li>
<li><strong>Equipment Lease-to-Own</strong> — Get the equipment, own it at the end</li>
</ul>
<p>Want to explore these options? Just reply and we'll match your profile.</p>
<p>— SRT Agency</p>`,
      },
      {
        delay_minutes: 46 * DAYS,
        subject: "Success Story: From Application to Funded in 3 Days",
        body: `<p>Hi {{first_name}},</p>
<p>Here's a recent success story from one of our clients:</p>
<p><strong>The situation:</strong> Restaurant owner needed $75K for kitchen renovation<br>
<strong>The challenge:</strong> Bank said no due to short time in business<br>
<strong>Our solution:</strong> Revenue-based advance approved in 24 hours<br>
<strong>The result:</strong> $75K funded in 3 days, renovation completed, revenue up 40%</p>
<p>Every business has a story. Let us help write yours.</p>
<p>Reply to get started, or call us anytime.</p>
<p>— SRT Agency</p>`,
      },
      {
        delay_minutes: 49 * DAYS,
        subject: "Final Offer: Priority Processing",
        body: `<p>Hi {{first_name}},</p>
<p>We want to make sure your application gets the attention it deserves. As a special courtesy, we're offering <strong>priority processing</strong> for your file.</p>
<p>What this means:</p>
<ul>
<li>Dedicated review by a senior team member</li>
<li>Expedited lender matching (top 3 options)</li>
<li>24-hour turnaround on offers</li>
</ul>
<p>All we need from you: reply with your bank statements and we'll prioritize your file immediately.</p>
<p>— SRT Agency</p>`,
      },
      {
        delay_minutes: 52 * DAYS,
        subject: "We're Still Here for You",
        body: `<p>Hi {{first_name}},</p>
<p>This is our last scheduled check-in, but your application remains on file and ready to go whenever you are.</p>
<p><strong>To restart your application at any time:</strong></p>
<ul>
<li>Reply to any of our emails</li>
<li>Visit <a href="https://srtagency.com/apply">srtagency.com/apply</a></li>
<li>Or just send us your bank statements</li>
</ul>
<p>No pressure, no judgment. Business funding is a big decision and we respect your timeline.</p>
<p>We're rooting for your success, {{first_name}}.</p>
<p>— The SRT Agency Team</p>`,
      },
      {
        delay_minutes: 55 * DAYS,
        subject: "One More Thing, {{first_name}}...",
        body: `<p>Hi {{first_name}},</p>
<p>We appreciate you trusting SRT Agency with your business funding application. Even though this is our last email in this series, our door is always open.</p>
<p>If anything changes in your business situation — if you need funding, have questions, or just want advice — we're one email away.</p>
<p>Here's to your business success. 🚀</p>
<p>— The SRT Agency Team<br>
<a href="https://srtagency.com">srtagency.com</a></p>`,
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // SEQUENCE 3: Application Abandoned Nurture (7 emails)
  // Trigger: enrolled at 25% | Cancel: application tag
  // ═══════════════════════════════════════════════════════════
  {
    name: "Application Abandoned",
    slug: "application-abandoned",
    trigger_tag: null, // Enrolled programmatically at 25%
    cancel_tag: "application-completed",
    steps: [
      {
        delay_minutes: 3 * MINUTES,
        subject: "You're Almost There — Finish Your Application",
        body: `<p>Hi {{first_name}},</p>
<p>We noticed you started a business funding application but didn't finish. No worries — your progress has been saved!</p>
<p>You're just a few steps away from seeing what you qualify for. To complete your application, all we need is:</p>
<ul>
<li>How much funding you need</li>
<li>Your estimated monthly bank deposits</li>
<li>A few business details</li>
</ul>
<p>It takes less than 3 minutes to finish: <a href="https://srtagency.com/apply">Complete your application →</a></p>
<p>— SRT Agency</p>`,
      },
      {
        delay_minutes: 24 * HOURS,
        subject: "We Saved Your Application — Pick Up Where You Left Off",
        body: `<p>Hi {{first_name}},</p>
<p>Your business funding application is still waiting for you. We know life gets busy — here's a quick recap of what you've already completed and what's left:</p>
<p><strong>✅ Done:</strong> Contact info, business basics</p>
<p><strong>📝 Still needed:</strong></p>
<ul>
<li>Funding amount requested</li>
<li>Average monthly bank deposits</li>
<li>Credit score range</li>
</ul>
<p>That's it — just 3 more fields and you're done.</p>
<p><a href="https://srtagency.com/apply">Finish now (2 minutes) →</a></p>
<p>— SRT Agency</p>`,
      },
      {
        delay_minutes: 72 * HOURS,
        subject: "Quick Question: What's Holding You Back?",
        body: `<p>Hi {{first_name}},</p>
<p>I wanted to personally reach out. You started a funding application a few days ago and I'm curious — is something holding you back?</p>
<p><strong>Common concerns we hear:</strong></p>
<ul>
<li>"I'm not sure I'll qualify" — Most of our applicants get at least one offer</li>
<li>"I don't want a hard credit pull" — We only do a soft pull. Your score won't be affected</li>
<li>"I'm not ready yet" — No problem. But knowing your options costs nothing</li>
<li>"I need to gather documents" — You don't need any documents to apply</li>
</ul>
<p>Reply to this email with any questions. I'm here to help, not to pressure you.</p>
<p>— SRT Agency</p>`,
      },
      {
        delay_minutes: 5 * DAYS,
        subject: "Just Send Us Your Bank Statements",
        body: `<p>Hi {{first_name}},</p>
<p>Here's an even easier option: skip the form entirely. Just send us your <strong>last 3 months of business bank statements</strong> and we'll do the rest.</p>
<p>Seriously — reply to this email with your bank statements attached, and our team will:</p>
<ol>
<li>Complete your application for you</li>
<li>Match you with the best lenders</li>
<li>Present you with options in 24-48 hours</li>
</ol>
<p>No forms, no hassle. Just funding.</p>
<p>— SRT Agency</p>`,
      },
      {
        delay_minutes: 7 * DAYS,
        subject: "Your Competitors Aren't Waiting",
        body: `<p>Hi {{first_name}},</p>
<p>While you're thinking about it, other businesses in your industry are getting funded and investing in growth.</p>
<p>I don't say this to pressure you — I say it because I've seen too many business owners wait until they desperately need funding, and by then their options are worse and more expensive.</p>
<p>The best time to secure funding is when you have options. That's right now.</p>
<p><a href="https://srtagency.com/apply">Finish your application (2 min) →</a></p>
<p>— SRT Agency</p>`,
      },
      {
        delay_minutes: 10 * DAYS,
        subject: "Special Offer: We'll Complete Your Application for You",
        body: `<p>Hi {{first_name}},</p>
<p>I know forms aren't everyone's favorite thing. Here's what I can do:</p>
<p><strong>Reply to this email with just two things:</strong></p>
<ol>
<li>How much funding do you need? (approximate is fine)</li>
<li>What are your average monthly bank deposits?</li>
</ol>
<p>That's it. Two numbers. Our team will handle everything else and get back to you with your options.</p>
<p>Can't get easier than that, right?</p>
<p>— SRT Agency</p>`,
      },
      {
        delay_minutes: 14 * DAYS,
        subject: "Last Check-In: Your Application Is Expiring",
        body: `<p>Hi {{first_name}},</p>
<p>Your saved application data will expire soon. If you want to explore business funding options, now is the time to finish.</p>
<p><strong>Three ways to move forward:</strong></p>
<ol>
<li><a href="https://srtagency.com/apply">Complete the form online</a> (2 minutes)</li>
<li>Reply with your bank statements (we'll do the rest)</li>
<li>Reply with your funding amount + monthly deposits (two numbers)</li>
</ol>
<p>After this, you'd need to start a new application. No pressure — but the door is open right now.</p>
<p>— SRT Agency</p>`,
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════
  // SEQUENCE 4: Website Lead → Application Push (7 emails)
  // Trigger: enrolled from capture | Cancel: application tag
  // ═══════════════════════════════════════════════════════════
  {
    name: "Website Lead to Application",
    slug: "website-lead-to-application",
    trigger_tag: null, // Enrolled programmatically from capture route
    cancel_tag: "application-completed",
    steps: [
      {
        delay_minutes: 3 * MINUTES,
        subject: "Thanks for Reaching Out — Let's Get You Funded",
        body: `<p>Hi {{first_name}},</p>
<p>Thanks for contacting SRT Agency! We received your message and wanted to follow up right away.</p>
<p>The fastest way to see what funding you qualify for is through our <strong>5-minute application</strong>. It's free, doesn't affect your credit, and you'll get options within 24-48 hours.</p>
<p><a href="https://srtagency.com/apply">Start your application →</a></p>
<p>If you have questions first, just reply to this email. We're happy to chat.</p>
<p>— SRT Agency</p>`,
      },
      {
        delay_minutes: 24 * HOURS,
        subject: "Why Our Clients Choose SRT Agency",
        body: `<p>Hi {{first_name}},</p>
<p>You reached out to us yesterday and I wanted to share why business owners trust SRT Agency:</p>
<ul>
<li><strong>75+ lending partners</strong> — More options than any bank</li>
<li><strong>No hard credit pull</strong> — Your score stays safe</li>
<li><strong>24-hour approvals</strong> — No weeks of waiting</li>
<li><strong>$10K to $5M+</strong> — Flexible funding amounts</li>
<li><strong>Free service</strong> — We're compensated by lenders, not you</li>
</ul>
<p>The only way to know what you qualify for is to apply. It takes 5 minutes.</p>
<p><a href="https://srtagency.com/apply">See your options →</a></p>
<p>— SRT Agency</p>`,
      },
      {
        delay_minutes: 72 * HOURS,
        subject: "The 5-Minute Application That Could Change Everything",
        body: `<p>Hi {{first_name}},</p>
<p>5 minutes. That's all it takes to find out how much business funding you qualify for.</p>
<p><strong>What you'll need:</strong></p>
<ul>
<li>Your name and contact info (you've already given us this!)</li>
<li>Basic business details (name, industry, start date)</li>
<li>Approximate funding amount needed</li>
<li>Estimated monthly revenue</li>
</ul>
<p>No documents, no hard credit pull, no commitment.</p>
<p><a href="https://srtagency.com/apply">Take 5 minutes right now →</a></p>
<p>— SRT Agency</p>`,
      },
      {
        delay_minutes: 5 * DAYS,
        subject: "Not Sure How Much Funding You Need?",
        body: `<p>Hi {{first_name}},</p>
<p>One question that stops a lot of people from applying: "How much should I request?"</p>
<p>Here's the thing — <strong>you don't have to know exactly.</strong> Give us your best estimate and we'll work with you.</p>
<p><strong>Common funding uses and amounts:</strong></p>
<ul>
<li>Working capital: $25K–$100K</li>
<li>Equipment: $10K–$250K</li>
<li>Expansion: $50K–$500K</li>
<li>Inventory: $15K–$200K</li>
</ul>
<p>When in doubt, aim higher. You can always take less than what you're approved for.</p>
<p><a href="https://srtagency.com/apply">Apply now →</a></p>
<p>— SRT Agency</p>`,
      },
      {
        delay_minutes: 7 * DAYS,
        subject: "A Week Later — Still Thinking About It?",
        body: `<p>Hi {{first_name}},</p>
<p>It's been a week since you reached out to SRT Agency. I want to make sure we're not leaving you hanging.</p>
<p>If you're still exploring your options, I totally get it. But I don't want you to miss out on funding that could help your business right now.</p>
<p>Here's a simple next step: just reply to this email with what you need funding for and approximately how much. No form needed. We'll take it from there.</p>
<p>— SRT Agency</p>`,
      },
      {
        delay_minutes: 10 * DAYS,
        subject: "Quick Funding vs. Bank Loans (Comparison)",
        body: `<p>Hi {{first_name}},</p>
<p>Wondering how we compare to going to a bank? Here's an honest side-by-side:</p>
<table style="border-collapse:collapse;width:100%">
<tr style="background:#0B1426;color:white"><th style="padding:8px"></th><th style="padding:8px">Bank</th><th style="padding:8px">SRT Agency</th></tr>
<tr><td style="padding:8px;border:1px solid #ddd"><strong>Time to approval</strong></td><td style="padding:8px;border:1px solid #ddd">2-8 weeks</td><td style="padding:8px;border:1px solid #ddd">24-48 hours</td></tr>
<tr><td style="padding:8px;border:1px solid #ddd"><strong>Credit requirement</strong></td><td style="padding:8px;border:1px solid #ddd">680+</td><td style="padding:8px;border:1px solid #ddd">500+</td></tr>
<tr><td style="padding:8px;border:1px solid #ddd"><strong>Documents needed</strong></td><td style="padding:8px;border:1px solid #ddd">Tax returns, P&L, collateral</td><td style="padding:8px;border:1px solid #ddd">Bank statements</td></tr>
<tr><td style="padding:8px;border:1px solid #ddd"><strong>Approval rate</strong></td><td style="padding:8px;border:1px solid #ddd">~20%</td><td style="padding:8px;border:1px solid #ddd">~73%</td></tr>
</table>
<p>Banks are great for some situations. But if you need speed and flexibility, we've got you covered.</p>
<p><a href="https://srtagency.com/apply">Apply in 5 minutes →</a></p>
<p>— SRT Agency</p>`,
      },
      {
        delay_minutes: 14 * DAYS,
        subject: "We'd Love to Help — When You're Ready",
        body: `<p>Hi {{first_name}},</p>
<p>This is our last check-in for now. We respect your time and don't want to be pushy.</p>
<p>Here's what you should know:</p>
<ul>
<li>Our service is always free</li>
<li>You can apply anytime at <a href="https://srtagency.com/apply">srtagency.com/apply</a></li>
<li>Or reply to any of our emails — we're always here</li>
</ul>
<p>Whenever the timing is right for your business, SRT Agency will be ready to help.</p>
<p>All the best,<br>The SRT Agency Team</p>`,
      },
    ],
  },
];
