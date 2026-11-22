import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
} from "@ctrl-ui/react/ui/sidebar";
import { Tree, type TreeProps } from "@ctrl-ui/react/ui/tree";
import { Text } from "@ctrl-ui/react/ui/typography";
import { type ReactNode, useId } from "react";

import { pathName } from "./library-paths";

export type SharedTreeProps = Pick<
  TreeProps,
  | "expandedValue"
  | "onExpandedChange"
  | "onValueChange"
  | "selectionMode"
  | "value"
>;

export function PersonalGroup({
  treeProps,
  children,
}: {
  treeProps: SharedTreeProps;
  children: ReactNode[];
}) {
  const headingId = useId();
  if (children.length === 0) {
    return null;
  }
  return (
    <SidebarGroup>
      <SidebarGroupLabel id={headingId}>
        Personal · every project
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <Tree aria-labelledby={headingId} {...treeProps}>
          {children}
        </Tree>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

export function ProjectGroup({
  project,
  searching,
  tree,
}: {
  project: string;
  searching: boolean;
  tree: ReactNode;
}) {
  return (
    <SidebarGroup>
      <SidebarGroupContent>
        {tree}
        {tree || searching ? null : (
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
  );
}
