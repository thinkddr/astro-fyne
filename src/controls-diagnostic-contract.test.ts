// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { expect, test } from "bun:test";
import {
  decodeLayoutSnapshot,
  readBoxModel,
  readComputedStyle,
  readContentQuads,
  readUAInput,
} from "../capture/controls-diagnostic-contract.ts";

// Synthetic protocol records verify decoding/failure behavior, not pixel parity.
function tree() {
  const node = (
    nodeId: number,
    nodeType: number,
    nodeName: string,
    nodeValue = "",
  ) => ({ nodeId, backendNodeId: nodeId + 100, nodeType, nodeName, nodeValue });
  return {
    ...node(1, 9, "#document"),
    children: [
      {
        ...node(2, 1, "INPUT"),
        attributes: ["id", "controls-input", "type", "text"],
        shadowRoots: [
          {
            ...node(3, 11, "#document-fragment"),
            shadowRootType: "user-agent",
            children: [
              { ...node(4, 1, "DIV"), children: [node(5, 3, "#text", "A")] },
            ],
          },
        ],
      },
    ],
  };
}
function snapshot() {
  return {
    strings: [
      "#document",
      "INPUT",
      "P",
      "#text",
      "id",
      "controls-input",
      "status-value",
      "A",
      "normal",
    ],
    documents: [
      {
        nodes: {
          backendNodeId: [101, 102, 103, 104],
          parentIndex: [-1, 0, 0, 2],
          nodeName: [0, 1, 2, 3],
          nodeValue: [-1, -1, -1, 7],
          attributes: [[], [4, 5], [4, 6], []],
        },
        layout: {
          nodeIndex: [1, 2, 3],
          styles: [[8], [8], [8]],
          bounds: [
            [16, 52, 100, 32],
            [16, 120, 192, 20],
            [16, 120, 9, 19],
          ],
          text: [-1, -1, 7],
          stackingContexts: { index: [0] },
          paintOrders: [2, 3, 3],
          offsetRects: [[16, 52, 100, 32], [16, 120, 192, 20], []],
          scrollRects: [[0, 0, 98, 30], [0, 0, 192, 20], []],
          clientRects: [[1, 1, 98, 30], [0, 0, 192, 20], []],
          blendedBackgroundColors: [-1, -1, -1],
          textColorOpacities: [1, 1, 1],
        },
        textBoxes: {
          layoutIndex: [2],
          bounds: [[16, 120, 9, 19]],
          start: [0],
          length: [1],
        },
      },
    ],
  };
}
test("selects the genuine UA editor, not the author input or an arbitrary DIV", () => {
  const result = readUAInput(tree());
  expect(result.input.nodeId).toBe(2);
  expect(result.editor.nodeId).toBe(4);
  expect(result.editor.attributes.id).toBeUndefined();
  expect(result.editorNodes.map((node) => node.nodeValue)).toEqual(["", "A"]);
  const missing = tree();
  missing.children[0]!.shadowRoots = [];
  expect(() => readUAInput(missing)).toThrow("user-agent shadow root");
  const authored = tree();
  authored.children[0]!.shadowRoots[0]!.shadowRootType = "open";
  expect(() => readUAInput(authored)).toThrow("user-agent shadow root");
  const multiple = tree();
  multiple.children[0]!.shadowRoots[0]!.children.push({
    ...multiple.children[0]!.shadowRoots[0]!.children[0]!,
    nodeId: 9,
    backendNodeId: 109,
    children: [],
  });
  expect(() => readUAInput(multiple)).toThrow("single direct UA editor");
});
test("refuses missing text, duplicate attributes and reused protocol node IDs", () => {
  const empty = tree();
  empty.children[0]!.shadowRoots[0]!.children[0]!.children[0]!.nodeValue = "";
  expect(() => readUAInput(empty)).toThrow("no observable text");
  const duplicate = tree();
  duplicate.children[0]!.attributes.push("id", "other");
  expect(() => readUAInput(duplicate)).toThrow("repeats id");
  const reused = tree();
  reused.children[0]!.shadowRoots[0]!.children[0]!.nodeId = 2;
  expect(() => readUAInput(reused)).toThrow("nodeId is duplicated");
});
test("preserves normal line height and rejects incomplete/duplicated computed style", () => {
  const style = Object.entries({
    "font-family": "AstroNoto",
    "font-size": "14px",
    "font-weight": "400",
    "line-height": "normal",
    color: "rgb(17, 35, 43)",
  }).map(([name, value]) => ({ name, value }));
  expect(readComputedStyle(style)["line-height"]).toBe("normal");
  expect(() => readComputedStyle(style.slice(1))).toThrow("omits font-family");
  expect(() => readComputedStyle([...style, style[0]])).toThrow(
    "repeats font-family",
  );
});
test("preserves fractional UA boxes and quads without deriving a baseline", () => {
  const q = [25, 58.5, 107, 58.5, 107, 77.5, 25, 77.5];
  const result = readBoxModel({
    width: 82,
    height: 19,
    content: q,
    padding: q,
    border: q,
    margin: q,
  });
  expect(result.content[1]).toBe(58.5);
  expect(readContentQuads([q])).toEqual([q]);
  expect(() => readContentQuads([])).toThrow("no content quad");
  expect(() => readContentQuads([[25, 58.5, NaN, 19]])).toThrow("eight finite");
  expect(() =>
    readBoxModel({
      width: 82,
      height: null,
      content: q,
      padding: q,
      border: q,
      margin: q,
    }),
  ).toThrow("box height");
});
test("decodes pinned empty strings/non-element rects and maps UTF-16 text boxes by layout index", () => {
  const records = decodeLayoutSnapshot(snapshot(), ["line-height"]);
  expect(records[0]!.attributes.id).toBe("controls-input");
  expect(records[0]!.text).toBe("");
  expect(records[2]!.clientRect).toBeNull();
  expect(records[2]!.textBoxes).toEqual([
    { bounds: [16, 120, 9, 19], start: 0, length: 1 },
  ]);
  expect(records[2]!.styles["line-height"]).toBe("normal");
  expect(records[0]!.stackingContext).toBe(true);
  const noStyle = snapshot();
  noStyle.documents[0]!.layout.styles[0] = [];
  expect(
    decodeLayoutSnapshot(noStyle, ["line-height"])[0]!.stylesAvailable,
  ).toBe(false);
});
test("rejects missing columns, bad string/layout indexes, nonfinite boxes and excessive text spans", () => {
  const missing = snapshot();
  missing.documents[0]!.layout.textColorOpacities = [];
  expect(() => decodeLayoutSnapshot(missing, ["line-height"])).toThrow(
    "textColorOpacities layout count differs",
  );
  const strings = snapshot();
  strings.documents[0]!.layout.text[0] = 900;
  expect(() => decodeLayoutSnapshot(strings, ["line-height"])).toThrow(
    "StringIndex exceeds",
  );
  const owner = snapshot();
  owner.documents[0]!.textBoxes.layoutIndex[0] = 90;
  expect(() => decodeLayoutSnapshot(owner, ["line-height"])).toThrow(
    "missing layout",
  );
  const bounds = snapshot();
  bounds.documents[0]!.layout.bounds[0]![0] = Infinity;
  expect(() => decodeLayoutSnapshot(bounds, ["line-height"])).toThrow(
    "finite coordinates",
  );
  const span = snapshot();
  span.documents[0]!.textBoxes.length[0] = 2;
  expect(() => decodeLayoutSnapshot(span, ["line-height"])).toThrow(
    "UTF-16 text",
  );
});
