// The rebuilt srtagency.com homepage, explee's layout language, SRT's substance.
//
// COPY RULES, all load-bearing, all previously learned the hard way:
//  · No em dashes anywhere. Commas, periods, hyphens.
//  · No outcome claims. Verifiable visibility only, never customers or revenue.
//    The FAQ says so explicitly, so the rest of the page must not contradict it.
//  · Every statistic carries its source inline. The four below are the only ones
//    cleared for use; do not add a stat without a citation.
//  · No testimonials are rendered because there are none to render. The section
//    is a visible placeholder on purpose, see <Placeholder/>.
//  · Pricing and FAQ text is lifted verbatim from the live site's JSON-LD, so
//    the preview cannot quietly drift from what srtagency.com already promises.
//    ‼️ IT DRIFTED ANYWAY, and for months. This page quoted a $299/mo Tier 1 and
//    a "$999 setup waived to $499" that had not existed under any offer for a long
//    time, because nothing here imports config/pitch.ts and nothing checked. If you
//    edit the offer, edit this file in the same commit.

import { ScanForm } from "../scan/scan-form";

const STEPS = [
  {
    title: "We read your site the way a machine does",
    body: "Homepage, key inner pages, and your structured data. What you sell, who you sell it to, and which city you actually serve.",
    demo: ["srtagency.com", "AI visibility (AEO) agency", "North Carolina, US"],
  },
  {
    title: "We work out who you are really up against",
    body: "Not the competitors you name in a meeting. The ones an answer engine is likely to reach for when someone asks your category question.",
    demo: ["whitespark.ca", "brightlocal.com", "semrush.com", "visibility.ai"],
  },
  {
    title: "We write the 20 questions your buyers ask",
    body: "Buyer language, not marketing language. Most of them never mention your name, because appearing in a question that already says your name proves very little.",
    demo: ["best AEO agency for local businesses", "how do I show up in ChatGPT results", "who can fix my Google AI listing"],
  },
  {
    title: "We put every one to ChatGPT",
    body: "Twenty live answers on a clean account with no history and no location bias. That is the market's answer, not the one your own logged-in phone gives you.",
    demo: ["20 questions", "live web search", "20 recorded answers"],
  },
  {
    title: "We score what came back",
    body: "Where you were named, where a competitor was named instead, and which sources each engine cited. Questions that never mention you are weighted far heavier.",
    demo: ["Named in 4 of 20", "Competitor cited 11x", "Top source: a directory"],
  },
  {
    title: "You get a dated scorecard you can check yourself",
    body: "Every question, every answer, every citation, with the date it was measured. You can rerun any of it yourself. That is the entire point.",
    demo: ["Full report", "PDF scorecard", "Rerun links per question"],
  },
];

const FAQ = [
  {
    q: "How do I get my business recommended by ChatGPT?",
    a: "You get recommended when the sources AI trusts, reviews, directories, third-party pages, and a clean, structured website, consistently say the same clear things about your business. About 85% of what AI cites comes from third-party sources, so it's not just your own website. (AirOps, 2026)",
  },
  {
    q: "What's the difference between AEO and SEO?",
    a: "SEO gets you ranked in a list of blue links. AEO (Answer Engine Optimization) gets your business named inside the AI's answer. In 2026 customers increasingly get one recommendation, not ten links.",
  },
  {
    q: "Are AEO agencies legit or is this snake oil?",
    a: "Both exist. The test: can you verify the result yourself? We only guarantee verifiable AI appearances on a neutral account. Anyone guaranteeing customers, revenue, or 'top rankings in days' should be walked away from.",
  },
  {
    q: "How much does this cost?",
    a: "Our audit is free, and so is the work at first: you start free and the monthly retainer only starts once we have brought you 5 qualified AI-sourced inquiries inside the first 30 days. After that it is $349/mo, month to month. Typical AEO retainers run well into the thousands per month, so this is built for local businesses.",
  },
  {
    q: "Why can't I just check my own phone?",
    a: "AI answers are personalized to your history and location. Checking your own phone proves nothing. We measure on a clean, neutral account, dated, so it's the market's answer, not yours.",
  },
  {
    q: "Can you guarantee more customers?",
    a: "No, and no honest agency can. We guarantee verifiable visibility in AI answers. Whether that becomes customers depends on your business. We never make outcome claims.",
  },
];

const VERTICALS = [
  "Home services",
  "Clinics and med spas",
  "Legal",
  "Dental",
  "Fitness and wellness",
  "Real estate",
  "Auto",
  "Professional services",
];

