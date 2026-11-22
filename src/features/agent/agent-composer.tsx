import {
  ChatComposer,
  ChatComposerHeader,
  ChatComposerShell,
  ChatComposerSubmit,
  ChatComposerTextarea,
  ChatComposerToolbar,
  ChatComposerTools,
  useHoldChatComposerOpen,
} from "@ctrl-ui/react/chat-composer";
import {
  ChatComposerAttachment,
  ChatComposerAttachments,
} from "@ctrl-ui/react/chat-composer-attachment";
import { Button } from "@ctrl-ui/react/ui/button";
import {
  Dropzone,
  DropzoneArea,
  DropzoneInput,
  DropzoneOverlay,
  useDropzoneContext,
} from "@ctrl-ui/react/ui/dropzone";
import { ArrowUp, ImagePlus } from "lucide-react";
import { type RefObject, useState } from "react";
import type { AgentRunSettings } from "@/lib/agent-ipc-types";
import type { FileRow } from "@/lib/ipc-types";

import { AGENT_IMAGE_POLICY, agentImage } from "./agent-images";
import type { AgentReference } from "./agent-references";
import { AgentSettingsPicker } from "./agent-settings";
import {
  ComposerFile,
  ComposerReferences,
  useReferenceDrop,
} from "./composer-references";
import type { AgentRequest } from "./use-agent-session";

interface AgentComposerProps {
  file: FileRow;
  value: string;
  onValueChange: (value: string) => void;
  running: boolean;
  onSend: (request: AgentRequest) => Promise<void>;
  onStop: () => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  settings: AgentRunSettings;
  onSettingsChange: (settings: AgentRunSettings) => void;
  references: readonly AgentReference[];
  onAddReference: (reference: AgentReference) => void;
  onRemoveReference: (path: string) => void;
  includesFile: boolean;
  onIncludeFileChange: (included: boolean) => void;
}

async function readImages(files: readonly File[]) {
  const read = await Promise.all(
    files.map((file) =>
      agentImage(file).then(
        (image) => ({ file, image }),
        () => ({ file, image: null })
      )
    )
  );
  return {
    images: read.flatMap(({ image }) => (image ? [image] : [])),
    unreadable: read.filter(({ image }) => !image).map(({ file }) => file),
  };
}

function ComposerImages({ unreadable }: { unreadable: readonly File[] }) {
  const dropzone = useDropzoneContext();
  if (dropzone.value.length === 0 && dropzone.fileRejections.length === 0) {
    return null;
  }
  return (
    <ChatComposerAttachments>
      {dropzone.value.map((image) => (
        <ChatComposerAttachment
          errorLabel="Couldn’t read this image"
          file={image}
          key={`${image.name}-${image.lastModified}-${image.size}`}
          onRemove={() => dropzone.removeFile(image)}
          status={unreadable.includes(image) ? "error" : "uploaded"}
        />
      ))}
      {dropzone.fileRejections.map(({ file: image, errors }) => (
        <ChatComposerAttachment
          description={errors[0]?.message}
          file={image}
          key={`rejected-${image.name}-${image.lastModified}-${image.size}`}
          onRemove={() => dropzone.removeRejection(image)}
          status="error"
        />
      ))}
    </ChatComposerAttachments>
  );
}

function HoldOpen({ held }: { held: boolean }) {
  useHoldChatComposerOpen(held);
  return null;
}

function AgentComposerForm({
  file,
  value,
  onValueChange,
  running,
  onSend,
  onStop,
  textareaRef,
  settings,
  onSettingsChange,
  references,
  onAddReference,
  onRemoveReference,
  includesFile,
  onIncludeFileChange,
}: AgentComposerProps) {
  const dropzone = useDropzoneContext();
  const [unreadable, setUnreadable] = useState<readonly File[]>([]);
  const referenceDrop = useReferenceDrop((reference) => {
    onAddReference(reference);
    textareaRef.current?.focus();
  });
  const referenceChips = (
    <ComposerReferences onRemove={onRemoveReference} references={references} />
  );

  return (
    <DropzoneArea>
      <ChatComposer
        density="compact"
        onSubmit={async ({ value: asked, clear }) => {
          const read = await readImages(dropzone.value);
          setUnreadable(read.unreadable);
          if (read.unreadable.length > 0) {
            return;
          }
          clear();
          dropzone.reset();
          await onSend({ prompt: asked, images: read.images });
        }}
        onValueChange={onValueChange}
        state={running ? "submitting" : "idle"}
        value={value}
      >
        <HoldOpen held={references.length > 0 || !includesFile} />
        <ChatComposerShell {...referenceDrop}>
          <ChatComposerHeader className="flex-wrap gap-1">
            {!includesFile && referenceChips}
            <ComposerFile
              file={file}
              included={includesFile}
              onIncludedChange={onIncludeFileChange}
            />
            {includesFile ? referenceChips : null}
          </ChatComposerHeader>
          <ComposerImages unreadable={unreadable} />
          <ChatComposerTextarea
            aria-label={
              includesFile ? "Ask for a change to this file" : "Ask Claude"
            }
            placeholder={includesFile ? "Ask for a change…" : "Ask Claude…"}
            ref={textareaRef}
          />
          <ChatComposerToolbar>
            <ChatComposerTools>
              <Button
                aria-label="Add images"
                disabled={dropzone.disabled || dropzone.isProcessing}
                iconOnly
                onClick={dropzone.open}
                size="xs"
                variant="ghost"
              >
                <ImagePlus />
              </Button>
            </ChatComposerTools>
            <AgentSettingsPicker
              onSettingsChange={onSettingsChange}
              settings={settings}
            />
            <ChatComposerSubmit
              aria-label="Send"
              iconOnly
              onStop={onStop}
              size="sm"
              stopLabel="Stop"
            >
              <ArrowUp />
            </ChatComposerSubmit>
          </ChatComposerToolbar>
          <DropzoneOverlay>Drop to attach</DropzoneOverlay>
        </ChatComposerShell>
      </ChatComposer>
    </DropzoneArea>
  );
}

export function AgentComposer(props: AgentComposerProps) {
  return (
    <Dropzone policy={AGENT_IMAGE_POLICY}>
      <DropzoneInput aria-label="Images to send" />
      <AgentComposerForm {...props} />
    </Dropzone>
  );
}
