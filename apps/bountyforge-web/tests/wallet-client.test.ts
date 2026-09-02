import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExecutionResult, TransactionStatus } from "genlayer-js/types";
import type { EthereumProvider, TxProgress, WalletSession } from "../src/lib/contract";
import { HASH, HUNTER, OTHER, bounty, claim, config } from "./fixtures";

const sdk = vi.hoisted(() => ({ readContract: vi.fn(), writeContract: vi.fn(), waitForTransactionReceipt: vi.fn(), getContractSchema: vi.fn(), connect: vi.fn() }));
vi.mock("genlayer-js", () => ({ chains: { studionet: { id: 61999 } }, createClient: vi.fn(() => sdk) }));

let api: typeof import("../src/lib/contract");
let provider: EthereumProvider;
let wallet: WalletSession;
const successfulReceipt = { statusName: TransactionStatus.FINALIZED, txExecutionResultName: ExecutionResult.FINISHED_WITH_RETURN };
const input = () => ({ title: "Fix the theme", criteria: "Persist the selected theme after a reload.", issueUrl: "https://github.com/acme/widgets/issues/42", deadlineUnix: Math.floor(Date.now() / 1000) + 86400, potAtto: 10n ** 18n });
const method = (params: string[][], readonly: boolean, payable?: boolean) => ({ params, kwparams: {}, readonly, ...(payable === undefined ? {} : { payable }) });
const compatibleSchema = {
  methods: {
    appeal_claim: method([["bounty_id", "string"], ["claim_index", "int"]], false, false),
    cancel_bounty: method([["bounty_id", "string"]], false, false),
    challenge_claim: method([["bounty_id", "string"], ["statement", "string"]], false, false),
    claim_payout: method([["bounty_id", "string"]], false, false),
    create_bounty: method([["title", "string"], ["acceptance_criteria", "string"], ["issue_url", "string"], ["deadline_unix", "int"], ["pot_atto", "int"]], false, false),
    deposit: method([], false, true),
    expire_bounty: method([["bounty_id", "string"]], false, false),
    finalize_bounty: method([["bounty_id", "string"]], false, false),
    get_bounty: method([["bounty_id", "string"]], true),
    get_claim: method([["bounty_id", "string"], ["index", "int"]], true),
    get_claim_evidence: method([["bounty_id", "string"], ["index", "int"]], true),
    get_config: method([], true),
    get_credit: method([["user", "string"]], true),
    get_stats: method([], true),
    list_bounties: method([["offset", "int"], ["count", "int"]], true),
    list_claims: method([["bounty_id", "string"], ["offset", "int"], ["count", "int"]], true),
    list_hunter_claims: method([["user", "string"], ["offset", "int"], ["count", "int"]], true),
    list_sponsor_bounties: method([["user", "string"], ["offset", "int"], ["count", "int"]], true),
    release_rejected_stake: method([["bounty_id", "string"], ["claim_index", "int"]], false, false),
    resolve_claim: method([["bounty_id", "string"], ["claim_index", "int"]], false, false),
    submit_claim: method([["bounty_id", "string"], ["pr_url", "string"], ["pr_head_sha", "string"], ["github_login", "string"]], false, false),
    timeout_claim: method([["bounty_id", "string"], ["claim_index", "int"]], false, false),
    withdraw_credit: method([], false, false),
  },
};

beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks();
  sdk.readContract.mockImplementation(async ({ functionName }) => {
    if (functionName === "get_credit") return String(100n * 10n ** 18n);
    if (functionName === "list_sponsor_bounties" || functionName === "list_hunter_claims" || functionName === "list_claims") return { total: "0", items: [] };
    if (functionName === "get_bounty") return bounty();
    if (functionName === "get_claim") return claim();
    return config;
  });
  sdk.writeContract.mockResolvedValue(HASH);
  sdk.waitForTransactionReceipt.mockResolvedValue(successfulReceipt);
  sdk.getContractSchema.mockResolvedValue(compatibleSchema);
  sdk.connect.mockResolvedValue(undefined);
  provider = { request: vi.fn(async ({ method }) => method === "eth_chainId" ? "0xf22f" : [HUNTER]) };
  api = await import("../src/lib/contract");
  wallet = { address: HUNTER, provider, client: sdk as unknown as WalletSession["client"] };
});

