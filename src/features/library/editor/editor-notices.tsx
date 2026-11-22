import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@ctrl-ui/react/ui/alert";
import { Button } from "@ctrl-ui/react/ui/button";

import { displayPath } from "@/features/destinations/destination-path";
import { useHomeDirectory } from "@/lib/home-dir";
import type { ManagedBy } from "@/lib/ipc-types";

import type { UseFileContent } from "../use-file-content";

function managedNotice(managedBy: ManagedBy): {
  title: string;
  reason: string;
} {
  switch (managedBy.tool) {
    case "npxSkills":
      return {
        title: "Installed by npx skills",
        reason: `An update reinstalls it from ${managedBy.source} and can replace edits made here.`,
      };
    case "claude":
      return {
        title: "Synced by Claude",
        reason:
          "Claude keeps this folder in sync and can replace edits made here.",
      };
    case "codex":
      return {
        title: "Bundled with Codex",
        reason:
          "Codex reinstalls its built-in skills and can replace edits made here.",
      };
    default:
      return managedBy satisfies never;
  }
}

function ManagedNotice({
  managedBy,
  onEditAnyway,
}: {
  managedBy: ManagedBy;
  onEditAnyway: (() => void) | null;
}) {
  const { title, reason } = managedNotice(managedBy);
  return (
    <Alert>
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        {reason} To change it, copy the skill into a folder you own.
      </AlertDescription>
      {onEditAnyway ? (
        <AlertAction>
          <Button onClick={onEditAnyway} size="sm" variant="surface">
            Edit anyway
          </Button>
        </AlertAction>
      ) : null}
    </Alert>
  );
}

/** States of the open file that need a decision, shown between the header and the text. */
export function EditorNotices({
  editor,
  openedThroughLink,
  onShowOriginal,
}: {
  editor: UseFileContent;
  openedThroughLink: string | null;
  onShowOriginal: () => void;
}) {
  const home = useHomeDirectory();
  const managedBy = editor.buffer?.content.managedBy ?? null;
  if (
    !(managedBy || openedThroughLink || editor.changedOnDisk || editor.error)
  ) {
    return null;
  }

  return (
    <div className="flex shrink-0 flex-col gap-2 border-b px-4 py-3">
      {managedBy ? (
        <ManagedNotice
          managedBy={managedBy}
          onEditAnyway={editor.readOnly ? editor.editAnyway : null}
        />
      ) : null}
      {openedThroughLink ? (
        <Alert>
          <AlertTitle>Opened through a link</AlertTitle>
          <AlertDescription>
            {displayPath(openedThroughLink, home)} points to this file: edits
            here change the original.
          </AlertDescription>
          <AlertAction>
            {editor.readOnly && !managedBy ? (
              <Button onClick={editor.editAnyway} size="sm" variant="surface">
                Edit anyway
              </Button>
            ) : null}
            <Button onClick={onShowOriginal} size="sm" variant="surface">
              Show original
            </Button>
          </AlertAction>
        </Alert>
      ) : null}
      {editor.changedOnDisk ? (
        <Alert>
          <AlertTitle>This file changed on disk</AlertTitle>
          <AlertDescription>
            Your unsaved edits were made on the earlier version.
          </AlertDescription>
          <AlertAction>
            <Button onClick={editor.reload} size="sm" variant="surface">
              Discard my edits and reload
            </Button>
          </AlertAction>
        </Alert>
      ) : null}
      {editor.error ? (
        <Alert tone="danger">
          <AlertTitle>The file was not saved</AlertTitle>
          <AlertDescription>{editor.error}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}
