import { ChatWorkspaceInset } from "@ctrl-ui/react/chat-workspace";
import { cn } from "@ctrl-ui/react/lib/cn";
import { ScrollArea } from "@ctrl-ui/react/ui/scroll-area";
import { Skeleton } from "@ctrl-ui/react/ui/skeleton";
import { LinksBar } from "@/features/links/links-bar";
import type { SkillMentions } from "@/features/links/use-skill-mentions";
import type { FileLinks, FileRow } from "@/lib/ipc-types";
import type { TextSelection } from "@/lib/text-selection";
import { ErrorState } from "@/shared/components/view-layout";
import { fileTitle } from "../library-model";
import type { UseFileContent } from "../use-file-content";
import { MetadataFields } from "./metadata-fields";
import { RichEditor } from "./rich-editor";
import { SourceEditor } from "./source-editor";

const DOCUMENT_COLUMN =
  "mx-auto flex w-full max-w-3xl flex-col gap-8 px-10 py-8";

function DocumentSkeleton() {
  return (
    <output aria-label="Loading the file" className={DOCUMENT_COLUMN}>
      <Skeleton className="h-9 w-2/5" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4" />
        <Skeleton className="h-4" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    </output>
  );
}

export function DocumentBody({
  editor,
  file,
  links,
  mentions,
  onOpenFile,
  onSelectionChange,
}: {
  editor: UseFileContent;
  file: FileRow;
  links: FileLinks;
  mentions: SkillMentions;
  onOpenFile: (file: FileRow) => void;
  onSelectionChange: (selection: TextSelection | null) => void;
}) {
  const { buffer } = editor;
  if (editor.loading) {
    return <DocumentSkeleton />;
  }
  if (!buffer) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <ErrorState
          message={editor.error ?? "The file could not be read."}
          onRetry={editor.reload}
        />
      </div>
    );
  }

  const label = `${fileTitle(file)} content`;
  const lockedLook = editor.readOnly ? "opacity-60" : undefined;
  if (editor.mode === "raw") {
    return (
      <div className={cn("min-h-0 flex-1 transition-opacity", lockedLook)}>
        <SourceEditor
          label={`${label}, as source`}
          onChange={editor.setRaw}
          onSelectionChange={onSelectionChange}
          readOnly={editor.readOnly}
          value={buffer.raw}
        />
      </div>
    );
  }

  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className={cn(DOCUMENT_COLUMN, "transition-opacity", lockedLook)}>
        <MetadataFields
          file={file}
          frontmatter={buffer.split.frontmatter}
          onChange={editor.setFrontmatterField}
          onEditSource={() => editor.setMode("raw")}
          readOnly={editor.readOnly}
        />
        <LinksBar links={links} onSelect={onOpenFile} />
        <RichEditor
          body={buffer.body}
          extensions={mentions.extensions}
          key={`${file.id}:${editor.revision}`}
          label={label}
          onChange={editor.setBody}
          onSelectionChange={onSelectionChange}
          readOnly={editor.readOnly}
        />
      </div>
      <ChatWorkspaceInset />
    </ScrollArea>
  );
}
