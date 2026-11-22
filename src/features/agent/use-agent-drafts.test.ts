import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useAgentDrafts } from "./use-agent-drafts";

describe("useAgentDrafts", () => {
  it("keeps a draft prefilled for a file that is only about to open", () => {
    const view = renderHook(({ file }) => useAgentDrafts(file), {
      initialProps: { file: 1 },
    });

    act(() => {
      view.result.current.setDraft("tighten it");
      view.result.current.prefill(2, "Apply this change.");
    });
    view.rerender({ file: 2 });
    expect(view.result.current.draft).toBe("Apply this change.");

    view.rerender({ file: 1 });
    expect(view.result.current.draft).toBe("tighten it");
  });
});
