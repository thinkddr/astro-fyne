// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { compile } from "../src/parser.ts";
import { sourceHash } from "../src/emit.ts";
import { validateSceneDocument } from "../src/reverse.ts";

const root = resolve(import.meta.dir, "..");
const out = join(root, "artifacts/css-roundtrip");
const generated = join(root, "native/.css-token-roundtrip");
const web = join(root, "example/src/pages/css-token-roundtrip");
const hash = (data: Uint8Array) =>
  createHash("sha256").update(data).digest("hex");
const expectedTokens = {
  "--Accent": "#112233",
  "--accent": "#445566",
  "--space": "8px",
  "--color-primary": "#11232b",
};
type Phase = { name: string; command: string[]; cwd: string; exitCode: number };
const phases: Phase[] = [];

async function json(path: string, data: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2) + "\n");
}

async function phase(name: string, command: string[], cwd = root) {
  const process = Bun.spawn(command, {
    cwd,
    env: {
      ...Bun.env,
      GOWORK: "off",
      GOFLAGS: "-mod=readonly",
      GOMAXPROCS: "2",
      ASTRO_FYNE_CSS_TOKENS_ARTIFACTS: out,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).bytes(),
    new Response(process.stderr).bytes(),
    process.exited,
  ]);
  await writeFile(join(out, `${name}.stdout.log`), stdout);
  await writeFile(join(out, `${name}.stderr.log`), stderr);
  phases.push({ name, command, cwd: relative(root, cwd) || ".", exitCode });
  await json(join(out, `${mode}-phases.json`), phases);
  if (exitCode !== 0)
    throw new Error(`${name} failed (${exitCode}); retained logs in ${out}`);
  return Buffer.from(stdout).toString("utf8");
}

async function retain(directory: string, target: string) {
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(directory, { withFileTypes: true }))
    if (entry.isFile())
      await copyFile(join(directory, entry.name), join(target, entry.name));
}

