// /sign/<token>. The link Matthew sends during the onboarding call.
//
// ‼️ THE TOKEN IS THE PATH AND IT IS A BEARER CREDENTIAL. Anyone holding this URL can initial and
// sign as that client, which is exactly what it is for: it gets forwarded to the owner's phone
// while Matthew is still on the call. Two consequences, both deliberate:
//
//   - noindex, and no link to it from anywhere. The only way to have one is to be sent one.
//   - A MISS IS A 404, NEVER A 401 OR A "no such session". Same enumeration rule as
//     /api/onboarding2/document/[id]: an error that distinguishes "wrong token" from "expired
//     token" from "already signed" is an oracle somebody can walk.
//
// ‼️ IT RESOLVES SERVER-SIDE AND PASSES THE SNAPSHOT DOWN, rather than having the client fetch
// it. POST /api/onboarding2/start is the only thing that may FREEZE a snapshot, and this page must
// never do that: the row was created by mintSigningLink() with its agreement already frozen for
// the offer that client bought. Calling /start from here would freeze a second document over a
// row that may already carry initials against the first.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadByToken } from "@/lib/onboarding2/session";
import { loadInitials, coverageOf, pageCoverageOf } from "@/lib/onboarding2/initials";
import { pagesOf } from "@/lib/onboarding2/snapshot";

import { SignClient, type Agreement, type SignerIdentity } from "./sign-client";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export const metadata: Metadata = {
  title: "Your agreement | SRT Agency",
  robots: { index: false, follow: false },
};

export default async function SignPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const row = await loadByToken(token);
  if (!row) notFound();

  // ‼️ AN ALREADY-SIGNED ROW IS NOT AN ERROR AND NOT A SECOND SIGNATURE. /api/onboarding2/sign
  // has a replay branch that hands back the same document rather than 409ing, for the same
  // reason: somebody who signs, closes the tab and reopens the link has done nothing wrong. What
  // they must not get is a fresh set of empty initials boxes over a contract that is already
  // executed, so this stops before the viewer.
  if (row.signed_at) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center px-4 text-white">
        <div className="rounded-xl bg-white/5 p-6 sm:p-8">
          <h1 className="mb-2 text-2xl font-bold">This one is already signed.</h1>
          <p className="text-white/70">
            We emailed your copy to {row.contact_email || row.email || "the address on file"} when
            you signed it. If it is not there, reply to any message from us and we will send it
            again.
          </p>
        </div>
      </main>
    );
  }

  const snapshot = row.agreement_snapshot;

  // ‼️ A SECTIONLESS SNAPSHOT NEVER REACHES THE VIEWER. resolveVariant() throws on one and /sign
  // refuses one, and this is the third place it is caught, because here it would render a
  // document with no clauses and a button that says "go to the signature".
  if (!snapshot?.sections?.length) notFound();

  const rows = await loadInitials(row.id);

  const agreement: Agreement = {
    version: snapshot.version,
    canon: snapshot.canon,
    title: snapshot.title,
    preamble: snapshot.preamble,
    promise: snapshot.promise,
    sections: snapshot.sections,
    // pagesOf() synthesises one-section pages for a snapshot frozen before 2026-09-03, so the
    // client has one shape to handle rather than two.
    pages: pagesOf(snapshot),
    closing: snapshot.closing,
    footer: snapshot.footer,
    documentSha256: snapshot.documentSha256,
  };

  const identity: SignerIdentity = {
    contactName: row.print_name || row.contact_name || "",
    businessLegalName: row.business_legal_name || "",
    signerTitle: row.signer_title || "",
    website: row.website || "",
    email: row.contact_email || row.email || "",
    phone: row.contact_phone_typed || row.contact_phone || "",
  };

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white">
      <SignClient
        agreement={agreement}
        identity={identity}
        sessionToken={row.session_token}
        // ‼️ THE ROW DECIDES, NOT THE HOST. is_demo was stamped server-side when the link was
        // minted, from the host that minted it. Re-deriving it here from the host SERVING the page
        // would let a production row render without the banner on a preview deployment, or worse,
        // a preview row render as production. The row is the record.
        demo={row.is_demo}
        initialledSections={Array.from(coverageOf(rows))}
        initialledPages={Array.from(pageCoverageOf(rows))}
      />
    </main>
  );
}
