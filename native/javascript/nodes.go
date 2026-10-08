// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package javascript

import (
	"fmt"
	webui "github.com/thinkddr/astro-fyne/native"
	"math"
	"strconv"
	"strings"
)

func (w *Widget) nodes(frames []Frame) ([]webui.Node, error) {
	count := 0
	var walk func([]Frame, int) ([]webui.Node, error)
	walk = func(frames []Frame, depth int) ([]webui.Node, error) {
		if depth > 100 {
			return nil, fmt.Errorf("javascript: native tree exceeds its depth limit")
		}
		nodes := make([]webui.Node, 0, len(frames))
		for _, frame := range frames {
			count++
			if count > 100000 {
				return nil, fmt.Errorf("javascript: native tree exceeds its node limit")
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
			case "button":
				node.Kind = "button"
			case "a":
				node.Kind = "link"
				node.Href = frame.Attrs["href"]
			case "input":
				node.Kind = "input"
				if kind := frame.Attrs["type"]; kind != "" && kind != "text" {
					return nil, fmt.Errorf("javascript: input type %s requires a native control adapter", kind)
				}
			case "textarea":
				node.Kind = "textarea"
			default:
				return nil, fmt.Errorf("javascript: element <%s> requires a native element adapter", frame.Tag)
			}
			for name, value := range frame.Attrs {
				if name == "class" && value != "" {
					return nil, fmt.Errorf("javascript: class styles require a native style adapter")
				}
				switch name {
				case "id", "class", "type", "placeholder", "aria-label", "for", "href", "value":
				default:
					if !strings.HasPrefix(name, "data-") {
						return nil, fmt.Errorf("javascript: attribute %s requires a native adapter", name)
					}
				}
			}
			var err error
			node.Style, err = sourceStyle(frame.Style)
			if err != nil {
				return nil, fmt.Errorf("javascript: %s: %w", node.ID, err)
			}
			node.Value, node.Placeholder, node.Disabled = frame.Value, frame.Attrs["placeholder"], frame.Disabled
			node.AccessibleLabel, node.LabelFor = frame.Attrs["aria-label"], frame.Attrs["for"]
			if node.Kind == "text" || node.Kind == "button" || node.Kind == "link" {
				for _, child := range frame.Children {
					if child.Tag != "#text" {
						return nil, fmt.Errorf("javascript: rich text in <%s> requires a native rich-text adapter", frame.Tag)
					}
					node.Text += child.Text
				}
			} else {
				node.Children, err = walk(frame.Children, depth+1)
				if err != nil {
					return nil, err
				}
			}
			// Clicks on native controls bubble through their virtual DOM ancestors.
			if node.Kind == "button" || node.Kind == "link" {
				node.OnTap = func() { w.dispatch(frame.UID, "click", nil) }
			}
			if node.Kind == "input" || node.Kind == "textarea" {
				node.OnChange = func(value string) { w.dispatch(frame.UID, "input", &value) }
				node.OnCommit = func(value string) { w.dispatch(frame.UID, "change", &value) }
			}
			nodes = append(nodes, node)
		}
		return nodes, nil
	}
	return walk(frames, 0)
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
			if strings.HasSuffix(v, "px") {
				n, err := strconv.ParseFloat(strings.TrimSuffix(v, "px"), 32)
				if err == nil && n >= 0 && !math.IsInf(n, 0) {
					return float32(n), nil
				}
			}
		}
		return 0, fmt.Errorf("CSS value %v requires finite nonnegative pixels", value)
	}
	numeric := map[string]*float32{"width": &style.Width, "height": &style.Height, "paddingTop": &style.PaddingTop, "paddingRight": &style.PaddingRight, "paddingBottom": &style.PaddingBottom, "paddingLeft": &style.PaddingLeft, "gap": &style.Gap, "fontSize": &style.FontSize, "borderWidth": &style.BorderWidth, "borderRadius": &style.Radius}
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
			if value != "0px" && value != float64(0) {
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