const nativeTest = String.raw`// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
package generated

import (
 "bytes"
 "crypto/sha256"
 "encoding/json"
 "fmt"
 "image/png"
 "os"
 "path/filepath"
 "reflect"
 "testing"

 "fyne.io/fyne/v2"
 "fyne.io/fyne/v2/driver/software"
 "fyne.io/fyne/v2/test"
 webui "github.com/thinkddr/astro-fyne/native"
 "github.com/thinkddr/astro-fyne/native/reverse"
)

func tokenHash(data []byte) string { return fmt.Sprintf("%x", sha256.Sum256(data)) }
func tokenJSON(t *testing.T, path string, value any) {
 t.Helper()
 data,err:=json.MarshalIndent(value,"","  ");if err!=nil {t.Fatal(err)}
 if err=os.WriteFile(path,append(data,'\n'),0644);err!=nil {t.Fatal(err)}
}
func TestCSSRootTokensSurviveSourceOnlyWebReimport(t *testing.T) {
 out:=os.Getenv("ASTRO_FYNE_CSS_TOKENS_ARTIFACTS");if out=="" {t.Fatal("missing artifact directory")}
 expected:=map[string]string{"--Accent":"#112233","--accent":"#445566","--space":"8px","--color-primary":"#11232b"}
 a:=test.NewApp();defer a.Quit();base:=a.Settings().Theme()
 generatedTheme,err:=NewCSSTokensTheme(nil);if err!=nil {t.Fatal(err)}
 if !reflect.DeepEqual(generatedTheme.Tokens,expected) {t.Fatal("generated theme lost exact token declarations")}
 for name,want:=range expected {got,ok:=generatedTheme.CSS(name);if !ok||got!=want {t.Fatalf("CSS(%q)=%q,%t",name,got,ok)}}
 if _,ok:=generatedTheme.CSS("--ACCENT");ok {t.Fatal("custom-property case was folded")}
 widget,err:=NewCSSTokens(webui.Scope{},webui.Actions{});if err!=nil {t.Fatal(err)}
 if a.Settings().Theme()!=base {t.Fatal("token helpers installed a global theme")}
 c:=software.NewCanvas();c.SetPadded(false);c.Resize(fyne.NewSize(160,80));c.SetContent(widget)
 if err=widget.BindCanvas(c);err!=nil {t.Fatal(err)}
 root,box:=widget.Object("css-token-root"),widget.Object("css-token-box");if root==nil||box==nil {t.Fatal("missing native objects")}
 for _,scale:=range []int{1,2} {t.Run(fmt.Sprintf("scale-%d",scale),func(t *testing.T){
  c.SetScale(float32(scale));c.Resize(fyne.NewSize(160,80));frame:=c.Capture()
  if frame.Bounds().Dx()!=160*scale||frame.Bounds().Dy()!=80*scale||widget.Object("css-token-root")!=root||widget.Object("css-token-box")!=box {t.Fatal("native viewport or object identity changed")}
  snapshot,err:=widget.Snapshot();if err!=nil {t.Fatal(err)};if !snapshot.Responsive||snapshot.Measured {t.Fatal("expected source-only responsive layout")}
  opts:=reverse.Options{Viewport:reverse.Viewport{Width:160,Height:80,Scale:float32(scale)},Canvas:c,PreserveLayout:true}
  withoutTokens,err:=reverse.Export(widget,opts);if err!=nil {t.Fatal(err)};if len(withoutTokens.Tokens)!=0 {t.Fatal("scene export inferred host tokens")}
  opts.Tokens=generatedTheme.Tokens
  scene,err:=reverse.Export(widget,opts);if err!=nil {t.Fatal(err)};if scene.Schema!=2||!reflect.DeepEqual(scene.Tokens,expected) {t.Fatal("explicit scene tokens changed")}
  directory:=filepath.Join(out,fmt.Sprintf("scale-%d",scale))
  original,err:=os.ReadFile(filepath.Join(directory,"scene.json"));if err!=nil {t.Fatal(err)}
  var before reverse.Document;if err=json.Unmarshal(original,&before);err!=nil {t.Fatal(err)}
  if len(before.Roots)!=1||len(before.Roots[0].Children)!=1||len(scene.Roots)!=1||len(scene.Roots[0].Children)!=1 {t.Fatal("native scene inventory changed")}
  if !reflect.DeepEqual(before.Roots[0].SourceStyle,scene.Roots[0].SourceStyle)||!reflect.DeepEqual(before.Roots[0].Children[0].SourceStyle,scene.Roots[0].Children[0].SourceStyle) {t.Fatal("responsive declarations changed")}
  var encoded bytes.Buffer;if err=png.Encode(&encoded,frame);err!=nil {t.Fatal(err)}
  if err=os.WriteFile(filepath.Join(directory,"restored-native.png"),encoded.Bytes(),0644);err!=nil {t.Fatal(err)}
  tokenJSON(t,filepath.Join(directory,"restored-scene.json"),scene)
  tokenJSON(t,filepath.Join(directory,"restored-native.json"),map[string]any{"schema":1,"sourceOnly":true,"sourceHash":CSSTokensSourceHash,"originalSceneHash":tokenHash(original),"viewport":scene.Viewport,"tokens":scene.Tokens,"globalThemeUnchanged":a.Settings().Theme()==base,"explicitTokensRequired":len(withoutTokens.Tokens)==0,"screenshotHash":tokenHash(encoded.Bytes())})
 })}
}
`;

