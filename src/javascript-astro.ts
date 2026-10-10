// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { parse } from "@astrojs/compiler";
import ts from "typescript";
import { decodeHTML, decodeHTMLAttribute } from "entities";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

interface Node {
  type: string;
  name?: string;
  value?: string;
  attributes?: Attribute[];
  children?: Node[];
  position?: { start: { line: number; column: number } };
}
interface Attribute {
  name: string;
  kind: string;
  value: string;
}

/** Lower Astro's synchronous render lifecycle, without executing server source. */
export async function astroJavascript(
  source: string,
  path: string,
  identity: string,
  bundleScript: (contents: string, label: string) => Promise<string>,
) {
  const parsed = await parse(source, { position: true });
  const ast = parsed.ast as Node;
  const diagnostic = parsed.diagnostics.find((item) => item.severity === 1);
  if (diagnostic) throw new Error(`${path}: ${diagnostic.text}`);
  const prefix =
    "_afyAstro" +
    createHash("sha256").update(source).digest("hex").slice(0, 12);
  if (source.includes(prefix))
    throw new Error(`${path}: reserved Astro adapter identifier`);
  const fail = (node: Node, message: string): never => {
    const location = node.position?.start;
    throw new Error(
      `${path}:${location?.line ?? 1}:${location?.column ?? 1}: ${message}`,
    );
  };
  const frontmatter = ast.children?.find((node) => node.type === "frontmatter");
  const syntax = ts.createSourceFile(
    path + ".ts",
    frontmatter?.value ?? "",
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const imports: string[] = [],
    body: string[] = [],
    astroImports = new Set<string>();
  for (const statement of syntax.statements) {
    if (ts.isImportDeclaration(statement)) {
      imports.push(statement.getFullText(syntax));
      if (
        ts.isStringLiteral(statement.moduleSpecifier) &&
        statement.moduleSpecifier.text.endsWith(".astro")
      ) {
        const clause = statement.importClause;
        if (clause?.name) astroImports.add(clause.name.text);
        if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings))
          astroImports.add(clause.namedBindings.name.text);
      }
      continue;
    }
    if (
      ts.canHaveModifiers(statement) &&
      ts
        .getModifiers(statement)
        ?.some((item) => item.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      if (
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement)
      )
        imports.push(statement.getFullText(syntax));
      else
        fail(
          frontmatter!,
          "Astro route exports require an SSR/routing adapter",
        );
      continue;
    }
    const inspect = (node: ts.Node) => {
      if (ts.isFunctionLike(node)) return;
      if (
        ts.isAwaitExpression(node) ||
        ts.isReturnStatement(node) ||
        (ts.isForOfStatement(node) && node.awaitModifier)
      )
        fail(
          frontmatter!,
          "Async/response Astro frontmatter requires an SSR adapter",
        );
      ts.forEachChild(node, inspect);
    };
    inspect(statement);
    body.push(statement.getFullText(syntax));
  }
  const scripts: { key: string; contents: string; node: Node }[] = [];
  const fragment = prefix + "Fragment",
    child = prefix + "Child",
    attrs = prefix + "Attrs";
  const serialize = (node: Node, expression = false): string => {
    if (
      node.type === "frontmatter" ||
      node.type === "comment" ||
      node.type === "doctype"
    ) {
      if (node.type === "doctype")
        fail(node, "Document shells require a native window/page adapter");
      return "";
    }
    if (node.type === "text")
      return expression
        ? (node.value ?? "")
        : `{${JSON.stringify(decodeHTML(node.value ?? ""))}}`;
    if (node.type === "expression")
      return `{${child}((${(node.children ?? []).map((node) => serialize(node, true)).join("")}))}`;
    if (node.type === "root")
      return (node.children ?? []).map((node) => serialize(node)).join("");
    if (!["element", "component", "fragment"].includes(node.type))
      fail(node, `Astro ${node.type} needs a native template adapter`);
    const name = node.name ?? "";
    const attributes = node.attributes ?? [];
    if (
      name === "style" ||
      name === "link" ||
      ["html", "head", "body", "title", "meta"].includes(name)
    )
      fail(
        node,
        "Astro styles/document metadata require a native CSS/window adapter",
      );
    if (name === "script") {
      if (attributes.length)
        fail(
          node,
          "Inline/external script attributes require a browser module adapter; use a processed <script> without attributes",
        );
      scripts.push({
        key: identity + ":" + scripts.length,
        contents: (node.children ?? [])
          .map((node) => node.value ?? "")
          .join(""),
        node,
      });
      return "";
    }
    if (name === "slot") {
      if (attributes.length)
        fail(node, "Named/dynamic Astro slots require a slot adapter");
      return `{${prefix}Slots.default ? ${prefix}Slots.default() : <${fragment}>${(node.children ?? []).map((node) => serialize(node)).join("")}</${fragment}>}`;
    }
    const isFragment = node.type === "fragment" || name === "Fragment";
    if (isFragment && attributes.length)
      fail(node, "Astro Fragment attributes require a directive/slot adapter");
    const isAstro =
      node.type === "component" && astroImports.has(name.split(".")[0]!);
    const component = node.type === "component" && !isFragment;
    const directives = attributes.filter((attr) =>
      attr.name.startsWith("client:"),
    );
    if (component && !isAstro) {
      if (
        directives.length !== 1 ||
        !["client:load", "client:only"].includes(directives[0]!.name)
      )
        fail(
          node,
          'Non-hydrated or deferred JS components require an SSR/hydration adapter; use client:load or client:only="preact"',
        );
      if (
        directives[0]!.name === "client:only" &&
        (directives[0]!.kind !== "quoted" || directives[0]!.value !== "preact")
      )
        fail(node, "client:only requires the explicit preact renderer");
      if (
        (node.children ?? []).some(
          (node) => node.type !== "text" || node.value?.trim(),
        )
      )
        fail(
          node,
          "Hydrated component HTML slots require a renderer slot adapter",
        );
    } else if (directives.length)
      fail(node, "Hydration directives apply only to compatible JS components");
    const properties: string[] = [];
    for (const attribute of attributes) {
      if (directives.includes(attribute)) continue;
      if (attribute.kind === "spread") {
        properties.push(`...(${attribute.name})`);
        continue;
      }
      if (
        attribute.name.startsWith("_afyAstro") ||
        attribute.name.includes(":") ||
        (!component && /^on/i.test(attribute.name)) ||
        attribute.name === "slot"
      )
        fail(
          node,
          `Astro attribute ${attribute.name} requires a native directive/event/slot adapter`,
        );
      {
        const value =
          attribute.kind === "empty"
            ? "true"
            : attribute.kind === "quoted"
              ? JSON.stringify(decodeHTMLAttribute(attribute.value))
              : attribute.kind === "expression"
                ? `(${attribute.value})`
                : attribute.kind === "shorthand"
                  ? attribute.name
                  : fail(
                      node,
                      `Astro attribute ${attribute.kind} needs an adapter`,
                    );
        properties.push(`[${JSON.stringify(attribute.name)}]:${value}`);
      }
    }
    const tag = isFragment ? fragment : name;
    const values = `${attrs}({${properties.join(",")}},${component},${component && !isAstro})`;
    const spread = isFragment ? "" : `{...${values}}`;
    const content = (node.children ?? [])
      .map((node) => serialize(node))
      .join("");
    if (isAstro) {
      const hasChildren = (node.children ?? []).some(
        (node) => node.type !== "text" || node.value?.trim(),
      );
      return `<${tag} _afyAstroProps={${values}} _afyAstroSlots={${hasChildren ? `{default:()=> <${fragment}>${content}</${fragment}>}` : "{}"}} />`;
    }
    if (component) return `<${tag} ${spread} />`;
    return `<${tag} ${spread}>${content}</${tag}>`;
  };
  const markup = serialize(ast);
  const compiled: string[] = [];
  for (const script of scripts)
    compiled.push(await bundleScript(script.contents, script.key));
  const runtime = resolve(import.meta.dir, "javascript-astro-runtime.ts");
  return `import {Fragment as ${fragment}} from "preact";
import {useMemo as ${prefix}Memo,useLayoutEffect as ${prefix}Effect} from "preact/hooks";
import {astroChild as ${child},astroAttributes as ${attrs},astroContext as ${prefix}Context,astroScript as ${prefix}Script} from ${JSON.stringify(runtime)};
${imports.join("\n")}
${compiled.map((code, index) => `const ${prefix}Install${index}=()=>{${code}};`).join("\n")}
export default function ${prefix}Component(input:any){
const ${prefix}Props=input._afyAstroProps;
const ${prefix}Slots=input._afyAstroSlots??{};
const output=${prefix}Memo(()=>{
const Astro=${prefix}Context(${prefix}Props,${prefix}Slots);
${body.join("\n")}
return <${fragment}>${markup}</${fragment}>;
},[]);
${scripts.length ? `${prefix}Effect(()=>{${scripts.map((script, index) => `${prefix}Script(${JSON.stringify(script.key)},${prefix}Install${index});`).join("")}},[]);` : ""}
return output;
}
${prefix}Component._afyAstroEntry=true;`;
}
