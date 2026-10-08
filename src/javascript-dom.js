// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import { validJavascriptText } from "./javascript-data.ts";

/** A Preact DOM adapter backed by native objects, never a browser renderer. */
export function createDocument() {
  let next = 0;
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
      this.style = Object.create(null);
      Object.defineProperty(this.style, "setProperty", {
        value: (key, value) => {
          this.style[key] = value;
        },
      });
      this._value = "";
      this._valueDirty = false;
      this.disabled = false;
      this.listeners = {};
      this._propertyHandlers = {};
      for (const type of ["click", "input", "change"]) {
        let installed = false;
        Object.defineProperty(this, "on" + type, {
          get: () => this._propertyHandlers[type] ?? null,
          set: (value) => {
            if (value !== null && typeof value !== "function")
              throw new Error("DOM event properties require functions or null");
            this._propertyHandlers[type] = value;
            if (!installed && value) {
              installed = true;
              this.addEventListener(
                type,
                (event) => this._propertyHandlers[type]?.call(this, event),
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
      this._data = validJavascriptText(String(value));
    }
    get value() {
      if (!["input", "textarea", "button"].includes(this.localName))
        throw new Error("DOM value reads require a native control adapter");
      return this._value;
    }
    set value(value) {
      this._value = validJavascriptText(String(value));
      this._valueDirty = true;
    }
    get defaultValue() {
      return this.attrs.value ?? "";
    }
    set defaultValue(value) {
      this.attrs.value = validJavascriptText(String(value));
      if (!this._valueDirty) this._value = this.attrs.value;
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
      if (index < 0) throw new Error("Cannot remove a detached DOM element");
      this.childNodes.splice(index, 1);
      child.parentNode = null;
      return child;
    }
    remove() {
      if (this.parentNode) this.parentNode.removeChild(this);
    }
    setAttribute(name, value) {
      this.attrs[name] = validJavascriptText(String(value));
    }
    removeAttribute(name) {
      delete this.attrs[name];
    }
    getAttribute(name) {
      return Object.hasOwn(this.attrs, name) ? this.attrs[name] : null;
    }
    addEventListener(type, handler, capture) {
      if (!["click", "input", "change"].includes(type))
        throw new Error(`Event ${type} requires a native event adapter`);
      (this.listeners[type + !!capture] ||= []).push(handler);
    }
    removeEventListener(type, handler, capture) {
      const key = type + !!capture;
      this.listeners[key] = (this.listeners[key] || []).filter(
        (value) => value !== handler,
      );
    }
    focus() {
      throw new Error("Programmatic focus requires a native focus adapter");
    }
    click() {
      if (!this.disabled) dispatch({ node: this.uid, type: "click" });
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
    createElement: (name) => new Element(name),
    createElementNS: (namespace, name) => {
      if (namespace !== "http://www.w3.org/1999/xhtml")
        throw new Error("SVG and other namespaces require a native adapter");
      return new Element(name);
    },
    createTextNode: (text) => new Element("#text", String(text)),
    getElementById: (id) => find((node) => node.id === id),
    get activeElement() {
      return document.body;
    },
  };
  document.body = document.createElement("body");
  const root = document.createElement("div");
  root.id = "astro-fyne-root";
  document.body.appendChild(root);
  function find(predicate) {
    function walk(node) {
      if (predicate(node)) return node;
      for (const child of node.childNodes) {
        const found = walk(child);
        if (found) return found;
      }
      return null;
    }
    return walk(root);
  }
  function snapshot(node) {
    if (node.nodeType === 3)
      return { uid: node.uid, tag: "#text", text: node.data };
    return {
      uid: node.uid,
      tag: node.localName,
      attrs: node.attrs,
      style: { ...node.style },
      value: String(node._value),
      disabled: !!node.disabled,
      events: Object.keys(node.listeners).filter(
        (key) => node.listeners[key].length,
      ),
      children: node.childNodes.map(snapshot),
    };
  }
  function dispatch(event) {
    const target = find((node) => node.uid === event.node);
    if (!target) throw new Error("Cannot dispatch to a missing native element");
    if (!["click", "input", "change"].includes(event.type))
      throw new Error("Unsupported native event");
    if (target.disabled)
      throw new Error("Cannot dispatch to a disabled element");
    if (event.value !== undefined) target.value = String(event.value);
    const path = [];
    for (let node = target; node; node = node.parentNode) path.push(node);
    let stopped = false,
      immediate = false;
    const payload = new Proxy(
      {
        type: event.type,
        target,
        currentTarget: null,
        bubbles: true,
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true;
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
      payload.currentTarget = node;
      for (const handler of [...(node.listeners[event.type + capture] || [])]) {
        const result = handler.call(node, payload);
        if (result && typeof result.then === "function")
          throw new Error(
            "Async event handlers require an explicit event-loop adapter",
          );
        if (immediate) break;
      }
    }
    for (const node of [...path].reverse()) {
      invoke(node, true);
      if (stopped) break;
    }
    if (!stopped)
      for (const node of path) {
        invoke(node, false);
        if (stopped) break;
      }
    payload.currentTarget = null;
    if (
      target.localName === "a" &&
      target.attrs.href &&
      !payload.defaultPrevented
    )
      throw new Error(
        "Link navigation requires a named platform action and preventDefault()",
      );
  }
  return {
    document,
    root,
    snapshot: () => root.childNodes.map(snapshot),
    dispatch,
  };
}
