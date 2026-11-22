import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
} from "@ctrl-ui/react/ui/sidebar";
import { Tree } from "@ctrl-ui/react/ui/tree";
import { Text } from "@ctrl-ui/react/ui/typography";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { AgentReference } from "@/features/agent/agent-references";
import { useHomeDirectory } from "@/lib/home-dir";
import type { FileRow, Root } from "@/lib/ipc-types";
import {
  buildTree,
  fileIdOf,
  fileNodeId,
  folderIds,
  folderIdsOf,
  TREE_ROOT_ID,
} from "@/lib/tree";
import {
  aliasEntryId,
  aliasOfEntryId,
  buildLibraryModel,
} from "./library-model";
import { pathName } from "./library-paths";
import {
  FavoriteStar,
  FolderNode,
  ScopeContents,
  ScopeItem,
} from "./library-rows";
import { ReferenceContext } from "./reference-action";

export type LibraryTreeMode = "grouped" | "folders";

export interface LibraryTreeProps {
  files: FileRow[];
  /** Every indexed file, `files` being a search's matches among them. */
  indexedFiles: FileRow[];
  roots: Root[];
  mode: LibraryTreeMode;
  selectedFileId: number | null;
  selectedAlias: string | null;
  favoritePaths: ReadonlySet<string>;
  onToggleFavorite: (path: string) => Promise<void>;
  project: string | null;
  expandAll: boolean;
  onSelectFile: (file: FileRow, alias: string | null) => void;
  showAliases: boolean;
  /** Present while a chat can take a row as a reference. */
  onReference?: (reference: AgentReference) => void;
}

/** Long enough for a collapsed branch to finish opening. */
const REVEAL_DELAY_MS = 250;

export function LibraryTree({ onReference, ...props }: LibraryTreeProps) {
  return (
    <ReferenceContext value={onReference ?? null}>
      <LibraryTreeBody {...props} />
    </ReferenceContext>
  );
}

