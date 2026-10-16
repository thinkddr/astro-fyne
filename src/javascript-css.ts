// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
const cssPackage = "css-tree";
const css = await import(cssPackage);
const asciiLower = (value: string) =>
  value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());

/** Compile CSS syntax only. Cascading stays in the shared native/browser VM. */
export async function compileJavascriptCSS(
  file: string,
  record: (file: string, text: string) => void,
  stack: string[] = [],
): Promise<any[]> {
  file = resolve(file);
  if (stack.includes(file)) return []; // CSS import cycles do not re-enter a sheet.
  if (stack.length >= 32) throw new Error("CSS import depth exceeds 32");
  const bytes = await readFile(file);
  if (bytes.length > 16 * 1024 * 1024)
    throw new Error("CSS source exceeds 16MiB");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    throw new Error(`CSS source requires UTF-8: ${file}`);
  }
  record(file, text);
  let ast;
  try {
    ast = css.parse(text, {
      positions: true,
      onParseError(error: Error) {
        throw error;
      },
    });
  } catch (error) {
    const failure = error as {
      message?: string;
      line?: number;
      column?: number;
      offset?: number;
    };
    const at = failure.offset ?? 0;
    throw new Error(
      `CSS syntax requires a parser adapter at ${file}:${failure.line ?? 0}:${failure.column ?? 0}: ${failure.message ?? error}; near ${JSON.stringify(text.slice(Math.max(0, at - 32), at + 80))}`,
    );
  }
  const result: any[] = [];
  let anonymous = 0,
    importsAllowed = true;
  const plain = (node: any) => css.toPlainObject(node);
  const specificity = (selectors: any[]) =>
    selectors.reduce(
      (best, item) =>
        compare(item.specificity, best) > 0 ? item.specificity : best,
      [0, 0, 0],
    );
  function compare(a: number[], b: number[]) {
    return a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!;
  }
  function selectors(list: any): any[] {
    if (list.type !== "SelectorList")
      throw new Error("CSS selector syntax requires an adapter");
    return list.children.map((selector: any) => {
      const parts: any[] = [{ tests: [], before: "" }],
        score = [0, 0, 0];
      for (const node of selector.children) {
        const tests = parts[parts.length - 1].tests;
        if (node.type === "Combinator") {
          if (![" ", ">", "+", "~"].includes(node.name) || !tests.length)
            throw new Error("CSS combinator requires an adapter");
          parts.push({ tests: [], before: node.name });
        } else if (
          ["TypeSelector", "ClassSelector", "IdSelector"].includes(node.type)
        ) {
          const name = css.ident.decode(node.name);
          if (name.includes("|"))
            throw new Error("CSS namespaces require an adapter");
          tests.push([node.type, name]);
          if (name !== "*")
            score[
              node.type === "IdSelector"
                ? 0
                : node.type === "ClassSelector"
                  ? 1
                  : 2
            ]!++;
        } else if (node.type === "AttributeSelector") {
          const flags = node.flags
            ? asciiLower(css.ident.decode(node.flags))
            : null;
          if (
            !node.name ||
            node.name.type !== "Identifier" ||
            (flags && (!node.matcher || !["i", "s"].includes(flags)))
          )
            throw new Error("CSS attribute selector requires an adapter");
          tests.push([
            "attribute",
            css.ident.decode(node.name.name),
            node.matcher,
            node.value?.type === "String"
              ? node.value.value
              : node.value
                ? css.ident.decode(node.value.name)
                : null,
            flags,
          ]);
          score[1]!++;
        } else if (node.type === "PseudoClassSelector") {
          const name = asciiLower(node.name);
          if (["is", "where", "not"].includes(name)) {
            const nested = selectors(node.children?.[0]);
            tests.push([name, nested]);
            if (name !== "where") {
              const s = specificity(nested);
              for (let i = 0; i < 3; i++) score[i]! += s[i];
            }
          } else if (
            [
              "root",
              "checked",
              "disabled",
              "enabled",
              "empty",
              "first-child",
              "last-child",
            ].includes(name) &&
            !node.children
          ) {
            tests.push(["pseudo", name]);
            score[1]!++;
          } else
            throw new Error(
              `CSS pseudo-class :${name} requires a native state/selector adapter`,
            );
        } else throw new Error(`CSS selector ${node.type} requires an adapter`);
      }
      if (!parts[parts.length - 1].tests.length)
        throw new Error("CSS selector ends in a combinator");
      return { parts, specificity: score };
    });
  }
  async function rules(children: any[], layer: string | null = null) {
    for (const node of children) {
      if (result.length > 100000) throw new Error("CSS rules exceed 100000");
      if (node.type === "Rule") {
        importsAllowed = false;
        const declarations = node.block.children.map((item: any) => {
          if (item.type !== "Declaration")
            throw new Error("CSS nesting requires a native selector adapter");
          const name = item.property.startsWith("--")
            ? item.property
            : asciiLower(item.property);
          if (!name.startsWith("--") && !css.generate(item.value).trim())
            throw new Error(
              "Empty CSS declarations require an invalid-value adapter",
            );
          css.walk(item.value, (part: any) => {
            if (part.type === "Url")
              throw new Error(
                "CSS URL resources require a native resource adapter",
              );
          });
          return {
            name,
            value: css.generate(item.value),
            important: item.important,
          };
        });
        result.push({
          selectors: selectors(node.prelude),
          declarations,
          layer,
        });
      } else if (node.type === "Atrule" && asciiLower(node.name) === "layer") {
        if (layer) throw new Error("Nested CSS layers require an adapter");
        const names = node.prelude
          ? node.prelude.children?.[0]?.children?.map((n: any) => n.name)
          : [];
        if (names.some((n: string) => n.includes(".")))
          throw new Error("Nested CSS layer names require an adapter");
        if (node.block) {
          if (names.length > 1)
            throw new Error("CSS layer blocks require one name");
          const name = names[0] ?? `${file}:anonymous:${++anonymous}`;
          result.push({ layers: [name] });
          await rules(node.block.children, name);
        } else result.push({ layers: names });
      } else if (node.type === "Atrule" && asciiLower(node.name) === "import") {
        if (!importsAllowed || layer)
          throw new Error("CSS @import must precede style rules");
        const prelude = node.prelude?.children;
        if (
          prelude?.length !== 1 ||
          !["String", "Url"].includes(prelude[0].type)
        )
          throw new Error(
            "CSS conditional imports require a native media/layer adapter",
          );
        const path = prelude[0].value;
        if (typeof path !== "string" || /^[\w+.-]+:|^\/\//.test(path))
          throw new Error("CSS imports require local files");
        result.push(
          ...(await compileJavascriptCSS(resolve(dirname(file), path), record, [
            ...stack,
            file,
          ])),
        );
      } else if (node.type !== "Comment")
        throw new Error(
          `CSS @${node.name ?? node.type} requires a native stylesheet adapter`,
        );
    }
  }
  await rules(plain(ast).children);
  return result;
}
