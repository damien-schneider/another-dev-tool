import { useCallback, useState } from "react";

const OPEN_PROJECT_STORAGE_KEY = "another-dev-tool.open-project";

export interface OpenProject {
  /** The project the library lists alone; `null` lists every project. */
  path: string | null;
  open: (path: string | null) => void;
}

export function useOpenProject(): OpenProject {
  const [path, setPath] = useState(() =>
    window.localStorage.getItem(OPEN_PROJECT_STORAGE_KEY)
  );

  const open = useCallback((next: string | null) => {
    setPath(next);
    if (next === null) {
      window.localStorage.removeItem(OPEN_PROJECT_STORAGE_KEY);
    } else {
      window.localStorage.setItem(OPEN_PROJECT_STORAGE_KEY, next);
    }
  }, []);

  return { path, open };
}
