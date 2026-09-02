import { chains, createClient } from "genlayer-js";
import { ExecutionResult, TransactionHashVariant, TransactionStatus } from "genlayer-js/types";
import {
  Address, BountySummary, BountyView, ClaimView, CreateInput, Page, ProtocolConfig,
  assertCompatible, friendlyError, formatGen, isAddress, isBountyId, sameAddress,
  validateChallengeInput, validateClaimInput, validateCreateInput,
} from "./policy";

export * from "./policy";

export type ProgressState = "checking" | "awaiting-signature" | "submitted" | "finalizing" | "confirmed" | "failed" | "unconfirmed";
export type TxProgress = { state: ProgressState; label: string; hash?: string };
export type ProgressHandler = (progress: TxProgress) => void;
type WalletListener = (...args: unknown[]) => void;

export interface EthereumProvider {
  request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>;
  on?(event: string, listener: WalletListener): void;
  removeListener?(event: string, listener: WalletListener): void;
  providers?: EthereumProvider[];
  isMetaMask?: boolean;
  isBraveWallet?: boolean;
}

export type WalletProviderOption = {
  id: string;
  name: string;
  rdns: string;
  provider: EthereumProvider;
};

type Eip6963ProviderDetail = {
  info: { uuid: string; name: string; rdns: string; icon?: string };
  provider: EthereumProvider;
};

declare global {
  interface Window { ethereum?: EthereumProvider; }
  interface WindowEventMap {
    "eip6963:announceProvider": CustomEvent<Eip6963ProviderDetail>;
  }
}

export interface WalletSession { address: Address; client: ReturnType<typeof createClient>; provider: EthereumProvider; }
export type PendingEffect = { kind: string; values: Record<string, string> };
export type PendingTransaction = {
  hash: string;
  functionName: string;
  account: Address;
  createdAt?: number;
  effect?: PendingEffect;
};

export const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_BOUNTYFORGE_ADDRESS ?? "";
export const NETWORK_NAME = "StudioNet";
export const CONTRACT_READY = isAddress(CONTRACT_ADDRESS) && !/^0x0+$/.test(CONTRACT_ADDRESS);
export const PAGE_SIZE = 25;
const readClient = createClient({ chain: chains.studionet });
const pendingKey = "bountyforge:pending:" + chains.studionet.id + ":" + CONTRACT_ADDRESS.toLowerCase();
const RECOVERY_LOOKUP_TIMEOUT_MS = 12_000;
const FINALITY_POLL_INTERVAL_MS = 3_000;
const WRITE_CONFIRMATION_TIMEOUT_MS = 420_000;
let memoryPending: PendingTransaction | null = null;
let storageUsable = true;
let writeInFlight = false;
const WALLET_DISCOVERY_MS = 75;
let interfaceVerification: Promise<void> | null = null;

