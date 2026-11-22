import { useEffect, useState } from "react";

import { onIndexUpdated } from "@/lib/events";
import { listFolder, toIpcError } from "@/lib/ipc";
import type { FolderEntry } from "@/lib/ipc-types";

export interface FolderListing {
  entries: readonly FolderEntry[];
  failure: string | null;
}

const NOTHING_LISTED: FolderListing = { entries: [], failure: null };

export function useFolderEntries(path: string): FolderListing {
  const [listed, setListed] = useState<{
    path: string;
    listing: FolderListing;
  } | null>(null);

  useEffect(() => {
    let active = true;
    const show = (listing: FolderListing) => {
      if (active) {
        setListed({ path, listing });
      }
    };
    const load = () =>
      listFolder(path).then(
        (entries) => show({ entries, failure: null }),
        (error: unknown) => {
          const { code, message } = toIpcError(error);
          const deletedSinceShown = code === "not_found";
          show(
            deletedSinceShown
              ? NOTHING_LISTED
              : { entries: [], failure: message }
          );
        }
      );
    load();
    const unlisten = onIndexUpdated(load);
    return () => {
      active = false;
      unlisten.then((stop) => stop());
    };
  }, [path]);

  return listed?.path === path ? listed.listing : NOTHING_LISTED;
}