export default function V2HomePage() {
  return (
    <>
      <Nav />

      <main className="scan-hero" style={{ minHeight: "auto", paddingTop: "5rem", paddingBottom: "5rem" }}>
        <h1 className="scan-h1">
          See what AI says about you <em>before</em> your customer does
        </h1>

        <div className="scan-badge">
          <span aria-hidden="true">&#9673;</span> Free scan, no account, about 3 minutes
        </div>

        <p className="scan-sub">
          Your customers are asking ChatGPT for a recommendation instead of scrolling Google. Paste
          your website and watch us ask the engines the 20 questions those customers actually ask.
          You will see whether you get named, and who gets named instead.
        </p>

        <ScanForm />

        <div className="scan-trust">
          <span>20 buyer questions</span>
          <span>20 live answers from ChatGPT</span>
          <span>Neutral account, no personalization</span>
        </div>
      </main>

      <Market />
      <Pipeline />
      <Differentiators />
      <WhoFor />
      <Testimonials />
      <Pricing />
      <Faq />
      <FinalCta />
      <Footer />
    </>
  );
}

function Nav() {
  return (
    <nav className="v2-nav">
      <a className="scan-logo" href="/v2">
        <span className="scan-logo-mark" aria-hidden="true">
          <i /><i /><i />
        </span>
        SRT
      </a>
      <div className="v2-nav-links">
        <a href="#how">How it works</a>
        <a href="#pricing">Pricing</a>
        <a href="#faq">FAQ</a>
        <a className="v2-nav-cta" href="/scan">
          Free scan
        </a>
      </div>
    </nav>
  );
}

