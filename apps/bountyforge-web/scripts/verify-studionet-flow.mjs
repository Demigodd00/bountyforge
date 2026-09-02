import { chains, createAccount, createClient } from "genlayer-js";
import { ExecutionResult, TransactionHashVariant, TransactionStatus } from "genlayer-js/types";

const POT = 1_000_000_000_000_000n;
const contractAddress = process.env.NEXT_PUBLIC_BOUNTYFORGE_ADDRESS;
if (!/^0x[0-9a-fA-F]{40}$/.test(contractAddress ?? "") || /^0x0+$/.test(contractAddress)) {
  throw new Error("Set NEXT_PUBLIC_BOUNTYFORGE_ADDRESS to the canonical StudioNet contract.");
}

const json = (value) => JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item);
const record = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : null;
const statusOf = (receipt) => receipt.statusName ?? receipt.status_name;
const leaderOf = (receipt) => {
  const consensus = record(receipt.consensusData ?? receipt.consensus_data);
  const raw = consensus?.leaderReceipt ?? consensus?.leader_receipt;
  const receipts = Array.isArray(raw) ? raw.filter((item) => record(item)) : raw ? [raw] : [];
  return [...receipts].reverse().find((item) => item.mode === "leader") ?? receipts.at(-1) ?? null;
};
const executionOf = (receipt) => {
  const direct = receipt.txExecutionResultName ?? receipt.tx_execution_result_name;
  if (direct === ExecutionResult.FINISHED_WITH_RETURN || direct === ExecutionResult.FINISHED_WITH_ERROR) return direct;
  const leader = leaderOf(receipt);
  const execution = typeof leader?.execution_result === "string" ? leader.execution_result.toUpperCase() : "";
  if (execution === "SUCCESS") return ExecutionResult.FINISHED_WITH_RETURN;
  if (execution === "ERROR" || execution === "FAILURE") return ExecutionResult.FINISHED_WITH_ERROR;
  const result = record(leader?.result);
  if (result?.status === "return") return ExecutionResult.FINISHED_WITH_RETURN;
  if (result?.status === "contract_error" || result?.status === "error") return ExecutionResult.FINISHED_WITH_ERROR;
  return undefined;
};

const account = createAccount();
const client = createClient({ chain: chains.studionet, account });
const read = (functionName, args = []) => client.readContract({
  address: contractAddress,
  functionName,
  args,
  transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
});
const finalReceipt = (hash) => client.waitForTransactionReceipt({
  hash,
  status: TransactionStatus.FINALIZED,
  interval: 3000,
  retries: 120,
});
const waitWrite = async (label, hash) => {
  const receipt = await finalReceipt(hash);
  const status = statusOf(receipt);
  const execution = executionOf(receipt);
  const ok = status === TransactionStatus.FINALIZED && execution === ExecutionResult.FINISHED_WITH_RETURN;
  console.log(json({ label, hash, status, execution, value: receipt.value, ok }));
  if (!ok) throw new Error(`${label} did not execute successfully: ${json(receipt)}`);
  return receipt;
};

