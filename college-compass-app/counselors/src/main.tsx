import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/styles/base.css";
import "@/styles/app.css";
import "./portal.css";
import { Portal } from "./Portal";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Portal />
  </StrictMode>,
);
