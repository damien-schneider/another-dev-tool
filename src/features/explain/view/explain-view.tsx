import { ActionBarItem } from "@ctrl-ui/react/action-bar";
import {
  ChatLayout,
  ChatLayoutActions,
  ChatLayoutHeader,
  ChatLayoutTitle,
  ChatThread,
  ChatThreadScrollButton,
} from "@ctrl-ui/react/chat-layout";
import { ChevronsDown, ChevronsUp } from "lucide-react";
import { useMemo, useState } from "react";
import {
  type SettingsScope,
  useAgentSettings,
} from "@/features/agent/agent-settings";
import { AgentTranscript } from "@/features/agent/agent-transcript";
import { ConversationHistory } from "@/features/agent/conversation-history";
import type { LibraryScope } from "@/features/library/library-model";
import type { ExplainLevel } from "@/lib/explain-ipc-types";
import { ClaudeCodeMissing } from "@/shared/components/claude-code-missing";

import { EXPLAIN_MARKDOWN } from "../explain-markdown";
import { type ExplainSurface, ExplainSurfaceContext } from "../explain-surface";
import type { CodeRef } from "../source/code-ref";
import { SourcePane } from "../source/source-pane";
import { useExplainSession } from "../use-explain-session";
import { shiftLevel, useDetailLevel } from "./detail-level";
import { ExplainComposer } from "./explain-composer";
import { ExplainIntro, NoProject } from "./explain-intro";
import { chooseFolder, ExplainProjectPicker } from "./explain-project-picker";

const PROJECT_STORAGE_KEY = "another-dev-tool.explain-project";
const EXPLAIN_SETTINGS_SCOPE: SettingsScope = {
  storagePrefix: "another-dev-tool.explain",
  defaults: { model: "opus", effort: "medium" },
};
const THREAD_STYLE = { "--cui-chat-layout-column-max-inline-size": "46rem" };

const RESHAPE = {
  shorter: { by: -1, prompt: "Again, but shorter." },
  deeper: { by: 1, prompt: "Go deeper on that." },
} as const;

export interface ExplainViewProps {
  projects: readonly LibraryScope[];
  favoritePaths: ReadonlySet<string>;
  onToggleFavorite: (path: string) => Promise<void>;
}

export function ExplainView({
  projects,
  favoritePaths,
  onToggleFavorite,
}: ExplainViewProps) {
  const [project, setProject] = useState(() =>
    window.localStorage.getItem(PROJECT_STORAGE_KEY)
  );
  const session = useExplainSession(project);
  const [level, setLevel] = useDetailLevel();
  const [settings, setSettings] = useAgentSettings(EXPLAIN_SETTINGS_SCOPE);
  const [draft, setDraft] = useState("");
  const [source, setSource] = useState<{
    project: string;
    codeRef: CodeRef;
  } | null>(null);

  const surface = useMemo<ExplainSurface | null>(
    () =>
      project === null
        ? null
        : { project, openRef: (codeRef) => setSource({ project, codeRef }) },
    [project]
  );

  const openProject = (path: string) => {
    setProject(path);
    window.localStorage.setItem(PROJECT_STORAGE_KEY, path);
  };
  const browse = async () => {
    const picked = await chooseFolder();
    if (picked) {
      openProject(picked);
    }
  };

  const ask = (text: string, at: ExplainLevel = level) =>
    session.ask({ text, level: at, settings });

  const reshape = (way: keyof typeof RESHAPE) => {
    const next = shiftLevel(level, RESHAPE[way].by);
    if (next) {
      setLevel(next);
      ask(RESHAPE[way].prompt, next);
    }
  };

  const shownSource =
    source !== null && source.project === project ? source : null;
  const untouched =
    session.messages.length === 0 && !session.running && session.error === null;

  return (
    <ExplainSurfaceContext value={surface}>
      <div className="flex h-full min-h-0">
        <ChatLayout
          chrome="embedded"
          className="min-w-0 flex-1"
          style={THREAD_STYLE}
        >
          <ChatLayoutHeader
            className="h-(--titlebar-height) shrink-0"
            data-tauri-drag-region="deep"
          >
            {/* biome-ignore lint/a11y/useHeadingContent: the title's children become the heading's content */}
            <ChatLayoutTitle render={<h1 />}>Explain</ChatLayoutTitle>
            <ExplainProjectPicker
              favoritePaths={favoritePaths}
              onChange={openProject}
              onToggleFavorite={onToggleFavorite}
              project={project}
              projects={projects}
            />
            <ChatLayoutActions>
              {project !== null && session.available ? (
                <ConversationHistory
                  heading="About this project"
                  session={session}
                />
              ) : null}
            </ChatLayoutActions>
          </ChatLayoutHeader>
          {session.available ? null : (
            <ClaudeCodeMissing madeBy="Explanations are written" />
          )}
          {session.available && project === null ? (
            <NoProject onChoose={browse} />
          ) : null}
          {session.available && project !== null ? (
            <ChatThread
              aria-label="Explanation"
              composer={
                <>
                  <ChatThreadScrollButton busy={session.running} />
                  <ExplainComposer
                    level={level}
                    onLevelChange={setLevel}
                    onSend={(text) => ask(text)}
                    onSettingsChange={setSettings}
                    onStop={async () => {
                      await session.cancel();
                    }}
                    onValueChange={setDraft}
                    running={session.running}
                    settings={settings}
                    value={draft}
                  />
                </>
              }
            >
              {untouched ? (
                <ExplainIntro
                  onPick={(prompt) => ask(prompt)}
                  project={project}
                />
              ) : null}
              <AgentTranscript
                answerActions={
                  <>
                    <ActionBarItem
                      disabled={shiftLevel(level, -1) === null}
                      icon={<ChevronsDown />}
                      onClick={() => reshape("shorter")}
                    >
                      Shorter
                    </ActionBarItem>
                    <ActionBarItem
                      disabled={shiftLevel(level, 1) === null}
                      icon={<ChevronsUp />}
                      onClick={() => reshape("deeper")}
                    >
                      Deeper
                    </ActionBarItem>
                  </>
                }
                error={session.error}
                markdown={EXPLAIN_MARKDOWN}
                messages={session.messages}
                onRetry={session.retry}
                running={session.running}
              />
            </ChatThread>
          ) : null}
        </ChatLayout>
        {shownSource ? (
          <SourcePane
            codeRef={shownSource.codeRef}
            onClose={() => setSource(null)}
            project={shownSource.project}
          />
        ) : null}
      </div>
    </ExplainSurfaceContext>
  );
}
