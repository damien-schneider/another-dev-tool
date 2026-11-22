import { Button } from "@ctrl-ui/react/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@ctrl-ui/react/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@ctrl-ui/react/ui/empty";
import { Input } from "@ctrl-ui/react/ui/input";
import { InputGroup, InputGroupAddon } from "@ctrl-ui/react/ui/input-group";
import {
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@ctrl-ui/react/ui/sidebar";
import { Spinner } from "@ctrl-ui/react/ui/spinner";
import { Heading, Text } from "@ctrl-ui/react/ui/typography";
import { ListFilter, Plus, RefreshCw, Search, X } from "lucide-react";
import { useMemo, useState } from "react";

import { ProjectSwitcher } from "@/features/projects/project-switcher";
import type { UseScan } from "@/features/scan/use-scan";
import { useHomeDirectory } from "@/lib/home-dir";
import type { FileRow } from "@/lib/ipc-types";
import { IconButton } from "@/shared/components/icon-button";

import { buildLibraryModel, filterFiles } from "./library-model";
import { filesInProject } from "./library-projects";
import {
  LibraryTree,
  type LibraryTreeMode,
  type LibraryTreeProps,
} from "./library-tree";
import { withoutSubProjects } from "./sub-projects";
import type { LibraryIndex } from "./use-library-index";

const MODE_STORAGE_KEY = "another-dev-tool.library-mode";
const SUB_PROJECTS_STORAGE_KEY = "another-dev-tool.library-sub-projects";
const ALIASES_STORAGE_KEY = "another-dev-tool.library-links";

function readStoredMode(): LibraryTreeMode {
  return window.localStorage.getItem(MODE_STORAGE_KEY) === "folders"
    ? "folders"
    : "grouped";
}

function readStoredShowSubProjects(): boolean {
  return window.localStorage.getItem(SUB_PROJECTS_STORAGE_KEY) !== "hidden";
}

function readStoredShowAliases(): boolean {
  return window.localStorage.getItem(ALIASES_STORAGE_KEY) !== "hidden";
}

export interface LibraryPanelProps {
  index: LibraryIndex;
  scan: UseScan;
  selectedFileId: number | null;
  selectedAlias: string | null;
  favoritePaths: ReadonlySet<string>;
  onToggleFavorite: (path: string) => Promise<void>;
  project: string | null;
  onOpenProject: (path: string | null) => void;
  onSelectFile: (file: FileRow, alias: string | null) => void;
  onNewSkill: () => void;
  onOpenSettings: () => void;
  onReference?: LibraryTreeProps["onReference"];
}

function PanelMessage({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: { label: string; onAction: () => void };
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        {description ? (
          <EmptyDescription>{description}</EmptyDescription>
        ) : null}
      </EmptyHeader>
      {action ? (
        <EmptyContent>
          <Button onClick={action.onAction} size="sm" variant="surface">
            {action.label}
          </Button>
        </EmptyContent>
      ) : null}
    </Empty>
  );
}

function ScanFooter({
  scan,
  shown,
  total,
}: {
  scan: UseScan;
  shown: number;
  total: number;
}) {
  if (scan.running) {
    return (
      <>
        <Spinner label="Scanning folders" size="xs" />
        <Text className="min-w-0 flex-1 truncate" size="caption" tone="muted">
          {scan.stats ? `Scanning… ${scan.stats.seen} found` : "Scanning…"}
        </Text>
        <Button onClick={scan.cancel} size="xs" variant="ghost">
          Stop
        </Button>
      </>
    );
  }
  return (
    <>
      <Text
        className="min-w-0 flex-1 truncate"
        numeric
        size="caption"
        title={scan.error ?? undefined}
        tone={scan.error ? "danger" : "muted"}
      >
        {scan.error ??
          (shown === total
            ? `${total} ${total === 1 ? "file" : "files"}`
            : `${shown} of ${total}`)}
      </Text>
      <IconButton label="Rescan folders" onClick={() => scan.start()} size="xs">
        <RefreshCw />
      </IconButton>
    </>
  );
}

export function LibraryPanel({
  index,
  scan,
  selectedFileId,
  selectedAlias,
  favoritePaths,
  onToggleFavorite,
  project,
  onOpenProject,
  onSelectFile,
  onNewSkill,
  onOpenSettings,
  onReference,
}: LibraryPanelProps) {
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<LibraryTreeMode>(readStoredMode);
  const [showSubProjects, setShowSubProjects] = useState(
    readStoredShowSubProjects
  );
  const [showAliases, setShowAliases] = useState(readStoredShowAliases);
  const home = useHomeDirectory();
  const listsLinks = showAliases && mode === "grouped";
  const scoped = useMemo(
    () =>
      showSubProjects ? index.files : withoutSubProjects(index.files, home),
    [index.files, showSubProjects, home]
  );
  const projects = useMemo(
    () =>
      buildLibraryModel(
        scoped,
        index.roots,
        home,
        favoritePaths,
        scoped,
        listsLinks
      ).projects,
    [scoped, index.roots, home, favoritePaths, listsLinks]
  );
  const listed = useMemo(
    () =>
      project === null
        ? scoped
        : filesInProject(scoped, index.roots, home, project, listsLinks),
    [scoped, index.roots, home, project, listsLinks]
  );
  const visible = useMemo(() => filterFiles(listed, search), [listed, search]);
  const searching = search.trim().length > 0;

  let body = (
    <LibraryTree
      expandAll={searching}
      favoritePaths={favoritePaths}
      files={visible}
      indexedFiles={index.files}
      mode={mode}
      onReference={onReference}
      onSelectFile={onSelectFile}
      onToggleFavorite={onToggleFavorite}
      project={project}
      roots={index.roots}
      selectedAlias={selectedAlias}
      selectedFileId={selectedFileId}
      showAliases={showAliases}
    />
  );
  if (index.error) {
    body = (
      <PanelMessage
        action={{ label: "Try again", onAction: index.refresh }}
        description={index.error}
        title="The library could not be loaded"
      />
    );
  } else if (!index.ready) {
    body = <span />;
  } else if (index.files.length === 0) {
    body = scan.running ? (
      <PanelMessage
        description="Skills, agents, and rules appear here as they are found."
        title="Looking through your folders…"
      />
    ) : (
      <PanelMessage
        action={
          index.roots.length === 0
            ? { label: "Choose folders", onAction: onOpenSettings }
            : { label: "New skill", onAction: onNewSkill }
        }
        description={
          index.roots.length === 0
            ? "Pick the folders that hold your projects and agent configuration."
            : "None of your folders contain skills, agents, or rules yet."
        }
        title="Nothing here yet"
      />
    );
  } else if (visible.length === 0) {
    body = (
      <PanelMessage
        action={{ label: "Clear search", onAction: () => setSearch("") }}
        title={`No match for “${search.trim()}”`}
      />
    );
  }

  return (
    <>
      <SidebarHeader>
        <div
          className="flex h-(--sidebar-strip-height) items-center gap-1 ps-2"
          data-tauri-drag-region="deep"
        >
          <Heading className="sr-only" level={2}>
            Library
          </Heading>
          <div className="flex min-w-0 flex-1">
            <ProjectSwitcher
              favoritePaths={favoritePaths}
              onOpen={onOpenProject}
              onToggleFavorite={onToggleFavorite}
              project={project}
              projects={projects}
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="List options"
              iconOnly
              size="sm"
              variant="ghost"
            >
              <ListFilter />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup
                onValueChange={(next: LibraryTreeMode) => {
                  setMode(next);
                  window.localStorage.setItem(MODE_STORAGE_KEY, next);
                }}
                value={mode}
              >
                {/* Base UI requires group labels inside their group. */}
                <DropdownMenuLabel>Arrange by</DropdownMenuLabel>
                <DropdownMenuRadioItem value="grouped">
                  Project
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="folders">
                  Folder
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Show</DropdownMenuLabel>
                <DropdownMenuCheckboxItem
                  checked={showSubProjects}
                  onCheckedChange={(next: boolean) => {
                    setShowSubProjects(next);
                    window.localStorage.setItem(
                      SUB_PROJECTS_STORAGE_KEY,
                      next ? "shown" : "hidden"
                    );
                  }}
                >
                  Monorepo sub-projects
                </DropdownMenuCheckboxItem>
                {mode === "grouped" ? (
                  <DropdownMenuCheckboxItem
                    checked={showAliases}
                    onCheckedChange={(next: boolean) => {
                      setShowAliases(next);
                      window.localStorage.setItem(
                        ALIASES_STORAGE_KEY,
                        next ? "shown" : "hidden"
                      );
                    }}
                  >
                    Links
                  </DropdownMenuCheckboxItem>
                ) : null}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <IconButton label="New skill" onClick={onNewSkill} shortcut="⌘N">
            <Plus />
          </IconButton>
        </div>
        <InputGroup size="sm">
          <InputGroupAddon>
            <Search aria-hidden="true" />
          </InputGroupAddon>
          <Input
            aria-label="Search the library"
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && search.length > 0) {
                event.preventDefault();
                setSearch("");
              }
            }}
            placeholder="Search"
            value={search}
          />
          {search.length > 0 ? (
            <InputGroupAddon>
              <Button
                aria-label="Clear search"
                iconOnly
                onClick={() => setSearch("")}
                size="xs"
                variant="ghost"
              >
                <X />
              </Button>
            </InputGroupAddon>
          ) : null}
        </InputGroup>
      </SidebarHeader>
      <SidebarContent>{body}</SidebarContent>
      <SidebarFooter>
        <div className="flex min-h-7 items-center gap-2 ps-2">
          <ScanFooter
            scan={scan}
            shown={visible.length}
            total={listed.length}
          />
        </div>
      </SidebarFooter>
    </>
  );
}
