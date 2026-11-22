import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarIconRail,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarPanel,
  SidebarProvider,
  SidebarRail,
} from "@ctrl-ui/react/ui/sidebar";
import { Settings } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { PRIMARY_VIEWS, VIEW_IDS, type ViewId } from "./app-views";
import { useAgentSession } from "./features/agent/use-agent-session";
import { CommandPalette } from "./features/command/command-palette";
import { DuplicatesView } from "./features/duplicates/duplicates-view";
import { ExplainView } from "./features/explain/view/explain-view";
import { EditorPane } from "./features/library/editor-pane";
import { buildLibraryModel } from "./features/library/library-model";
import { LibraryPanel } from "./features/library/library-panel";
import { isWithin } from "./features/library/library-paths";
import { projectOf } from "./features/library/library-projects";
import {
  NewSkillDialog,
  type SkillDraft,
} from "./features/library/new-skill-dialog";
import { UnsavedChangesDialog } from "./features/library/unsaved-changes-dialog";
import {
  readLastOpenedFileId,
  useLibraryFile,
} from "./features/library/use-library-file";
import { useLibraryIndex } from "./features/library/use-library-index";
import { useSidePanel } from "./features/library/use-side-panel";
import { PatternsView } from "./features/patterns/patterns-view";
import { useFavoriteProjects } from "./features/projects/use-favorite-projects";
import { useOpenProject } from "./features/projects/use-open-project";
import { PromptHistoryView } from "./features/prompts/prompt-history-view";
import { useScan } from "./features/scan/use-scan";
import { SettingsView } from "./features/settings/settings-view";
import { GroupsView } from "./features/sync/groups-view";
import { UpdateButton } from "./features/updates/update-button";
import { useAppUpdate } from "./features/updates/use-app-update";
import { useHomeDirectory } from "./lib/home-dir";
import type { FileRow } from "./lib/ipc-types";
import { ViewBoundary } from "./shared/components/error-boundary";
import { useAppReloadShortcut } from "./use-app-reload-shortcut";
import { useAppShortcuts } from "./use-app-shortcuts";

const ACTIVE_VIEW_STORAGE_KEY = "another-dev-tool.active-view";

function readStoredView(): ViewId {
  const stored = window.localStorage.getItem(ACTIVE_VIEW_STORAGE_KEY);
  return VIEW_IDS.find((id) => id === stored) ?? "library";
}

