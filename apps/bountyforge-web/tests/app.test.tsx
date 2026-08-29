import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WalletSession } from "../src/lib/contract";
import { HASH, HUNTER, OTHER, SPONSOR, bounty, claim, config } from "./fixtures";

const api = vi.hoisted(() => ({
  getConfig: vi.fn(), listBounties: vi.fn(), listClaims: vi.fn(), getBounty: vi.fn(),
  listSponsorBounties: vi.fn(), listHunterClaims: vi.fn(), getClaimEvidence: vi.fn(),
  connectWallet: vi.fn(), watchWallet: vi.fn(), getPendingTransaction: vi.fn(), resumePendingTransaction: vi.fn(), clearPendingTransaction: vi.fn(),
  createBounty: vi.fn(), submitClaim: vi.fn(), challengeClaim: vi.fn(), resolveClaim: vi.fn(),
  getCredit: vi.fn(), depositCredit: vi.fn(), withdrawCredit: vi.fn(),
  appealClaim: vi.fn(), releaseRejectedStake: vi.fn(), timeoutClaim: vi.fn(), finalizeBounty: vi.fn(),
  claimPayout: vi.fn(), cancelBounty: vi.fn(), expireBounty: vi.fn(),
}));
vi.mock("@/lib/contract", async (original) => ({ ...await original<typeof import("../src/lib/contract")>(), ...api }));

import BountyForgeApp from "../src/components/BountyForgeApp";
import BountyControls from "../src/components/BountyControls";

beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset());
  api.getConfig.mockResolvedValue(config);
  api.getCredit.mockResolvedValue(100n * 10n ** 18n);
  api.depositCredit.mockResolvedValue(HASH);
  api.withdrawCredit.mockResolvedValue(HASH);
  api.listBounties.mockResolvedValue({ total: 1, items: [bounty()] });
  api.listClaims.mockResolvedValue({ total: 0, items: [] });
  api.getBounty.mockImplementation(async (id) => bounty({ id }));
  api.listSponsorBounties.mockResolvedValue({ total: 1, items: [bounty()] });
  api.listHunterClaims.mockResolvedValue({ total: 0, items: [] });
  api.getClaimEvidence.mockResolvedValue({ source_digest: "f".repeat(64), snapshot: {} });
  api.getPendingTransaction.mockReturnValue(null);
  api.watchWallet.mockReturnValue(() => {});
  for (const method of [api.createBounty, api.submitClaim, api.challengeClaim, api.resolveClaim, api.appealClaim, api.releaseRejectedStake, api.timeoutClaim, api.finalizeBounty, api.claimPayout, api.cancelBounty, api.expireBounty]) method.mockResolvedValue(HASH);
});

