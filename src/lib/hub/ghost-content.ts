// Sample pages for a PREVIEW, so a design and the corner assistant can be judged before any real page exists.
//
// Matthew, 2026-09-15: "create a new ghost page for previews that says the latin words those weird default
// settings website have". A new client's hub preview used to render one sentence ("New answers are being
// added here. Check back shortly."), so three designs were three nearly empty pages and nobody could tell
// them apart.
//
// ‼️ PREVIEW ONLY, AND A PROBE HOLDS THAT. Nothing under src/app/hub/[host] may import this file: lorem ipsum
// on a client's live domain would be crawled and quoted as their content. The dashboard preview, the
// tokenised preview and the concierge demo use it, each with a banner saying the text is a sample.
//
// ‼️ LATIN ON PURPOSE. Placeholder that reads as English gets read as copy ("we would never say that") and the
// design conversation turns into a copy conversation. Lorem ipsum is unmistakably a sample.

import type { HubAnswerPage, HubBodyPage } from "@/components/hub/hub-bodies";

const TITLES = [
  "Lorem ipsum dolor sit amet, consectetur adipiscing?",
  "Sed do eiusmod tempor incididunt ut labore et dolore?",
  "Ut enim ad minim veniam, quis nostrud exercitation?",
  "Duis aute irure dolor in reprehenderit in voluptate?",
  "Excepteur sint occaecat cupidatat non proident?",
  "Nemo enim ipsam voluptatem quia voluptas sit aspernatur?",
];

// The line under each title, different from it, so a design's two text sizes can both be judged.
const QUESTIONS = [
  "Quis autem vel eum iure reprehenderit qui in ea voluptate velit esse?",
  "At vero eos et accusamus et iusto odio dignissimos ducimus qui blanditiis?",
  "Nam libero tempore, cum soluta nobis est eligendi optio cumque nihil?",
  "Temporibus autem quibusdam et aut officiis debitis aut rerum necessitatibus?",
  "Itaque earum rerum hic tenetur a sapiente delectus, ut aut reiciendis?",
  "Neque porro quisquam est, qui dolorem ipsum quia dolor sit amet?",
];

export const GHOST_PAGES: HubBodyPage[] = TITLES.map((t, i) => ({
  id: `ghost-${i + 1}`,
  slug: `lorem-ipsum-${i + 1}`,
  title: t,
  question: QUESTIONS[i],
}));

const BODY = `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer posuere erat a ante venenatis dapibus, posuere velit aliquet. Nullam quis risus eget urna mollis ornare vel eu leo.

## Curabitur blandit tempus porttitor

Donec ullamcorper nulla non metus auctor fringilla. Vestibulum id ligula porta felis euismod semper. Cras mattis consectetur purus sit amet fermentum.

- Maecenas faucibus mollis interdum
- Aenean lacinia bibendum nulla sed consectetur
- Etiam porta sem malesuada magna mollis euismod

> Vivamus sagittis lacus vel augue laoreet rutrum faucibus dolor auctor. Morbi leo risus, porta ac consectetur ac.

## Fusce dapibus, tellus ac cursus commodo

Tortor mauris condimentum nibh, ut fermentum massa justo sit amet risus. Praesent commodo cursus magna, vel scelerisque nisl consectetur et.

### Quam diu etiam furor iste tuus nos eludet?

Sed posuere consectetur est at lobortis. Aenean eu leo quam. Pellentesque ornare sem lacinia quam venenatis vestibulum.

### Quo usque tandem abutere patientia nostra?

Nulla vitae elit libero, a pharetra augue. Donec sed odio dui. Duis mollis, est non commodo luctus, nisi erat porttitor ligula.`;

export function ghostAnswerPage(slug: string): HubAnswerPage | null {
  const page = GHOST_PAGES.find((p) => p.slug === slug);
  if (!page) return null;
  return { slug: page.slug, title: page.title, question: page.question, answerMd: BODY, publishedAt: null };
}

/** How few real pages a preview has before the sample pages fill it. */
export const GHOST_BELOW = 3;

export const GHOST_NOTICE = "Sample text (lorem ipsum) so the design can be judged. It is never published.";
