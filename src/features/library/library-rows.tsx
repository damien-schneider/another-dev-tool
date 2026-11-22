import { cn } from "@ctrl-ui/react/lib/cn";
import { Reveal, RevealScope } from "@ctrl-ui/react/ui/reveal";
import {
  TreeItem,
  TreeItemContent,
  TreeItemIndicator,
  TreeItemLabel,
  TreeItemTrigger,
} from "@ctrl-ui/react/ui/tree";
import { Text } from "@ctrl-ui/react/ui/typography";
import { FolderGit2, GitBranch, Star, UserRound } from "lucide-react";
import type { ReactNode } from "react";

import type { TreeIndex, TreeNode } from "@/lib/tree";
import { IconButton } from "@/shared/components/icon-button";

import { EntryItem, ICON_CLASS } from "./entry-item";
import {
  type LibraryCollection,
  type LibraryScope,
  unchangedBranchId,
  worktreesBranchId,
} from "./library-model";
import { pathName } from "./library-paths";
import {
  folderReference,
  ReferenceButton,
  useReferenceDrag,
} from "./reference-action";

const SCOPE_ICONS = {
  personal: UserRound,
  project: FolderGit2,
  worktree: GitBranch,
} as const;

const STARRED_STYLE = { "--cui-reveal-hidden-opacity": "1" } as const;

function Count({ value }: { value: number }) {
  return (
    <Text as="span" numeric size="caption" tone="muted">
      {value}
    </Text>
  );
}

function CollectionItems({ collection }: { collection: LibraryCollection }) {
  const reference = folderReference(collection.path, collection.relativePath);
  const drag = useReferenceDrag(reference);
  const [first] = collection.entries;
  if (!first) {
    return null;
  }
  if (collection.relativePath === "") {
    return collection.entries.map((entry) => (
      <EntryItem entry={entry} key={entry.id} />
    ));
  }
  if (collection.entryCount === 1) {
    return <EntryItem context={collection.relativePath} entry={first} />;
  }
  return (
    <TreeItem label={collection.relativePath} value={collection.id}>
      <TreeItemTrigger title={collection.path} {...drag}>
        <RevealScope className="flex min-w-0 flex-1 items-center gap-1.5">
          <TreeItemIndicator />
          <TreeItemLabel>{collection.relativePath}</TreeItemLabel>
          <ReferenceButton reference={reference} />
          <Count value={collection.entryCount} />
        </RevealScope>
      </TreeItemTrigger>
      <TreeItemContent>
        {collection.entries.map((entry) => (
          <EntryItem entry={entry} key={entry.id} />
        ))}
        {collection.children.map((child) => (
          <CollectionItems collection={child} key={child.id} />
        ))}
      </TreeItemContent>
    </TreeItem>
  );
}

function GroupItem({
  id,
  label,
  count,
  children,
}: {
  id: string;
  label: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <TreeItem label={label} value={id}>
      <TreeItemTrigger>
        <TreeItemIndicator />
        <TreeItemLabel>{label}</TreeItemLabel>
        <Count value={count} />
      </TreeItemTrigger>
      <TreeItemContent>{children}</TreeItemContent>
    </TreeItem>
  );
}

export function FavoriteStar({
  scope,
  starred,
  onToggle,
}: {
  scope: LibraryScope;
  starred: boolean;
  onToggle: (path: string) => Promise<void>;
}) {
  return (
    <Reveal
      className="flex shrink-0 transition-none"
      data-row-action={starred ? undefined : true}
      style={starred ? STARRED_STYLE : undefined}
    >
      <IconButton
        label={
          starred
            ? `Remove ${scope.label} from favorites`
            : `Add ${scope.label} to favorites`
        }
        onClick={(event) => {
          event.stopPropagation();
          onToggle(scope.path);
        }}
        size="xs"
        tabIndex={-1}
      >
        <Star className={cn(starred && "fill-current")} />
      </IconButton>
    </Reveal>
  );
}