function LibraryTreeBody({
  files,
  indexedFiles,
  roots,
  mode,
  selectedFileId,
  selectedAlias,
  favoritePaths,
  expandAll,
  onSelectFile,
  onToggleFavorite,
  project,
  showAliases,
}: Omit<LibraryTreeProps, "onReference">) {
  const personalHeadingId = useId();
  const projectsHeadingId = useId();
  const home = useHomeDirectory();
  const model = useMemo(
    () =>
      buildLibraryModel(
        files,
        roots,
        home,
        favoritePaths,
        indexedFiles,
        showAliases
      ),
    [files, roots, home, favoritePaths, indexedFiles, showAliases]
  );
  const folders = useMemo(
    () => (mode === "folders" ? buildTree(files, roots) : null),
    [files, roots, mode]
  );
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const projectScope =
    project === null
      ? undefined
      : model.projects.find((scope) => scope.path === project);

  const branchIds = useMemo(
    () => (folders ? folderIds(folders) : model.branchIds),
    [folders, model]
  );

  const filesById = useMemo(
    () => new Map(files.map((file) => [file.id, file])),
    [files]
  );

  let selectedId: string | null = null;
  if (selectedFileId !== null) {
    const aliasId =
      selectedAlias === null
        ? null
        : aliasEntryId(selectedFileId, selectedAlias);
    selectedId =
      aliasId !== null &&
      folders === null &&
      model.locationsByEntryId.has(aliasId)
        ? aliasId
        : fileNodeId(selectedFileId);
  }

  // Reveal a selected file once; the user may collapse its branches afterwards.
  const location =
    selectedId === null ? undefined : model.locationsByEntryId.get(selectedId);
  const selectedFile =
    selectedFileId === null ? undefined : filesById.get(selectedFileId);
  const arrangedByFolder = folders !== null;
  // A string, unlike the array, stays equal when the model rebuilds.
  const locationKey = location?.branchIds.join("\n");
  const rootId = selectedFile?.rootId;
  const relPath = selectedFile?.relPath;
  const revealIds = useMemo(() => {
    if (arrangedByFolder) {
      return rootId === undefined || relPath === undefined
        ? []
        : folderIdsOf({ rootId, relPath });
    }
    return locationKey ? locationKey.split("\n") : [];
  }, [arrangedByFolder, rootId, relPath, locationKey]);
  useEffect(() => {
    if (revealIds.length === 0) {
      return;
    }
    setOverrides((current) =>
      revealIds.every((id) => current[id])
        ? current
        : {
            ...current,
            ...Object.fromEntries(revealIds.map((id) => [id, true])),
          }
    );
  }, [revealIds]);

  // Mounting every row at once freezes the tree: branches start closed, bar a lone top-level one.
  const expanded = useMemo(() => {
    if (expandAll) {
      return branchIds;
    }
    let topLevelIds: string[];
    if (folders) {
      topLevelIds = folders[TREE_ROOT_ID]?.childIds ?? [];
    } else if (project === null) {
      topLevelIds = [...model.personal, ...model.projects].map(
        (scope) => scope.id
      );
    } else {
      topLevelIds = [
        ...(projectScope?.collections ?? []),
        ...model.personal,
      ].map((item) => item.id);
    }
    const loneId = topLevelIds.length === 1 ? topLevelIds[0] : undefined;
    return branchIds.filter((id) => overrides[id] ?? id === loneId);
  }, [branchIds, expandAll, folders, model, overrides, project, projectScope]);

  // Scroll only once the branches above the row have finished opening.
  const treeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (selectedId === null) {
      return;
    }
    const timer = window.setTimeout(() => {
      treeRef.current
        ?.querySelector('[aria-selected="true"]')
        ?.scrollIntoView({ block: "nearest" });
    }, REVEAL_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [selectedId]);

  useLayoutEffect(() => {
    treeRef.current?.scrollIntoView({ block: "start" });
  }, [project]);

  const treeProps = {
    expandedValue: expanded,
    onExpandedChange: (
      _: string[],
      { value, expanded: isExpanded }: { value: string; expanded: boolean }
    ) => {
      if (!expandAll) {
        setOverrides((current) => ({ ...current, [value]: isExpanded }));
      }
    },
    onValueChange: ([value]: string[]) => {
      const fileId = value ? fileIdOf(value) : null;
      const file = fileId === null ? undefined : filesById.get(fileId);
      if (value && file) {
        onSelectFile(file, aliasOfEntryId(value));
      }
    },
    selectionMode: "single",
    value: selectedId === null ? [] : [selectedId],
  } as const;

  if (folders) {
    return (
      <div ref={treeRef}>
        <Tree aria-label="Indexed agent files" {...treeProps}>
          {folders[TREE_ROOT_ID]?.childIds.map((childId) => (
            <FolderNode index={folders} key={childId} nodeId={childId} />
          ))}
        </Tree>
      </div>
    );
  }

  const personalGroup =
    model.personal.length > 0 ? (
      <SidebarGroup>
        <SidebarGroupLabel id={personalHeadingId}>
          Personal · every project
        </SidebarGroupLabel>
        <SidebarGroupContent>
          <Tree aria-labelledby={personalHeadingId} {...treeProps}>
            {model.personal.map((scope) => (
              <ScopeItem key={scope.id} scope={scope} />
            ))}
          </Tree>
        </SidebarGroupContent>
      </SidebarGroup>
    ) : null;

  if (project !== null) {
    return (
      <div ref={treeRef}>
        <SidebarGroup>
          <SidebarGroupContent>
            {projectScope ? (
              <Tree aria-label={projectScope.label} {...treeProps}>
                <ScopeContents scope={projectScope} />
              </Tree>
            ) : null}
            {projectScope || expandAll ? null : (
              <Text
                className="mx-(--cui-sidebar-menu-button-padding-inline) my-1.5"
                size="caption"
                tone="muted"
              >
                No skills, agents, or rules in {pathName(project)}
              </Text>
            )}
          </SidebarGroupContent>
        </SidebarGroup>
        {personalGroup}
      </div>
    );
  }

  return (
    <div ref={treeRef}>
      {personalGroup}
      {model.projects.length > 0 ? (
        <SidebarGroup>
          <SidebarGroupLabel id={projectsHeadingId}>Projects</SidebarGroupLabel>
          <SidebarGroupContent>
            <Tree aria-labelledby={projectsHeadingId} {...treeProps}>
              {model.projects.map((scope) => (
                <ScopeItem
                  key={scope.id}
                  scope={scope}
                  star={
                    <FavoriteStar
                      onToggle={onToggleFavorite}
                      scope={scope}
                      starred={favoritePaths.has(scope.path)}
                    />
                  }
                />
              ))}
            </Tree>
          </SidebarGroupContent>
        </SidebarGroup>
      ) : null}
    </div>
  );
}
