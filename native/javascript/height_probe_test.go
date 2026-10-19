// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package javascript

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image/png"
	"io"
	"math"
	"os"
	"path/filepath"
	"testing"
	"time"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/driver/software"
	"fyne.io/fyne/v2/test"
	"fyne.io/fyne/v2/theme"
	webui "github.com/thinkddr/astro-fyne/native"
)

type heightProbeFrame struct {
	X float32 `json:"x"`
	Y float32 `json:"y"`
	Width float32 `json:"width"`
	Height float32 `json:"height"`
}

type heightProbeSize struct {
	Width float32 `json:"width"`
	Height float32 `json:"height"`
}

type heightProbeSample struct {
	TimeMS float64 `json:"timeMs"`
	Animation AnimationState `json:"animation"`
	Objects map[string]heightProbeFrame `json:"objects"`
	Snapshot map[string]heightProbeFrame `json:"snapshot"`
	Minimum heightProbeSize `json:"minimum"`
	Viewport heightProbeSize `json:"viewport"`
	Image string `json:"image,omitempty"`
}

func heightProbeMount(t *testing.T, archive Archive) (*Widget, fyne.Canvas) {
	t.Helper()
	w, err := NewWithOptions(archive, nil, Options{ManualAnimations:true,Clock:ClockFunc(func() time.Time { return time.Unix(2000000000,0) })})
	if err != nil { t.Fatal(err) }
	t.Cleanup(func(){ if err := w.Close(); err != nil { t.Error(err) } })
	canvas := software.NewCanvas()
	canvas.SetPadded(false)
	canvas.SetContent(w)
	canvas.Resize(fyne.NewSize(320,240))
	w.Resize(fyne.NewSize(320,240))
	if err = w.BindCanvas(canvas); err != nil { t.Fatal(err) }
	return w, canvas
}

func heightProbeCapture(t *testing.T, w *Widget, timeMS float64) heightProbeSample {
	t.Helper()
	state, err := w.AnimationState()
	if err != nil { t.Fatal(err) }
	snapshot, err := w.Snapshot()
	if err != nil { t.Fatal(err) }
	minimum, viewport := w.MinSize(), w.Size()
	sample := heightProbeSample{TimeMS:timeMS,Animation:state,Objects:map[string]heightProbeFrame{},Snapshot:map[string]heightProbeFrame{},Minimum:heightProbeSize{minimum.Width,minimum.Height},Viewport:heightProbeSize{viewport.Width,viewport.Height}}
	for _, id := range []string{"height-root","height-panel","height-sibling"} {
		object := w.Object(id)
		if object == nil { t.Fatalf("source archive did not render %s",id) }
		position, size := object.Position(), object.Size()
		sample.Objects[id] = heightProbeFrame{position.X,position.Y,size.Width,size.Height}
	}
	var collect func([]webui.SnapshotNode)
	collect = func(nodes []webui.SnapshotNode) {
		for _, node := range nodes {
			style := node.Node.Style
			if _, wanted := sample.Objects[node.Node.ID]; wanted {
				if !style.Measured { t.Fatalf("snapshot did not report a used frame for %s",node.Node.ID) }
				sample.Snapshot[node.Node.ID] = heightProbeFrame{style.X,style.Y,style.Width,style.Height}
			}
			collect(node.Children)
		}
	}
	collect(snapshot.Roots)
	return sample
}

func heightProbeAssert(t *testing.T, sample heightProbeSample, expectedHeight float32, expectedState ...string) {
	t.Helper()
	close := func(actual, expected float32) bool { return math.Abs(float64(actual-expected)) <= 0.0001 }
	if sample.Animation.TimeMS != sample.TimeMS { t.Fatalf("sample %v exported another time: %+v",sample.TimeMS,sample.Animation) }
	wantedState := "running"
	if sample.TimeMS >= 2100 { wantedState = "finished" }
	if len(expectedState) == 1 { wantedState = expectedState[0] }
	if sample.Animation.PlayState != wantedState { t.Fatalf("sample %v has play state %q",sample.TimeMS,sample.Animation.PlayState) }
	if sample.Viewport != (heightProbeSize{320,240}) || !close(sample.Minimum.Height,expectedHeight+24) { t.Fatalf("sample %v has inconsistent viewport/minimum: %+v %+v",sample.TimeMS,sample.Viewport,sample.Minimum) }
	want := map[string]heightProbeFrame{
		"height-root":{0,0,320,expectedHeight+24},
		"height-panel":{0,0,320,expectedHeight},
		"height-sibling":{0,expectedHeight,320,24},
	}
	for id, expected := range want {
		for _, frames := range []map[string]heightProbeFrame{sample.Objects,sample.Snapshot} {
			actual, exists := frames[id]
			if !exists || !close(actual.X,expected.X) || !close(actual.Y,expected.Y) || !close(actual.Width,expected.Width) || !close(actual.Height,expected.Height) { t.Fatalf("sample %v frame %s = %+v; expected %+v",sample.TimeMS,id,actual,expected) }
		}
	}
}

