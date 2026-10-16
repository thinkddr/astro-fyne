// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

// These decoders validate observations, not rendering equivalence.
function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Controls diagnostic: ${message}`);
}
function object(value: unknown, label: string): Record<string, unknown> {
  requireValue(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${label} must be an object`,
  );
  return value as Record<string, unknown>;
}
function array(value: unknown, label: string): unknown[] {
  requireValue(Array.isArray(value), `${label} must be an array`);
  return value;
}
function integer(value: unknown, label: string, minimum = 0): number {
  requireValue(
    typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= minimum,
    `${label} must be an integer >= ${minimum}`,
  );
  return value;
}
function string(value: unknown, label: string): string {
  requireValue(typeof value === "string", `${label} must be a string`);
  return value;
}
export function rectangle(value: unknown, label: string): number[] {
  const result = array(value, label);
  requireValue(
    result.length === 4 &&
      result.every((item) => typeof item === "number" && Number.isFinite(item)),
    `${label} requires four finite coordinates`,
  );
  requireValue(
    (result[2] as number) >= 0 && (result[3] as number) >= 0,
    `${label} has a negative size`,
  );
  return result as number[];
}
function domRectangle(value: unknown, label: string): number[] | null {
  // The pinned agent emits [] for non-Element nodes, not a zero rectangle.
  return array(value, label).length === 0 ? null : rectangle(value, label);
}
export interface ObservedNode {
  nodeId: number;
  backendNodeId: number;
  nodeType: number;
  nodeName: string;
  nodeValue: string;
  attributes: Record<string, string>;
  children: ObservedNode[];
  shadowRoots: ObservedNode[];
  shadowRootType: string | null;
}
function attributes(value: unknown, label: string): Record<string, string> {
  const values = array(value, label),
    result: Record<string, string> = Object.create(null);
  requireValue(values.length % 2 === 0, `${label} must contain pairs`);
  for (let index = 0; index < values.length; index += 2) {
    const name = string(values[index], `${label} name`);
    requireValue(!Object.hasOwn(result, name), `${label} repeats ${name}`);
    result[name] = string(values[index + 1], `${label} value`);
  }
  return result;
}
export function readUAInput(root: unknown) {
  const nodes: ObservedNode[] = [],
    ids = new Set<number>();
  function visit(value: unknown, depth: number): ObservedNode {
    requireValue(
      depth <= 64 && nodes.length < 10000,
      "DOM observation is too deep or large",
    );
    const item = object(value, "DOM node"),
      nodeId = integer(item.nodeId, "nodeId", 1);
    requireValue(!ids.has(nodeId), "DOM nodeId is duplicated");
    ids.add(nodeId);
    const result: ObservedNode = {
      nodeId,
      backendNodeId: integer(item.backendNodeId, "backendNodeId", 1),
      nodeType: integer(item.nodeType, "nodeType", 1),
      nodeName: string(item.nodeName, "nodeName"),
      nodeValue: string(item.nodeValue, "nodeValue"),
      attributes: attributes(item.attributes ?? [], "attributes"),
      children: [],
      shadowRoots: [],
      shadowRootType:
        item.shadowRootType === undefined
          ? null
          : string(item.shadowRootType, "shadowRootType"),
    };
    nodes.push(result);
    result.children = array(item.children ?? [], "children").map((child) =>
      visit(child, depth + 1),
    );
    result.shadowRoots = array(item.shadowRoots ?? [], "shadowRoots").map(
      (child) => visit(child, depth + 1),
    );
    return result;
  }
  visit(root, 0);
  const inputs = nodes.filter(
      (node) => node.attributes.id === "controls-input",
    ),
    input = inputs[0];
  requireValue(
    inputs.length === 1 &&
      input?.nodeName === "INPUT" &&
      input.attributes.type === "text",
    "expected exactly one authored text input",
  );
  const roots = input.shadowRoots.filter(
      (node) => node.shadowRootType === "user-agent",
    ),
    shadowRoot = roots[0];
  requireValue(
    roots.length === 1 && shadowRoot,
    "input user-agent shadow root is missing or duplicated",
  );
  const elements = shadowRoot.children.filter((node) => node.nodeType === 1),
    editor = elements[0];
  // The pinned TextFieldInputType creates this direct DIV for this plain text input.
  // A changed UA tree is an explicit diagnostic failure, never an outer-input fallback.
  requireValue(
    elements.length === 1 && editor?.nodeName === "DIV",
    "plain input must expose its single direct UA editor DIV",
  );
  const editorNodes: ObservedNode[] = [];
  function collect(node: ObservedNode) {
    editorNodes.push(node);
    node.children.forEach(collect);
  }
  collect(editor);
  requireValue(
    editorNodes.some(
      (node) => node.nodeType === 3 && node.nodeValue.length > 0,
    ),
    "UA editor has no observable text node",
  );
  return { input, shadowRoot, editor, editorNodes };
}
export function readComputedStyle(value: unknown): Record<string, string> {
  const result: Record<string, string> = Object.create(null);
  for (const entry of array(value, "computedStyle")) {
    const item = object(entry, "computed style"),
      name = string(item.name, "style name");
    requireValue(
      !Object.hasOwn(result, name),
      `computed style repeats ${name}`,
    );
    result[name] = string(item.value, `computed ${name}`);
  }
  for (const name of [
    "font-family",
    "font-size",
    "font-weight",
    "line-height",
    "color",
  ])
    requireValue(
      typeof result[name] === "string" && result[name]!.length > 0,
      `computed style omits ${name}`,
    );
  return result;
}
function quad(value: unknown, label: string): number[] {
  const result = array(value, label);
  requireValue(
    result.length === 8 &&
      result.every((item) => typeof item === "number" && Number.isFinite(item)),
    `${label} requires eight finite coordinates`,
  );
  return result as number[];
}
export function readBoxModel(value: unknown) {
  const item = object(value, "box model");
  return {
    width: integer(item.width, "box width", 1),
    height: integer(item.height, "box height", 1),
    content: quad(item.content, "content quad"),
    padding: quad(item.padding, "padding quad"),
    border: quad(item.border, "border quad"),
    margin: quad(item.margin, "margin quad"),
  };
}
export function readContentQuads(value: unknown) {
  const quads = array(value, "text content quads");
  requireValue(quads.length > 0, "UA text has no content quad");
  return quads.map((value) => quad(value, "text content quad"));
}
export function decodeLayoutSnapshot(
  value: unknown,
  computedStyles: readonly string[],
) {
  const snapshot = object(value, "DOMSnapshot"),
    strings = array(snapshot.strings, "strings").map((value) =>
      string(value, "string table value"),
    );
  function lookup(value: unknown): string {
    const index = integer(value, "StringIndex", -1);
    if (index === -1) return ""; // Pinned AddString uses -1 for empty strings.
    requireValue(index < strings.length, "StringIndex exceeds its table");
    return strings[index]!;
  }
  const documents = array(snapshot.documents, "documents");
  requireValue(documents.length === 1, "expected one original source document");
  const document = object(documents[0], "document"),
    nodes = object(document.nodes, "nodes"),
    layout = object(document.layout, "layout"),
    textBoxes = object(document.textBoxes, "textBoxes");
  const backendIds = array(nodes.backendNodeId, "backendNodeId"),
    count = backendIds.length;
  requireValue(count > 0, "snapshot has no nodes");
  const nodeColumns = [
    "parentIndex",
    "nodeName",
    "nodeValue",
    "attributes",
  ] as const;
  for (const column of nodeColumns)
    requireValue(
      array(nodes[column], column).length === count,
      `${column} node count differs`,
    );
  const layoutNodes = array(layout.nodeIndex, "layout nodeIndex"),
    layoutCount = layoutNodes.length;
  requireValue(layoutCount > 0, "snapshot has no layout");
  const columns = [
    "styles",
    "bounds",
    "text",
    "paintOrders",
    "offsetRects",
    "scrollRects",
    "clientRects",
    "blendedBackgroundColors",
    "textColorOpacities",
  ] as const;
  for (const column of columns)
    requireValue(
      array(layout[column], column).length === layoutCount,
      `${column} layout count differs`,
    );
  const stacking = new Set(
    array(
      object(layout.stackingContexts, "stackingContexts").index,
      "stacking indexes",
    ).map((value) => integer(value, "stacking index")),
  );
  for (const index of stacking)
    requireValue(index < layoutCount, "stacking index exceeds layout");
  const records = layoutNodes.map((value, index) => {
    const nodeIndex = integer(value, "layout node index");
    requireValue(nodeIndex < count, "layout node index exceeds nodes");
    const parent = integer(
      (nodes.parentIndex as unknown[])[nodeIndex],
      "parent index",
      -1,
    );
    requireValue(parent < nodeIndex, "snapshot parent must precede its child");
    const pairs = array(
      (nodes.attributes as unknown[])[nodeIndex],
      "node attributes",
    ).map(lookup);
    const styleValues = array(
      (layout.styles as unknown[])[index],
      "layout styles",
    );
    // The pinned agent emits [] when a layout node (e.g. Document) has no
    // Element computed style. Preserve absence instead of inventing values.
    requireValue(
      styleValues.length === 0 || styleValues.length === computedStyles.length,
      "layout style width differs",
    );
    const styles: Record<string, string> = Object.create(null);
    if (styleValues.length)
      computedStyles.forEach((name, column) => {
        styles[name] = lookup(styleValues[column]);
      });
    const opacity = (layout.textColorOpacities as unknown[])[index];
    requireValue(
      typeof opacity === "number" &&
        Number.isFinite(opacity) &&
        opacity >= 0 &&
        opacity <= 1,
      "invalid textColorOpacity",
    );
    return {
      nodeIndex,
      parentIndex: parent,
      backendNodeId: integer(
        backendIds[nodeIndex],
        "snapshot backendNodeId",
        1,
      ),
      nodeName: lookup((nodes.nodeName as unknown[])[nodeIndex]),
      nodeValue: lookup((nodes.nodeValue as unknown[])[nodeIndex]),
      attributes: attributes(pairs, "snapshot attributes"),
      styles,
      stylesAvailable: styleValues.length > 0,
      bounds: rectangle((layout.bounds as unknown[])[index], "layout bounds"),
      text: lookup((layout.text as unknown[])[index]),
      paintOrder: integer(
        (layout.paintOrders as unknown[])[index],
        "paint order",
      ),
      stackingContext: stacking.has(index),
      offsetRect: domRectangle(
        (layout.offsetRects as unknown[])[index],
        "offset rect",
      ),
      scrollRect: domRectangle(
        (layout.scrollRects as unknown[])[index],
        "scroll rect",
      ),
      clientRect: domRectangle(
        (layout.clientRects as unknown[])[index],
        "client rect",
      ),
      blendedBackgroundColor: lookup(
        (layout.blendedBackgroundColors as unknown[])[index],
      ),
      textColorOpacity: opacity,
      textBoxes: [] as { bounds: number[]; start: number; length: number }[],
    };
  });
  const boxIndexes = array(textBoxes.layoutIndex, "text layout indexes");
  for (const column of ["bounds", "start", "length"])
    requireValue(
      array(textBoxes[column], `text ${column}`).length === boxIndexes.length,
      `text ${column} count differs`,
    );
  boxIndexes.forEach((value, index) => {
    const owner = records[integer(value, "textbox layout index")];
    requireValue(owner, "textbox references missing layout");
    const start = integer(
        (textBoxes.start as unknown[])[index],
        "textbox start",
      ),
      length = integer(
        (textBoxes.length as unknown[])[index],
        "textbox length",
      );
    requireValue(
      start + length <= owner.text.length,
      "textbox exceeds its UTF-16 text",
    );
    owner.textBoxes.push({
      bounds: rectangle(
        (textBoxes.bounds as unknown[])[index],
        "textbox bounds",
      ),
      start,
      length,
    });
  });
  return records;
}
