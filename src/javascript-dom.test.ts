// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import { expect, test } from "bun:test";
const { createDocument } = await import(
  new URL("./javascript-dom.js", import.meta.url).href
);

test("checkbox preactivation, cancellation and local defaults preserve DOM semantics", () => {
  const { document, root, dispatch } = createDocument();
  const field = document.createElement("input");
  field.setAttribute("type", "checkbox");
  field.defaultChecked = true;
  root.appendChild(field);
  const events: any[] = [];
  for (const type of ["click", "input", "change"])
    field.addEventListener(
      type,
      (event: any) =>
        events.push([
          event.type,
          event.currentTarget.checked,
          event.currentTarget.value,
        ]),
      false,
    );
  dispatch({ node: field.uid, type: "click" });
  expect(events).toEqual([
    ["click", false, "on"],
    ["input", false, "on"],
    ["change", false, "on"],
  ]);
  field.defaultChecked = true;
  expect(field.checked).toBe(false);
  events.length = 0;
  field.addEventListener(
    "click",
    (event: any) => event.preventDefault(),
    false,
  );
  expect(dispatch({ node: field.uid, type: "click" })).toBe(true);
  expect(field.checked).toBe(false);
  expect(events).toEqual([["click", true, "on"]]);
});

test("a checkbox disabled or detached during click still completes its activation events", () => {
  const { document, root, dispatch } = createDocument();
  const field = document.createElement("input");
  field.setAttribute("type", "checkbox");
  root.appendChild(field);
  const events: string[] = [];
  field.addEventListener(
    "click",
    () => {
      field.disabled = true;
      field.remove();
    },
    false,
  );
  for (const type of ["input", "change"])
    field.addEventListener(type, () => events.push(type), false);
  dispatch({ node: field.uid, type: "click" });
  expect(field.checked).toBe(true);
  expect(events).toEqual(["input", "change"]);
});

test("capture options and event phases distinguish ancestors and the target", () => {
  const { document, root, dispatch } = createDocument();
  const parent = document.createElement("div");
  const button = document.createElement("button");
  root.appendChild(parent);
  parent.appendChild(button);
  const calls: any[] = [];
  let saved: any;
  for (const [node, name, options] of [
    [parent, "parent-capture", true],
    [parent, "parent-bubble", { capture: false }],
    [button, "target-capture", { capture: true }],
    [button, "target-bubble", false],
  ] as const) {
    node.addEventListener(
      "click",
      function (this: any, event: any) {
        saved = event;
        calls.push([
          name,
          event.eventPhase,
          this === event.currentTarget,
          event.target === button,
        ]);
      },
      options,
    );
  }
  dispatch({ node: button.uid, type: "click" });
  expect(calls).toEqual([
    ["parent-capture", 1, true, true],
    ["target-capture", 2, true, true],
    ["target-bubble", 2, true, true],
    ["parent-bubble", 3, true, true],
  ]);
  expect(saved.currentTarget).toBe(null);
  expect(saved.eventPhase).toBe(0);
});

test("listener identity includes capture and does not replace once or passive options", () => {
  const { document, root, dispatch } = createDocument();
  const button = document.createElement("button");
  root.appendChild(button);
  const calls: number[] = [];
  const callback = (event: any) => {
    calls.push(event.eventPhase);
    event.preventDefault();
  };
  button.addEventListener("click", callback, false);
  button.addEventListener("click", callback, {
    capture: false,
    once: true,
    passive: true,
  });
  button.addEventListener("click", callback, true);
  expect(dispatch({ node: button.uid, type: "click" })).toBe(true);
  expect(dispatch({ node: button.uid, type: "click" })).toBe(true);
  expect(calls).toEqual([2, 2, 2, 2]);
  button.removeEventListener("click", callback, { capture: true });
  calls.length = 0;
  dispatch({ node: button.uid, type: "click" });
  expect(calls).toEqual([2]);
  button.removeEventListener("click", callback, { capture: false });
  expect(dispatch({ node: button.uid, type: "click" })).toBe(false);
});

test("removal skips cloned records and additions wait for a later invocation", () => {
  const { document, root, dispatch } = createDocument();
  const button = document.createElement("button");
  root.appendChild(button);
  const calls: string[] = [];
  const removed = () => calls.push("readded");
  const added = () => calls.push("added");
  button.addEventListener(
    "click",
    () => {
      calls.push("first");
      button.removeEventListener("click", removed);
      button.addEventListener("click", removed);
      button.addEventListener("click", added);
    },
    { once: true },
  );
  button.addEventListener("click", removed);
  button.addEventListener("click", () => calls.push("tail"));
  dispatch({ node: button.uid, type: "click" });
  expect(calls).toEqual(["first", "tail"]);
  calls.length = 0;
  dispatch({ node: button.uid, type: "click" });
  expect(calls).toEqual(["tail", "readded", "added"]);
});

