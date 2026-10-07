// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package webui

import (
	"fmt"
	"math"

	"fyne.io/fyne/v2"
)

// FlexStyle enables the supported single-line source layout. Numeric pointers
// preserve omitted declarations versus zero; WidthSet/HeightSet distinguish 0px
// from auto. Dimensions and bases use border-box CSS pixels.
//
// The tree requires a width:100% root with fixed height, pixel item bases and min0.
// Intrinsic sizing, wrap/order/reverse, nonzero margins/minima, percentage bases
// and max constraints are unsupported. Text/control/bitmap leaves need explicit styles.
type FlexStyle struct {
	Grow           *float32 `json:"grow,omitempty"`
	Shrink         *float32 `json:"shrink,omitempty"`
	Basis          *float32 `json:"basis,omitempty"`
	MinWidth       *float32 `json:"minWidth,omitempty"`
	MinHeight      *float32 `json:"minHeight,omitempty"`
	WidthPercent   *float32 `json:"widthPercent,omitempty"`
	HeightPercent  *float32 `json:"heightPercent,omitempty"`
	WidthSet       bool     `json:"widthSet,omitempty"`
	HeightSet      bool     `json:"heightSet,omitempty"`
	JustifyContent string   `json:"justifyContent,omitempty"`
	AlignItems     string   `json:"alignItems,omitempty"`
	AlignSelf      string   `json:"alignSelf,omitempty"`
	BoxSizing      string   `json:"boxSizing,omitempty"`
	BorderStyle    string   `json:"borderStyle,omitempty"`
	Appearance     string   `json:"appearance,omitempty"`
	MarginSet      bool     `json:"marginSet,omitempty"`
}

// FlexValue preserves presence for numeric CSS declarations, including zero.
func FlexValue(value float32) *float32 { return &value }

// Clone pointer metadata in the owned tree so host edits cannot change the last valid frame.
func freezeFlexStyles(nodes []Node) {
	for i := range nodes {
		if source := nodes[i].Style.Flex; source != nil {
			f := *source
			clone := func(value *float32) *float32 {
				if value == nil {
					return nil
				}
				return FlexValue(*value)
			}
			f.Grow, f.Shrink, f.Basis = clone(f.Grow), clone(f.Shrink), clone(f.Basis)
			f.MinWidth, f.MinHeight = clone(f.MinWidth), clone(f.MinHeight)
			f.WidthPercent, f.HeightPercent = clone(f.WidthPercent), clone(f.HeightPercent)
			nodes[i].Style.Flex = &f
		}
		freezeFlexStyles(nodes[i].Children)
	}
}

func validateFlexStyle(id string, style Style) error {
	f := style.Flex
	if f == nil {
		return nil
	}
	for _, value := range []*float32{f.Grow, f.Shrink, f.Basis, f.MinWidth, f.MinHeight, f.WidthPercent, f.HeightPercent} {
		if value != nil && (!finite(*value) || *value < 0) {
			return fmt.Errorf("webui: nonfinite or negative flex declaration on %q", id)
		}
	}
	if !finite(horizontalDecoration(style)) || !finite(verticalDecoration(style)) {
		return fmt.Errorf("webui: overflowing flex padding or border on %q", id)
	}
	return nil
}

