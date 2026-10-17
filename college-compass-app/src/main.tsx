import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/base.css";
import { App } from "@/app/App";
import { isNative } from "@/platform";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Service worker: production only (avoids stale caches during development).
// Never in the native app: assets ship inside the bundle, a SW would only add stale-cache risk.
if (import.meta.env.PROD && !isNative() && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      /* offline support is optional */
    });
  });
}
