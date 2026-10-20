// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundleJavascript, validateJavascriptArchive } from "./javascript.ts";
import type {
  JavascriptAPI,
  JavascriptArchive,
  JavascriptFactory,
  JavascriptEvent,
} from "./javascript-types.ts";

function instantiate(
  archive: JavascriptArchive,
  calls: unknown[][],
  onAction?: () => void,
) {
  const factory = eval(`(${archive.code})`) as JavascriptFactory;
  return factory((kind, name, args) => {
    if (kind === "now") return 1000;
    if (kind === "random") return 0.25;
    expect(kind).toBe("action");
    expect(name).toBe("observe");
    calls.push(JSON.parse(args));
    onAction?.();
    return null;
  }, archive);
}

function mount(
  archive: JavascriptArchive,
  calls: unknown[][],
  onAction?: () => void,
) {
  const api = instantiate(archive, calls, onAction);
  for (const event of archive.events) api.replay(event);
  api.finishReplay();
  return api;
}

function click(api: JavascriptAPI) {
  api.dispatch({ node: api.snapshot()[0]!.uid, type: "click" });
}

function editCheckpoint(archive: JavascriptArchive) {
  (archive.props.settings as { label: string }).label = "Caller";
  archive.sources[0]!.path = "caller.tsx";
  archive.sources[0]!.hash = "0".repeat(64);
  archive.stylesheets![0]!.path = "caller.css";
  archive.stylesheets![0]!.hash = "0".repeat(64);
  archive.stylesheets![0]!.text = ".counter{color:blue}";
  archive.actions[0] = "caller";
  archive.events[0]!.node = "caller";
  archive.events[0]!.type = "input";
  archive.events[0]!.value = "caller";
  for (const entry of archive.journal) {
    entry.args = "[999]";
    entry.value = "999";
  }
  archive.frame![0]!.attrs!.id = "caller";
  archive.frame![0]!.style!.color = "blue";
}

async function fixture(use: (archive: JavascriptArchive) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "afy-checkpoint-ownership-"));
  try {
    const source = join(root, "Counter.tsx");
    await writeFile(
      join(root, "counter.css"),
      "\ufeff/* exact checkpoint CSS */\r\n.counter{color:#123456}\r\n",
    );
    await writeFile(
      source,
      'import{useState}from"preact/hooks";import"./counter.css";export default function Counter({settings,observe}){const[count,setCount]=useState(0);const[seed]=useState(()=>String(Date.now())+":"+String(Math.random()));return <button id="counter" class="counter" data-count={count} data-seed={seed} onClick={()=>{setCount(count+1);observe(count+1,settings.label)}}>{settings.label}:{count}</button>}',
    );
    await use(
      await bundleJavascript(
        source,
        "default",
        { settings: { label: "Owned" } },
        ["observe"],
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("editing an exported checkpoint leaves its live island and later exports unchanged", async () => {
  await fixture(async (archive) => {
    const calls: unknown[][] = [],
      api = mount(archive, calls);
    try {
      click(api);
      const exported = api.export(),
        saved = JSON.stringify(exported),
        frame = JSON.stringify(api.snapshot());
      editCheckpoint(exported);
      expect(JSON.stringify(api.snapshot())).toBe(frame);
      expect(JSON.stringify(api.export())).toBe(saved);
      expect(calls).toEqual([[1, "Owned"]]);
      const replayCalls: unknown[][] = [],
        restored = mount(
          await validateJavascriptArchive(JSON.parse(saved)),
          replayCalls,
        );
      try {
        expect(JSON.stringify(restored.export())).toBe(saved);
        expect(replayCalls).toEqual([]);
        click(api);
        click(restored);
        expect(api.snapshot()).toEqual(restored.snapshot());
        expect(api.export()).toEqual(restored.export());
        expect(calls).toEqual([
          [1, "Owned"],
          [2, "Owned"],
        ]);
        expect(replayCalls).toEqual([[2, "Owned"]]);
      } finally {
        restored.dispose();
      }
    } finally {
      api.dispose();
    }
  });
}, 60_000);

test("restoration owns its input metadata, host results, expected frame and replay events", async () => {
  await fixture(async (archive) => {
    const initial = mount(archive, []);
    let checkpoint: JavascriptArchive;
    try {
      click(initial);
      checkpoint = initial.export();
    } finally {
      initial.dispose();
    }
    const saved = JSON.stringify(checkpoint),
      input = await validateJavascriptArchive(JSON.parse(saved)),
      events = input.events.map((event) => ({ ...event })),
      calls: unknown[][] = [],
      restored = instantiate(input, calls);
    try {
      editCheckpoint(input);
      for (const event of events) {
        restored.replay(event);
        event.node = "caller";
        event.type = "change";
      }
      restored.finishReplay();
      expect(JSON.stringify(restored.export())).toBe(saved);
      expect(calls).toEqual([]);
      click(restored);
      expect(restored.snapshot()[0]!.attrs!["data-count"]).toBe("2");
      expect(calls).toEqual([[2, "Owned"]]);
      await validateJavascriptArchive(restored.export());
    } finally {
      restored.dispose();
    }
  });
}, 60_000);

test("host callbacks cannot replace the event already delivered to an island", async () => {
  await fixture(async (archive) => {
    let supplied: JavascriptEvent;
    const calls: unknown[][] = [],
      api = mount(archive, calls, () => {
        supplied.node = "caller";
        supplied.type = "input";
        supplied.value = "caller";
      });
    try {
      const node = api.snapshot()[0]!.uid;
      supplied = { node, type: "click" };
      api.dispatch(supplied);
      const checkpoint = await validateJavascriptArchive(api.export());
      expect(supplied).toEqual({
        node: "caller",
        type: "input",
        value: "caller",
      });
      expect(checkpoint.events).toEqual([{ node, type: "click" }]);
      expect(calls).toEqual([[1, "Owned"]]);
      const replayCalls: unknown[][] = [],
        restored = mount(checkpoint, replayCalls);
      try {
        expect(restored.export()).toEqual(checkpoint);
        expect(replayCalls).toEqual([]);
      } finally {
        restored.dispose();
      }
    } finally {
      api.dispose();
    }
  });
}, 60_000);

test("checkpoint ownership retains the full 100000-record host journal limit", async () => {
  const root = await mkdtemp(join(tmpdir(), "afy-checkpoint-journal-limit-"));
  try {
    const source = join(root, "Journal.tsx");
    await writeFile(
      source,
      'import{useState}from"preact/hooks";export default function Journal({count}){const[total]=useState(()=>{let total=0;for(let i=0;i<count;i++)total+=Math.random();return total});return <p>{total}</p>}',
    );
    const baseline = mount(
      await bundleJavascript(source, "default", { count: 0 }),
      [],
    );
    let initialRecords: number;
    try {
      initialRecords = baseline.export().journal.length;
      expect(initialRecords).toBeLessThan(100000);
    } finally {
      baseline.dispose();
    }
    const archive = await bundleJavascript(source, "default", {
        count: 100000 - initialRecords,
      }),
      api = mount(archive, []);
    try {
      const checkpoint = await validateJavascriptArchive(api.export());
      expect(checkpoint.journal).toHaveLength(100000);
      const restored = mount(checkpoint, []);
      try {
        expect(restored.export()).toEqual(checkpoint);
      } finally {
        restored.dispose();
      }
    } finally {
      api.dispose();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);
