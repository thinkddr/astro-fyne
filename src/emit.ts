// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import type { Component, Expr, Handler, Node, Program } from "./ir.js";

export interface Measurements {
  schema: 1;
  sourceHash: string;
  state: string;
  viewport: { width: number; height: number; scale: number };
  nodes: Record<string, Record<string, string | number | boolean>>;
  tokens?: Record<string, string>;
}

export function sourceHash(program: Program): string {
  return createHash("sha256")
    .update(JSON.stringify(program.sources))
    .digest("hex");
}

const quote = (value: string): string =>
  JSON.stringify(value).replaceAll("\\u2028", "\\u2028");
const identifier = /^[A-Za-z][A-Za-z0-9_]*$/;
const runtime = "github.com/thinkddr/astro-fyne/native";

function expression(value: Expr, scope = "scope"): string {
  switch (value.kind) {
    case "undefined":
      return "webui.Undefined";
    case "literal":
      return value.value === null
        ? "nil"
        : typeof value.value === "string"
          ? quote(value.value)
          : typeof value.value === "number"
            ? `float64(${value.value})`
            : String(value.value);
    case "name":
      return `${scope}[${quote(value.name)}]`;
    case "get":
      return `webui.Get(${expression(value.object, scope)}, ${expression(value.key, scope)})`;
    case "binary": {
      const left = expression(value.left, scope),
        right = expression(value.right, scope);
      if (value.op === "&&")
        return `func() any { left := ${left}; if !webui.Truth(left) { return left }; return ${right} }()`;
      if (value.op === "||")
        return `func() any { left := ${left}; if webui.Truth(left) { return left }; return ${right} }()`;
      if (value.op === "??")
        return `func() any { left := ${left}; if left != nil && left != webui.Undefined { return left }; return ${right} }()`;
      return `webui.Binary(${quote(value.op)}, ${left}, ${right})`;
    }
    case "unary":
      return `webui.Unary(${quote(value.op)}, ${expression(value.value, scope)})`;
    case "conditional":
      return `func() any { if webui.Truth(${expression(value.test, scope)}) { return ${expression(value.yes, scope)} }; return ${expression(value.no, scope)} }()`;
    case "array":
      return `[]any{${value.items.map((item) => expression(item, scope)).join(", ")}}`;
    case "object":
      return `webui.Scope{${Object.entries(value.entries)
        .map(([key, item]) => `${quote(key)}: ${expression(item, scope)}`)
        .join(", ")}}`;
    case "template":
      return (
        value.parts
          .map((part) => `webui.String(${expression(part, scope)})`)
          .join(" + ") || '""'
      );
    case "call": {
      const args = value.args.map((arg) => expression(arg, scope)).join(", ");
      if (value.name === "String") return `webui.String(${args})`;
      if (value.name === "Number") return `webui.Number(${args})`;
      if (value.name === "Boolean") return `webui.Truth(${args})`;
      return `actions[${quote(value.name)}](${args})`;
    }
  }
}

function literal(value: Expr | undefined, fallback: string): string {
  if (!value) return fallback;
  if (value.kind !== "literal" || typeof value.value !== "string")
    throw new Error(
      "La clase o propiedad de estilo debe ser una cadena literal; captura el CSS calculado para estilos dinámicos.",
    );
  return value.value;
}

const textTags = new Set([
  "label",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "span",
  "strong",
]);
const containers = new Set([
  "div",
  "main",
  "section",
  "header",
  "footer",
  "nav",
  "article",
  "form",
  "ul",
  "ol",
  "li",
]);
const ignoredAttrs = new Set([
  "id",
  "class",
  "className",
  "style",
  "key",
  "type",
  "data-native-component",
]);
const fieldAttrs: Record<string, string> = {
  value: "Value",
  placeholder: "Placeholder",
  href: "Href",
  variant: "Variant",
  size: "Size",
  "aria-label": "AccessibleLabel",
  for: "LabelFor",
  htmlFor: "LabelFor",
};

