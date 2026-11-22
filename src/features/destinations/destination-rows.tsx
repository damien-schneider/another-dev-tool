import { cn } from "@ctrl-ui/react/lib/cn";
import { Badge } from "@ctrl-ui/react/ui/badge";
import { CommandItem } from "@ctrl-ui/react/ui/command";
import { Kbd } from "@ctrl-ui/react/ui/kbd";
import { Reveal, RevealScope } from "@ctrl-ui/react/ui/reveal";
import { Text } from "@ctrl-ui/react/ui/typography";
import { Check, Folder, Star } from "lucide-react";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";

import type { DestinationFolder } from "@/lib/ipc-types";
import { IconButton } from "@/shared/components/icon-button";
import { destinationParts } from "./destination-path";

const STAR_SHOWN_STYLE = { "--cui-reveal-hidden-opacity": "1" } as const;
const STAR_SHORTCUT_KEY = "d";
const STAR_SHORTCUT_LABEL = navigator.platform.includes("Mac")
  ? "⌘D"
  : "Ctrl+D";

/** The star sits inside an option, out of the tab order: the keyboard reaches it through the highlighted row. */
export function isStarShortcut(event: KeyboardEvent): boolean {
  return (
    (event.metaKey || event.ctrlKey) &&
    event.key.toLowerCase() === STAR_SHORTCUT_KEY
  );
}

export function StarShortcutHint() {
  return (
    <Text
      as="span"
      className="me-2 flex items-center gap-1.5"
      size="caption"
      tone="muted"
    >
      <Kbd>{STAR_SHORTCUT_LABEL}</Kbd>
      Star
    </Text>
  );
}

export function PickerNote({ children }: { children: ReactNode }) {
  return (
    <Text as="p" className="mx-2 my-1.5" size="label" tone="muted">
      {children}
    </Text>
  );
}

export function PickerRow({
  children,
  icon,
  onSelect,
  value,
}: {
  children: ReactNode;
  icon: ReactNode;
  onSelect: () => void;
  value: string;
}) {
  return (
    <CommandItem onSelect={onSelect} value={value}>
      {icon}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </CommandItem>
  );
}

export function FolderRow({
  folder,
  highlighted,
  home,
  onSelect,
  onToggleFavorite,
  selected,
  selectedLabel,
}: {
  folder: Pick<
    DestinationFolder,
    "available" | "favorite" | "fileCount" | "path"
  >;
  highlighted: boolean;
  home: string | null;
  onSelect: (path: string) => void;
  onToggleFavorite: (path: string) => Promise<void>;
  selected: boolean;
  /** Read out on the selected row, e.g. "Current destination". */
  selectedLabel: string;
}) {
  const { name, parent } = destinationParts(folder.path, home);
  // Kept quiet on a long list, but always offered on the folder in hand —
  // starring what you just picked is the whole point of the list.
  const starShown = folder.favorite || selected || highlighted;

  const toggleFavorite = (event: MouseEvent) => {
    event.stopPropagation();
    onToggleFavorite(folder.path);
  };

  return (
    <CommandItem
      disabled={!folder.available}
      onSelect={() => onSelect(folder.path)}
      title={folder.path}
      value={folder.path}
    >
      <RevealScope
        className="flex min-w-0 flex-1 items-center gap-2"
        style={starShown ? STAR_SHOWN_STYLE : undefined}
      >
        <Folder
          aria-hidden="true"
          className="text-muted-foreground size-4 shrink-0"
        />
        <span className="max-w-56 shrink-0 truncate">{name}</span>
        <Text
          as="span"
          className="min-w-0 flex-1 truncate"
          mono
          size="label"
          tone="muted"
        >
          {parent}
        </Text>
        {folder.available ? null : (
          <Badge color="red" size="sm">
            Missing
          </Badge>
        )}
        {folder.available && folder.fileCount > 0 ? (
          <Text
            as="span"
            className="shrink-0"
            numeric
            size="caption"
            tone="muted"
          >
            {folder.fileCount} {folder.fileCount === 1 ? "file" : "files"}
          </Text>
        ) : null}
        <Reveal className="flex shrink-0">
          <IconButton
            label={
              folder.favorite
                ? `Remove ${name} from favorites`
                : `Add ${name} to favorites`
            }
            onClick={toggleFavorite}
            size="xs"
            tabIndex={-1}
          >
            <Star className={cn(folder.favorite && "fill-current")} />
          </IconButton>
        </Reveal>
        <Check
          aria-hidden="true"
          className={cn("size-4 shrink-0", !selected && "invisible")}
        />
        {selected ? <span className="sr-only">{selectedLabel}</span> : null}
      </RevealScope>
    </CommandItem>
  );
}
