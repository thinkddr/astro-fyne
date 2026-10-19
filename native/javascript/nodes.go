// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package javascript

import (
	"fmt"
	webui "github.com/thinkddr/astro-fyne/native"
	"math"
	"regexp"
	"strconv"
	"strings"
)

func (w *Widget) nodes(frames []Frame) ([]webui.Node, error) {
	count := 0
	var walk func([]Frame, int, string) ([]webui.Node, error)
	walk = func(frames []Frame, depth int, parentUID string) ([]webui.Node, error) {
		if depth > 100 {
			return nil, fmt.Errorf("javascript: native tree exceeds its depth limit")
		}
		nodes := make([]webui.Node, 0, len(frames))
		for _, frame := range frames {
			count++
			if count > 100000 {
				return nil, fmt.Errorf("javascript: native tree exceeds its node limit")
			}
			for _, binding := range frame.Events {
				switch binding {
				case "clicktrue", "clickfalse", "inputtrue", "inputfalse", "changetrue", "changefalse":
				default:
					return nil, fmt.Errorf("javascript: unsupported event binding %q", binding)
				}
			}
			node := webui.Node{ID: frame.Attrs["id"], Identity: "javascript/" + frame.UID}
			if node.ID == "" {
				node.ID = "_afy_js_" + frame.UID
			}
			switch frame.Tag {
			case "#text":
				node.Kind, node.Text = "text", frame.Text
			case "div", "main", "section", "header", "footer", "aside", "article", "nav", "ul", "ol", "li":
				node.Kind = "container"
			case "p", "h1", "h2", "h3", "h4", "h5", "h6", "span", "label":
				node.Kind = "text"
				if frame.Tag == "label" {
					node.Kind = "label"
				}
			case "button":
				node.Kind = "button"
			case "a":
				node.Kind = "link"
				node.Href = frame.Attrs["href"]
			case "input":
				node.Kind = "input"
				kind := asciiLower(frame.Attrs["type"])
				if kind == "checkbox" {
					node.Kind, node.Checked = "checkbox", frame.Checked
				} else if kind != "" && kind != "text" {
					return nil, fmt.Errorf("javascript: input type %s requires a native control adapter", kind)
				}
			case "textarea":
				node.Kind = "textarea"
			default:
				return nil, fmt.Errorf("javascript: element <%s> requires a native element adapter", frame.Tag)
			}
			for name, value := range frame.Attrs {
				if name == "class" && value != "" && !frame.CSS {
					return nil, fmt.Errorf("javascript: class styles require a native style adapter")
				}
				switch name {
				case "checked":
					if frame.Tag != "input" || (node.Kind != "input" && node.Kind != "checkbox") {
						return nil, fmt.Errorf("javascript: checked requires a supported native input")
					}
				case "disabled":
					if node.Kind != "input" && node.Kind != "textarea" && node.Kind != "button" && node.Kind != "checkbox" {
						return nil, fmt.Errorf("javascript: disabled requires a native input, textarea, button or checkbox")
					}
				case "id", "class", "type", "placeholder", "aria-label", "for", "href", "value":
				default:
					if !strings.HasPrefix(name, "data-") {
						return nil, fmt.Errorf("javascript: attribute %s requires a native adapter", name)
					}
				}
			}
			if value, exists := frame.Style["height"]; frame.CSS && exists && value != "" && sourceZeroPixels(value) {
				for _, name := range []string{"padding", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderWidth", "borderRadius", "margin", "gap"} {
					if value, exists := frame.Style[name]; exists && !sourceZeroPixels(value) {
						return nil, fmt.Errorf("javascript: CSS zero height requires an empty undecorated auto-width block leaf; %s must be authored zero", name)
					}
				}
			}
			var err error
			node.Style, err = sourceStyle(frame.Style)
			if err != nil {
				return nil, fmt.Errorf("javascript: %s: %w", node.ID, err)
			}
			if frame.CSS {
				for name, size := range map[string]float32{"width": node.Style.Width, "fontSize": node.Style.FontSize, "lineHeight": node.Style.LineHeight, "borderRadius": node.Style.Radius} {
					if value, exists := frame.Style[name]; exists && value != "" && size == 0 {
						return nil, fmt.Errorf("javascript: CSS zero %s requires presence-aware native sizing", name)
					}
				}
				if value, exists := frame.Style["height"]; exists && value != "" {
					node.Style.Flex = &webui.FlexStyle{HeightSet: true}
				}
				if node.Style.PaddingLeft == 0 && node.Style.PaddingRight == 0 && (node.Kind == "button" || node.Kind == "input" || node.Kind == "textarea") {
					if _, left := frame.Style["paddingLeft"]; left {
						return nil, fmt.Errorf("javascript: CSS zero control padding requires a native control style adapter")
					}
					if _, right := frame.Style["paddingRight"]; right {
						return nil, fmt.Errorf("javascript: CSS zero control padding requires a native control style adapter")
					}
				}
			}
			if value, exists := frame.Style["height"]; exists && value != "" && node.Style.Height == 0 {
				if !frame.CSS {
					return nil, fmt.Errorf("javascript: CSS zero height requires the stylesheet cascade adapter; inline-only zero sizing is unsupported")
				}
				allowed := frame.Tag == "div" || frame.Tag == "main" || frame.Tag == "section" || frame.Tag == "article" || frame.Tag == "aside" || frame.Tag == "header" || frame.Tag == "footer"
				if !allowed || len(frame.Children) != 0 || frame.Text != "" ||
					(node.Style.Display != "" && node.Style.Display != "block") || node.Style.Direction != "" ||
					node.Style.PaddingTop != 0 || node.Style.PaddingRight != 0 || node.Style.PaddingBottom != 0 || node.Style.PaddingLeft != 0 ||
					node.Style.BorderWidth != 0 || node.Style.Radius != 0 || node.Style.Gap != 0 {
					return nil, fmt.Errorf("javascript: CSS zero height requires an empty undecorated auto-width block leaf")
				}
				if value, exists := frame.Style["width"]; exists && value != "" {
					return nil, fmt.Errorf("javascript: CSS zero height requires an empty undecorated auto-width block leaf")
				}
			}
			if node.Kind == "checkbox" && len(frame.Style) > 0 {
				return nil, fmt.Errorf("javascript: checkbox styles require a native checkbox style adapter")
			}
			node.Value, node.Placeholder, node.Disabled = frame.Value, frame.Attrs["placeholder"], frame.Disabled
			node.AccessibleLabel, node.LabelFor = frame.Attrs["aria-label"], frame.Attrs["for"]
			if node.Kind == "text" || node.Kind == "label" || node.Kind == "button" || node.Kind == "link" {
				for _, child := range frame.Children {
					if child.Tag != "#text" {
						return nil, fmt.Errorf("javascript: rich text in <%s> requires a native rich-text adapter", frame.Tag)
					}
					node.Text += child.Text
				}
			} else if node.Kind == "textarea" {
				// The DOM snapshot resolves default text and dirty edits into Value.
				for _, child := range frame.Children {
					if child.Tag != "#text" {
						return nil, fmt.Errorf("javascript: rich text in <textarea> requires a native textarea adapter")
					}
				}
			} else {
				node.Children, err = walk(frame.Children, depth+1, frame.UID)
				if err != nil {
					return nil, err
				}
			}
			if node.Kind == "checkbox" {
				node.OnChecked = func(bool) { w.dispatch(frame.UID, "click", nil) }
			} else if frame.Tag == "#text" && parentUID == "" {
				node.OnTap = func() { w.Tapped(nil) }
			} else {
				uid := frame.UID
				if frame.Tag == "#text" {
					uid = parentUID
				}
				// Entry points dispatch once; the virtual DOM owns propagation.
				node.OnTap = func() { w.dispatch(uid, "click", nil) }
			}
			if node.Kind == "input" || node.Kind == "textarea" {
				node.OnChange = func(value string) { w.dispatch(frame.UID, "input", &value) }
				node.OnCommit = func(value string) { w.dispatch(frame.UID, "change", &value) }
			}
			nodes = append(nodes, node)
		}
		return nodes, nil
	}
	return walk(frames, 0, "")
}

