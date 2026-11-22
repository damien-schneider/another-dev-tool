import { useEffect, useState } from "react";

import type { SourceFile } from "@/lib/explain-ipc-types";
import { explainReadSource, toIpcError } from "@/lib/ipc";

export type SourceState =
  | { status: "loading" }
  | { status: "ready"; file: SourceFile }
  | { status: "failed"; message: string };

const REMEMBERED_FILES = 40;
const LOADING: SourceState = { status: "loading" };

const lastRead = new Map<string, SourceFile>();

function remember(key: string, file: SourceFile) {
  lastRead.delete(key);
  lastRead.set(key, file);
  const oldest = lastRead.keys().next().value;
  if (lastRead.size > REMEMBERED_FILES && oldest !== undefined) {
    lastRead.delete(oldest);
  }
}

export function useSourceFile(project: string, path: string): SourceState {
  const key = `${project}\n${path}`;
  const [loaded, setLoaded] = useState<{ key: string; state: SourceState }>({
    key: "",
    state: LOADING,
  });

  useEffect(() => {
    let active = true;
    explainReadSource(project, path).then(
      (file) => {
        remember(key, file);
        if (active) {
          setLoaded({ key, state: { status: "ready", file } });
        }
      },
      (error: unknown) => {
        lastRead.delete(key);
        if (active) {
          setLoaded({
            key,
            state: { status: "failed", message: toIpcError(error).message },
          });
        }
      }
    );
    return () => {
      active = false;
    };
  }, [project, path, key]);

  if (loaded.key === key) {
    return loaded.state;
  }
  const remembered = lastRead.get(key);
  return remembered ? { status: "ready", file: remembered } : LOADING;
}
