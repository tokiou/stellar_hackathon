import { Account, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";

import type { AccountSignerState } from "@shared/chainContracts";

/**
 * Native Stellar multisig setup for the Wave 6 demo. Builds the `setOptions`
 * transaction that makes Compass a REQUIRED co-signer: master/user weight +
 * Compass weight (both 1) equal the medium threshold (2), so neither signer
 * alone reaches it. No custom on-chain contract — the guarantee is native.
 */

export type MultisigSetupInput = {
	accountId: string;
	/** Current account sequence (string), as required by the SDK. */
	sequence: string;
	compassSignerPublicKey: string;
	networkPassphrase?: string;
	masterWeight?: number;
	threshold?: number;
	fee?: string;
};

export function buildMultisigSetupEnvelope(input: MultisigSetupInput): string {
	const networkPassphrase = input.networkPassphrase ?? Networks.TESTNET;
	const masterWeight = input.masterWeight ?? 1;
	const threshold = input.threshold ?? 2;

	const account = new Account(input.accountId, input.sequence);
	const tx = new TransactionBuilder(account, {
		fee: input.fee ?? "100",
		networkPassphrase,
	})
		.addOperation(
			Operation.setOptions({
				masterWeight,
				lowThreshold: threshold,
				medThreshold: threshold,
				highThreshold: threshold,
				signer: {
					ed25519PublicKey: input.compassSignerPublicKey,
					weight: 1,
				},
			}),
		)
		.setTimeout(120)
		.build();

	return tx.toXDR();
}

/**
 * Compass is genuinely required when it is one of the account signers and the
 * (medium) threshold cannot be met by a single weight-1 signer — i.e.
 * threshold >= 2 with at least two signers. The demo asserts this before
 * running any case so it never reports a misleading "not executable".
 */
export function isCompassRequired(
	account: AccountSignerState,
	compassPublicKey: string,
): boolean {
	if (!account.exists) {
		return false;
	}
	if (!account.signers?.includes(compassPublicKey)) {
		return false;
	}
	if ((account.signers?.length ?? 0) < 2) {
		return false;
	}
	return typeof account.threshold === "number" && account.threshold >= 2;
}

export function assertCompassRequired(
	account: AccountSignerState,
	compassPublicKey: string,
): void {
	if (!isCompassRequired(account, compassPublicKey)) {
		throw new Error(
			"STELLAR_DEMO_COMPASS_NOT_REQUIRED: account multisig does not make Compass a required signer; aborting to avoid misleading results.",
		);
	}
}