const EXPECTED_CONTRACT_SCHEMA: Record<string, { readonly: boolean; payable?: boolean; params: readonly (readonly [string, string])[] }> = {
  appeal_claim: { readonly: false, payable: false, params: [["bounty_id", "string"], ["claim_index", "int"]] },
  cancel_bounty: { readonly: false, payable: false, params: [["bounty_id", "string"]] },
  challenge_claim: { readonly: false, payable: false, params: [["bounty_id", "string"], ["statement", "string"]] },
  claim_payout: { readonly: false, payable: false, params: [["bounty_id", "string"]] },
  create_bounty: { readonly: false, payable: false, params: [["title", "string"], ["acceptance_criteria", "string"], ["issue_url", "string"], ["deadline_unix", "int"], ["pot_atto", "int"]] },
  deposit: { readonly: false, payable: true, params: [] },
  expire_bounty: { readonly: false, payable: false, params: [["bounty_id", "string"]] },
  finalize_bounty: { readonly: false, payable: false, params: [["bounty_id", "string"]] },
  get_bounty: { readonly: true, params: [["bounty_id", "string"]] },
  get_claim: { readonly: true, params: [["bounty_id", "string"], ["index", "int"]] },
  get_claim_evidence: { readonly: true, params: [["bounty_id", "string"], ["index", "int"]] },
  get_config: { readonly: true, params: [] },
  get_credit: { readonly: true, params: [["user", "string"]] },
  get_stats: { readonly: true, params: [] },
  list_bounties: { readonly: true, params: [["offset", "int"], ["count", "int"]] },
  list_claims: { readonly: true, params: [["bounty_id", "string"], ["offset", "int"], ["count", "int"]] },
  list_hunter_claims: { readonly: true, params: [["user", "string"], ["offset", "int"], ["count", "int"]] },
  list_sponsor_bounties: { readonly: true, params: [["user", "string"], ["offset", "int"], ["count", "int"]] },
  release_rejected_stake: { readonly: false, payable: false, params: [["bounty_id", "string"], ["claim_index", "int"]] },
  resolve_claim: { readonly: false, payable: false, params: [["bounty_id", "string"], ["claim_index", "int"]] },
  submit_claim: { readonly: false, payable: false, params: [["bounty_id", "string"], ["pr_url", "string"], ["pr_head_sha", "string"], ["github_login", "string"]] },
  timeout_claim: { readonly: false, payable: false, params: [["bounty_id", "string"], ["claim_index", "int"]] },
  withdraw_credit: { readonly: false, payable: false, params: [] },
};

