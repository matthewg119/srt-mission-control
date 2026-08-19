"use client";

import type { ReactNode } from "react";

// How assistant markdown renders in both chats — the popup and the full page.
//
// A lead the assistant names is a lead you want to open, so buildSystemPrompt()
// asks it to write every lead it prints as [Name](/dashboard/leads/<id>), and
// this is the half that makes those land somewhere useful.
//
// They open in a NEW TAB deliberately. Both chats keep their messages in React
// state only (nothing is re-read from chat_messages on mount), so navigating in
// place would throw away the conversation that produced the link — you would
// arrive at the lead having lost the list you were working through.
//
// `rel` is not optional next to target="_blank": without noopener the opened
// page keeps a live window.opener handle back into this one.

export const CHAT_MARKDOWN_COMPONENTS = {
  a: ({ href, children }: { href?: string; children?: ReactNode }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[#00C9A7] underline underline-offset-2 hover:text-[#00b396]"
    >
      {children}
    </a>
  ),
};