func TestBrowserCSSHeightRestore(t *testing.T) {
	input := os.Getenv("ASTRO_FYNE_HEIGHT_BROWSER_INPUT")
	if input == "" { t.Skip("browser checkpoint is supplied by the hosted height gate") }
	output := os.Getenv("ASTRO_FYNE_HEIGHT_OUTPUT")
	if output == "" { t.Fatal("missing evidence output directory") }
	data, err := os.ReadFile(input)
	if err != nil { t.Fatal(err) }
	var archive Archive
	if err = json.Unmarshal(data,&archive); err != nil { t.Fatal(err) }
	if err = Validate(archive); err != nil { t.Fatal(err) }
	if archive.Schema != 2 || archive.Animation == nil || archive.Animation.TimeMS != 700 || archive.Animation.PlayState != "paused" { t.Fatal("expected actual browser paused checkpoint at 700ms") }
	app := test.NewApp()
	defer app.Quit()
	w,canvas := heightProbeMount(t,archive)
	canvas.Capture()
	initial := heightProbeCapture(t,w,700)
	heightProbeAssert(t,initial,68,"paused")
	restored, err := w.ExportJavascript()
	if err != nil { t.Fatal(err) }
	if !bytes.Equal(restored.Props,archive.Props) || len(restored.Stylesheets) != len(archive.Stylesheets) { t.Fatal("browser state or CSS was lost") }
	for index, sheet := range archive.Stylesheets { if restored.Stylesheets[index] != sheet { t.Fatal("browser CSS source changed") } }
	if err = w.PlayAnimations(); err != nil { t.Fatal(err) }
	if err = w.AdvanceAnimations(800); err != nil { t.Fatal(err) }
	canvas.Capture()
	continued := heightProbeCapture(t,w,800)
	heightProbeAssert(t,continued,76)
	heightProbeWrite(t,filepath.Join(output,"browser-native-restore.json"),struct {Schema int `json:"schema"`;CodeHash string `json:"codeHash"`;Initial heightProbeSample `json:"initial"`;Continued heightProbeSample `json:"continued"`}{1,archive.CodeHash,initial,continued})
}

func heightProbeWrite(t *testing.T, path string, value any) {
	t.Helper()
	data, err := json.MarshalIndent(value,"","  ")
	if err != nil { t.Fatal(err) }
	if err = os.WriteFile(path,append(data,'\n'),0644); err != nil { t.Fatal(err) }
}

