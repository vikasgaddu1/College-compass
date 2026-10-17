/** Public API of the College Compass engine (pure TS, no I/O). */
export { ACT_TO_SAT_2018, actToSat, bestSat, schoolSatRange } from "./concordance";
export {
  estimateOdds,
  tierFromP,
  baseAdmitRate,
  offersEd,
  offersEa,
  isGatedMajor,
  isInState,
  TIER_CUTS,
  DEFAULT_ADMIT_RATE,
  P_MIN,
  P_MAX,
  ULTRA_SELECTIVE_RATE,
  ULTRA_SELECTIVE_MULTIPLIER,
  BAND_HALF_WIDTH,
  CONF_HIGH_MIN,
  CONF_MEDIUM_MIN,
} from "./odds";
export { estimateNetPrice, type NetPriceEstimate } from "./price";
export {
  scoreFit,
  academicsScore,
  affordabilityScore,
  outcomesScore,
  locationScore,
  locationChecks,
  majorScore,
  sizeBucket,
  MAJOR_TO_SHARE_KEYS,
  oddsFitScore,
  type LocationChecks,
  type ShareKey,
} from "./fit";
export {
  rankColleges,
  rankOne,
  buildBalancedList,
  summarizeListForAi,
  DEFAULT_BALANCED_SPEC,
  TIER_ORDER,
  AI_SUMMARY_MAX_CHARS,
  type BalancedSpec,
  type BalancedListResult,
  type BorrowedPick,
} from "./rank";
export { STATE_CENTROIDS, haversineMiles, distanceFromHome } from "./geo";
export { MAJOR_LABELS, TIER_LABELS, majorLabel, normName } from "./labels";
