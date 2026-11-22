import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  emitDelta,
  emitDone,
  emitTextPart,
  mocks,
  PROJECT,
  resetMocks,
  said,
} from "../use-explain-session.harness";
import { ExplainView } from "./explain-view";

vi.mock(
  "@/lib/events",
  async () => (await import("../use-explain-session.harness")).eventsModule
);
vi.mock(
  "@/lib/ipc",
  async () => (await import("../use-explain-session.harness")).ipcModule
);

const TOUR = "Give me the 2-minute tour";
const ANSWER = "The total lives in `src/cart.ts:1`.";
const CART_LINK = /open src\/cart\.ts:1$/;

beforeEach(() => {
  resetMocks([said(1, "you", TOUR), said(2, "agent", ANSWER)]);
  window.localStorage.setItem("another-dev-tool.explain-project", PROJECT);
});

afterEach(() => {
  window.localStorage.clear();
});

async function answerTour() {
  render(
    <ExplainView
      favoritePaths={new Set()}
      onToggleFavorite={vi.fn()}
      projects={[]}
    />
  );
  fireEvent.click(await screen.findByRole("button", { name: TOUR }));
  await waitFor(() => expect(mocks.explainSend).toHaveBeenCalled());
  act(() => {
    emitTextPart();
    emitDelta(ANSWER);
    emitDone();
  });
  await screen.findByRole("button", { name: "Deeper" });
}

describe("ExplainView", () => {
  it("asks a starter question at the chosen detail level", async () => {
    await answerTour();

    expect(mocks.explainSend).toHaveBeenCalledWith(
      expect.objectContaining({ project: PROJECT, level: "standard" })
    );
  });

  it("asks again one level deeper and keeps that level for what comes next", async () => {
    await answerTour();

    fireEvent.click(screen.getByRole("button", { name: "Deeper" }));

    await waitFor(() =>
      expect(mocks.explainSend).toHaveBeenLastCalledWith(
        expect.objectContaining({
          text: "Go deeper on that.",
          level: "detailed",
        })
      )
    );
    expect(screen.getByRole("slider").getAttribute("aria-valuetext")).toBe(
      "Detailed"
    );
  });

  it("opens a cited file at its lines beside the answer", async () => {
    await answerTour();

    fireEvent.click(screen.getByRole("button", { name: CART_LINK }));

    const pane = await screen.findByRole("complementary", {
      name: "Source: src/cart.ts:1",
    });
    await waitFor(() =>
      expect(pane.textContent).toContain("export const total = 1;")
    );
    expect(mocks.explainReadSource).toHaveBeenCalledWith(
      PROJECT,
      "src/cart.ts"
    );
  });
});
