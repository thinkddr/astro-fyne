// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

// astro-fyne-demo opens a generated example in a native Fyne window.
package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"

	"fyne.io/fyne/v2"
	"fyne.io/fyne/v2/app"
	"fyne.io/fyne/v2/theme"
	webui "github.com/thinkddr/astro-fyne/native"
	"github.com/thinkddr/astro-fyne/native/generated"
)

func main() { os.Exit(run(os.Args[1:], os.Stderr)) }

func parseExample(args []string, output io.Writer) (string, error) {
	flags := flag.NewFlagSet("astro-fyne-demo", flag.ContinueOnError)
	flags.SetOutput(output)
	example := flags.String("example", "counter", "generated example to open: counter or responsive")
	if err := flags.Parse(args); err != nil {
		return "", err
	}
	if flags.NArg() != 0 {
		return "", fmt.Errorf("unexpected arguments; use --example counter or --example responsive")
	}
	if *example != "counter" && *example != "responsive" {
		return "", fmt.Errorf("unknown example %q; choose counter or responsive", *example)
	}
	return *example, nil
}

func run(args []string, stderr io.Writer) int {
	example, err := parseExample(args, stderr)
	if errors.Is(err, flag.ErrHelp) {
		return 0
	}
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 2
	}
	a := app.NewWithID("org.astro-fyne.demo")
	defer a.Quit()
	_, window, err := newDemoWindow(a, example)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	window.ShowAndRun()
	return 0
}

func newDemoWindow(a fyne.App, example string) (*webui.View, fyne.Window, error) {
	var view *webui.View
	var content fyne.CanvasObject
	var generatedTheme fyne.Theme
	var err error
	size, title := fyne.NewSize(520, 320), "Astro Fyne — Counter"
	switch example {
	case "counter":
		generatedTheme, err = generated.NewCounterTheme(theme.DefaultTheme())
		if err == nil {
			a.Settings().SetTheme(generatedTheme)
			var widget *generated.CounterWidget
			widget, err = generated.NewCounter(nil, nil)
			if err == nil {
				view, content = widget.View, widget
			}
		}
	case "responsive":
		generatedTheme, err = generated.NewResponsiveControlsTheme(theme.DefaultTheme())
		if err == nil {
			a.Settings().SetTheme(generatedTheme)
			var widget *generated.ResponsiveControlsWidget
			widget, err = generated.NewResponsiveControls(nil, nil)
			if err == nil {
				view, content = widget.View, widget
			}
		}
		size, title = fyne.NewSize(480, 320), "Astro Fyne — Responsive controls"
	default:
		return nil, nil, fmt.Errorf("unknown example %q", example)
	}
	if err != nil {
		return nil, nil, fmt.Errorf("create generated %s example: %w", example, err)
	}
	window := a.NewWindow(title)
	window.SetPadded(false)
	window.SetContent(content)
	window.Resize(size)
	if err := view.BindCanvas(window.Canvas()); err != nil {
		window.Close()
		return nil, nil, fmt.Errorf("bind native canvas: %w", err)
	}
	if err := view.Error(); err != nil {
		window.Close()
		return nil, nil, fmt.Errorf("render generated %s example: %w", example, err)
	}
	return view, window, nil
}
