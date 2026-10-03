import {
  CheckSquare,
  Building2,
  Zap,
  Settings,
  LayoutList,
  MessageSquare,
  Users,
  PhoneCall,
  Sunrise,
  Rocket,
  KanbanSquare,
} from "lucide-react";

export interface NavSection {
  label: string;
  items: NavItem[];
}

export interface NavItem {
  label: string;
  href: string;
  icon: typeof Zap;
}

/**
 * The sidebar. Trimmed from seven sections to two on 2026-10-02, on Matthew's marked-up
 * screenshot.
 *
 * ‼️ REMOVING A LINE DOES NOT REMOVE THE PAGE, AND THAT IS DELIBERATE EVERYWHERE BELOW.
 * Every route that left this file still resolves, still works, and is still reachable by URL or
 * by a link already pasted into a thread. What changed is what the chrome advertises. Deleting
 * the pages themselves is a separate decision with separate consequences (cron jobs, Slack
 * buttons and saved links all point into several of them), and it is not something to do as a
 * side effect of tidying a sidebar.
 *
 * Gone from the sidebar, and where they still live:
 *   BrainHeart       /dashboard                    (still the route; see the redirect note below)
 *   Content Studio   /dashboard/content-workflows
 *   Coaching Studio  /dashboard/coaching-studio
 *   SMS Simulator    /dashboard/simulator
 *   Options Bot      /bot
 *
 * ‼️ BrainHeart WAS THE POST-LOGIN LANDING PAGE, so removing its line without moving the
 * redirect would have dropped every login onto a page with no sidebar entry pointing at it.
 * src/app/page.tsx and src/components/login-form.tsx now land on /dashboard/today, which the
 * old comment here already described as the question every morning starts with.
 *
 * ‼️ A STORED NAV PREFERENCE NAMING A REMOVED href IS HARMLESS. applyOrder() only ranks items
 * that exist in the section it is given, and `hidden` is matched by href, so a stale entry for
 * /bot or /dashboard/simulator sorts and hides nothing. Nobody has to clear their preferences.
 */
export const navSections: NavSection[] = [
  {
    label: "Main",
    items: [
      // ‼️ FIRST, BECAUSE IT IS THE QUESTION EVERY MORNING STARTS WITH, and as of this change it
      // is also where logging in lands, so the two finally agree.
      { label: "Today", href: "/dashboard/today", icon: Sunrise },
      // ‼️ SECOND, AND IT IS THE ONLY WAY INTO THE LAUNCH LANE FROM THE CHROME.
      // /dashboard/launch has existed since the lane shipped and was reachable only by typing the
      // URL, which is why onboarding a client meant finding an old message with the link in it.
      // Matthew asked for it near the top; the order below is a default a person can change, see
      // nav-customize.tsx.
      { label: "Onboarding", href: "/dashboard/launch", icon: Rocket },
      { label: "Vektor", href: "/dashboard/assistant", icon: MessageSquare },
      // ‼️ THE BOARD SITS BESIDE THE LIST, NOT INSTEAD OF IT. /dashboard/leads answers "find me
      // this one lead" and sorts, filters and searches thousands of rows to do it. The pipeline
      // answers "what does the book look like", which a list of 2,400 rows cannot. Neither is a
      // view mode of the other and collapsing them would make one of the two questions harder.
      { label: "Pipeline", href: "/dashboard/pipeline", icon: KanbanSquare },
      { label: "Call list", href: "/dashboard/worklist", icon: PhoneCall },
      { label: "Leads", href: "/dashboard/leads", icon: Users },
      // Clients we deliver for. Not /dashboard/onboarding, which is our own
      // team-member setup checklist and a different thing entirely.
      { label: "Clients", href: "/dashboard/clients", icon: Building2 },
      { label: "Tasks", href: "/dashboard/tasks", icon: CheckSquare },
      // ‼️ FIVE LINES BECAME ONE DOOR, AND THE FIVE PAGES ARE UNTOUCHED BEHIND IT.
      // Templates, Sequences, Email Director, Automations and Campaigns are all still at their
      // own URLs; /dashboard/operations is an index that links to them and nothing more. It was
      // built as an index rather than as five tabs because the five routes do not share a path
      // segment, so a shared Next layout would have meant moving four folders and breaking every
      // link already pasted into a thread, for a tab strip.
      //
      // ‼️ AND IT LIVES IN Main RATHER THAN IN ITS OWN SECTION. A section header reading
      // OPERATIONS above a single line reading Operations is a heading that describes one thing,
      // which is a heading doing no work.
      { label: "Operations", href: "/dashboard/operations", icon: Zap },
    ],
  },
  {
    label: "System",
    items: [
      { label: "Integrations", href: "/dashboard/integrations", icon: LayoutList },
      { label: "Settings", href: "/dashboard/settings", icon: Settings },
    ],
  },
];

// Flat list for backwards compat
export const navItems = navSections.flatMap((s) => s.items);
