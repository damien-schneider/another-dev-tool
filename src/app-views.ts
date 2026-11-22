import {
  Copy,
  History,
  LibraryBig,
  type LucideIcon,
  RefreshCw,
  Repeat2,
  Telescope,
} from "lucide-react";

export const VIEW_IDS = [
  "library",
  "explain",
  "prompts",
  "patterns",
  "duplicates",
  "sync",
  "settings",
] as const;

export type ViewId = (typeof VIEW_IDS)[number];

/** Settings is reached from the sidebar footer, so it is not listed with the work views. */
export const PRIMARY_VIEWS: readonly {
  id: Exclude<ViewId, "settings">;
  label: string;
  icon: LucideIcon;
}[] = [
  { id: "library", label: "Library", icon: LibraryBig },
  { id: "explain", label: "Explain", icon: Telescope },
  { id: "prompts", label: "Prompts", icon: History },
  { id: "patterns", label: "Patterns", icon: Repeat2 },
  { id: "duplicates", label: "Duplicates", icon: Copy },
  { id: "sync", label: "Sync", icon: RefreshCw },
];