async function prepare() {
  const paths = [
    "ci/css-roundtrip.ts",
    "capture/css-scene-tokens.ts",
    "native/reverse/cmd/css-token-fixture/main.go",
    "src/reverse.ts",
    "src/scene-layout.ts",
    "src/root-css-tokens.ts",
    "src/emit.ts",
    "src/parser.ts",
    "src/ir.ts",
    "src/cli.ts",
    "native/view.go",
    "native/flex.go",
    "native/theme.go",
    "native/go.mod",
    "native/go.sum",
    "package.json",
    "bun.lock",
  ];
  const inputs = [];
  for (const path of paths) {
    const bytes = await readFile(join(root, path));
    inputs.push({ path, hash: hash(bytes) });
    const target = join(out, "inputs", path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }
  await json(join(out, "inputs.json"), inputs);
  await phase(
    "native-export",
    [
      "go",
      "run",
      "-p=1",
      "-race",
      "./reverse/cmd/css-token-fixture",
      "--out",
      out,
    ],
    join(root, "native"),
  );
  const webArgs = [
    "bun",
    "src/cli.ts",
    "to-web",
    "--scene",
    join(out, "scale-1/scene.json"),
    "--out",
    web,
    "--name",
    "CSSTokens",
    "--public-dir",
    "example/public",
  ];
  await phase("web-generate", webArgs);
  await phase("web-check", [...webArgs, "--check"]);
  await retain(web, join(out, "web"));
  const entry = join(web, "CSSTokens.tsx");
  const program = await compile(entry);
  assert.notEqual(program.hasStyles, true);
  assert.deepEqual(program.actions, []);
  assert.equal(program.sources.length, 1);
  assert.equal(program.sources[0]!.hash, hash(await readFile(entry)));
  const config = join(out, "forward.json");
  await json(config, {
    schema: 1,
    package: "generated",
    entries: [
      {
        name: "CSSTokens",
        export: "CSSTokens",
        source: relative(out, entry),
        output: relative(out, join(generated, "css_tokens.gen.go")),
      },
    ],
  });
  await phase("source-generate", [
    "bun",
    "src/cli.ts",
    "generate",
    "--config",
    config,
  ]);
  await phase("source-check", [
    "bun",
    "src/cli.ts",
    "check",
    "--config",
    config,
  ]);
  const report = JSON.parse(
    await readFile(join(generated, "css_tokens.gen.report.json"), "utf8"),
  );
  assert.equal(report.visual.measured, false);
  assert.equal(
    report.sourceHash,
    sourceHash(await compile(entry, undefined, { root: out })),
  );
  await writeFile(join(generated, "css_tokens_test.go"), nativeTest);
  try {
    await phase("format-generated-probe", [
      "gofmt",
      "-w",
      join(generated, "css_tokens_test.go"),
    ]);
    await phase(
      "source-vet",
      ["go", "vet", "-p=1", "./.css-token-roundtrip"],
      join(root, "native"),
    );
    const nativeOutput = await phase(
      "source-native",
      [
        "go",
        "test",
        "-v",
        "-race",
        "-count=1",
        "-p=1",
        "./.css-token-roundtrip",
      ],
      join(root, "native"),
    );
    assert.ok(
      nativeOutput.includes(
        "--- PASS: TestCSSRootTokensSurviveSourceOnlyWebReimport",
      ),
    );
  } finally {
    await retain(generated, join(out, "generated-native"));
  }
  await json(join(out, "prepared.json"), {
    schema: 1,
    sourceOnly: true,
    tokens: expectedTokens,
    sourceHash: report.sourceHash,
    preactHash: hash(await readFile(entry)),
    sourceInputsHash: hash(await readFile(join(out, "inputs.json"))),
    phases,
  });
}

async function verify() {
  const inputs = JSON.parse(
    await readFile(join(out, "inputs.json"), "utf8"),
  ) as { path: string; hash: string }[];
  for (const input of inputs)
    assert.equal(
      hash(await readFile(join(root, input.path))),
      input.hash,
      `${input.path} changed during the gate`,
    );
  const prepared = JSON.parse(
    await readFile(join(out, "prepared.json"), "utf8"),
  );
  assert.equal(prepared.schema, 1);
  assert.equal(prepared.sourceOnly, true);
  assert.deepEqual(prepared.tokens, expectedTokens);
  assert.deepEqual(
    prepared.phases.map((item: Phase) => item.name),
    [
      "native-export",
      "web-generate",
      "web-check",
      "source-generate",
      "source-check",
      "format-generated-probe",
      "source-vet",
      "source-native",
    ],
  );
  assert.ok(prepared.phases.every((item: Phase) => item.exitCode === 0));
  assert.equal(
    prepared.sourceInputsHash,
    hash(await readFile(join(out, "inputs.json"))),
  );
  const entry = join(web, "CSSTokens.tsx");
  assert.equal(prepared.preactHash, hash(await readFile(entry)));
  assert.equal(
    prepared.sourceHash,
    sourceHash(await compile(entry, undefined, { root: out })),
  );
  await phase("browser", [
    "bun",
    "capture/css-scene-tokens.ts",
    "--url",
    "http://127.0.0.1:4321/css-token-roundtrip/CSSTokens",
    "--out",
    out,
  ]);
  const comparisons: unknown[] = [];
  let comparisonFailure = false;
  for (const scale of [1, 2]) {
    const directory = join(out, `scale-${scale}`);
    const original = validateSceneDocument(
      JSON.parse(await readFile(join(directory, "scene.json"), "utf8")),
    );
    const restored = validateSceneDocument(
      JSON.parse(
        await readFile(join(directory, "restored-scene.json"), "utf8"),
      ),
    );
    for (const document of [original, restored]) {
      assert.equal(document.schema, 2);
      assert.equal(document.layout, "flex");
      assert.deepEqual(document.tokens, expectedTokens);
      assert.deepEqual(document.viewport, { width: 160, height: 80, scale });
    }
    assert.deepEqual(original.roots, restored.roots);
    for (const [name, actual] of [
      ["native-web", "web.png"],
      ["native-restored", "restored-native.png"],
    ] as const) {
      const phaseName = `scale-${scale}-${name}`;
      const text = await phase(
        phaseName,
        [
          "go",
          "run",
          "./visual/cmd/astro-fyne-compare",
          "--reference",
          join(directory, "native.png"),
          "--native",
          join(directory, actual),
          "--out",
          join(directory, `${name}-diff.png`),
        ],
        join(root, "native"),
      ).catch(async () => {
        comparisonFailure = true;
        return readFile(join(out, `${phaseName}.stdout.log`), "utf8").catch(
          () => "",
        );
      });
      let result;
      try {
        result = JSON.parse(text);
      } catch {
        comparisonFailure = true;
      }
      const valid =
        phases.find((item) => item.name === phaseName)?.exitCode === 0 &&
        result?.accepted === true &&
        result.exact === true &&
        result.changedPixels === 0 &&
        result.maxChannelDelta === 0 &&
        result.pixelsOverTolerance === 0 &&
        result.totalPixels === 160 * 80 * scale * scale &&
        result.width === 160 * scale &&
        result.height === 80 * scale &&
        result.tolerance.channel === 0 &&
        result.tolerance.pixels === 0;
      if (!valid) comparisonFailure = true;
      comparisons.push({ scale, name, accepted: valid, result });
    }
  }
  await json(join(out, "summary.json"), {
    schema: 1,
    accepted: !comparisonFailure,
    sourceOnly: true,
    tokens: expectedTokens,
    sourceHash: prepared.sourceHash,
    tolerance: { channel: 0, pixels: 0 },
    comparisons,
    preparePhases: prepared.phases,
    verifyPhases: phases,
    limitations: [
      "Literal root declarations and explicit theme/export transport only; no CSS selector or var()-driven paint reconstruction.",
    ],
  });
  assert.equal(comparisons.length, 4);
  assert.equal(
    comparisonFailure,
    false,
    "Strict CSS token roundtrip PNG comparison failed",
  );
}

const mode = process.argv[2];
assert.ok(
  ["prepare", "verify"].includes(mode ?? "") && process.argv.length === 3,
  "Usage: bun ci/css-roundtrip.ts prepare|verify",
);
await mkdir(out, { recursive: true });
try {
  if (mode === "prepare") await prepare();
  else await verify();
} catch (error) {
  await json(join(out, `${mode}-failure.json`), {
    schema: 1,
    accepted: false,
    message: error instanceof Error ? error.message : String(error),
    phases,
  });
  throw error;
}