function style(
  node: Extract<Node, { kind: "element" }>,
  measured: boolean,
): string {
  if (measured) return "webui.Style{}";
  const values: Record<string, string | number> = {};
  const spacing = (number: string): number => Number(number) * 3.5;
  const fontSizes: Record<string, [number, number]> = {
    xs: [10.5, 14],
    sm: [12.25, 17.5],
    base: [14, 21],
    lg: [15.75, 24.5],
    xl: [17.5, 24.5],
    "2xl": [21, 28],
    "3xl": [26.25, 31.5],
  };
  for (const className of literal(node.attrs.className ?? node.attrs.class, "")
    .split(/\s+/)
    .filter(Boolean)) {
    if (["flex", "block", "inline-block"].includes(className)) continue;
    if (className === "flex-col") {
      values.Direction = "column";
      continue;
    }
    if (className === "flex-row") {
      values.Direction = "row";
      continue;
    }
    const gap = /^gap-(\d+(?:\.\d+)?)$/.exec(className);
    if (gap?.[1]) {
      values.Gap = spacing(gap[1]);
      continue;
    }
    const padding = /^p([xytblr]?)-(\d+(?:\.\d+)?)$/.exec(className);
    if (padding?.[2]) {
      const sides: Record<string, string[]> = {
        "": ["Top", "Right", "Bottom", "Left"],
        x: ["Left", "Right"],
        y: ["Top", "Bottom"],
        t: ["Top"],
        r: ["Right"],
        b: ["Bottom"],
        l: ["Left"],
      };
      for (const side of sides[padding[1] ?? ""] ?? [])
        values[`Padding${side}`] = spacing(padding[2]);
      continue;
    }
    const dimension = /^(w|h)-(\d+(?:\.\d+)?)$/.exec(className);
    if (dimension?.[2]) {
      values[dimension[1] === "w" ? "Width" : "Height"] = spacing(dimension[2]);
      continue;
    }
    const text = /^text-(.+)$/.exec(className);
    if (text?.[1] && fontSizes[text[1]]) {
      [values.FontSize, values.LineHeight] = fontSizes[text[1]]!;
      continue;
    }
    const weight: Record<string, number> = {
      "font-normal": 400,
      "font-medium": 500,
      "font-semibold": 600,
      "font-bold": 700,
    };
    if (weight[className]) {
      values.FontWeight = weight[className];
      continue;
    }
    if (className === "border") {
      values.BorderWidth = 1;
      values.BorderColor = "border";
      continue;
    }
    const radius: Record<string, number> = {
      "rounded-none": 0,
      "rounded-sm": 3.5,
      rounded: 3.5,
      "rounded-md": 5.25,
      "rounded-lg": 7,
    };
    if (className in radius) {
      values.Radius = radius[className]!;
      continue;
    }
    const color =
      /^(bg|text|border)-(surface|bg-subtle|text|text-muted|primary|danger|border|border-strong)$/.exec(
        className,
      );
    if (color?.[2]) {
      values[
        color[1] === "bg"
          ? "Background"
          : color[1] === "text"
            ? "Color"
            : "BorderColor"
      ] = color[2];
      continue;
    }
    throw new Error(
      `${node.id}: clase ${className} sin conversión. Usa medidas del navegador; nunca se ignora CSS.`,
    );
  }
  if (node.attrs.style) {
    if (node.attrs.style.kind !== "object")
      throw new Error(
        `${node.id}: style necesita un objeto literal o medidas del navegador.`,
      );
    const fields: Record<string, string> = {
      width: "Width",
      height: "Height",
      gap: "Gap",
      paddingTop: "PaddingTop",
      paddingRight: "PaddingRight",
      paddingBottom: "PaddingBottom",
      paddingLeft: "PaddingLeft",
      backgroundColor: "Background",
      color: "Color",
      borderColor: "BorderColor",
      borderWidth: "BorderWidth",
      borderRadius: "Radius",
      fontSize: "FontSize",
      lineHeight: "LineHeight",
      fontWeight: "FontWeight",
      flexDirection: "Direction",
    };
    for (const [property, val] of Object.entries(node.attrs.style.entries)) {
      if (
        property === "display" &&
        val.kind === "literal" &&
        ["flex", "block"].includes(String(val.value))
      )
        continue;
      const field = fields[property];
      if (
        !field ||
        val.kind !== "literal" ||
        (typeof val.value !== "number" && typeof val.value !== "string")
      )
        throw new Error(
          `${node.id}: CSS ${property} requiere captura del navegador.`,
        );
      const numeric = /^(\d+(?:\.\d+)?)(px|rem)$/.exec(String(val.value));
      if (["Background", "Color", "BorderColor", "Direction"].includes(field)) {
        if (typeof val.value !== "string")
          throw new Error(`${node.id}: ${property} requiere una cadena.`);
        values[field] = val.value;
      } else {
        if (typeof val.value === "string" && !numeric)
          throw new Error(
            `${node.id}: ${property} necesita px/rem o captura del navegador.`,
          );
        values[field] = numeric?.[1]
          ? Number(numeric[1]) * (numeric[2] === "rem" ? 14 : 1)
          : Number(val.value);
      }
    }
  }
  return `webui.Style{${Object.entries(values)
    .map(
      ([key, value]) =>
        `${key}: ${typeof value === "number" ? value : quote(value)}`,
    )
    .join(", ")}}`;
}

