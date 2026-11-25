import { Badge } from "@ctrl-ui/react/ui/badge";
import { Folder, Plus, SquareDashedText, X } from "lucide-react";
import { type DragEvent, type ReactNode, useRef, useState } from "react";

import { FileKindIcon } from "@/features/library/file-kind";
import { fileTitle } from "@/features/library/library-model";
import type { FileRow } from "@/lib/ipc-types";
import type { TextSelection } from "@/lib/text-selection";

import {
  type AgentReference,
  carriesReference,
  readReference,
} from "./agent-references";

function ReferenceChip({
  icon,
  label,
  title,
  included,
  onToggle,
}: {
  icon: ReactNode;
  label: string;
  title: string;
  included: boolean;
  onToggle: () => void;
}) {
  return (
    <Badge
      aria-label={`${included ? "Remove" : "Add"} ${label}`}
      className="min-w-0 shrink"
      render={<button onClick={onToggle} title={title} type="button" />}
      variant={included ? "outline" : "ghost"}
    >
      {icon}
      <span className="truncate">{label}</span>
      {included ? <X aria-hidden="true" /> : <Plus aria-hidden="true" />}
    </Badge>
  );
}

export function ComposerFile({
  file,
  included,
  onIncludedChange,
}: {
  file: FileRow;
  included: boolean;
  onIncludedChange: (included: boolean) => void;
}) {
  return (
    <ReferenceChip
      icon={<FileKindIcon kind={file.kind} />}
      included={included}
      label={fileTitle(file)}
      onToggle={() => onIncludedChange(!included)}
      title={file.path}
    />
  );
}

export function ComposerReferences({
  references,
  onRemove,
}: {
  references: readonly AgentReference[];
  onRemove: (path: string) => void;
}) {
  return references.map((reference) => (
    <ReferenceChip
      icon={
        reference.kind === "folder" ? (
          <Folder aria-hidden="true" />
        ) : (
          <FileKindIcon kind={reference.kind} />
        )
      }
      included
      key={reference.path}
      label={reference.label}
      onToggle={() => onRemove(reference.path)}
      title={reference.path}
    />
  ));
}

export function ComposerSelection({
  selection: { text, firstLine, lastLine },
  onRemove,
}: {
  selection: TextSelection;
  onRemove: () => void;
}) {
  return (
    <ReferenceChip
      icon={<SquareDashedText aria-hidden="true" />}
      included
      label={
        firstLine === lastLine
          ? `Line ${firstLine}`
          : `Lines ${firstLine}–${lastLine}`
      }
      onToggle={onRemove}
      title={text}
    />
  );
}

const OVER_STYLE = {
  "--cui-chat-composer-shell-border-color": "var(--focus-rim)",
} as const;

export function useReferenceDrop(
  onReference: (reference: AgentReference) => void
) {
  const depth = useRef(0);
  const [over, setOver] = useState(false);

  const track = (event: DragEvent, step: number) => {
    if (!carriesReference(event.dataTransfer)) {
      return;
    }
    depth.current = Math.max(0, depth.current + step);
    setOver(depth.current > 0);
  };

  return {
    style: over ? OVER_STYLE : undefined,
    onDragEnter: (event: DragEvent) => track(event, 1),
    onDragLeave: (event: DragEvent) => track(event, -1),
    onDragOver: (event: DragEvent) => {
      if (carriesReference(event.dataTransfer)) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }
    },
    onDrop: (event: DragEvent) => {
      const reference = readReference(event.dataTransfer);
      if (!reference) {
        return;
      }
      event.preventDefault();
      depth.current = 0;
      setOver(false);
      onReference(reference);
    },
  };
}