function contractAddress(): Address {
  if (!CONTRACT_READY) throw new Error("BountyForge contract not configured.");
  return CONTRACT_ADDRESS as Address;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The contract returned an invalid response.");
  return value as Record<string, unknown>;
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

async function loadAndVerifyContractInterface(): Promise<void> {
  const schema = asRecord(await readClient.getContractSchema(contractAddress()));
  const methods = asRecord(schema.methods);
  for (const [name, expected] of Object.entries(EXPECTED_CONTRACT_SCHEMA)) {
    const actual = recordOrNull(methods[name]);
    if (!actual
      || actual.readonly !== expected.readonly
      || (expected.payable !== undefined && actual.payable !== expected.payable)
      || JSON.stringify(actual.params) !== JSON.stringify(expected.params)) {
      throw new Error(`Configured BountyForge contract ABI mismatch at ${name}. Check the contract address before signing.`);
    }
  }
}

export async function verifyContractInterface(): Promise<void> {
  if (!interfaceVerification) {
    interfaceVerification = loadAndVerifyContractInterface().catch((error) => {
      interfaceVerification = null;
      throw error;
    });
  }
  return interfaceVerification;
}

async function read<T>(functionName: string, args: unknown[] = []): Promise<T> {
  return await readClient.readContract({ address: contractAddress(), functionName, args: args as never[], transactionHashVariant: TransactionHashVariant.LATEST_FINAL }) as unknown as T;
}

function pageIndex(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid page offset.");
  return value;
}

function claimIndex(value: string): number {
  if (!/^\d+$/.test(value)) throw new Error("Invalid claim index.");
  return pageIndex(Number(value));
}

async function page<T>(method: string, prefix: unknown[], offset: number, count: number): Promise<Page<T>> {
  const result = asRecord(await read(method, [...prefix, pageIndex(offset), Math.min(pageIndex(count), PAGE_SIZE)]));
  const total = Number(result.total);
  if (!Array.isArray(result.items) || !Number.isSafeInteger(total) || total < 0) throw new Error("The contract returned an invalid page.");
  return { items: result.items as T[], total };
}

export async function getConfig(): Promise<ProtocolConfig> {
  const result = asRecord(await read("get_config"));
  if (Object.values(result).some((value) => typeof value !== "string")) throw new Error("The contract returned invalid settings.");
  return result as ProtocolConfig;
}

export const listBounties = (offset = 0, count = PAGE_SIZE) => page<BountySummary>("list_bounties", [], offset, count);
export const listSponsorBounties = (address: Address, offset = 0, count = PAGE_SIZE) => page<BountySummary>("list_sponsor_bounties", [address], offset, count);
export const listHunterClaims = (address: Address, offset = 0, count = PAGE_SIZE) => page<ClaimView>("list_hunter_claims", [address], offset, count);
export const listClaims = (id: string, offset = 0, count = PAGE_SIZE) => page<ClaimView>("list_claims", [id], offset, count);
export const getClaimEvidence = (id: string, index: string) => read<{ source_digest: string; snapshot: Record<string, unknown> }>("get_claim_evidence", [id, claimIndex(index)]);

export async function getCredit(address: Address): Promise<bigint> {
  const value = await read<unknown>("get_credit", [address]);
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new Error("The contract returned an invalid balance.");
  return BigInt(value);
}

export async function getBounty(id: string): Promise<BountyView> {
  if (!isBountyId(id)) throw new Error("Use a bounty ID such as bf-1.");
  return read<BountyView>("get_bounty", [id]);
}

export async function getClaim(id: string, index: string): Promise<ClaimView> {
  if (!isBountyId(id)) throw new Error("Use a bounty ID such as bf-1.");
  return read<ClaimView>("get_claim", [id, claimIndex(index)]);
}

export async function getAdminData(): Promise<{ config: ProtocolConfig; stats: Record<string, string> }> {
  const [config, stats] = await Promise.all([getConfig(), read<Record<string, string>>("get_stats")]);
  return { config, stats };
}

function onStudioNet(chainId: unknown): boolean {
  try { return (typeof chainId === "string" || typeof chainId === "number") && BigInt(chainId) === BigInt(chains.studionet.id); }
  catch { return false; }
}

async function assertWallet(session: WalletSession): Promise<void> {
  const [accounts, chainId] = await Promise.all([
    session.provider.request({ method: "eth_accounts" }),
    session.provider.request({ method: "eth_chainId" }),
  ]);
  if (!Array.isArray(accounts) || typeof accounts[0] !== "string" || !sameAddress(accounts[0], session.address)) throw new Error("Wallet account changed. Reconnect before continuing.");
  if (!onStudioNet(chainId)) throw new Error("Switch to StudioNet and reconnect.");
}

function isEthereumProvider(value: unknown): value is EthereumProvider {
  return Boolean(value && typeof value === "object" && typeof (value as EthereumProvider).request === "function");
}

function isMetaMask(option: WalletProviderOption): boolean {
  return option.rdns.toLowerCase() === "io.metamask"
    || option.name.toLowerCase() === "metamask"
    || Boolean(option.provider.isMetaMask && !option.provider.isBraveWallet);
}

export async function discoverWalletProviders(waitMs = WALLET_DISCOVERY_MS): Promise<WalletProviderOption[]> {
  if (typeof window === "undefined") return [];
  const found: WalletProviderOption[] = [];
  const seen = new Set<EthereumProvider>();
  const add = (option: WalletProviderOption) => {
    if (!seen.has(option.provider)) { seen.add(option.provider); found.push(option); }
  };
  const announce = (event: Event) => {
    const detail = (event as CustomEvent<unknown>).detail as Partial<Eip6963ProviderDetail> | undefined;
    const info = detail?.info;
    if (!info || !isEthereumProvider(detail?.provider)
      || typeof info.uuid !== "string" || typeof info.name !== "string" || typeof info.rdns !== "string") return;
    add({ id: info.uuid, name: info.name, rdns: info.rdns, provider: detail.provider });
  };
  window.addEventListener("eip6963:announceProvider", announce as EventListener);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  await new Promise<void>((resolve) => window.setTimeout(resolve, Math.max(0, waitMs)));
  window.removeEventListener("eip6963:announceProvider", announce as EventListener);

  const injected = window.ethereum;
  const legacy = injected?.providers?.filter(isEthereumProvider) ?? (isEthereumProvider(injected) ? [injected] : []);
  legacy.forEach((provider, index) => add({
    id: `legacy-${index}`,
    name: provider.isMetaMask && !provider.isBraveWallet ? "MetaMask" : legacy.length === 1 ? "Browser wallet" : `Browser wallet ${index + 1}`,
    rdns: provider.isMetaMask && !provider.isBraveWallet ? "io.metamask" : `legacy.${index}`,
    provider,
  }));
  return found.sort((left, right) => Number(isMetaMask(right)) - Number(isMetaMask(left)));
}

export async function connectWallet(): Promise<WalletSession> {
  const options = await discoverWalletProviders();
  const selected = options.find(isMetaMask) ?? (options.length === 1 ? options[0] : undefined);
  if (!selected) {
    if (options.length > 1) throw new Error("Multiple wallets detected, but MetaMask was not announced. Choose or enable MetaMask and try again.");
    throw new Error("Install or enable MetaMask to connect.");
  }
  const provider = selected.provider;
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  const address = Array.isArray(accounts) ? accounts[0] : undefined;
  if (typeof address !== "string" || !isAddress(address)) throw new Error("The wallet returned an invalid account.");
  return buildWalletSession(provider, address);
}

async function buildWalletSession(provider: EthereumProvider, address: string): Promise<WalletSession> {
  const walletAddress = address as Address;
  const client = createClient({ chain: chains.studionet, account: walletAddress, provider: provider as never });
  await client.connect("studionet");
  const session = { address: walletAddress, client, provider };
  await assertWallet(session);
  return session;
}

export async function restoreWallet(): Promise<WalletSession | null> {
  const options = await discoverWalletProviders();
  const selected = options.find(isMetaMask) ?? (options.length === 1 ? options[0] : undefined);
  if (!selected) return null;
  const [accounts, chainId] = await Promise.all([
    selected.provider.request({ method: "eth_accounts" }),
    selected.provider.request({ method: "eth_chainId" }),
  ]);
  const address = Array.isArray(accounts) ? accounts[0] : undefined;
  if (typeof address !== "string" || !isAddress(address) || !onStudioNet(chainId)) return null;
  return buildWalletSession(selected.provider, address);
}

export function watchWallet(session: WalletSession, invalidate: (reason: string) => void): () => void {
  const accountsChanged: WalletListener = (accounts) => {
    if (!Array.isArray(accounts) || typeof accounts[0] !== "string" || !sameAddress(accounts[0], session.address)) invalidate("Wallet account changed. Reconnect to continue.");
  };
  const chainChanged: WalletListener = (chainId) => { if (!onStudioNet(chainId)) invalidate("Network changed. Reconnect on StudioNet."); };
  const disconnected: WalletListener = () => invalidate("Wallet disconnected.");
  const listeners: [string, WalletListener][] = [["accountsChanged", accountsChanged], ["chainChanged", chainChanged], ["disconnect", disconnected]];
  for (const [event, listener] of listeners) session.provider.on?.(event, listener);
  return () => { for (const [event, listener] of listeners) session.provider.removeListener?.(event, listener); };
}

export function getPendingTransaction(): PendingTransaction | null {
  if (typeof window === "undefined" || !storageUsable) return memoryPending;
  try {
    const raw = window.localStorage.getItem(pendingKey);
    if (!raw) { memoryPending = null; return null; }
    const value = asRecord(JSON.parse(raw));
    if (typeof value.hash === "string" && /^0x[0-9a-fA-F]{64}$/.test(value.hash) && typeof value.functionName === "string" && typeof value.account === "string" && isAddress(value.account)) {
      let effect: PendingEffect | undefined;
      if (value.effect && typeof value.effect === "object" && !Array.isArray(value.effect)) {
        const rawEffect = value.effect as Record<string, unknown>;
        const rawValues = rawEffect.values;
        if (typeof rawEffect.kind === "string" && rawValues && typeof rawValues === "object" && !Array.isArray(rawValues)
          && Object.values(rawValues).every((item) => typeof item === "string")) {
          effect = { kind: rawEffect.kind, values: rawValues as Record<string, string> };
        }
      }
      memoryPending = {
        hash: value.hash,
        functionName: value.functionName,
        account: value.account,
        createdAt: typeof value.createdAt === "number" && Number.isSafeInteger(value.createdAt) ? value.createdAt : undefined,
        effect,
      };
      return memoryPending;
    }
  } catch { storageUsable = false; }
  return memoryPending;
}

function savePending(value: PendingTransaction | null): void {
  memoryPending = value;
  if (typeof window === "undefined") return;
  try {
    if (value) window.localStorage.setItem(pendingKey, JSON.stringify(value));
    else window.localStorage.removeItem(pendingKey);
    storageUsable = true;
  } catch { storageUsable = false; }
}

export function clearPendingTransaction(hash?: string): void {
  const pending = getPendingTransaction();
  if (hash && pending && pending.hash !== hash) throw new Error("The saved transaction changed. Check its status again.");
  savePending(null);
}

function makeEffect(kind: string, values: Record<string, string | number | bigint | boolean>): PendingEffect {
  return { kind, values: Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)])) };
}

