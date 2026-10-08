// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import {
  h,
  Fragment,
  cloneElement,
  type ComponentChildren,
  type VNode,
} from "preact";
import { forwardRef } from "preact/compat";
import {
  useState,
  useRef,
  useLayoutEffect,
  useImperativeHandle,
} from "preact/hooks";
import type { Component, Expr, Handler, Node, Program } from "./ir.ts";
import {
  decodeProgramData,
  encodeProgramData,
  type ProgramValue,
} from "./program-values.ts";

type Data = Record<string, any>;
export type ProgramActions = Record<string, (...args: any[]) => any>;
export interface PortableArchive {
  schema: 1;
  kind: "astro-fyne-program";
  sourceHash: string;
  programHash: string;
  program: string;
  props: ProgramValue;
  state: ProgramValue;
}
export interface ProgramHandle {
  exportProgram(): PortableArchive;
}
export interface ProgramProps {
  props?: Data;
  actions?: ProgramActions;
}
interface Context {
  props: Data;
  seed: Data;
  state: Data;
  owners: Map<string, object>;
  dirty: Set<object>;
  editors: Map<HTMLInputElement | HTMLTextAreaElement, string>;
  actions: ProgramActions;
  mounted: boolean;
  overrides?: Data;
  error?: unknown;
}