func TestSourceCSSHeightProbe(t *testing.T) {
	input := os.Getenv("ASTRO_FYNE_HEIGHT_INPUT")
	if input == "" { t.Skip("source CSS animation archive is supplied by the hosted height gate") }
	output := os.Getenv("ASTRO_FYNE_HEIGHT_OUTPUT")
	if output == "" { t.Fatal("ASTRO_FYNE_HEIGHT_OUTPUT must name an evidence directory") }
	data, err := os.ReadFile(input)
	if err != nil { t.Fatal(err) }
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	var archive Archive
	if err = decoder.Decode(&archive); err != nil { t.Fatal(err) }
	if err = decoder.Decode(new(any)); err != io.EOF { t.Fatal("expected one source archive document") }
	if err = Validate(archive); err != nil { t.Fatal(err) }
	if archive.Schema != 2 || len(archive.Stylesheets) == 0 || len(archive.Events) != 0 { t.Fatal("height source probe requires a fresh animated archive with retained CSS") }
	if err = os.MkdirAll(output,0755); err != nil { t.Fatal(err) }
	app := test.NewApp()
	defer app.Quit()
	app.Settings().SetTheme(theme.LightTheme())
	w, canvas := heightProbeMount(t,archive)
	originals := map[string]fyne.CanvasObject{}
	for _, id := range []string{"height-root","height-panel","height-sibling"} { originals[id] = w.Object(id) }
	samples := []heightProbeSample{}
	var checkpoint Archive
	for i, timeMS := range []float64{0,100,350,600,1100,1350,1600,2100} {
		if err = w.AdvanceAnimations(timeMS); err != nil { t.Fatal(err) }
		image := canvas.Capture()
		if image.Bounds().Dx() != 320 || image.Bounds().Dy() != 240 { t.Fatalf("native raster changed viewport: %v",image.Bounds()) }
		sample := heightProbeCapture(t,w,timeMS)
		heightProbeAssert(t,sample,[]float32{20,20,40,60,100,80,60,20}[i])
		for id, object := range originals { if object == nil || w.Object(id) != object { t.Fatalf("sample %v replaced native object %s",timeMS,id) } }
		sample.Image = fmt.Sprintf("native-height-%gms.png",timeMS)
		file, err := os.Create(filepath.Join(output,sample.Image))
		if err != nil { t.Fatal(err) }
		encodeErr, closeErr := png.Encode(file,image), file.Close()
		if encodeErr != nil { t.Fatal(encodeErr) }
		if closeErr != nil { t.Fatal(closeErr) }
		samples = append(samples,sample)
		if timeMS == 350 {
			checkpoint, err = w.ExportJavascript()
			if err != nil { t.Fatal(err) }
			if checkpoint.Animation == nil || checkpoint.Animation.TimeMS != 350 || checkpoint.Animation.PlayState != "running" { t.Fatal("checkpoint did not preserve the running committed sample") }
			heightProbeWrite(t,filepath.Join(output,"checkpoint.javascript.json"),checkpoint)
		}
	}
	restored, restoredCanvas := heightProbeMount(t,checkpoint)
	restoredCanvas.Capture()
	initial := heightProbeCapture(t,restored,350)
	heightProbeAssert(t,initial,40)
	for id, object := range originals { if restored.Object(id) == object { t.Fatalf("restored instance reused %s",id) } }
	if err = restored.AdvanceAnimations(600); err != nil { t.Fatal(err) }
	restoredCanvas.Capture()
	continued := heightProbeCapture(t,restored,600)
	heightProbeAssert(t,continued,60)
	final, err := w.AnimationState()
	if err != nil || final.TimeMS != 2100 || final.PlayState != "finished" { t.Fatalf("restoring another widget changed the original timeline: %+v %v",final,err) }
	fractional, fractionalCanvas := heightProbeMount(t,archive)
	if err = fractional.AdvanceAnimations(333); err != nil { t.Fatal(err) }
	fractionalImage := fractionalCanvas.Capture()
	fractionalSample := heightProbeCapture(t,fractional,333)
	fractionalSample.Image = "native-height-fractional-333ms.png"
	fractionalFile, err := os.Create(filepath.Join(output,fractionalSample.Image))
	if err != nil { t.Fatal(err) }
	encodeErr, closeErr := png.Encode(fractionalFile,fractionalImage), fractionalFile.Close()
	if encodeErr != nil { t.Fatal(encodeErr) }
	if closeErr != nil { t.Fatal(closeErr) }
	easedArchive := archive
	easedArchive.Props = json.RawMessage(`{"eased":true}`)
	eased, easedCanvas := heightProbeMount(t,easedArchive)
	if err = eased.AdvanceAnimations(333); err != nil { t.Fatal(err) }
	easedImage := easedCanvas.Capture()
	easedSample := heightProbeCapture(t,eased,333)
	easedSample.Image = "native-height-eased-333ms.png"
	easedFile, err := os.Create(filepath.Join(output,easedSample.Image))
	if err != nil { t.Fatal(err) }
	encodeErr, closeErr = png.Encode(easedFile,easedImage), easedFile.Close()
	if encodeErr != nil { t.Fatal(encodeErr) }
	if closeErr != nil { t.Fatal(closeErr) }
	heightProbeWrite(t,filepath.Join(output,"native-height.json"),struct {
		Schema int `json:"schema"`
		Kind string `json:"kind"`
		CodeHash string `json:"codeHash"`
		Samples []heightProbeSample `json:"samples"`
		Checkpoint string `json:"checkpoint"`
		RestoredInitial heightProbeSample `json:"restoredInitial"`
		RestoredContinued heightProbeSample `json:"restoredContinued"`
		FractionalSample heightProbeSample `json:"fractionalSample"`
		EasedSample heightProbeSample `json:"easedSample"`
	}{1,"astro-fyne-css-height-native-evidence",archive.CodeHash,samples,"checkpoint.javascript.json",initial,continued,fractionalSample,easedSample})
}