// validateFlexTree checks expanded nodes before reconcile touches native objects.
// Legacy source dimension metadata alone is not an opt-in to the flex engine.
func validateFlexTree(nodes []Node) error {
	var hasFlexDisplay func([]Node) bool
	hasFlexDisplay = func(nodes []Node) bool {
		for _, node := range nodes {
			if node.Style.Display == "flex" || hasFlexDisplay(node.Children) {
				return true
			}
		}
		return false
	}
	if !hasFlexDisplay(nodes) {
		var checkLegacy func([]Node) error
		checkLegacy = func(nodes []Node) error {
			for _, node := range nodes {
				f := node.Style.Flex
				if f != nil && (f.Grow != nil || f.Shrink != nil || f.Basis != nil || f.MinWidth != nil || f.MinHeight != nil ||
					f.WidthPercent != nil || f.HeightPercent != nil || f.JustifyContent != "" || f.AlignItems != "" ||
					f.AlignSelf != "" || f.BoxSizing != "" || f.BorderStyle != "" || f.Appearance != "" || f.MarginSet) {
					return fmt.Errorf("webui: flex declarations on %q require a supported responsive flex root", node.ID)
				}
				if err := checkLegacy(node.Children); err != nil {
					return err
				}
			}
			return nil
		}
		return checkLegacy(nodes)
	}
	if len(nodes) != 1 || nodes[0].Style.Display != "flex" {
		return fmt.Errorf("webui: responsive flex requires one flex root, not a nested legacy flex context")
	}
	var check func(Node, *Style) error
	check = func(node Node, parent *Style) error {
		s, f := node.Style, node.Style.Flex
		fail := func(reason string) error { return fmt.Errorf("webui: responsive flex node %q: %s", node.ID, reason) }
		if f == nil || f.BoxSizing != "border-box" {
			return fail("explicit flex metadata and box-sizing:border-box are required")
		}
		if parent == nil && node.Kind != "container" {
			return fail("root must be a container")
		}
		if node.Kind != "container" && (len(node.Children) > 0 || !f.MarginSet) {
			return fail("leaves require margin:0 and cannot contain children")
		}
		switch node.Kind {
		case "container":
			if node.Text != "" || node.Value != "" || node.Placeholder != "" || node.Href != "" || node.ImageResource != nil || node.OnTap != nil || node.OnChange != nil || node.OnCommit != nil {
				return fail("containers cannot carry text, editor data, images or callbacks")
			}
		case "text", "button":
			if node.Value != "" || node.Placeholder != "" || node.Href != "" || node.ImageResource != nil || node.OnChange != nil || node.OnCommit != nil || node.Kind == "text" && node.OnTap != nil {
				return fail("unsupported text/button fields or callbacks")
			}
		case "input":
			if node.Text != "" || node.Href != "" || node.ImageResource != nil || node.OnTap != nil {
				return fail("unsupported single-line input fields or callbacks")
			}
			if invalidSingleLineInput(node.Value) || invalidSingleLineInput(node.Placeholder) {
				return fail("single-line input value and placeholder cannot contain control characters")
			}
		case "image":
			if node.Text != "" || node.Value != "" || node.Placeholder != "" || node.Href != "" || node.OnTap != nil || node.OnChange != nil || node.OnCommit != nil || node.ImageResource == nil {
				return fail("image requires a bitmap resource without text or callbacks")
			}
			if s.Display != "block" || !f.WidthSet || !f.HeightSet || s.Width <= 0 || s.Height <= 0 || f.WidthPercent != nil || f.HeightPercent != nil {
				return fail("image requires display:block and explicit positive pixel dimensions")
			}
		default:
			return fail("supported leaves are text, button, single-line input and bitmap image")
		}
		if node.Kind == "text" || node.Kind == "button" || node.Kind == "input" {
			if err := validateResponsiveTextStyle(s); err != nil {
				return fail(err.Error())
			}
		}
		if node.Kind == "button" || node.Kind == "input" {
			if f.Appearance != "none" || f.BorderStyle != "solid" || s.Background == "" {
				return fail("controls require appearance:none, explicit background and a solid border style (zero width allowed)")
			}
		} else if f.Appearance != "" {
			return fail("appearance is supported only on button and input leaves")
		}
		if s.Display != "" && s.Display != "block" && s.Display != "flex" {
			return fail("display must be block or flex; hidden layout is unsupported")
		}
		if len(node.Children) > 0 && s.Display != "flex" {
			return fail("a container with children must use display:flex")
		}
		if s.Direction != "" && s.Direction != "row" && s.Direction != "column" {
			return fail("only row and column directions are supported")
		}
		if s.X != 0 || s.Y != 0 {
			return fail("position offsets are not source flex declarations")
		}
		if s.Opacity != 0 && s.Opacity != 1 {
			return fail("group opacity requires a compositor")
		}
		if f.BorderStyle != "" && f.BorderStyle != "solid" {
			return fail("only a solid uniform border is supported")
		}
		if s.BorderWidth > 0 && (f.BorderStyle != "solid" || s.BorderColor == "") {
			return fail("a positive border requires explicit border-style:solid and border-color")
		}
		if s.BorderWidth != float32(math.Trunc(float64(s.BorderWidth))) {
			return fail("source border widths must be integral CSS pixels; fractional used-border snapping is unsupported")
		}
		if f.MinWidth != nil && *f.MinWidth != 0 || f.MinHeight != nil && *f.MinHeight != 0 {
			return fail("only explicit zero minima are supported")
		}
		if !justifySupported(f.JustifyContent) || !alignSupported(f.AlignItems, false) || !alignSupported(f.AlignSelf, true) {
			return fail("unsupported justification or alignment")
		}
		if s.Width != 0 && !f.WidthSet || s.Height != 0 && !f.HeightSet {
			return fail("pixel dimensions require explicit presence metadata")
		}
		if f.WidthPercent != nil && (*f.WidthPercent != 100 || !f.WidthSet || s.Width != 0) ||
			f.HeightPercent != nil && (*f.HeightPercent != 100 || !f.HeightSet || s.Height != 0) {
			return fail("only explicit 100% dimensions without a simultaneous pixel size are supported")
		}
		if parent == nil {
			if f.WidthPercent == nil || *f.WidthPercent != 100 || !f.HeightSet || s.Height <= 0 || f.HeightPercent != nil {
				return fail("root requires width:100% and a positive definite pixel height")
			}
		} else {
			if f.Basis == nil || f.MinWidth == nil || f.MinHeight == nil {
				return fail("each item requires a definite pixel basis and explicit min-width/min-height:0")
			}
			row := flexRow(*parent)
			if row && f.WidthPercent != nil || !row && f.HeightPercent != nil {
				return fail("percentage sizes are supported only on the cross axis")
			}
			crossSet := f.HeightSet
			if !row {
				crossSet = f.WidthSet
			}
			if (len(node.Children) > 0 || node.Kind != "container") && !crossSet && itemAlignment(*parent, s) != "stretch" {
				return fail("nonempty items require a definite cross size or stretch; intrinsic sizing is unsupported")
			}
		}
		for _, child := range node.Children {
			if err := check(child, &s); err != nil {
				return err
			}
		}
		return nil
	}
	return check(nodes[0], nil)
}