test("listeners added during target capture can run in the later target bubble invocation", () => {
  const { document, root, dispatch } = createDocument();
  const button = document.createElement("button");
  root.appendChild(button);
  const calls: string[] = [];
  button.addEventListener(
    "click",
    () => {
      calls.push("capture");
      button.addEventListener("click", () => calls.push("bubble"));
    },
    { capture: true, once: true },
  );
  dispatch({ node: button.uid, type: "click" });
  expect(calls).toEqual(["capture", "bubble"]);
});

test("once listeners are removed before a recursive click and disappear from snapshots", () => {
  const { document, root, dispatch, snapshot } = createDocument();
  const button = document.createElement("button");
  root.appendChild(button);
  let calls = 0;
  button.addEventListener(
    "click",
    () => {
      calls++;
      button.click();
    },
    { once: true },
  );
  dispatch({ node: button.uid, type: "click" });
  expect(calls).toBe(1);
  expect(snapshot()[0].events).toEqual([]);
});

test("passive click listeners cannot cancel checkbox activation with either legacy API", () => {
  const { document, root, dispatch } = createDocument();
  const field = document.createElement("input");
  field.setAttribute("type", "checkbox");
  root.appendChild(field);
  const calls: any[] = [];
  field.addEventListener(
    "click",
    (event: any) => {
      event.preventDefault();
      event.returnValue = false;
      calls.push([event.cancelable, event.defaultPrevented, event.returnValue]);
    },
    { passive: true },
  );
  for (const type of ["input", "change"])
    field.addEventListener(type, () => calls.push(type));
  expect(dispatch({ node: field.uid, type: "click" })).toBe(false);
  expect(field.checked).toBe(true);
  expect(calls).toEqual([[true, false, true], "input", "change"]);
});

test("cancelability and legacy returnValue preserve an existing cancellation", () => {
  const { document, root, dispatch } = createDocument();
  const field = document.createElement("input");
  root.appendChild(field);
  const calls: any[] = [];
  for (const type of ["input", "change"])
    field.addEventListener(type, (event: any) => {
      event.preventDefault();
      event.returnValue = false;
      calls.push([
        type,
        event.cancelable,
        event.defaultPrevented,
        event.returnValue,
      ]);
    });
  expect(dispatch({ node: field.uid, type: "input", value: "x" })).toBe(false);
  expect(dispatch({ node: field.uid, type: "change", value: "x" })).toBe(false);
  expect(calls).toEqual([
    ["input", false, false, true],
    ["change", false, false, true],
  ]);
  let saved: any;
  field.addEventListener("click", (event: any) => {
    saved = event;
    event.returnValue = 0;
    event.returnValue = true;
  });
  field.addEventListener(
    "click",
    (event: any) => {
      event.preventDefault();
      event.returnValue = false;
      expect(event.defaultPrevented).toBe(true);
    },
    { passive: true },
  );
  expect(dispatch({ node: field.uid, type: "click" })).toBe(true);
  expect(saved.returnValue).toBe(false);
  expect(saved.defaultPrevented).toBe(true);
});

test("target capture stops later phases but not other listeners in the same invocation", () => {
  for (const immediate of [false, true]) {
    const { document, root, dispatch } = createDocument();
    const button = document.createElement("button");
    root.appendChild(button);
    const calls: string[] = [];
    let saved: any;
    button.addEventListener(
      "click",
      (event: any) => {
        saved = event;
        calls.push("first-capture");
        if (immediate) event.stopImmediatePropagation();
        else event.stopPropagation();
        expect(event.cancelBubble).toBe(true);
        event.cancelBubble = false;
        expect(event.cancelBubble).toBe(true);
      },
      true,
    );
    button.addEventListener("click", () => calls.push("second-capture"), true);
    button.addEventListener("click", () => calls.push("target-bubble"));
    root.addEventListener("click", () => calls.push("ancestor-bubble"));
    dispatch({ node: button.uid, type: "click" });
    expect(calls).toEqual(
      immediate ? ["first-capture"] : ["first-capture", "second-capture"],
    );
    expect(saved.cancelBubble).toBe(false);
    expect(saved.eventPhase).toBe(0);
    expect(saved.currentTarget).toBe(null);
  }
});