func asciiLower(value string) string {
	data := []byte(value)
	for i, ch := range data {
		if ch >= 'A' && ch <= 'Z' {
			data[i] = ch + ('a' - 'A')
		}
	}
	return string(data)
}

var cssPixelNumber = regexp.MustCompile(`^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?(?:px)?$`)
var cssZeroPixels = regexp.MustCompile(`^[+-]?(?:0+(?:\.0*)?|\.0+)(?:[eE][+-]?\d+)?(?:px)?$`)

func sourceZeroPixels(value any) bool {
	switch v := value.(type) {
	case float64:
		return v == 0
	case string:
		return v == "" || cssZeroPixels.MatchString(strings.Trim(v, " \t\r\n\f"))
	default:
		return false
	}
}

func sourceHeight(value any) (float32, error) {
	var n float64
	switch v := value.(type) {
	case float64:
		n = v
	case string:
		v = strings.Trim(v, " \t\r\n\f")
		if !cssPixelNumber.MatchString(v) {
			return 0, fmt.Errorf("CSS height requires finite nonnegative pixels")
		}
		var err error
		n, err = strconv.ParseFloat(strings.TrimSuffix(v, "px"), 64)
		if err != nil || !strings.HasSuffix(v, "px") && n != 0 {
			return 0, fmt.Errorf("CSS height requires finite nonnegative pixels")
		}
		if n == 0 && !cssZeroPixels.MatchString(v) {
			return 0, fmt.Errorf("CSS nonzero height underflows native pixels")
		}
	default:
		return 0, fmt.Errorf("CSS height requires finite nonnegative pixels")
	}
	if math.IsNaN(n) || math.IsInf(n, 0) || n < 0 || n > math.MaxFloat32 {
		return 0, fmt.Errorf("CSS height requires finite nonnegative pixels")
	}
	if n > 0 && float32(n) == 0 {
		return 0, fmt.Errorf("CSS positive height underflows native pixels")
	}
	return float32(n), nil
}