export function App() {
  useAppReloadShortcut();
  const [view, setView] = useState<ViewId>(readStoredView);
  const [mountedViews, setMountedViews] = useState<ReadonlySet<ViewId>>(
    () => new Set([view])
  );
  // The tree, editor and chat form one workspace: every launch shows the tree.
  const [panelOpen, setPanelOpen] = useState(true);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [newSkillOpen, setNewSkillOpen] = useState(false);
  const [skillDraft, setSkillDraft] = useState<SkillDraft | null>(null);
  const [awaitedFileId, setAwaitedFileId] = useState<number | null>(null);
  const [restoringFileId, setRestoringFileId] = useState(readLastOpenedFileId);
  const index = useLibraryIndex();
  const home = useHomeDirectory();
  const openProject = useOpenProject();
  const { roots } = index;
  const showProject = openProject.open;
  const shownProject = openProject.path;
  const followOpenedFile = useCallback(
    (file: FileRow, through: string | null) => {
      if (shownProject === null) {
        return;
      }
      const openedThroughShownProject =
        through !== null && isWithin(through, shownProject);
      if (openedThroughShownProject) {
        return;
      }
      // Until home resolves, a file in ~/.claude would pass for a project's.
      const project =
        home === null ? null : projectOf(file, roots, home, through);
      if (project !== null) {
        showProject(project);
      }
    },
    [home, shownProject, roots, showProject]
  );
  const library = useLibraryFile(followOpenedFile);
  const favoriteProjects = useFavoriteProjects();
  const { favoritePaths } = favoriteProjects;
  const projects = useMemo(
    () => buildLibraryModel(index.files, roots, home, favoritePaths).projects,
    [index.files, roots, home, favoritePaths]
  );
  const scan = useScan();
  const update = useAppUpdate();
  const sidePanel = useSidePanel();

  const selectView = useCallback((next: ViewId) => {
    setMountedViews((current) =>
      current.has(next) ? current : new Set([...current, next])
    );
    setView(next);
    window.localStorage.setItem(ACTIVE_VIEW_STORAGE_KEY, next);
  }, []);
  const goToProject = useCallback(
    (path: string | null) => {
      selectView("library");
      setPanelOpen(true);
      showProject(path);
    },
    [selectView, showProject]
  );

  const selectFile = library.select;
  const openFile = useCallback(
    (file: FileRow) => {
      selectView("library");
      selectFile(file);
    },
    [selectFile, selectView]
  );

  // A file written a moment ago (new skill) is opened as soon
  // as the index reports it, rather than racing the index refresh.
  const awaitedFile =
    awaitedFileId === null
      ? undefined
      : index.files.find((file) => file.id === awaitedFileId);
  useEffect(() => {
    if (awaitedFile) {
      setAwaitedFileId(null);
      openFile(awaitedFile);
    }
  }, [awaitedFile, openFile]);

  // Launch reopens the last file in place; a file gone since then is let go.
  useEffect(() => {
    if (restoringFileId === null || !index.ready) {
      return;
    }
    setRestoringFileId(null);
    const restored = index.files.find((file) => file.id === restoringFileId);
    if (restored) {
      selectFile(restored);
    }
  }, [index.files, index.ready, restoringFileId, selectFile]);

  const openNewSkill = useCallback(() => {
    setSkillDraft(null);
    setNewSkillOpen(true);
  }, []);
  const createSkillFrom = useCallback((draft: SkillDraft) => {
    setSkillDraft(draft);
    setNewSkillOpen(true);
  }, []);
  useAppShortcuts({
    onOpenPalette: () => setPaletteOpen(true),
    onNewSkill: openNewSkill,
    onSave: library.editor.save,
  });

  // Folders are picked up without asking: what is on disk is what the app shows.
  const startScan = scan.start;
  useEffect(() => {
    startScan();
  }, [startScan]);

  const selected =
    index.files.find((file) => file.id === library.fileId) ??
    (library.file?.id === library.fileId ? library.file : null);
  const agent = useAgentSession(selected?.id ?? null);
  const showSidePanel = sidePanel.show;
  const prefillAgent = agent.prefill;
  const openInEditor = useCallback(
    (file: FileRow, prompt: string) => {
      openFile(file);
      showSidePanel("agent");
      prefillAgent(file.id, prompt);
    },
    [openFile, prefillAgent, showSidePanel]
  );
  // With nothing open the tree is the only way in, so it cannot be folded away;
  // a fold asked for then is dropped rather than springing on the next file.
  const foldTree = (open: boolean) => {
    if (selected) {
      setPanelOpen(open);
    }
  };

  return (
    <SidebarProvider
      className="h-dvh"
      data-tauri-drag-region
      defaultWidth={332}
      layout="contained"
      maxWidth={560}
      minWidth={288}
      onOpenChange={foldTree}
      open={view === "library" && (panelOpen || !selected)}
      persistOpen={false}
    >
      <Sidebar collapsible="icon" data-tauri-drag-region variant="inset">
        <SidebarIconRail data-tauri-drag-region="deep">
          <SidebarHeader>
            <div className="h-(--sidebar-strip-height)" />
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarMenu aria-label="Views">
                {PRIMARY_VIEWS.map(({ id, label, icon: Icon }) => {
                  const unsaved = id === "library" && library.editor.dirty;
                  return (
                    <SidebarMenuItem key={id}>
                      <SidebarMenuButton
                        aria-label={
                          unsaved ? `${label}, unsaved changes` : label
                        }
                        isActive={view === id}
                        onClick={() => {
                          if (id === "library" && view === "library") {
                            foldTree(!panelOpen);
                          }
                          selectView(id);
                        }}
                        tooltip={label}
                      >
                        <Icon />
                        <span>{label}</span>
                      </SidebarMenuButton>
                      {unsaved ? (
                        <span
                          aria-hidden="true"
                          className="bg-warning pointer-events-none absolute end-1 top-1 size-1.5 rounded-full"
                        />
                      ) : null}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter>
            <SidebarMenu aria-label="App">
              <UpdateButton
                unsavedFile={library.editor.dirty ? selected : null}
                update={update}
              />
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={view === "settings"}
                  onClick={() => selectView("settings")}
                  tooltip="Settings"
                >
                  <Settings />
                  <span>Settings</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </SidebarIconRail>
        <SidebarPanel layer="sidebar">
          <ViewBoundary label="library list">
            <LibraryPanel
              favoritePaths={favoritePaths}
              index={index}
              onNewSkill={openNewSkill}
              onOpenProject={openProject.open}
              onOpenSettings={() => selectView("settings")}
              onReference={
                agent.available && selected
                  ? (reference) => {
                      agent.addReference(reference);
                      sidePanel.show("agent");
                    }
                  : undefined
              }
              onSelectFile={library.select}
              onToggleFavorite={favoriteProjects.toggle}
              project={openProject.path}
              scan={scan}
              selectedAlias={library.openedThroughLink}
              selectedFileId={library.fileId}
            />
          </ViewBoundary>
        </SidebarPanel>
        <SidebarRail />
      </Sidebar>

      <SidebarInset render={<main />}>
        <div className="h-full min-h-0" hidden={view !== "library"}>
          <ViewBoundary label="editor">
            <EditorPane
              agent={agent}
              editor={library.editor}
              favorite={
                selected?.projectDir
                  ? favoritePaths.has(selected.projectDir)
                  : false
              }
              file={selected}
              hasFiles={index.files.length > 0}
              onClose={library.close}
              onNewSkill={openNewSkill}
              onOpenFile={library.select}
              onShowOriginal={() => {
                if (selected) {
                  setPanelOpen(true);
                  library.select(selected);
                }
              }}
              onToggleFavorite={favoriteProjects.toggle}
              openedThroughLink={library.openedThroughLink}
              scan={scan}
              sidePanel={sidePanel}
            />
          </ViewBoundary>
        </div>
        {mountedViews.has("explain") ? (
          <div className="h-full min-h-0" hidden={view !== "explain"}>
            <ViewBoundary label="explain">
              <ExplainView
                favoritePaths={favoritePaths}
                onToggleFavorite={favoriteProjects.toggle}
                projects={projects}
              />
            </ViewBoundary>
          </div>
        ) : null}
        {mountedViews.has("prompts") ? (
          <div className="h-full min-h-0" hidden={view !== "prompts"}>
            <ViewBoundary label="prompts">
              <PromptHistoryView />
            </ViewBoundary>
          </div>
        ) : null}
        {mountedViews.has("patterns") ? (
          <div className="h-full min-h-0" hidden={view !== "patterns"}>
            <ViewBoundary label="patterns">
              <PatternsView
                files={index.files}
                onCreateSkill={createSkillFrom}
                onOpenInEditor={openInEditor}
              />
            </ViewBoundary>
          </div>
        ) : null}
        {mountedViews.has("duplicates") ? (
          <div className="h-full min-h-0" hidden={view !== "duplicates"}>
            <ViewBoundary label="duplicates">
              <DuplicatesView
                onGroupCreated={() => selectView("sync")}
                onOpenFile={openFile}
              />
            </ViewBoundary>
          </div>
        ) : null}
        {mountedViews.has("sync") ? (
          <div className="h-full min-h-0" hidden={view !== "sync"}>
            <ViewBoundary label="sync">
              <GroupsView onOpenFile={openFile} />
            </ViewBoundary>
          </div>
        ) : null}
        {mountedViews.has("settings") ? (
          <div className="h-full min-h-0" hidden={view !== "settings"}>
            <ViewBoundary label="settings">
              <SettingsView
                onFoldersChanged={index.refresh}
                scan={scan}
                update={update}
              />
            </ViewBoundary>
          </div>
        ) : null}
      </SidebarInset>

      <CommandPalette
        files={index.files}
        onNewSkill={openNewSkill}
        onOpenChange={setPaletteOpen}
        onOpenFile={openFile}
        onOpenProject={goToProject}
        onRescan={startScan}
        onSelectView={selectView}
        open={paletteOpen}
        project={openProject.path}
        projects={projects}
      />
      <NewSkillDialog
        draft={skillDraft}
        files={index.files}
        onCreated={setAwaitedFileId}
        onOpenChange={setNewSkillOpen}
        open={newSkillOpen}
        project={openProject.path}
        roots={index.roots}
        selectedFile={selected}
      />
      <UnsavedChangesDialog library={library} />
    </SidebarProvider>
  );
}
