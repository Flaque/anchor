import { Buffer } from "buffer";
import assert from "assert";
import {
  AccountInfo,
  AccountMeta,
  Connection,
  PublicKey,
  TransactionSignature,
  Transaction,
  TransactionInstruction,
  Commitment,
} from "@solana/web3.js";
import { chunks } from "../utils/common.js";
import { Address, translateAddress } from "../program/common.js";
import Provider, { getProvider } from "../provider.js";

/**
 * Sends a transaction to a program with the given accounts and instruction
 * data.
 */
export async function invoke(
  programId: Address,
  accounts?: Array<AccountMeta>,
  data?: Buffer,
  provider?: Provider
): Promise<TransactionSignature> {
  programId = translateAddress(programId);
  if (!provider) {
    provider = getProvider();
  }

  const tx = new Transaction();
  tx.add(
    new TransactionInstruction({
      programId,
      keys: accounts ?? [],
      data,
    })
  );

  return await provider.send(tx);
}

const GET_MULTIPLE_ACCOUNTS_LIMIT: number = 99;

export async function getMultipleAccounts(
  connection: Connection,
  publicKeys: PublicKey[],
  commitment?: Commitment
): Promise<
  Array<null | { publicKey: PublicKey; account: AccountInfo<Buffer> }>
> {
  if (publicKeys.length <= GET_MULTIPLE_ACCOUNTS_LIMIT) {
    return await getMultipleAccountsCore(connection, publicKeys, commitment);
  } else {
    const batches = chunks(publicKeys, GET_MULTIPLE_ACCOUNTS_LIMIT);
    const results = await Promise.all<
      Array<null | { publicKey: PublicKey; account: AccountInfo<Buffer> }>
    >(
      batches.map((batch) =>
        getMultipleAccountsCore(connection, batch, commitment)
      )
    );
    return results.flat();
  }
}

async function getMultipleAccountsCore(
  connection: Connection,
  publicKeys: PublicKey[],
  commitmentOverride?: Commitment
): Promise<
  Array<null | { publicKey: PublicKey; account: AccountInfo<Buffer> }>
> {
  const commitment = commitmentOverride ?? connection.commitment;
  const args: (
    | string[]
    | {
        commitment: Commitment;
      }
  )[] = [publicKeys.map((k) => k.toBase58())];
  if (commitment) {
    args.push({ commitment });
  }
  // @ts-expect-error
  const res = await connection._rpcRequest("getMultipleAccounts", args);
  if (res.error) {
    throw new Error(
      "failed to get info about accounts " +
        publicKeys.map((k) => k.toBase58()).join(", ") +
        ": " +
        res.error.message
    );
  }
  assert(typeof res.result !== "undefined");
  const accounts: Array<null | {
    executable: any;
    owner: PublicKey;
    lamports: any;
    data: Buffer;
  }> = [];
  for (const account of res.result.value) {
    let value: {
      executable: any;
      owner: PublicKey;
      lamports: any;
      data: Buffer;
    } | null = null;
    if (account === null) {
      accounts.push(null);
      continue;
    }
    if (res.result.value) {
      const { executable, owner, lamports, data } = account;
      assert(data[1] === "base64");
      value = {
        executable,
        owner: new PublicKey(owner),
        lamports,
        data: Buffer.from(data[0], "base64"),
      };
    }
    if (value === null) {
      throw new Error("Invalid response");
    }
    accounts.push(value);
  }
  return accounts.map((account, idx) => {
    if (account === null) {
      return null;
    }
    return {
      publicKey: publicKeys[idx],
      account,
    };
  });
}
