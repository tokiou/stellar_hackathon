import { Connection, PublicKey } from '@solana/web3.js';

export type OnchainApprovalProof = {
  execute_tx_signature: string;
  expected_signer?: string;
  expected_network?: 'devnet' | 'mainnet-beta';
};

function getConnection() {
  const rpc = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
  return new Connection(rpc, 'confirmed');
}

export async function verifyOracleExecutionTx(proof: OnchainApprovalProof): Promise<{
  ok: boolean;
  reason?: string;
}> {
  const programId = process.env.AGENT_ACTION_GUARD_PROGRAM_ID;
  if (!programId) return { ok: false, reason: 'AGENT_ACTION_GUARD_PROGRAM_ID_NOT_CONFIGURED' };

  const expectedNetwork = proof.expected_network || 'devnet';
  if (expectedNetwork === 'mainnet-beta') {
    return { ok: false, reason: 'MAINNET_GUARD_PROOF_NOT_SUPPORTED_IN_MVP' };
  }

  const conn = getConnection();
  const tx = await conn.getTransaction(proof.execute_tx_signature, {
    maxSupportedTransactionVersion: 0,
    commitment: 'confirmed',
  });

  if (!tx || tx.meta?.err) return { ok: false, reason: 'EXECUTE_TX_NOT_CONFIRMED' };

  const expectedProgram = new PublicKey(programId).toBase58();
  const hasProgramInvocation = tx.transaction.message.compiledInstructions.some((ix) => {
    const programKey = tx.transaction.message.staticAccountKeys[ix.programIdIndex];
    return programKey?.toBase58() === expectedProgram;
  });

  if (!hasProgramInvocation) {
    return { ok: false, reason: 'EXECUTE_TX_MISSING_AGENT_ACTION_GUARD_INSTRUCTION' };
  }

  if (proof.expected_signer) {
    const firstInstructionAccount = tx.transaction.message.staticAccountKeys[0];
    if (!firstInstructionAccount || firstInstructionAccount.toBase58() !== proof.expected_signer) {
      return { ok: false, reason: 'EXECUTE_TX_SIGNER_MISMATCH' };
    }
  }

  return { ok: true };
}
