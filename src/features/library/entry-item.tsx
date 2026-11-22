import { RevealScope } from "@ctrl-ui/react/ui/reveal";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@ctrl-ui/react/ui/tooltip";
import {
  TreeItem,
  TreeItemIndicator,
  TreeItemLabel,
  TreeItemTrigger,
} from "@ctrl-ui/react/ui/tree";
import { Text } from "@ctrl-ui/react/ui/typography";
import { Link2, UserRound } from "lucide-react";
import { type ReactNode, useId } from "react";
import { displayPath } from "@/features/destinations/destination-path";
import { targetLabel } from "@/lib/agent-files/scan-targets";
import { useHomeDirectory } from "@/lib/home-dir";

import { FileKindIcon } from "./file-kind";
import { entryTitle, type LibraryEntry } from "./library-model";
import { agentHomeOf, skillReach } from "./library-paths";
import {
  entryReference,
  ReferenceButton,
  useReferenceDrag,
} from "./reference-action";

export const ICON_CLASS = "size-3.5 shrink-0 text-muted-foreground";

const DIMMED_STYLE = {
  "--cui-tree-item-trigger-foreground": "var(--muted-foreground)",
} as const;

const AGENT_LIST = new Intl.ListFormat("en", { type: "conjunction" });

function linkLabel(entry: LibraryEntry, home: string | null): string | null {
  const { file } = entry;
  if (entry.linked) {
    return `Link to ${displayPath(file.path, home)}`;
  }
  if (file.isSymlink) {
    return file.symlinkTarget
      ? `Link to ${displayPath(file.symlinkTarget, home)}`
      : "Symbolic link";
  }
  return null;
}

function StatusMark({
  id,
  label,
  icon,
}: {
  id: string;
  label: string;
  icon: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="flex" />}>
        {icon}
        <span className="sr-only" id={id}>
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function EntryItem({
  entry,
  context,
}: {
  entry: LibraryEntry;
  context?: string;
}) {
  const { file } = entry;
  const home = useHomeDirectory();
  const statusId = useId();
  const title = entryTitle(entry);
  const kind = targetLabel(file.kind);
  const kindLabel =
    file.kind === "skill" || entry.linked || kind === title ? "" : kind;
  const reference = entryReference(entry);
  const drag = useReferenceDrag(reference);
  const reach =
    file.kind === "skill"
      ? skillReach([file.path, ...file.aliases], home)
      : null;
  const notLoaded = reach !== null && !reach.loaded;
  const personalHomes =
    reach && agentHomeOf(entry.path, home) === null ? reach.homes : [];
  const personalLabel =
    personalHomes.length > 0
      ? `Personal skill in ${AGENT_LIST.format(personalHomes.map((agentHome) => agentHome.label))}`
      : null;
  const link = linkLabel(entry, home);
  const describedBy = [
    personalLabel ? `${statusId}-personal` : null,
    link ? `${statusId}-link` : null,
    notLoaded ? `${statusId}-not-loaded` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <TreeItem
      aria-describedby={describedBy || undefined}
      label={title}
      value={entry.id}
    >
      <TreeItemTrigger
        style={notLoaded ? DIMMED_STYLE : undefined}
        title={entry.path}
        {...drag}
      >
        <RevealScope className="flex min-w-0 flex-1 items-center gap-1.5">
          <TreeItemIndicator />
          <FileKindIcon className={ICON_CLASS} kind={file.kind} />
          <TreeItemLabel className="flex-initial">{title}</TreeItemLabel>
          <Text
            as="span"
            className="min-w-0 flex-1 truncate"
            size="caption"
            tone="muted"
          >
            {context ?? kindLabel}
          </Text>
          {personalLabel ? (
            <StatusMark
              icon={<UserRound aria-hidden="true" className={ICON_CLASS} />}
              id={`${statusId}-personal`}
              label={personalLabel}
            />
          ) : null}
          {link ? (
            <StatusMark
              icon={<Link2 aria-hidden="true" className={ICON_CLASS} />}
              id={`${statusId}-link`}
              label={link}
            />
          ) : null}
          <ReferenceButton reference={reference} />
          {notLoaded ? (
            <span className="sr-only" id={`${statusId}-not-loaded`}>
              No agent loads this skill
            </span>
          ) : null}
        </RevealScope>
      </TreeItemTrigger>
    </TreeItem>
  );
}