test("cancelBubble stops ancestors while allowing other listeners on the current target", () => {
  const { document, root, dispatch } = createDocument();
  const button = document.createElement("button");
  root.appendChild(button);
  const calls: string[] = [];
  button.addEventListener("click", (event: any) => {
    calls.push("first");
    event.cancelBubble = 1;
  });
  button.addEventListener("click", () => calls.push("second"));
  root.addEventListener("click", () => calls.push("parent"));
  dispatch({ node: button.uid, type: "click" });
  expect(calls).toEqual(["first", "second"]);
});

test("handleEvent objects use their own receiver and resolve the method on each event", () => {
  const { document, root, dispatch } = createDocument();
  const button = document.createElement("button");
  root.appendChild(button);
  const calls: any[] = [];
  const listener = {
    handleEvent(this: any, event: any) {
      calls.push(["first", this === listener, event.currentTarget === button]);
    },
  };
  button.addEventListener("click", listener);
  button.addEventListener("click", listener, { once: true });
  dispatch({ node: button.uid, type: "click" });
  listener.handleEvent = function (this: any, event: any) {
    calls.push(["second", this === listener, event.currentTarget === button]);
  };
  dispatch({ node: button.uid, type: "click" });
  button.removeEventListener("click", listener, { capture: false });
  dispatch({ node: button.uid, type: "click" });
  expect(calls).toEqual([
    ["first", true, true],
    ["second", true, true],
  ]);
});

test("listener call properties do not override invocation and invalid objects fail explicitly", () => {
  const { document, root, dispatch } = createDocument();
  const button = document.createElement("button");
  root.appendChild(button);
  let calls = 0;
  const handler: any = () => calls++;
  handler.call = () => {
    throw new Error("must not use an overridden call property");
  };
  handler.handleEvent = handler.call;
  button.addEventListener("click", handler);
  dispatch({ node: button.uid, type: "click" });
  expect(calls).toBe(1);
  button.removeEventListener("click", handler);
  button.addEventListener("click", {});
  expect(() => dispatch({ node: button.uid, type: "click" })).toThrow(
    "callable handleEvent",
  );
});

test("unsupported signals and primitive callbacks do not leave hidden listeners", () => {
  const { document, root, snapshot, dispatch } = createDocument();
  const button = document.createElement("button");
  root.appendChild(button);
  expect(() =>
    button.addEventListener("click", () => {}, { signal: {} }),
  ).toThrow("native abort adapter");
  expect(() => button.addEventListener("click", 1)).toThrow(TypeError);
  button.addEventListener("click", null);
  button.addEventListener("click", undefined);
  expect(snapshot()[0].events).toEqual([]);
  let calls = 0;
  button.addEventListener("click", () => calls++, { signal: null });
  dispatch({ node: button.uid, type: "click" });
  expect(calls).toBe(1);
});

test("property handlers update in place and null removes the original listener slot", () => {
  const { document, root, dispatch } = createDocument();
  const button = document.createElement("button");
  root.appendChild(button);
  const calls: string[] = [];
  button.addEventListener("click", () => calls.push("before"));
  button.onclick = () => calls.push("old-property");
  button.addEventListener("click", () => calls.push("after"));
  button.onclick = () => calls.push("updated-property");
  dispatch({ node: button.uid, type: "click" });
  expect(calls).toEqual(["before", "updated-property", "after"]);
  calls.length = 0;
  button.onclick = null;
  expect(button.onclick).toBe(null);
  dispatch({ node: button.uid, type: "click" });
  expect(calls).toEqual(["before", "after"]);
  calls.length = 0;
  button.onclick = function (this: any, event: any) {
    expect(this).toBe(event.currentTarget);
    calls.push("reinserted-property");
  };
  dispatch({ node: button.uid, type: "click" });
  expect(calls).toEqual(["before", "after", "reinserted-property"]);
});

test("only event property return false cancels checkbox activation", () => {
  for (const property of [false, true]) {
    const { document, root, dispatch } = createDocument();
    const field = document.createElement("input");
    field.setAttribute("type", "checkbox");
    root.appendChild(field);
    const calls: string[] = [];
    if (property) field.onclick = () => false;
    else field.addEventListener("click", () => false);
    for (const type of ["input", "change"])
      field.addEventListener(type, () => calls.push(type));
    expect(dispatch({ node: field.uid, type: "click" })).toBe(property);
    expect(field.checked).toBe(!property);
    expect(calls).toEqual(property ? [] : ["input", "change"]);
  }
});
