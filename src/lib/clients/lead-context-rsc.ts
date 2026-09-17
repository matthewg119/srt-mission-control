// The lead context, memoized for one React render pass.
//
// ‼️ THIS FILE IS FOR SERVER COMPONENTS ONLY, AND IT IS SEPARATE FOR A REASON. React's cache() is scoped
// to a render, so it does exactly nothing in a Slack webhook handler: there is no render pass there and
// every call would be a fresh read. lead-scope.ts is the answer on that side. Two mechanisms, two files,
// so neither gets used in the place it does not work.
//
// ‼️ THE SIGNATURE MUST STAY (clientId: string) AND NOTHING ELSE. cache() keys on argument identity, so
// an options object would be a new key on every call and memoize nothing at all, silently. A page that
// wants fewer slices should call leadContext directly rather than widening this.

import { cache } from "react";
import { leadContext, ALL_SLICES, type LeadContext } from "./lead-context";

/** Everything about a lead, loaded once per render pass no matter how many components ask. */
export const leadContextForPage: (clientId: string) => Promise<LeadContext> = cache((clientId: string) =>
  leadContext(clientId, { include: ALL_SLICES })
);