function Market() {
  return (
    <section className="v2-section">
      <div className="v2-wrap">
        <div className="v2-eyebrow">Why this matters now</div>
        <h2 className="v2-h2">Search stopped being a list of links</h2>
        <div className="v2-grid-3">
          <div className="v2-num-card">
            <div className="v2-num">45%</div>
            <h3>of consumers use AI to find local businesses</h3>
            <p>Up from 6% a year earlier. This changed faster than almost anything in search has.</p>
            <span className="v2-cite">BrightLocal Local Consumer Review Survey, Feb 2026</span>
          </div>
          <div className="v2-num-card">
            <div className="v2-num">1.2%</div>
            <h3>of local businesses get recommended by ChatGPT</h3>
            <p>
              Against 35.9% that appear in Google&apos;s local 3-pack. The funnel narrowed to almost
              nothing, and most owners have not noticed yet.
            </p>
            <span className="v2-cite">SOCi Local Visibility Index, 2026</span>
          </div>
          <div className="v2-num-card">
            <div className="v2-num">85%</div>
            <h3>of what AI cites is not your website</h3>
            <p>
              Reviews, directories and third-party pages carry most of it. This is why a site
              redesign on its own does not move the answer.
            </p>
            <span className="v2-cite">AirOps, 2026</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function Pipeline() {
  return (
    <section className="v2-section" id="how">
      <div className="v2-wrap">
        <div className="v2-eyebrow">What the free scan actually does</div>
        <h2 className="v2-h2">Six steps, and you watch every one</h2>
        <p className="v2-lede">
          No form to fill in first, no call to book. Paste the URL and the work happens on screen.
          The report at the end is the same one we would charge for.
        </p>

        <div className="v2-steps">
          {STEPS.map((s, i) => (
            <article className="v2-step" key={s.title}>
              <div className="v2-step-num">{i + 1}</div>
              <div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
              <div className="v2-step-demo">
                {s.demo.map((d) => (
                  <div className="scan-row" key={d} style={{ marginBottom: "0.35rem" }}>
                    <span className="dot" />
                    {d}
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function Differentiators() {
  return (
    <section className="v2-section">
      <div className="v2-wrap">
        <div className="v2-eyebrow">Three things we will not do</div>
        <h2 className="v2-h2">The promises we refuse to make are the point</h2>
        <div className="v2-grid-3">
          <div className="v2-num-card">
            <h3 style={{ marginTop: 0 }}>We will not promise you customers</h3>
            <p>
              We guarantee verifiable appearances in AI answers. Whether that turns into customers
              depends on your business, your pricing and your front desk. Anyone guaranteeing revenue
              is guessing.
            </p>
          </div>
          <div className="v2-num-card">
            <h3 style={{ marginTop: 0 }}>We will not measure on your phone</h3>
            <p>
              AI answers are personalized to your history and your location, so checking yourself
              proves nothing. Every measurement is taken on a clean, neutral account and dated.
            </p>
          </div>
          <div className="v2-num-card">
            <h3 style={{ marginTop: 0 }}>We will not ask you to take our word for it</h3>
            <p>
              Every question in the report comes with a link to run it yourself. If you cannot
              reproduce a result we reported, it does not count.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function WhoFor() {
  return (
    <section className="v2-section">
      <div className="v2-wrap">
        <div className="v2-eyebrow">Who this is for</div>
        <h2 className="v2-h2">Local businesses people ask AI to recommend</h2>
        <p className="v2-lede">
          If a customer could plausibly ask an assistant &quot;who is the best one near me&quot;, this
          applies to you. It works the same way whatever the trade is.
        </p>
        <div className="v2-pills">
          {VERTICALS.map((v) => (
            <span className="v2-pill" key={v}>
              {v}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function Testimonials() {
  return (
    <section className="v2-section">
      <div className="v2-wrap">
        <div className="v2-eyebrow">Social proof</div>
        <h2 className="v2-h2">Where client results will go</h2>
        <div className="v2-placeholder">
          <h3>PLACEHOLDER, NOTHING WRITTEN HERE YET</h3>
          <p>
            Explee runs a testimonial carousel in this slot. Nothing has been invented to fill it.
            Drop in real client names, real quotes and dated before/after scorecards when you have
            them, and this becomes the strongest section on the page. Until then it stays empty,
            because a fabricated testimonial on an agency that sells verifiability is the one thing
            that would sink the whole pitch.
          </p>
        </div>
      </div>
    </section>
  );
}

function Pricing() {
  return (
    <section className="v2-section" id="pricing">
      <div className="v2-wrap">
        <div className="v2-eyebrow">Pricing</div>
        <h2 className="v2-h2">Built for a local business, not an enterprise</h2>
        <p className="v2-lede">
          Typical AEO retainers run well into the thousands per month. These are the real numbers
          from srtagency.com, unchanged.
        </p>

        <div className="v2-prices">
          <div className="v2-price">
            <span className="v2-price-tag">Start here</span>
            <h3>The audit</h3>
            <div className="v2-price-amount">Free</div>
            <div className="v2-price-note">No card, no call</div>
            <ul>
              <li>20 buyer questions, answered live</li>
              <li>Dated, neutral-account scorecard</li>
              <li>Every result reproducible by you</li>
            </ul>
          </div>

          <div className="v2-price is-featured">
            <span className="v2-price-tag">The whole offer</span>
            <h3>AI Visibility</h3>
            <div className="v2-price-amount">
              $349<small> /mo</small>
            </div>
            <div className="v2-price-note">Free until your first 5 AI-sourced inquiries</div>
            <ul>
              <li>Everything in the audit, every month</li>
              <li>Entity, surface, sources and proof work</li>
              <li>Monthly scorecard showing the movement</li>
            </ul>
          </div>

          <div className="v2-price">
            <span className="v2-price-tag">Founding</span>
            <h3>Founding seat</h3>
            <div className="v2-price-amount">
              5<small> spots</small>
            </div>
            <div className="v2-price-note">In exchange for a case study when we hit results</div>
            <ul>
              <li>A full Google Business Profile rebuild in week one</li>
              <li>Category, description, 10 geo-tagged photos, 4 posts</li>
              <li>Nothing is charged up front</li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function Faq() {
  return (
    <section className="v2-section" id="faq">
      <div className="v2-wrap">
        <div className="v2-eyebrow">Questions</div>
        <h2 className="v2-h2">The ones worth asking any AEO agency</h2>
        <div className="v2-faq">
          {FAQ.map((f) => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="v2-cta">
      <h2 className="v2-h2">Find out where you stand, for nothing</h2>
      <p className="v2-lede" style={{ margin: "1rem auto 2rem" }}>
        The scan costs you an email address at the end, and only if you want the full report.
      </p>
      <a className="scan-submit" href="/scan" style={{ display: "inline-block", textDecoration: "none" }}>
        Run the free scan
      </a>
    </section>
  );
}

function Footer() {
  return (
    <footer className="v2-footer">
      <div className="v2-footer-cols">
        <div>
          <a className="scan-logo" href="/v2" style={{ marginBottom: "0.75rem" }}>
            <span className="scan-logo-mark" aria-hidden="true">
              <i /><i /><i />
            </span>
            SRT
          </a>
          <div style={{ maxWidth: "34ch", lineHeight: 1.6 }}>
            AI visibility for local businesses. We get you named in the answer, and prove it on a
            neutral account.
          </div>
        </div>
        <div>
          <strong style={{ color: "#fff", display: "block", marginBottom: "0.5rem" }}>Product</strong>
          <a href="/scan">Free AI visibility scan</a>
          <a href="https://srtagency.com/method">Our method</a>
          <a href="#pricing">Pricing</a>
          <a href="#faq">FAQ</a>
        </div>
        <div>
          <strong style={{ color: "#fff", display: "block", marginBottom: "0.5rem" }}>Company</strong>
          <a href="https://srtagency.com/about">About</a>
          <a href="https://srtagency.com/contact">Contact</a>
          <a href="https://srtagency.com/resources">Resources</a>
        </div>
        <div>
          <strong style={{ color: "#fff", display: "block", marginBottom: "0.5rem" }}>Contact</strong>
          <a href="mailto:info@srtagency.com">info@srtagency.com</a>
          <a href="tel:+17432646016">(743) 264-6016</a>
          <div style={{ paddingTop: "0.2rem" }}>North Carolina, US</div>
        </div>
      </div>
      <div className="v2-footer-legal">
        © 2026 SRT Agency LLC · Search Retrieval Tactics
        <br />
        We report verifiable AI visibility only. We do not promise customers, revenue or outcomes.
      </div>
    </footer>
  );
}
