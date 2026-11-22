import { RevealScope } from "@ctrl-ui/react/ui/reveal";
import {
  Tree,
  TreeItem,
  TreeItemContent,
  TreeItemIndicator,
  TreeItemLabel,
  TreeItemTrigger,
} from "@ctrl-ui/react/ui/tree";
import { CircleAlert, File, Link2 } from "lucide-react";
import { createContext, useContext, useId, useMemo } from "react";

import type { TreeIndex } from "@/lib/tree";

import { DIMMED_STYLE, EntryItem, ICON_CLASS, StatusMark } from "../entry-item";
import {
  PersonalGroup,
  ProjectGroup,
  type SharedTreeProps,
} from "../library-groups";
import { pathName } from "../library-paths";
import { GroupItem } from "../library-rows";
import {
  folderReference,
  ReferenceButton,
  useReferenceDrag,
} from "../reference-action";
import type { FolderArrangement } from "./folder-arrangement";
import {
  type FolderLookup,
  type FolderRow,
  folderRows,
} from "./folder-listing";
import { useFolderEntries } from "./use-folder-entries";

const FAILED_STYLE = {
  "--cui-tree-item-trigger-foreground": "var(--destructive-text)",
} as const;

const FolderListingContext = createContext<FolderLookup | null>(null);

type Row<Type extends FolderRow["type"]> = Extract<FolderRow, { type: Type }>;

function LinkMark({ id }: { id: string }) {
  return (
    <StatusMark
      icon={<Link2 aria-hidden="true" className={ICON_CLASS} />}
      id={id}
      label="Symbolic link"
    />
  );
}

function FolderItem({ index, row }: { index: TreeIndex; row: Row<"folder"> }) {
  const reference = folderReference(row.path, row.name);
  const drag = useReferenceDrag(reference);
  const statusId = useId();
  const describedBy = [
    row.muted ? `${statusId}-muted` : null,
    row.linked ? `${statusId}-link` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <TreeItem
      aria-describedby={describedBy || undefined}
      label={row.name}
      value={row.id}
    >
      <TreeItemTrigger style={row.muted ? DIMMED_STYLE : undefined} {...drag}>
        <RevealScope className="flex min-w-0 flex-1 items-center gap-1.5">
          <TreeItemIndicator />
          <TreeItemLabel>{row.name}</TreeItemLabel>
          {row.linked ? <LinkMark id={`${statusId}-link`} /> : null}
          <ReferenceButton reference={reference} />
          {row.muted ? (
            <span className="sr-only" id={`${statusId}-muted`}>
              Holds no skill, agent, or rule
            </span>
          ) : null}
        </RevealScope>
      </TreeItemTrigger>
      <TreeItemContent>
        <FolderChildren index={index} path={row.path} />
      </TreeItemContent>
    </TreeItem>
  );
}

function OtherFileItem({ row }: { row: Row<"other"> }) {
  const statusId = useId();
  const describedBy = [
    `${statusId}-other`,
    row.linked ? `${statusId}-link` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <TreeItem aria-describedby={describedBy} label={row.name} value={row.id}>
      <TreeItemTrigger style={DIMMED_STYLE} title={row.path}>
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <TreeItemIndicator />
          <File aria-hidden="true" className={ICON_CLASS} />
          <TreeItemLabel>{row.name}</TreeItemLabel>
          {row.linked ? <LinkMark id={`${statusId}-link`} /> : null}
          <span className="sr-only" id={`${statusId}-other`}>
            Not a skill, agent, or rule
          </span>
        </span>
      </TreeItemTrigger>
    </TreeItem>
  );
}

function ListingFailureItem({
  message,
  path,
}: {
  message: string;
  path: string;
}) {
  const messageId = useId();
  return (
    <TreeItem
      aria-describedby={messageId}
      label="Couldn't list this folder"
      value={`failure:${path}`}
    >
      <TreeItemTrigger style={FAILED_STYLE} title={message}>
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          <TreeItemIndicator />
          <CircleAlert aria-hidden="true" className={ICON_CLASS} />
          <TreeItemLabel>Couldn't list this folder</TreeItemLabel>
          <span className="sr-only" id={messageId}>
            {message}
          </span>
        </span>
      </TreeItemTrigger>
    </TreeItem>
  );
}

function FolderRowItem({ index, row }: { index: TreeIndex; row: FolderRow }) {
  switch (row.type) {
    case "folder":
      return <FolderItem index={index} row={row} />;
    case "entry":
      return <EntryItem entry={row.entry} />;
    case "other":
      return <OtherFileItem row={row} />;
    default:
      return null;
  }
}

function ListedChildren({
  index,
  lookup,
  path,
}: {
  index: TreeIndex;
  lookup: FolderLookup;
  path: string;
}) {
  const { entries, failure } = useFolderEntries(path);
  const rows = useMemo(
    () => folderRows(index, path, { entries, lookup }),
    [index, path, entries, lookup]
  );
  return (
    <>
      {rows.map((row) => (
        <FolderRowItem index={index} key={row.id} row={row} />
      ))}
      {failure === null ? null : (
        <ListingFailureItem message={failure} path={path} />
      )}
    </>
  );
}

// Lists on mount: safe only because a closed folder's content is unmounted.
function FolderChildren({ index, path }: { index: TreeIndex; path: string }) {
  const lookup = useContext(FolderListingContext);
  if (lookup) {
    return <ListedChildren index={index} lookup={lookup} path={path} />;
  }
  return folderRows(index, path, null).map((row) => (
    <FolderRowItem index={index} key={row.id} row={row} />
  ));
}

function BaseFolderItem({
  index,
  nodeId,
}: {
  index: TreeIndex;
  nodeId: string;
}) {
  const node = index[nodeId];
  if (!node) {
    return null;
  }
  return (
    <FolderItem
      index={index}
      row={{
        type: "folder",
        id: node.id,
        path: node.path,
        name: node.name,
        linked: false,
        muted: false,
      }}
    />
  );
}

export function FolderTrees({
  folders,
  lookup,
  project,
  searching,
  treeProps,
}: {
  folders: FolderArrangement;
  lookup: FolderLookup | null;
  project: string | null;
  searching: boolean;
  treeProps: SharedTreeProps;
}) {
  const { index } = folders;
  const baseItems = (ids: string[]) =>
    ids.map((id) => <BaseFolderItem index={index} key={id} nodeId={id} />);
  if (project === null) {
    return (
      <FolderListingContext value={lookup}>
        <Tree aria-label="Indexed agent files" {...treeProps}>
          {baseItems(folders.topIds)}
        </Tree>
      </FolderListingContext>
    );
  }
  const hasRows =
    folders.topIds.length > 0 ||
    folders.worktreesId !== null ||
    lookup !== null;
  return (
    <FolderListingContext value={lookup}>
      <ProjectGroup
        project={project}
        searching={searching}
        tree={
          hasRows ? (
            <Tree aria-label={pathName(project)} {...treeProps}>
              <FolderChildren index={index} path={project} />
              {folders.worktreesId === null ? null : (
                <GroupItem
                  count={folders.worktreeIds.length}
                  id={folders.worktreesId}
                  label="Worktrees"
                >
                  {baseItems(folders.worktreeIds)}
                </GroupItem>
              )}
            </Tree>
          ) : null
        }
      />
      <PersonalGroup treeProps={treeProps}>
        {baseItems(folders.personalIds)}
      </PersonalGroup>
    </FolderListingContext>
  );
}
