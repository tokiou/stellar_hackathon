// Declarative table of the six Stellar Wave 6 demo cases.
// Pure data + envelope-op builders; consumed by scripts/stellar-demo.mjs.
//
// Each `buildOps(ctx)` returns an array of @stellar/stellar-sdk Operations for a
// transaction built on the funded, multisig-configured demo account.
//   ctx = { Operation, Asset, accountId, userPublicKey, destination, blockedDestination }

export const DEMO_CASES = [
	{
		id: 1,
		title: "Legit payment within policy",
		userSigns: true,
		expectedDecision: "ALLOW",
		expectedOutcome: "executable",
		knownRecipient: true,
		buildOps: (ctx) => [
			ctx.Operation.payment({
				destination: ctx.destination,
				asset: ctx.Asset.native(),
				amount: "50.0000000", // ~$5 at FALLBACK_XLM_USD_PRICE=0.1
			}),
		],
	},
	{
		id: 2,
		title: "Payment to a blocked / non-authorized destination",
		userSigns: true,
		expectedDecision: "DENY",
		expectedOutcome: "not_submitted",
		knownRecipient: false,
		usesBlockedDestination: true,
		buildOps: (ctx) => [
			ctx.Operation.payment({
				destination: ctx.blockedDestination,
				asset: ctx.Asset.native(),
				amount: "5.0000000",
			}),
		],
	},
	{
		id: 3,
		title: "Amount out of range",
		userSigns: true,
		expectedDecision: "ESCALATE",
		expectedOutcome: "not_submitted",
		knownRecipient: true,
		buildOps: (ctx) => [
			ctx.Operation.payment({
				destination: ctx.destination,
				asset: ctx.Asset.native(),
				amount: "200.0000000", // ~$20 > $10 limit
			}),
		],
	},
	{
		id: 4,
		title: "Critical operation (setOptions / changeTrust present)",
		userSigns: true,
		expectedDecision: "ESCALATE",
		expectedOutcome: "not_submitted",
		knownRecipient: true,
		buildOps: (ctx) => [
			ctx.Operation.setOptions({ homeDomain: "compass-demo.example" }),
		],
	},
	{
		id: 5,
		title: "User signs but Compass does NOT sign",
		userSigns: true,
		// Drives an ESCALATE so Compass withholds its signature; submitting with
		// only the user's signature must FAIL because the threshold is unmet.
		expectedDecision: "ESCALATE",
		expectedOutcome: "not_executable",
		knownRecipient: true,
		submitWithoutCompass: true,
		buildOps: (ctx) => [
			ctx.Operation.payment({
				destination: ctx.destination,
				asset: ctx.Asset.native(),
				amount: "200.0000000",
			}),
		],
	},
	{
		id: 6,
		title: "User + Compass sign",
		userSigns: true,
		expectedDecision: "ALLOW",
		expectedOutcome: "executable",
		knownRecipient: true,
		buildOps: (ctx) => [
			ctx.Operation.payment({
				destination: ctx.destination,
				asset: ctx.Asset.native(),
				amount: "10.0000000",
			}),
		],
	},
];
