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
  generate, to-fyne  Convert a file to Fyne or generate configured pages.
  check             Verify generated files are current without writing them.
  watch             Generate once, then regenerate when source files change.
  analyze           Print source analysis as JSON without generating files.
  reverse, to-web   Convert exported Fyne JSON to Astro + Preact.
  help [command]    Show general or command-specific help.

Examples:
  bun run to-fyne src/App.astro
  bun run to-fyne src/Counter.tsx
  bun run to-fyne src/App.astro --fonts fonts.json
  bun run to-web App.program.json
  bun run to-web scene.json --out src/pages/native --name NativePage
  bun run to-fyne
  bun run check --config path/to/astro-fyne.json

Run "bun run astro-fyne <command> --help" for options and examples.
Source file shortcuts use JavaScript execution in pure-Go Goja with native Fyne controls.
Exported JSON selects its existing JavaScript, portable program, catalogue or scene route.
Configured generation also offers declarative Go lowering.
Both modes use native Fyne widgets and documented platform contracts. Generated output alone
does not certify visual equivalence; compare browser and native captures.
`;
  if (command === "reverse")
    return `astro-fyne reverse (alias: to-web) — Fyne → Astro + Preact

Usage: bun run to-web <exported.json> [options]

File shortcut:
  Detects JavaScript archives, portable programs, catalogues and schema 1/2 scenes from JSON.
  Defaults: --out src/pages/<file-name>, --name <FileName>.
  Strips .program, .javascript, .scene and .catalogue filename suffixes.
  Override either default with --out or --name. --check never writes output.
  Put the input immediately after the command; do not combine it with input flags.

Explicit forms (all existing options remain available):
  bun run to-web --scene <file> --out <directory> --name <Name> [options]

Inputs and explicit output options:
  --catalogue <file>       Exported catalogue of widgets, themes, layouts, CSS/fonts and islands.
  --scene <file>           Fyne scene JSON exported by the native scene API.
  --program <file>         Portable generated program, used instead of --scene.
  --javascript            Use a bundled JavaScript archive or --source component.
  --source <file>          Astro/TSX/JSX/TS/JS entry for --javascript.
  --stylesheet <file>      Local CSS for --javascript --source input.
  --export <identifier>    JavaScript named export. Default: default.
  --props <file>           Initial JSON data for a JavaScript source entry.
  --actions <names>        Comma-separated JavaScript action props.
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
  bun run to-web App.program.json
  bun run to-web native.scene.json --check
  bun run to-web --scene scene.json --out src/pages/native --name NativePage --public-dir public
  bun run to-web --scene scene.json --out src/pages/native --name NativePage --actions-module ../../actions --check

Callbacks require an explicit client actions module. The scene is an initial
snapshot. --program preserves declared state and logic within the documented
subset; generated output does not certify visual equivalence.
`;
  const sceneHelp =
    command === "generate" || command === "check"
      ? `
File shortcut:
  bun run ${command === "generate" ? "to-fyne" : "check"} src/App.astro
  bun run ${command === "generate" ? "to-fyne" : "check"} App.program.json
  Astro/TSX/JSX/TS/JS files use the JavaScript adapter in pure-Go Goja with
  native Fyne controls. This does not translate arbitrary JavaScript into Go.
  Exported JSON selects JavaScript, portable program, catalogue or schema 1/2 scene input.
  Defaults: --out native/generated, --name <FileName> in PascalCase.
  Override either default with --out or --name; --check never writes output.
  Put the input immediately after the command; do not combine it with input flags.
  Go source requires a native scene/program JSON export first.

Catalogue input:
  bun run ${command === "generate" ? "to-fyne" : "check"} widgets.catalogue.json
  --catalogue <file>       Generate native constructors and a registry from a portable catalogue.
  See docs/catalogue.md for both directions and explicit host dependencies.

Native scene input:
  bun run ${command === "generate" ? "to-fyne" : "check"} --scene <file> --out <directory> --name <Name> [options]
  --scene <file>           Rebuild schema 1 fixed or schema 2 responsive native scenes.
  --out <directory>        Destination for Name.gen.go and its generation report.
  --name <Name>            Capitalized generated widget name.
  --package <identifier>   Go package name. Default: generated.
  --fonts <file>           JSON array of explicit TrueType face bindings;
                           source paths are relative to this JSON file.
  --check                 Verify scene output without writing it.

Portable program input:
  bun run ${command === "generate" ? "to-fyne" : "check"} --program <file> --out <directory> --name <Name> [--package <identifier>] [--check]
  Recompile a generated widget's exported program and current declared state.
  Opt into ExportProgram() with portableProgram: true in the source entry.
  CSS source, arbitrary JS/Go and function bodies need explicit contracts.

JavaScript execution:
  bun run to-fyne --javascript --source <component> --out <directory> --name <Name>
  bun run to-fyne --javascript --program <archive> --out <directory> --name <Name>
  --export <identifier>    Named component export. Default: default.
  --props <file>           Initial JSON props for source input.
  --stylesheet <file>      Local CSS for --javascript --source input.
  --actions <names>        Comma-separated callback names bound by the Go host.
  --fonts <file>           Licensed local-font manifest for native --source input.
                           Generates a catalogue with New<Name>/Export<Name>Catalogue.
                           See docs/source-fonts.md; scene font arrays stay unchanged.
  Generated Go embeds JavaScript executed in Goja, with native Fyne controls.
  See docs/javascript-runtime.md for replay and native platform boundaries.
`
      : "";
  const descriptions = {
    generate: "Astro + Preact → Fyne Go widgets",
    check: "verify generated Fyne files without writing",
    watch: "generate Fyne files and watch for source changes",
    analyze: "print source analysis as JSON without generating files",
  };
  return `astro-fyne ${command}${command === "generate" ? " (alias: to-fyne)" : ""} — ${descriptions[command]}

Usage: bun run ${command === "generate" ? "to-fyne" : command}${["generate", "check"].includes(command) ? " [input]" : ""} [options]

Options:
  --config <file>          Configuration JSON. Default: astro-fyne.json in the
                           current directory; entry paths are relative to it.
  --entry <Name>           Select one configured entry by name. Default: all.
${command === "analyze" ? "" : "  --measurements <file>    Override the selected entry's captured measurements.\n                           Path relative to the config; select --entry if needed.\n"}  -h, --help              Show this help without reading or writing any files.

Examples:
  bun run ${command === "generate" ? "to-fyne" : command}
  bun run ${command === "generate" ? "to-fyne" : command} --config path/to/astro-fyne.json --entry NativePage
${command === "watch" ? "\nWatch performs an initial generation. Stop it with Ctrl+C.\n" : ""}${command === "analyze" ? "\nAnalysis goes to stdout as JSON and does not require gofmt.\n" : "\nGo's gofmt must be on PATH. Generated output does not certify visual equivalence.\n"}${sceneHelp}`;
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
