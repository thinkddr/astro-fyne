// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { generateCatalogue } from "../src/catalogue-cli.ts";
import {
  catalogueBytes,
  catalogueHash,
  parseCatalogue,
  type CatalogueSpec,
} from "../src/catalogue.ts";
import { bundleJavascript } from "../src/javascript.ts";
import { captureCatalogue } from "../capture/catalogue-roundtrip.ts";

const root = resolve(import.meta.dir, ".."),
  out = join(root, "artifacts/catalogue-roundtrip"),
  native = join(root, "native/.program-roundtrip/catalogue-browser"),
  web = join(root, "example/src/pages/catalogue-roundtrip");
const binary = join(out, "catalogue-native.test"),
  name = "CatalogueProbe";
const mode = process.argv[2];
assert.ok(
  ["prepare", "verify"].includes(mode ?? "") && process.argv.length === 3,
  "Usage: bun ci/catalogue-roundtrip.ts prepare|verify",
);
const phases: {
  name: string;
  argv: string[];
  cwd: string;
  exitCode: number;
}[] = [];
async function json(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + "\n");
}
async function command(
  label: string,
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
  await writeFile(join(out, `${label}.stdout.log`), stdout);
  await writeFile(join(out, `${label}.stderr.log`), stderr);
  phases.push({ name: label, argv, cwd: relative(root, cwd) || ".", exitCode });
  await json(join(out, `${mode}-phases.json`), phases);
  assert.equal(exitCode, 0, `${label} failed; retained logs in ${out}`);
  return stdout.trim();
}
async function retainTree(path: string, destination: string) {
  const files: { path: string; hash: string }[] = [];
  async function visit(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const source = join(directory, entry.name);
      if (entry.isDirectory()) await visit(source);
      else {
        const file = relative(path, source),
          bytes = await readFile(source),
          target = join(destination, file);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, bytes);
        files.push({ path: file, hash: catalogueHash(bytes) });
      }
    }
  }
  await visit(path);
  return files;
}
async function retainedBytes(directory: string, spec: CatalogueSpec) {
  for (const sheet of spec.stylesheets)
    assert.ok(
      (
        await readFile(join(directory, `${name}.css-sources/${sheet.hash}.css`))
      ).equals(catalogueBytes(sheet.content, 16 * 1024 * 1024, true)),
      "generated CSS source bytes changed",
    );
  for (const resource of spec.resources) {
    const file = join(
      directory,
      `${name}.catalogue-assets/${resource.hash}.ttf`,
    );
    assert.ok(
      (await readFile(file)).equals(
        catalogueBytes(resource.content, 20 * 1024 * 1024),
      ),
      "generated font bytes changed",
    );
    assert.equal(
      await readFile(`${file}.license.txt`, "utf8"),
      resource.license,
    );
  }
}