function handler(value: Handler, component: Component): string {
  const hasSet = value.steps.some((step) => step.kind === "set");
  const steps = value.steps.map((step) => {
    const args = step.args
      .map((arg) =>
        expression(
          arg,
          step.kind === "set" && step.updater ? "pending" : "eventScope",
        ),
      )
      .join(", ");
    if (step.kind === "call") return `actions[${quote(step.name)}](${args})`;
    if (!component.states.some((state) => state.name === step.name))
      throw new Error(`Setter desconocido: ${step.name}`);
    return `pending[${quote(step.name)}] = ${args}`;
  });
  const names = [
    ...new Set(
      value.steps
        .filter((step) => step.kind === "set")
        .map((step) => step.name),
    ),
  ];
  const commit = names
    .map(
      (name) =>
        `state[prefix + ${quote("/" + component.name + "/" + name)}] = pending[${quote(name)}]`,
    )
    .join("; ");
  return `eventScope := cloneScope(scope); _ = eventScope; ${value.parameter ? `eventScope[${quote(value.parameter)}] = webui.Scope{"currentTarget": webui.Scope{"value": value}, "target": webui.Scope{"value": value}}; ` : ""}${hasSet ? "pending := cloneScope(eventScope); " : ""}${steps.join("; ")}; ${commit}; refresh()`;
}

