// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import {
  validJavascriptText,
  validateJavascriptZeroHeight,
} from "./javascript-data.ts";
import { createCSSCascade } from "./javascript-css-runtime.js";

/** A Preact DOM adapter backed by native objects, never a browser renderer. */
export function createDocument(resolveFontFamily) {
  let next = 0;
  const css = createCSSCascade();
  const asciiLower = (value) => value.replace(/[A-Z]/g, (c) => c.toLowerCase());
  function domString(value) {
    if (typeof value === "symbol")
      throw new TypeError("A DOM string cannot be a symbol");
    return validJavascriptText(String(value));
  }
  const attributeName = (value) => asciiLower(domString(value));
  function inputType(node, value = node.attrs.type) {
    const type = asciiLower(value ?? "text") || "text";
    if (type !== "text" && type !== "checkbox")
      throw new Error(`Input type ${type} requires a native control adapter`);
    return type;
  }
  const textInput = (node) =>
    node.localName === "input" && inputType(node) === "text";
  const checkboxInput = (node) =>
    node.localName === "input" && inputType(node) === "checkbox";
  const inputValue = (value) => value.replace(/[\r\n]/g, "");
  const textareaValue = (value) => value.replace(/\r\n?/g, "\n");
  const childText = (node) =>
    node.childNodes
      .filter((child) => child.nodeType === 3)
      .map((child) => child.data)
      .join("");
  function changeInputType(node, before, after) {
    if (before === after) return;
    if (after === "checkbox") {
      if (node._value !== "") node.attrs.value = node._value;
    } else {
      node._value = inputValue(node.attrs.value ?? "");
      node._valueDirty = false;
    }
  }
  function captureOption(options) {
    return options !== null &&
      (typeof options === "object" || typeof options === "function")
      ? !!options.capture
      : !!options;
  }
  function addListener(node, type, callback, capture, once, passive) {
    const listeners = (node.listeners[type + capture] ||= []);
    const existing = listeners.find(
      (listener) => listener.callback === callback,
    );
    if (existing) return existing;
    const listener = { callback, capture, once, passive, removed: false };
    listeners.push(listener);
    return listener;
  }
  function removeListener(node, type, listener) {
    listener.removed = true;
    const listeners = node.listeners[type + listener.capture];
    const index = listeners.indexOf(listener);
    if (index >= 0) listeners.splice(index, 1);
  }
  class Element {
    constructor(name, text) {
      this.uid = String(++next);
      this.nodeType = name === "#text" ? 3 : 1;
      this.localName = name;
      this.nodeName = this.tagName = name.toUpperCase();
      this.namespaceURI = "http://www.w3.org/1999/xhtml";
      this.parentNode = null;
      this.childNodes = [];
      this.data = text || "";
      this.attrs = Object.create(null);
      this._stylePriority = Object.create(null);
      this.style = new Proxy(Object.create(null), {
        set: (target, key, value) => {
          delete target[key];
          target[key] = value;
          delete this._stylePriority[key];
          return true;
        },
        deleteProperty: (target, key) => {
          delete target[key];
          delete this._stylePriority[key];
          return true;
        },
      });
      Object.defineProperty(this.style, "setProperty", {
        value: (key, value, priority = "") => {
          if (priority !== "" && String(priority).toLowerCase() !== "important")
            return;
          this.style[key] = value;
          if (priority) this._stylePriority[key] = true;
        },
      });
      this._value = "";
      this._valueDirty = false;
      this._checked = false;
      this._checkedDirty = false;
      this._clickInProgress = false;
      this.listeners = Object.create(null);
      this._propertyHandlers = Object.create(null);
      this._propertyListeners = Object.create(null);
      for (const type of ["click", "input", "change"]) {
        Object.defineProperty(this, "on" + type, {
          get: () => this._propertyHandlers[type] ?? null,
          set: (value) => {
            if (value !== null && typeof value !== "function")
              throw new Error("DOM event properties require functions or null");
            this._propertyHandlers[type] = value;
            const listener = this._propertyListeners[type];
            if (listener && value === null) {
              removeListener(this, type, listener);
              delete this._propertyListeners[type];
            } else if (!listener && value) {
              this._propertyListeners[type] = addListener(
                this,
                type,
                function (event) {
                  const handler = event.currentTarget._propertyHandlers[type];
                  const result = handler
                    ? Reflect.apply(handler, this, [event])
                    : undefined;
                  if (result === false) event.preventDefault();
                  return result;
                },
                false,
                false,
                false,
              );
            }
          },
        });
      }
      return new Proxy(this, {
        get(target, name, receiver) {
          if (
            typeof name === "symbol" ||
            name in target ||
            name === "l" ||
            String(name).startsWith("_")
          )
            return Reflect.get(target, name, receiver);
          throw new Error(
            `DOM property ${String(name)} requires a native adapter`,
          );
        },
        set(target, name, value, receiver) {
          if (
            typeof name === "symbol" ||
            name in target ||
            name === "l" ||
            String(name).startsWith("_")
          )
            return Reflect.set(target, name, value, receiver);
          throw new Error(
            `DOM property ${String(name)} requires a native adapter`,
          );
        },
      });
    }
    get ownerDocument() {
      return document;
    }
    get data() {
      return this._data;
    }
    set data(value) {
      this._data = domString(value === null ? "" : value);
    }
    get value() {
      if (!["input", "textarea", "button"].includes(this.localName))
        throw new Error("DOM value reads require a native control adapter");
      if (checkboxInput(this)) return this.attrs.value ?? "on";
      if (this.localName === "button") return this.attrs.value ?? "";
      if (this.localName === "textarea")
        return textareaValue(this._valueDirty ? this._value : childText(this));
      return this._value;
    }
    set value(value) {
      if (!["input", "textarea", "button"].includes(this.localName))
        throw new Error("DOM value writes require a native control adapter");
      if (value === null && this.localName !== "button") value = "";
      value = domString(value);
      if (this.localName === "button" || checkboxInput(this)) {
        this.setAttribute("value", value);
        return;
      }
      this._value = textInput(this) ? inputValue(value) : value;
      this._valueDirty = true;
    }
    get defaultValue() {
      if (this.localName === "textarea") return childText(this);
      if (this.localName !== "input")
        throw new Error("DOM defaultValue requires a native input or textarea");
      return this.attrs.value ?? "";
    }
    set defaultValue(value) {
      if (this.localName === "textarea") this.textContent = domString(value);
      else if (this.localName === "input") this.setAttribute("value", value);
      else
        throw new Error("DOM defaultValue requires a native input or textarea");
    }
    get disabled() {
      return Object.hasOwn(this.attrs, "disabled");
    }
    set disabled(value) {
      if (!["input", "button", "textarea"].includes(this.localName))
        throw new Error("DOM disabled requires a native control adapter");
      if (value) this.setAttribute("disabled", "");
      else this.removeAttribute("disabled");
    }
    get checked() {
      if (this.localName !== "input")
        throw new Error("DOM checked requires a native checkable control");
      return this._checked;
    }
    set checked(value) {
      if (this.localName !== "input")
        throw new Error("DOM checked requires a native checkable control");
      this._checked = !!value;
      this._checkedDirty = true;
    }
    get defaultChecked() {
      if (this.localName !== "input")
        throw new Error(
          "DOM defaultChecked requires a native checkable control",
        );
      return Object.hasOwn(this.attrs, "checked");
    }
    set defaultChecked(value) {
      if (this.localName !== "input")
        throw new Error(
          "DOM defaultChecked requires a native checkable control",
        );
      if (value) this.setAttribute("checked", "");
      else this.removeAttribute("checked");
    }
    get firstChild() {
      return this.childNodes[0] || null;
    }
    get nextSibling() {
      if (!this.parentNode) return null;
      const siblings = this.parentNode.childNodes;
      return siblings[siblings.indexOf(this) + 1] || null;
    }
    get attributes() {
      return Object.keys(this.attrs).map((name) => ({
        name,
        value: this.attrs[name],
      }));
    }
    get id() {
      return this.attrs.id || "";
    }
    set id(value) {
      this.setAttribute("id", value);
    }
    get className() {
      return this.attrs.class || "";
    }
    set className(value) {
      this.setAttribute("class", value);
    }
    get textContent() {
      return this.nodeType === 3
        ? this.data
        : this.childNodes.map((child) => child.textContent).join("");
    }
    set textContent(value) {
      value = domString(value == null ? "" : value);
      if (this.nodeType === 3) {
        this.data = String(value);
        return;
      }
      for (const child of this.childNodes) child.parentNode = null;
      this.childNodes = [];
      if (value !== "")
        this.appendChild(document.createTextNode(String(value)));
    }
    insertBefore(child, before) {
      if (this.nodeType !== 1) {
        const error = new Error("A text node cannot contain child nodes");
        error.name = "HierarchyRequestError";
        throw error;
      }
      for (let ancestor = this; ancestor; ancestor = ancestor.parentNode) {
        if (ancestor === child) {
          const error = new Error(
            "A node cannot be inserted into itself or its descendant",
          );
          error.name = "HierarchyRequestError";
          throw error;
        }
      }
      if (before != null && before.parentNode !== this) {
        const error = new Error(
          "The reference node is not a child of this parent",
        );
        error.name = "NotFoundError";
        throw error;
      }
      if (child === before) return child;
      if (child.parentNode) child.parentNode.removeChild(child);
      const index =
        before === null || before === undefined
          ? this.childNodes.length
          : this.childNodes.indexOf(before);
      if (index < 0) throw new Error("Invalid DOM insertion reference");
      this.childNodes.splice(index, 0, child);
      child.parentNode = this;
      return child;
    }
    appendChild(child) {
      return this.insertBefore(child, null);
    }
    removeChild(child) {
      const index = this.childNodes.indexOf(child);
      if (index < 0) {
        const error = new Error("The node is not a child of this parent");
        error.name = "NotFoundError";
        throw error;
      }
      this.childNodes.splice(index, 1);
      child.parentNode = null;
      return child;
    }
    remove() {
      if (this.parentNode) this.parentNode.removeChild(this);
    }
    setAttribute(name, value) {
      name = attributeName(name);
      value = domString(value);
      if (!name || /[\0\t\n\f\r /=>]/.test(name)) {
        const error = new Error("Invalid HTML attribute name");
        error.name = "InvalidCharacterError";
        throw error;
      }
      const before =
        name === "type" && this.localName === "input" ? inputType(this) : null;
      const after = before === null ? null : inputType(this, value);
      this.attrs[name] = value;
      if (before !== null) changeInputType(this, before, after);
      if (name === "checked" && !this._checkedDirty) this._checked = true;
      if (name === "value" && textInput(this) && !this._valueDirty)
        this._value = inputValue(this.attrs.value);
    }
    removeAttribute(name) {
      name = attributeName(name);
      const before =
        name === "type" && this.localName === "input" ? inputType(this) : null;
      delete this.attrs[name];
      if (before !== null) changeInputType(this, before, "text");
      if (name === "checked" && !this._checkedDirty) this._checked = false;
      if (name === "value" && textInput(this) && !this._valueDirty)
        this._value = "";
    }
    getAttribute(name) {
      name = attributeName(name);
      return Object.hasOwn(this.attrs, name) ? this.attrs[name] : null;
    }
    hasAttribute(name) {
      return Object.hasOwn(this.attrs, attributeName(name));
    }
    addEventListener(type, handler, options) {
      if (!["click", "input", "change"].includes(type))
        throw new Error(`Event ${type} requires a native event adapter`);
      if (
        handler !== null &&
        handler !== undefined &&
        typeof handler !== "function" &&
        typeof handler !== "object"
      )
        throw new TypeError("DOM event listeners require functions or objects");
      const capture = captureOption(options);
      let once = false,
        passive = false;
      if (
        options !== null &&
        (typeof options === "object" || typeof options === "function")
      ) {
        once = !!options.once;
        passive = !!options.passive;
        if (options.signal != null)
          throw new Error(
            "AbortSignal listeners require a native abort adapter",
          );
      }
      if (handler == null) return;
      addListener(this, type, handler, capture, once, passive);
    }
    removeEventListener(type, handler, options) {
      const key = type + captureOption(options);
      const listener = (this.listeners[key] || []).find(
        (value) => value.callback === handler,
      );
      if (listener) removeListener(this, type, listener);
    }
    focus() {
      throw new Error("Programmatic focus requires a native focus adapter");
    }
    click() {
      if (this.disabled || this._clickInProgress) return;
      this._clickInProgress = true;
      try {
        dispatch({ node: this.uid, type: "click" });
      } finally {
        this._clickInProgress = false;
      }
    }
    getBoundingClientRect() {
      throw new Error("DOM measurements require a native layout adapter");
    }
    get innerHTML() {
      throw new Error("HTML serialization requires a DOM adapter");
    }
    set innerHTML(value) {
      throw new Error("Raw HTML requires a native rich-text adapter");
    }
  }
  const document = {
    createElement: (name) => new Element(asciiLower(domString(name))),
    createElementNS: (namespace, name) => {
      if (namespace !== "http://www.w3.org/1999/xhtml")
        throw new Error("SVG and other namespaces require a native adapter");
      return new Element(name);
    },
    createTextNode: (text) => new Element("#text", String(text)),
    getElementById: (id) => {
      id = domString(id);
      return id
        ? find(
            (node) => node.nodeType === 1 && node.id === id,
            document.documentElement,
          )
        : null;
    },
    get activeElement() {
      return document.body;
    },
  };
  document.documentElement = document.createElement("html");
  document.body = document.createElement("body");
  document.documentElement.appendChild(document.body);
  const root = document.createElement("div");
  root.id = "astro-fyne-root";
  document.body.appendChild(root);
  function find(predicate, start = root) {
    function walk(node) {
      if (predicate(node)) return node;
      for (const child of node.childNodes) {
        const found = walk(child);
        if (found) return found;
      }
      return null;
    }
    return walk(start);
  }
  function snapshot(node, inheritedStyle) {
    if (node.nodeType === 3)
      return { uid: node.uid, tag: "#text", text: node.data };
    const resolved = css.active ? css.compute(node, inheritedStyle) : null;
    if (!resolved && Object.keys(node._stylePriority).length)
      throw new Error(
        "Inline CSS priorities require the stylesheet cascade adapter",
      );
    const frame = {
      uid: node.uid,
      tag: node.localName,
      attrs: { ...node.attrs },
      style: resolved ? resolved.style : { ...node.style },
      ...(resolved ? { css: true } : {}),
      value: ["input", "textarea", "button"].includes(node.localName)
        ? node.value
        : String(node._value),
      ...(checkboxInput(node) ? { checked: node._checked } : {}),
      disabled: !!node.disabled,
      events: Object.keys(node.listeners).filter(
        (key) => node.listeners[key].length,
      ),
      children: node.childNodes.map((child) => snapshot(child, resolved)),
    };
    if (
      resolveFontFamily &&
      frame.style.fontFamily !== undefined &&
      frame.style.fontFamily !== ""
    )
      frame.style = {
        ...frame.style,
        fontFamily: resolveFontFamily(frame.style.fontFamily),
      };
    validateJavascriptZeroHeight(frame);
    return frame;
  }
  function dispatch(event, activatingTarget) {
    const target = activatingTarget ?? find((node) => node.uid === event.node);
    if (!target) throw new Error("Cannot dispatch to a missing native element");
    if (!["click", "input", "change"].includes(event.type))
      throw new Error("Unsupported native event");
    if (target.disabled && !activatingTarget)
      throw new Error("Cannot dispatch to a disabled element");
    if (event.value !== undefined) target.value = String(event.value);
    const checkboxClick = event.type === "click" && checkboxInput(target);
    const wasChecked = target._checked;
    if (checkboxClick) target.checked = !wasChecked;
    const path = [];
    for (let node = target; node; node = node.parentNode) path.push(node);
    let stopped = false,
      immediate = false,
      passive = false,
      canceled = false,
      currentTarget = null,
      eventPhase = 0;
    const cancelable = event.type === "click";
    const payload = new Proxy(
      {
        get type() {
          return event.type;
        },
        get target() {
          return target;
        },
        get currentTarget() {
          return currentTarget;
        },
        get eventPhase() {
          return eventPhase;
        },
        get bubbles() {
          return true;
        },
        get cancelable() {
          return cancelable;
        },
        get defaultPrevented() {
          return canceled;
        },
        get cancelBubble() {
          return stopped;
        },
        set cancelBubble(value) {
          if (value) stopped = true;
        },
        get returnValue() {
          return !canceled;
        },
        set returnValue(value) {
          if (!value && cancelable && !passive) canceled = true;
        },
        preventDefault() {
          if (cancelable && !passive) canceled = true;
        },
        stopPropagation() {
          stopped = true;
        },
        stopImmediatePropagation() {
          stopped = immediate = true;
        },
      },
      {
        get(target, name, receiver) {
          if (
            typeof name === "symbol" ||
            name in target ||
            String(name).startsWith("_")
          )
            return Reflect.get(target, name, receiver);
          throw new Error(
            `Event property ${String(name)} requires a native event adapter`,
          );
        },
      },
    );
    function invoke(node, capture) {
      currentTarget = node;
      eventPhase = node === target ? 2 : capture ? 1 : 3;
      for (const listener of [
        ...(node.listeners[event.type + capture] || []),
      ]) {
        if (listener.removed) continue;
        if (listener.once) removeListener(node, event.type, listener);
        passive = listener.passive;
        try {
          const callback = listener.callback;
          const handler =
            typeof callback === "function" ? callback : callback.handleEvent;
          if (typeof handler !== "function")
            throw new Error(
              "DOM listener objects require a callable handleEvent",
            );
          const result = Reflect.apply(
            handler,
            typeof callback === "function" ? node : callback,
            [payload],
          );
          if (result instanceof Promise)
            throw new Error(
              "Async event handlers require an explicit event-loop adapter",
            );
        } finally {
          passive = false;
        }
        if (immediate) break;
      }
    }
    try {
      for (const node of [...path].reverse()) {
        invoke(node, true);
        if (stopped) break;
      }
      if (!stopped)
        for (const node of path) {
          invoke(node, false);
          if (stopped) break;
        }
    } finally {
      currentTarget = null;
      eventPhase = 0;
      stopped = immediate = passive = false;
    }
    if (checkboxClick) {
      if (payload.defaultPrevented) target._checked = wasChecked;
      else {
        dispatch({ node: target.uid, type: "input" }, target);
        dispatch({ node: target.uid, type: "change" }, target);
      }
    }
    if (
      event.type === "click" &&
      target.localName === "label" &&
      target.attrs.for &&
      !payload.defaultPrevented
    ) {
      const control = find((node) => node.id === target.attrs.for);
      if (control && !control.disabled) {
        if (checkboxInput(control))
          dispatch({ node: control.uid, type: "click" });
        else if (["input", "textarea", "button"].includes(control.localName))
          throw new Error(
            `Label activation for <${control.localName}> requires a native focus/activation adapter or preventDefault()`,
          );
      }
    }
    if (
      target.localName === "a" &&
      target.attrs.href &&
      !payload.defaultPrevented
    )
      throw new Error(
        "Link navigation requires a named platform action and preventDefault()",
      );
    return payload.defaultPrevented;
  }
  return {
    document,
    root,
    snapshot: () => {
      css.begin(root);
      const inheritedStyle = css.active
        ? css.compute(
            root,
            css.compute(document.body, css.compute(document.documentElement)),
          )
        : null;
      const frames = root.childNodes.map((child) =>
        snapshot(child, inheritedStyle),
      );
      css.end();
      return frames;
    },
    installCSS: css.install,
    animationState: css.animationState,
    restoreAnimationState: css.restoreAnimationState,
    advanceAnimations: css.advanceAnimations,
    pauseAnimations: css.pauseAnimations,
    playAnimations: css.playAnimations,
    dispatch,
  };
}
