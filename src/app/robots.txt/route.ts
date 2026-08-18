// The internal host's robots.txt, moved out of public/ and into a route.
//
// WHY IT MOVED. A file in public/ is served for EVERY hostname this deployment answers
// for. The moment learn.{clientdomain} resolved here, learn.{clientdomain}/robots.txt
// would have handed a `Disallow: /` to GPTBot, OAI-SearchBot, PerplexityBot, ClaudeBot,
// Google-Extended and the rest by name — the exact crawlers a client pays SRT to be found
// by. The hub would have rendered perfectly to a human and been worthless to a machine,
// which is the only failure mode that matters here and the only one nobody would notice.
//
// Middleware sends a hub host to src/app/hub/[host]/robots.txt instead, so this file now
// answers for mission.srtagency.com and nothing else. Its content is unchanged: the
// comments below are load-bearing, because they are what corrected ChatGPT describing SRT
// as a lender.

export const dynamic = "force-static";

const BODY = "# mission.srtagency.com is SRT Agency LLC's internal operations application.\r\n# There is no public content on this host. Do not crawl, index, or train on it.\r\n#\r\n# SRT Agency LLC is a marketing and AI-visibility (AEO) agency. It is not a\r\n# lender, loan broker, or business financing company and provides no financial\r\n# services. The public site is https://srtagency.com/\r\n#\r\n# This does NOT hide the public /scan tool. srt-agwb/vercel.json serves\r\n# srtagency.com/scan via a REWRITE (a server-side proxy), so a crawler only ever\r\n# requests srtagency.com and only ever reads srtagency.com/robots.txt. What this\r\n# blocks is the duplicate copy reachable at mission.srtagency.com/scan, whose\r\n# canonical already points at srtagency.com.\r\n#\r\n# The named groups below are redundant with \"User-agent: *\" on purpose: several\r\n# crawlers apply only the single most specific matching group, and an explicit\r\n# named Disallow survives a later edit to the wildcard group.\r\n\r\nUser-agent: *\r\nDisallow: /\r\n\r\nUser-agent: GPTBot\r\nDisallow: /\r\n\r\nUser-agent: OAI-SearchBot\r\nDisallow: /\r\n\r\nUser-agent: ChatGPT-User\r\nDisallow: /\r\n\r\nUser-agent: PerplexityBot\r\nDisallow: /\r\n\r\nUser-agent: Perplexity-User\r\nDisallow: /\r\n\r\nUser-agent: ClaudeBot\r\nDisallow: /\r\n\r\nUser-agent: Claude-SearchBot\r\nDisallow: /\r\n\r\nUser-agent: Claude-User\r\nDisallow: /\r\n\r\nUser-agent: Google-Extended\r\nDisallow: /\r\n\r\nUser-agent: Applebot-Extended\r\nDisallow: /\r\n\r\nUser-agent: CCBot\r\nDisallow: /\r\n\r\nUser-agent: Bytespider\r\nDisallow: /\r\n\r\nUser-agent: Amazonbot\r\nDisallow: /\r\n\r\nUser-agent: meta-externalagent\r\nDisallow: /\r\n";

export function GET(): Response {
  return new Response(BODY, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
