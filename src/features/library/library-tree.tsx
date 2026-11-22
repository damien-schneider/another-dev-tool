import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
} from "@ctrl-ui/react/ui/sidebar";
import { Tree } from "@ctrl-ui/react/ui/tree";
import {
  type ReactNode,
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
import { fileIdOf, fileNodeId } from "@/lib/tree";
import {
  arrangeByFolder,
  type FolderArrangement,
} from "./folders/folder-arrangement";
import { folderLookup } from "./folders/folder-listing";
import { FolderTrees } from "./folders/folder-rows";
import {
  PersonalGroup,
  ProjectGroup,
  type SharedTreeProps,
} from "./library-groups";
import {
  aliasEntryId,
  aliasOfEntryId,
  buildLibraryModel,
  type LibraryModel,
} from "./library-model";
import { FavoriteStar, ScopeContents, ScopeItem } from "./library-rows";
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
  showOtherFiles: boolean;
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

function selectedEntryId(
  fileId: number | null,
  alias: string | null,
  showsAlias: (aliasId: string) => boolean
): string | null {
  if (fileId === null) {
    return null;
  }
  const aliasId = alias === null ? null : aliasEntryId(fileId, alias);
  return aliasId !== null && showsAlias(aliasId) ? aliasId : fileNodeId(fileId);
}

function topLevelIdsOf(
  model: LibraryModel,
  folders: FolderArrangement | null,
  project: string | null
): string[] {
  if (folders) {
    return [
      ...folders.topIds,
      ...(folders.worktreesId === null ? [] : [folders.worktreesId]),
      ...folders.personalIds,
    ];
  }
  if (project === null) {
    return [...model.personal, ...model.projects].map((scope) => scope.id);
  }
  const projectScope = model.projects.find((scope) => scope.path === project);
  return [...(projectScope?.collections ?? []), ...model.personal].map(
    (item) => item.id
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
  showOtherFiles,
}: Omit<LibraryTreeProps, "onReference">) {
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
    () => (mode === "folders" ? arrangeByFolder(files, roots, project) : null),
    [files, roots, mode, project]
  );
  // Listing while searching would list every folder the search opens.
  const listsOtherFiles = folders !== null && showOtherFiles && !expandAll;
  const lookup = useMemo(
    () => (listsOtherFiles ? folderLookup(indexedFiles) : null),
    [listsOtherFiles, indexedFiles]
  );
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const projectScope =
    project === null
      ? undefined
      : model.projects.find((scope) => scope.path === project);

  const branchIds = folders ? folders.branchIds : model.branchIds;

  const filesById = useMemo(
    () => new Map(indexedFiles.map((file) => [file.id, file])),
    [indexedFiles]
  );

  const selectedId = selectedEntryId(
    selectedFileId,
    selectedAlias,
    (aliasId) =>
      folders ? lookup !== null : model.locationsByEntryId.has(aliasId)
  );

  // Reveal a selected file once; the user may collapse its branches afterwards.
  let location: string[] | undefined;
  if (selectedId !== null) {
    location = folders
      ? folders.locations.get(selectedId)
      : model.locationsByEntryId.get(selectedId)?.branchIds;
  }
  // A string, unlike the array, stays equal when the model rebuilds.
  const locationKey = location?.join("\n");
  const revealIds = useMemo(
    () => (locationKey ? locationKey.split("\n") : []),
    [locationKey]
  );
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
    const topLevelIds = topLevelIdsOf(model, folders, project);
    const loneId = topLevelIds.length === 1 ? topLevelIds[0] : undefined;
    const known = new Set(branchIds);
    const openedListedIds = Object.keys(overrides).filter(
      (id) => overrides[id] && !known.has(id)
    );
    return [
      ...branchIds.filter((id) => overrides[id] ?? id === loneId),
      ...openedListedIds,
    ];
  }, [branchIds, expandAll, folders, model, overrides, project]);

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

  const treeProps: SharedTreeProps = {
    expandedValue: expanded,
    onExpandedChange: (_, { value, expanded: isExpanded }) => {
      if (!expandAll) {
        setOverrides((current) => ({ ...current, [value]: isExpanded }));
      }
    },
    onValueChange: ([value]) => {
      const fileId = value ? fileIdOf(value) : null;
      const file = fileId === null ? undefined : filesById.get(fileId);
      if (value && file) {
        onSelectFile(file, aliasOfEntryId(value));
      }
    },
    selectionMode: "single",
    value: selectedId === null ? [] : [selectedId],
  };

  const personalScopes = (
    <PersonalGroup treeProps={treeProps}>
      {model.personal.map((scope) => (
        <ScopeItem key={scope.id} scope={scope} />
      ))}
    </PersonalGroup>
  );

  let content: ReactNode;
  if (folders) {
    content = (
      <FolderTrees
        folders={folders}
        lookup={lookup}
        project={project}
        searching={expandAll}
        treeProps={treeProps}
      />
    );
  } else if (project === null) {
    content = (
      <>
        {personalScopes}
        {model.projects.length > 0 ? (
          <SidebarGroup>
            <SidebarGroupLabel id={projectsHeadingId}>
              Projects
            </SidebarGroupLabel>
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
      </>
    );
  } else {
    content = (
      <>
        <ProjectGroup
          project={project}
          searching={expandAll}
          tree={
            projectScope ? (
              <Tree aria-label={projectScope.label} {...treeProps}>
                <ScopeContents scope={projectScope} />
              </Tree>
            ) : null
          }
        />
        {personalScopes}
      </>
    );
  }
  return <div ref={treeRef}>{content}</div>;
}