async function preparePendingEffect(account: Address, functionName: string, args: unknown[], value: bigint): Promise<PendingEffect> {
  const text = (index: number) => String(args[index] ?? "");
  if (functionName === "deposit") {
    const before = await getCredit(account);
    return makeEffect("credit_increase", { before, expected: before + value });
  }
  if (functionName === "withdraw_credit") {
    return makeEffect("credit_zero", { before: await getCredit(account) });
  }
  if (functionName === "create_bounty") {
    return makeEffect("create_bounty", {
      title: text(0).trim(), criteria: text(1).trim(), issueUrl: text(2).trim().replace(/\/$/, "").toLowerCase(),
      deadlineUnix: text(3), potAtto: text(4),
    });
  }
  if (functionName === "submit_claim") {
    return makeEffect("submit_claim", {
      bountyId: text(0), prUrl: text(1).trim().replace(/\/$/, "").toLowerCase(),
      headSha: text(2).trim().toLowerCase(), githubLogin: text(3).trim().toLowerCase(),
    });
  }
  if (["resolve_claim", "appeal_claim", "release_rejected_stake", "timeout_claim"].includes(functionName)) {
    const claim = await getClaim(text(0), text(1));
    return makeEffect("claim_transition", {
      method: functionName, bountyId: text(0), index: text(1), beforeStatus: claim.status,
      beforeAppealCount: claim.appeal_count, beforeDigest: claim.source_digest,
    });
  }
  if (["challenge_claim", "finalize_bounty", "claim_payout", "cancel_bounty", "expire_bounty"].includes(functionName)) {
    const bounty = await getBounty(text(0));
    return makeEffect("bounty_transition", {
      method: functionName, bountyId: text(0), beforeStatus: bounty.status, beforeChallenged: bounty.challenged,
    });
  }
  return makeEffect("unknown", { method: functionName });
}

