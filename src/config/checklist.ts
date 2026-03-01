// QA / Pre-Launch Checklist — organized by section
// Each item has a unique ID for persistent state tracking

export interface ChecklistItem {
  id: string;
  label: string;
  priority?: "critical" | "high" | "medium" | "low";
}

export interface ChecklistSection {
  id: string;
  title: string;
  items: ChecklistItem[];
}

export interface ChecklistCategory {
  id: string;
  title: string;
  sections: ChecklistSection[];
}

export const QA_CHECKLIST: ChecklistCategory[] = [
  {
    id: "website",
    title: "Website (srtagency.com)",
    sections: [
      {
        id: "pages",
        title: "Pages & Content",
        items: [
          { id: "w-p-01", label: "Homepage loads correctly", priority: "critical" },
          { id: "w-p-02", label: "Apply form loads correctly", priority: "critical" },
          { id: "w-p-03", label: "Line of Credit page loads", priority: "high" },
          { id: "w-p-04", label: "Hybrid LOC page loads", priority: "high" },
          { id: "w-p-05", label: "Equipment Financing page loads", priority: "high" },
          { id: "w-p-06", label: "Meta Ads landing page loads", priority: "high" },
          { id: "w-p-07", label: "Privacy Policy page loads", priority: "high" },
          { id: "w-p-08", label: "Brand Assets tool loads", priority: "medium" },
          { id: "w-p-09", label: "All pages return 200 status, no 404s", priority: "critical" },
          { id: "w-p-10", label: "All pages accessible via clean URLs", priority: "medium" },
        ],
      },
      {
        id: "homepage",
        title: "Homepage",
        items: [
          { id: "w-h-01", label: "Nav bar renders with logo + menu links", priority: "critical" },
          { id: "w-h-02", label: "Mobile menu toggle works on screens <768px", priority: "high" },
          { id: "w-h-03", label: "Hero headline visible: \"Get the Capital Your Business Needs\"", priority: "critical" },
          { id: "w-h-04", label: "Hero CTA \"Apply Now\" navigates to /apply", priority: "critical" },
          { id: "w-h-05", label: "Hero metrics: 3 Loan Programs, $2M Max Funding, 4hr Approvals", priority: "high" },
          { id: "w-h-06", label: "\"How It Works\" video plays from /assets/0226.mp4", priority: "high" },
          { id: "w-h-07", label: "Products section shows 3 cards (LOC, Hybrid, Equipment)", priority: "high" },
          { id: "w-h-08", label: "Product card hover effects working", priority: "low" },
          { id: "w-h-09", label: "Calculator accepts inputs ($1,000-$2,000,000)", priority: "high" },
          { id: "w-h-10", label: "Calculator computes monthly payment correctly", priority: "high" },
          { id: "w-h-11", label: "Contact section: form + phone + email", priority: "critical" },
          { id: "w-h-12", label: "FAQ section: expand/collapse works", priority: "medium" },
          { id: "w-h-13", label: "Footer: copyright year says 2026", priority: "medium" },
          { id: "w-h-14", label: "Language toggle (ES/EN) switches all text", priority: "medium" },
        ],
      },
      {
        id: "apply-form",
        title: "Apply Form",
        items: [
          { id: "w-a-01", label: "Progress bar at top (gradient: ocean to reef)", priority: "high" },
          { id: "w-a-02", label: "All 11 slides render and advance correctly", priority: "critical" },
          { id: "w-a-03", label: "Slide 0-1: Pre-qual 3 yes/no questions", priority: "critical" },
          { id: "w-a-04", label: "DNQ users blocked with friendly message", priority: "high" },
          { id: "w-a-05", label: "Slide 2: Contact info (email, phone, name)", priority: "critical" },
          { id: "w-a-06", label: "API call fires at 25% to /api/leads/application", priority: "critical" },
          { id: "w-a-07", label: "Slides 3-5: Business info (name, DBA, entity, industry, EIN)", priority: "critical" },
          { id: "w-a-08", label: "Slide 6: Owner info (SSN4, DOB, ownership %)", priority: "critical" },
          { id: "w-a-09", label: "Slide 7: Funding (amount, use of funds, existing loans)", priority: "critical" },
          { id: "w-a-10", label: "Slide 9: SSN security notice displays", priority: "high" },
          { id: "w-a-11", label: "Slide 10: Review summary of all responses", priority: "high" },
          { id: "w-a-12", label: "Back button navigates without losing data", priority: "high" },
          { id: "w-a-13", label: "All required fields enforce validation", priority: "critical" },
          { id: "w-a-14", label: "Email/phone/EIN format validated", priority: "high" },
          { id: "w-a-15", label: "Form preserves data in localStorage between refreshes", priority: "medium" },
          { id: "w-a-16", label: "Double-submit protection on final submit", priority: "high" },
          { id: "w-a-17", label: "Button shows \"Submitting...\" during API call", priority: "medium" },
        ],
      },
      {
        id: "success-screen",
        title: "Apply Form — Success Screen",
        items: [
          { id: "w-s-01", label: "Checkmark + \"Application Submitted!\" headline", priority: "critical" },
          { id: "w-s-02", label: "Upload prompt for last 3 months bank statements", priority: "critical" },
          { id: "w-s-03", label: "Drag-and-drop zone renders with dashed border", priority: "high" },
          { id: "w-s-04", label: "Click zone opens file picker", priority: "high" },
          { id: "w-s-05", label: "Drag files onto zone highlights green", priority: "medium" },
          { id: "w-s-06", label: "Dropped files appear in file list", priority: "high" },
          { id: "w-s-07", label: "Upload sends files to /api/files/upload", priority: "critical" },
          { id: "w-s-08", label: "Each file shows Uploading/Uploaded/Error status", priority: "high" },
          { id: "w-s-09", label: "WhatsApp button links to (786) 282-2937", priority: "high" },
          { id: "w-s-10", label: "Assigned underwriter name shows as Matthew", priority: "medium" },
        ],
      },
      {
        id: "tracking",
        title: "Analytics & Tracking",
        items: [
          { id: "w-t-01", label: "Meta Pixel ID correct: 2319215808600729", priority: "critical" },
          { id: "w-t-02", label: "fbq() initializes without errors", priority: "critical" },
          { id: "w-t-03", label: "PageView fires on every page load", priority: "high" },
          { id: "w-t-04", label: "InitiateCheckout fires on Apply click", priority: "high" },
          { id: "w-t-05", label: "Lead fires on contact form submit", priority: "high" },
          { id: "w-t-06", label: "CompleteRegistration fires on 100% application", priority: "high" },
          { id: "w-t-07", label: "_fbc and _fbp cookies captured and sent", priority: "high" },
          { id: "w-t-08", label: "Event IDs unique per event", priority: "medium" },
          { id: "w-t-09", label: "No tracking errors in console", priority: "medium" },
        ],
      },
      {
        id: "seo",
        title: "SEO & Meta Tags",
        items: [
          { id: "w-seo-01", label: "charset UTF-8 on all pages", priority: "high" },
          { id: "w-seo-02", label: "viewport meta tag correct", priority: "high" },
          { id: "w-seo-03", label: "Unique meta description per page (< 160 chars)", priority: "medium" },
          { id: "w-seo-04", label: "Favicon renders in browser tab", priority: "medium" },
          { id: "w-seo-05", label: "OG tags present (title, description, image)", priority: "medium" },
          { id: "w-seo-06", label: "All resources use HTTPS", priority: "critical" },
        ],
      },
      {
        id: "links",
        title: "Links, Phones & Emails",
        items: [
          { id: "w-l-01", label: "All \"Apply Now\" buttons navigate to /apply", priority: "critical" },
          { id: "w-l-02", label: "Product page links go to correct pages", priority: "high" },
          { id: "w-l-03", label: "Privacy policy links work from all pages", priority: "high" },
          { id: "w-l-04", label: "Phone links use tel: protocol", priority: "high" },
          { id: "w-l-05", label: "Email links use mailto: protocol", priority: "high" },
          { id: "w-l-06", label: "(833) 365-4477 consistent across pages", priority: "high" },
          { id: "w-l-07", label: "No broken/dead links (check all hrefs)", priority: "critical" },
          { id: "w-l-08", label: "No localhost references in production code", priority: "critical" },
          { id: "w-l-09", label: "No test/dummy phone numbers", priority: "high" },
        ],
      },
      {
        id: "mobile",
        title: "Mobile & Responsive",
        items: [
          { id: "w-m-01", label: "Nav collapses to hamburger menu", priority: "high" },
          { id: "w-m-02", label: "Hero stacks vertically (1 column)", priority: "high" },
          { id: "w-m-03", label: "Products grid becomes single column", priority: "high" },
          { id: "w-m-04", label: "Contact form stacks vertically", priority: "medium" },
          { id: "w-m-05", label: "No horizontal scroll on any viewport", priority: "high" },
          { id: "w-m-06", label: "Touch targets >= 44x44px", priority: "medium" },
        ],
      },
      {
        id: "performance",
        title: "Performance",
        items: [
          { id: "w-perf-01", label: "Homepage loads < 3 seconds", priority: "high" },
          { id: "w-perf-02", label: "Apply form loads < 2 seconds", priority: "high" },
          { id: "w-perf-03", label: "Lighthouse desktop score > 80", priority: "medium" },
          { id: "w-perf-04", label: "No layout shift (CLS < 0.1)", priority: "medium" },
          { id: "w-perf-05", label: "CSS is inline (no render-blocking sheets)", priority: "medium" },
        ],
      },
      {
        id: "security",
        title: "Website Security",
        items: [
          { id: "w-sec-01", label: "HTTPS enforced everywhere", priority: "critical" },
          { id: "w-sec-02", label: "No API keys in client-side code", priority: "critical" },
          { id: "w-sec-03", label: "SSN4 only (not full SSN)", priority: "critical" },
          { id: "w-sec-04", label: "No sensitive data in console.log", priority: "high" },
          { id: "w-sec-05", label: "XSS protection (HTML escaping on user inputs)", priority: "high" },
        ],
      },
    ],
  },
  {
    id: "mission-control",
    title: "Mission Control Dashboard",
    sections: [
      {
        id: "stack",
        title: "Architecture & Stack",
        items: [
          { id: "mc-s-01", label: "Next.js 14 App Router working", priority: "critical" },
          { id: "mc-s-02", label: "TypeScript compiles without errors (npx tsc --noEmit)", priority: "critical" },
          { id: "mc-s-03", label: "Tailwind CSS rendering correctly", priority: "high" },
          { id: "mc-s-04", label: "Supabase connected and querying", priority: "critical" },
          { id: "mc-s-05", label: "Vercel deployment successful", priority: "critical" },
          { id: "mc-s-06", label: "vercel.json cron configured (hourly)", priority: "high" },
        ],
      },
      {
        id: "dashboard-home",
        title: "Dashboard Home",
        items: [
          { id: "mc-dh-01", label: "Greeting shows user name", priority: "high" },
          { id: "mc-dh-02", label: "Current date correct", priority: "medium" },
          { id: "mc-dh-03", label: "Active Deals count accurate", priority: "high" },
          { id: "mc-dh-04", label: "Deals This Week count accurate", priority: "high" },
          { id: "mc-dh-05", label: "Deals Funded count accurate", priority: "high" },
          { id: "mc-dh-06", label: "Recent activity log shows last 10 items", priority: "medium" },
          { id: "mc-dh-07", label: "Timestamps show relative time", priority: "low" },
          { id: "mc-dh-08", label: "Loads in < 2 seconds", priority: "medium" },
        ],
      },
      {
        id: "pipeline",
        title: "Pipeline (Kanban)",
        items: [
          { id: "mc-pk-01", label: "Two pipelines visible: New Deals, Active Deals", priority: "critical" },
          { id: "mc-pk-02", label: "New Deals stages correct (7 stages)", priority: "critical" },
          { id: "mc-pk-03", label: "Active Deals stages correct (8 stages)", priority: "critical" },
          { id: "mc-pk-04", label: "Stage counts match actual deals", priority: "high" },
          { id: "mc-pk-05", label: "Deal cards show name, amount, status", priority: "high" },
          { id: "mc-pk-06", label: "Drag-and-drop moves deals between stages", priority: "high" },
          { id: "mc-pk-07", label: "GHL updates when deal moved", priority: "high" },
          { id: "mc-pk-08", label: "Click card opens detail view", priority: "high" },
          { id: "mc-pk-09", label: "Search filters by name/email", priority: "medium" },
        ],
      },
      {
        id: "ai",
        title: "AI Assistant",
        items: [
          { id: "mc-ai-01", label: "Chat interface renders", priority: "high" },
          { id: "mc-ai-02", label: "Send button works", priority: "high" },
          { id: "mc-ai-03", label: "AI responds with context-aware answers", priority: "high" },
          { id: "mc-ai-04", label: "AI tools execute (pipeline queries, messaging)", priority: "high" },
          { id: "mc-ai-05", label: "Conversation history persists", priority: "medium" },
          { id: "mc-ai-06", label: "5-iteration safety limit works", priority: "high" },
        ],
      },
      {
        id: "templates",
        title: "Templates",
        items: [
          { id: "mc-tp-01", label: "Template list shows all SMS + Email templates", priority: "high" },
          { id: "mc-tp-02", label: "18+ default templates present", priority: "high" },
          { id: "mc-tp-03", label: "Can create new template", priority: "high" },
          { id: "mc-tp-04", label: "Can edit existing template", priority: "high" },
          { id: "mc-tp-05", label: "Can delete template", priority: "medium" },
          { id: "mc-tp-06", label: "Template editor shows variables", priority: "medium" },
          { id: "mc-tp-07", label: "SMS shows character count", priority: "low" },
        ],
      },
      {
        id: "automations",
        title: "Automations",
        items: [
          { id: "mc-au-01", label: "Rules listed by pipeline and stage", priority: "high" },
          { id: "mc-au-02", label: "~20 default rules visible", priority: "high" },
          { id: "mc-au-03", label: "Can enable/disable rules", priority: "high" },
          { id: "mc-au-04", label: "\"Run Stale Check\" button works", priority: "high" },
          { id: "mc-au-05", label: "Execution History tab shows logs", priority: "medium" },
          { id: "mc-au-06", label: "Delayed actions scheduled and processed", priority: "high" },
        ],
      },
      {
        id: "integrations",
        title: "Integrations",
        items: [
          { id: "mc-in-01", label: "GHL shows Connected with Sync Now button", priority: "critical" },
          { id: "mc-in-02", label: "Microsoft 365 shows connected status", priority: "critical" },
          { id: "mc-in-03", label: "GHL Sync Now triggers sync", priority: "high" },
          { id: "mc-in-04", label: "MS365 disconnect button works", priority: "high" },
          { id: "mc-in-05", label: "Connect button starts OAuth flow", priority: "high" },
        ],
      },
      {
        id: "mail",
        title: "Outlook / Mail",
        items: [
          { id: "mc-ml-01", label: "Shows connection status", priority: "high" },
          { id: "mc-ml-02", label: "If connected: inbox list loads", priority: "high" },
          { id: "mc-ml-03", label: "Can read emails", priority: "high" },
          { id: "mc-ml-04", label: "Can reply to emails", priority: "high" },
          { id: "mc-ml-05", label: "Can compose new emails", priority: "high" },
          { id: "mc-ml-06", label: "Token refresh works silently", priority: "high" },
        ],
      },
      {
        id: "messaging",
        title: "Messaging",
        items: [
          { id: "mc-msg-01", label: "Contact list visible", priority: "high" },
          { id: "mc-msg-02", label: "Can select conversation", priority: "high" },
          { id: "mc-msg-03", label: "Can send SMS", priority: "high" },
          { id: "mc-msg-04", label: "Can send email", priority: "high" },
          { id: "mc-msg-05", label: "Template selector works", priority: "medium" },
          { id: "mc-msg-06", label: "Template variables auto-fill", priority: "medium" },
        ],
      },
      {
        id: "knowledge",
        title: "Knowledge Base",
        items: [
          { id: "mc-kb-01", label: "List of entries visible", priority: "medium" },
          { id: "mc-kb-02", label: "Can create/edit/delete entries", priority: "medium" },
          { id: "mc-kb-03", label: "Search/filter works", priority: "low" },
          { id: "mc-kb-04", label: "AI loads entries into system prompt", priority: "medium" },
        ],
      },
      {
        id: "settings",
        title: "Settings",
        items: [
          { id: "mc-st-01", label: "Account tab: name editable, email shown", priority: "medium" },
          { id: "mc-st-02", label: "Team tab: list members, add/remove users", priority: "medium" },
          { id: "mc-st-03", label: "AI Config tab: priorities + context save", priority: "medium" },
        ],
      },
    ],
  },
  {
    id: "api",
    title: "API Routes",
    sections: [
      {
        id: "auth",
        title: "Authentication",
        items: [
          { id: "api-auth-01", label: "Login with email/password works", priority: "critical" },
          { id: "api-auth-02", label: "Default users: matthew@, benjamin@", priority: "critical" },
          { id: "api-auth-03", label: "Passwords hashed with bcryptjs", priority: "critical" },
          { id: "api-auth-04", label: "Session persists across page loads", priority: "critical" },
          { id: "api-auth-05", label: "Unauthorized access redirects to login", priority: "critical" },
        ],
      },
      {
        id: "lead-capture",
        title: "Lead Capture",
        items: [
          { id: "api-lc-01", label: "POST /api/leads/capture — CORS headers present", priority: "critical" },
          { id: "api-lc-02", label: "Validates name + email/phone", priority: "critical" },
          { id: "api-lc-03", label: "Creates GHL contact", priority: "critical" },
          { id: "api-lc-04", label: "Creates opportunity in New Deals pipeline", priority: "critical" },
          { id: "api-lc-05", label: "Caches to pipeline_cache", priority: "high" },
          { id: "api-lc-06", label: "Sends Meta CAPI Lead event", priority: "high" },
          { id: "api-lc-07", label: "Rate limited (10/min per IP)", priority: "high" },
          { id: "api-lc-08", label: "Handles duplicate contacts gracefully", priority: "high" },
        ],
      },
      {
        id: "application",
        title: "Application Flow",
        items: [
          { id: "api-app-01", label: "POST /api/leads/application accepts 0-100% progress", priority: "critical" },
          { id: "api-app-02", label: "25%: creates contact + opportunity", priority: "critical" },
          { id: "api-app-03", label: "50-92%: enriches contact custom fields", priority: "high" },
          { id: "api-app-04", label: "100%: final enrichment + PDF gen + OneDrive + GHL tag", priority: "critical" },
          { id: "api-app-05", label: "Custom fields map correctly (all 29+)", priority: "high" },
          { id: "api-app-06", label: "Rate limited (20/min per IP)", priority: "high" },
        ],
      },
      {
        id: "file-upload",
        title: "File Upload",
        items: [
          { id: "api-fu-01", label: "POST /api/files/upload accepts multipart/form-data", priority: "critical" },
          { id: "api-fu-02", label: "Creates OneDrive folder Working Files/{business}", priority: "high" },
          { id: "api-fu-03", label: "Uploads files to OneDrive", priority: "high" },
          { id: "api-fu-04", label: "Uploads files to GHL contact documents", priority: "high" },
          { id: "api-fu-05", label: "CORS headers for cross-origin access", priority: "critical" },
        ],
      },
      {
        id: "ghl-routes",
        title: "GHL Integration Routes",
        items: [
          { id: "api-ghl-01", label: "POST /api/ghl/sync syncs pipeline cache", priority: "high" },
          { id: "api-ghl-02", label: "POST /api/ghl/messages sends SMS/Email", priority: "high" },
          { id: "api-ghl-03", label: "POST /api/ghl/webhook receives GHL events", priority: "high" },
          { id: "api-ghl-04", label: "Rate limit handling (429 retry)", priority: "high" },
        ],
      },
      {
        id: "ms365-routes",
        title: "Microsoft 365 Routes",
        items: [
          { id: "api-ms-01", label: "OAuth flow: auth -> login -> callback", priority: "critical" },
          { id: "api-ms-02", label: "Token refresh works (5-min buffer)", priority: "high" },
          { id: "api-ms-03", label: "POST /api/integrations/microsoft/disconnect works", priority: "high" },
          { id: "api-ms-04", label: "GET /api/integrations/microsoft/mail fetches inbox", priority: "high" },
          { id: "api-ms-05", label: "POST /api/integrations/microsoft/mail sends/replies", priority: "high" },
        ],
      },
    ],
  },
  {
    id: "integrations",
    title: "External Integrations",
    sections: [
      {
        id: "ghl",
        title: "GoHighLevel",
        items: [
          { id: "int-ghl-01", label: "API key authenticates successfully", priority: "critical" },
          { id: "int-ghl-02", label: "Can list pipelines", priority: "high" },
          { id: "int-ghl-03", label: "Can create/update contacts", priority: "critical" },
          { id: "int-ghl-04", label: "Can create/move opportunities", priority: "critical" },
          { id: "int-ghl-05", label: "Can send SMS/Email", priority: "high" },
          { id: "int-ghl-06", label: "Rate limits handled (429 retry with backoff)", priority: "high" },
          { id: "int-ghl-07", label: "Custom fields synced (29+ fields)", priority: "high" },
          { id: "int-ghl-08", label: "Document upload works", priority: "high" },
          { id: "int-ghl-09", label: "Tag operations work", priority: "medium" },
        ],
      },
      {
        id: "ms365",
        title: "Microsoft 365",
        items: [
          { id: "int-ms-01", label: "OAuth flow completes end-to-end", priority: "critical" },
          { id: "int-ms-02", label: "Tokens stored securely in integrations table", priority: "critical" },
          { id: "int-ms-03", label: "Can fetch inbox messages", priority: "high" },
          { id: "int-ms-04", label: "Can send/reply emails", priority: "high" },
          { id: "int-ms-05", label: "OneDrive: can create folders + upload files", priority: "high" },
          { id: "int-ms-06", label: "Azure app has correct redirect URI", priority: "critical" },
        ],
      },
      {
        id: "meta",
        title: "Meta Pixel / CAPI",
        items: [
          { id: "int-meta-01", label: "Pixel ID correct", priority: "critical" },
          { id: "int-meta-02", label: "CAPI token valid", priority: "critical" },
          { id: "int-meta-03", label: "Events send to Graph API successfully", priority: "high" },
          { id: "int-meta-04", label: "Event deduplication via event IDs", priority: "medium" },
        ],
      },
      {
        id: "anthropic",
        title: "Anthropic Claude",
        items: [
          { id: "int-ai-01", label: "API key valid", priority: "critical" },
          { id: "int-ai-02", label: "Messages endpoint working", priority: "high" },
          { id: "int-ai-03", label: "Tool use enabled", priority: "high" },
          { id: "int-ai-04", label: "5-iteration safety limit works", priority: "high" },
        ],
      },
      {
        id: "telegram",
        title: "Telegram Bot",
        items: [
          { id: "int-tg-01", label: "Token valid", priority: "high" },
          { id: "int-tg-02", label: "Webhook set to /api/telegram/webhook", priority: "high" },
          { id: "int-tg-03", label: "Bot responds to messages", priority: "high" },
          { id: "int-tg-04", label: "User ID whitelisted (1230555254)", priority: "high" },
        ],
      },
    ],
  },
  {
    id: "completion-flow",
    title: "100% Completion Flow",
    sections: [
      {
        id: "post-submit",
        title: "Post-Submission Automation",
        items: [
          { id: "cf-01", label: "PDF generates server-side from form data", priority: "critical" },
          { id: "cf-02", label: "PDF has SRT Agency branding (header, footer, colors)", priority: "high" },
          { id: "cf-03", label: "PDF includes all 3 sections (Business, Owner, Funding)", priority: "high" },
          { id: "cf-04", label: "OneDrive folder \"Working Files\" created", priority: "high" },
          { id: "cf-05", label: "Business-specific subfolder created", priority: "high" },
          { id: "cf-06", label: "PDF uploaded to OneDrive folder", priority: "high" },
          { id: "cf-07", label: "PDF uploaded to GHL contact Documents tab", priority: "high" },
          { id: "cf-08", label: "Tag \"application-submitted\" added to GHL contact", priority: "high" },
          { id: "cf-09", label: "All steps non-blocking (errors logged, don't break response)", priority: "critical" },
        ],
      },
    ],
  },
  {
    id: "env-vars",
    title: "Environment Variables",
    sections: [
      {
        id: "env",
        title: "Production Environment",
        items: [
          { id: "env-01", label: "NEXTAUTH_SECRET set (random, secure)", priority: "critical" },
          { id: "env-02", label: "NEXTAUTH_URL = https://mission.srtagency.com", priority: "critical" },
          { id: "env-03", label: "NEXT_PUBLIC_SUPABASE_URL correct", priority: "critical" },
          { id: "env-04", label: "SUPABASE_SERVICE_ROLE_KEY valid", priority: "critical" },
          { id: "env-05", label: "ANTHROPIC_API_KEY valid", priority: "critical" },
          { id: "env-06", label: "GHL_API_KEY valid", priority: "critical" },
          { id: "env-07", label: "GHL_LOCATION_ID correct", priority: "critical" },
          { id: "env-08", label: "META_PIXEL_ID = 2319215808600729", priority: "high" },
          { id: "env-09", label: "META_CAPI_TOKEN valid", priority: "high" },
          { id: "env-10", label: "MICROSOFT_CLIENT_ID valid", priority: "high" },
          { id: "env-11", label: "MICROSOFT_CLIENT_SECRET valid", priority: "high" },
          { id: "env-12", label: "TELEGRAM_BOT_TOKEN valid", priority: "medium" },
          { id: "env-13", label: "No secrets in NEXT_PUBLIC_ vars", priority: "critical" },
          { id: "env-14", label: "All vars set on Vercel dashboard", priority: "critical" },
          { id: "env-15", label: "No test/dummy values in production", priority: "high" },
        ],
      },
    ],
  },
  {
    id: "database",
    title: "Database (Supabase)",
    sections: [
      {
        id: "tables",
        title: "Tables & Data",
        items: [
          { id: "db-01", label: "pipeline_cache table exists with data", priority: "critical" },
          { id: "db-02", label: "message_templates seeded (18+ templates)", priority: "high" },
          { id: "db-03", label: "automation_logs logging correctly", priority: "high" },
          { id: "db-04", label: "system_logs recording events", priority: "high" },
          { id: "db-05", label: "chat_conversations + chat_messages working", priority: "medium" },
          { id: "db-06", label: "integrations table has config rows", priority: "high" },
          { id: "db-07", label: "knowledge_entries table accessible", priority: "medium" },
          { id: "db-08", label: "users table has team members", priority: "critical" },
          { id: "db-09", label: "pipeline_cache has ghl_opportunity_id as unique key", priority: "high" },
          { id: "db-10", label: "Timestamps in ISO format", priority: "medium" },
        ],
      },
      {
        id: "db-security",
        title: "Database Security",
        items: [
          { id: "dbs-01", label: "Service role key used server-side only", priority: "critical" },
          { id: "dbs-02", label: "Anon key only for public reads", priority: "critical" },
          { id: "dbs-03", label: "Backups enabled", priority: "high" },
        ],
      },
    ],
  },
  {
    id: "security",
    title: "Security & Auth",
    sections: [
      {
        id: "auth-sec",
        title: "Authentication Security",
        items: [
          { id: "sec-01", label: "Middleware protects /dashboard/* routes", priority: "critical" },
          { id: "sec-02", label: "Public routes whitelisted: /api/auth/*, /api/leads/*", priority: "critical" },
          { id: "sec-03", label: "Passwords hashed (bcryptjs, salt >= 10)", priority: "critical" },
          { id: "sec-04", label: "Sessions use secure cookies", priority: "high" },
          { id: "sec-05", label: "No credentials in git history", priority: "critical" },
          { id: "sec-06", label: ".gitignore includes .env.local", priority: "high" },
        ],
      },
      {
        id: "api-sec",
        title: "API Security",
        items: [
          { id: "sec-07", label: "CORS restricted to srtagency.com (not wildcard *)", priority: "critical" },
          { id: "sec-08", label: "Private endpoints require session", priority: "critical" },
          { id: "sec-09", label: "Input validation on all endpoints", priority: "high" },
          { id: "sec-10", label: "No API keys in client bundle", priority: "critical" },
          { id: "sec-11", label: "Rate limiting on public endpoints", priority: "high" },
          { id: "sec-12", label: "Error boundary catches React crashes", priority: "high" },
        ],
      },
    ],
  },
  {
    id: "final",
    title: "Final Sign-Off",
    sections: [
      {
        id: "e2e",
        title: "End-to-End Testing",
        items: [
          { id: "fin-01", label: "All pages tested in Chrome, Firefox, Safari, Edge", priority: "high" },
          { id: "fin-02", label: "All forms submit successfully end-to-end", priority: "critical" },
          { id: "fin-03", label: "All links verified (no 404s)", priority: "high" },
          { id: "fin-04", label: "All images/videos load", priority: "medium" },
          { id: "fin-05", label: "Analytics firing correctly", priority: "high" },
          { id: "fin-06", label: "Webhooks reachable", priority: "high" },
          { id: "fin-07", label: "Database syncing", priority: "critical" },
          { id: "fin-08", label: "Email delivery working (test send)", priority: "high" },
          { id: "fin-09", label: "SMS delivery working (test send)", priority: "high" },
          { id: "fin-10", label: "Telegram bot responsive", priority: "medium" },
          { id: "fin-11", label: "Microsoft 365 connected", priority: "high" },
          { id: "fin-12", label: "All env vars set on Vercel", priority: "critical" },
          { id: "fin-13", label: "SSL certificate valid", priority: "critical" },
          { id: "fin-14", label: "Test application 25% -> 100% end-to-end", priority: "critical" },
          { id: "fin-15", label: "Test file upload on success screen", priority: "high" },
          { id: "fin-16", label: "Check OneDrive for uploaded files", priority: "high" },
          { id: "fin-17", label: "Check GHL contact for documents + tag", priority: "high" },
        ],
      },
    ],
  },
];

// Helper: count all items
export function countChecklistItems(checklist: ChecklistCategory[]): number {
  return checklist.reduce(
    (acc, cat) =>
      acc + cat.sections.reduce((s, sec) => s + sec.items.length, 0),
    0
  );
}
