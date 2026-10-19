// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package fontresource

import (
	"runtime/debug"
	"strings"
	"testing"
)

func TestCoverageParserIdentityUsesOriginalQualifiedDependency(t *testing.T) {
	info := &debug.BuildInfo{Deps: []*debug.Module{
		{Path: "unrelated.example/module", Version: "v1.0.0"},
		nil,
		{Path: "github.com/go-text/typesetting", Version: "v0.3.4"},
	}}
	identity, err := coverageParserIdentity(info)
	if err != nil || identity != "github.com/go-text/typesetting@v0.3.4" {
		t.Fatalf("qualified dependency identity changed: %q %v", identity, err)
	}
}

func TestCoverageParserIdentityRejectsUnqualifiedAndReplacedBuilds(t *testing.T) {
	for _, scenario := range []struct {
		name string
		info *debug.BuildInfo
	}{
		{"no-info", nil},
		{"missing-dependency", &debug.BuildInfo{}},
		{"empty-version", &debug.BuildInfo{Deps: []*debug.Module{{Path: "github.com/go-text/typesetting"}}}},
		{"development-version", &debug.BuildInfo{Deps: []*debug.Module{{Path: "github.com/go-text/typesetting", Version: "(devel)"}}}},
		{"upgraded-version", &debug.BuildInfo{Deps: []*debug.Module{{Path: "github.com/go-text/typesetting", Version: "v0.3.5"}}}},
		{"downgraded-version", &debug.BuildInfo{Deps: []*debug.Module{{Path: "github.com/go-text/typesetting", Version: "v0.3.3"}}}},
		{"local-replacement", &debug.BuildInfo{Deps: []*debug.Module{{Path: "github.com/go-text/typesetting", Version: "v0.3.4", Replace: &debug.Module{Path: "/private/replacement/font-parser"}}}}},
		{"versioned-replacement", &debug.BuildInfo{Deps: []*debug.Module{{Path: "github.com/go-text/typesetting", Version: "v0.3.4", Replace: &debug.Module{Path: "replacement.example/font-parser", Version: "v0.3.4"}}}}},
		{"repeated-dependency", &debug.BuildInfo{Deps: []*debug.Module{{Path: "github.com/go-text/typesetting", Version: "v0.3.4"}, {Path: "github.com/go-text/typesetting", Version: "v0.3.4"}}}},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			identity, err := coverageParserIdentity(scenario.info)
			if err == nil || identity != "" {
				t.Fatalf("unqualified parser identity was advertised: %q %v", identity, err)
			}
			if strings.Contains(err.Error(), "/private/") || strings.Contains(err.Error(), "replacement.example") {
				t.Fatal("parser diagnostic exposed a replacement path")
			}
		})
	}
}
