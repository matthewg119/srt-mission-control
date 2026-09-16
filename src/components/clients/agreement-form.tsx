"use client";

// The Agreement panel on the client board. The same two actions the Slack step card carries.
//
// ‼️ IT DOES NOT REIMPLEMENT EITHER OF THEM. Both buttons POST to /api/clients/[id]/agreement,
// which calls the same draftAgreementEmail() and mintSigningLink() the Slack handler calls. Two
// surfaces, one implementation, because the failure mode of two is that they drift and only one
// of them knows the free plan has no contract.
//
// ‼️ THE OFFER IS SET HERE TOO, AND THAT IS THE POINT OF THE PANEL EXISTING AT ALL. Without it,
// a client whose offer was never recorded is stuck: the Slack card refuses to send anything and
// tells you to set the offer on the board, and if the board had no way to set it that would be a
// loop. This is the way out of it.

import { useState } from "react";
import { OFFERS, type OfferKey } from "@/config/pitch";

export interface AgreementView {
  offerKey: OfferKey | null;
  /** The most recent signature for this client, if there is one. */
  signedAt: string | null;
  templateVersion: string | null;
}

export function AgreementForm({ clientId, view }: { clientId: string; view: AgreementView }) {
  const [offerKey, setOfferKey] = useState<OfferKey | "">(view.offerKey ?? "");
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const offer = OFFERS.find((o) => o.key === offerKey) ?? null;

  async function call(action: "set_offer" | "draft" | "link"): Promise<void> {
    setBusy(action);
    setNote(null);
    setFailed(false);
    if (action !== "link") setLink(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/agreement`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, offerKey: offerKey || null }),
      });
      const json = (await res.json()) as Record<string, unknown>;
      if (json.ok !== true) {
        setFailed(true);
        setNote((json.error as string) || "That did not work.");
        return;
      }
      if (action === "set_offer") setNote("Offer saved.");
      if (action === "draft") {
        setNote(
          json.webLink
            ? "Draft created in your Outlook, with the PDF attached and the link in the body. Nothing has sent."
            : "Draft created. Check your Drafts folder."
        );
        if (typeof json.webLink === "string") setLink(json.webLink);
      }
      if (action === "link" && typeof json.url === "string") {
        setLink(json.url);
        setNote("Signing link ready. Paste it to them.");
      }
    } catch (e) {
      setFailed(true);
      setNote((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  // ‼️ ALREADY SIGNED IS A TERMINAL STATE ON THIS PANEL AND OFFERS NO SEND BUTTON. Minting a
  // second link over an executed contract is how two signed agreements end up existing for one
  // client, which is a thing somebody then has to reconcile by hand.
  if (view.signedAt) {
    return (
      <div className="text-sm text-[rgba(255,255,255,0.75)]">
        <p>
          Signed {view.signedAt.slice(0, 10)}
          {view.templateVersion ? ` on ${view.templateVersion}` : ""}.
        </p>
        <p className="mt-2 text-xs text-[rgba(255,255,255,0.4)]">
          Their copy was emailed when they signed. If this needs replacing, that is a new
          agreement and a conversation, not another link.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1.5 block text-xs text-[rgba(255,255,255,0.5)]">
          Which offer did they take?
        </label>
        <div className="flex flex-wrap gap-2">
          <select
            value={offerKey}
            onChange={(e) => setOfferKey(e.target.value as OfferKey | "")}
            className="rounded-lg border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.04)] px-3 py-2 text-sm text-white"
          >
            <option value="">Not recorded</option>
            {OFFERS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.name}
                {o.price ? `, ${o.price}` : ", free"}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={busy !== null || offerKey === (view.offerKey ?? "")}
            onClick={() => call("set_offer")}
            className="rounded-lg border border-[rgba(255,255,255,0.12)] px-3 py-2 text-sm text-white disabled:opacity-40"
          >
            {busy === "set_offer" ? "Saving" : "Save offer"}
          </button>
        </div>
      </div>

      {/* ‼️ THE PANEL EXPLAINS ITS OWN REFUSAL RATHER THAN JUST DISABLING A BUTTON. A greyed-out
          control with no sentence beside it is the commonest way somebody concludes the tool is
          broken and goes and does the thing by hand. */}
      {!offer ? (
        <p className="text-xs text-[rgba(255,255,255,0.45)]">
          Set the offer first. There are three documents and they differ on the fee, the
          guarantee and the refund, so there is no safe default to send.
        </p>
      ) : !offer.needsAgreement ? (
        <p className="text-xs text-[rgba(255,255,255,0.45)]">
          {offer.name} has no contract. Nothing to send, and nothing is owed.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => call("draft")}
              className="rounded-lg border border-[rgba(255,255,255,0.12)] px-3 py-2 text-sm text-white disabled:opacity-40"
            >
              {busy === "draft" ? "Drafting" : "Draft the email to me"}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => call("link")}
              className="rounded-lg bg-[#00C9A7] px-3 py-2 text-sm font-semibold text-[#04252b] disabled:opacity-40"
            >
              {busy === "link" ? "Creating" : "Send signing link"}
            </button>
          </div>
          <p className="text-xs text-[rgba(255,255,255,0.4)]">
            They sign {offer.name}
            {offer.price ? `, ${offer.price}` : ""}.{" "}
            {offer.guarantee
              ? "It carries the guarantee and the refund."
              : "It carries no guarantee and no refund, and says so."}{" "}
            When they sign, the agreement step ticks itself.
          </p>
        </>
      )}

      {note ? (
        <p className={`text-sm ${failed ? "text-red-300" : "text-[#00C9A7]"}`}>{note}</p>
      ) : null}

      {link ? (
        <div className="rounded-lg border border-[rgba(255,255,255,0.1)] bg-[rgba(0,0,0,0.25)] p-3">
          <div className="mb-1 text-xs text-[rgba(255,255,255,0.4)]">
            Anyone with this link can sign as this client. Send it to them and nobody else.
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 break-all text-xs text-white">{link}</code>
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(link)}
              className="shrink-0 rounded border border-[rgba(255,255,255,0.12)] px-2 py-1 text-xs text-white"
            >
              Copy
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
