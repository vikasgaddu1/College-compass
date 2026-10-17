/** Public surface of the AI layer (UI imports from here or the individual modules). */
export { auth, createAuth, parseModels, type ChatGPTAuth } from "./auth";
export {
  aiClient, createAiClient, AiCallError, USAGE_LIMIT_MESSAGE, manageUsageUrl,
  getDevApiKey, setDevApiKey, getDevModel, setDevModel, getPreferredModel, setPreferredModel,
  type CompassAiClient,
} from "./client";
export { research, createResearch } from "./research";
export { researchCache, createResearchCache, CACHE_MAX_AGE_MS, type ResearchCache } from "./cache";
export { chatInstructions, listAdvicePrompt, profileBrief, entryTerm } from "./prompts";
export { normalizeCollege, normalizeName } from "./normalize";
export { MANAGE_USAGE_URL, UI_COPY, CLIENT_ID, TOKEN_RELAY } from "./config";
