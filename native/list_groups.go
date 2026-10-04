// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package webui

import "unicode/utf8"

// GroupList tags a completed direct-child array/Fragment by its stable source site.
// Only physical roots are tagged; child lists keep their own groups. Nested virtual
// boundaries on one physical root require a container or an unsupported-source error.
func GroupList(nodes []Node, group string) []Node {
	if group == "" || !utf8.ValidString(group) {
		panic("webui: list group requires a nonempty Unicode source-site identity")
	}
	for _, node := range nodes {
		if node.ListGroup != "" && node.ListGroup != group {
			panic("webui: nested virtual list groups require a physical root boundary")
		}
	}
	for i := range nodes {
		nodes[i].ListGroup = group
	}
	return nodes
}
