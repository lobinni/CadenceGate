/**
 * Browser entry point for the canonical scheduler.
 *
 * The implementation lives in sdk/schedule.ts so that the SDK, the scripts and
 * the interface always share one arithmetic. The deployed contract performs the
 * identical integer steps, so a preview here matches the on-chain receipt.
 */

export { buildProof, timelineBounds, WINDOW_LABELS } from "../../sdk/schedule";