interface EmitContext {
  name: string;
  measured: boolean;
  textCounter: number;
}
function nodeCode(
  node: Node,
  component: Component,
  context: EmitContext,
): string {
  const measured = context.measured;
  if (node.kind === "text")
    return `func() []webui.Node { text := webui.ChildText(${expression(node.value)}); if text == "" { return nil }; return []webui.Node{{ID: prefix + ${quote("/text_" + context.textCounter++)},Kind:"text", Text:text}} }()`;
  if (node.kind === "conditional")
    return `func() []webui.Node { if webui.Truth(${expression(node.test)}) { return ${nodesCode(node.yes, component, context)} }; return ${nodesCode(node.no, component, context)} }()`;
  if (node.kind === "each")
    return `func() []webui.Node { var result []webui.Node; for index, item := range webui.Values(${expression(node.items)}) { scope := cloneScope(scope); scope[${quote(node.item)}] = item; ${node.index ? `scope[${quote(node.index)}] = float64(index);` : ""} prefix := prefix + "/" + webui.String(index); result = append(result, ${nodesCode(node.children, component, context)}...) }; return result }()`;
  if (node.kind === "component") {
    if (node.name.startsWith("$ui.")) {
      const name = node.name.slice(4);
      const tag = (
        {
          Button: "button",
          Input: "input",
          Card: "section",
          CardBody: "div",
          CardTitle: "h2",
        } as Record<string, string>
      )[name];
      if (!tag) throw new Error(`Componente UI sin renderer: ${name}`);
      return nodeCode(
        {
          kind: "element",
          id: node.id,
          tag,
          attrs: node.props,
          events: {},
          children: node.children,
        },
        component,
        context,
      );
    }
    if (node.children.length)
      throw new Error(
        `${node.name}: children/slots necesitan un contrato explícito.`,
      );
    const props = Object.entries(node.props)
      .map(([key, value]) => `${quote(key)}: ${expression(value)}`)
      .join(", ");
    return `build${context.name}_${node.name}(webui.Scope{${props}}, actions, refresh, state, active, prefix + ${quote("/" + node.id)})`;
  }
  const tag = node.tag;
  const kind =
    tag === "button"
      ? "button"
      : tag === "a"
        ? "link"
        : tag === "input"
          ? "input"
          : tag === "textarea"
            ? "textarea"
            : textTags.has(tag)
              ? "text"
              : containers.has(tag)
                ? "container"
                : undefined;
  if (!kind)
    throw new Error(`${node.id}: etiqueta ${tag} sin renderer nativo.`);
  const fields = [
    `ID: ${node.attrs.id ? `webui.String(${expression(node.attrs.id)})` : `prefix + ${quote("/" + node.id)}`}`,
    `Kind: ${quote(kind)}`,
    `Style: ${style(node, measured)}`,
  ];
  for (const [key, value] of Object.entries(node.attrs)) {
    if (ignoredAttrs.has(key)) continue;
    if (key === "disabled") {
      fields.push(`Disabled: webui.Truth(${expression(value)})`);
      continue;
    }
    if (key.startsWith("client:")) continue;
    if (fieldAttrs[key]) {
      fields.push(`${fieldAttrs[key]}: webui.String(${expression(value)})`);
      continue;
    }
    throw new Error(`${node.id}: atributo ${key} sin conversión.`);
  }
  if (
    node.attrs.type &&
    !["text", "email", "search", "button"].includes(
      literal(node.attrs.type, ""),
    )
  )
    throw new Error(`${node.id}: type necesita renderer especializado.`);
  for (const [name, event] of Object.entries(node.events)) {
    if (name === "onClick" && ["button", "link"].includes(kind)) {
      if (event.parameter)
        throw new Error(
          `${node.id}: el evento click con parámetro requiere binding nativo.`,
        );
      fields.push(`OnTap: func() { ${handler(event, component)} }`);
    } else if (
      ["onInput", "onChange"].includes(name) &&
      ["input", "textarea"].includes(kind)
    )
      fields.push(
        `OnChange: func(value string) { ${handler(event, component)} }`,
      );
    else throw new Error(`${node.id}: evento ${name} sin contrato nativo.`);
  }
  if (["text", "button", "link"].includes(kind)) {
    if (node.children.some((child) => child.kind !== "text"))
      throw new Error(
        `${node.id}: texto con elementos anidados necesita un renderer de texto rico.`,
      );
    fields.push(
      `Text: ${node.children.map((child) => (child.kind === "text" ? `webui.ChildText(${expression(child.value)})` : '""')).join(" + ") || '""'}`,
    );
  } else
    fields.push(`Children: ${nodesCode(node.children, component, context)}`);
  return `[]webui.Node{{${fields.join(", ")}}}`;
}

function nodesCode(
  nodes: Node[],
  component: Component,
  context: EmitContext,
): string {
  return `func() []webui.Node { var nodes []webui.Node; ${nodes.map((node) => `nodes = append(nodes, ${nodeCode(node, component, context)}...)`).join("; ")}; return nodes }()`;
}

