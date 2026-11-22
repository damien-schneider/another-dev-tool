import { describe, expect, it } from "vitest";

import { fitWithin } from "./agent-images";

describe("fitWithin", () => {
  it("scales a Retina screenshot down to the size Claude reads", () => {
    expect(fitWithin(3024, 1964)).toEqual({ width: 1568, height: 1018 });
    expect(fitWithin(1200, 4000)).toEqual({ width: 470, height: 1568 });
  });

  it("leaves an image that already fits untouched", () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });
});
