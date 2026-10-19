// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import {
  bundleJavascript,
  validateJavascriptArchive,
} from "../src/javascript.ts";
import { generateJavascript } from "../src/javascript-cli.ts";
import { captureCSSHeight } from "../capture/css-height-roundtrip.ts";

const root = resolve(import.meta.dir, ".."),
  out = join(root, "artifacts/css-height-roundtrip"),
  native = join(root, "native/.program-roundtrip/css-height"),
  web = join(root, "example/src/pages/css-height-roundtrip");
const mode = process.argv[2];
assert.ok(
  ["prepare", "verify"].includes(mode ?? "") && process.argv.length === 3,
  "Usage: bun ci/css-height-roundtrip.ts prepare|verify",
);
const hash = (data: Uint8Array | string) =>
  createHash("sha256").update(data).digest("hex");
const phases: {
  name: string;
  argv: string[];
  cwd: string;
  exitCode: number;
}[] = [];
async function json(path: string, data: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2) + "\n");
}
async function command(
  name: string,
  argv: string[],
  cwd = root,
  extra: Record<string, string> = {},
) {
  const child = Bun.spawn(argv, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...Bun.env,
      GOWORK: "off",
      GOFLAGS: "-mod=readonly",
      GOMAXPROCS: "2",
      ...extra,
    },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  await writeFile(join(out, `${name}.stdout.log`), stdout);
  await writeFile(join(out, `${name}.stderr.log`), stderr);
  phases.push({ name, argv, cwd: relative(root, cwd) || ".", exitCode });
  await json(join(out, `${mode}-phases.json`), phases);
  assert.equal(exitCode, 0, `${name} failed; retained logs in ${out}`);
  return stdout;
}
async function retain(path: string, target: string) {
  await mkdir(target, { recursive: true });
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const source = join(path, entry.name),
      destination = join(target, entry.name);
    if (entry.isDirectory()) await retain(source, destination);
    else if (entry.isFile())
      await writeFile(destination, await readFile(source));
  }
}
function generatedDriver(browser = false) {
  return `// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
package heightprobe
import("encoding/json";"os";"path/filepath";"testing";"fyne.io/fyne/v2";"fyne.io/fyne/v2/driver/software";"fyne.io/fyne/v2/test";js "github.com/thinkddr/astro-fyne/native/javascript")
func TestGeneratedHeightConstructor(t *testing.T){
 app:=test.NewApp();defer app.Quit();output:=os.Getenv("ASTRO_FYNE_HEIGHT_OUTPUT");if output==""{t.Fatal("missing output")};records:=[]any{}
 mount:=func(create func()(*js.Widget,error))*js.Widget{w,err:=create();if err!=nil{t.Fatal(err)};t.Cleanup(func(){if err:=w.Close();err!=nil{t.Error(err)}});canvas:=software.NewCanvas();canvas.SetPadded(false);canvas.SetContent(w);canvas.Resize(fyne.NewSize(320,240));w.Resize(fyne.NewSize(320,240));if err:=w.BindCanvas(canvas);err!=nil{t.Fatal(err)};canvas.Capture();return w}
 check:=func(w *js.Widget,time float64,height float32,state string){actual,err:=w.AnimationState();if err!=nil{t.Fatal(err)};panel,sibling:=w.Object("height-panel"),w.Object("height-sibling");if actual.TimeMS!=time||actual.PlayState!=state||panel==nil||sibling==nil||panel.Size().Height!=height||sibling.Position().Y!=height{t.Fatalf("generated constructor disagrees: %+v panel=%v sibling=%v",actual,panel,sibling)};records=append(records,map[string]any{"animation":actual,"height":panel.Size().Height,"followingY":sibling.Position().Y})}
 ${browser ? `w:=mount(func()(*js.Widget,error){return NewBrowserHeightWithOptions(nil,nil,js.Options{ManualAnimations:true})});check(w,700,68,"paused");if err:=w.PlayAnimations();err!=nil{t.Fatal(err)};if err:=w.AdvanceAnimations(800);err!=nil{t.Fatal(err)};check(w,800,76,"running")` : `w:=mount(func()(*js.Widget,error){return NewHeightWithOptions(nil,nil,js.Options{ManualAnimations:true})});check(w,0,20,"running");panel:=w.Object("height-panel");if err:=w.AdvanceAnimations(350);err!=nil{t.Fatal(err)};check(w,350,40,"running");if w.Object("height-panel")!=panel{t.Fatal("generated widget replaced the panel")};restored:=mount(func()(*js.Widget,error){return NewRestoredHeightWithOptions(nil,nil,js.Options{ManualAnimations:true})});check(restored,350,40,"running");if restored.Object("height-panel")==panel{t.Fatal("generated constructors shared widget objects")};if err:=restored.AdvanceAnimations(600);err!=nil{t.Fatal(err)};check(restored,600,60,"running");check(w,350,40,"running")`}
 data,err:=json.MarshalIndent(map[string]any{"schema":1,"actualGeneratedConstructor":true,"samples":records},"","  ");if err!=nil{t.Fatal(err)};if err=os.WriteFile(filepath.Join(output,"${browser ? "browser-generated-constructor.json" : "generated-constructor.json"}"),data,0644);err!=nil{t.Fatal(err)}
}
`;
}
async function executeGenerated(directory: string, label: string) {
  const files = (await readdir(directory))
    .filter((file) => file.endsWith(".go"))
    .map((file) => join(directory, file));
  await command(`${label}-format`, ["gofmt", "-w", ...files]);
  const binary = join(out, `${label}.test`);
  await command(
    `${label}-build`,
    [
      "go",
      "test",
      "-c",
      "-race",
      "-p=1",
      "-o",
      binary,
      "./" + relative(join(root, "native"), directory),
    ],
    join(root, "native"),
  );
  const info = await command(`${label}-build-info`, [
    "go",
    "version",
    "-m",
    binary,
  ]);
  await json(join(out, `${label}-binary.json`), {
    schema: 1,
    path: relative(root, binary),
    hash: hash(await readFile(binary)),
    buildInfoHash: hash(info),
  });
  await command(
    label,
    [binary, "-test.run=^TestGeneratedHeightConstructor$", "-test.v"],
    root,
    { ASTRO_FYNE_HEIGHT_OUTPUT: out },
  );
}
if (mode === "prepare") {
  await mkdir(out, { recursive: true });
  const archive = await bundleJavascript(
    join(root, "example/src/components/JavascriptCSSHeight.tsx"),
  );
  assert.equal(archive.schema, 2);
  const input = join(out, "source.javascript.json");
  await json(input, archive);
  await generateJavascript({
    program: input,
    out: native,
    name: "Height",
    direction: "native",
    packageName: "heightprobe",
  });
  await command("generated-go-format", [
    "gofmt",
    "-w",
    join(native, "Height.gen.go"),
  ]);
  await command(
    "generated-go-build",
    ["go", "build", "-p=1", "./.program-roundtrip/css-height"],
    join(root, "native"),
  );
  const binary = join(out, "height-native.test");
  await command(
    "native-build",
    ["go", "test", "-c", "-race", "-p=1", "-o", binary, "./javascript"],
    join(root, "native"),
  );
  const buildInfo = await command("native-build-info", [
    "go",
    "version",
    "-m",
    binary,
  ]);
  await json(join(out, "native-binary.json"), {
    schema: 1,
    path: relative(root, binary),
    hash: hash(await readFile(binary)),
    buildInfoHash: hash(buildInfo),
  });
  await command(
    "native-source-probe",
    [binary, "-test.run=^TestSourceCSSHeightProbe$", "-test.v"],
    root,
    { ASTRO_FYNE_HEIGHT_INPUT: input, ASTRO_FYNE_HEIGHT_OUTPUT: out },
  );
  const checkpoint = await validateJavascriptArchive(
    JSON.parse(await readFile(join(out, "checkpoint.javascript.json"), "utf8")),
  );
  assert.equal(checkpoint.animation!.timeMs, 350);
  assert.deepEqual(checkpoint.stylesheets, archive.stylesheets);
  await generateJavascript({
    archive: checkpoint,
    out: native,
    name: "RestoredHeight",
    direction: "native",
    packageName: "heightprobe",
  });
  await writeFile(join(native, "height_generated_test.go"), generatedDriver());
  await executeGenerated(native, "generated-constructor");
  await generateJavascript({
    archive,
    out: web,
    name: "Height",
    direction: "web",
  });
  await generateJavascript({
    archive: checkpoint,
    out: web,
    name: "RestoredHeight",
    direction: "web",
  });
  await generateJavascript({
    archive: { ...archive, props: { eased: true } },
    out: web,
    name: "EasedHeight",
    direction: "web",
  });
  for (const [index, sheet] of (archive.stylesheets ?? []).entries())
    for (const [directory, name] of [
      [native, "Height"],
      [web, "Height"],
      [web, "RestoredHeight"],
      [web, "EasedHeight"],
    ]) {
      const bytes = await readFile(
        join(
          directory!,
          `${name}.css-sources/${String(index).padStart(4, "0")}-${sheet.hash}.css`,
        ),
      );
      assert.equal(hash(bytes), sheet.hash);
      assert.ok(bytes.equals(Buffer.from(sheet.text)));
    }
  await writeFile(
    join(web, "HeightHarness.tsx"),
    `// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import {h,createRef} from "preact";
import {useLayoutEffect,useState} from "preact/hooks";
import Height from "./_Height-javascript/Height.tsx";
import RestoredHeight from "./_RestoredHeight-javascript/RestoredHeight.tsx";
import EasedHeight from "./_EasedHeight-javascript/EasedHeight.tsx";
import type {JavascriptHandle} from "./_Height-javascript/javascript-view.ts";
const ref=createRef<JavascriptHandle>(),params=new URLSearchParams(location.search),automatic=params.has("auto"),manual={manual:true},controlled={manual:false,now:()=>{reads++;return now}},options=automatic?controlled:manual;
let now=0,reads=0;
export default function HeightHarness(){const [mounted,setMounted]=useState(true);useLayoutEffect(()=>{(window as any).afyHeight={ready:()=>{try{return !!ref.current?.exportJavascript()}catch{return false}},export:()=>ref.current!.exportJavascript(),advance:(time:number)=>ref.current!.advanceAnimations!(time),pause:()=>ref.current!.pauseAnimations!(),play:()=>ref.current!.playAnimations!(),clock:(time:number)=>{now=time},reads:()=>reads,unmount:()=>setMounted(false)};},[]);const Program=params.has("restore")?RestoredHeight:params.has("eased")?EasedHeight:Height;return mounted?h(Program,{ref,animation:options}):null;}
`,
  );
  await writeFile(
    join(web, "index.astro"),
    `---\n// SPDX-License-Identifier: Apache-2.0\nimport HeightHarness from "./HeightHarness.tsx";\n---\n<html lang="en"><head><meta charset="utf-8"/><title>CSS height roundtrip</title></head><body><HeightHarness client:only="preact"/></body></html>\n<style is:global>html,body{margin:0;padding:0;background:#ffffff}</style>\n`,
  );
  await retain(native, join(out, "generated-native"));
  await retain(web, join(out, "generated-web"));
  const implementation = [
    "src/javascript.ts",
    "src/javascript-cli.ts",
    "src/javascript-css.ts",
    "src/javascript-css-height.ts",
    "src/javascript-css-runtime.js",
    "src/javascript-height-runtime.js",
    "src/javascript-runtime.js",
    "src/javascript-dom.js",
    "src/javascript-view.ts",
    "src/javascript-data.ts",
    "src/javascript-types.ts",
    "src/motion-sample.js",
    "src/motion.ts",
    "native/javascript/runtime.go",
    "native/javascript/animations.go",
    "native/javascript/archive_json.go",
    "native/javascript/height_probe_test.go",
    "ci/css-height-roundtrip.ts",
    "capture/css-height-roundtrip.ts",
    "capture/css-height-quantization.ts",
    "capture/css-height-scale-oracle.ts",
    "capture/browser-provenance.ts",
    "example/src/components/JavascriptCSSHeight.tsx",
    "example/src/components/javascript-css-height.css",
    "example/src/pages/css-height-original.astro",
  ];
  await json(join(out, "prepare.json"), {
    schema: 1,
    kind: "astro-fyne-css-height-profile",
    codeHash: archive.codeHash,
    sources: archive.sources,
    stylesheets: archive.stylesheets?.map(({ path, hash }) => ({ path, hash })),
    implementation: await Promise.all(
      implementation.map(async (path) => {
        const bytes = await readFile(join(root, path)),
          target = join(out, "implementation", path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, bytes);
        return { path, hash: hash(bytes) };
      }),
    ),
  });
} else {
  const binary = JSON.parse(
    await readFile(join(out, "native-binary.json"), "utf8"),
  );
  assert.equal(hash(await readFile(join(root, binary.path))), binary.hash);
  await captureCSSHeight("http://127.0.0.1:4321", out);
  const browserInput = join(out, "browser-checkpoint.javascript.json"),
    browserNative = join(root, "native/.program-roundtrip/css-height-browser");
  await generateJavascript({
    program: browserInput,
    out: browserNative,
    name: "BrowserHeight",
    direction: "native",
    packageName: "heightprobe",
  });
  await command("browser-generated-go-format", [
    "gofmt",
    "-w",
    join(browserNative, "BrowserHeight.gen.go"),
  ]);
  await command(
    "browser-generated-go-build",
    ["go", "build", "-p=1", "./.program-roundtrip/css-height-browser"],
    join(root, "native"),
  );
  await command(
    "browser-native-restore",
    [
      join(root, binary.path),
      "-test.run=^TestBrowserCSSHeightRestore$",
      "-test.v",
    ],
    root,
    {
      ASTRO_FYNE_HEIGHT_BROWSER_INPUT: browserInput,
      ASTRO_FYNE_HEIGHT_OUTPUT: out,
    },
  );
  await writeFile(
    join(browserNative, "height_generated_test.go"),
    generatedDriver(true),
  );
  await executeGenerated(browserNative, "browser-generated-constructor");
  await retain(browserNative, join(out, "generated-browser-native"));
  const prepare = JSON.parse(await readFile(join(out, "prepare.json"), "utf8"));
  for (const file of prepare.implementation)
    assert.equal(
      hash(await readFile(join(root, file.path))),
      file.hash,
      `implementation changed after native build: ${file.path}`,
    );
}
