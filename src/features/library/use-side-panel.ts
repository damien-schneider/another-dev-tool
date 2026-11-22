import { useState } from "react";

import type { SidePanel } from "./editor/editor-header";

const SIDE_PANEL_STORAGE_KEY = "another-dev-tool.agent-panel";

function readStoredSidePanel(): SidePanel | null {
  const stored = window.localStorage.getItem(SIDE_PANEL_STORAGE_KEY);
  if (stored === "closed") {
    return null;
  }
  return stored === "history" ? "history" : "agent";
}

export interface UseSidePanel {
  panel: SidePanel | null;
  toggle: (panel: SidePanel) => void;
  show: (panel: SidePanel) => void;
}

export function useSidePanel(): UseSidePanel {
  const [panel, setPanel] = useState(readStoredSidePanel);
  const choose = (next: SidePanel | null) => {
    setPanel(next);
    window.localStorage.setItem(SIDE_PANEL_STORAGE_KEY, next ?? "closed");
  };
  return {
    panel,
    toggle: (target) => choose(panel === target ? null : target),
    show: choose,
  };
}