// Source borders require integral CSS and device pixels; snapping is unsupported.
func (v *View) validateFlexCanvas() error {
	bordered := false
	for _, e := range v.elements {
		bordered = bordered || e.style.BorderWidth > 0
	}
	if !bordered {
		return nil
	}
	target := v.boundCanvas
	if target == nil && fyne.CurrentApp() != nil && fyne.CurrentApp().Driver() != nil {
		target = fyne.CurrentApp().Driver().CanvasForObject(v.owner)
	}
	if target == nil {
		return fmt.Errorf("webui: bind the native canvas to validate responsive border device pixels")
	}
	scale := target.Scale()
	if !finite(scale) || scale <= 0 {
		return fmt.Errorf("webui: responsive border requires a positive finite device scale")
	}
	for _, e := range v.elements {
		width := float64(e.style.BorderWidth) * float64(scale)
		if width != math.Trunc(width) {
			return fmt.Errorf("webui: responsive border on %q is fractional at device scale %v; used-border snapping is unsupported", e.node.ID, scale)
		}
	}
	return nil
}

func justifySupported(value string) bool {
	switch value {
	case "", "start", "flex-start", "end", "flex-end", "center", "space-between", "space-around", "space-evenly":
		return true
	}
	return false
}
func alignSupported(value string, self bool) bool {
	switch value {
	case "", "start", "flex-start", "end", "flex-end", "center", "stretch":
		return true
	case "auto":
		return self
	}
	return false
}

