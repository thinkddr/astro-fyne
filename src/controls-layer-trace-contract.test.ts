// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { expect, test } from "bun:test";
import {
  decodeLayerTrace,
  pointerStates,
  readStrictComparison,
  readTraceCompletion,
  type TraceState,
} from "../capture/controls-layer-trace-contract.ts";

// Synthetic protocol records test rejection and joins, not browser rendering.
function fixture() {
  const states: TraceState[] = pointerStates.map((state) => ({
    state,
    frameId: "FRAME",
    url: "http://fixture/responsive-controls",
    layerIds: ["7"],
    markers: {
      begin: state + "-begin",
      captureBefore: state + "-before",
      captureAfter: state + "-after",
      end: state + "-end",
    },
  }));
  const layer = {
    layer_id: 7,
    bounds: { width: 224, height: 320 },
    contents_opaque: true,
    opacity: 1,
    transform_tree_index: 1,
    clip_tree_index: 2,
    effect_tree_index: 3,
    scroll_tree_index: 4,
    screen_space_transform: [1, 0, 0, 16, 0, 1, 0, 52, 0, 0, 1, 0, 0, 0, 0, 1],
    lcd_text_disallowed_reason: "none",
    ideal_contents_scale: 1,
    geometry_contents_scale: 1,
    tilings: [{ raster_transform: { scale: [1, 1], translation: [0.25, 0] } }],
  };
  const events: any[] = [
    {
      name: "TracingStartedInBrowser",
      pid: 1,
      tid: 1,
      ts: 0,
      args: {
        data: {
          frames: [{ frame: "FRAME", url: states[0]!.url, processId: 99 }],
        },
      },
    },
  ];
  states.forEach((state, i) => {
    const start = i * 100;
    Object.values(state.markers).forEach((id, n) =>
      events.push({
        name: "clock_sync",
        pid: 1,
        ts: start + [1, 40, 50, 90][n]!,
        args: { sync_id: id },
      }),
    );
    events.push({
      name: "LayerTreeHostImpl:snapshot",
      pid: 99,
      tid: 100,
      ts: start + 20,
      args: {
        snapshot: {
          active_tree: {
            source_frame_number: i + 1,
            layers: [structuredClone(layer)],
          },
        },
      },
    });
    events.push({
      name: "RasterTask",
      ph: "B",
      pid: 99,
      tid: 101,
      ts: start + 25,
      args: {
        tileData: {
          layerId: 7,
          sourceFrameNumber: i + 1,
          tileId: { id_ref: "tile" },
          tileResolution: "HIGH_RESOLUTION",
        },
      },
    });
    events.push({
      name: "RasterTask",
      ph: "E",
      pid: 99,
      tid: 101,
      ts: start + 26,
    });
  });
  return { events, states, completion: { dataLossOccurred: false } };
}
function decode(value = fixture()) {
  return decodeLayerTrace(value.events, value.completion, value.states);
}
function firstLayer(value: ReturnType<typeof fixture>) {
  return value.events.find(
    (event) => event.name === "LayerTreeHostImpl:snapshot",
  ).args.snapshot.active_tree.layers[0];
}
test("joins real source-shaped layer/frame/clock records without inventing a glyph mask", () => {
  const decoded = decode();
  expect(decoded.map((state) => state.state)).toEqual([...pointerStates]);
  expect(decoded[0]!.rendererPID).toBe(99);
  expect(decoded[0]!.latestBeforeCapture!.sourceFrameNumber).toBe(1);
  const layer = decoded[0]!.snapshots[0]!.layers[0]!;
  expect(layer.bounds).toEqual({ width: 224, height: 320 });
  expect(layer.transformRowMajor?.[3]).toBe(16);
  expect(layer.transformRowMajor?.[7]).toBe(52);
  expect(layer.lcdTextDisallowedReason).toBe("none");
  expect(layer.tilings[0]!.translation).toEqual([0.25, 0]);
  expect(decoded[0]!.layerIdJoin.matching).toEqual(["7"]);
  expect(decoded[0]!.rasterTasks).toHaveLength(1);
  expect(decoded[0]!.unobserved).toContain("cached tile can_use_lcd_text");
  expect(decoded[0]!.unobserved).toContain("actual glyph mask");
});
test("a missing public LayerTree report stays unavailable instead of proving no compositor layers", () => {
  const value = fixture();
  value.states.forEach((state) => {
    state.layerIds = null;
  });
  const result = decode(value);
  expect(result[0]!.layerIdJoin).toEqual({
    availability: "CDP-tree-not-reported",
    matching: [],
  });
  expect(result[0]!.snapshots[0]!.layers).toHaveLength(1);
});
test("supports the pinned deferred renderer-process receipt without fabricating a PID", () => {
  const value = fixture();
  delete value.events[0].args.data.frames[0].processId;
  value.events.push({
    name: "ProcessReadyInBrowser",
    pid: 1,
    ts: 0.5,
    args: { data: { frame: "FRAME", processId: 99 } },
  });
  expect(decode(value)[0]!.rendererPID).toBe(99);
  value.events.at(-1).args.data.processId = 0;
  expect(() => decode(value)).toThrow("ready renderer processId");
});
test("rejects dropped traces, nonboolean receipts, reordered/missing/duplicate markers", () => {
  expect(() => readTraceCompletion({ dataLossOccurred: 0 })).toThrow("boolean");
  expect(() => readTraceCompletion({ dataLossOccurred: true })).toThrow("lost");
  expect(() =>
    readTraceCompletion({ dataLossOccurred: false, stream: "unexpected" }),
  ).toThrow("stream");
  const missing = fixture();
  missing.events = missing.events.filter(
    (event) => event.args?.sync_id !== "initial-before",
  );
  expect(() => decode(missing)).toThrow("markers are missing");
  const repeated = fixture();
  repeated.events.push(
    repeated.events.find((event) => event.args?.sync_id === "initial-begin"),
  );
  expect(() => decode(repeated)).toThrow("duplicated");
  const order = fixture();
  order.events.find((event) => event.args?.sync_id === "initial-before").ts =
    51;
  expect(() => decode(order)).toThrow("out of order");
  const states = fixture();
  states.states.reverse();
  expect(() => decode(states)).toThrow("pointer states differ");
});
test("rejects swapped or overlapping complete state windows", () => {
  const swapped = fixture();
  for (const event of swapped.events) {
    const id = event.args?.sync_id;
    if (id?.startsWith("initial-")) event.ts += 100;
    if (id?.startsWith("click-input-")) event.ts -= 100;
  }
  expect(() => decode(swapped)).toThrow("windows overlap or are out of order");
  const overlap = fixture();
  for (const event of overlap.events)
    if (event.args?.sync_id?.startsWith("click-input-")) event.ts -= 20;
  expect(() => decode(overlap)).toThrow("windows overlap or are out of order");
});
test("rejects same-frame navigation or process changes instead of reusing an older matching URL", () => {
  for (const [url, processId, message] of [
    ["http://fixture/other", 99, "changed frame URL"],
    ["http://fixture/responsive-controls", 98, "ambiguous renderer"],
  ] as const) {
    const value = fixture();
    value.events.push({
      name: "FrameCommittedInBrowser",
      pid: 1,
      ts: 10,
      args: { data: { frame: "FRAME", url, processId } },
    });
    expect(() => decode(value)).toThrow(message);
  }
  const beforeWindow = fixture();
  beforeWindow.events.push({
    name: "FrameCommittedInBrowser",
    pid: 1,
    ts: 0.5,
    args: {
      data: { frame: "FRAME", url: "http://fixture/other", processId: 99 },
    },
  });
  expect(() => decode(beforeWindow)).toThrow("changed frame URL");
  const simultaneous = fixture();
  simultaneous.events.push({
    name: "FrameCommittedInBrowser",
    pid: 1,
    ts: 0,
    args: {
      data: { frame: "FRAME", url: "http://fixture/other", processId: 99 },
    },
  });
  expect(() => decode(simultaneous)).toThrow("ambiguous simultaneous frame");
  const ready = fixture();
  ready.events.push({
    name: "ProcessReadyInBrowser",
    pid: 1,
    ts: 10,
    args: { data: { frame: "FRAME", processId: 98 } },
  });
  expect(() => decode(ready)).toThrow("ambiguous renderer");
});
test("a simultaneous deferred receipt cannot hide conflicting known renderer PIDs", () => {
  const value = fixture();
  for (const processId of [98, undefined])
    value.events.push({
      name: "FrameCommittedInBrowser",
      pid: 1,
      ts: 0,
      args: { data: { frame: "FRAME", url: value.states[0]!.url, processId } },
    });
  value.events.push({
    name: "ProcessReadyInBrowser",
    pid: 1,
    ts: 0.5,
    args: { data: { frame: "FRAME", processId: 99 } },
  });
  expect(() => decode(value)).toThrow("ambiguous renderer binding");
});
test("requires a genuine frame/PID/time join and observed picture-layer records", () => {
  const pid = fixture();
  pid.events[0].args.data.frames[0].processId = 98;
  expect(() => decode(pid)).toThrow("no picture-layer snapshot");
  const frame = fixture();
  frame.states[0]!.frameId = "OTHER";
  expect(() => decode(frame)).toThrow("frame URL binding");
  const outside = fixture();
  outside.events.find(
    (event) => event.name === "LayerTreeHostImpl:snapshot",
  ).ts = 91;
  expect(() => decode(outside)).toThrow("no picture-layer snapshot");
  const noTextLayer = fixture();
  delete firstLayer(noTextLayer).lcd_text_disallowed_reason;
  expect(() => decode(noTextLayer)).toThrow("no picture-layer snapshot");
});
test("rejects malformed layer eligibility/geometry instead of treating it as an AA observation", () => {
  for (const [field, value, message] of [
    ["layer_id", 7.5, "integer"],
    ["contents_opaque", 1, "boolean"],
    ["opacity", 1.1, "exceeds one"],
    ["lcd_text_disallowed_reason", "LCD16", "unknown"],
    ["bounds", [224, 320], "object"],
    ["screen_space_transform", Array(16).fill(NaN), "finite"],
  ] as const) {
    const record = fixture();
    firstLayer(record)[field] = value;
    expect(() => decode(record)).toThrow(message);
  }
  const duplicate = fixture();
  const layers = duplicate.events.find(
    (event) => event.name === "LayerTreeHostImpl:snapshot",
  ).args.snapshot.active_tree.layers;
  layers.push(structuredClone(layers[0]));
  expect(() => decode(duplicate)).toThrow("layer IDs are duplicated");
});
test("requires complete zero-tolerance PNG counters, bounds, boolean results and matching exit status", () => {
  const exact = {
    width: 224,
    height: 320,
    totalPixels: 71680,
    changedPixels: 0,
    pixelsOverTolerance: 0,
    maxChannelDelta: 0,
    bounds: null,
    tolerance: { channel: 0, pixels: 0 },
    exact: true,
    accepted: true,
  };
  expect(readStrictComparison(exact, 224, 320, 0).exact).toBe(true);
  const different = {
    ...exact,
    changedPixels: 1,
    pixelsOverTolerance: 1,
    maxChannelDelta: 3,
    bounds: { minX: 2, minY: 3, maxX: 3, maxY: 4 },
    exact: false,
    accepted: false,
  };
  expect(readStrictComparison(different, 224, 320, 1).exact).toBe(false);
  for (const value of [
    { ...exact, exact: 1 },
    { ...exact, width: 224.5 },
    { ...exact, totalPixels: true },
    { ...exact, tolerance: { channel: 1, pixels: 0 } },
    { ...exact, changedPixels: 71681 },
    { ...exact, pixelsOverTolerance: 1 },
    { ...exact, maxChannelDelta: 256 },
  ])
    expect(() => readStrictComparison(value, 224, 320, 0)).toThrow();
  for (const value of [
    { ...different, maxChannelDelta: 0 },
    { ...different, bounds: { minX: 2, minY: 3, maxX: 225, maxY: 4 } },
  ])
    expect(() => readStrictComparison(value, 224, 320, 1)).toThrow(
      "changed bounds/delta are inconsistent",
    );
  expect(() => readStrictComparison(exact, 224, 320, 1)).toThrow("exit");
});
