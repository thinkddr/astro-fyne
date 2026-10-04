// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package webui

import (
	"encoding/json"
	"image/color"
	"math"
	"strings"
	"testing"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/driver/software"
)

func flexTestItem(id string, basis float32) Node {
	return Node{ID: id, Kind: "container", Style: Style{Flex: &FlexStyle{
		Basis: FlexValue(basis), MinWidth: FlexValue(0), MinHeight: FlexValue(0), BoxSizing: "border-box",
	}}}
}

func flexTestRoot(height float32, children ...Node) Node {
	return Node{ID: "root", Kind: "container", Style: Style{
		Display: "flex", Height: height, Background: "#ffffff", Flex: &FlexStyle{
			WidthPercent: FlexValue(100), WidthSet: true, HeightSet: true, BoxSizing: "border-box",
		},
	}, Children: children}
}

func flexTestFrame(t *testing.T, v *View, id string, x, y, width, height float32) {
	t.Helper()
	object := v.Object(id)
	if object == nil {
		t.Fatalf("missing native flex object %q", id)
	}
	position, size := object.Position(), object.Size()
	got := []float32{position.X, position.Y, size.Width, size.Height}
	want := []float32{x, y, width, height}
	for i := range want {
		if math.Abs(float64(got[i]-want[i])) > 0.0001 {
			t.Fatalf("%s frame = %+v %+v; want (%v,%v) %vx%v", id, position, size, x, y, width, height)
		}
	}
}

func TestResponsiveFlexResizesActualObjectsWithoutMeasurementsOrBuilderEffects(t *testing.T) {
	first, second := flexTestItem("first", 96), flexTestItem("second", 96)
	first.Style.Background, second.Style.Background = "#ff0000", "#0000ff"
	first.Style.Flex.Grow, second.Style.Flex.Grow = FlexValue(1), FlexValue(2)
	first.Style.Flex.Shrink, second.Style.Flex.Shrink = FlexValue(1), FlexValue(2)
	root := flexTestRoot(80, first, second)
	root.Style.PaddingLeft, root.Style.PaddingRight = 16, 16
	root.Style.PaddingTop, root.Style.PaddingBottom, root.Style.Gap = 8, 8, 8
	builds := 0
	v := NewView(func() []Node { builds++; return []Node{root} })
	if err := v.Error(); err != nil {
		t.Fatal(err)
	}
	canvas := software.NewCanvas()
	canvas.SetPadded(false)
	canvas.SetContent(v)
	if err := v.BindCanvas(canvas); err != nil {
		t.Fatal(err)
	}
	buildsBeforeResize := builds
	initialFirst, initialSecond := v.Object("first"), v.Object("second")
	for _, width := range []float32{320, 480, 640, 144, 320} {
		canvas.Resize(fyne.NewSize(width, 80))
		frame := canvas.Capture()
		if err := v.Error(); err != nil {
			t.Fatal(err)
		}
		if frame.Bounds().Dx() != int(width) || frame.Bounds().Dy() != 80 {
			t.Fatalf("native canvas ignored responsive viewport %vx80: %v", width, frame.Bounds())
		}
		// Free space is width - horizontal padding - gap - two bases.
		free := width - 32 - 8 - 192
		firstWidth, secondWidth := 96+free/3, 96+2*free/3
		flexTestFrame(t, v, "root", 0, 0, width, 80)
		flexTestFrame(t, v, "first", 16, 8, firstWidth, 64)
		flexTestFrame(t, v, "second", 24+firstWidth, 8, secondWidth, 64)
		if rgba(frame.At(20, 20)) != (color.NRGBA{R: 255, A: 255}) || rgba(frame.At(int(width)-20, 20)) != (color.NRGBA{B: 255, A: 255}) {
			t.Fatal("resized real native rectangles did not paint their current red and blue regions")
		}
		if v.Object("first") != initialFirst || v.Object("second") != initialSecond {
			t.Fatal("a viewport change replaced the source objects")
		}
	}
	if builds != buildsBeforeResize || len(v.measurements) != 0 {
		t.Fatalf("responsive resizing evaluated the builder or used frozen geometry: builds=%d profiles=%d", builds, len(v.measurements))
	}
	if v.MinSize().Width >= 144 {
		t.Fatalf("flex bases became a native minimum that blocks shrinking: %v", v.MinSize())
	}
	snapshot, err := v.Snapshot()
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Measured || !snapshot.Roots[0].Node.Style.Measured || snapshot.Roots[0].Node.Style.Flex != nil || snapshot.Roots[0].Children[0].Node.Style.Flex != nil {
		t.Fatal("snapshot did not freeze responsive frames and strip source-only flex metadata")
	}
	encoded, err := json.Marshal(snapshot.Roots[0].Node.Style)
	if err != nil || strings.Contains(string(encoded), `"flex":`) {
		t.Fatalf("source-only metadata leaked into the portable frozen style: %s, %v", encoded, err)
	}
	if v.elements["root"].style.Flex == nil || v.elements["first"].style.Flex == nil {
		t.Fatal("snapshot mutated the live source layout metadata")
	}
}

