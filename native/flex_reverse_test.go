// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package webui

import (
	"testing"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/driver/software"
)

func TestReverseFlexPreservesSourceObjectsAndPhysicalPadding(t *testing.T) {
	for _, direction := range []string{"row-reverse", "column-reverse"} {
		t.Run(direction, func(t *testing.T) {
			a, b := flexTestItem("a", 30), flexTestItem("b", 50)
			root := flexTestRoot(140, a, b)
			root.Style.Direction, root.Style.Gap = direction, 10
			root.Style.PaddingLeft, root.Style.PaddingRight = 7, 13
			root.Style.PaddingTop, root.Style.PaddingBottom = 5, 15
			v := NewView(func() []Node { return []Node{root} })
			c := software.NewCanvas()
			c.SetPadded(false)
			c.SetContent(v)
			if err := v.BindCanvas(c); err != nil {
				t.Fatal(err)
			}
			first, second := v.Object("a"), v.Object("b")
			for _, width := range []float32{200, 320, 200} {
				c.Resize(fyne.NewSize(width, 140))
				c.Capture()
				if err := v.Error(); err != nil {
					t.Fatal(err)
				}
				if direction == "row-reverse" {
					flexTestFrame(t, v, "a", width-13-30, 5, 30, 120)
					flexTestFrame(t, v, "b", width-13-30-10-50, 5, 50, 120)
				} else {
					flexTestFrame(t, v, "a", 7, 95, width-20, 30)
					flexTestFrame(t, v, "b", 7, 35, width-20, 50)
				}
				if v.Object("a") != first || v.Object("b") != second {
					t.Fatal("reverse resize replaced an object")
				}
				snapshot, err := v.Snapshot()
				if err != nil {
					t.Fatal(err)
				}
				if snapshot.Measured || !snapshot.Responsive || snapshot.Roots[0].Children[0].Object != first || snapshot.Roots[0].Children[1].Object != second {
					t.Fatal("reverse layout changed source order or used measurements")
				}
			}
		})
	}
}

func TestReverseFlexMainAlignmentDistinguishesLogicalStart(t *testing.T) {
	for _, direction := range []string{"row-reverse", "column-reverse"} {
		for _, item := range []struct {
			justify       string
			first, second float32
		}{
			{"", 160, 110}, {"flex-start", 160, 110}, {"flex-end", 50, 0},
			{"start", 50, 0}, {"end", 160, 110}, {"center", 105, 55},
			{"space-between", 160, 0}, {"space-around", 132.5, 27.5}, {"space-evenly", 160 - 110.0/3, 110 - 220.0/3},
		} {
			t.Run(direction+"/"+item.justify, func(t *testing.T) {
				root := flexTestRoot(200, flexTestItem("a", 40), flexTestItem("b", 40))
				root.Style.Direction, root.Style.Gap, root.Style.Flex.JustifyContent = direction, 10, item.justify
				v := NewView(func() []Node { return []Node{root} })
				v.Resize(fyne.NewSize(200, 200))
				if err := v.Error(); err != nil {
					t.Fatal(err)
				}
				if direction == "row-reverse" {
					flexTestFrame(t, v, "a", item.first, 0, 40, 200)
					flexTestFrame(t, v, "b", item.second, 0, 40, 200)
				} else {
					flexTestFrame(t, v, "a", 0, item.first, 200, 40)
					flexTestFrame(t, v, "b", 0, item.second, 200, 40)
				}
			})
		}
	}
}

func TestReverseFlexNestedBorderColumnAndCrossPercent(t *testing.T) {
	a, b := flexTestItem("a", 20), flexTestItem("b", 30)
	a.Style.Flex.WidthSet, a.Style.Flex.WidthPercent = true, FlexValue(100)
	b.Style.Width, b.Style.Flex.WidthSet, b.Style.Flex.AlignSelf = 30, true, "flex-end"
	panel := flexTestItem("panel", 120)
	panel.Style.Display, panel.Style.Direction = "flex", "column-reverse"
	panel.Style.BorderWidth, panel.Style.BorderColor, panel.Style.Flex.BorderStyle = 2, "#123456", "solid"
	panel.Style.PaddingLeft, panel.Style.PaddingRight = 3, 7
	panel.Style.PaddingTop, panel.Style.PaddingBottom = 5, 9
	panel.Style.Gap = 4
	panel.Children = []Node{a, b}
	root := flexTestRoot(100, panel)
	root.Style.Direction = "row-reverse"
	v := NewView(func() []Node { return []Node{root} })
	v.Resize(fyne.NewSize(200, 100))
	if err := v.Error(); err != nil {
		t.Fatal(err)
	}
	flexTestFrame(t, v, "panel", 80, 0, 120, 100)
	flexTestFrame(t, v, "a", 5, 69, 106, 20)
	flexTestFrame(t, v, "b", 81, 35, 30, 30)
}

func TestReverseFlexEmptySingleAndOverflowRemainFinite(t *testing.T) {
	for _, direction := range []string{"row-reverse", "column-reverse"} {
		root := flexTestRoot(40)
		root.Style.Direction = direction
		v := NewView(func() []Node { return []Node{root} })
		v.Resize(fyne.NewSize(40, 40))
		if err := v.Error(); err != nil {
			t.Fatal(err)
		}
		child := flexTestItem("child", 60)
		child.Style.Flex.Shrink = FlexValue(0)
		root.Children = []Node{child}
		v.Refresh()
		if err := v.Error(); err != nil {
			t.Fatal(err)
		}
		if direction == "row-reverse" {
			flexTestFrame(t, v, "child", -20, 0, 60, 40)
		} else {
			flexTestFrame(t, v, "child", 0, -20, 40, 60)
		}
	}
	legacy := NewView(func() []Node {
		return []Node{{ID: "legacy", Kind: "container", Style: Style{Direction: "row-reverse"}}}
	})
	if legacy.Error() == nil {
		t.Fatal("legacy flow accepted a reverse direction without its layout engine")
	}
}

func TestReverseFlexNegativeFreeSpaceAndDistributedFallback(t *testing.T) {
	for _, direction := range []string{"row-reverse", "column-reverse"} {
		for _, alignment := range []struct {
			value         string
			first, second float32
		}{
			{"flex-start", 30, -30}, {"flex-end", 60, 0}, {"center", 45, -15}, {"start", 60, 0}, {"end", 30, -30},
			{"space-between", 30, -30}, {"space-around", 60, 0}, {"space-evenly", 60, 0},
		} {
			t.Run(direction+"/"+alignment.value, func(t *testing.T) {
				a, b := flexTestItem("a", 40), flexTestItem("b", 50)
				a.Style.Flex.Shrink, b.Style.Flex.Shrink = FlexValue(0), FlexValue(0)
				root := flexTestRoot(70, a, b)
				root.Style.Direction, root.Style.Gap, root.Style.Flex.JustifyContent = direction, 10, alignment.value
				v := NewView(func() []Node { return []Node{root} })
				v.Resize(fyne.NewSize(70, 70))
				if err := v.Error(); err != nil {
					t.Fatal(err)
				}
				if direction == "row-reverse" {
					flexTestFrame(t, v, "a", alignment.first, 0, 40, 70)
					flexTestFrame(t, v, "b", alignment.second, 0, 50, 70)
				} else {
					flexTestFrame(t, v, "a", 0, alignment.first, 70, 40)
					flexTestFrame(t, v, "b", 0, alignment.second, 70, 50)
				}
			})
		}
	}
}
