import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { SourceFile } from "@/lib/explain-ipc-types";
import type * as Ipc from "@/lib/ipc";

import { useSourceFile } from "./use-source-file";

const { readSource } = vi.hoisted(() => ({
  readSource: vi.fn<(project: string, path: string) => Promise<SourceFile>>(),
}));

vi.mock("@/lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof Ipc>()),
  explainReadSource: readSource,
}));

const PATH = "src/cart.ts";
const ready = (text: string) => ({
  status: "ready",
  file: { path: PATH, text },
});

describe("useSourceFile", () => {
  it("shows the last read at once, then the file as it is now", async () => {
    readSource.mockResolvedValueOnce({ path: PATH, text: "before the edit" });
    const first = renderHook(() => useSourceFile("/work/shop", PATH));
    await waitFor(() =>
      expect(first.result.current).toEqual(ready("before the edit"))
    );
    first.unmount();

    readSource.mockResolvedValueOnce({ path: PATH, text: "after the edit" });
    const second = renderHook(() => useSourceFile("/work/shop", PATH));

    expect(second.result.current).toEqual(ready("before the edit"));
    await waitFor(() =>
      expect(second.result.current).toEqual(ready("after the edit"))
    );
  });
});
