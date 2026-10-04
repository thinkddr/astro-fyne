// SPDX-License-Identifier: Apache-2.0
import { readFile } from "node:fs/promises";

export type Command = "generate" | "check" | "watch" | "analyze" | "reverse";

const commands: Command[] = [
  "generate",
  "check",
  "watch",
  "analyze",
  "reverse",
];
const aliases = { "to-fyne": "generate", "to-web": "reverse" } as const;

export function resolveCommand(name: string): Command | undefined {
  if (commands.includes(name as Command)) return name as Command;
  return Object.hasOwn(aliases, name)
    ? aliases[name as keyof typeof aliases]
    : undefined;
}

export function wantsHelp(argv: readonly string[]): boolean {
  return argv.includes("--help") || argv.includes("-h");
}

export function usageError(message: string, command?: Command): Error {
  return new Error(
    `${message}\nRun "bun run astro-fyne${command ? ` ${command}` : ""} --help" for usage.`,
  );
}

export function helpText(command?: Command): string {
  if (!command)
    return `astro-fyne — Astro + Preact ↔ Fyne conversion

Usage: bun run astro-fyne <command> [options]

Commands:
  generate, to-fyne  Generate Fyne Go widgets from the configured pages.
  check             Verify generated files are current without writing them.
  watch             Generate once, then regenerate when source files change.
  analyze           Print source analysis as JSON without generating files.
  reverse, to-web   Generate Astro, Preact, CSS and assets from a Fyne scene.
  help [command]    Show general or command-specific help.

Examples:
  bun run to-fyne
  bun run check --config path/to/astro-fyne.json
  bun run to-web --scene scene.json --out src/pages/native --name NativePage

Run "bun run astro-fyne <command> --help" for options and examples.
Conversion supports the documented declarative subset. Generated output alone
does not certify visual equivalence; compare browser and native captures.
`;
  if (command === "reverse")
    return `astro-fyne reverse (alias: to-web) — Fyne → Astro + Preact

Usage: bun run to-web --scene <file> --out <directory> --name <Name> [options]

Required:
  --scene <file>           Fyne scene JSON exported by the native scene API.
  --out <directory>        Destination for Name.astro, Name.tsx, Name.css and report.
  --name <Name>            Generated component name, for example NativePage.

Options:
  --public-dir <directory> Astro public directory for image assets.
                           Default: <out>/public. Use your project's public path.
  --actions-module <path>  Client module exporting "actions" for scene callbacks;
                           import path relative to the generated TSX component.
  --check                 Verify files are current without writing them.
  -h, --help              Show this help without reading or writing any files.

Examples:
  bun run to-web --scene scene.json --out src/pages/native --name NativePage --public-dir public
  bun run to-web --scene scene.json --out src/pages/native --name NativePage --actions-module ../../actions --check

Callbacks require an explicit client actions module. The scene is an initial
snapshot; generated output does not certify visual equivalence.
`;
  const descriptions = {
    generate: "Astro + Preact → Fyne Go widgets",
    check: "verify generated Fyne files without writing",
    watch: "generate Fyne files and watch for source changes",
    analyze: "print source analysis as JSON without generating files",
  };
  return `astro-fyne ${command}${command === "generate" ? " (alias: to-fyne)" : ""} — ${descriptions[command]}

Usage: bun run ${command === "generate" ? "to-fyne" : command} [options]

Options:
  --config <file>          Configuration JSON. Default: astro-fyne.json in the
                           current directory; entry paths are relative to it.
  --entry <Name>           Select one configured entry by name. Default: all.
${command === "analyze" ? "" : "  --measurements <file>    Override the selected entry's captured measurements.\n                           Path relative to the config; select --entry if needed.\n"}  -h, --help              Show this help without reading or writing any files.

Examples:
  bun run ${command === "generate" ? "to-fyne" : command}
  bun run ${command === "generate" ? "to-fyne" : command} --config path/to/astro-fyne.json --entry NativePage
${command === "watch" ? "\nWatch performs an initial generation. Stop it with Ctrl+C.\n" : ""}${command === "analyze" ? "\nAnalysis goes to stdout as JSON and does not require gofmt.\n" : "\nGo's gofmt must be on PATH. Generated output does not certify visual equivalence.\n"}`;
}

/** Read CLI inputs with a path-specific error instead of an unlabelled JSON error. */
export async function readCLIJSON(
  path: string,
  label: string,
  missingHint?: string,
): Promise<unknown> {
  let source: string;
  try {
    source = await readFile(path, "utf8");
  } catch (error) {
    const missing = (error as NodeJS.ErrnoException).code === "ENOENT";
    throw new Error(
      `${label} ${missing ? "file not found" : "could not be read"}: ${path}${missing && missingHint ? `\n${missingHint}` : ""}`,
      { cause: error },
    );
  }
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`Invalid JSON in ${label.toLowerCase()} file: ${path}`, {
      cause: error,
    });
  }
}