describe("transaction safety", () => {
  it("sends value only to deposit, never to a bounty, claim, or challenge", async () => {
    await api.depositCredit(wallet, 10n ** 18n, vi.fn());
    expect(sdk.writeContract).toHaveBeenLastCalledWith(expect.objectContaining({ functionName: "deposit", value: 10n ** 18n, args: [] }));
    await api.createBounty(wallet, input(), vi.fn());
    expect(sdk.writeContract).toHaveBeenLastCalledWith(expect.objectContaining({ functionName: "create_bounty", args: [input().title, input().criteria, input().issueUrl, expect.any(Number), input().potAtto] }));
    expect(sdk.writeContract.mock.calls.at(-1)![0]).not.toHaveProperty("value");
    await api.submitClaim(wallet, bounty(), "https://github.com/acme/widgets/pull/99", "a".repeat(40), "hunter", vi.fn());
    expect(sdk.writeContract).toHaveBeenLastCalledWith(expect.objectContaining({ functionName: "submit_claim" }));
    expect(sdk.writeContract.mock.calls.at(-1)![0]).not.toHaveProperty("value");
    await api.challengeClaim(wallet, "bf-1", "The stored patch omits the required persistence behavior.", vi.fn());
    expect(sdk.writeContract).toHaveBeenLastCalledWith(expect.objectContaining({ functionName: "challenge_claim" }));
    expect(sdk.writeContract.mock.calls.at(-1)![0]).not.toHaveProperty("value");
  });
  it("checks available credit before requesting a business-action signature", async () => {
    sdk.readContract.mockImplementation(async ({ functionName }) => functionName === "get_credit" ? "0" : config);
    await expect(api.createBounty(wallet, input(), vi.fn())).rejects.toThrow("app balance");
    expect(sdk.writeContract).not.toHaveBeenCalled();
  });
  it("preserves a timed-out deposit hash and never silently deposits again", async () => {
    sdk.waitForTransactionReceipt.mockRejectedValueOnce(new Error("timeout"));
    await expect(api.depositCredit(wallet, 10n ** 18n, vi.fn())).rejects.toThrow("timeout");
    expect(api.getPendingTransaction()?.functionName).toBe("deposit");
    await expect(api.depositCredit(wallet, 10n ** 18n, vi.fn())).rejects.toThrow("pending transaction");
    expect(sdk.writeContract).toHaveBeenCalledOnce();
    sdk.waitForTransactionReceipt.mockResolvedValue(successfulReceipt);
    await expect(api.resumePendingTransaction(vi.fn())).resolves.toBe("deposit");
  });
  it("reconciles a stale deposit marker from recoverable app credit", async () => {
    sdk.waitForTransactionReceipt.mockRejectedValue(new Error("Transaction not found"));
    await expect(api.depositCredit(wallet, 10n ** 18n, vi.fn())).rejects.toThrow("Transaction not found");
    sdk.readContract.mockImplementation(async ({ functionName }) => functionName === "get_credit" ? String(101n * 10n ** 18n) : config);
    const progress: TxProgress[] = [];
    await expect(api.resumePendingTransaction((value) => progress.push(value))).resolves.toBe("deposit");
    expect(sdk.waitForTransactionReceipt).toHaveBeenLastCalledWith(expect.objectContaining({ retries: 0 }));
    expect(api.getPendingTransaction()).toBeNull();
    expect(progress.at(-1)).toMatchObject({ state: "confirmed", label: "Confirmed from contract state.", hash: HASH });
    expect(sdk.writeContract).toHaveBeenCalledOnce();
  });
  it("recovers a created bounty from its exact finalized contract state", async () => {
    const creation = input();
    sdk.waitForTransactionReceipt.mockRejectedValue(new Error("receipt unavailable"));
    await expect(api.createBounty(wallet, creation, vi.fn())).rejects.toThrow("receipt unavailable");
    expect(api.getPendingTransaction()?.effect).toMatchObject({ kind: "create_bounty" });
    const created = bounty({
      sponsor: HUNTER, title: creation.title, acceptance_criteria: creation.criteria,
      owner_repo: "acme/widgets", issue_number: "42", pot_atto: String(creation.potAtto),
      deadline_unix: String(creation.deadlineUnix),
    });
    sdk.readContract.mockImplementation(async ({ functionName }) => {
      if (functionName === "list_sponsor_bounties") return { total: "1", items: [created] };
      return config;
    });
    const progress: TxProgress[] = [];
    await expect(api.resumePendingTransaction((value) => progress.push(value))).resolves.toBe("create_bounty");
    expect(progress.at(-1)).toMatchObject({ state: "confirmed", label: "Confirmed from contract state." });
    expect(api.getPendingTransaction()).toBeNull();
    expect(sdk.writeContract).toHaveBeenCalledOnce();
  });
  it("recovers a submitted claim from its exact finalized contract state", async () => {
    const prUrl = "https://github.com/acme/widgets/pull/99", sha = "a".repeat(40), login = "hunter";
    sdk.waitForTransactionReceipt.mockRejectedValue(new Error("receipt unavailable"));
    await expect(api.submitClaim(wallet, bounty(), prUrl, sha, login, vi.fn())).rejects.toThrow("receipt unavailable");
    expect(api.getPendingTransaction()?.effect).toMatchObject({ kind: "submit_claim" });
    const submitted = claim({ hunter: HUNTER, bounty_id: "bf-1", pr_url: prUrl, pr_head_sha: sha, github_login: login });
    sdk.readContract.mockImplementation(async ({ functionName }) => {
      if (functionName === "list_hunter_claims") return { total: "1", items: [submitted] };
      return config;
    });
    await expect(api.resumePendingTransaction(vi.fn())).resolves.toBe("submit_claim");
    expect(api.getPendingTransaction()).toBeNull();
    expect(sdk.writeContract).toHaveBeenCalledOnce();
  });
  it("recovers every finalized claim transition from contract state", async () => {
    const cases = [
      { method: "resolve_claim", invoke: () => api.resolveClaim(wallet, "bf-1", "0", vi.fn()), before: claim({ status: "PENDING" }), after: claim({ status: "ACCEPTED", source_digest: "e".repeat(64) }) },
      { method: "appeal_claim", invoke: () => api.appealClaim(wallet, "bf-1", "0", vi.fn()), before: claim({ status: "REJECTED_PENDING_APPEAL", appeal_count: "0" }), after: claim({ status: "ACCEPTED", appeal_count: "1" }) },
      { method: "release_rejected_stake", invoke: () => api.releaseRejectedStake(wallet, "bf-1", "0", vi.fn()), before: claim({ status: "REJECTED_PENDING_APPEAL", stake_released: false }), after: claim({ status: "REJECTED_FINAL", stake_released: true }) },
      { method: "timeout_claim", invoke: () => api.timeoutClaim(wallet, "bf-1", "0", vi.fn()), before: claim({ status: "PENDING", stake_released: false }), after: claim({ status: "TIMED_OUT", stake_released: true }) },
    ];
    for (const item of cases) {
      let current = item.before;
      sdk.waitForTransactionReceipt.mockRejectedValue(new Error("receipt unavailable"));
      sdk.readContract.mockImplementation(async ({ functionName }) => functionName === "get_claim" ? current : config);
      await expect(item.invoke()).rejects.toThrow("receipt unavailable");
      expect(api.getPendingTransaction()?.functionName).toBe(item.method);
      current = item.after;
      await expect(api.resumePendingTransaction(vi.fn())).resolves.toBe(item.method);
      expect(api.getPendingTransaction()).toBeNull();
    }
    expect(sdk.writeContract).toHaveBeenCalledTimes(cases.length);
  });
  it("recovers every finalized bounty transition from contract state", async () => {
    const cases = [
      { method: "challenge_claim", invoke: () => api.challengeClaim(wallet, "bf-1", "The accepted change does not meet the required behavior.", vi.fn()), before: bounty({ status: "AWARDED", challenged: false }), after: bounty({ status: "OPEN", challenged: true }) },
      { method: "finalize_bounty", invoke: () => api.finalizeBounty(wallet, "bf-1", vi.fn()), before: bounty({ status: "AWARDED" }), after: bounty({ status: "FINALIZED" }) },
      { method: "claim_payout", invoke: () => api.claimPayout(wallet, "bf-1", vi.fn()), before: bounty({ status: "FINALIZED" }), after: bounty({ status: "SETTLED" }) },
      { method: "cancel_bounty", invoke: () => api.cancelBounty(wallet, "bf-1", vi.fn()), before: bounty({ status: "OPEN" }), after: bounty({ status: "CANCELLED" }) },
      { method: "expire_bounty", invoke: () => api.expireBounty(wallet, "bf-1", vi.fn()), before: bounty({ status: "OPEN" }), after: bounty({ status: "REFUNDED" }) },
    ];
    for (const item of cases) {
      let current = item.before;
      sdk.waitForTransactionReceipt.mockRejectedValue(new Error("receipt unavailable"));
      sdk.readContract.mockImplementation(async ({ functionName }) => {
        if (functionName === "get_credit") return String(100n * 10n ** 18n);
        if (functionName === "get_bounty") return current;
        return config;
      });
      await expect(item.invoke()).rejects.toThrow("receipt unavailable");
      expect(api.getPendingTransaction()?.functionName).toBe(item.method);
      current = item.after;
      await expect(api.resumePendingTransaction(vi.fn())).resolves.toBe(item.method);
      expect(api.getPendingTransaction()).toBeNull();
    }
    expect(sdk.writeContract).toHaveBeenCalledTimes(cases.length);
  });
  it("clears only the expected saved transaction hash", async () => {
    sdk.waitForTransactionReceipt.mockRejectedValue(new Error("receipt unavailable"));
    await expect(api.createBounty(wallet, input(), vi.fn())).rejects.toThrow("receipt unavailable");
    expect(() => api.clearPendingTransaction("0x" + "f".repeat(64))).toThrow("saved transaction changed");
    api.clearPendingTransaction(HASH);
    expect(api.getPendingTransaction()).toBeNull();
  });
  it("bounds a stalled recovery lookup and keeps the safe marker", async () => {
    sdk.waitForTransactionReceipt.mockRejectedValue(new Error("receipt unavailable"));
    await expect(api.createBounty(wallet, input(), vi.fn())).rejects.toThrow("receipt unavailable");
    sdk.waitForTransactionReceipt.mockReturnValue(new Promise(() => {}));
    vi.useFakeTimers();
    try {
      const progress: TxProgress[] = [];
      const retry = api.resumePendingTransaction((value) => progress.push(value));
      const rejected = expect(retry).rejects.toThrow("status lookup timed out");
      await vi.advanceTimersByTimeAsync(12_000);
      await rejected;
      expect(progress.at(-1)).toMatchObject({ state: "unconfirmed", hash: HASH });
      expect(api.getPendingTransaction()?.hash).toBe(HASH);
    } finally { vi.useRealTimers(); }
  });
  it("blocks contracts without recoverable funding support", async () => {
    sdk.readContract.mockResolvedValue({ ...config, funding_model: "ATTACHED_VALUE" });
    await expect(api.depositCredit(wallet, 10n ** 18n, vi.fn())).rejects.toThrow("upgrade pending");
    expect(sdk.writeContract).not.toHaveBeenCalled();
  });
  it("checks policy and wallet before writing, then waits for successful finalization", async () => {
    const progress: TxProgress[] = [];
    await api.createBounty(wallet, input(), (value) => progress.push(value));
    expect(sdk.readContract).toHaveBeenCalledWith(expect.objectContaining({ functionName: "get_config", transactionHashVariant: "latest-final" }));
    expect(sdk.writeContract).toHaveBeenCalledOnce();
    expect(sdk.waitForTransactionReceipt).toHaveBeenCalledWith(expect.objectContaining({
      status: TransactionStatus.FINALIZED,
      interval: 3000,
      retries: 120,
    }));
    expect(progress.at(-1)?.state).toBe("confirmed");
    expect(api.getPendingTransaction()).toBeNull();
  });
  it("will not sign against a legacy contract", async () => {
    sdk.readContract.mockResolvedValue({ ...config, version: "2.0.0" });
    await expect(api.createBounty(wallet, input(), vi.fn())).rejects.toThrow("upgrade pending");
    expect(sdk.writeContract).not.toHaveBeenCalled();
  });
  it("validates amounts before a signature request", async () => {
    await expect(api.createBounty(wallet, { ...input(), potAtto: 1n }, vi.fn())).rejects.toThrow("Reward");
    expect(sdk.writeContract).not.toHaveBeenCalled();
  });
  it("rejects a wallet account switch before broadcast", async () => {
    provider.request = vi.fn(async ({ method }) => method === "eth_chainId" ? "0xf22f" : [OTHER]);
    await expect(api.createBounty(wallet, input(), vi.fn())).rejects.toThrow("Wallet account changed");
    expect(sdk.writeContract).not.toHaveBeenCalled();
  });
  it("rejects the wrong network before broadcast", async () => {
    provider.request = vi.fn(async ({ method }) => method === "eth_chainId" ? "0x1" : [HUNTER]);
    await expect(api.createBounty(wallet, input(), vi.fn())).rejects.toThrow("StudioNet");
    expect(sdk.writeContract).not.toHaveBeenCalled();
  });
  it("does not confuse finality with successful execution", async () => {
    sdk.waitForTransactionReceipt.mockResolvedValue({ statusName: TransactionStatus.FINALIZED, txExecutionResultName: ExecutionResult.FINISHED_WITH_ERROR });
    const progress: TxProgress[] = [];
    await expect(api.createBounty(wallet, input(), (value) => progress.push(value))).rejects.toThrow("Contract execution failed");
    expect(progress.at(-1)).toMatchObject({ state: "failed", hash: HASH });
    expect(api.getPendingTransaction()).toBeNull();
  });
  it("accepts the raw snake-case StudioNet receipt returned by genlayer-js", async () => {
    sdk.waitForTransactionReceipt.mockResolvedValue({
      status_name: TransactionStatus.FINALIZED,
      consensus_data: { leader_receipt: [{ mode: "leader", execution_result: "SUCCESS", result: { status: "return", payload: null } }] },
    });
    const progress: TxProgress[] = [];
    await expect(api.createBounty(wallet, input(), (value) => progress.push(value))).resolves.toBe(HASH);
    expect(progress.at(-1)).toMatchObject({ state: "confirmed", hash: HASH });
    expect(api.getPendingTransaction()).toBeNull();
  });
  it("surfaces a contract error from a raw snake-case StudioNet receipt", async () => {
    sdk.waitForTransactionReceipt.mockResolvedValue({
      status_name: TransactionStatus.FINALIZED,
      consensus_data: { leader_receipt: [{ mode: "leader", execution_result: "ERROR", genvm_result: { stderr: "insufficient available balance" }, result: { status: "contract_error" } }] },
    });
    const progress: TxProgress[] = [];
    await expect(api.createBounty(wallet, input(), (value) => progress.push(value))).rejects.toThrow("insufficient available balance");
    expect(progress.at(-1)).toMatchObject({ state: "failed", hash: HASH });
    expect(api.getPendingTransaction()).toBeNull();
  });
  it("refuses to sign when the configured contract ABI differs", async () => {
    sdk.getContractSchema.mockResolvedValue({
      ...compatibleSchema,
      methods: { ...compatibleSchema.methods, create_bounty: { ...compatibleSchema.methods.create_bounty, payable: true } },
    });
    await expect(api.createBounty(wallet, input(), vi.fn())).rejects.toThrow("ABI mismatch");
    expect(sdk.writeContract).not.toHaveBeenCalled();
  });
  it.each([undefined, ExecutionResult.NOT_VOTED, "UNKNOWN_RESULT"])("keeps the hash when finalized execution is not established (%s)", async (result) => {
    sdk.waitForTransactionReceipt.mockResolvedValue({ statusName: TransactionStatus.FINALIZED, txExecutionResultName: result });
    const progress: TxProgress[] = [];
    await expect(api.createBounty(wallet, input(), (value) => progress.push(value))).rejects.toThrow("Execution result unavailable");
    expect(progress.at(-1)).toMatchObject({ state: "unconfirmed", hash: HASH });
    expect(api.getPendingTransaction()?.hash).toBe(HASH);
    await expect(api.createBounty(wallet, input(), vi.fn())).rejects.toThrow("pending transaction");
    expect(sdk.writeContract).toHaveBeenCalledOnce();
  });
  it("retains a broadcast hash on timeout, prevents resubmission and recovers without signing", async () => {
    sdk.waitForTransactionReceipt.mockRejectedValueOnce(new Error("timeout"));
    const progress: TxProgress[] = [];
    await expect(api.createBounty(wallet, input(), (value) => progress.push(value))).rejects.toThrow("timeout");
    expect(progress.at(-1)).toMatchObject({ state: "unconfirmed", hash: HASH });
    expect(api.getPendingTransaction()).toMatchObject({ hash: HASH, functionName: "create_bounty" });
    await expect(api.createBounty(wallet, input(), vi.fn())).rejects.toThrow("pending transaction");
    expect(sdk.writeContract).toHaveBeenCalledOnce();
    sdk.waitForTransactionReceipt.mockResolvedValue(successfulReceipt);
    await expect(api.resumePendingTransaction(vi.fn())).resolves.toBe("create_bounty");
    expect(api.getPendingTransaction()).toBeNull();
    expect(sdk.writeContract).toHaveBeenCalledOnce();
  });
  it("preserves recovery across a module reload", async () => {
    sdk.waitForTransactionReceipt.mockRejectedValue(new Error("network unavailable"));
    await expect(api.createBounty(wallet, input(), vi.fn())).rejects.toThrow();
    vi.resetModules(); api = await import("../src/lib/contract");
    expect(api.getPendingTransaction()?.hash).toBe(HASH);
  });
  it("does not keep a recovery record for a cancelled signature", async () => {
    sdk.writeContract.mockRejectedValueOnce(new Error("User rejected the request"));
    const progress: TxProgress[] = [];
    await expect(api.createBounty(wallet, input(), (value) => progress.push(value))).rejects.toThrow();
    expect(progress.at(-1)?.state).toBe("failed");
    expect(api.getPendingTransaction()).toBeNull();
  });
});