function canonicalIssue(item: BountySummary): string {
  return `https://github.com/${item.owner_repo}/issues/${item.issue_number}`.toLowerCase();
}

function numericGreater(current: string, previous: string): boolean {
  try { return BigInt(current) > BigInt(previous); }
  catch { return false; }
}

async function pendingEffectApplied(pending: PendingTransaction): Promise<boolean> {
  const effect = pending.effect;
  if (!effect) return false;
  const value = effect.values;
  if (effect.kind === "credit_increase") {
    try { return await getCredit(pending.account) >= BigInt(value.expected); }
    catch { return false; }
  }
  if (effect.kind === "credit_zero") return await getCredit(pending.account) === 0n && value.before !== "0";
  if (effect.kind === "create_bounty") {
    const page = await listSponsorBounties(pending.account);
    return page.items.some((item) => sameAddress(item.sponsor, pending.account)
      && item.title === value.title
      && item.acceptance_criteria === value.criteria
      && canonicalIssue(item) === value.issueUrl
      && item.deadline_unix === value.deadlineUnix
      && item.pot_atto === value.potAtto);
  }
  if (effect.kind === "submit_claim") {
    const page = await listHunterClaims(pending.account);
    return page.items.some((item) => sameAddress(item.hunter, pending.account)
      && item.bounty_id === value.bountyId
      && item.pr_url.replace(/\/$/, "").toLowerCase() === value.prUrl
      && item.pr_head_sha.toLowerCase() === value.headSha
      && item.github_login.toLowerCase() === value.githubLogin);
  }
  if (effect.kind === "claim_transition") {
    const claim = await getClaim(value.bountyId, value.index);
    if (value.method === "resolve_claim") return claim.status !== value.beforeStatus || claim.source_digest !== value.beforeDigest;
    if (value.method === "appeal_claim") return numericGreater(claim.appeal_count, value.beforeAppealCount);
    if (value.method === "release_rejected_stake") return claim.status === "REJECTED_FINAL" && claim.stake_released;
    if (value.method === "timeout_claim") return claim.status === "TIMED_OUT" && claim.stake_released;
  }
  if (effect.kind === "bounty_transition") {
    const bounty = await getBounty(value.bountyId);
    if (value.method === "challenge_claim") return bounty.challenged || (value.beforeStatus === "AWARDED" && bounty.status === "OPEN");
    if (value.method === "finalize_bounty") return ["FINALIZED", "SETTLED"].includes(bounty.status);
    if (value.method === "claim_payout") return bounty.status === "SETTLED";
    if (value.method === "cancel_bounty") return bounty.status === "CANCELLED";
    if (value.method === "expire_bounty") return bounty.status === "REFUNDED";
  }
  return false;
}

