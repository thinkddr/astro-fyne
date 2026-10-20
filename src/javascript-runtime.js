// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { createDocument } from "./javascript-dom.js";
import {
  javascriptHostJSON,
  javascriptUTF8Bytes,
  validateJavascriptAnimationState,
} from "./javascript-data.ts";

/** Recorded host boundaries let replay rebuild closures and module state. */
export function createRuntime(host, archive, resolveFontFamily) {
  const animated = archive.schema === 2,
    restoredAnimation = animated
      ? validateJavascriptAnimationState(archive.animation)
      : null;
  const dom = createDocument(resolveFontFamily),
    queue = [],
    events = [],
    journal = [];
  let replaying = true,
    cursor = 0,
    draining = false,
    failed = false,
    dispatching = false;
  const stored = archive.journal || [];
  const restoring =
    archive.frame !== undefined ||
    stored.length > 0 ||
    archive.events?.length > 0;
  const json = javascriptHostJSON;
  let journalBytes = 0;
  function boundary(kind, name, args) {
    const request = { kind, name, args: json(args) };
    let entry;
    if (replaying && cursor < stored.length) {
      entry = stored[cursor++];
      if (
        entry.kind !== kind ||
        entry.name !== name ||
        entry.args !== request.args
      )
        throw new Error("JavaScript replay diverged at a host boundary");
    } else {
      if (replaying && restoring)
        throw new Error("JavaScript replay exhausted its host journal");
      let result;
      try {
        result = { value: json(host(kind, name, request.args)) };
      } catch (error) {
        result = { error: String(error?.message || error) };
      }
      entry = { ...request, ...result };
    }
    if (journal.length >= 100000)
      throw new Error("JavaScript journal exceeds its entry limit");
    journalBytes += javascriptUTF8Bytes(JSON.stringify(entry));
    if (journalBytes > 16 * 1024 * 1024)
      throw new Error("JavaScript journal exceeds 16MiB");
    journal.push(entry);
    if (entry.error !== undefined) throw new Error(entry.error);
    return JSON.parse(entry.value);
  }
  function enqueue(callback) {
    if (typeof callback !== "function")
      throw new Error("Scheduled work requires a function");
    const item = { callback, cancelled: false };
    queue.push(item);
    return item;
  }
  function drain() {
    if (draining) return;
    draining = true;
    try {
      let count = 0;
      while (queue.length) {
        if (++count > 1000)
          throw new Error("JavaScript effect queue exceeds its limit");
        const item = queue.shift();
        if (!item.cancelled) item.callback();
      }
    } finally {
      draining = false;
    }
  }
  const now = () => boundary("now", "", []);
  const PortableMath = Object.create(
    Object.getPrototypeOf(Math),
    Object.getOwnPropertyDescriptors(Math),
  );
  PortableMath.random = () => boundary("random", "", []);
  function PortableDate(...args) {
    if (new.target) {
      const value = new Date(...(args.length ? args : [now()]));
      Object.setPrototypeOf(value, new.target.prototype);
      return value;
    }
    return new Date(now()).toString();
  }
  PortableDate.prototype = Object.create(Object.getPrototypeOf(Date.prototype));
  Object.defineProperties(
    PortableDate.prototype,
    Object.getOwnPropertyDescriptors(Date.prototype),
  );
  Object.defineProperty(PortableDate.prototype, "constructor", {
    value: PortableDate,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(PortableDate, "name", {
    value: "Date",
    configurable: true,
  });
  Object.defineProperty(PortableDate, "length", {
    value: 7,
    configurable: true,
  });
  PortableDate.now = now;
  PortableDate.parse = Date.parse;
  PortableDate.UTC = Date.UTC;
  const dateDescriptors = Object.getOwnPropertyDescriptors(Date);
  delete dateDescriptors.prototype;
  dateDescriptors.now.value = now;
  Object.defineProperties(PortableDate, dateDescriptors);
  Object.defineProperty(PortableDate, "prototype", { writable: false });
  const unsupported = (name) => () => {
    throw new Error(`${name} requires an explicit platform adapter`);
  };
  const environment = {
    _afyCssInstall: dom.installCSS,
    Object,
    Function,
    Array,
    String,
    Number,
    Boolean,
    Symbol,
    RegExp,
    JSON,
    Map,
    Set,
    WeakMap,
    WeakSet,
    Promise,
    Proxy,
    Reflect,
    Error,
    EvalError,
    RangeError,
    ReferenceError,
    SyntaxError,
    TypeError,
    URIError,
    ArrayBuffer,
    DataView,
    Uint8Array,
    Uint8ClampedArray,
    Uint16Array,
    Uint32Array,
    Int8Array,
    Int16Array,
    Int32Array,
    Float32Array,
    Float64Array,
    parseInt,
    parseFloat,
    isFinite,
    isNaN,
    decodeURI,
    decodeURIComponent,
    encodeURI,
    encodeURIComponent,
    NaN,
    Infinity,
    undefined,
    document: dom.document,
    Math: PortableMath,
    Date: PortableDate,
    setTimeout(callback, delay = 0) {
      if (delay !== 0)
        throw new Error(
          "Delayed timers require an explicit event-loop adapter",
        );
      return enqueue(callback);
    },
    clearTimeout(item) {
      if (item) item.cancelled = true;
    },
    requestAnimationFrame: (callback) => enqueue(() => callback(now())),
    cancelAnimationFrame(item) {
      if (item) item.cancelled = true;
    },
    queueMicrotask: enqueue,
    fetch: unsupported("fetch"),
    setInterval: unsupported("setInterval"),
    getComputedStyle: unsupported("getComputedStyle"),
    console: {
      log: unsupported("console.log"),
      warn: unsupported("console.warn"),
      error: unsupported("console.error"),
    },
  };
  const globals = new Proxy(environment, {
    get(target, name, receiver) {
      if (typeof name === "symbol" || name in target)
        return Reflect.get(target, name, receiver);
      throw new Error(
        `Global ${String(name)} requires an explicit platform adapter`,
      );
    },
  });
  environment.window = environment.globalThis = environment.self = globals;
  return {
    environment,
    bind(entry, preact) {
      if (typeof entry !== "function")
        throw new Error("JavaScript entry must be a component function");
      preact.options.debounceRendering = enqueue;
      preact.options.requestAnimationFrame = enqueue;
      const props = JSON.parse(json(archive.props || {}));
      for (const name of archive.actions || []) {
        if (Object.hasOwn(props, name))
          throw new Error("Action names cannot replace data props");
        Object.defineProperty(props, name, {
          value: (...args) => boundary("action", name, args),
          enumerable: true,
        });
      }
      const dispatch = (event) => {
        const prevented = dom.dispatch(event);
        drain();
        if (animated) dom.snapshot();
        return prevented;
      };
      try {
        preact.render(
          preact.h(
            entry,
            entry._afyAstroEntry ? { _afyAstroProps: props } : props,
          ),
          dom.root,
        );
        drain();
        if (animated) dom.snapshot();
      } catch (error) {
        failed = true;
        throw error;
      }
      const api = {
        snapshot: dom.snapshot,
        flush: drain,
        replay(event) {
          if (!replaying) throw new Error("Replay is already complete");
          if (animated) {
            if (
              typeof event.timeMs !== "number" ||
              !Number.isFinite(event.timeMs) ||
              event.timeMs < dom.animationState().timeMs ||
              event.timeMs > restoredAnimation.timeMs
            )
              throw new Error("Invalid animation event replay time");
            dom.advanceAnimations(event.timeMs);
          }
          dispatch(event);
          events.push(event);
        },
        finishReplay() {
          if (cursor !== stored.length)
            throw new Error("JavaScript replay left unconsumed host results");
          if (animated) dom.restoreAnimationState(restoredAnimation);
          if (
            archive.frame &&
            JSON.stringify(dom.snapshot()) !== JSON.stringify(archive.frame)
          )
            throw new Error("JavaScript replay changed the exported frame");
          replaying = false;
        },
        dispatch(event) {
          if (failed)
            throw new Error(
              "JavaScript program is invalid after an earlier error",
            );
          if (events.length >= 10000)
            throw new Error("JavaScript history exceeds 10000 events");
          dispatching = true;
          try {
            const prevented = dispatch(event);
            events.push(
              JSON.parse(
                json(
                  animated
                    ? { ...event, timeMs: dom.animationState().timeMs }
                    : event,
                ),
              ),
            );
            return prevented;
          } catch (error) {
            failed = true;
            throw error;
          } finally {
            dispatching = false;
          }
        },
        export() {
          if (failed || queue.length || dispatching || replaying)
            throw new Error("Export requires a valid settled JavaScript frame");
          return {
            ...archive,
            events: [...events],
            journal: [...journal],
            frame: dom.snapshot(),
            ...(animated ? { animation: dom.animationState() } : {}),
          };
        },
        dispose() {
          preact.render(null, dom.root);
          drain();
          failed = true;
        },
      };
      if (animated)
        Object.assign(api, {
          animationState: dom.animationState,
          advanceAnimations(timeMs) {
            if (replaying || failed || dispatching || queue.length)
              throw new Error(
                "Animation ticks require a valid settled program",
              );
            dom.advanceAnimations(timeMs);
            dom.snapshot();
          },
          pauseAnimations() {
            if (replaying || failed || dispatching || queue.length)
              throw new Error(
                "Animation controls require a valid settled program",
              );
            dom.pauseAnimations();
          },
          playAnimations() {
            if (replaying || failed || dispatching || queue.length)
              throw new Error(
                "Animation controls require a valid settled program",
              );
            dom.playAnimations();
          },
        });
      return api;
    },
  };
}
