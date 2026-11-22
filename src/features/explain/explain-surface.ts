import { createContext, use } from "react";

import type { CodeRef } from "./source/code-ref";

/** What an answer's links and blocks reach: the project they describe, and the source pane. */
export interface ExplainSurface {
  project: string;
  openRef: (ref: CodeRef) => void;
}

export const ExplainSurfaceContext = createContext<ExplainSurface | null>(null);

export function useExplainSurface(): ExplainSurface {
  const surface = use(ExplainSurfaceContext);
  if (surface === null) {
    throw new Error(
      "useExplainSurface needs an ExplainSurfaceContext above it"
    );
  }
  return surface;
}
