// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package webui

import "unicode/utf8"

// GroupList records one stable direct-child array/Fragment source site. Generated
// code calls it once after building the complete list, with the enclosing source
// namespace and each site's ID. Only physical roots belong to this group: lists
// within a root's Children retain their own independent groups.
//
// A physical root cannot carry two nested virtual list boundaries. Represent
// those boundaries with containers or reject the source instead of flattening
// them and silently changing DOM movement/focus behavior.
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
