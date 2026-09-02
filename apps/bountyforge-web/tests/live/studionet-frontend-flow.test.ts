import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chains, createAccount, createClient } from "genlayer-js";
import { TransactionHashVariant, TransactionStatus, type Hash } from "genlayer-js/types";
import {
  cancelBounty,
  createBounty,
  depositCredit,
  getBounty,
  getCredit,
  listSponsorBounties,
  type EthereumProvider,
  type TxProgress,
  type WalletSession,
} from "../../src/lib/contract";

const POT = 1_000_000_000_000_000n;
const CONTRACT = process.env.NEXT_PUBLIC_BOUNTYFORGE_ADDRESS as `0x${string}`;
const account = createAccount();
const client = createClient({ chain: chains.studionet, account });
const provider: EthereumProvider = {
  request: async ({ method }) => {
    if (method === "eth_chainId") return "0xf22f";
    if (method === "eth_accounts") return [account.address];
    throw new Error(`Unexpected wallet request: ${method}`);
  },
};
const session: WalletSession = { address: account.address, client, provider };
const evidence: Record<string, string> = {};

function rawStatus(receipt: unknown): unknown {
  const value = receipt as { statusName?: unknown; status_name?: unknown };
  return value.statusName ?? value.status_name;
}

async function read(functionName: string, args: unknown[] = []): Promise<unknown> {
  return client.readContract({
    address: CONTRACT,
    functionName,
    args: args as never[],
    transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
  });
}

async function waitFinal(hash: Hash): Promise<void> {
  const receipt = await client.waitForTransactionReceipt({ hash, status: TransactionStatus.FINALIZED, interval: 3000, retries: 120 });
  expect(rawStatus(receipt)).toBe(TransactionStatus.FINALIZED);
}

beforeAll(async () => {
  expect(CONTRACT).toMatch(/^0x[0-9a-fA-F]{40}$/);
  const hash = await client.request({ method: "sim_fundAccount", params: [account.address, Number(2n * POT)] }) as Hash;
  await waitFinal(hash);
  evidence.fund = hash;
});

afterAll(async () => {
  try {
    const listing = await read("list_sponsor_bounties", [account.address, 0, 25]) as { items?: Array<{ id: string; status: string; cancellable: boolean }> };
    for (const bounty of listing.items ?? []) {
      if (bounty.status === "OPEN" && bounty.cancellable) {
        const hash = await client.writeContract({ address: CONTRACT, functionName: "cancel_bounty", args: [bounty.id], value: 0n });
        await waitFinal(hash);
      }
    }
    const credit = BigInt(await read("get_credit", [account.address]) as string);
    if (credit > 0n) {
      const hash = await client.writeContract({ address: CONTRACT, functionName: "withdraw_credit", args: [], value: 0n });
      await waitFinal(hash);
    }
  } catch (error) {
    console.warn("StudioNet cleanup warning", error);
  }
});

describe("canonical StudioNet flow through the frontend transaction adapter", () => {
  it("deposits, creates with zero attached value, observes finalized state, and refunds", async () => {
    const progress: TxProgress[] = [];
    evidence.deposit = await depositCredit(session, POT, (value) => progress.push(value));
    expect(progress.at(-1)?.state).toBe("confirmed");
    expect(await getCredit(account.address)).toBe(POT);

    progress.length = 0;
    evidence.create = await createBounty(session, {
      title: `Frontend canonical verification ${Date.now()}`,
      criteria: "Verify the canonical deposit, creation, finalized state, and refund sequence.",
      issueUrl: "https://github.com/Demigodd00/bountyforge/issues/1",
      deadlineUnix: Math.floor(Date.now() / 1000) + 7200,
      potAtto: POT,
    }, (value) => progress.push(value));
    expect(progress.at(-1)?.state).toBe("confirmed");
    const createTx = await client.getTransaction({ hash: evidence.create as Hash });
    expect(BigInt(createTx.value ?? 0)).toBe(0n);
    expect(await getCredit(account.address)).toBe(0n);

    const listing = await listSponsorBounties(account.address);
    expect(listing.total).toBe(1);
    evidence.bountyId = listing.items[0].id;
    expect((await getBounty(evidence.bountyId)).status).toBe("OPEN");

    progress.length = 0;
    evidence.cancel = await cancelBounty(session, evidence.bountyId, (value) => progress.push(value));
    expect(progress.at(-1)?.state).toBe("confirmed");
    expect((await getBounty(evidence.bountyId)).status).toBe("CANCELLED");
    console.log("CANONICAL_FRONTEND_FLOW", JSON.stringify({ contract: CONTRACT, actor: account.address, ...evidence, createAttachedValueAtto: "0" }));
  });
});
