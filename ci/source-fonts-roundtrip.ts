// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import assert from "node:assert/strict";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import {
  catalogueHash,
  parseCatalogue,
  type CatalogueSpec,
} from "../src/catalogue.ts";
import { captureSourceFonts } from "../capture/source-fonts-roundtrip.ts";

const mode = process.argv[2],
  escaped = process.argv[3] === "--css-escapes",
  matching = process.argv[3] === "--unicode-matching",
  unicode = escaped || matching || process.argv[3] === "--unicode",
  root = resolve(import.meta.dir, ".."),
  stem = escaped
    ? "source-fonts-css-escapes"
    : matching
      ? "source-fonts-unicode-matching"
      : unicode
        ? "source-fonts-unicode"
        : "source-fonts",
  family = escaped
    ? "EscapedStraße"
    : matching
      ? "Ι".repeat(80)
      : unicode
        ? "SourceStraße"
        : "SourceNoto",
  aliases: readonly [string, string] = escaped
    ? ["ESCAPEDSTRA\\1e9e E", '"EscapedStra\\df e"']
    : matching
      ? ["\u0345".repeat(80), "\u03b9".repeat(80)]
      : ["SOURCESTRAẞE", "sourceſtraße"],
  originalPackage = escaped
    ? "sourcefontsescapedprobe"
    : matching
      ? "sourcefontsmatchingprobe"
      : unicode
        ? "sourcefontsunicodeprobe"
        : "sourcefontsprobe",
  returnedPackage = escaped
    ? "sourcefontsescapedreturned"
    : matching
      ? "sourcefontsmatchingreturned"
      : unicode
        ? "sourcefontsunicodereturned"
        : "sourcefontsreturned",
  out = join(root, "artifacts", stem + "-roundtrip"),
  foreign = join(out, "foreign"),
  fixture = join(out, "fixture"),
  original = join(root, "native/.program-roundtrip", stem + "-original"),
  returned = join(root, "native/.program-roundtrip", stem + "-returned"),
  web = join(root, "example/src/pages", stem + "-roundtrip");
assert.ok(
  ["prepare", "verify"].includes(mode ?? "") &&
    (process.argv.length === 3 || (process.argv.length === 4 && unicode)),
  "Usage: bun ci/source-fonts-roundtrip.ts prepare|verify [--unicode|--unicode-matching|--css-escapes]",
);
const phases: {
  name: string;
  argv: string[];
  cwd: string;
  exitCode: number;
}[] = [];
async function save(path: string, content: string | Uint8Array) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}
async function json(path: string, value: unknown) {
  await save(path, JSON.stringify(value, null, 2) + "\n");
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
  await save(join(out, label + ".stdout.log"), stdout);
  await save(join(out, label + ".stderr.log"), stderr);
  phases.push({ name: label, argv, cwd: relative(root, cwd), exitCode });
  await json(join(out, mode + "-phases.json"), phases);
  assert.equal(exitCode, 0, label + " failed; retained output in " + out);
  return stdout.trim();
}
async function tree(path: string, destination: string) {
  const files: { path: string; hash: string; bytes: number }[] = [];
  async function visit(directory: string) {
    for (const entry of (
      await readdir(directory, { withFileTypes: true })
    ).sort((a, b) => a.name.localeCompare(b.name))) {
      const source = join(directory, entry.name);
      if (entry.isDirectory()) await visit(source);
      else {
        assert.ok(entry.isFile(), "unexpected generated symlink");
        const file = relative(path, source),
          bytes = await readFile(source);
        await save(join(destination, file), bytes);
        files.push({
          path: file,
          hash: catalogueHash(bytes),
          bytes: bytes.length,
        });
      }
    }
  }
  await visit(path);
  return files;
}
async function resources(directory: string, name: string, spec: CatalogueSpec) {
  for (const resource of spec.resources) {
    assert.equal(resource.mediaType, "font/ttf");
    const path = join(
        directory,
        name + ".catalogue-assets",
        resource.hash + ".ttf",
      ),
      bytes = Buffer.from(resource.content, "base64");
    assert.ok((await readFile(path)).equals(bytes));
    assert.equal(catalogueHash(bytes), resource.hash);
    assert.equal(
      await readFile(path + ".license.txt", "utf8"),
      resource.license,
    );
  }
  for (const sheet of spec.stylesheets)
    assert.ok(
      (
        await readFile(
          join(directory, name + ".css-sources", sheet.hash + ".css"),
        )
      ).equals(Buffer.from(sheet.content, "base64")),
    );
}
function sameMetadata(actual: CatalogueSpec, expected: CatalogueSpec) {
  for (const key of [
    "schema",
    "kind",
    "name",
    "resources",
    "fontFaces",
    "stylesheets",
    "themes",
    "layouts",
    "components",
    "motions",
  ] as const)
    assert.deepEqual(
      actual[key],
      expected[key],
      "catalogue metadata changed: " + key,
    );
  assert.deepEqual(
    actual.islands.map(({ statePayload, stateHash, ...identity }) => identity),
    expected.islands.map(
      ({ statePayload, stateHash, ...identity }) => identity,
    ),
  );
}
const unicodeCapture =
  'families:=map[string]string{};var visitFamilies func([]webui.SnapshotNode);visitFamilies=func(nodes []webui.SnapshotNode){for _,node:=range nodes{switch node.Node.ID{case "font-root","font-count","font-increment","font-seed":if node.Node.Style.FontFamily!=`"SourceStraße"`{t.Fatal("native family was not canonical",node.Node.ID,node.Node.Style.FontFamily)};families[node.Node.ID]=node.Node.Style.FontFamily};visitFamilies(node.Children)}};visitFamilies(snapshot.Roots);if len(families)!=4{t.Fatal("missing canonical native families",families)};archive,err:=widget.ExportJavascript();check(err);var frames []js.Frame;check(json.Unmarshal(archive.Frame,&frames));authored:="";var visitAuthored func([]js.Frame);visitAuthored=func(nodes []js.Frame){for _,node:=range nodes{if node.Attrs["id"]=="font-root"{authored=node.Attrs["data-authored-family"]};visitAuthored(node.Children)}};visitAuthored(frames);wantAuthored:="sourceſtraße";if count=="Native override:0"||count=="Native override:2"||count=="Original props:0"{wantAuthored="SOURCESTRAẞE"};if authored!=wantAuthored{t.Fatal("authored family probe did not follow the real click",authored,wantAuthored)};state["fontFamilies"]=families;state["authoredFamily"]=authored';