const driver = `// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
package catalogueprobe
import("bytes";"encoding/json";"os";"path/filepath";"testing";"fyne.io/fyne/v2";"fyne.io/fyne/v2/test";webui "github.com/thinkddr/astro-fyne/native";"github.com/thinkddr/astro-fyne/native/catalog";js "github.com/thinkddr/astro-fyne/native/javascript";"github.com/thinkddr/astro-fyne/native/fontresource")
type used struct {Count string \`json:"count"\`;PaddingLeft float32 \`json:"paddingLeft"\`;PaddingRight float32 \`json:"paddingRight"\`;Color string \`json:"color"\`;FontFamily string \`json:"fontFamily"\`}
func TestCatalogueBrowserRoundtrip(t *testing.T){
 app:=test.NewApp();defer app.Quit();output:=os.Getenv("ASTRO_FYNE_CATALOGUE_ARTIFACTS");mode:=os.Getenv("ASTRO_FYNE_CATALOGUE_MODE");if output==""{t.Fatal("missing output")}
 check:=func(err error){if err!=nil{t.Fatal(err)}};registry,err:=NewCatalogueProbeCatalogue();check(err)
 if input:=os.Getenv("ASTRO_FYNE_CATALOGUE_INPUT");input!=""{data,err:=os.ReadFile(input);check(err);registry,err=catalog.Parse(data);check(err)}
 calls:=[][]any{};bindings:=func(id string)webui.Actions{return webui.Actions{"observe":func(args ...any)any{calls=append(calls,append([]any{id},args...));return nil}}}
 leftObject,err:=registry.NewIsland("left",bindings("left"));check(err);rightObject,err:=registry.NewIsland("right",bindings("right"));check(err)
 left,right:=leftObject.(*js.Widget),rightObject.(*js.Widget);defer left.Close();defer right.Close();if left==right{t.Fatal("shared native island")};if len(calls)!=0{t.Fatal("restoration repeated effects")}
 objects:=map[string]fyne.CanvasObject{};for id,view:=range map[string]*js.Widget{"left":left,"right":right}{for _,target:=range []string{"catalogue-card","catalogue-count","catalogue-increment"}{object:=view.Object(target);if object==nil{t.Fatal("missing object",id,target)};objects[id+target]=object}}
 for _,target:=range []string{"catalogue-card","catalogue-count","catalogue-increment"}{if objects["left"+target]==objects["right"+target]{t.Fatal("native islands share an object")}}
 capture:=func(view *js.Widget)used{snapshot,err:=view.Snapshot();check(err);value:=used{};found:=0;var visit func([]webui.SnapshotNode);visit=func(nodes []webui.SnapshotNode){for _,node:=range nodes{if node.Node.ID=="catalogue-card"{value.PaddingLeft=node.Node.Style.PaddingLeft;value.PaddingRight=node.Node.Style.PaddingRight;value.Color=node.Node.Style.Color;value.FontFamily=node.Node.Style.FontFamily;found++};if node.Node.ID=="catalogue-count"{value.Count=node.Node.Text;found++};visit(node.Children)}};visit(snapshot.Roots);if found!=2{t.Fatal("missing native used styles")};return value}
 pair:=func()map[string]used{return map[string]used{"left":capture(left),"right":capture(right)}};initial:=pair()
 expectedInitial:=map[string]string{"left":"0","right":"0"};if mode=="verify"{expectedInitial=map[string]string{"left":"2","right":"2"}}
 for id,want:=range expectedInitial{if initial[id].Count!=want{t.Fatalf("initial %s: %+v",id,initial)}}
 target:=left;actionID:="left";if mode=="verify"{target=right;actionID="right"};target.Object("catalogue-increment").(fyne.Tappable).Tapped(nil);check(target.Error());after:=pair()
 expectedAfter:=map[string]string{"left":"1","right":"0"};if mode=="verify"{expectedAfter=map[string]string{"left":"2","right":"3"}}
 for id,want:=range expectedAfter{if after[id].Count!=want{t.Fatalf("after %s: %+v",id,after)}};if len(calls)!=1||calls[0][0]!=actionID{t.Fatal("wrong native effect",calls)}
 for id,view:=range map[string]*js.Widget{"left":left,"right":right}{for _,target:=range []string{"catalogue-card","catalogue-count","catalogue-increment"}{if objects[id+target]!=view.Object(target){t.Fatal("native identity changed")}}}
 checkpoint:=registry;archives:=map[string]js.Archive{};for id,view:=range map[string]*js.Widget{"left":left,"right":right}{archive,err:=view.ExportJavascript();check(err);archives[id]=archive;if id=="left"||mode=="verify"{data,err:=json.Marshal(archive);check(err);checkpoint,err=checkpoint.WithIslandState(id,string(data));check(err)}}
 data,err:=checkpoint.Marshal();check(err);parsed,err:=catalog.Parse(data);check(err);replayCalls:=0;restored:=map[string]used{}
 for _,id:=range []string{"left","right"}{object,err:=parsed.NewIsland(id,webui.Actions{"observe":func(...any)any{replayCalls++;return nil}});check(err);view:=object.(*js.Widget);restored[id]=capture(view);check(view.Close());if restored[id]!=after[id]{t.Fatalf("restored %s differs",id)}};if replayCalls!=0{t.Fatal("repeated host effects")}
 theme,err:=registry.Theme("light",nil);check(err);fontBound:=false;for _,resource:=range registry.Resources(){if resource.MediaType=="font/ttf"&&bytes.Equal(theme.Font(fyne.TextStyle{}).Content(),resource.Content){fontBound=true}};if !fontBound{t.Fatal("unbound native font")}
 check(os.MkdirAll(output,0755));prefix:=filepath.Join(output,"native-"+mode);check(os.WriteFile(prefix+".catalogue.json",append(data,'\\n'),0644));result,err:=json.MarshalIndent(map[string]any{"schema":1,"mode":mode,"initial":initial,"after":after,"restored":restored,"archives":archives,"calls":calls,"replayCalls":replayCalls,"stableNativeObjects":6,"independentVMs":true,"nativeFontBound":fontBound,"pixelPerfectVerified":false},"","  ");check(err);check(os.WriteFile(prefix+".json",append(result,'\\n'),0644))
}
func TestCatalogueFontCoverage(t *testing.T){
 check:=func(err error){if err!=nil{t.Fatal(err)}};output:=os.Getenv("ASTRO_FYNE_CATALOGUE_ARTIFACTS");mode:=os.Getenv("ASTRO_FYNE_CATALOGUE_MODE");if output==""||(mode!="prepare"&&mode!="verify"){t.Fatal("missing coverage output/mode")}
 registry,err:=NewCatalogueProbeCatalogue();check(err)
 if input:=os.Getenv("ASTRO_FYNE_CATALOGUE_INPUT");input!=""{data,err:=os.ReadFile(input);check(err);registry,err=catalog.Parse(data);check(err)}
 profiles:=map[string]fontresource.CoverageProfile{};spec:=registry.Spec()
 for _,face:=range spec.FontFaces{
  found:=false
  for _,resource:=range spec.Resources{if resource.Name!=face.Resource{continue};found=true;before:=bytes.Clone(resource.Content)
   parsed,err:=fontresource.NewStaticFace(resource.Content,face.Weight,face.Style);check(err);profile:=parsed.Profile()
   if profile.Schema!=1||profile.FontHash!=resource.Hash||profile.FontHash!=face.Hash||profile.Weight!=face.Weight||profile.Style!=face.Style||profile.Parser!="github.com/go-text/typesetting@v0.3.4"{t.Fatal("unbound coverage profile",profile)}
   check(parsed.ValidateText("Catalogue roundtrip 0123"));if !parsed.Contains('A')||parsed.Contains(-1)||parsed.Contains(0xd800)||parsed.Contains(0x110000){t.Fatal("invalid scalar coverage")}
   if parsed.ValidateText(string(rune(0x10ffff)))==nil||parsed.ValidateText(string([]byte{255}))==nil{t.Fatal("missing or invalid text was admitted")}
   if !bytes.Equal(before,resource.Content){t.Fatal("coverage changed native resource bytes")};profiles[face.ID]=profile
  };if !found{t.Fatal("missing coverage resource",face.Resource)}
 }
 if len(profiles)!=1{t.Fatal("unexpected fixture coverage count",len(profiles))}
 data,err:=json.MarshalIndent(map[string]any{"schema":1,"mode":mode,"profiles":profiles,"strictAdmissionEnabled":false,"pixelPerfectVerified":false},"","  ");check(err);check(os.MkdirAll(output,0755));check(os.WriteFile(filepath.Join(output,"native-"+mode+".font-coverage.json"),append(data,'\\n'),0644))
}
`;