/** Match the native property boundary without evaluating code or host getters. */
function get(value: any, key: any): any {
  if (value === null || value === undefined)
    throw new Error("Cannot read a nullish value");
  if (
    typeof value === "function" ||
    (typeof value === "object" &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  )
    throw new Error("Property reads on host values require an adapter");
  const name = String(key),
    boxed = Object(value);
  const descriptor = Object.getOwnPropertyDescriptor(boxed, name);
  if (descriptor) {
    if (!("value" in descriptor))
      throw new Error("Property accessors require an adapter");
    const result = descriptor.value;
    if (
      typeof value === "string" &&
      typeof result === "string" &&
      result.length === 1 &&
      /[\ud800-\udfff]/.test(result)
    )
      throw new Error("Isolated UTF-16 string units require an adapter");
    return result;
  }
  if (name in boxed || name in Object.prototype)
    throw new Error("Inherited intrinsic properties require an adapter");
  return undefined;
}

export function programExpression(
  value: Expr,
  scope: Data,
  actions: ProgramActions,
  current: Data = {},
): any {
  const e = (v: Expr) => programExpression(v, scope, actions, current);
  switch (value.kind) {
    case "undefined":
      return undefined;
    case "literal":
      return value.value;
    case "name":
      return get(scope, value.name);
    case "current":
      return get(current, value.name);
    case "get":
      return get(e(value.object), e(value.key));
    case "chain": {
      let result = e(value.object);
      for (const access of value.accesses) {
        if (access.optional && (result === null || result === undefined))
          return undefined;
        result = get(result, e(access.key));
      }
      return result;
    }
    case "unary": {
      const result = e(value.value);
      if (value.op === "!") return !result;
      if (value.op === "+") return +result;
      if (value.op === "-") return -result;
      throw new Error("Unsupported unary operator");
    }
    case "binary": {
      const left = e(value.left);
      if (value.op === "&&") return left && e(value.right);
      if (value.op === "||") return left || e(value.right);
      if (value.op === "??") return left ?? e(value.right);
      const right = e(value.right);
      switch (value.op) {
        case "+":
          return left + right;
        case "-":
          return left - right;
        case "*":
          return left * right;
        case "/":
          return left / right;
        case "%":
          return left % right;
        case "===":
          return left === right;
        case "!==":
          return left !== right;
        case "<":
          return left < right;
        case "<=":
          return left <= right;
        case ">":
          return left > right;
        case ">=":
          return left >= right;
        default:
          throw new Error("Unsupported binary operator");
      }
    }
    case "conditional":
      return e(value.test) ? e(value.yes) : e(value.no);
    case "array":
      return value.items.map(e);
    case "object": {
      const out: Data = {};
      for (const key of value.order ?? Object.keys(value.entries))
        Object.defineProperty(out, key, {
          value: e(value.entries[key]!),
          writable: true,
          enumerable: true,
          configurable: true,
        });
      return out;
    }
    case "template":
      return value.parts.map((part) => String(e(part))).join("");
    case "call": {
      const args = value.args.map(e);
      if (value.name === "String") return String(args[0]);
      if (value.name === "Number") return Number(args[0]);
      if (value.name === "Boolean") return Boolean(args[0]);
      return actions[value.name]!(...args);
    }
  }
}

function child(value: any): ComponentChildren {
  if (value === null || value === undefined || typeof value === "boolean")
    return null;
  if (typeof value === "string" || typeof value === "number") return value;
  if (Array.isArray(value)) return value.map(child);
  throw new Error("Object or function children require an adapter");
}
function group(values: ComponentChildren[]): ComponentChildren {
  return values.length === 1
    ? values[0]
    : values.length
      ? h(Fragment, null, values)
      : null;
}

/** Real Preact hooks/reconciliation run the validated declarative program. */
export function createProgramComponent(
  program: Program,
  archive: PortableArchive,
  images: Record<string, string> = {},
) {
  const components = new Map<
    string,
    (input: {
      data: Data;
      context: Context;
      prefix: string;
    }) => ComponentChildren
  >();
  function define(component: Component) {
    return function Generated(input: {
      data: Data;
      context: Context;
      prefix: string;
    }): ComponentChildren {
      const { data, context: ctx, prefix } = input;
      const owner = useRef<object>({}).current;
      const pending = useRef<Set<string>>(new Set());
      const owned = new Set<string>();
      const previous = useRef<Set<string>>(new Set());
      const claim = (slot: string) => {
        owned.add(slot);
        ctx.owners.set(slot, owner);
      };
      const scope: Data = Object.assign(Object.create(null), data);
      if (component.propsObject) scope[component.propsObject] = data;
      const setters: Record<string, (value: any) => void> = Object.create(null);
      const e = (value: Expr, local = scope, current: Data = {}) =>
        programExpression(value, local, ctx.actions, current);
      for (const initializer of component.initializers) {
        if (initializer.kind === "constant") {
          scope[initializer.name] = e(
            component.constants.find(
              (value) => value.name === initializer.name,
            )!.value,
          );
          continue;
        }
        const state = component.states.find(
          (value) => value.name === initializer.name,
        )!;
        const slot = prefix + "/" + component.name + "/" + state.name;
        const [value, set] = useState<any>(() => {
          if (Object.hasOwn(ctx.seed, slot)) {
            const seed = ctx.seed[slot];
            delete ctx.seed[slot];
            return seed;
          }
          return e(state.initial);
        });
        scope[state.name] = value;
        ctx.state[slot] = value;
        claim(slot);
        setters[state.name] = (next) =>
          set((prior: any) => {
            const result = typeof next === "function" ? next(prior) : next;
            if (Object.is(value, result)) pending.current.delete(state.name);
            else pending.current.add(state.name);
            if (pending.current.size) ctx.dirty.add(owner);
            else ctx.dirty.delete(owner);
            return result;
          });
      }
      const release = (slots: Iterable<string>) => {
        for (const slot of slots)
          if (ctx.owners.get(slot) === owner) {
            ctx.owners.delete(slot);
            delete ctx.state[slot];
            delete ctx.seed[slot];
          }
      };
      useLayoutEffect(() => {
        release([...previous.current].filter((slot) => !owned.has(slot)));
        previous.current = owned;
        pending.current.clear();
        ctx.dirty.delete(owner);
      });
      useLayoutEffect(
        () => () => {
          release(previous.current);
          ctx.dirty.delete(owner);
        },
        [],
      );

      const handler = (event: Handler, local: Data) => (dom: Event) => {
        const fixed: Data = Object.assign(Object.create(null), local);
        if (event.parameter) {
          const value = (dom.currentTarget as HTMLInputElement).value;
          fixed[event.parameter] = {
            currentTarget: { value },
            target: { value },
          };
        }
        try {
          for (const step of event.steps) {
            if (step.kind === "call")
              ctx.actions[step.name]!(
                ...step.args.map((value) => e(value, fixed)),
              );
            else if (step.updater)
              setters[step.name]!((prior: any) =>
                e(step.args[0]!, fixed, { [step.name]: prior }),
              );
            else setters[step.name]!(e(step.args[0]!, fixed));
          }
        } catch (error) {
          ctx.error = error;
          throw error;
        }
      };
      const render = (
        node: Node,
        local: Data,
        path: string,
      ): ComponentChildren => {
        if (node.kind === "text") return child(e(node.value, local));
        if (node.kind === "conditional") {
          const result = e(node.test, local);
          if (node.shortCircuit && !result)
            return node.no.length ? child(result) : null;
          return renderMany(result ? node.yes : node.no, local, path);
        }
        if (node.kind === "component") {
          const props = Object.fromEntries(
            Object.entries(node.props).map(([key, val]) => [
              key,
              e(val, local),
            ]),
          );
          return h(components.get(node.name)!, {
            data: props,
            context: ctx,
            prefix: path + "/" + (node.identity ?? node.id),
          });
        }
        if (node.kind === "each") {
          const items = e(node.items, local);
          if (!Array.isArray(items))
            throw new Error("List items must be an array");
          const site = path + "/" + node.id,
            seen = new Set<string>();
          let kind: number | undefined;
          const entries = items.map((item, index) => {
            const next: Data = Object.assign(Object.create(null), local);
            next[node.item] = item;
            if (node.index) next[node.index] = index;
            const key = node.key ? e(node.key, next) : index;
            let identity = "i" + index;
            if (node.key) {
              const type =
                typeof key === "string"
                  ? 115
                  : typeof key === "number" && Number.isFinite(key)
                    ? 110
                    : undefined;
              if (!type)
                throw new Error("List key must be a string or finite number");
              if (kind !== undefined && kind !== type)
                throw new Error("Mixed scalar list keys require an adapter");
              kind = type;
              // encodeProgramData also validates paired Unicode; do not coerce string keys.
              encodeProgramData({ key }, {});
              identity =
                String.fromCharCode(type) +
                Array.from(new TextEncoder().encode(String(key)), (byte) =>
                  byte.toString(16).padStart(2, "0"),
                ).join("");
              if (seen.has(identity))
                throw new Error("Duplicate sibling list key");
              seen.add(identity);
            }
            return { next, key, identity };
          });
          if (node.key) {
            const slot = site + "/@key-kind";
            claim(slot);
            if (kind !== undefined) {
              if (Object.hasOwn(ctx.state, slot) && ctx.state[slot] !== kind)
                throw new Error(
                  "Changing scalar list key kind requires an adapter",
                );
              ctx.state[slot] = kind;
            }
          }
          return entries.map(({ next, key, identity }) => {
            const value = renderMany(
              node.children,
              next,
              site + "/" + identity,
            );
            if (!node.key) return value;
            return value && typeof value === "object" && !Array.isArray(value)
              ? cloneElement(value as VNode, { key })
              : h(Fragment, { key }, value);
          });
        }
        const attrs: Data = {};
        for (const [key, value] of Object.entries(node.attrs))
          if (key !== "key" && !key.startsWith("client:"))
            attrs[key] = e(value, local);
        if (node.imageResource) attrs.src = images[node.imageResource];
        for (const [key, event] of Object.entries(node.events))
          attrs[key] = handler(event, local);
        if (node.tag === "input" || node.tag === "textarea") {
          let prior: HTMLInputElement | HTMLTextAreaElement | null = null;
          attrs.ref = (
            element: HTMLInputElement | HTMLTextAreaElement | null,
          ) => {
            if (prior) ctx.editors.delete(prior);
            if (element) ctx.editors.set(element, String(attrs.value ?? ""));
            prior = element;
          };
        }
        return h(
          node.tag,
          attrs,
          ...node.children.map((n) => render(n, local, path)),
        );
      };
      const renderMany = (nodes: Node[], local: Data, path: string) =>
        group(nodes.map((node) => render(node, local, path)));
      try {
        return renderMany(component.body, scope, prefix);
      } catch (error) {
        ctx.error = error;
        throw error;
      }
    };
  }
  for (const component of program.components)
    components.set(component.name, define(component));
  return forwardRef<ProgramHandle, ProgramProps>(
    function ProgramRoot(input, ref) {
      const context = useRef<Context>();
      if (!context.current) {
        const actions = input.actions ?? {};
        for (const name of program.actions)
          if (
            !Object.hasOwn(actions, name) ||
            typeof actions[name] !== "function"
          )
            throw new Error(`Program requires named action ${name}`);
        const data = decodeProgramData(archive.props, archive.state, actions);
        Object.assign(data.props, input.props ?? {});
        context.current = {
          props: data.props,
          seed: { ...data.state },
          state: data.state,
          owners: new Map(),
          dirty: new Set(),
          editors: new Map(),
          actions,
          mounted: false,
          overrides: input.props,
        };
      }
      const ctx = context.current;
      if (input.props !== ctx.overrides)
        throw new Error(
          "Program props are initial overrides; remount to replace them",
        );
      if ((input.actions ?? ctx.actions) !== ctx.actions)
        throw new Error(
          "Program action bindings must remain stable while mounted",
        );
      useLayoutEffect(() => {
        for (const slot of Object.keys(ctx.state))
          if (!ctx.owners.has(slot)) {
            delete ctx.state[slot];
            delete ctx.seed[slot];
          }
        ctx.mounted = true;
        return () => {
          ctx.mounted = false;
        };
      }, []);
      useImperativeHandle(ref, () => ({
        exportProgram() {
          if (!ctx.mounted || ctx.dirty.size || ctx.error)
            throw new Error(
              "Export requires a committed, valid program render",
            );
          for (const [element, value] of ctx.editors)
            if (element.isConnected && element.value !== value)
              throw new Error(
                "Commit editor values into declared state before exporting",
              );
          if (
            typeof document !== "undefined" &&
            document.activeElement &&
            document.activeElement !== document.body &&
            document.activeElement !== document.documentElement
          )
            throw new Error(
              "Export an unfocused program; focus/caret/selection are not portable state",
            );
          return {
            ...archive,
            ...encodeProgramData(ctx.props, ctx.state, program.actions),
          };
        },
      }));
      return h(components.get(program.entry)!, {
        data: ctx.props,
        context: ctx,
        prefix: "",
      });
    },
  );
}