async function start(address = SPONSOR) {
  const wallet = { address, client: {}, provider: { request: vi.fn() } } as unknown as WalletSession;
  api.connectWallet.mockResolvedValue(wallet);
  render(<BountyForgeApp />);
  await waitFor(() => expect(screen.getByRole("button", { name: /^Post a bounty/ })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Connect wallet" }));
  await screen.findByRole("button", { name: "Disconnect wallet" });
  await waitFor(() => expect(api.getCredit).toHaveBeenCalled());
  await act(async () => {});
  return wallet;
}

function fillCreate() {
  fireEvent.click(screen.getByRole("button", { name: /^Post a bounty/ }));
  const dialog = screen.getByRole("dialog", { name: "Post a bounty" });
  fireEvent.change(within(dialog).getByLabelText("Bounty title"), { target: { value: "Persist theme selection" } });
  fireEvent.change(within(dialog).getByLabelText("GitHub issue URL", { exact: false }), { target: { value: "https://github.com/acme/widgets/issues/42" } });
  fireEvent.change(within(dialog).getByLabelText("Acceptance criteria"), { target: { value: "Persist the selected theme after a page reload." } });
  return dialog;
}

async function openBounty() {
  fireEvent.click(await screen.findByRole("button", { name: /Fix dark mode/ }));
  return await screen.findByRole("region", { name: "Bounty details" });
}

describe("settlement controls", () => {
  it("renders payout for the winning hunter, never the sponsor", () => {
    const onAction = vi.fn();
    const item = bounty({ status: "FINALIZED", cancellable: false, payable: true, winning_hunter: HUNTER.toUpperCase() });
    const view = render(<BountyControls bounty={item} address={HUNTER} disabled={false} onAction={onAction} onChallenge={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Claim reward/ }));
    expect(onAction).toHaveBeenCalledWith("payout");
    view.rerender(<BountyControls bounty={item} address={SPONSOR} disabled={false} onAction={onAction} onChallenge={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Claim reward/ })).not.toBeInTheDocument();
  });
  it("renders permissionless finalization and disables writes while pending", () => {
    const item = bounty({ status: "AWARDED", cancellable: false, finalizable: true });
    const view = render(<BountyControls bounty={item} address={OTHER} disabled={false} onAction={vi.fn()} onChallenge={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Finalize award/ })).toBeEnabled();
    view.rerender(<BountyControls bounty={item} address={OTHER} disabled onAction={vi.fn()} onChallenge={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Finalize award/ })).toBeDisabled();
  });
  it("invokes payout with the actual hunter session and a progress handler", async () => {
    api.getBounty.mockResolvedValue(bounty({ status: "FINALIZED", cancellable: false, payable: true, winning_hunter: HUNTER }));
    const wallet = await start(HUNTER);
    await openBounty();
    fireEvent.click(screen.getByRole("button", { name: /Claim reward/ }));
    await waitFor(() => expect(api.claimPayout).toHaveBeenCalledWith(wallet, "bf-1", expect.any(Function)));
  });
});

