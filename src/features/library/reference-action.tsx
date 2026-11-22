import { Reveal } from "@ctrl-ui/react/ui/reveal";
import { MessageSquarePlus } from "lucide-react";
import { createContext, type DragEvent, useContext } from "react";

import {
  type AgentReference,
  writeReference,
} from "@/features/agent/agent-references";
import { IconButton } from "@/shared/components/icon-button";
import { entryTitle, type LibraryEntry } from "./library-model";
import { parentPath } from "./library-paths";

export const ReferenceContext = createContext<
  ((reference: AgentReference) => void) | null
>(null);

/** A skill is its whole folder: SKILL.md alone would hide its references and scripts. */
export function entryReference(entry: LibraryEntry): AgentReference {
  const { file } = entry;
  return {
    path: file.kind === "skill" ? parentPath(file.path) : file.path,
    label: entryTitle(entry),
    kind: file.kind,
  };
}

export function folderReference(path: string, label: string): AgentReference {
  return { path, label, kind: "folder" };
}

export function useReferenceDrag(reference: AgentReference) {
  const onReference = useContext(ReferenceContext);
  if (!onReference) {
    return {};
  }
  return {
    draggable: true,
    onDragStart: (event: DragEvent) =>
      writeReference(event.dataTransfer, reference),
  };
}

export function ReferenceButton({ reference }: { reference: AgentReference }) {
  const onReference = useContext(ReferenceContext);
  if (!onReference) {
    return null;
  }
  return (
    <Reveal className="flex shrink-0 transition-none" data-row-action>
      <IconButton
        label={`Add ${reference.label} to the chat`}
        onClick={(event) => {
          event.stopPropagation();
          onReference(reference);
        }}
        size="xs"
        tabIndex={-1}
      >
        <MessageSquarePlus />
      </IconButton>
    </Reveal>
  );
}
