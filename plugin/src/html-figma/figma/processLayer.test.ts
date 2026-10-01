import { afterEach, expect, test } from "bun:test";
import { processLayer } from "./processLayer";
const previousFigma = globalThis.figma;
afterEach(() => {
  globalThis.figma = previousFigma;
});

test("normalizes image bytes before assigning Figma fills", async () => {
  let fills: unknown;
  const node = {
    resize() {},
    set fills(value: any) {
      if (value.some((paint: any) => paint.intArr || !paint.imageHash))
        throw new Error("Invalid image paint");
      fills = structuredClone(value);
    },
  };
  globalThis.figma = {
    createRectangle: () => node,
    createImage: (bytes: Uint8Array) => {
      expect(bytes).toBeInstanceOf(Uint8Array);
      expect(Array.from(bytes)).toEqual([1, 2, 3]);
      return { hash: "image-hash" };
    },
  } as any;
  await processLayer(
    {
      type: "RECTANGLE",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
      fills: [{ type: "IMAGE", scaleMode: "FILL", intArr: [1, 2, 3] }] as any,
    },
    null,
    { appendChild() {} } as any
  );
  expect(fills).toEqual([{ type: "IMAGE", scaleMode: "FILL", imageHash: "image-hash" }]);
});
