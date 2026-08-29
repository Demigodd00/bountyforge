import { BountyAction, BountyView, bountyActions, sameAddress } from "@/lib/policy";

const labels: Record<BountyAction, string> = {
  cancel: "Cancel and refund", expire: "Close and refund sponsor",
  finalize: "Finalize award", payout: "Claim reward",
};

export default function BountyControls({ bounty, address, disabled, onAction, onChallenge }: {
  bounty: BountyView; address?: string; disabled: boolean;
  onAction: (action: BountyAction) => void; onChallenge: () => void;
}) {
  const actions = bountyActions(bounty, address);
  const canChallenge = bounty.challenge_open && sameAddress(bounty.sponsor, address);
  if (!actions.length && !canChallenge) return null;
  return <div className="owner-panel">
    <p className="eyebrow">ACTIONS</p>
    {actions.map((action) => <button className="text-button" key={action} disabled={disabled} onClick={() => onAction(action)}>{labels[action]} ↗</button>)}
    {canChallenge && <button className="text-button danger" disabled={disabled} onClick={onChallenge}>Challenge this award ↗</button>}
  </div>;
}