export function emitGo(
  program: Program,
  options: {
    name: string;
    packageName: string;
    measurements?: Measurements;
    profile?: { state: string; width: number; height: number; scale: number };
  },
): string {
  if (!identifier.test(options.name) || !identifier.test(options.packageName))
    throw new Error("Nombre y paquete Go deben ser identificadores válidos.");
  if (
    options.measurements &&
    (options.measurements.schema !== 1 ||
      options.measurements.sourceHash !== sourceHash(program))
  )
    throw new Error(
      "Las medidas pertenecen a otra versión de la fuente. Recaptura el navegador.",
    );
  const measured = Boolean(options.measurements);
  if (options.measurements && options.profile) {
    const actual = options.measurements,
      expected = options.profile;
    if (
      actual.state !== expected.state ||
      actual.viewport.width !== expected.width ||
      actual.viewport.height !== expected.height ||
      actual.viewport.scale !== expected.scale
    )
      throw new Error(
        "Las medidas no corresponden al estado, viewport y escala configurados.",
      );
  }
  const context: EmitContext = { name: options.name, measured, textCounter: 0 };
  if (program.hasStyles && !measured)
    throw new Error(
      "La fuente contiene CSS. Captura sus medidas calculadas antes de generar Fyne; el CSS no se aproxima ni se descarta.",
    );
  const components = program.components.map((component) => {
    if (!identifier.test(component.name))
      throw new Error(`Nombre de componente no válido: ${component.name}`);
    const initializers = component.initializers
      .map((item) => {
        if (item.kind === "constant") {
          const constant = component.constants.find(
            (value) => value.name === item.name,
          )!;
          return `scope[${quote(constant.name)}] = ${expression(constant.value)}`;
        }
        const state = component.states.find(
          (value) => value.name === item.name,
        )!;
        const key = `prefix + ${quote("/" + component.name + "/" + state.name)}`;
        return `active[${key}] = true; if _, exists := state[${key}]; !exists { state[${key}] = ${expression(state.initial)} }; scope[${quote(state.name)}] = state[${key}]`;
      })
      .join("\n");
    return `func build${options.name}_${component.name}(props webui.Scope, actions webui.Actions, refresh func(), state webui.Scope, active map[string]bool, prefix string) []webui.Node {\n scope := cloneScope(props)\n scope["__astroProps"] = props\n _ = scope\n ${component.propsObject ? `scope[${quote(component.propsObject)}] = props` : ""}\n ${initializers}\n return ${nodesCode(component.body, component, context)}\n}`;
  });
  const measurementSetup = options.measurements
    ? `view.SetViewport(${options.measurements.viewport.width}, ${options.measurements.viewport.height})\n if err := view.ApplyMeasurements(${measurementsGo(options.measurements)}); err != nil { return nil, err }`
    : "";
  const tokens = Object.entries(options.measurements?.tokens ?? {})
    .map(([key, value]) => `${quote(key)}: ${quote(value)}`)
    .join(", ");
  return `// Code generated by astro-fyne. DO NOT EDIT.\n// Source SHA-256: ${sourceHash(program)}\n// SPDX-License-Identifier: Apache-2.0\npackage ${options.packageName}\n\nimport (webui "${runtime}"; "fyne.io/fyne/v2")\n\ntype ${options.name}Widget struct { *webui.View }\ntype ${options.name}Theme struct { *webui.CapturedTheme }\nfunc New${options.name}Theme(base fyne.Theme) (*${options.name}Theme,error) { generated,err := webui.NewCapturedTheme(map[string]string{${tokens}},base); if err != nil { return nil,err }; return &${options.name}Theme{CapturedTheme:generated},nil }\n\nfunc New${options.name}(props webui.Scope, actions webui.Actions, backends ...webui.Backend) (*${options.name}Widget, error) {\n if err := webui.Require(actions, []string{${program.actions.map(quote).join(", ")}}); err != nil { return nil, err }\n state := webui.Scope{}\n var view *webui.View\n refresh := func() { if view != nil { view.Refresh() } }\n view = webui.NewView(func() []webui.Node { active := map[string]bool{}; nodes := build${options.name}_${program.entry}(props, actions, refresh, state, active, ""); for key := range state { if !active[key] { delete(state,key) } }; return nodes }, backends...)\n ${measurementSetup}\n return &${options.name}Widget{View:view}, nil\n}\n\n${components.join("\n\n")}\n`;
}

const measuredFields = new Set([
  "x",
  "y",
  "width",
  "height",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "gap",
  "direction",
  "background",
  "color",
  "borderColor",
  "borderWidth",
  "radius",
  "fontSize",
  "lineHeight",
  "fontWeight",
  "fontFamily",
  "fontStyle",
  "textAlign",
  "whiteSpace",
  "display",
  "opacity",
  "measured",
]);
function measurementsGo(measurements: Measurements): string {
  if (
    !Number.isFinite(measurements.viewport.width) ||
    !Number.isFinite(measurements.viewport.height) ||
    ![1, 2].includes(measurements.viewport.scale)
  )
    throw new Error("Viewport de captura inválido.");
  const nodes = Object.entries(measurements.nodes).map(([id, values]) => {
    if (values.measured !== true)
      throw new Error(`${id}: falta la medida real del navegador.`);
    const fields = Object.entries(values).map(([key, value]) => {
      if (
        !measuredFields.has(key) ||
        (typeof value === "number" && !Number.isFinite(value))
      )
        throw new Error(`${id}: medida ${key} inválida.`);
      return `${key[0]?.toUpperCase()}${key.slice(1)}: ${typeof value === "string" ? quote(value) : value}`;
    });
    return `${quote(id)}: {${fields.join(", ")}}`;
  });
  return `map[string]webui.Style{${nodes.join(", ")}}`;
}

export const scopeHelper =
  "func cloneScope(source webui.Scope) webui.Scope { target := webui.Scope{}; for key, value := range source { target[key] = value }; return target }\n";
