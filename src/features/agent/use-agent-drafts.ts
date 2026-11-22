import { useCallback, useState } from "react";

export interface AgentDrafts {
  draft: string;
  setDraft: (text: string) => void;
  prefill: (fileId: number, text: string) => void;
}

export function useAgentDrafts(fileId: number | null): AgentDrafts {
  const [drafts, setDrafts] = useState<Record<number, string>>({});

  const prefill = useCallback((drafted: number, text: string) => {
    setDrafts((current) => ({ ...current, [drafted]: text }));
  }, []);

  const setDraft = useCallback(
    (text: string) => {
      if (fileId !== null) {
        prefill(fileId, text);
      }
    },
    [fileId, prefill]
  );

  return {
    draft: fileId === null ? "" : (drafts[fileId] ?? ""),
    setDraft,
    prefill,
  };
}