describe("wallet events and read pagination", () => {
  it("restores an authorized wallet without requesting account access again", async () => {
    Object.defineProperty(window, "ethereum", { configurable: true, value: provider });
    try {
      const connected = await api.restoreWallet();
      expect(connected?.address).toBe(HUNTER);
      expect(provider.request).toHaveBeenCalledWith({ method: "eth_accounts" });
      expect(provider.request).not.toHaveBeenCalledWith({ method: "eth_requestAccounts" });
    } finally { Reflect.deleteProperty(window, "ethereum"); }
  });
  it("selects MetaMask through EIP-6963 when another injected wallet is also enabled", async () => {
    const competingProvider: EthereumProvider = { request: vi.fn(async () => [OTHER]) };
    const metaMaskProvider: EthereumProvider = {
      isMetaMask: true,
      request: vi.fn(async ({ method }) => method === "eth_chainId" ? "0xf22f" : [HUNTER]),
    };
    Object.defineProperty(window, "ethereum", { configurable: true, value: competingProvider });
    const announce = () => {
      window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: {
        info: { uuid: "coinbase", name: "Coinbase Wallet", rdns: "com.coinbase.wallet" },
        provider: competingProvider,
      } }));
      window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: {
        info: { uuid: "metamask", name: "MetaMask", rdns: "io.metamask" },
        provider: metaMaskProvider,
      } }));
    };
    window.addEventListener("eip6963:requestProvider", announce);
    try {
      const connected = await api.connectWallet();
      expect(connected.provider).toBe(metaMaskProvider);
      expect(connected.address).toBe(HUNTER);
      expect(metaMaskProvider.request).toHaveBeenCalledWith({ method: "eth_requestAccounts" });
      expect(competingProvider.request).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("eip6963:requestProvider", announce);
      Reflect.deleteProperty(window, "ethereum");
    }
  });
  it("subscribes to wallet changes and removes listeners", () => {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    provider.on = (event, listener) => { listeners.set(event, listener); };
    provider.removeListener = (event) => { listeners.delete(event); };
    const invalidate = vi.fn();
    const stop = api.watchWallet(wallet, invalidate);
    listeners.get("accountsChanged")?.([HUNTER.toUpperCase()]);
    expect(invalidate).not.toHaveBeenCalled();
    listeners.get("accountsChanged")?.([OTHER]);
    listeners.get("chainChanged")?.("0x1");
    listeners.get("disconnect")?.();
    expect(invalidate).toHaveBeenCalledTimes(3);
    stop(); expect(listeners.size).toBe(0);
  });
  it("passes pagination offsets and preserves the total", async () => {
    sdk.readContract.mockResolvedValue({ total: "26", items: [] });
    await expect(api.listBounties(25)).resolves.toEqual({ total: 26, items: [] });
    expect(sdk.readContract).toHaveBeenCalledWith(expect.objectContaining({ args: [25, 25], transactionHashVariant: "latest-final" }));
  });
  it("rejects malformed page data", async () => {
    sdk.readContract.mockResolvedValue({ total: "NaN", items: [] });
    await expect(api.listBounties()).rejects.toThrow("invalid page");
  });
});
