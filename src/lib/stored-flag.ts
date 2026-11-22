import { useCallback, useState } from "react";

export function useStoredFlag(
  key: string,
  shownByDefault: boolean
): [shown: boolean, setShown: (shown: boolean) => void] {
  const [shown, setShown] = useState(() => {
    const stored = window.localStorage.getItem(key);
    return shownByDefault ? stored !== "hidden" : stored === "shown";
  });
  const store = useCallback(
    (next: boolean) => {
      setShown(next);
      window.localStorage.setItem(key, next ? "shown" : "hidden");
    },
    [key]
  );
  return [shown, store];
}