func TestResponsiveFlexValidatesUsedBorderAtTheActualCanvasScale(t *testing.T) {
	child := flexTestItem("bordered", 40)
	child.Style.BorderWidth, child.Style.BorderColor, child.Style.Flex.BorderStyle = 1, "#112233", "solid"
	root := flexTestRoot(40, child)
	v := NewView(func() []Node { return []Node{root} })
	canvas := software.NewCanvas().(software.WindowlessCanvas)
	canvas.SetPadded(false)
	canvas.SetContent(v)
	canvas.Resize(fyne.NewSize(100, 40))
	if err := v.BindCanvas(canvas); err != nil {
		t.Fatal(err)
	}
	for _, scale := range []float32{1, 2} {
		canvas.SetScale(scale)
		if err := v.ValidateCanvas(); err != nil {
			t.Fatalf("integral used-border at scale %v was rejected: %v", scale, err)
		}
	}
	canvas.SetScale(1.25)
	if err := v.ValidateCanvas(); err == nil {
		t.Fatal("a driver scale change accepted a fractional used border without any refresh")
	}
	if _, err := v.Snapshot(); err == nil {
		t.Fatal("a frozen frame exported a border at an unsupported device scale")
	}
	child.Style.BorderWidth = 4
	root.Children[0] = child
	v.Refresh()
	if err := v.ValidateCanvas(); err != nil {
		t.Fatalf("a nonintegral scale with integral device border pixels was rejected: %v", err)
	}
}

func TestResponsiveFlexViewportClipsFixedRootAndDecorationFloor(t *testing.T) {
	root := flexTestRoot(160)
	root.Style.Background = "#ff0000"
	root.Style.PaddingLeft, root.Style.PaddingRight = 40, 40
	v := NewView(func() []Node { return []Node{root} })
	canvas := software.NewCanvas()
	canvas.SetPadded(false)
	canvas.SetContent(v)
	if err := v.BindCanvas(canvas); err != nil {
		t.Fatal(err)
	}
	if v.MinSize() != fyne.NewSize(0, 0) {
		t.Fatalf("responsive viewport inherited its root's CSS minimum: %v", v.MinSize())
	}
	// This proves native host clipping; it does not implement the browser's
	// document scrollbars or certify reverse export of overflowing scenes.
	for _, viewport := range []fyne.Size{fyne.NewSize(100, 100), fyne.NewSize(32, 40), fyne.NewSize(100, 100)} {
		canvas.Resize(viewport)
		frame := canvas.Capture()
		if v.Error() != nil || canvas.Size() != viewport || v.Size() != viewport {
			t.Fatalf("fixed root forced a larger native viewport: canvas=%v view=%v want=%v error=%v", canvas.Size(), v.Size(), viewport, v.Error())
		}
		if frame.Bounds().Dx() != int(viewport.Width) || frame.Bounds().Dy() != int(viewport.Height) {
			t.Fatalf("capture grew to the root rather than clipping at the host viewport: %v", frame.Bounds())
		}
		flexTestFrame(t, v, "root", 0, 0, max(viewport.Width, 80), 160)
		if rgba(frame.At(int(viewport.Width)-1, int(viewport.Height)-1)) != (color.NRGBA{R: 255, A: 255}) {
			t.Fatal("the overflowing root did not paint through the host's visible bottom-right pixel")
		}
	}
}

