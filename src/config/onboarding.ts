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
    link: "https://claude.ai/new",
    linkLabel: "Open Claude AI",
  },
  {
    id: "step-2",
    title: "Connect GoHighLevel",
    description: "Link your GHL account to sync contacts, pipelines, and messaging.",
  },
  {
    id: "step-3",
    title: "Connect Microsoft 365",
    description: "Connect Outlook for email, OneDrive for file storage, and calendar sync.",
  },
  {
    id: "step-4",
    title: "Set Up Pipeline Stages",
    description: "Review and customize your New Deals and Active Deals pipeline stages.",
  },
  {
    id: "step-5",
    title: "Configure Automations",
    description: "Set up automated SMS, email, and notifications for each pipeline stage.",
  },
  {
    id: "step-6",
    title: "Import SMS & Email Templates",
    description: "Review the 18+ built-in templates and customize them for your voice.",
  },
  {
    id: "step-7",
    title: "Add Knowledge Base Entries",
    description: "Feed the AI assistant with company info, product details, and FAQs.",
  },
  {
    id: "step-8",
    title: "Test Lead Capture Flow",
    description: "Submit a test application on srtagency.com and verify it appears in the pipeline.",
  },
  {
    id: "step-9",
    title: "Set Up Telegram Notifications",
    description: "Connect your Telegram account for real-time deal alerts on mobile.",
  },
  {
    id: "step-10",
    title: "Review QA Checklist",
    description: "Go through the pre-launch checklist to make sure everything is working.",
    link: "/dashboard/checklist",
    linkLabel: "Open QA Checklist",
  },
];
