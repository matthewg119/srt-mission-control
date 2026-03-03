// Default onboarding steps for new team member setup
// Step 1 links to Claude artifact for AI-powered signature generation

export interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  link?: string;
  linkLabel?: string;
}

export const DEFAULT_ONBOARDING_STEPS: OnboardingStep[] = [
  {
    id: "step-1",
    title: "Email Signature Generator",
    description: "Generate your professional SRT Agency email signature using AI. Click below to open the signature builder.",
    link: "/dashboard/marketing/signature",
    linkLabel: "Open Signature Generator",
  },
  {
    id: "step-2",
    title: "Introduction Call Script",
    description: `Phone script for first contact with a lead:\n\n"Hey is this {name}?"\n"Hey my name is _____, everything good?"\n"Awesome I'm calling from Scaling Revenue, you were looking for money for your business?"\n"Ok and how much money are you looking for right now?"\n"Sounds good, I'm glad that we connected. We like to work more as partners — our main focus is the funding side of the business but we're all hungry engineers looking to grow and help businesses grow together. We have a team of underwriters that helps us with in-house lending. But what are you looking to do with the funding?"`,
  },
  {
    id: "step-3",
    title: "AI Finance Business Planner",
    description: "Analyze deals from your pipeline with AI-powered spending trends, 5-point business checklists, and customized pitch scripts.",
    link: "/dashboard/onboarding/planner",
    linkLabel: "Open Planner",
  },
  {
    id: "step-4",
    title: "Lead Magnet Generator",
    description: "Generate lead magnet ideas from call conversations using AI. Upload calls or type a prompt to get ideas for any industry.",
    link: "/dashboard/onboarding/lead-magnets",
    linkLabel: "Open Generator",
  },
  {
    id: "step-5",
    title: "Connect GoHighLevel",
    description: "Link your GHL account to sync contacts, pipelines, and messaging.",
  },
  {
    id: "step-6",
    title: "Connect Microsoft 365",
    description: "Connect Outlook for email, OneDrive for file storage, and calendar sync.",
  },
  {
    id: "step-7",
    title: "Configure Automations",
    description: "Set up automated SMS, email, and notifications for each pipeline stage.",
  },
  {
    id: "step-8",
    title: "Import SMS & Email Templates",
    description: "Review the 18+ built-in templates and customize them for your voice.",
  },
  {
    id: "step-9",
    title: "Test Lead Capture Flow",
    description: "Submit a test application on srtagency.com and verify it appears in the pipeline.",
  },
  {
    id: "step-10",
    title: "Review QA Checklist",
    description: "Go through the pre-launch checklist to make sure everything is working.",
    link: "/dashboard/checklist",
    linkLabel: "Open QA Checklist",
  },
];