describe("forms retain drafts and enforce policy", () => {
  it("explains why the post action is disabled before wallet connection", async () => {
    render(<BountyForgeApp />);
    const post = await screen.findByRole("button", { name: /^Post a bounty/ });
    await waitFor(() => expect(post).toBeEnabled());
    fireEvent.click(post);
    expect(screen.getByRole("button", { name: /Connect wallet above/ })).toBeDisabled();
  });
  it("automatically clears a finalized deposit marker and unlocks posting", async () => {
    api.getPendingTransaction.mockReturnValue({ hash: HASH, functionName: "deposit", account: SPONSOR });
    api.resumePendingTransaction.mockResolvedValue("deposit");
    render(<BountyForgeApp />);
    await waitFor(() => expect(api.resumePendingTransaction).toHaveBeenCalledWith(expect.any(Function)));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Post a bounty/ })).toBeEnabled());
    expect(screen.getByRole("status")).toHaveTextContent("Deposit confirmed. Complete Step 2 below.");
  });
  it("unlocks posting when a stale deposit marker is reconciled from app credit", async () => {
    api.getPendingTransaction.mockReturnValue({ hash: HASH, functionName: "deposit", account: SPONSOR });
    api.resumePendingTransaction.mockResolvedValue("deposit_credit_recovered");
    render(<BountyForgeApp />);
    await waitFor(() => expect(api.resumePendingTransaction).toHaveBeenCalledWith(expect.any(Function)));
    await waitFor(() => expect(screen.getByRole("button", { name: /^Post a bounty/ })).toBeEnabled());
    expect(screen.getByRole("status")).toHaveTextContent("App balance found. Continue to Step 2.");
  });
  it("lets a user clear a verified legacy marker without another transaction", async () => {
    api.getPendingTransaction.mockReturnValue({ hash: HASH, functionName: "create_bounty", account: SPONSOR });
    api.resumePendingTransaction.mockRejectedValue(new Error("Receipt unavailable"));
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<BountyForgeApp />);
    const clear = await screen.findByRole("button", { name: "Clear saved check" });
    await waitFor(() => expect(clear).toBeEnabled());
    fireEvent.click(clear);
    expect(confirm).toHaveBeenCalledOnce();
    expect(api.clearPendingTransaction).toHaveBeenCalledWith(HASH);
    await waitFor(() => expect(screen.getByRole("button", { name: /^Post a bounty/ })).toBeEnabled());
    expect(screen.getByRole("alert")).toHaveTextContent("Do not repeat an action that already appears onchain");
    confirm.mockRestore();
  });
  it("adds recoverable balance without submitting or clearing the bounty draft", async () => {
    api.getCredit.mockResolvedValue(0n);
    const wallet = await start();
    const dialog = fillCreate();
    expect(within(dialog).getByRole("button", { name: /Complete Step 1 first/ })).toBeDisabled();
    api.depositCredit.mockImplementation(async () => { api.getCredit.mockResolvedValue(10n ** 15n); return HASH; });
    fireEvent.click(within(dialog).getByRole("button", { name: "1 · Deposit 0.001 GEN" }));
    await waitFor(() => expect(within(dialog).getByRole("button", { name: /Post bounty/ })).toBeEnabled());
    expect(within(dialog).getByRole("status")).toHaveTextContent("Deposit confirmed. Complete Step 2 below.");
    expect(dialog).toHaveTextContent("Balance ready for Step 2.");
    expect(api.depositCredit).toHaveBeenCalledWith(wallet, 10n ** 15n, expect.any(Function));
    expect(api.createBounty).not.toHaveBeenCalled();
    expect(within(dialog).getByLabelText("Bounty title")).toHaveValue("Persist theme selection");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
  it("keeps a cancelled deposit and its bounty draft open", async () => {
    api.getCredit.mockResolvedValue(0n);
    api.depositCredit.mockRejectedValue(new Error("User rejected the request"));
    await start();
    const dialog = fillCreate();
    fireEvent.click(within(dialog).getByRole("button", { name: "1 · Deposit 0.001 GEN" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("inputs are saved");
    expect(within(dialog).getByLabelText("Bounty title")).toHaveValue("Persist theme selection");
    expect(api.createBounty).not.toHaveBeenCalled();
  });
  it("can withdraw unused credit with the connected wallet", async () => {
    const wallet = await start(HUNTER);
    api.withdrawCredit.mockImplementation(async () => { api.getCredit.mockResolvedValue(0n); return HASH; });
    fireEvent.click(screen.getByRole("button", { name: "Withdraw unused GEN" }));
    await waitFor(() => expect(api.withdrawCredit).toHaveBeenCalledWith(wallet, expect.any(Function)));
    await waitFor(() => expect(screen.getByRole("button", { name: "Withdraw unused GEN" })).toBeDisabled());
  });
  it("keeps a rejected create form open with its values", async () => {
    api.createBounty.mockRejectedValue(new Error("User rejected the request"));
    await start();
    const dialog = fillCreate();
    fireEvent.submit(dialog.querySelector("form")!);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("inputs are saved");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Bounty title")).toHaveValue("Persist theme selection");
    expect(within(dialog).getByLabelText("Acceptance criteria")).toHaveValue("Persist the selected theme after a page reload.");
  });
  it("uses contract title and criteria limits, rejecting invalid rewards before signing", async () => {
    await start();
    const dialog = fillCreate();
    expect(within(dialog).getByLabelText("Bounty title")).toHaveAttribute("maxlength", "80");
    expect(within(dialog).getByLabelText("Acceptance criteria")).toHaveAttribute("maxlength", "600");
    fireEvent.change(within(dialog).getByLabelText("Reward (GEN)", { exact: false }), { target: { value: "101" } });
    fireEvent.submit(dialog.querySelector("form")!);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Reward must be");
    expect(api.createBounty).not.toHaveBeenCalled();
  });
  it("prevents duplicate submits and closes only after a confirmed result", async () => {
    let confirm!: (hash: string) => void;
    api.createBounty.mockImplementation(() => new Promise<string>((resolve) => { confirm = resolve; }));
    await start();
    const dialog = fillCreate();
    fireEvent.submit(dialog.querySelector("form")!);
    fireEvent.submit(dialog.querySelector("form")!);
    expect(api.createBounty).toHaveBeenCalledOnce();
    expect(within(dialog).getByRole("button", { name: /Transaction in progress/ })).toBeDisabled();
    await act(async () => { confirm(HASH); });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.createBounty).toHaveBeenCalledOnce();
  });
  it("keeps a failed claim and its wallet marker visible", async () => {
    api.submitClaim.mockRejectedValue(new Error("Contract execution failed"));
    await start(HUNTER); await openBounty();
    fireEvent.click(screen.getByRole("button", { name: "Submit a claim" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Pull request URL", { exact: false }), { target: { value: "https://github.com/acme/widgets/pull/99" } });
    fireEvent.change(within(dialog).getByLabelText("PR head commit SHA"), { target: { value: "a".repeat(40) } });
    fireEvent.change(within(dialog).getByLabelText("GitHub login"), { target: { value: "hunter" } });
    fireEvent.submit(dialog.querySelector("form")!);
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Contract execution failed");
    expect(within(dialog).getByLabelText("PR head commit SHA")).toHaveValue("a".repeat(40));
    expect(within(dialog).getByText("BountyForge-Wallet: " + HUNTER)).toBeInTheDocument();
  });
  it("keeps failed challenges open and limits the statement to 600 characters", async () => {
    api.getBounty.mockResolvedValue(bounty({ status: "AWARDED", cancellable: false, accepting_claims: false, challenge_open: true, winning_hunter: HUNTER }));
    api.challengeClaim.mockRejectedValue(new Error("User rejected the request"));
    await start(); await openBounty();
    fireEvent.click(screen.getByRole("button", { name: /Challenge this award/ }));
    const dialog = screen.getByRole("dialog");
    const statement = within(dialog).getByLabelText("What's wrong with the award?");
    expect(statement).toHaveAttribute("maxlength", "600");
    fireEvent.change(statement, { target: { value: "The saved diff does not implement persistence." } });
    fireEvent.submit(dialog.querySelector("form")!);
    await within(dialog).findByRole("alert");
    expect(statement).toHaveValue("The saved diff does not implement persistence.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
  it("does not treat a refresh failure as a failed transaction", async () => {
    await start();
    const dialog = fillCreate();
    api.listBounties.mockRejectedValue(new Error("read unavailable"));
    api.listSponsorBounties.mockRejectedValue(new Error("read unavailable"));
    fireEvent.submit(dialog.querySelector("form")!);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByRole("alert")).toHaveTextContent("Confirmed, but refresh failed");
    expect(api.createBounty).toHaveBeenCalledOnce();
  });
});

describe("discovery and wallet state", () => {
  it("loads bounties past the first 25", async () => {
    const items = Array.from({ length: 26 }, (_, index) => bounty({ id: "bf-" + (index + 1), title: "Bounty number " + (index + 1) }));
    api.listBounties.mockImplementation(async (offset = 0) => ({ total: 26, items: items.slice(offset, offset + 25) }));
    render(<BountyForgeApp />);
    const more = await screen.findByRole("button", { name: "Load more bounties" });
    fireEvent.click(more);
    await screen.findByRole("button", { name: /Bounty number 26/ });
    expect(api.listBounties).toHaveBeenCalledWith(25);
    expect(screen.queryByRole("button", { name: "Load more bounties" })).not.toBeInTheDocument();
  });
  it("opens a deep-linked bounty even when it is not in the loaded page", async () => {
    window.history.replaceState(null, "", "/?bounty=bf-26#bounty-detail");
    api.getBounty.mockResolvedValue(bounty({ id: "bf-26", title: "Deep-linked bounty" }));
    render(<BountyForgeApp />);
    await screen.findByRole("heading", { name: "Deep-linked bounty" });
    expect(api.getBounty).toHaveBeenCalledWith("bf-26");
  });
  it("restarts shifted pagination when another bounty arrives", async () => {
    const items = Array.from({ length: 27 }, (_, index) => bounty({ id: "bf-" + (27 - index), title: "Bounty number " + (27 - index) }));
    let inserted = false;
    api.listBounties.mockImplementation(async (offset = 0) => {
      const current = inserted ? items : items.slice(1);
      return { total: current.length, items: current.slice(offset, offset + 25) };
    });
    render(<BountyForgeApp />);
    const more = await screen.findByRole("button", { name: "Load more bounties" });
    inserted = true;
    fireEvent.click(more);
    await screen.findByRole("button", { name: /Bounty number 27/ });
    fireEvent.click(screen.getByRole("button", { name: "Load more bounties" }));
    await screen.findByRole("button", { name: /Bounty number 1\b/ });
    expect(screen.queryByRole("button", { name: "Load more bounties" })).not.toBeInTheDocument();
  });
  it("links personal claims to the correct bounty", async () => {
    api.listHunterClaims.mockResolvedValue({ total: 1, items: [claim({ bounty_id: "bf-26", bounty_title: "My later bounty" })] });
    await start(HUNTER);
    fireEvent.click(screen.getByRole("button", { name: "My claims" }));
    fireEvent.click(await screen.findByRole("button", { name: /My later bounty/ }));
    await waitFor(() => expect(api.getBounty).toHaveBeenCalledWith("bf-26"));
  });
  it("clears the wallet session when the account changes", async () => {
    await start();
    await waitFor(() => expect(api.watchWallet).toHaveBeenCalled());
    const invalidate = api.watchWallet.mock.calls.at(-1)![1] as (reason: string) => void;
    act(() => invalidate("Wallet account changed. Reconnect to continue."));
    expect(await screen.findByRole("button", { name: "Connect wallet" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Disconnect wallet" })).not.toBeInTheDocument();
  });
  it("disables new transactions on an old contract", async () => {
    api.getConfig.mockResolvedValue({ ...config, version: "2.0.0" });
    render(<BountyForgeApp />);
    await screen.findByText("Contract upgrade pending. Transactions are paused.");
    for (const button of screen.getAllByRole("button", { name: /Checking StudioNet/ })) {
      expect(button).toBeDisabled();
    }
    expect(api.createBounty).not.toHaveBeenCalled();
  });
  it("uses configured windows instead of fixed 24-hour copy", async () => {
    api.getConfig.mockResolvedValue({ ...config, appeal_window_secs: "300", review_window_secs: "600" });
    await start(); await openBounty();
    expect(screen.getAllByText("5m").length).toBeGreaterThan(0);
    expect(screen.getByText("10m")).toBeInTheDocument();
    expect(screen.queryByText("24h")).not.toBeInTheDocument();
  });
  it("does not expose review buttons to a disconnected wallet", async () => {
    api.listClaims.mockResolvedValue({ total: 1, items: [claim()] });
    render(<BountyForgeApp />); await openBounty();
    expect(screen.queryByRole("button", { name: /Review claim/ })).not.toBeInTheDocument();
  });
  it("does not advertise available slots or rewards on a cancelled bounty", async () => {
    api.getBounty.mockResolvedValue(bounty({ status: "CANCELLED", cancellable: false, accepting_claims: false }));
    render(<BountyForgeApp />); await openBounty();
    expect(screen.getByRole("button", { name: /^CANCELLED\s*bf-1/ })).toBeInTheDocument();
    expect(screen.queryByText("Slots available")).not.toBeInTheDocument();
    expect(screen.queryByText("Connect your wallet to continue.")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Submit a claim" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "← All bounties" }));
    expect(screen.getByRole("button", { name: /^CANCELLED\s*bf-1/ })).toBeInTheDocument();
  });
  it("passes shared transaction progress to permissionless review", async () => {
    api.listClaims.mockResolvedValue({ total: 1, items: [claim()] });
    const wallet = await start(OTHER); await openBounty();
    fireEvent.click(screen.getByRole("button", { name: /Review claim/ }));
    await waitFor(() => expect(api.resolveClaim).toHaveBeenCalledWith(wallet, "bf-1", "0", expect.any(Function)));
  });
});