const matchingCapture =
  matching || escaped
    ? unicodeCapture
        .replace('`"SourceStraße"`', JSON.stringify(JSON.stringify(family)))
        .replace('"sourceſtraße"', JSON.stringify(aliases[1]))
        .replace('"SOURCESTRAẞE"', JSON.stringify(aliases[0]))
    : unicodeCapture;
async function buildDriver(directory: string, phase: "prepare" | "verify") {
  const packageName = phase === "prepare" ? originalPackage : returnedPackage,
    constructor =
      phase === "prepare"
        ? "NewSourceFontsCatalogue"
        : "NewReturnedFontsCatalogue",
    makeView =
      phase === "prepare"
        ? 'cold,err:=NewSourceFonts(nil,actions);check(err);coldArchive,err:=cold.ExportJavascript();check(err);coldData,err:=json.Marshal(coldArchive);check(err);check(os.WriteFile(filepath.Join(output,"native-cold.program.json"),coldData,0644));check(cold.Close());if len(calls)!=0{t.Fatal("cold constructor emitted host actions")};view,err:=NewSourceFontsWithOptions(webui.Scope{"label":"Native override"},actions,js.Options{ManualAnimations:true});check(err)'
        : 'restoredObject,err:=registry.NewIsland("app",actions);check(err);view,ok:=restoredObject.(*js.Widget);if !ok{t.Fatal("returned constructor did not produce a JavaScript widget")}',
    exportState =
      phase === "prepare"
        ? "data,err:=ExportSourceFontsCatalogue(view);check(err)"
        : 'payload,err:=json.Marshal(afterArchive);check(err);checkpoint,err:=registry.WithIslandState("app",string(payload));check(err);data,err:=checkpoint.Marshal();check(err)',
    checkAstro =
      phase === "prepare"
        ? '{ast,err:=NewAstroFonts(nil,nil);check(err);defer ast.Close();astRegistry,err:=NewAstroFontsCatalogue();check(err);if !reflect.DeepEqual(astRegistry.Spec().Resources,registry.Spec().Resources)||!reflect.DeepEqual(astRegistry.Spec().FontFaces,registry.Spec().FontFaces){t.Fatal("Astro source lost font bindings")};astWindow:=test.NewWindow(ast);defer astWindow.Close();astWindow.SetPadded(false);astWindow.Resize(fyne.NewSize(420,200));ast.SetViewport(420,200);check(ast.BindCanvas(astWindow.Canvas()));astWindow.Canvas().Capture();astInitial:=capture(ast);if astInitial["count"]!="Original props:0"{t.Fatal("Astro JSON props did not mount",astInitial)};point:=sourceClick(t,ast,astWindow);astAfter:=capture(ast);if astAfter["count"]!="Original props:1"||astAfter["seed"]!=astInitial["seed"]||len(calls)!=0{t.Fatal("Astro JSON source did not continue without host actions",astAfter)};for _,row:=range []struct{id,text string;weight int}{{"font-count","Original props:1",400},{"font-increment","Increment",700},{"font-seed",astAfter["seed"].(string),400}}{found:=false;for _,face:=range astRegistry.Spec().FontFaces{if face.Weight==row.weight&&sourceFontHash(sourcePainted(t,ast.Object(row.id),row.text).FontSource.Content())==face.Hash{found=true}};if !found{t.Fatal("Astro painter lost its licensed face",row.id)}};astData,err:=ExportAstroFontsCatalogue(ast);check(err);check(os.WriteFile(filepath.Join(output,"native-astro-source.catalogue.json"),astData,0644));observation,err:=json.MarshalIndent(map[string]any{"schema":1,"sourceKind":"astro-json-props","initial":astInitial,"after":astAfter,"physicalClick":map[string]float32{"x":point.X,"y":point.Y},"hostCalls":len(calls),"pixelPerfectVerified":false},"","  ");check(err);check(os.WriteFile(filepath.Join(output,"native-astro-source.json"),observation,0644))}'
        : "",
    checkFontRejections =
      phase === "prepare" && unicode && !matching && !escaped
        ? 'sourceFontRejections(t,output,actions,func()int{return len(calls)},[]sourceFontRejectionCase{{constructor:"NewRejectedFontsWithOptions",sourceFile:"RejectedFonts.tsx",manifestFile:"fonts.json",canonical:"SourceStraße",authored:"SOURCESTRASSE",class:"full-fold-only",catalogue:NewRejectedFontsCatalogue,construct:NewRejectedFontsWithOptions},{constructor:"NewRejectedAstralFontsWithOptions",sourceFile:"RejectedAstralFonts.tsx",manifestFile:"fonts-astral.json",canonical:"𐐀Source",authored:"𐐨Source",class:"changed astral",catalogue:NewRejectedAstralFontsCatalogue,construct:NewRejectedAstralFontsWithOptions}})'
        : "",
    source = (
      await readFile(join(root, "ci/source-fonts-probe.go.txt"), "utf8")
    )
      .replaceAll("PROBE_PACKAGE", packageName)
      .replaceAll("PROBE_CATALOGUE", constructor)
      .replaceAll("MAKE_VIEW", makeView)
      .replaceAll("CHECK_ASTRO", checkAstro)
      .replaceAll("CHECK_FONT_REJECTIONS", checkFontRejections)
      .replaceAll("CAPTURE_FAMILY", unicode ? matchingCapture : "")
      .replaceAll("EXPORT_STATE", exportState),
    binary = join(out, "source-fonts-" + phase + ".test"),
    locks = await Promise.all(
      ["go.mod", "go.sum"].map((file) => readFile(join(root, "native", file))),
    );
  await save(join(directory, "source_fonts_probe_test.go"), source);
  await command(
    phase + "-format-driver",
    ["gofmt", "-w", "source_fonts_probe_test.go"],
    directory,
  );
  await command(
    phase + "-build",
    ["go", "test", "-c", "-race", "-tags", "ci", "-p=1", "-o", binary, "."],
    directory,
  );
  await command(phase + "-build-info", ["go", "version", "-m", binary]);
  for (const [index, file] of ["go.mod", "go.sum"].entries())
    assert.ok(
      locks[index]!.equals(await readFile(join(root, "native", file))),
      "build changed a module lock",
    );
  await command(
    phase + "-native-tests",
    [
      "go",
      "tool",
      "test2json",
      "-p",
      "github.com/thinkddr/astro-fyne/native/" +
        relative(join(root, "native"), directory),
      "-t",
      binary,
      "-test.v=test2json",
      "-test.count=1",
    ],
    directory,
    {
      ASTRO_FYNE_SOURCE_FONTS_OUTPUT: out,
      ASTRO_FYNE_SOURCE_FONTS_MODE: phase,
    },
  );
  const events = (
    await readFile(join(out, phase + "-native-tests.stdout.log"), "utf8")
  )
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.ok(
    !events.some((event) => event.Action === "fail" || event.Action === "skip"),
  );
  assert.equal(
    events.filter(
      (event) =>
        event.Action === "pass" && event.Test === "TestSourceFontsRoundtrip",
    ).length,
    1,
  );
  return {
    binary: relative(out, binary),
    binaryHash: catalogueHash(await readFile(binary)),
    buildInfoHash: catalogueHash(
      await readFile(join(out, phase + "-build-info.stdout.log")),
    ),
  };
}

