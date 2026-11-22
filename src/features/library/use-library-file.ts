import { useCallback, useState } from "react";

import type { FileRow } from "@/lib/ipc-types";

import { type UseFileContent, useFileContent } from "./use-file-content";

const OPEN_FILE_STORAGE_KEY = "another-dev-tool.open-file";

/** The file that was open when the app last closed, so a launch picks up where work stopped. */
export function readLastOpenedFileId(): number | null {
  const stored = Number(window.localStorage.getItem(OPEN_FILE_STORAGE_KEY));
  return Number.isInteger(stored) && stored > 0 ? stored : null;
}

export interface UseLibraryFile {
  cancelPending: () => void;
  /** Closes the open file without asking: only for a file that no longer exists. */
  close: () => void;
  confirmPending: () => void;
  editor: UseFileContent;
  /** Kept so the editor survives its file leaving the index mid-edit. */
  file: FileRow | null;
  fileId: number | null;
  openedThroughLink: string | null;
  pending: FileRow | null;
  select: (file: FileRow, through?: string | null) => void;
}

/**
 * The one place a file becomes the edited one, so no caller can skip the unsaved guard.
 * `onOpen` hears of every file shown, and of the link it was reached `through`.
 */
export function useLibraryFile(
  onOpen: (file: FileRow, through: string | null) => void
): UseLibraryFile {
  const [fileId, setFileId] = useState<number | null>(null);
  const [file, setFile] = useState<FileRow | null>(null);
  const [openedThroughLink, setOpenedThroughLink] = useState<string | null>(
    null
  );
  const [pending, setPending] = useState<{
    file: FileRow;
    through: string | null;
  } | null>(null);
  const editor = useFileContent(fileId, openedThroughLink);

  const open = useCallback(
    (next: FileRow, through: string | null) => {
      setFile(next);
      setFileId(next.id);
      setOpenedThroughLink(through);
      window.localStorage.setItem(OPEN_FILE_STORAGE_KEY, String(next.id));
      onOpen(next, through);
    },
    [onOpen]
  );

  const select = useCallback(
    (next: FileRow, through: string | null = null) => {
      if (next.id === fileId) {
        if (editor.dirty) {
          editor.editAnyway();
        }
        setOpenedThroughLink(through);
        onOpen(next, through);
        return;
      }
      if (editor.dirty) {
        setPending({ file: next, through });
        return;
      }
      open(next, through);
    },
    [editor.dirty, editor.editAnyway, fileId, onOpen, open]
  );

  const confirmPending = useCallback(() => {
    if (pending) {
      open(pending.file, pending.through);
      setPending(null);
    }
  }, [open, pending]);

  const close = useCallback(() => {
    setFile(null);
    setFileId(null);
    setOpenedThroughLink(null);
    setPending(null);
    window.localStorage.removeItem(OPEN_FILE_STORAGE_KEY);
  }, []);

  return {
    editor,
    fileId,
    file,
    openedThroughLink,
    pending: pending?.file ?? null,
    select,
    confirmPending,
    cancelPending: useCallback(() => setPending(null), []),
    close,
  };
}