func TestResponsiveFlexPartialFactorsLeaveFreeSpaceAndShrinkOnlyRequestedFraction(t *testing.T) {
	for _, test := range []struct {
		name                                                    string
		width, basis, factor, gap, wantX, wantWidth, wantSecond float32
		grow                                                    bool
	}{
		{name: "grow below one", width: 200, basis: 40, factor: .25, gap: 20, wantX: 25, wantWidth: 65, wantSecond: 110, grow: true},
		{name: "shrink below one overflows", width: 100, basis: 80, factor: .25, wantX: -15, wantWidth: 65, wantSecond: 50},
	} {
		t.Run(test.name, func(t *testing.T) {
			a, b := flexTestItem("a", test.basis), flexTestItem("b", test.basis)
			if test.grow {
				a.Style.Flex.Grow, b.Style.Flex.Grow = FlexValue(test.factor), FlexValue(test.factor)
			} else {
				a.Style.Flex.Shrink, b.Style.Flex.Shrink = FlexValue(test.factor), FlexValue(test.factor)
			}
			root := flexTestRoot(40, a, b)
			root.Style.Gap, root.Style.Flex.JustifyContent = test.gap, "center"
			v := NewView(func() []Node { return []Node{root} })
			v.Resize(fyne.NewSize(test.width, 40))
			if err := v.Error(); err != nil {
				t.Fatal(err)
			}
			flexTestFrame(t, v, "a", test.wantX, 0, test.wantWidth, 40)
			flexTestFrame(t, v, "b", test.wantSecond, 0, test.wantWidth, 40)
		})
	}
}

func TestResponsiveFlexUsesInnerBasesAndFreezesDecorationFloors(t *testing.T) {
	a, b := flexTestItem("a", 100), flexTestItem("b", 100)
	a.Style.PaddingLeft, a.Style.PaddingRight, a.Style.BorderWidth, a.Style.BorderColor = 30, 30, 2, "#112233"
	a.Style.Flex.BorderStyle = "solid"
	a.Style.Flex.Shrink, b.Style.Flex.Shrink = FlexValue(10), FlexValue(1)
	root := flexTestRoot(40, a, b)
	v := NewView(func() []Node { return []Node{root} })
	v.Resize(fyne.NewSize(100, 40))
	if err := v.Error(); err != nil {
		t.Fatal(err)
	}
	// Inner bases are 36 and 100. The first item's factor makes it hit its
	// padding/border floor (64), after which the second absorbs the remainder.
	flexTestFrame(t, v, "a", 0, 0, 64, 40)
	flexTestFrame(t, v, "b", 64, 0, 36, 40)
	v.Resize(fyne.NewSize(60, 40))
	flexTestFrame(t, v, "a", 0, 0, 64, 40)
	flexTestFrame(t, v, "b", 64, 0, 0, 40)
	// A border-box basis below padding is not floored before flexible lengths:
	// in grow mode, its negative inner base is allowed until used-size clamping.
	a.Style.Flex.Basis, a.Style.Flex.Grow = FlexValue(0), FlexValue(1)
	b.Style.Flex.Basis, b.Style.Flex.Grow = FlexValue(0), FlexValue(1)
	v.Refresh()
	v.Resize(fyne.NewSize(100, 40))
	flexTestFrame(t, v, "a", 0, 0, 64, 40)
	flexTestFrame(t, v, "b", 64, 0, 36, 40)
}

func TestResponsiveFlexJustificationAndCrossAlignment(t *testing.T) {
	for _, test := range []struct {
		justify       string
		first, second float32
	}{
		{"start", 0, 50}, {"end", 110, 160}, {"center", 55, 105},
		{"space-between", 0, 160}, {"space-around", 27.5, 132.5}, {"space-evenly", 110.0 / 3, 50 + 220.0/3},
	} {
		t.Run(test.justify, func(t *testing.T) {
			a, b := flexTestItem("a", 40), flexTestItem("b", 40)
			a.Style.Height, a.Style.Flex.HeightSet, a.Style.Flex.AlignSelf = 10, true, "end"
			b.Style.Height, b.Style.Flex.HeightSet, b.Style.Flex.AlignSelf = 20, true, "center"
			root := flexTestRoot(40, a, b)
			root.Style.Gap, root.Style.Flex.JustifyContent = 10, test.justify
			v := NewView(func() []Node { return []Node{root} })
			v.Resize(fyne.NewSize(200, 40))
			if err := v.Error(); err != nil {
				t.Fatal(err)
			}
			flexTestFrame(t, v, "a", test.first, 30, 40, 10)
			flexTestFrame(t, v, "b", test.second, 10, 40, 20)
		})
	}
}