func horizontalDecoration(s Style) float32 { return s.PaddingLeft + s.PaddingRight + 2*s.BorderWidth }
func verticalDecoration(s Style) float32   { return s.PaddingTop + s.PaddingBottom + 2*s.BorderWidth }
func flexRow(s Style) bool                 { return s.Direction != "column" }

// A host may move, resize or hide actual Fyne objects without changing their
// source declarations. Frozen snapshots preserve that frame, but a responsive
// export must not silently replace those overrides with the source algorithm.
func (v *View) sourceLayoutMatchesFrame() bool {
	if len(v.roots) != 1 {
		return false
	}
	var matches func(*element, fyne.Position, fyne.Size) bool
	matches = func(e *element, position fyne.Position, size fyne.Size) bool {
		if !e.object.Visible() || e.object.Position() != position || e.object.Size() != size {
			return false
		}
		if len(e.children) == 0 {
			return true
		}
		s := e.style
		left, top := s.PaddingLeft+s.BorderWidth, s.PaddingTop+s.BorderWidth
		content := fyne.NewSize(max(size.Width-left-s.PaddingRight-s.BorderWidth, 0), max(size.Height-top-s.PaddingBottom-s.BorderWidth, 0))
		origin := fyne.NewPos(left, top)
		frames, err := flexFrames(e.children, s, content, origin)
		if err != nil {
			return false
		}
		for i, child := range e.children {
			if !matches(child, frames[i].position, frames[i].size) {
				return false
			}
		}
		return true
	}
	root := v.roots[0]
	size := fyne.NewSize(max(v.Size().Width, horizontalDecoration(root.style)), max(root.style.Height, verticalDecoration(root.style)))
	return matches(root, fyne.NewPos(0, 0), size)
}

func itemAlignment(parent, child Style) string {
	align := child.Flex.AlignSelf
	if align == "" || align == "auto" {
		align = parent.Flex.AlignItems
	}
	switch align {
	case "", "stretch":
		return "stretch"
	case "flex-start":
		return "start"
	case "flex-end":
		return "end"
	}
	return align
}

type flexItem struct {
	base, floor, target, grow, shrink float64
	frozen                            bool
}

// flexibleSizes resolves one line: hypothetical sizes choose grow/shrink,
// scaled shrink uses inner bases, and decoration floors freeze and redistribute.
// Zero factors and below-floor shrink bases freeze first; max constraints are absent.
func flexibleSizes(children []*element, main float32, row bool, gap float32) []float32 {
	items := make([]flexItem, len(children))
	available := float64(main) - float64(gap)*float64(max(len(children)-1, 0))
	var hypothetical float64
	for i, child := range children {
		f, s := child.style.Flex, child.style
		floor := verticalDecoration(s)
		if row {
			floor = horizontalDecoration(s)
		}
		item := flexItem{base: float64(*f.Basis), floor: float64(floor), shrink: 1}
		if f.Grow != nil {
			item.grow = float64(*f.Grow)
		}
		if f.Shrink != nil {
			item.shrink = float64(*f.Shrink)
		}
		item.target = item.base
		hypothetical += max(item.base, item.floor)
		items[i] = item
	}
	grow := hypothetical < available
	for i := range items {
		item := &items[i]
		if grow && item.grow == 0 || !grow && (item.shrink == 0 || item.base < item.floor) {
			item.target = max(item.base, item.floor)
			item.frozen = true
		}
	}
	freeSpace := func() float64 {
		free := available
		for _, item := range items {
			if item.frozen {
				free -= item.target
			} else {
				free -= item.base
			}
		}
		return free
	}
	initialFree := freeSpace()
	for {
		var factorSum, weightSum float64
		unfrozen := 0
		for _, item := range items {
			if item.frozen {
				continue
			}
			unfrozen++
			if grow {
				factorSum += item.grow
				weightSum += item.grow
			} else {
				factorSum += item.shrink
				weightSum += item.shrink * (item.base - item.floor)
			}
		}
		if unfrozen == 0 {
			break
		}
		remaining := freeSpace()
		if factorSum < 1 {
			partial := initialFree * factorSum
			if math.Abs(partial) < math.Abs(remaining) {
				remaining = partial
			}
		}
		violation := false
		for i := range items {
			item := &items[i]
			if item.frozen {
				continue
			}
			item.target = item.base
			if weightSum > 0 {
				if grow {
					item.target += remaining * item.grow / weightSum
				} else {
					item.target -= math.Abs(remaining) * item.shrink * (item.base - item.floor) / weightSum
				}
			}
			if item.target < item.floor {
				item.target = item.floor
				item.frozen = true
				violation = true
			}
		}
		if !violation {
			break
		}
	}
	out := make([]float32, len(items))
	for i, item := range items {
		out[i] = float32(item.target)
	}
	return out
}

