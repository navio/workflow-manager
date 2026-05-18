import "./index.css";
import "@xyflow/react/dist/style.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Runner UI root element not found");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