class ExecutionFailure extends Error {}

function receiptStatus(receipt: unknown): string | undefined {
  const value = recordOrNull(receipt);
  const status = value?.statusName ?? value?.status_name;
  return typeof status === "string" ? status : undefined;
}

function leaderReceipt(receipt: unknown): Record<string, unknown> | null {
  const value = recordOrNull(receipt);
  const consensus = recordOrNull(value?.consensusData ?? value?.consensus_data);
  const candidates = consensus?.leaderReceipt ?? consensus?.leader_receipt;
  if (!Array.isArray(candidates)) return recordOrNull(candidates);
  const records = candidates.map(recordOrNull).filter((item): item is Record<string, unknown> => item !== null);
  return [...records].reverse().find((item) => item.mode === "leader") ?? records.at(-1) ?? null;
}

function receiptExecution(receipt: unknown): ExecutionResult | undefined {
  const value = recordOrNull(receipt);
  const direct = value?.txExecutionResultName ?? value?.tx_execution_result_name;
  if (direct === ExecutionResult.FINISHED_WITH_RETURN || direct === ExecutionResult.FINISHED_WITH_ERROR) return direct;
  const leader = leaderReceipt(receipt);
  const execution = typeof leader?.execution_result === "string" ? leader.execution_result.toUpperCase() : "";
  if (execution === "SUCCESS") return ExecutionResult.FINISHED_WITH_RETURN;
  if (execution === "ERROR" || execution === "FAILURE") return ExecutionResult.FINISHED_WITH_ERROR;
  const result = recordOrNull(leader?.result);
  if (result?.status === "return") return ExecutionResult.FINISHED_WITH_RETURN;
  if (result?.status === "contract_error" || result?.status === "error") return ExecutionResult.FINISHED_WITH_ERROR;
  return undefined;
}