type flexFrame struct {
	position fyne.Position
	size     fyne.Size
}

// flexFrames is shared by live layout and source-frame validation. Computing a
// proposed tree must not mutate the last valid objects or evaluate callbacks.
func flexFrames(children []*element, parent Style, content fyne.Size, origin fyne.Position) ([]flexFrame, error) {
	row := flexRow(parent)
	main, cross := content.Height, content.Width
	if row {
		main, cross = content.Width, content.Height
	}
	sizes := flexibleSizes(children, main, row, parent.Gap)
	used := float64(parent.Gap) * float64(max(len(children)-1, 0))
	for _, size := range sizes {
		used += float64(size)
	}
	free := float64(main) - used
	var offset, extraGap float64
	switch parent.Flex.JustifyContent {
	case "end", "flex-end":
		offset = free
	case "center":
		offset = free / 2
	case "space-between":
		if free > 0 && len(children) > 1 {
			extraGap = free / float64(len(children)-1)
		}
	case "space-around":
		if free >= 0 && len(children) > 0 {
			extraGap = free / float64(len(children))
			offset = extraGap / 2
		}
	case "space-evenly":
		if free >= 0 {
			extraGap = free / float64(len(children)+1)
			offset = extraGap
		}
	}
	frames := make([]flexFrame, len(children))
	for i, child := range children {
		s, f := child.style, child.style.Flex
		crossSize, crossSet, percent := s.Width, f.WidthSet, f.WidthPercent
		crossFloor := horizontalDecoration(s)
		if row {
			crossSize, crossSet, percent = s.Height, f.HeightSet, f.HeightPercent
			crossFloor = verticalDecoration(s)
		}
		align := itemAlignment(parent, s)
		if percent != nil || !crossSet && align == "stretch" {
			crossSize = cross
		}
		crossSize = max(crossSize, crossFloor)
		var crossOffset float32
		switch align {
		case "end":
			crossOffset = cross - crossSize
		case "center":
			crossOffset = (cross - crossSize) / 2
		}
		position := fyne.NewPos(origin.X+crossOffset, origin.Y+float32(offset))
		size := fyne.NewSize(crossSize, sizes[i])
		if row {
			position = fyne.NewPos(origin.X+float32(offset), origin.Y+crossOffset)
			size = fyne.NewSize(sizes[i], crossSize)
		}
		if !finite(position.X) || !finite(position.Y) || !finite(size.Width) || !finite(size.Height) || size.Width < 0 || size.Height < 0 {
			return nil, fmt.Errorf("webui: responsive flex computed nonfinite or negative bounds for %q", child.node.ID)
		}
		frames[i] = flexFrame{position: position, size: size}
		offset += float64(sizes[i]) + float64(parent.Gap) + extraGap
	}
	return frames, nil
}

func layoutFlex(children []*element, parent Style, content fyne.Size, origin fyne.Position) error {
	frames, err := flexFrames(children, parent, content, origin)
	if err != nil {
		return err
	}
	// Validate the whole line before assigning any child's new frame.
	for i, child := range children {
		child.object.Move(frames[i].position)
		child.object.Resize(frames[i].size)
	}
	return nil
}
