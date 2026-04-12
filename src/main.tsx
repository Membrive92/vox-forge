import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { installGlobalErrorHandlers, logger } from "@/logging/logger";

import App from "./App";

installGlobalErrorHandlers();
logger.info("VoxForge UI starting", { userAgent: navigator.userAgent });

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
