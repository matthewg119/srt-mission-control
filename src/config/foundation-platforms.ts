// The foundation listings. The SECOND registry, and the reason it is a second one.
//
// ‼️ THIS IS NOT A TIER OF presence-platforms.ts AND MERGING THE TWO WOULD PRODUCE A CARD
// TELLING A MED SPA TO LIST ON AN AI TOOL DIRECTORY. Read that sentence before adding a row
// anywhere. The two registries answer two different questions about two different kinds of owner:
//
//   presence-platforms.ts   19 local-citation platforms. The question is "does the same name,
//                           address and phone appear everywhere", the work is a SWEEP, the
//                           evidence is a screenshot, and the gate is SWEEP_GATE_COUNT = 4.
//                           A clinic has a NAP problem. SRT does not.
//
//   this file               138 launch, SaaS, AI tool, review, agency, startup and business
//                           directories. The question is "is there a record of us here at all",
//                           the work is a SUBMISSION, the evidence is a live URL, and there is
//                           no gate because a listing going live is somebody else's decision and
//                           not ours to count.
//
// One table with a tier flag was the alternative and it is the thing being refused. A med spa
// does not belong on theresanaiforthat.com, an AEO agency does not belong on RealSelf, and a flag
// on one list is how both of those end up on one card anyway.
//
// ‼️ DO NOT ADD ROWS TO presence-platforms.ts AND DO NOT MOVE ROWS BETWEEN THE FILES.
// `chamber` there is the LOCAL chamber of commerce, swept through a Google search page.
// `chamberofcommerce` here is chamberofcommerce.com, a national directory we submit to. Two
// platforms, two registries, and the near-identical names are exactly why both keys say which is
// which. scripts/_probe-foundation-listings.ts asserts the two key sets never intersect.
//
// ─── WHERE THE LIST CAME FROM, STATED ───────────────────────────────────────────────────────
//
// ‼️ THIS IS *A* 138, ASSEMBLED HERE ON 2026-09-29, NOT A TRANSCRIPTION OF A LIST HELD ELSEWHERE.
// Every row is a platform that exists and takes submissions. Nothing is padded with a domain
// nobody has opened. If Matthew has a specific 138 on a spreadsheet, reconciling the two is a
// diff against this file, and the keys are stable so that diff is readable.
//
// `submitUrl` is where a HUMAN goes. Nothing in this system submits anything, so the worst case
// for a URL that has moved is ten seconds and a note in the thread, which is the whole reason the
// registry is allowed to carry 138 rows without 138 verified round trips. A row whose submit route
// is known to be unusual says so in `note` rather than pretending it is a form.
//
// ─── WHAT IS DELIBERATELY ABSENT ────────────────────────────────────────────────────────────
//
// No forums, no comment sections, no community feeds. Hacker News, Reddit, Indie Hackers and
// their neighbours would all raise a domain's numbers and every one of them is a place a person
// POSTS rather than a place a business is LISTED. The build this file belongs to states the rule
// flatly: nothing posts to a forum, a comment section, or a profile. A registry that listed them
// as submission targets would be the first draft of breaking it.
//
// No presence platform, for the reason at the top. No marketplace that takes a revenue share,
// because that is a commercial decision and not a listing.

/**
 * What KIND of record a platform holds, which is the only thing that decides whether an owner
 * belongs on it.
 *
 * ‼️ THE TYPE IS A FACT ABOUT THE PLATFORM. WHICH TYPES AN OWNER BELONGS ON IS A FACT ABOUT THE
 * OWNER, and it lives on the owner, never here. This is the same separation presence-platforms.ts
 * arrived at the hard way: it kept ONE list of nineteen and moved the choosing onto
 * client_audiences.presence_platform_keys, because the alternative was a taco shop being asked
 * for a RealSelf profile. Same rule, same reason. See foundationPlatformsFor() below.
 */
export type FoundationType =
  /** A dated launch. Product Hunt and its neighbours: one shot, a queue, and a day it goes live. */
  | "launch"
  /** AI tool directories. A software product with a model behind it. Never a clinic. */
  | "ai_directory"
  /** Software catalogues. A listing, a category and an alternatives page. */
  | "saas_directory"
  /** Where a REVIEW is left, not just a record kept. A listing here invites third-party text. */
  | "review_platform"
  /** Where a service business is shortlisted by a buyer. Clutch and its family. */
  | "agency_directory"
  /** Company and funding databases. A record of the entity rather than of the product. */
  | "startup_directory"
  /** General company directories. Footprint, not shortlist: nobody buys here, engines read it. */
  | "business_directory";