export function ScopeItem({
  scope,
  star,
  repositoryLabel,
}: {
  scope: LibraryScope;
  star?: ReactNode;
  /** The repository a worktree is listed in. */
  repositoryLabel?: string;
}) {
  const Icon = SCOPE_ICONS[scope.kind];
  const worktree = scope.kind === "worktree";
  const reference = folderReference(scope.path, scope.label);
  const drag = useReferenceDrag(reference);
  return (
    <TreeItem label={scope.label} value={scope.id}>
      <TreeItemTrigger title={scope.path} {...drag}>
        <RevealScope className="flex min-w-0 flex-1 items-center gap-1.5">
          <TreeItemIndicator />
          <Icon aria-hidden="true" className={ICON_CLASS} />
          <TreeItemLabel className="flex-initial">
            <Text
              as="span"
              tone={worktree && scope.entryCount === 0 ? "muted" : undefined}
              weight={worktree ? undefined : "medium"}
            >
              {scope.label}
            </Text>
          </TreeItemLabel>
          <Text
            as="span"
            className="min-w-0 flex-1 truncate"
            size="caption"
            tone="muted"
          >
            {scope.kind === "personal" ? pathName(scope.path) : ""}
          </Text>
          {star}
          <ReferenceButton reference={reference} />
          {scope.entryCount > 0 ? <Count value={scope.entryCount} /> : null}
        </RevealScope>
      </TreeItemTrigger>
      <TreeItemContent>
        <ScopeContents repositoryLabel={repositoryLabel} scope={scope} />
      </TreeItemContent>
    </TreeItem>
  );
}

/** A scope's rows, nested under it or, for the open project, at the top of the tree. */
export function ScopeContents({
  scope,
  repositoryLabel,
}: {
  scope: LibraryScope;
  repositoryLabel?: string;
}) {
  const unchangedCount = scope.unchanged.reduce(
    (sum, collection) => sum + collection.entryCount,
    0
  );
  return (
    <>
      {scope.collections.map((collection) => (
        <CollectionItems collection={collection} key={collection.id} />
      ))}
      {repositoryLabel !== undefined && unchangedCount > 0 ? (
        <GroupItem
          count={unchangedCount}
          id={unchangedBranchId(scope)}
          label={`Same as ${repositoryLabel}`}
        >
          {scope.unchanged.map((collection) => (
            <CollectionItems collection={collection} key={collection.id} />
          ))}
        </GroupItem>
      ) : null}
      {scope.worktrees.length > 0 ? (
        <GroupItem
          count={scope.worktrees.length}
          id={worktreesBranchId(scope)}
          label="Worktrees"
        >
          {scope.worktrees.map((child) => (
            <ScopeItem
              key={child.id}
              repositoryLabel={scope.label}
              scope={child}
            />
          ))}
        </GroupItem>
      ) : null}
    </>
  );
}

function FolderItem({ index, node }: { index: TreeIndex; node: TreeNode }) {
  const reference = folderReference(node.path, node.name);
  const drag = useReferenceDrag(reference);
  return (
    <TreeItem label={node.name} value={node.id}>
      <TreeItemTrigger {...drag}>
        <RevealScope className="flex min-w-0 flex-1 items-center gap-1.5">
          <TreeItemIndicator />
          <TreeItemLabel>{node.name}</TreeItemLabel>
          <ReferenceButton reference={reference} />
        </RevealScope>
      </TreeItemTrigger>
      <TreeItemContent>
        {node.childIds.map((childId) => (
          <FolderNode index={index} key={childId} nodeId={childId} />
        ))}
      </TreeItemContent>
    </TreeItem>
  );
}

export function FolderNode({
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
  if (node.file) {
    return (
      <EntryItem
        entry={{
          id: node.id,
          file: node.file,
          path: node.file.path,
          linked: false,
        }}
      />
    );
  }
  return <FolderItem index={index} node={node} />;
}
