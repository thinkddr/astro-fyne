// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

// Live compositor eligibility is not a report of a generated glyph mask.
export const traceLimits = { bytes: 64 * 1024 * 1024, events: 200000 } as const;
export const traceCategories = [
  "cc",
  "__metadata",
  "disabled-by-default-devtools.timeline",
  "disabled-by-default-devtools.timeline.layers",
] as const;
export const pointerStates = [
  "initial",
  "click-input",
  "click-commit",
] as const;
const reasons = new Set([
  "none",
  "setting",
  "background-color-not-opaque",
  "contents-not-opaque",
  "non-integral-translation",
  "non-integral-x-offset",
  "non-integral-y-offset",
  "will-change-transform",
  "pixel-or-color-effect",
  "transform-animation",
  "no-text",
]);
function check(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Controls layer trace: ${message}`);
}
function object(value: unknown, name: string): Record<string, unknown> {
  check(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${name} must be an object`,
  );
  return value as Record<string, unknown>;
}
function array(value: unknown, name: string): unknown[] {
  check(Array.isArray(value), `${name} must be an array`);
  return value;
}
function number(value: unknown, name: string, minimum = 0): number {
  check(
    typeof value === "number" && Number.isFinite(value) && value >= minimum,
    `${name} must be finite >= ${minimum}`,
  );
  return value;
}
function integer(value: unknown, name: string, minimum = 0): number {
  const result = number(value, name, minimum);
  check(Number.isSafeInteger(result), `${name} must be an integer`);
  return result;
}
function string(value: unknown, name: string): string {
  check(
    typeof value === "string" && value.length > 0,
    `${name} must be a nonempty string`,
  );
  return value;
}
function text(value: unknown, name: string): string {
  check(typeof value === "string", `${name} must be a string`);
  return value;
}
function vector(value: unknown, length: number, name: string) {
  const items = array(value, name);
  check(items.length === length, `${name} has the wrong length`);
  return items.map((item) => number(item, name, -Number.MAX_VALUE));
}
export function readTraceCompletion(value: unknown) {
  const completion = object(value, "tracingComplete");
  check(
    typeof completion.dataLossOccurred === "boolean",
    "dataLossOccurred must be boolean",
  );
  check(completion.dataLossOccurred === false, "trace data was lost");
  check(
    completion.stream === undefined,
    "ReportEvents unexpectedly returned a stream",
  );
  return { dataLossOccurred: false as const };
}
export function readStrictComparison(
  value: unknown,
  width: number,
  height: number,
  code: number | null,
) {
  const result = object(value, "comparison"),
    tolerance = object(result.tolerance, "tolerance");
  check(
    integer(result.width, "width", 1) === width &&
      integer(result.height, "height", 1) === height,
    "comparison dimensions differ",
  );
  check(
    integer(result.totalPixels, "totalPixels") === width * height,
    "totalPixels differs",
  );
  const changed = integer(result.changedPixels, "changedPixels"),
    delta = integer(result.maxChannelDelta, "maxChannelDelta");
  check(
    changed <= width * height &&
      integer(result.pixelsOverTolerance, "pixelsOverTolerance") === changed &&
      delta <= 255,
    "comparison counters differ",
  );
  check(
    tolerance.channel === 0 && tolerance.pixels === 0,
    "comparison tolerance is not zero",
  );
  check(
    typeof result.exact === "boolean" &&
      typeof result.accepted === "boolean" &&
      result.exact === (changed === 0) &&
      result.accepted === result.exact &&
      code === (result.exact ? 0 : 1),
    "comparison outcome/exit differs",
  );
  if (changed === 0)
    check(
      delta === 0 && result.bounds === null,
      "zero comparison has changed bounds/delta",
    );
  else {
    const bounds = object(result.bounds, "changed bounds");
    const x = integer(bounds.minX, "minX"),
      y = integer(bounds.minY, "minY"),
      right = integer(bounds.maxX, "maxX"),
      bottom = integer(bounds.maxY, "maxY");
    check(
      delta > 0 &&
        x < right &&
        y < bottom &&
        right <= width &&
        bottom <= height,
      "changed bounds/delta are inconsistent",
    );
  }
  return result;
}
export interface TraceState {
  state: (typeof pointerStates)[number];
  frameId: string;
  url: string;
  markers: {
    begin: string;
    captureBefore: string;
    captureAfter: string;
    end: string;
  };
  layerIds: string[] | null;
}
function readLayer(value: unknown) {
  const layer = object(value, "layer"),
    id = integer(layer.layer_id, "layer_id", 1);
  const bounds = object(layer.bounds, "bounds");
  check(
    typeof layer.contents_opaque === "boolean",
    "contents_opaque must be boolean",
  );
  const opacity = number(layer.opacity, "opacity");
  check(opacity <= 1, "opacity exceeds one");
  const result = {
    layerId: id,
    contentsOpaque: layer.contents_opaque,
    opacity,
    bounds: {
      width: number(bounds.width, "bounds width"),
      height: number(bounds.height, "bounds height"),
    },
    transformRowMajor:
      layer.screen_space_transform === undefined
        ? null
        : vector(layer.screen_space_transform, 16, "screen_space_transform"),
    propertyTreeIndices: Object.fromEntries(
      ["transform", "clip", "effect", "scroll"].map((kind) => [
        kind,
        integer(layer[`${kind}_tree_index`], `${kind}_tree_index`, -1),
      ]),
    ),
    lcdTextDisallowedReason: null as string | null,
    idealContentsScale: null as number | null,
    geometryContentsScale: null as number | null,
    tilingsAvailability: null as
      "serialized-array" | "omitted-empty-array" | null,
    tilings: [] as { scale: number[]; translation: number[] }[],
  };
  if (layer.lcd_text_disallowed_reason !== undefined) {
    const reason = string(
      layer.lcd_text_disallowed_reason,
      "lcd_text_disallowed_reason",
    );
    check(reasons.has(reason), "unknown LCDTextDisallowedReason");
    result.lcdTextDisallowedReason = reason;
    result.idealContentsScale = number(
      layer.ideal_contents_scale,
      "ideal_contents_scale",
    );
    result.geometryContentsScale = number(
      layer.geometry_contents_scale,
      "geometry_contents_scale",
    );
    // Perfetto records leaf argument rows; an empty NestedValue ARRAY has no
    // rows and is omitted when export_json reconstructs the dictionary.
    result.tilingsAvailability =
      layer.tilings === undefined ? "omitted-empty-array" : "serialized-array";
    result.tilings = (
      layer.tilings === undefined ? [] : array(layer.tilings, "tilings")
    ).map((value) => {
      const transform = object(
        object(value, "tiling").raster_transform,
        "raster_transform",
      );
      const scale = vector(transform.scale, 2, "raster scale");
      check(
        scale.every((n) => n > 0),
        "raster scale must be positive",
      );
      return {
        scale,
        translation: vector(transform.translation, 2, "raster translation"),
      };
    });
  }
  return result;
}
export function decodeLayerTrace(
  events: unknown,
  completion: unknown,
  states: TraceState[],
) {
  readTraceCompletion(completion);
  const input = array(events, "trace events");
  check(
    input.length > 0 && input.length <= traceLimits.events,
    "trace event count is empty or excessive",
  );
  check(
    states.length === pointerStates.length &&
      states.every((state, i) => state.state === pointerStates[i]),
    "pointer states differ",
  );
  const markerIds = states.flatMap((state) => Object.values(state.markers));
  check(
    markerIds.length === 12 &&
      new Set(markerIds).size === 12 &&
      markerIds.every((id) => typeof id === "string" && id.length > 0),
    "markers are missing or duplicated",
  );
  const markers = new Map<string, number>();
  const snapshots: {
    timestamp: number;
    pid: number;
    tid: number;
    sourceFrameNumber: number;
    layers: ReturnType<typeof readLayer>[];
  }[] = [];
  const frameBindings: {
    timestamp: number;
    frameId: string;
    url: string;
    rendererPID: number | null;
  }[] = [];
  const readyProcesses: {
    timestamp: number;
    frameId: string;
    rendererPID: number;
  }[] = [];
  const rasterTasks: {
    timestamp: number;
    pid: number;
    layerId: number;
    sourceFrameNumber: number;
    tileId: unknown;
    resolution: string;
  }[] = [];
  const snapshotFlows: {
    timestamp: number;
    phase: "s" | "f";
    pid: number;
    tid: number;
    id: number;
    bindingPoint: "e" | null;
  }[] = [];
  for (const value of input) {
    const event = object(value, "trace event");
    if (
      ![
        "clock_sync",
        "LayerTreeHostImpl:snapshot",
        "FrameCommittedInBrowser",
        "TracingStartedInBrowser",
        "ProcessReadyInBrowser",
        "RasterTask",
      ].includes(event.name as string)
    )
      continue;
    if (event.name === "RasterTask" && event.ph !== "B" && event.ph !== "X")
      continue;
    const name = event.name as string,
      args = object(event.args, `${name} args`);
    const timestamp = number(event.ts, `${name} timestamp`);
    const pid = integer(event.pid, `${name} pid`, 1);
    if (name === "clock_sync") {
      if (!markerIds.includes(args.sync_id as string)) continue;
      const id = string(args.sync_id, "sync_id");
      check(!markers.has(id), "clock marker is duplicated");
      markers.set(id, timestamp);
    } else if (name === "LayerTreeHostImpl:snapshot") {
      // The pinned exporter also reuses this name for Perfetto flow endpoints.
      // Those endpoints carry no active-tree snapshot and must not count as one.
      if (event.ph === "s" || event.ph === "f") {
        check(
          args.snapshot === undefined,
          "snapshot flow unexpectedly carries a snapshot payload",
        );
        check(
          event.ph === "s" ? event.bp === undefined : event.bp === "e",
          "snapshot flow binding point differs",
        );
        snapshotFlows.push({
          timestamp,
          phase: event.ph,
          pid,
          tid: integer(event.tid, "snapshot flow tid", 1),
          id: integer(event.id, "snapshot flow id"),
          bindingPoint: event.ph === "f" ? "e" : null,
        });
        continue;
      }
      check(event.ph === "I", "unsupported snapshot event phase");
      const tree = object(
        object(args.snapshot, "snapshot").active_tree,
        "active_tree",
      );
      const layers = array(tree.layers, "layers").map(readLayer);
      check(
        new Set(layers.map((l) => l.layerId)).size === layers.length,
        "layer IDs are duplicated",
      );
      snapshots.push({
        timestamp,
        pid,
        tid: integer(event.tid, "snapshot tid", 1),
        sourceFrameNumber: integer(
          tree.source_frame_number,
          "source_frame_number",
          -1,
        ),
        layers,
      });
    } else if (name === "ProcessReadyInBrowser") {
      const data = object(args.data, "ProcessReadyInBrowser data");
      readyProcesses.push({
        timestamp,
        frameId: string(data.frame, "ready frame token"),
        rendererPID: integer(data.processId, "ready renderer processId", 1),
      });
    } else if (
      name === "FrameCommittedInBrowser" ||
      name === "TracingStartedInBrowser"
    ) {
      const data = object(args.data, `${name} data`);
      const frames =
        name === "TracingStartedInBrowser"
          ? array(data.frames ?? [], "frames")
          : [data];
      for (const value of frames) {
        const frame = object(value, "frame");
        frameBindings.push({
          timestamp,
          frameId: string(frame.frame, "frame token"),
          url: text(frame.url, "frame url"),
          rendererPID:
            frame.processId === undefined
              ? null
              : integer(frame.processId, "renderer processId", 1),
        });
      }
    } else if (event.ph === "B" || event.ph === "X") {
      const tile = object(args.tileData, "tileData");
      check(tile.tileId !== undefined, "tileId is absent");
      rasterTasks.push({
        timestamp,
        pid,
        layerId: integer(tile.layerId, "tile layerId", 1),
        sourceFrameNumber: integer(
          tile.sourceFrameNumber,
          "tile sourceFrameNumber",
        ),
        tileId: tile.tileId,
        resolution: string(tile.tileResolution, "tileResolution"),
      });
    }
  }
  check(markers.size === markerIds.length, "clock markers are missing");
  const windows = states.map((state) => {
    const times = Object.fromEntries(
      Object.entries(state.markers).map(([key, id]) => [key, markers.get(id)!]),
    );
    check(
      times.begin! <= times.captureBefore! &&
        times.captureBefore! <= times.captureAfter! &&
        times.captureAfter! <= times.end!,
      "state clock markers are out of order",
    );
    return times;
  });
  check(
    windows.every(
      (times, i) => i === 0 || windows[i - 1]!.end! <= times.begin!,
    ),
    "state clock windows overlap or are out of order",
  );
  return states.map((state, index) => {
    const times = windows[index]!;
    const history = frameBindings
      .filter((frame) => frame.frameId === state.frameId)
      .sort((a, b) => a.timestamp - b.timestamp);
    function bindingAt(timestamp: number) {
      const frame = history
        .filter((frame) => frame.timestamp <= timestamp)
        .at(-1);
      if (!frame) return null;
      const simultaneous = history.filter(
        (receipt) => receipt.timestamp === frame.timestamp,
      );
      check(
        simultaneous.every((receipt) => receipt.url === frame.url),
        `ambiguous simultaneous frame binding: ${state.state}`,
      );
      const ready = readyProcesses.filter(
        (ready) =>
          ready.frameId === frame.frameId &&
          ready.timestamp >= frame.timestamp &&
          ready.timestamp <= timestamp,
      );
      const pids = [
        ...new Set([
          ...simultaneous.flatMap((receipt) =>
            receipt.rendererPID === null ? [] : [receipt.rendererPID],
          ),
          ...ready.map((ready) => ready.rendererPID),
        ]),
      ];
      check(pids.length <= 1, `ambiguous renderer binding: ${state.state}`);
      return {
        url: frame.url,
        rendererPID: pids[0] ?? null,
        timestamp: Math.max(
          frame.timestamp,
          ...ready.map((ready) => ready.timestamp),
        ),
      };
    }
    const checkpoints = [
      times.begin!,
      ...history.map((frame) => frame.timestamp),
      ...readyProcesses
        .filter((ready) => ready.frameId === state.frameId)
        .map((ready) => ready.timestamp),
      times.end!,
    ].filter(
      (timestamp) => timestamp >= times.begin! && timestamp <= times.end!,
    );
    const bindings = checkpoints
      .map(bindingAt)
      .filter((binding) => binding !== null);
    check(
      bindings.length > 0 &&
        bindings.every((binding) => binding.url === state.url),
      `missing or changed frame URL binding: ${state.state}`,
    );
    const pids = [
      ...new Set(
        bindings.flatMap((binding) =>
          binding.rendererPID === null ? [] : [binding.rendererPID],
        ),
      ),
    ];
    check(
      pids.length === 1,
      `missing or ambiguous renderer binding: ${state.state}`,
    );
    const frameBindingTimestamp = Math.max(
      ...bindings.map((binding) => binding.timestamp),
    );
    const selected = snapshots.flatMap((snapshot) => {
      if (snapshot.timestamp < times.begin! || snapshot.timestamp > times.end!)
        return [];
      const binding = bindingAt(snapshot.timestamp);
      return binding?.url === state.url &&
        binding.rendererPID === pids[0] &&
        snapshot.pid === pids[0]
        ? [{ ...snapshot, frameBindingTimestamp: binding.timestamp }]
        : [];
    });
    check(
      selected.length > 0 &&
        selected.some((snapshot) =>
          snapshot.layers.some(
            (layer) => layer.lcdTextDisallowedReason !== null,
          ),
        ),
      `no picture-layer snapshot in state window: ${state.state}`,
    );
    const before = selected.filter(
      (snapshot) => snapshot.timestamp <= times.captureBefore!,
    );
    const latest =
      before.sort((a, b) => a.timestamp - b.timestamp).at(-1) ?? null;
    return {
      state: state.state,
      frameId: state.frameId,
      rendererPID: pids[0],
      frameBindingTimestamp,
      markerTimesMicroseconds: times,
      snapshots: selected,
      latestBeforeCapture: latest,
      screenshotTreeIdentity:
        "candidate-by-marker-time-only; screenshot swap identity is not exposed",
      layerIdJoin:
        state.layerIds === null
          ? { availability: "CDP-tree-not-reported", matching: [] }
          : {
              availability: "CDP-tree-reported",
              matching: [
                ...new Set(
                  selected.flatMap((snapshot) =>
                    snapshot.layers.map((layer) => String(layer.layerId)),
                  ),
                ),
              ].filter((id) => state.layerIds!.includes(id)),
            },
      rasterTasks: rasterTasks.filter(
        (task) =>
          task.pid === pids[0] &&
          task.timestamp >= times.begin! &&
          task.timestamp <= times.end!,
      ),
      snapshotFlows: snapshotFlows.filter(
        (flow) =>
          flow.timestamp >= times.begin! && flow.timestamp <= times.end!,
      ),
      unobserved: [
        "cached tile can_use_lcd_text",
        "actual glyph mask",
        "actual surface pixel geometry/color/alpha",
        "per-text layer membership",
        "gamma/contrast",
      ],
    };
  });
}
