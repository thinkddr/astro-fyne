// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import { basename, extname, join, resolve } from "node:path";
import { readCLIJSON, usageError, type Command } from "./cli-help.ts";

export async function normalizeConversionArgs(
  command: Command,
  args: readonly string[],
): Promise<string[]> {
  const input = args[0];
  if (
    !["generate", "check", "reverse"].includes(command) ||
    !input ||
    input.startsWith("-")
  )
    return [...args];
  const options = args.slice(1);
  if (
    options.some((arg) =>
      ["--source", "--program", "--scene", "--catalogue", "--config"].includes(
        arg,
      ),
    )
  )
    throw usageError(
      "Use one positional input or an explicit --source, --program, --scene, --catalogue or --config.",
      command,
    );
  for (let index = 0; index < options.length; index++) {
    const flag = options[index]!;
    if (!flag.startsWith("-"))
      throw usageError(
        "Only one input file is accepted, immediately after the command.",
        command,
      );
    if (!["--javascript", "--check", "--page"].includes(flag)) {
      const value = options[index + 1];
      if (value && !value.startsWith("-")) index++;
    }
  }
  const extension = extname(input).toLowerCase();
  let route: string[];
  if (/^\.(?:astro|[cm]?[jt]sx?)$/.test(extension))
    route = [
      ...(options.includes("--javascript") ? [] : ["--javascript"]),
      "--source",
      input,
    ];
  else if (extension === ".json") {
    const document = await readCLIJSON(resolve(input), "Conversion input");
    const record =
      document && typeof document === "object" && !Array.isArray(document)
        ? (document as Record<string, unknown>)
        : null;
    if (record?.kind === "astro-fyne-javascript")
      route = [
        ...(options.includes("--javascript") ? [] : ["--javascript"]),
        "--program",
        input,
      ];
    else if (record?.kind === "astro-fyne-catalogue")
      route = ["--catalogue", input];
    else if (record?.kind === "astro-fyne-program")
      route = ["--program", input];
    else if (
      record &&
      !Object.hasOwn(record, "kind") &&
      [1, 2].includes(record.schema as number) &&
      Array.isArray(record.roots)
    )
      route = ["--scene", input];
    else
      throw usageError(
        "JSON input must be an exported Astro Fyne JavaScript program, portable program, catalogue or schema 1/2 scene.",
        command,
      );
    if (
      record?.kind !== "astro-fyne-javascript" &&
      options.includes("--javascript")
    )
      throw usageError(
        "--javascript requires JavaScript source or a JavaScript program archive.",
        command,
      );
  } else if (extension === ".go")
    throw usageError(
      "Export your Fyne view as scene or program JSON first; Go source is not a portable scene. See docs/cli.md.",
      command,
    );
  else
    throw usageError(
      "Use an Astro/Preact source file or an exported JSON scene/program.",
      command,
    );
  const stem = basename(input, extname(input)).replace(
    /\.(?:program|javascript|scene|catalogue)$/i,
    "",
  );
  const words = stem.match(/[A-Za-z0-9]+/g) ?? [];
  let name = words
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join("");
  if (!/^[A-Z]/.test(name)) name = "App" + name;
  const slug =
    stem
      .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase() || "app";
  return [
    ...route,
    ...options,
    ...(options.includes("--out")
      ? []
      : [
          "--out",
          command === "reverse" ? join("src/pages", slug) : "native/generated",
        ]),
    ...(options.includes("--name") ? [] : ["--name", name]),
  ];
}
