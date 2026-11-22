import { useCallback, useEffect, useRef, useState } from "react";

import { type IpcError, toIpcError } from "@/lib/ipc";

export type Load<T> =
  | { status: "loading" }
  | { status: "error"; error: IpcError }
  | { status: "ready"; value: T };

const LOADING: Load<never> = { status: "loading" };

/** Stale answers are dropped; `reload` keeps the last answer up until the next lands. */
export function useLoad<T>(load: () => Promise<T>): {
  state: Load<T>;
  reload: () => void;
} {
  const [settled, setSettled] = useState<{
    load: () => Promise<T>;
    state: Load<T>;
  } | null>(null);
  const latestRequest = useRef(0);

  const reload = useCallback(() => {
    latestRequest.current += 1;
    const request = latestRequest.current;
    load().then(
      (value) => {
        if (request === latestRequest.current) {
          setSettled({ load, state: { status: "ready", value } });
        }
      },
      (error: unknown) => {
        if (request === latestRequest.current) {
          setSettled({
            load,
            state: { status: "error", error: toIpcError(error) },
          });
        }
      }
    );
  }, [load]);

  useEffect(() => {
    reload();
    return () => {
      latestRequest.current += 1;
    };
  }, [reload]);

  return { state: settled?.load === load ? settled.state : LOADING, reload };
}