func TestResponsiveFlexStretchPreservesExplicitZeroAndPercentageCrossSize(t *testing.T) {
	auto, zero, percent := flexTestItem("auto", 20), flexTestItem("zero", 20), flexTestItem("percent", 20)
	zero.Style.Flex.HeightSet = true
	percent.Style.Flex.HeightSet, percent.Style.Flex.HeightPercent = true, FlexValue(100)
	root := flexTestRoot(60, auto, zero, percent)
	v := NewView(func() []Node { return []Node{root} })
	v.Resize(fyne.NewSize(100, 60))
	flexTestFrame(t, v, "auto", 0, 0, 20, 60)
	flexTestFrame(t, v, "zero", 20, 0, 20, 0)
	flexTestFrame(t, v, "percent", 40, 0, 20, 60)
}

func TestResponsiveFlexNestedColumnUsesPostFlexDimensionsAndParentBorderCoordinates(t *testing.T) {
	leafA, leafB := flexTestItem("leaf-a", 20), flexTestItem("leaf-b", 20)
	leafA.Style.Flex.WidthSet, leafA.Style.Flex.WidthPercent = true, FlexValue(100)
	leafB.Style.Width, leafB.Style.Flex.WidthSet, leafB.Style.Flex.AlignSelf = 30, true, "end"
	column := flexTestItem("column", 120)
	column.Style.Display, column.Style.Direction, column.Style.Gap = "flex", "column", 8
	column.Style.PaddingLeft, column.Style.PaddingRight, column.Style.PaddingTop, column.Style.PaddingBottom = 4, 6, 2, 2
	column.Style.BorderWidth, column.Style.BorderColor, column.Style.Flex.BorderStyle = 1, "#445566", "solid"
	column.Style.Flex.JustifyContent = "space-between"
	column.Children = []Node{leafA, leafB}
	root := flexTestRoot(100, column)
	root.Style.PaddingLeft, root.Style.PaddingTop, root.Style.PaddingBottom = 10, 5, 5
	v := NewView(func() []Node { return []Node{root} })
	v.Resize(fyne.NewSize(200, 100))
	if err := v.Error(); err != nil {
		t.Fatal(err)
	}
	flexTestFrame(t, v, "column", 10, 5, 120, 90)
	flexTestFrame(t, v, "leaf-a", 5, 3, 108, 20)
	flexTestFrame(t, v, "leaf-b", 83, 67, 30, 20)
	root.Style.Direction = "column"
	root.Children[0].Style.Width, root.Children[0].Style.Flex.WidthSet = 150, true
	root.Children[0].Style.Flex.Basis = FlexValue(90)
	v.Refresh()
	flexTestFrame(t, v, "column", 10, 5, 150, 90)
	flexTestFrame(t, v, "leaf-a", 5, 3, 138, 20)
	flexTestFrame(t, v, "leaf-b", 113, 67, 30, 20)
}

