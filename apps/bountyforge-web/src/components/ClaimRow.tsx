import { useState } from "react";
import { ClaimAction, ClaimView, claimActions, friendlyError, getClaimEvidence, shorten } from "@/lib/contract";
import { StatusPill, dateLabel } from "./Ui";

const labels: Record<ClaimAction, string> = {
  resolve: "Review claim", appeal: "Appeal rejection", "close-appeal": "Close expired appeal",
  timeout: "Refund timed-out claim", refund: "Refund claim stake",
};

export default function ClaimRow({ claim, address, disabled, onAction }: {
  claim: ClaimView; address?: string; disabled: boolean; onAction: (action: ClaimAction, claim: ClaimView) => void;
}) {
  const [evidence, setEvidence] = useState("");
  const [evidenceError, setEvidenceError] = useState("");
  const [loading, setLoading] = useState(false);
  const loadEvidence = async () => {
    if (evidence || loading) return;
    setLoading(true); setEvidenceError("");
    try { setEvidence(JSON.stringify(await getClaimEvidence(claim.bounty_id, claim.index), null, 2)); }
    catch (error) { setEvidenceError(friendlyError(error)); }
    finally { setLoading(false); }
  };
  return <article className="claim-row">
    <div className="claim-id"><div className="avatar" aria-hidden="true">{claim.github_login.slice(0, 1).toUpperCase() || "?"}</div>
      <div><b>{claim.github_login || shorten(claim.hunter)}</b><span><a href={claim.pr_url} target="_blank" rel="noreferrer">PR #{claim.pr_number} ↗</a> · {shorten(claim.pr_head_sha)}</span></div>
    </div>
    <div className="claim-outcome"><StatusPill status={claim.status} />{claim.reason && <p>{claim.reason}</p>}
      {claim.status === "PENDING" && <p>{Number(claim.review_deadline_unix) ? "Review by " + dateLabel(claim.review_deadline_unix, true) : "Waiting for an earlier claim."}</p>}
      {claim.status === "REJECTED_PENDING_APPEAL" && <p>Appeal by {dateLabel(claim.rejection_deadline_unix, true)}</p>}
    </div>
    <div className="claim-actions">{claimActions(claim, address).map((action) => <button className="text-button" key={action} disabled={disabled} onClick={() => onAction(action, claim)}>{labels[action]} ↗</button>)}</div>
    {claim.source_digest && <details className="evidence" onToggle={(event) => { if (event.currentTarget.open) void loadEvidence(); }}>
      <summary>Saved evidence</summary>{loading ? <p className="muted">Loading evidence…</p> : evidenceError ? <p className="field-error">{evidenceError} <button className="text-button" onClick={() => void loadEvidence()}>Retry</button></p> : <pre>{evidence}</pre>}
    </details>}
  </article>;
}