async function cleanup() {
  try {
    const listing = await read("list_sponsor_bounties", [account.address, 0, 25]);
    for (const bounty of listing.items ?? []) {
      if (bounty.status === "OPEN" && bounty.cancellable) {
        const hash = await client.writeContract({ address: contractAddress, functionName: "cancel_bounty", args: [bounty.id] });
        await waitWrite("cleanup_cancel_bounty", hash);
      }
    }
    const credit = BigInt(await read("get_credit", [account.address]));
    if (credit > 0n) {
      const hash = await client.writeContract({ address: contractAddress, functionName: "withdraw_credit", args: [] });
      await waitWrite("cleanup_withdraw_credit", hash);
    }
  } catch (error) {
    console.error(`Cleanup warning: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main() {
  console.log(json({ phase: "actor", network: "StudioNet", chainId: chains.studionet.id, contract: contractAddress, actor: account.address }));
  const schema = await client.getContractSchema(contractAddress);
  const depositSchema = schema.methods.deposit;
  const createSchema = schema.methods.create_bounty;
  const expectedCreateParams = [["title", "string"], ["acceptance_criteria", "string"], ["issue_url", "string"], ["deadline_unix", "int"], ["pot_atto", "int"]];
  if (!depositSchema?.payable || depositSchema.params.length !== 0
    || createSchema?.payable || JSON.stringify(createSchema?.params) !== JSON.stringify(expectedCreateParams)) {
    throw new Error("The canonical contract ABI does not match the frontend transaction flow.");
  }
  const config = await read("get_config");
  if (config.version !== "3.1.1" || config.funding_model !== "WITHDRAWABLE_DEPOSIT_CREDIT_V1") {
    throw new Error(`Unexpected canonical contract config: ${json(config)}`);
  }
  console.log(json({ phase: "contract_verified", depositPayable: true, createPayable: false, createParams: createSchema.params, config }));

  const fundHash = await client.request({ method: "sim_fundAccount", params: [account.address, Number(2n * POT)] });
  const fundReceipt = await finalReceipt(fundHash);
  if (statusOf(fundReceipt) !== TransactionStatus.FINALIZED || fundReceipt.value_credited !== true) {
    throw new Error(`StudioNet test funding failed: ${json(fundReceipt)}`);
  }
  console.log(json({ label: "fund_test_actor", hash: fundHash, status: statusOf(fundReceipt), value: fundReceipt.value }));

  const depositRequest = { address: contractAddress, functionName: "deposit", args: [], value: POT };
  const depositHash = await client.writeContract(depositRequest);
  await waitWrite("deposit", depositHash);
  const creditBeforeCreate = await read("get_credit", [account.address]);
  if (creditBeforeCreate !== POT.toString()) throw new Error(`Deposit credit mismatch: ${creditBeforeCreate}`);

  const createRequest = {
    address: contractAddress,
    functionName: "create_bounty",
    args: [
      "Canonical frontend StudioNet verification",
      "Verify deposit, zero-value creation, finalized state, and refund on the canonical release contract.",
      "https://github.com/Demigodd00/bountyforge/issues/1",
      Math.floor(Date.now() / 1000) + 7200,
      POT,
    ],
  };
  if (Object.hasOwn(createRequest, "value")) throw new Error("create_bounty must omit transaction value.");
  const createHash = await client.writeContract(createRequest);
  const createReceipt = await waitWrite("create_bounty", createHash);
  if (BigInt(createReceipt.value ?? 0) !== 0n) throw new Error(`create_bounty attached ${createReceipt.value} atto.`);

  const creditAfterCreate = await read("get_credit", [account.address]);
  const listing = await read("list_sponsor_bounties", [account.address, 0, 25]);
  if (creditAfterCreate !== "0" || listing.total !== "1") {
    throw new Error(`Post-create state mismatch: ${json({ creditAfterCreate, listing })}`);
  }
  const bountyId = listing.items[0].id;
  const created = await read("get_bounty", [bountyId]);
  if (created.status !== "OPEN" || created.pot_atto !== POT.toString()) throw new Error(`Created bounty mismatch: ${json(created)}`);

  const cancelRequest = { address: contractAddress, functionName: "cancel_bounty", args: [bountyId] };
  if (Object.hasOwn(cancelRequest, "value")) throw new Error("cancel_bounty must omit transaction value.");
  const cancelHash = await client.writeContract(cancelRequest);
  await waitWrite("cancel_bounty", cancelHash);
  const cancelled = await read("get_bounty", [bountyId]);
  if (cancelled.status !== "CANCELLED") throw new Error(`Cancellation mismatch: ${json(cancelled)}`);

  console.log(json({
    phase: "complete",
    contract: contractAddress,
    actor: account.address,
    bountyId,
    bountyStatus: cancelled.status,
    depositHash,
    createHash,
    createAttachedValueAtto: "0",
    cancelHash,
  }));
}

try {
  await main();
} catch (error) {
  await cleanup();
  throw error;
}