await mkdir(out, { recursive: true });
if (mode === "prepare") {
  const archive = await bundleJavascript(
    join(root, "example/src/components/CatalogueCounter.tsx"),
    "default",
    {},
    ["observe"],
  );
  assert.equal(archive.stylesheets?.length, 1);
  const font = await readFile(
      join(root, "example/public/fonts/NotoSans-Regular.ttf"),
    ),
    license = await readFile(
      join(root, "example/public/fonts/LICENSE-NotoSans.txt"),
      "utf8",
    );
  const payload = JSON.stringify(archive),
    spec: CatalogueSpec = {
      schema: 1,
      kind: "astro-fyne-catalogue",
      name: "CatalogueRoundtrip",
      resources: [
        {
          name: "fonts/NotoSans-Regular.ttf",
          mediaType: "font/ttf",
          hash: catalogueHash(font),
          content: font.toString("base64"),
          license,
        },
      ],
      stylesheets: archive.stylesheets!.map((sheet, i) => ({
        id: `sheet${i}`,
        path: sheet.path,
        hash: sheet.hash,
        content: Buffer.from(sheet.text).toString("base64"),
      })),
      fontFaces: [
        {
          id: "regular",
          family: "CatalogueNoto",
          weight: 400,
          style: "normal",
          resource: "fonts/NotoSans-Regular.ttf",
          hash: catalogueHash(font),
        },
      ],
      themes: [
        {
          id: "light",
          tokens: { "--color-primary": "#123456" },
          fontFaces: ["regular"],
        },
      ],
      layouts: [],
      components: [
        {
          id: "Counter",
          kind: "javascript",
          payload,
          hash: catalogueHash(payload),
          theme: "light",
          stylesheets: ["sheet0"],
          fontFaces: ["regular"],
          actions: ["observe"],
        },
      ],
      islands: [
        { id: "left", component: "Counter", key: "same-key" },
        { id: "right", component: "Counter", key: "same-key" },
      ],
    };
  await json(join(out, "initial.catalogue.json"), spec);
  await json(join(out, "original.program.json"), archive);
  await generateCatalogue({
    catalogue: join(out, "initial.catalogue.json"),
    out: native,
    name,
    packageName: "catalogueprobe",
    direction: "native",
  });
  await retainedBytes(native, spec);
  await writeFile(join(native, "catalogue_probe_test.go"), driver);
  await command(
    "format-generated-driver",
    ["gofmt", "-w", "catalogue_probe_test.go"],
    native,
  );
  const moduleLocks = await Promise.all(
    ["go.mod", "go.sum"].map((file) => readFile(join(root, "native", file))),
  );
  await command(
    "native-build",
    ["go", "test", "-c", "-race", "-tags", "ci", "-o", binary, "."],
    native,
  );
  await command("native-build-info", ["go", "version", "-m", binary]);
  for (const [index, file] of ["go.mod", "go.sum"].entries())
    assert.ok(
      moduleLocks[index]!.equals(await readFile(join(root, "native", file))),
      "native build changed a module lock",
    );
  await command(
    "native-prepare",
    [binary, "-test.run", "^TestCatalogueBrowserRoundtrip$", "-test.v"],
    native,
    {
      ASTRO_FYNE_CATALOGUE_ARTIFACTS: out,
      ASTRO_FYNE_CATALOGUE_MODE: "prepare",
    },
  );
  await command(
    "native-coverage-prepare",
    [binary, "-test.run", "^TestCatalogueFontCoverage$", "-test.v"],
    native,
    {
      ASTRO_FYNE_CATALOGUE_ARTIFACTS: out,
      ASTRO_FYNE_CATALOGUE_MODE: "prepare",
    },
  );
  const checkpointSource = await readFile(
      join(out, "native-prepare.catalogue.json"),
      "utf8",
    ),
    checkpoint = await parseCatalogue(checkpointSource);
  const nativePrepared = JSON.parse(
    await readFile(join(out, "native-prepare.json"), "utf8"),
  );
  assert.deepEqual(nativePrepared.calls, [["left", 1]]);
  assert.equal(nativePrepared.replayCalls, 0);
  assert.equal(checkpoint.islands[0]!.statePayload !== undefined, true);
  assert.equal(checkpoint.islands[1]!.statePayload, undefined);
  assert.deepEqual(
    checkpoint.islands.map(({ key }) => key),
    ["same-key", "same-key"],
  );
  assert.equal(checkpoint.components[0]!.payload, spec.components[0]!.payload);
  assert.deepEqual(checkpoint.resources, spec.resources);
  assert.deepEqual(checkpoint.fontFaces, spec.fontFaces);
  for (const sheet of checkpoint.stylesheets)
    assert.ok(
      catalogueBytes(sheet.content, 16 * 1024 * 1024).equals(
        Buffer.from(archive.stylesheets![0]!.text),
      ),
    );
  await generateCatalogue({
    catalogue: join(out, "native-prepare.catalogue.json"),
    out: web,
    name,
    direction: "web",
    actionsModule: "./actions.ts",
  });
  await generateCatalogue({
    catalogue: join(out, "native-prepare.catalogue.json"),
    out: web,
    name,
    direction: "web",
    actionsModule: "./actions.ts",
    check: true,
  });
  await retainedBytes(web, checkpoint);
  await writeFile(
    join(web, "actions.ts"),
    "export const actions={observe(){throw new Error('Harness must supply its explicit island actions')}};\n",
  );
  await writeFile(
    join(web, "Harness.tsx"),
    `import {h,createRef} from "preact";import {CatalogueProbeIsland,exportCatalogue} from "./CatalogueProbe.catalogue.tsx";const refs={left:createRef<any>(),right:createRef<any>()};const calls:unknown[][]=[];const actions={left:{observe:(count:number)=>{calls.push(["left",count]);return null}},right:{observe:(count:number)=>{calls.push(["right",count]);return null}}};const handles=()=>({left:refs.left.current!.exportJavascript(),right:refs.right.current!.exportJavascript()});export default function Harness({id}:{id:"left"|"right"}){if(typeof window!=="undefined")(window as any).afyCatalogue={calls:()=>calls.map(call=>[...call]),export:handles,exportCatalogue:()=>exportCatalogue(new Map([["left",refs.left.current!],["right",refs.right.current!]])),ready:()=>{try{handles();return true}catch{return false}},invalid:()=>{const rejected:string[]=[];for(const id of ["constructor","toString"]){try{CatalogueProbeIsland({id})}catch(error){if(!(error instanceof Error)||!error.message.includes("Unknown catalogue island"))throw error;rejected.push(id)}}return rejected}};return <div data-catalogue-island={id}><CatalogueProbeIsland id={id} actions={actions[id]} handleRef={refs[id]}/></div>};\n`,
  );
  await writeFile(
    join(web, "index.astro"),
    '---\nimport Harness from "./Harness.tsx";\n---\n<html lang="en"><head><title>Catalogue roundtrip</title></head><body><Harness id="left" client:only="preact" /><Harness id="right" client:only="preact" /></body></html>\n',
  );
  const sourceFiles = [
    "ci/catalogue-roundtrip.ts",
    "capture/catalogue-roundtrip.ts",
    "example/src/components/CatalogueCounter.tsx",
    "example/src/components/catalogue-counter.css",
    "src/catalogue.ts",
    "src/json-source.ts",
    "src/catalogue-types.ts",
    "src/catalogue-web.ts",
    "src/catalogue-cli.ts",
    "src/fonts.ts",
    "src/fonts.test.ts",
    "src/font-family.ts",
    "src/font-family-data.ts",
    "src/font-family-css.ts",
    "src/font-family-css.test.ts",
    "src/javascript-font-aliases.test.ts",
    "src/javascript-font-escapes.test.ts",
    "src/javascript-checkpoints.test.ts",
    "src/catalogue.test.ts",
    "src/javascript-runtime.js",
    "src/javascript-dom.js",
    "src/javascript.ts",
    "src/javascript-cli.ts",
    "src/javascript-view.ts",
    "src/javascript-managed-dom.ts",
    "src/javascript-data.ts",
    "src/javascript-css.ts",
    "src/javascript-css-runtime.js",
    "native/javascript/runtime.go",
    "native/javascript/animations.go",
    "native/javascript/archive_ownership_test.go",
    "native/javascript/font_resources.go",
    "native/javascript/font_resources_test.go",
    "native/javascript/nodes.go",
    "native/font_resources.go",
    "native/font_resources_test.go",
    "native/fontresource/validate.go",
    "native/fontresource/validate_test.go",
    "native/fontresource/coverage.go",
    "native/fontresource/coverage_test.go",
    "native/fontresource/coverage_identity_test.go",
    "native/go.mod",
    "native/go.sum",
    "package.json",
    "bun.lock",
    ".github/workflows/ci.yml",
    "example/public/fonts/NotoSans-Regular.ttf",
    "example/public/fonts/NotoSans-Bold.ttf",
    "example/public/fonts/LICENSE-NotoSans.txt",
    ...(await readdir(join(root, "native/catalog")))
      .filter((file) => file.endsWith(".go"))
      .map((file) => `native/catalog/${file}`),
  ];
  const inputs = [];
  for (const [index, path] of sourceFiles.entries()) {
    const bytes = await readFile(join(root, path)),
      file = `inputs/${String(index).padStart(4, "0")}.source`;
    await mkdir(join(out, "inputs"), { recursive: true });
    await writeFile(join(out, file), bytes);
    inputs.push({ path, file, hash: catalogueHash(bytes) });
  }
  await json(join(out, "inputs.json"), inputs);
  const generatedNative = await retainTree(
      native,
      join(out, "generated-native"),
    ),
    generatedWeb = await retainTree(web, join(out, "generated-web"));
  await json(join(out, "prepare.json"), {
    schema: 1,
    sourceCommit: await command("source-commit", ["git", "rev-parse", "HEAD"]),
    sourceTree: await command("source-tree", [
      "git",
      "rev-parse",
      "HEAD^{tree}",
    ]),
    inputHash: catalogueHash(await readFile(join(out, "inputs.json"))),
    fontHash: catalogueHash(font),
    binaryHash: catalogueHash(await readFile(binary)),
    buildInfoHash: catalogueHash(
      await readFile(join(out, "native-build-info.stdout.log")),
    ),
    generatedNative,
    generatedWeb,
    nativeCatalogueHash: catalogueHash(checkpointSource),
    pixelPerfectVerified: false,
  });
} else {
  const prepared = JSON.parse(
    await readFile(join(out, "prepare.json"), "utf8"),
  );
  assert.equal(catalogueHash(await readFile(binary)), prepared.binaryHash);
  await captureCatalogue("http://127.0.0.1:4321/catalogue-roundtrip/", out);
  const browser = JSON.parse(
    await readFile(join(out, "browser.json"), "utf8"),
  ) as { exportedCatalogue: CatalogueSpec };
  const spec = await parseCatalogue(JSON.stringify(browser.exportedCatalogue));
  await json(join(out, "browser.catalogue.json"), spec);
  await command(
    "native-verify",
    [binary, "-test.run", "^TestCatalogueBrowserRoundtrip$", "-test.v"],
    native,
    {
      ASTRO_FYNE_CATALOGUE_ARTIFACTS: out,
      ASTRO_FYNE_CATALOGUE_MODE: "verify",
      ASTRO_FYNE_CATALOGUE_INPUT: join(out, "browser.catalogue.json"),
    },
  );
  await command(
    "native-coverage-verify",
    [binary, "-test.run", "^TestCatalogueFontCoverage$", "-test.v"],
    native,
    {
      ASTRO_FYNE_CATALOGUE_ARTIFACTS: out,
      ASTRO_FYNE_CATALOGUE_MODE: "verify",
      ASTRO_FYNE_CATALOGUE_INPUT: join(out, "browser.catalogue.json"),
    },
  );
  const originalCoverage = JSON.parse(
    await readFile(join(out, "native-prepare.font-coverage.json"), "utf8"),
  );
  const returnedCoverage = JSON.parse(
    await readFile(join(out, "native-verify.font-coverage.json"), "utf8"),
  );
  assert.deepEqual(returnedCoverage.profiles, originalCoverage.profiles);
  assert.equal(originalCoverage.strictAdmissionEnabled, false);
  assert.equal(returnedCoverage.strictAdmissionEnabled, false);
  const restored = await parseCatalogue(
    await readFile(join(out, "native-verify.catalogue.json"), "utf8"),
  );
  assert.deepEqual(restored.stylesheets, spec.stylesheets);
  assert.deepEqual(restored.resources, spec.resources);
  assert.deepEqual(restored.fontFaces, spec.fontFaces);
  assert.deepEqual(restored.components, spec.components);
  const result = JSON.parse(
    await readFile(join(out, "native-verify.json"), "utf8"),
  );
  assert.equal(result.initial.left.count, "2");
  assert.equal(result.initial.right.count, "2");
  assert.equal(result.after.left.count, "2");
  assert.equal(result.after.right.count, "3");
  assert.equal(result.replayCalls, 0);
  assert.deepEqual(result.calls, [["right", 3]]);
  await json(join(out, "summary.json"), {
    schema: 1,
    accepted: true,
    sourceCommit: prepared.sourceCommit,
    sourceTree: prepared.sourceTree,
    browserHash: catalogueHash(await readFile(join(out, "browser.json"))),
    nativePrepareHash: catalogueHash(
      await readFile(join(out, "native-prepare.json")),
    ),
    nativeVerifyHash: catalogueHash(
      await readFile(join(out, "native-verify.json")),
    ),
    nativeBinaryHash: prepared.binaryHash,
    sourceInputsHash: prepared.inputHash,
    realAstroIslands: 2,
    independentNativeVMs: true,
    stableNativeObjectsPerPhase: 6,
    actualFontBytesVerified: true,
    nominalCoveragePreserved: true,
    nativeCoveragePrepareHash: catalogueHash(
      await readFile(join(out, "native-prepare.font-coverage.json")),
    ),
    nativeCoverageVerifyHash: catalogueHash(
      await readFile(join(out, "native-verify.font-coverage.json")),
    ),
    strictFontAdmissionEnabled: false,
    stylesheetCopiesExact: true,
    nativeBrowserNativeContinuation: true,
    pixelPerfectVerified: false,
    universalCSSVerified: false,
  });
}