func TestResponsiveFlexRejectsUnsupportedDeclarationsWithoutMutatingLastFrame(t *testing.T) {
	for _, test := range []struct {
		name      string
		breakTree func(*Node)
	}{
		{"missing item basis", func(root *Node) { root.Children[0].Style.Flex.Basis = nil }},
		{"automatic item minimum", func(root *Node) { root.Children[0].Style.Flex.MinWidth = nil }},
		{"nonzero item minimum", func(root *Node) { *root.Children[0].Style.Flex.MinHeight = 10 }},
		{"percentage main axis", func(root *Node) {
			root.Children[0].Style.Flex.WidthSet = true
			root.Children[0].Style.Flex.WidthPercent = FlexValue(100)
		}},
		{"reverse direction", func(root *Node) { root.Style.Direction = "row-reverse" }},
		{"baseline alignment", func(root *Node) { root.Style.Flex.AlignItems = "baseline" }},
		{"content box", func(root *Node) { root.Style.Flex.BoxSizing = "content-box" }},
		{"indefinite root height", func(root *Node) { root.Style.Flex.HeightSet = false }},
		{"text content", func(root *Node) { root.Children[0].Text = "intrinsic" }},
		{"control", func(root *Node) { root.Children[0].Kind = "button" }},
		{"container callback", func(root *Node) { root.OnTap = func() {} }},
		{"hidden layout", func(root *Node) { root.Children[0].Style.Display = "none" }},
		{"implicit pixel presence", func(root *Node) { root.Children[0].Style.Height = 10 }},
		{"border style absent", func(root *Node) {
			root.Children[0].Style.BorderWidth = 1
			root.Children[0].Style.BorderColor = "#000000"
		}},
		{"border color absent", func(root *Node) {
			root.Children[0].Style.BorderWidth = 1
			root.Children[0].Style.Flex.BorderStyle = "solid"
		}},
		{"fractional source border", func(root *Node) {
			root.Children[0].Style.BorderWidth, root.Children[0].Style.BorderColor = .5, "#000000"
			root.Children[0].Style.Flex.BorderStyle = "solid"
		}},
		{"decorations overflow", func(root *Node) {
			root.Children[0].Style.PaddingLeft = math.MaxFloat32
			root.Children[0].Style.PaddingRight = math.MaxFloat32
		}},
		{"nonfinite factor", func(root *Node) { root.Children[0].Style.Flex.Grow = FlexValue(float32(math.NaN())) }},
		{"negative factor", func(root *Node) { root.Children[0].Style.Flex.Shrink = FlexValue(-1) }},
		{"intrinsic nested cross size", func(root *Node) {
			root.Style.Flex.AlignItems = "center"
			root.Children[0].Style.Display = "flex"
			root.Children[0].Children = []Node{flexTestItem("nested", 10)}
		}},
	} {
		t.Run(test.name, func(t *testing.T) {
			root := flexTestRoot(40, flexTestItem("child", 60))
			v := NewView(func() []Node { return []Node{root} })
			v.Resize(fyne.NewSize(100, 40))
			object := v.Object("child")
			position, size := object.Position(), object.Size()
			test.breakTree(&root)
			v.Refresh()
			if v.Error() == nil {
				t.Fatal("unsupported source flex declaration was silently accepted")
			}
			if v.Object("child") != object || object.Position() != position || object.Size() != size {
				t.Fatal("a rejected source tree changed the last valid native frame")
			}
			if _, err := v.Snapshot(); err == nil {
				t.Fatal("a rejected tree became exportable by snapshotting its previous frame")
			}
		})
	}
}

func TestResponsiveFlexRejectsOrphanDeclarationsButKeepsLegacyPixelMetadata(t *testing.T) {
	legacy := Node{ID: "legacy", Kind: "container", Style: Style{Width: 30, Height: 20, Flex: &FlexStyle{WidthSet: true, HeightSet: true}}}
	v := NewView(func() []Node { return []Node{legacy} })
	v.Resize(fyne.NewSize(30, 20))
	if err := v.Error(); err != nil {
		t.Fatal(err)
	}
	for _, metadata := range []*FlexStyle{
		{WidthSet: true, WidthPercent: FlexValue(100)}, {Basis: FlexValue(20)}, {Grow: FlexValue(1)},
		{MinWidth: FlexValue(0)}, {BoxSizing: "border-box"}, {AlignSelf: "stretch"}, {BorderStyle: "solid"},
	} {
		legacy.Style.Flex = metadata
		v.Refresh()
		if v.Error() == nil {
			t.Fatalf("orphan flex metadata accepted: %+v", metadata)
		}
	}
	legacy = Node{ID: "legacy", Kind: "container", Children: []Node{flexTestRoot(40, flexTestItem("child", 20))}}
	v.Refresh()
	if v.Error() == nil {
		t.Fatal("a nested flex context in legacy layout was accepted without its supported root contract")
	}
}

func TestResponsiveFlexRejectsComputedNonfiniteFrames(t *testing.T) {
	a, b, c := flexTestItem("a", 20), flexTestItem("b", 20), flexTestItem("c", 20)
	a.Style.Flex.Shrink, b.Style.Flex.Shrink, c.Style.Flex.Shrink = FlexValue(0), FlexValue(0), FlexValue(0)
	root := flexTestRoot(40, a, b, c)
	root.Style.Gap = math.MaxFloat32
	v := NewView(func() []Node { return []Node{root} })
	v.Resize(fyne.NewSize(100, 40))
	if v.Error() == nil || !strings.Contains(v.Error().Error(), "computed") {
		t.Fatalf("nonfinite computed child bounds were accepted: %v", v.Error())
	}
	if _, err := v.Snapshot(); err == nil {
		t.Fatal("nonfinite computed frames became an exportable scene")
	}
}
