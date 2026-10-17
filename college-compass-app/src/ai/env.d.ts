/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** OAuth client ID issued by OpenAI's Sign in with ChatGPT program (public client, no secret). */
  readonly VITE_CC_CHATGPT_CLIENT_ID?: string;
  /** Optional URL of the stateless token relay (relay/worker.js) for web builds blocked by CORS. */
  readonly VITE_CC_TOKEN_RELAY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
