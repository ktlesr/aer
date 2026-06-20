// @ktlsr/evidence-chain — dependency-free, framework-agnostic evidence hash chain.
// Verifiable without trusting the operator: the same verifyChain runs against a downloaded
// packet, a DB row set, or a future standalone CLI — with nothing installed but Node.
export type { EventCore, ChainLink, Finding, VerifyResult } from "./types";
export { canonicalize } from "./canonicalize";
export { genesisHash, hashEvent } from "./hash";
export { computeChain } from "./chain";
export { verifyChain } from "./verify";
