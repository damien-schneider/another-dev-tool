import { useCallback, useState } from "react";

import type { FileContent } from "@/lib/ipc-types";

export interface FileLock {
  editAnyway: () => void;
  readOnly: boolean;
}

export function useFileLock(
  content: FileContent | null,
  openedThroughLink: string | null
): FileLock {
  const [editableFileIds, setEditableFileIds] = useState<ReadonlySet<number>>(
    () => new Set()
  );
  const fileId = content?.fileId ?? null;

  const editAnyway = useCallback(() => {
    if (fileId !== null) {
      setEditableFileIds((ids) => new Set(ids).add(fileId));
    }
  }, [fileId]);

  return {
    readOnly:
      content !== null &&
      (content.managedBy !== null || openedThroughLink !== null) &&
      !editableFileIds.has(content.fileId),
    editAnyway,
  };
}