await mkdir(out, { recursive: true });
await mkdir(foreign, { recursive: true });
if (mode === "prepare") {
  const regular = await readFile(
      join(root, "example/public/fonts/NotoSans-Regular.ttf"),
    ),
    bold = await readFile(join(root, "example/public/fonts/NotoSans-Bold.ttf")),
    license = Buffer.from(
      "\ufeff" +
        (
          await readFile(
            join(root, "example/public/fonts/LICENSE-NotoSans.txt"),
            "utf8",
          )
        ).replace(/\r?\n/g, "\r\n"),
    );
  await save(join(fixture, "fonts/regular.ttf"), regular);
  await save(join(fixture, "fonts/bold.ttf"), bold);
  await save(join(fixture, "fonts/OFL.txt"), license);
  await json(join(fixture, "fonts.json"), {
    schema: 1,
    kind: "astro-fyne-font-manifest",
    faces: [
      {
        family,
        weight: 400,
        style: "normal",
        source: "fonts/regular.ttf",
        license: "fonts/OFL.txt",
        hash: catalogueHash(regular),
        licenseHash: catalogueHash(license),
      },
      {
        family,
        weight: 700,
        style: "normal",
        source: "fonts/bold.ttf",
        license: "fonts/OFL.txt",
      },
    ],
  });
  await json(join(fixture, "props.json"), { label: "Original props" });
  await save(
    join(fixture, "App.astro"),
    '---\nimport Counter from "./Counter.tsx";\n---\n<Counter client:only="preact" label={Astro.props.label}/>\n',
  );
  await save(
    join(fixture, "Counter.tsx"),
    matching || escaped
      ? 'import {useState} from "preact/hooks";import "./counter.css";export default function Counter({label,observe}){const[count,setCount]=useState(0);const[seed]=useState(()=>String(Date.now())+":"+String(Math.random()));const family=count%2?' +
          JSON.stringify(aliases[1]) +
          ":" +
          JSON.stringify(aliases[0]) +
          ';return <div id="font-root" data-authored-family={family} style={{fontFamily:family}}><p id="font-count">{label}:{count}</p><button id="font-increment" onClick={()=>{setCount(count+1);if(observe)observe(count+1)}}>Increment</button><p id="font-seed">{seed}</p></div>}\n'
      : unicode
        ? 'import {useState} from "preact/hooks";import "./counter.css";export default function Counter({label,observe}){const[count,setCount]=useState(0);const[seed]=useState(()=>String(Date.now())+":"+String(Math.random()));const family=count%2?"sourceſtraße":"SOURCESTRAẞE";return <div id="font-root" data-authored-family={family} style={{fontFamily:family}}><p id="font-count">{label}:{count}</p><button id="font-increment" onClick={()=>{setCount(count+1);if(observe)observe(count+1)}}>Increment</button><p id="font-seed">{seed}</p></div>}\n'
        : 'import {useState} from "preact/hooks";import "./counter.css";export default function Counter({label,observe}){const[count,setCount]=useState(0);const[seed]=useState(()=>String(Date.now())+":"+String(Math.random()));return <div id="font-root"><p id="font-count">{label}:{count}</p><button id="font-increment" onClick={()=>{setCount(count+1);if(observe)observe(count+1)}}>Increment</button><p id="font-seed">{seed}</p></div>}\n',
  );
  await save(join(fixture, "tokens.css"), ":root{--source-ink:#123456}\r\n");
  await save(
    join(fixture, "counter.css"),
    '@import "./tokens.css";\r\n#font-root{width:400px;height:180px;padding:8px;background:#ffffff;color:var(--source-ink);font-family:"SourceNoto";font-weight:400;font-style:normal;font-size:16px;line-height:24px;white-space:nowrap}#font-count,#font-seed{font-weight:400;font-style:normal;font-size:16px;line-height:24px}#font-increment{font-family:"SourceNoto";font-weight:700;font-style:normal;font-size:16px;line-height:24px;height:36px;width:140px}\r\n'.replaceAll(
      '"SourceNoto"',
      escaped ? aliases[0] : JSON.stringify(unicode ? aliases[0] : family),
    ) + (escaped ? "#font-seed{font-family:" + aliases[1] + "}\r\n" : ""),
  );
  await save(
    join(fixture, "external.css"),
    "#font-root{border-radius:2px}\r\n",
  );
  const args = [
    relative(foreign, join(fixture, "Counter.tsx")),
    "--fonts",
    relative(foreign, join(fixture, "fonts.json")),
    "--props",
    relative(foreign, join(fixture, "props.json")),
    "--actions",
    "observe",
    "--stylesheet",
    relative(foreign, join(fixture, "external.css")),
    "--out",
    relative(foreign, original),
    "--name",
    "SourceFonts",
    "--package",
    originalPackage,
  ];
  await command(
    "installed-source-generate",
    ["astro-fyne", "to-fyne", ...args],
    foreign,
  );
  await command(
    "installed-source-check",
    ["astro-fyne", "check", ...args],
    foreign,
  );
  await command(
    "installed-source-check-flag",
    ["astro-fyne", "to-fyne", ...args, "--check"],
    foreign,
  );
  const astroArgs = [
    relative(foreign, join(fixture, "App.astro")),
    "--fonts",
    relative(foreign, join(fixture, "fonts.json")),
    "--props",
    relative(foreign, join(fixture, "props.json")),
    "--stylesheet",
    relative(foreign, join(fixture, "external.css")),
    "--out",
    relative(foreign, original),
    "--name",
    "AstroFonts",
    "--package",
    originalPackage,
  ];
  await command(
    "installed-astro-source-generate",
    ["astro-fyne", "to-fyne", ...astroArgs],
    foreign,
  );
  await command(
    "installed-astro-source-check",
    ["astro-fyne", "to-fyne", ...astroArgs, "--check"],
    foreign,
  );
  if (unicode && !matching && !escaped) {
    await json(join(fixture, "fonts-astral.json"), {
      schema: 1,
      kind: "astro-fyne-font-manifest",
      faces: [400, 700].map((weight) => ({
        family: "𐐀Source",
        weight,
        style: "normal",
        source: weight === 400 ? "fonts/regular.ttf" : "fonts/bold.ttf",
        license: "fonts/OFL.txt",
        hash: catalogueHash(weight === 400 ? regular : bold),
        licenseHash: catalogueHash(license),
      })),
    });
    for (const item of [
      {
        name: "RejectedFonts",
        family: "SOURCESTRASSE",
        manifest: "fonts.json",
      },
      {
        name: "RejectedAstralFonts",
        family: "𐐨Source",
        manifest: "fonts-astral.json",
      },
    ]) {
      await save(
        join(fixture, item.name + ".tsx"),
        "export default function Rejected({observe}){const family=" +
          JSON.stringify(item.family) +
          ';return <p id="rejected-font" data-authored-family={family} style={{fontFamily:family,fontSize:16,lineHeight:"24px",fontWeight:400,fontStyle:"normal",whiteSpace:"nowrap"}} onClick={()=>observe(1)}>Rejected font</p>}\n',
      );
      const rejectedArgs = [
        relative(foreign, join(fixture, item.name + ".tsx")),
        "--fonts",
        relative(foreign, join(fixture, item.manifest)),
        "--actions",
        "observe",
        "--out",
        relative(foreign, original),
        "--name",
        item.name,
        "--package",
        originalPackage,
      ];
      await command(
        "installed-" + item.name + "-generate",
        ["astro-fyne", "to-fyne", ...rejectedArgs],
        foreign,
      );
      await command(
        "installed-" + item.name + "-check",
        ["astro-fyne", "check", ...rejectedArgs],
        foreign,
      );
    }
  }
  const report = JSON.parse(
      await readFile(
        join(original, "SourceFonts.source-fonts.report.json"),
        "utf8",
      ),
    ),
    cold = await parseCatalogue(
      await readFile(join(original, report.archiveFile), "utf8"),
    );
  assert.equal(cold.resources.length, 2);
  assert.ok(cold.fontFaces.every((face) => face.family === family));
  if (unicode) {
    const program = JSON.parse(cold.components[0]!.payload);
    const sourceCSS = await readFile(join(fixture, "counter.css"), "utf8");
    assert.equal(
      program.stylesheets.find((sheet: { path: string }) =>
        sheet.path.endsWith("counter.css"),
      ).text,
      sourceCSS,
    );
    assert.ok(
      sourceCSS.includes(
        "font-family:" + (escaped ? aliases[0] : JSON.stringify(aliases[0])),
      ),
    );
    if (escaped)
      assert.ok(
        sourceCSS.includes("#font-seed{font-family:" + aliases[1] + "}\r\n"),
      );
    assert.ok(!sourceCSS.includes("font-family:" + JSON.stringify(family)));
  }
  assert.deepEqual(
    new Set(cold.resources.map((resource) => resource.hash)),
    new Set([catalogueHash(regular), catalogueHash(bold)]),
  );
  for (const resource of cold.resources)
    assert.ok(Buffer.from(resource.license).equals(license));
  await resources(original, "SourceFonts", cold);
  const executable = await buildDriver(original, "prepare"),
    checkpoint = await parseCatalogue(
      await readFile(join(out, "native-prepare.catalogue.json"), "utf8"),
    );
  const nativePrepared = JSON.parse(
    await readFile(join(out, "native-prepare.json"), "utf8"),
  );
  assert.deepEqual(nativePrepared.calls, [[1]]);
  assert.equal(nativePrepared.replayCalls, 0);
  let fontRejections;
  if (unicode && !matching && !escaped) {
    fontRejections = JSON.parse(
      await readFile(join(out, "native-font-rejection.json"), "utf8"),
    );
    assert.equal(fontRejections.schema, 1);
    assert.equal(fontRejections.mode, "prepare");
    assert.equal(fontRejections.hostCalls, 0);
    assert.equal(fontRejections.beforeNativeWindowOrCanvasSourceBound, true);
    assert.equal(fontRejections.painterCallsIndependentlyCounted, false);
    assert.equal(fontRejections.cases.length, 2);
    for (const [index, item] of [
      {
        name: "RejectedFonts",
        canonical: "SourceStraße",
        authored: "SOURCESTRASSE",
        manifest: "fonts.json",
        class: "full-fold-only",
      },
      {
        name: "RejectedAstralFonts",
        canonical: "𐐀Source",
        authored: "𐐨Source",
        manifest: "fonts-astral.json",
        class: "changed astral",
      },
    ].entries()) {
      const row = fontRejections.cases[index],
        rejectedReport = JSON.parse(
          await readFile(
            join(original, item.name + ".source-fonts.report.json"),
            "utf8",
          ),
        ),
        rejectedCatalogue = await parseCatalogue(
          await readFile(join(original, rejectedReport.archiveFile), "utf8"),
        ),
        component = rejectedCatalogue.components[0]!,
        program = JSON.parse(component.payload),
        source = await readFile(join(fixture, item.name + ".tsx"));
      assert.equal(row.constructor, "New" + item.name + "WithOptions");
      assert.equal(row.sourceFile, item.name + ".tsx");
      assert.equal(row.manifestFile, item.manifest);
      assert.equal(row.canonical, item.canonical);
      assert.equal(row.authoredFamily, item.authored);
      assert.equal(row.expectedErrorClass, item.class);
      assert.equal(row.errorClass, item.class);
      assert.equal(row.constructorInvoked, true);
      assert.equal(row.constructorPanicked, false);
      assert.equal(row.returnedWidgetNil, true);
      assert.equal(row.errorObserved, true);
      assert.equal(row.hostCalls, 0);
      assert.equal(typeof row.errorGoType, "string");
      assert.ok(row.errorGoType);
      assert.ok(row.errorMessage.includes("CSS font family: " + item.class));
      assert.equal(row.factoryCodeHash, program.codeHash);
      assert.equal(row.componentPayloadHash, catalogueHash(component.payload));
      assert.deepEqual(row.sourceInputs, program.sources);
      assert.deepEqual(row.fontFaces, rejectedCatalogue.fontFaces);
      assert.ok(
        program.sources.some(
          (input: { path: string; hash: string }) =>
            input.path.endsWith(item.name + ".tsx") &&
            input.hash === catalogueHash(source),
        ),
      );
      assert.equal(
        rejectedReport.manifestHash,
        catalogueHash(await readFile(join(fixture, item.manifest))),
      );
      await resources(original, item.name, rejectedCatalogue);
    }
  }
  if (unicode) {
    assert.equal(nativePrepared.initial.authoredFamily, aliases[0]);
    assert.equal(nativePrepared.after.authoredFamily, aliases[1]);
    assert.equal(nativePrepared.restored.authoredFamily, aliases[1]);
    assert.ok(
      Object.values(nativePrepared.initial.fontFamilies).every(
        (value) => value === JSON.stringify(family),
      ),
    );
  }
  const astroPrepared = JSON.parse(
    await readFile(join(out, "native-astro-source.json"), "utf8"),
  );
  assert.equal(astroPrepared.initial.count, "Original props:0");
  assert.equal(astroPrepared.after.count, "Original props:1");
  assert.equal(astroPrepared.hostCalls, 0);
  if (unicode) {
    assert.equal(astroPrepared.initial.authoredFamily, aliases[0]);
    assert.equal(astroPrepared.after.authoredFamily, aliases[1]);
  }
  sameMetadata(checkpoint, cold);
  assert.equal(
    JSON.parse(checkpoint.islands[0]!.statePayload!).props.label,
    "Native override",
  );
  const webArgs = [
    relative(foreign, join(out, "native-prepare.catalogue.json")),
    "--out",
    relative(foreign, web),
    "--name",
    "SourceFonts",
    "--actions-module",
    "./actions.ts",
  ];
  await command(
    "installed-web-generate",
    ["astro-fyne", "to-web", ...webArgs],
    foreign,
  );
  await command(
    "installed-web-check",
    ["astro-fyne", "to-web", ...webArgs, "--check"],
    foreign,
  );
  await resources(web, "SourceFonts", checkpoint);
  await save(
    join(web, "actions.ts"),
    'export const actions={observe(){throw new Error("Harness must bind source-font actions")}};\n',
  );
  await save(
    join(web, "Harness.tsx"),
    'import {createRef} from "preact";import {SourceFontsIsland,exportCatalogue} from "./SourceFonts.catalogue.tsx";const handle=createRef<any>();const calls:unknown[][]=[];const actions={observe:(count:number)=>{calls.push([count]);return null}};export default function Harness(){if(typeof window!=="undefined")(window as any).afySourceFonts={ready:()=>{try{handle.current!.exportJavascript();return true}catch{return false}},calls:()=>calls.map(call=>[...call]),export:()=>handle.current!.exportJavascript(),exportCatalogue:()=>exportCatalogue(new Map([["app",handle.current!]]))};return <div data-catalogue-island="app"><SourceFontsIsland id="app" actions={actions} handleRef={handle}/></div>}\n',
  );
  await save(
    join(web, "index.astro"),
    '---\nimport Harness from "./Harness.tsx";\n---\n<html lang="en"><head><meta charset="utf-8"/><title>Source fonts roundtrip</title></head><body><Harness client:only="preact"/></body></html>\n',
  );
  if (unicode && !matching && !escaped)
    await save(
      join(web, "font-matching-probe.astro"),
      '<!doctype html><html lang="en"><head><meta charset="utf-8"/><title>Font name matching probe</title></head><body></body></html>\n',
    );
  const sourceFiles = [
    "ci/source-fonts-roundtrip.ts",
    "ci/source-fonts-probe.go.txt",
    "capture/source-fonts-roundtrip.ts",
    "capture/browser-provenance.ts",
    "capture/browser-provenance-validation.ts",
    "ci/run.sh",
    "src/source-catalogue.ts",
    "src/source-catalogue.test.ts",
    "src/licensed-fonts.ts",
    "src/licensed-fonts.test.ts",
    "src/json-source.ts",
    "src/catalogue.ts",
    "src/catalogue-types.ts",
    "src/catalogue-cli.ts",
    "src/catalogue-web.ts",
    "src/fonts.ts",
    "src/fonts.test.ts",
    "src/catalogue.test.ts",
    "src/catalogue-cli.test.ts",
    "src/javascript-font-aliases.test.ts",
    "src/javascript-font-escapes.test.ts",
    "src/font-family.ts",
    "src/font-family-data.ts",
    "src/font-family.test.ts",
    "src/font-family-css.ts",
    "src/font-family-css.test.ts",
    "third_party/unicode17/CaseFolding.txt",
    "third_party/unicode17/UnicodeData.txt",
    "third_party/unicode17/LICENSE.txt",
    "third_party/unicode17/README.md",
    "third_party/unicode17/generate.py",
    "third_party/unicode17/provenance.json",
    "docs/font-family-policy.md",
    "src/artifacts.ts",
    "src/javascript.ts",
    "src/javascript-cli.ts",
    "src/javascript-types.ts",
    "src/javascript-astro.ts",
    "src/javascript-runtime.js",
    "src/javascript-dom.js",
    "src/javascript-data.ts",
    "src/javascript-css.ts",
    "src/javascript-css-runtime.js",
    "src/cli.ts",
    "src/cli-help.ts",
    "src/cli-shortcuts.ts",
    "bin/astro-fyne.ts",
    "native/go.mod",
    "native/go.sum",
    "native/view.go",
    "native/backend.go",
    "native/font_resources.go",
    "native/font_resources_test.go",
    "native/controls.go",
    "native/fontresource/validate.go",
    "package.json",
    "bun.lock",
    ".github/workflows/ci.yml",
    "example/public/fonts/NotoSans-Regular.ttf",
    "example/public/fonts/NotoSans-Bold.ttf",
    "example/public/fonts/LICENSE-NotoSans.txt",
    ...(await readdir(join(root, "native/catalog")))
      .filter((file) => file.endsWith(".go"))
      .map((file) => "native/catalog/" + file),
    ...(await readdir(join(root, "native/javascript")))
      .filter((file) => file.endsWith(".go"))
      .map((file) => "native/javascript/" + file),
  ];
  const inputs = [];
  for (const [index, path] of [...new Set(sourceFiles)].entries()) {
    const bytes = await readFile(join(root, path)),
      file = "inputs/" + String(index).padStart(4, "0") + ".source";
    await save(join(out, file), bytes);
    inputs.push({
      path,
      file,
      hash: catalogueHash(bytes),
      bytes: bytes.length,
    });
  }
  await json(join(out, "inputs.json"), inputs);
  await json(join(out, "prepare.json"), {
    schema: 1,
    ...(unicode
      ? {
          fontFamilyProfile: {
            canonical: family,
            canonicalCSS: JSON.stringify(family),
            authoredCSS: aliases[0],
            dynamicAliases: [...aliases],
            observedNativeFamilies: true,
            authoredInlineAssignmentSourceBound: true,
            pixelPerfectVerified: false,
          },
        }
      : {}),
    sourceCommit: await command("source-commit", ["git", "rev-parse", "HEAD"]),
    sourceTree: await command("source-tree", [
      "git",
      "rev-parse",
      "HEAD^{tree}",
    ]),
    inputHash: catalogueHash(await readFile(join(out, "inputs.json"))),
    executable,
    nativeCatalogueHash: catalogueHash(
      await readFile(join(out, "native-prepare.catalogue.json")),
    ),
    generatedNative: await tree(original, join(out, "generated-native")),
    generatedWeb: await tree(web, join(out, "generated-web")),
    fixture: await tree(fixture, join(out, "retained-fixture")),
    ...(fontRejections
      ? {
          fontRejectionReceipt: {
            file: "native-font-rejection.json",
            hash: catalogueHash(
              await readFile(join(out, "native-font-rejection.json")),
            ),
            observedGeneratedConstructors: fontRejections.cases.map(
              (item: { constructor: string }) => item.constructor,
            ),
          },
        }
      : {}),
    pixelPerfectVerified: false,
    strictFontAdmissionEnabled: false,
  });
} else {
  const prepared = JSON.parse(
    await readFile(join(out, "prepare.json"), "utf8"),
  );
  assert.equal(
    catalogueHash(await readFile(join(out, prepared.executable.binary))),
    prepared.executable.binaryHash,
  );
  await captureSourceFonts(
    "http://127.0.0.1:4321/" + stem + "-roundtrip/",
    out,
    family,
    unicode ? aliases : undefined,
    unicode && !matching && !escaped ? ["SOURCESTRASSE"] : undefined,
    escaped,
  );
  const browser = JSON.parse(await readFile(join(out, "browser.json"), "utf8")),
    spec = await parseCatalogue(JSON.stringify(browser.exportedCatalogue)),
    warm = await parseCatalogue(
      await readFile(join(out, "native-prepare.catalogue.json"), "utf8"),
    );
  sameMetadata(spec, warm);
  await json(join(out, "browser.catalogue.json"), spec);
  const args = [
    relative(foreign, join(out, "browser.catalogue.json")),
    "--out",
    relative(foreign, returned),
    "--name",
    "ReturnedFonts",
    "--package",
    returnedPackage,
  ];
  await command(
    "installed-return-generate",
    ["astro-fyne", "to-fyne", ...args],
    foreign,
  );
  await command(
    "installed-return-check",
    ["astro-fyne", "to-fyne", ...args, "--check"],
    foreign,
  );
  await resources(returned, "ReturnedFonts", spec);
  const executable = await buildDriver(returned, "verify"),
    final = await parseCatalogue(
      await readFile(join(out, "native-verify.catalogue.json"), "utf8"),
    ),
    result = JSON.parse(
      await readFile(join(out, "native-verify.json"), "utf8"),
    );
  sameMetadata(final, spec);
  assert.deepEqual(
    result.initialArchive,
    JSON.parse(spec.islands[0]!.statePayload!),
  );
  assert.equal(result.initial.count, "Native override:2");
  assert.equal(result.after.count, "Native override:3");
  assert.deepEqual(result.calls, [[3]]);
  assert.equal(result.replayCalls, 0);
  if (unicode) {
    assert.equal(result.initial.authoredFamily, aliases[0]);
    assert.equal(result.after.authoredFamily, aliases[1]);
    assert.equal(result.restored.authoredFamily, aliases[1]);
  }
  await json(join(out, "verify.json"), {
    schema: 1,
    executable,
    generatedNativeReturn: await tree(
      returned,
      join(out, "generated-native-return"),
    ),
    finalCatalogueHash: catalogueHash(
      await readFile(join(out, "native-verify.catalogue.json")),
    ),
    ...(unicode
      ? {
          fontFamilyProfile: {
            canonical: family,
            canonicalCSS: JSON.stringify(family),
            nativeInitialAlias: aliases[1],
            browserAfterAlias: aliases[0],
            nativeReturnedAlias: aliases[1],
            authoredInlineAssignmentSourceBound: true,
          },
        }
      : {}),
    nativeSourceCount: 1,
    browserCount: 2,
    nativeReturnCount: 3,
    restoredHostEffects: 0,
    fullCheckpointTransportVerified: true,
    pixelPerfectVerified: false,
    strictFontAdmissionEnabled: false,
  });
}