function receiptFailureMessage(receipt: unknown): string {
  const value = recordOrNull(receipt);
  if (typeof value?.error === "string" && value.error.trim()) return value.error;
  const leader = leaderReceipt(receipt);
  const genvm = recordOrNull(leader?.genvm_result);
  for (const candidate of [genvm?.stderr, genvm?.error_description, recordOrNull(leader?.result)?.payload]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return "Contract execution failed. Your inputs are saved.";
}

function bounded<T>(work: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    work.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

async function waitForSuccess(pending: PendingTransaction, onProgress: ProgressHandler, retries = 120): Promise<void> {
  onProgress({ state: "finalizing", label: "Waiting for GenLayer confirmation", hash: pending.hash });
  const receipt = await readClient.waitForTransactionReceipt({
    hash: pending.hash as never,
    status: TransactionStatus.FINALIZED,
    interval: FINALITY_POLL_INTERVAL_MS,
    retries,
  });
  if (receiptStatus(receipt) !== TransactionStatus.FINALIZED) throw new Error("Transaction is not finalized yet.");
  const execution = receiptExecution(receipt);
  if (execution !== ExecutionResult.FINISHED_WITH_RETURN && execution !== ExecutionResult.FINISHED_WITH_ERROR) {
    throw new Error("Execution result unavailable. Check status before retrying.");
  }
  savePending(null);
  if (execution === ExecutionResult.FINISHED_WITH_ERROR) {
    throw new ExecutionFailure(receiptFailureMessage(receipt));
  }
  onProgress({ state: "confirmed", label: "Confirmed", hash: pending.hash });
}

function transactionError(error: unknown, pending: PendingTransaction | null, onProgress: ProgressHandler): void {
  if (pending && !(error instanceof ExecutionFailure)) {
    onProgress({ state: "unconfirmed", label: "Confirmation pending. Check status before retrying.", hash: pending.hash });
  } else {
    onProgress({ state: "failed", label: friendlyError(error), hash: pending?.hash });
  }
}

async function confirmFromContractState(pending: PendingTransaction, onProgress: ProgressHandler): Promise<boolean> {
  if (!await pendingEffectApplied(pending)) return false;
  savePending(null);
  onProgress({ state: "confirmed", label: "Confirmed from contract state.", hash: pending.hash });
  return true;
}

export async function resumePendingTransaction(onProgress: ProgressHandler): Promise<string> {
  const pending = getPendingTransaction();
  if (!pending) throw new Error("No transaction is awaiting confirmation.");
  try {
    await bounded(waitForSuccess(pending, onProgress, 0), RECOVERY_LOOKUP_TIMEOUT_MS, "Transaction status lookup timed out.");
    return pending.functionName;
  }
  catch (error) {
    if (!(error instanceof ExecutionFailure)) {
      try {
        if (await bounded(confirmFromContractState(pending, onProgress), RECOVERY_LOOKUP_TIMEOUT_MS, "Contract-state lookup timed out.")) return pending.functionName;
        // Legacy v3.1 deposit markers predate exact effect metadata. Any
        // available credit remains owned and withdrawable by this account.
        if (!pending.effect && pending.functionName === "deposit" && await getCredit(pending.account) > 0n) {
          savePending(null);
          onProgress({ state: "confirmed", label: "App balance found. Continue to Step 2.", hash: pending.hash });
          return "deposit_credit_recovered";
        }
      } catch { /* Keep the marker when neither receipt nor state can be verified. */ }
    }
    transactionError(error, pending, onProgress);
    throw error;
  }
}

async function write(session: WalletSession, functionName: string, args: unknown[], value: bigint | undefined, onProgress: ProgressHandler, validate?: (config: ProtocolConfig) => void, spend: bigint | "stake" = 0n): Promise<string> {
  if (writeInFlight) throw new Error("A transaction is already in progress.");
  const previous = getPendingTransaction();
  if (previous) {
    onProgress({ state: "unconfirmed", label: "Check the previous transaction before submitting another.", hash: previous.hash });
    throw new Error("Check the pending transaction first.");
  }
  writeInFlight = true;
  let pending: PendingTransaction | null = null;
  try {
    onProgress({ state: "checking", label: "Checking wallet and contract" });
    const [config] = await Promise.all([getConfig(), verifyContractInterface()]);
    assertCompatible(config);
    validate?.(config);
    const requiredCredit = spend === "stake" ? BigInt(config.claim_stake_atto) : spend;
    if (requiredCredit > 0n && await getCredit(session.address) < requiredCredit) throw new Error("Add GEN to your app balance first. Unused balance is withdrawable.");
    if (value !== undefined && value > 0n && functionName !== "deposit") throw new Error("GEN can only be attached to the deposit method.");
    const effect = await preparePendingEffect(session.address, functionName, args, value ?? 0n);
    await assertWallet(session);
    onProgress({ state: "awaiting-signature", label: "Confirm in your wallet" });
    const request = {
      address: contractAddress(), functionName, args: args as never[],
      ...(value === undefined ? {} : { value }),
    } as Parameters<WalletSession["client"]["writeContract"]>[0];
    const hash = await session.client.writeContract(request);
    pending = { hash: String(hash), functionName, account: session.address, createdAt: Date.now(), effect };
    savePending(pending);
    onProgress({ state: "submitted", label: "Transaction submitted", hash: pending.hash });
    try { await bounded(waitForSuccess(pending, onProgress), WRITE_CONFIRMATION_TIMEOUT_MS, "Confirmation lookup timed out."); }
    catch (error) {
      if (!(error instanceof ExecutionFailure)
        && await bounded(confirmFromContractState(pending, onProgress), RECOVERY_LOOKUP_TIMEOUT_MS, "Contract-state lookup timed out.")) return pending.hash;
      throw error;
    }
    return pending.hash;
  } catch (error) {
    transactionError(error, pending, onProgress);
    throw error;
  } finally { writeInFlight = false; }
}

export const depositCredit = (s: WalletSession, amount: bigint, p: ProgressHandler) => write(s, "deposit", [], amount, p, (config) => {
  if (amount <= 0n || amount > BigInt(config.max_pot_atto)) throw new Error("Choose an amount up to " + formatGen(config.max_pot_atto) + " GEN.");
});
export const withdrawCredit = (s: WalletSession, p: ProgressHandler) => write(s, "withdraw_credit", [], undefined, p);
export const createBounty = (s: WalletSession, input: CreateInput, p: ProgressHandler) => write(s, "create_bounty", [input.title.trim(), input.criteria.trim(), input.issueUrl.trim(), input.deadlineUnix, input.potAtto], undefined, p, (config) => validateCreateInput(input, config), input.potAtto);
export const submitClaim = (s: WalletSession, bounty: BountyView, prUrl: string, sha: string, login: string, p: ProgressHandler) => write(s, "submit_claim", [bounty.id, prUrl.trim(), sha.trim().toLowerCase(), login.trim()], undefined, p, () => validateClaimInput(bounty.owner_repo, prUrl, sha, login), "stake");
export const resolveClaim = (s: WalletSession, id: string, index: string, p: ProgressHandler) => write(s, "resolve_claim", [id, claimIndex(index)], undefined, p);
export const appealClaim = (s: WalletSession, id: string, index: string, p: ProgressHandler) => write(s, "appeal_claim", [id, claimIndex(index)], undefined, p);
export const releaseRejectedStake = (s: WalletSession, id: string, index: string, p: ProgressHandler) => write(s, "release_rejected_stake", [id, claimIndex(index)], undefined, p);
export const timeoutClaim = (s: WalletSession, id: string, index: string, p: ProgressHandler) => write(s, "timeout_claim", [id, claimIndex(index)], undefined, p);
export const challengeClaim = (s: WalletSession, id: string, statement: string, p: ProgressHandler) => write(s, "challenge_claim", [id, statement.trim()], undefined, p, (config) => validateChallengeInput(statement, config), "stake");
export const finalizeBounty = (s: WalletSession, id: string, p: ProgressHandler) => write(s, "finalize_bounty", [id], undefined, p);
export const claimPayout = (s: WalletSession, id: string, p: ProgressHandler) => write(s, "claim_payout", [id], undefined, p);
export const cancelBounty = (s: WalletSession, id: string, p: ProgressHandler) => write(s, "cancel_bounty", [id], undefined, p);
export const expireBounty = (s: WalletSession, id: string, p: ProgressHandler) => write(s, "expire_bounty", [id], undefined, p);