export interface FoundationPlatform {
  /**
   * Stable slug. This is what lands in listing_submissions.platform_key, so it never gets
   * reworded. A rename is a new key plus a migration, exactly as with a step key.
   */
  key: string;
  label: string;
  /** Where a person goes to submit. Never fetched by this system; see the header. */
  submitUrl: string;
  type: FoundationType;
  /**
   * Roughly how strong the domain is, rounded to the nearest five.
   *
   * ‼️ A BAND FOR SEQUENCING, NOT A MEASUREMENT, AND NOTHING MAY REPORT IT TO A CLIENT AS ONE.
   * It exists so 138 rows can be worked highest-value first instead of alphabetically. Ahrefs is
   * not keyed in this environment and these are read-off-the-public-checker numbers as of
   * 2026-09, so treating 70 and 72 as different would be inventing precision. Rounded to five so
   * the shape of the number says what it is.
   */
  dr: number;
  /**
   * What it costs to get listed BY THE ROUTE IN submitUrl, in cents.
   *
   * ‼️ THE FREE ROUTE IS THE ROUTE. Most of these sell a paid skip past a queue that is weeks
   * long; that is an option a person chooses in the moment, so it goes in `note` and this stays
   * 0. A non-zero value here means there is no free way in at all.
   */
  costCents: number;
  /** Whether reaching the form needs an account made first. Changes how long the first one takes. */
  needsAccount: boolean;
  /** Roughly how long ONE submission runs, once the description already exists. */
  minutes: number;
  /** Why this one is worth the minutes, or what is odd about it. Absent when there is nothing to say. */
  note?: string;
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// launch
// ────────────────────────────────────────────────────────────────────────────────────────────
const LAUNCH: FoundationPlatform[] = [
  { key: "producthunt", label: "Product Hunt", submitUrl: "https://www.producthunt.com/posts/new", type: "launch", dr: 90, costCents: 0, needsAccount: true, minutes: 45, note: "One shot per product and the day matters. Schedule it; do not fire it off between other rows." },
  { key: "betalist", label: "BetaList", submitUrl: "https://betalist.com/submit", type: "launch", dr: 70, costCents: 0, needsAccount: true, minutes: 20, note: "The free queue runs weeks. A paid skip exists and is a decision for the day, not a default." },
  { key: "peerlist", label: "Peerlist Projects", submitUrl: "https://peerlist.io/", type: "launch", dr: 60, costCents: 0, needsAccount: true, minutes: 20, note: "The project lives under a personal profile, so decide whose before starting." },
  { key: "alltopstartups", label: "AllTopStartups", submitUrl: "https://alltopstartups.com/submit-startup/", type: "launch", dr: 55, costCents: 0, needsAccount: false, minutes: 10 },
  { key: "killerstartups", label: "KillerStartups", submitUrl: "https://www.killerstartups.com/submit-startup/", type: "launch", dr: 55, costCents: 0, needsAccount: false, minutes: 10 },
  { key: "launchingnext", label: "Launching Next", submitUrl: "https://www.launchingnext.com/submit/", type: "launch", dr: 50, costCents: 0, needsAccount: false, minutes: 10 },
  { key: "techpluto", label: "TechPluto", submitUrl: "https://www.techpluto.com/submit-a-startup/", type: "launch", dr: 50, costCents: 0, needsAccount: false, minutes: 10 },
  { key: "betabound", label: "Betabound", submitUrl: "https://www.betabound.com/announce/", type: "launch", dr: 50, costCents: 0, needsAccount: true, minutes: 20, note: "Wants a real beta with testers to take. Skip it for anything already generally available." },
  { key: "betapage", label: "BetaPage", submitUrl: "https://betapage.co/submit-startup", type: "launch", dr: 45, costCents: 0, needsAccount: true, minutes: 15 },
  { key: "startupbase", label: "StartupBase", submitUrl: "https://startupbase.io/submit", type: "launch", dr: 45, costCents: 0, needsAccount: true, minutes: 15 },
  { key: "sideprojectors", label: "SideProjectors", submitUrl: "https://www.sideprojectors.com/project/submit", type: "launch", dr: 45, costCents: 0, needsAccount: true, minutes: 15 },
  { key: "uneed", label: "Uneed", submitUrl: "https://www.uneed.best/submit-a-tool", type: "launch", dr: 45, costCents: 0, needsAccount: true, minutes: 15 },
  { key: "devhunt", label: "DevHunt", submitUrl: "https://devhunt.org/", type: "launch", dr: 40, costCents: 0, needsAccount: true, minutes: 20, note: "Developer tools only. A service business has nothing to list here." },
  { key: "startupfame", label: "Startup Fame", submitUrl: "https://startupfa.me/", type: "launch", dr: 40, costCents: 0, needsAccount: true, minutes: 15 },
  { key: "startupbuffer", label: "Startup Buffer", submitUrl: "https://startupbuffer.com/", type: "launch", dr: 40, costCents: 0, needsAccount: true, minutes: 10 },
  { key: "microlaunch", label: "MicroLaunch", submitUrl: "https://microlaunch.net/", type: "launch", dr: 35, costCents: 0, needsAccount: true, minutes: 15 },
  { key: "fazier", label: "Fazier", submitUrl: "https://fazier.com/", type: "launch", dr: 35, costCents: 0, needsAccount: true, minutes: 15 },
  { key: "startupinspire", label: "Startup Inspire", submitUrl: "https://www.startupinspire.com/", type: "launch", dr: 35, costCents: 0, needsAccount: true, minutes: 10 },
  { key: "tinylaunch", label: "TinyLaunch", submitUrl: "https://www.tinylaun.ch/", type: "launch", dr: 30, costCents: 0, needsAccount: true, minutes: 10 },
  { key: "tinystartups", label: "Tiny Startups", submitUrl: "https://www.tinystartups.com/", type: "launch", dr: 30, costCents: 0, needsAccount: true, minutes: 10 },
  { key: "launchigniter", label: "LaunchIgniter", submitUrl: "https://launchigniter.com/", type: "launch", dr: 25, costCents: 0, needsAccount: true, minutes: 10 },
  { key: "openhunts", label: "OpenHunts", submitUrl: "https://openhunts.com/", type: "launch", dr: 25, costCents: 0, needsAccount: true, minutes: 10 },
];

// ────────────────────────────────────────────────────────────────────────────────────────────
// ai_directory
//
// ‼️ THE TYPE THIS WHOLE FILE EXISTS TO KEEP AWAY FROM A CLINIC. A med spa on an AI tool
// directory is the worked example in the build doc, and it is not a hypothetical: one list with a
// tier flag produces exactly that card. Nothing selects these types for a client unless a person
// put them on the owner.
// ────────────────────────────────────────────────────────────────────────────────────────────
const AI_DIRECTORY: FoundationPlatform[] = [
  { key: "theresanaiforthat", label: "There's An AI For That", submitUrl: "https://theresanaiforthat.com/add/", type: "ai_directory", dr: 80, costCents: 0, needsAccount: true, minutes: 20, note: "The one with the traffic. Free queue is slow and a paid fast-track exists." },
  { key: "futurepedia", label: "Futurepedia", submitUrl: "https://www.futurepedia.io/submit-tool", type: "ai_directory", dr: 75, costCents: 0, needsAccount: true, minutes: 20 },
  { key: "futuretools", label: "Future Tools", submitUrl: "https://www.futuretools.io/submit-a-tool", type: "ai_directory", dr: 70, costCents: 0, needsAccount: false, minutes: 10, note: "Hand curated. A submission is a suggestion and most are not taken." },
  { key: "toolify", label: "Toolify", submitUrl: "https://www.toolify.ai/submit", type: "ai_directory", dr: 65, costCents: 0, needsAccount: true, minutes: 15 },
  { key: "aitoolhunt", label: "AI Tool Hunt", submitUrl: "https://www.aitoolhunt.com/submit-tool", type: "ai_directory", dr: 55, costCents: 0, needsAccount: false, minutes: 10 },
  { key: "topaitools", label: "TopAI.tools", submitUrl: "https://topai.tools/submit", type: "ai_directory", dr: 55, costCents: 0, needsAccount: true, minutes: 10 },
  { key: "easywithai", label: "Easy With AI", submitUrl: "https://easywithai.com/submit-tool/", type: "ai_directory", dr: 55, costCents: 0, needsAccount: false, minutes: 10 },
  { key: "aitoolsfyi", label: "aitools.fyi", submitUrl: "https://aitools.fyi/submit", type: "ai_directory", dr: 50, costCents: 0, needsAccount: true, minutes: 10 },
  { key: "allthingsai", label: "All Things AI", submitUrl: "https://allthingsai.com/submit", type: "ai_directory", dr: 50, costCents: 0, needsAccount: false, minutes: 10 },
  { key: "insidrai", label: "Insidr AI", submitUrl: "https://www.insidr.ai/", type: "ai_directory", dr: 50, costCents: 0, needsAccount: false, minutes: 10 },
  { key: "supertools", label: "Supertools", submitUrl: "https://supertools.therundown.ai/", type: "ai_directory", dr: 50, costCents: 0, needsAccount: false, minutes: 10 },
  { key: "aixploria", label: "Aixploria", submitUrl: "https://www.aixploria.com/en/add-your-ai/", type: "ai_directory", dr: 50, costCents: 0, needsAccount: false, minutes: 10 },
  { key: "aitoolsdirectory", label: "AI Tools Directory", submitUrl: "https://aitoolsdirectory.com/submit", type: "ai_directory", dr: 45, costCents: 0, needsAccount: false, minutes: 10 },
  { key: "openfutureai", label: "Open Future AI", submitUrl: "https://openfuture.ai/", type: "ai_directory", dr: 45, costCents: 0, needsAccount: true, minutes: 15 },
  { key: "aitoptools", label: "AI Top Tools", submitUrl: "https://aitoptools.com/", type: "ai_directory", dr: 45, costCents: 0, needsAccount: true, minutes: 10 },
  { key: "aivalley", label: "AI Valley", submitUrl: "https://aivalley.ai/", type: "ai_directory", dr: 45, costCents: 0, needsAccount: false, minutes: 10 },
  { key: "saasaitools", label: "SaaS AI Tools", submitUrl: "https://saasaitools.com/", type: "ai_directory", dr: 45, costCents: 0, needsAccount: false, minutes: 10 },
  { key: "dangai", label: "Dang.ai", submitUrl: "https://dang.ai/submit", type: "ai_directory", dr: 45, costCents: 0, needsAccount: true, minutes: 10 },
  { key: "aitoolnet", label: "AIToolNet", submitUrl: "https://www.aitoolnet.com/", type: "ai_directory", dr: 45, costCents: 0, needsAccount: false, minutes: 10 },
  { key: "gpte", label: "GPTE.ai", submitUrl: "https://gpte.ai/", type: "ai_directory", dr: 45, costCents: 0, needsAccount: false, minutes: 10 },
  { key: "thataicollection", label: "That AI Collection", submitUrl: "https://thataicollection.com/", type: "ai_directory", dr: 40, costCents: 0, needsAccount: false, minutes: 10 },
  { key: "findmyaitool", label: "Find My AI Tool", submitUrl: "https://findmyaitool.com/", type: "ai_directory", dr: 35, costCents: 0, needsAccount: false, minutes: 10 },
  { key: "toolpilot", label: "ToolPilot", submitUrl: "https://www.toolpilot.ai/", type: "ai_directory", dr: 35, costCents: 0, needsAccount: true, minutes: 10 },
];

// ────────────────────────────────────────────────────────────────────────────────────────────
// saas_directory
// ────────────────────────────────────────────────────────────────────────────────────────────
const SAAS_DIRECTORY: FoundationPlatform[] = [
  { key: "sourceforge", label: "SourceForge", submitUrl: "https://sourceforge.net/create/", type: "saas_directory", dr: 90, costCents: 0, needsAccount: true, minutes: 30, note: "Feeds Slashdot from the same record, so do this one first of the pair." },
  { key: "slashdot", label: "Slashdot Software", submitUrl: "https://slashdot.org/software/", type: "saas_directory", dr: 90, costCents: 0, needsAccount: true, minutes: 20, note: "Shares its catalogue with SourceForge. Check whether the listing already arrived before filling a second form." },
  { key: "alternativeto", label: "AlternativeTo", submitUrl: "https://alternativeto.net/manage/new-app/", type: "saas_directory", dr: 80, costCents: 0, needsAccount: true, minutes: 20, note: "The alternatives page is the point. Name the incumbents honestly; the community edits it either way." },
  { key: "stackshare", label: "StackShare", submitUrl: "https://stackshare.io/", type: "saas_directory", dr: 75, costCents: 0, needsAccount: true, minutes: 20 },
  { key: "financesonline", label: "FinancesOnline", submitUrl: "https://financesonline.com/submit-software-for-review/", type: "saas_directory", dr: 75, costCents: 0, needsAccount: true, minutes: 25 },
  { key: "saashub", label: "SaaSHub", submitUrl: "https://www.saashub.com/submit", type: "saas_directory", dr: 70, costCents: 0, needsAccount: true, minutes: 15 },
  { key: "softwaresuggest", label: "SoftwareSuggest", submitUrl: "https://www.softwaresuggest.com/vendors", type: "saas_directory", dr: 70, costCents: 0, needsAccount: true, minutes: 25, note: "A sales call usually follows. The free listing is real; expect the follow-up." },
  { key: "crozdesk", label: "Crozdesk", submitUrl: "https://crozdesk.com/vendors", type: "saas_directory", dr: 65, costCents: 0, needsAccount: true, minutes: 25 },
  { key: "saasworthy", label: "SaaSworthy", submitUrl: "https://www.saasworthy.com/", type: "saas_directory", dr: 65, costCents: 0, needsAccount: true, minutes: 20 },
  { key: "slant", label: "Slant", submitUrl: "https://www.slant.co/", type: "saas_directory", dr: 65, costCents: 0, needsAccount: true, minutes: 15 },
  { key: "tekpon", label: "Tekpon", submitUrl: "https://tekpon.com/", type: "saas_directory", dr: 60, costCents: 0, needsAccount: true, minutes: 20 },
  { key: "serchen", label: "Serchen", submitUrl: "https://www.serchen.com/add-listing/", type: "saas_directory", dr: 60, costCents: 0, needsAccount: true, minutes: 20 },
  { key: "comparecamp", label: "CompareCamp", submitUrl: "https://comparecamp.com/", type: "saas_directory", dr: 60, costCents: 0, needsAccount: true, minutes: 20 },
  { key: "cuspera", label: "Cuspera", submitUrl: "https://www.cuspera.com/", type: "saas_directory", dr: 55, costCents: 0, needsAccount: true, minutes: 20 },
  { key: "softwareworld", label: "SoftwareWorld", submitUrl: "https://www.softwareworld.co/", type: "saas_directory", dr: 55, costCents: 0, needsAccount: true, minutes: 20 },
  { key: "itqlick", label: "ITQlick", submitUrl: "https://www.itqlick.com/", type: "saas_directory", dr: 55, costCents: 0, needsAccount: true, minutes: 20 },
  { key: "webcatalog", label: "WebCatalog", submitUrl: "https://webcatalog.io/", type: "saas_directory", dr: 55, costCents: 0, needsAccount: false, minutes: 10, note: "Wants a web app it can wrap in a desktop shell. A marketing site alone is not a fit." },
  { key: "saasgenius", label: "SaaS Genius", submitUrl: "https://www.saasgenius.com/", type: "saas_directory", dr: 50, costCents: 0, needsAccount: true, minutes: 20 },
];

// ────────────────────────────────────────────────────────────────────────────────────────────
// review_platform
//
// ‼️ TRUSTPILOT, YELP, BBB AND FACEBOOK ARE NOT HERE AND MUST NOT BE ADDED. All four are rows in
// presence-platforms.ts, where they are SWEPT for consistency. Listing one here too would make
// "is the Trustpilot profile claimed" a question with two answers in two tables.
// ────────────────────────────────────────────────────────────────────────────────────────────
const REVIEW_PLATFORM: FoundationPlatform[] = [
  { key: "g2", label: "G2", submitUrl: "https://www.g2.com/products/new", type: "review_platform", dr: 90, costCents: 0, needsAccount: true, minutes: 45, note: "The heaviest listing here and the one engines quote. Budget the time; a thin profile is worse than none." },
  { key: "capterra", label: "Capterra", submitUrl: "https://www.capterra.com/vendors/sign-up", type: "review_platform", dr: 90, costCents: 0, needsAccount: true, minutes: 40, note: "One Gartner Digital Markets submission feeds Capterra, GetApp and Software Advice. Do this one, then verify the other two arrived." },
  { key: "gartnerpeerinsights", label: "Gartner Peer Insights", submitUrl: "https://www.gartner.com/reviews/", type: "review_platform", dr: 90, costCents: 0, needsAccount: true, minutes: 40, note: "Separate from Digital Markets and slower. Needs a named vendor contact." },
  { key: "glassdoor", label: "Glassdoor", submitUrl: "https://www.glassdoor.com/employers/", type: "review_platform", dr: 90, costCents: 0, needsAccount: true, minutes: 25, note: "An EMPLOYER profile, so what it invites is staff reviews and not customer ones. Real footprint, different risk. Decide deliberately." },
  { key: "getapp", label: "GetApp", submitUrl: "https://www.getapp.com/", type: "review_platform", dr: 85, costCents: 0, needsAccount: true, minutes: 20, note: "Usually arrives from the Capterra submission. Verify rather than re-submit." },
  { key: "softwareadvice", label: "Software Advice", submitUrl: "https://www.softwareadvice.com/", type: "review_platform", dr: 85, costCents: 0, needsAccount: true, minutes: 20, note: "Third of the Gartner Digital Markets trio. Verify rather than re-submit." },
  { key: "trustradius", label: "TrustRadius", submitUrl: "https://www.trustradius.com/vendors", type: "review_platform", dr: 80, costCents: 0, needsAccount: true, minutes: 35 },
  { key: "sitejabber", label: "Sitejabber", submitUrl: "https://www.sitejabber.com/", type: "review_platform", dr: 75, costCents: 0, needsAccount: true, minutes: 20, note: "Often already has an unclaimed profile. Search before creating one." },
  { key: "featuredcustomers", label: "FeaturedCustomers", submitUrl: "https://www.featuredcustomers.com/", type: "review_platform", dr: 70, costCents: 0, needsAccount: true, minutes: 25, note: "Case studies rather than star ratings. Needs a client willing to be named." },
  { key: "reviewsio", label: "Reviews.io", submitUrl: "https://www.reviews.io/", type: "review_platform", dr: 70, costCents: 0, needsAccount: true, minutes: 20 },
  { key: "resellerratings", label: "ResellerRatings", submitUrl: "https://www.resellerratings.com/", type: "review_platform", dr: 65, costCents: 0, needsAccount: true, minutes: 20 },
];

// ────────────────────────────────────────────────────────────────────────────────────────────
// agency_directory
//
// SRT's own lane. A buyer shortlisting an agency starts on Clutch, and an engine asked to name
// one reads the same pages.
// ────────────────────────────────────────────────────────────────────────────────────────────
const AGENCY_DIRECTORY: FoundationPlatform[] = [
  { key: "googlepartners", label: "Google Partners", submitUrl: "https://www.google.com/partners/", type: "agency_directory", dr: 95, costCents: 0, needsAccount: true, minutes: 60, note: "Gated on managed Ads spend and certifications. Check eligibility before spending the hour." },
  { key: "metapartners", label: "Meta Business Partners", submitUrl: "https://www.facebook.com/business/partner-directory", type: "agency_directory", dr: 95, costCents: 0, needsAccount: true, minutes: 60, note: "Gated on managed spend. Same eligibility check as Google Partners." },
  { key: "semrushagencies", label: "Semrush Agency Partners", submitUrl: "https://www.semrush.com/agencies/", type: "agency_directory", dr: 90, costCents: 0, needsAccount: true, minutes: 35, note: "The free tier lists; the paid tier ranks. The free listing is the row." },
  { key: "hubspotsolutions", label: "HubSpot Solutions Directory", submitUrl: "https://ecosystem.hubspot.com/marketplace/solutions", type: "agency_directory", dr: 90, costCents: 0, needsAccount: true, minutes: 60, note: "Needs a partner tier, which is a commercial commitment and not a form. Park it unless that is already true." },
  { key: "clutch", label: "Clutch", submitUrl: "https://clutch.co/get-listed", type: "agency_directory", dr: 85, costCents: 0, needsAccount: true, minutes: 60, note: "The one buyers actually read. A listing is free; the ranking wants verified client interviews, which take a client's time." },
  { key: "bark", label: "Bark", submitUrl: "https://www.bark.com/", type: "agency_directory", dr: 75, costCents: 0, needsAccount: true, minutes: 20, note: "A lead marketplace as much as a directory. Listing is free, responding to a lead is paid." },
  { key: "goodfirms", label: "GoodFirms", submitUrl: "https://www.goodfirms.co/get-listed", type: "agency_directory", dr: 75, costCents: 0, needsAccount: true, minutes: 45 },
  { key: "designrush", label: "DesignRush", submitUrl: "https://www.designrush.com/agency/submit", type: "agency_directory", dr: 70, costCents: 0, needsAccount: true, minutes: 30 },
  { key: "upcity", label: "UpCity", submitUrl: "https://upcity.com/get-listed/", type: "agency_directory", dr: 70, costCents: 0, needsAccount: true, minutes: 30 },
  { key: "themanifest", label: "The Manifest", submitUrl: "https://themanifest.com/", type: "agency_directory", dr: 70, costCents: 0, needsAccount: true, minutes: 25, note: "Clutch's sibling and fed from the same profile. Do Clutch first." },
  { key: "sortlist", label: "Sortlist", submitUrl: "https://www.sortlist.com/", type: "agency_directory", dr: 70, costCents: 0, needsAccount: true, minutes: 30 },
  { key: "expertise", label: "Expertise.com", submitUrl: "https://www.expertise.com/", type: "agency_directory", dr: 70, costCents: 0, needsAccount: false, minutes: 15, note: "Nomination based rather than a submission form. The ask is an email, which is why the minutes are low and the odds are not." },
  { key: "visualobjects", label: "Visual Objects", submitUrl: "https://visualobjects.com/", type: "agency_directory", dr: 65, costCents: 0, needsAccount: true, minutes: 25, note: "Third of the Clutch family. Portfolio images carry it." },
  { key: "digitalagencynetwork", label: "Digital Agency Network", submitUrl: "https://digitalagencynetwork.com/", type: "agency_directory", dr: 65, costCents: 0, needsAccount: true, minutes: 25 },
  { key: "agencyspotter", label: "Agency Spotter", submitUrl: "https://www.agencyspotter.com/", type: "agency_directory", dr: 60, costCents: 0, needsAccount: true, minutes: 30 },
  { key: "credo", label: "Credo", submitUrl: "https://credo.com/", type: "agency_directory", dr: 60, costCents: 0, needsAccount: true, minutes: 30, note: "Vetted, so a submission is an application. Expect a call." },
  { key: "threebestrated", label: "Three Best Rated", submitUrl: "https://threebestrated.com/", type: "agency_directory", dr: 60, costCents: 0, needsAccount: false, minutes: 10, note: "Editorially picked. There is no form worth the name; the row exists so nobody keeps looking for one." },
  { key: "agencyvista", label: "Agency Vista", submitUrl: "https://agencyvista.com/", type: "agency_directory", dr: 55, costCents: 0, needsAccount: true, minutes: 25 },
  { key: "topseos", label: "TopSEOs", submitUrl: "https://www.topseos.com/", type: "agency_directory", dr: 55, costCents: 0, needsAccount: true, minutes: 20 },
];

// ────────────────────────────────────────────────────────────────────────────────────────────
// startup_directory
// ────────────────────────────────────────────────────────────────────────────────────────────
const STARTUP_DIRECTORY: FoundationPlatform[] = [
  { key: "crunchbase", label: "Crunchbase", submitUrl: "https://www.crunchbase.com/", type: "startup_directory", dr: 90, costCents: 0, needsAccount: true, minutes: 40, note: "The entity record engines fall back on when they cannot find anything else. Worth doing properly once." },
  { key: "wellfound", label: "Wellfound", submitUrl: "https://wellfound.com/", type: "startup_directory", dr: 85, costCents: 0, needsAccount: true, minutes: 35, note: "Formerly AngelList Talent. The company profile is the listing; a job post is not required." },
  { key: "f6s", label: "F6S", submitUrl: "https://www.f6s.com/", type: "startup_directory", dr: 75, costCents: 0, needsAccount: true, minutes: 25 },
  { key: "owler", label: "Owler", submitUrl: "https://www.owler.com/", type: "startup_directory", dr: 75, costCents: 0, needsAccount: true, minutes: 20, note: "Usually already has a scraped profile. Claim and correct rather than create." },
  { key: "startupstash", label: "Startup Stash", submitUrl: "https://startupstash.com/add-listing/", type: "startup_directory", dr: 70, costCents: 0, needsAccount: true, minutes: 20 },
  { key: "gust", label: "Gust", submitUrl: "https://gust.com/", type: "startup_directory", dr: 70, costCents: 0, needsAccount: true, minutes: 25 },
  { key: "dealroom", label: "Dealroom", submitUrl: "https://dealroom.co/", type: "startup_directory", dr: 70, costCents: 0, needsAccount: true, minutes: 25 },
  { key: "startupblink", label: "StartupBlink", submitUrl: "https://www.startupblink.com/", type: "startup_directory", dr: 65, costCents: 0, needsAccount: true, minutes: 20 },
  { key: "startupranking", label: "StartupRanking", submitUrl: "https://www.startupranking.com/", type: "startup_directory", dr: 60, costCents: 0, needsAccount: true, minutes: 15 },
];

// ────────────────────────────────────────────────────────────────────────────────────────────
// business_directory
//
// Footprint. Nobody buys from these and that is not what they are for: they are the corroborating
// records an engine reads when it is deciding whether a company is real.
//
// ‼️ THE ONE TYPE A LOCAL SERVICE BUSINESS GENUINELY BELONGS ON, which is why it is here and not
// in presence-platforms.ts. The difference is the verb. presence-platforms SWEEPS nineteen
// platforms for NAP consistency and files a screenshot. These are SUBMITTED to and produce a live
// URL. Same clinic, two different pieces of work, and a card that blurred them would ask for a
// screenshot of a listing nobody has made yet.
// ────────────────────────────────────────────────────────────────────────────────────────────
const BUSINESS_DIRECTORY: FoundationPlatform[] = [
  { key: "dnb", label: "Dun & Bradstreet", submitUrl: "https://www.dnb.com/", type: "business_directory", dr: 90, costCents: 0, needsAccount: true, minutes: 30, note: "A D-U-N-S number is free and slow. Start it early; a couple of the others ask for it." },
  { key: "zoominfo", label: "ZoomInfo", submitUrl: "https://www.zoominfo.com/business/contact-zoominfo", type: "business_directory", dr: 85, costCents: 0, needsAccount: true, minutes: 20, note: "Claim and correct. The profile already exists and is usually wrong." },
  { key: "thomasnet", label: "Thomasnet", submitUrl: "https://www.thomasnet.com/", type: "business_directory", dr: 80, costCents: 0, needsAccount: true, minutes: 25, note: "Industrial and B2B supply. A fit for a manufacturer, not for a clinic." },
  { key: "opencorporates", label: "OpenCorporates", submitUrl: "https://opencorporates.com/", type: "business_directory", dr: 80, costCents: 0, needsAccount: false, minutes: 10, note: "Mirrors the state registry, so there is nothing to submit. The work is confirming the legal name matches what every other listing says." },
  { key: "bizapedia", label: "Bizapedia", submitUrl: "https://www.bizapedia.com/", type: "business_directory", dr: 70, costCents: 0, needsAccount: false, minutes: 10, note: "Also a registry mirror. Verify, do not create." },
  { key: "merchantcircle", label: "MerchantCircle", submitUrl: "https://www.merchantcircle.com/", type: "business_directory", dr: 70, costCents: 0, needsAccount: true, minutes: 15 },
  { key: "chamberofcommerce", label: "ChamberOfCommerce.com", submitUrl: "https://www.chamberofcommerce.com/", type: "business_directory", dr: 70, costCents: 0, needsAccount: true, minutes: 15, note: "‼️ NOT the local chamber. That is `chamber` in presence-platforms.ts, a different platform swept a different way." },
  { key: "local", label: "Local.com", submitUrl: "https://www.local.com/", type: "business_directory", dr: 70, costCents: 0, needsAccount: true, minutes: 10 },
  { key: "kompass", label: "Kompass", submitUrl: "https://us.kompass.com/", type: "business_directory", dr: 70, costCents: 0, needsAccount: true, minutes: 20 },
  { key: "buzzfile", label: "Buzzfile", submitUrl: "https://www.buzzfile.com/", type: "business_directory", dr: 60, costCents: 0, needsAccount: false, minutes: 10 },
  { key: "cybo", label: "Cybo", submitUrl: "https://www.cybo.com/", type: "business_directory", dr: 60, costCents: 0, needsAccount: true, minutes: 10 },
  { key: "brownbook", label: "Brownbook", submitUrl: "https://www.brownbook.net/", type: "business_directory", dr: 60, costCents: 0, needsAccount: true, minutes: 10 },
  { key: "elocal", label: "eLocal", submitUrl: "https://www.elocal.com/", type: "business_directory", dr: 60, costCents: 0, needsAccount: true, minutes: 15 },
  { key: "cylex", label: "Cylex", submitUrl: "https://www.cylex.us.com/", type: "business_directory", dr: 55, costCents: 0, needsAccount: true, minutes: 10 },
  { key: "citysquares", label: "CitySquares", submitUrl: "https://citysquares.com/", type: "business_directory", dr: 55, costCents: 0, needsAccount: true, minutes: 10 },
  { key: "tuugo", label: "Tuugo", submitUrl: "https://www.tuugo.us/", type: "business_directory", dr: 55, costCents: 0, needsAccount: true, minutes: 10 },
  { key: "yellowbot", label: "YellowBot", submitUrl: "https://www.yellowbot.com/", type: "business_directory", dr: 55, costCents: 0, needsAccount: true, minutes: 10 },
  { key: "salespider", label: "SaleSpider", submitUrl: "https://www.salespider.com/", type: "business_directory", dr: 50, costCents: 0, needsAccount: true, minutes: 10 },
  { key: "showmelocal", label: "ShowMeLocal", submitUrl: "https://www.showmelocal.com/", type: "business_directory", dr: 50, costCents: 0, needsAccount: true, minutes: 10 },
  { key: "ezlocal", label: "EZlocal", submitUrl: "https://ezlocal.com/", type: "business_directory", dr: 50, costCents: 0, needsAccount: true, minutes: 10 },
  { key: "opendi", label: "Opendi", submitUrl: "https://www.opendi.us/", type: "business_directory", dr: 50, costCents: 0, needsAccount: true, minutes: 10 },
  { key: "fyple", label: "Fyple", submitUrl: "https://www.fyple.com/", type: "business_directory", dr: 50, costCents: 0, needsAccount: true, minutes: 10 },
  { key: "iglobal", label: "iGlobal", submitUrl: "https://www.iglobal.co/", type: "business_directory", dr: 50, costCents: 0, needsAccount: true, minutes: 10 },
  { key: "storeboard", label: "Storeboard", submitUrl: "https://www.storeboard.com/", type: "business_directory", dr: 50, costCents: 0, needsAccount: true, minutes: 10 },
  { key: "n49", label: "N49", submitUrl: "https://www.n49.com/", type: "business_directory", dr: 50, costCents: 0, needsAccount: true, minutes: 10 },
  { key: "usnetads", label: "USNetAds", submitUrl: "https://www.usnetads.com/", type: "business_directory", dr: 50, costCents: 0, needsAccount: true, minutes: 10, note: "A classifieds board rather than a directory. Lowest value row here; do it last or not at all." },
  { key: "hubbiz", label: "Hub.biz", submitUrl: "https://hub.biz/", type: "business_directory", dr: 45, costCents: 0, needsAccount: true, minutes: 10 },
  { key: "yasabe", label: "Yasabe", submitUrl: "https://www.yasabe.com/", type: "business_directory", dr: 45, costCents: 0, needsAccount: true, minutes: 10 },
  { key: "twofindlocal", label: "2FindLocal", submitUrl: "https://www.2findlocal.com/", type: "business_directory", dr: 45, costCents: 0, needsAccount: true, minutes: 10 },
  { key: "lacartes", label: "Lacartes", submitUrl: "https://www.lacartes.com/", type: "business_directory", dr: 45, costCents: 0, needsAccount: true, minutes: 10 },
  { key: "callupcontact", label: "CallUpContact", submitUrl: "https://www.callupcontact.com/", type: "business_directory", dr: 45, costCents: 0, needsAccount: true, minutes: 10 },
  { key: "ebusinesspages", label: "eBusinessPages", submitUrl: "https://www.ebusinesspages.com/", type: "business_directory", dr: 45, costCents: 0, needsAccount: true, minutes: 10 },
  { key: "finduslocal", label: "FindUsLocal", submitUrl: "https://www.finduslocal.com/", type: "business_directory", dr: 45, costCents: 0, needsAccount: true, minutes: 10 },
  { key: "freelistingusa", label: "Free Listing USA", submitUrl: "https://www.freelistingusa.com/", type: "business_directory", dr: 40, costCents: 0, needsAccount: true, minutes: 10 },
  { key: "bizhwy", label: "BizHwy", submitUrl: "https://www.bizhwy.com/", type: "business_directory", dr: 40, costCents: 0, needsAccount: true, minutes: 10 },
  { key: "wherezit", label: "Wherezit", submitUrl: "https://www.wherezit.com/", type: "business_directory", dr: 35, costCents: 0, needsAccount: true, minutes: 10 },
];

/**
 * The whole registry, highest DR first within each type, types in the order declared above.
 *
 * ‼️ ONE LIST, LIKE ALL_PLATFORMS. The type groups above are for reading the file; nothing may
 * treat them as separate registries, because then "which platforms are there" has seven answers.
 */
export const FOUNDATION_PLATFORMS: FoundationPlatform[] = [
  ...LAUNCH,
  ...AI_DIRECTORY,
  ...SAAS_DIRECTORY,
  ...REVIEW_PLATFORM,
  ...AGENCY_DIRECTORY,
  ...STARTUP_DIRECTORY,
  ...BUSINESS_DIRECTORY,
];

/**
 * The count a card quotes.
 *
 * ‼️ DERIVED, NEVER A LITERAL. presence-platforms.ts learned this: PLATFORM_COUNT is
 * ALL_PLATFORMS.length precisely so adding Trustpilot could not leave a nineteen written down as
 * an eighteen somewhere. A hardcoded 138 here would go stale the first time a dead directory is
 * dropped, and the stale number is the one a client reads.
 */
export const FOUNDATION_PLATFORM_COUNT = FOUNDATION_PLATFORMS.length;

/** Every type, in the order the registry declares them. Highest intent first, footprint last. */
export const FOUNDATION_TYPES: readonly FoundationType[] = [
  "launch",
  "ai_directory",
  "saas_directory",
  "review_platform",
  "agency_directory",
  "startup_directory",
  "business_directory",
];

/** What a type is called on a card. */
export const TYPE_LABELS: Record<FoundationType, string> = {
  launch: "Launch",
  ai_directory: "AI tool directories",
  saas_directory: "Software catalogues",
  review_platform: "Review platforms",
  agency_directory: "Agency directories",
  startup_directory: "Company databases",
  business_directory: "Business directories",
};

/**
 * The types SRT itself belongs on.
 *
 * ‼️ SIX OF THE SEVEN, AND `launch` IS EXCLUDED ON PURPOSE. A launch is a dated event for a named
 * product, so firing twenty-two of them at an agency's home page is how a Product Hunt slot gets
 * spent on nothing. When a tool is ready to launch, that is a decision somebody makes for that
 * tool and it belongs to the tool lane, not to a standing board of 138 rows.
 *
 * ‼️ A CONSTANT HERE AND A COLUMN FOR EVERYONE ELSE. There is exactly one SRT, so its answer can
 * live in code; a client's answer is a fact about that client and has nowhere to live yet. See
 * foundationPlatformsFor() and the note on seedListings() in lib/clients/foundation-listings.ts.
 */
export const SRT_TYPES: readonly FoundationType[] = [
  "agency_directory",
  "review_platform",
  "saas_directory",
  "ai_directory",
  "startup_directory",
  "business_directory",
];

export function foundationPlatformByKey(key: string): FoundationPlatform | undefined {
  return FOUNDATION_PLATFORMS.find((p) => p.key === key);
}

/**
 * The platforms an owner belongs on, from the types somebody chose for it, in registry order.
 *
 * ‼️ THE CALLER PASSES THE TYPES AND THIS FILE NEVER GUESSES THEM. That is the whole defence
 * against a clinic on an AI tool directory, and it is the shape platformsFor() in
 * presence-platforms.ts already uses for the identical problem. An empty list in gives an empty
 * list out, which is an owner nobody has decided about yet and reads as "nothing to do" rather
 * than as "everything".
 *
 * ‼️ PURE AND IT STAYS PURE. No database, no client id, so this file is safe to import anywhere.
 *
 * `unknown` is returned rather than dropped: a type nobody recognises is a typo somebody owns,
 * and the card should name it rather than quietly work one group fewer.
 */
export function foundationPlatformsFor(types: readonly string[]): {
  platforms: FoundationPlatform[];
  unknown: string[];
} {
  const wanted = new Set(types.map((t) => t.trim().toLowerCase()).filter(Boolean));
  const known = new Set<string>(FOUNDATION_TYPES);
  const platforms = FOUNDATION_PLATFORMS.filter((p) => wanted.has(p.type));
  return { platforms, unknown: [...wanted].filter((t) => !known.has(t)) };
}

/** One type's platforms, highest DR first. For printing a card group. */
export function platformsOfType(type: FoundationType): FoundationPlatform[] {
  return FOUNDATION_PLATFORMS.filter((p) => p.type === type);
}

/**
 * The next batch to work, strongest domain first, skipping anything already started.
 *
 * Sorted by DR and then by minutes, so of two equally strong domains the quicker one comes first.
 * Deliberately NOT sorted by cost: every free row is 0 and the handful that are not are decisions
 * rather than queue positions.
 */
export function nextBatch(
  platforms: readonly FoundationPlatform[],
  done: ReadonlySet<string>,
  size = 10
): FoundationPlatform[] {
  return platforms
    .filter((p) => !done.has(p.key))
    .slice()
    .sort((a, b) => b.dr - a.dr || a.minutes - b.minutes || a.key.localeCompare(b.key))
    .slice(0, Math.max(1, size));
}

/** Total minutes for a set of platforms, for saying how long a batch actually is. */
export function totalMinutes(platforms: readonly FoundationPlatform[]): number {
  return platforms.reduce((sum, p) => sum + p.minutes, 0);
}

/** Total cost in cents. Zero for almost everything, and the point is that it is visibly zero. */
export function totalCostCents(platforms: readonly FoundationPlatform[]): number {
  return platforms.reduce((sum, p) => sum + p.costCents, 0);
}