func sourceStyle(properties map[string]any) (webui.Style, error) {
	style := webui.Style{}
	number := func(value any) (float32, error) {
		switch v := value.(type) {
		case float64:
			if !math.IsNaN(v) && !math.IsInf(v, 0) && v >= 0 && v <= math.MaxFloat32 {
				return float32(v), nil
			}
		case string:
			v = strings.Trim(v, " \t\r\n\f")
			if cssPixelNumber.MatchString(v) && !strings.HasSuffix(v, "px") {
				if n, err := strconv.ParseFloat(v, 64); err == nil && n == 0 {
					return 0, nil
				}
			}
			if strings.HasSuffix(v, "px") {
				n, err := strconv.ParseFloat(strings.TrimSuffix(v, "px"), 32)
				if err == nil && n >= 0 && !math.IsInf(n, 0) {
					return float32(n), nil
				}
			}
		}
		return 0, fmt.Errorf("CSS value %v requires finite nonnegative pixels", value)
	}
	numeric := map[string]*float32{"width": &style.Width, "paddingTop": &style.PaddingTop, "paddingRight": &style.PaddingRight, "paddingBottom": &style.PaddingBottom, "paddingLeft": &style.PaddingLeft, "gap": &style.Gap, "fontSize": &style.FontSize, "borderWidth": &style.BorderWidth, "borderRadius": &style.Radius}
	fontSize := float32(14)
	if value, exists := properties["fontSize"]; exists && value != "" {
		var err error
		fontSize, err = number(value)
		if err != nil {
			return style, err
		}
	}
	if value := properties["padding"]; value != nil && value != "" {
		for _, name := range []string{"paddingTop", "paddingRight", "paddingBottom", "paddingLeft"} {
			if value := properties[name]; value != nil && value != "" {
				return style, fmt.Errorf("mixed padding shorthand/longhands require an ordered CSS adapter")
			}
		}
	}
	if background, color := properties["background"], properties["backgroundColor"]; background != nil && background != "" && color != nil && color != "" {
		return style, fmt.Errorf("mixed background shorthand/longhand requires an ordered CSS adapter")
	}
	textual := map[string]*string{"background": &style.Background, "backgroundColor": &style.Background, "color": &style.Color, "borderColor": &style.BorderColor, "fontFamily": &style.FontFamily, "fontStyle": &style.FontStyle, "textAlign": &style.TextAlign, "whiteSpace": &style.WhiteSpace}
	for name, value := range properties {
		if value == "" {
			continue
		}
		if field := numeric[name]; field != nil {
			n, err := number(value)
			if err != nil {
				return style, err
			}
			*field = n
			continue
		}
		if field := textual[name]; field != nil {
			text, ok := value.(string)
			if !ok {
				return style, fmt.Errorf("CSS %s requires a string", name)
			}
			if name == "color" || name == "background" || name == "backgroundColor" || name == "borderColor" {
				if _, err := webui.ParseColor(text); err != nil {
					return style, err
				}
			}
			*field = text
			continue
		}
		switch name {
		case "height":
			n, err := sourceHeight(value)
			if err != nil {
				return style, err
			}
			style.Height = n
		case "padding":
			n, err := number(value)
			if err != nil {
				return style, err
			}
			style.PaddingTop, style.PaddingRight, style.PaddingBottom, style.PaddingLeft = n, n, n, n
		case "display":
			text, _ := value.(string)
			if text != "flex" && text != "block" && text != "none" {
				return style, fmt.Errorf("CSS display %v requires a native layout adapter", value)
			}
			style.Display = text
		case "flexDirection":
			text, _ := value.(string)
			if text != "row" && text != "column" {
				return style, fmt.Errorf("CSS flexDirection %v requires a native layout adapter", value)
			}
			style.Direction = text
		case "fontWeight":
			var text string
			switch v := value.(type) {
			case string:
				text = v
			case float64:
				text = strconv.FormatFloat(v, 'f', -1, 64)
			}
			n, err := strconv.ParseFloat(text, 32)
			if err != nil || math.IsNaN(n) || math.IsInf(n, 0) || n < 1 || n > 1000 {
				return style, fmt.Errorf("CSS fontWeight requires a numeric weight")
			}
			style.FontWeight = float32(n)
		case "lineHeight":
			if n, ok := value.(float64); ok {
				if n < 0 || math.IsInf(n, 0) || math.IsNaN(n) {
					return style, fmt.Errorf("CSS lineHeight requires a finite nonnegative multiplier")
				}
				style.LineHeight = float32(n) * fontSize
			} else {
				n, err := number(value)
				if err != nil {
					return style, err
				}
				style.LineHeight = n
			}
		case "borderStyle":
			if value != "solid" {
				return style, fmt.Errorf("CSS borderStyle requires solid")
			}
		case "margin":
			if n, err := number(value); err != nil || n != 0 {
				return style, fmt.Errorf("CSS margins require a native layout adapter")
			}
		default:
			return style, fmt.Errorf("CSS property %s requires a native style adapter", name)
		}
	}
	if style.Display == "flex" && style.Direction == "" {
		style.Direction = "row"
	}
	return style, nil
}
