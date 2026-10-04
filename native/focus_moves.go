// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package webui

import "container/list"

// movedSiblings follows Preact's skew and insertion-cursor decisions for direct
// DOM siblings, each represented by one native element. Merely changing a
// sibling's index does not imply insertBefore: for [A,B] -> [B,A], A moves while
// B remains attached. Moving a DOM ancestor removes its descendant's focus in
// Chromium, even though the keyed object and component state survive.
//
// This contract covers one direct-child array/Fragment of the compiler's
// single-root keyed elements/components. Nested virtual groups with multiple
// roots, suspended children and hydration comment anchors need more VNode
// metadata and are outside this model.
func movedSiblings(previous, current []*element) []*element {
	previousIndex := make(map[*element]int, len(previous))
	for i, e := range previous {
		previousIndex[e] = i
	}
	insert := make([]bool, len(current))
	remaining := make(map[*element]bool, len(current))
	skew := 0
	for i, e := range current {
		remaining[e] = true
		oldIndex, matched := previousIndex[e]
		if !matched {
			insert[i] = true
			if len(current) > len(previous) {
				skew--
			} else if len(current) < len(previous) {
				skew++
			}
			continue
		}
		aligned := i + skew
		if oldIndex == aligned {
			continue
		}
		if oldIndex == aligned-1 {
			skew--
		} else if oldIndex == aligned+1 {
			skew++
		} else {
			insert[i] = true
			if oldIndex > aligned {
				skew--
			} else {
				skew++
			}
		}
	}

	// Unmatched old siblings are detached before child diffs. The cursor must
	// therefore start at the first surviving node, rather than a removed anchor.
	dom := list.New()
	attached := make(map[*element]*list.Element, len(current))
	for _, e := range previous {
		if remaining[e] {
			attached[e] = dom.PushBack(e)
		}
	}
	cursor := dom.Front()
	var moved []*element
	for i, e := range current {
		item := attached[e]
		if insert[i] && item != cursor {
			if item != nil {
				moved = append(moved, e)
				dom.Remove(item)
			}
			if cursor == nil {
				item = dom.PushBack(e)
			} else {
				item = dom.InsertBefore(e, cursor)
			}
			attached[e] = item
		} else if item == nil {
			// Both are nil when a newly mounted last child is inserted into an
			// empty tail. It cannot blur an existing focused subtree.
			item = dom.PushBack(e)
			attached[e] = item
		}
		cursor = item.Next()
	}
	return moved
}

// movedSiblingGroups keeps direct-child arrays separate, just as Preact's
// Fragment diffs do. Group source sites must stay in the same source order;
// conditional or moving Fragment groups require a virtual parent model.
func movedSiblingGroups(previous, current []*element, previousGroups map[*element]string) []*element {
	old := make(map[string][]*element)
	for _, e := range previous {
		group := previousGroups[e]
		old[group] = append(old[group], e)
	}
	next := make(map[string][]*element)
	order := make([]string, 0)
	for _, e := range current {
		group := e.node.ListGroup
		if _, seen := next[group]; !seen {
			order = append(order, group)
		}
		next[group] = append(next[group], e)
	}
	var moved []*element
	for _, group := range order {
		moved = append(moved, movedSiblings(old[group], next[group])...)
	}
	return moved
}

func (v *View) clearMovedFocus(previousRoots []*element, previousChildren map[*element][]*element, previousGroups map[*element]string) {
	var clearSubtree func(*element)
	clearSubtree = func(e *element) {
		v.clearDetachedFocus(e)
		for _, child := range e.children {
			clearSubtree(child)
		}
	}
	var visit func([]*element, []*element)
	visit = func(previous, current []*element) {
		for _, moved := range movedSiblingGroups(previous, current, previousGroups) {
			clearSubtree(moved)
		}
		for _, e := range current {
			visit(previousChildren[e], e.children)
		}
	}
	visit(previousRoots, v.roots)
}
