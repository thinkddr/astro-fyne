// SPDX-License-Identifier: Apache-2.0
package main

import (
	"encoding/json"
	"fmt"
	js "github.com/thinkddr/astro-fyne/native/javascript"
	"os"
)

func main() {
	var archive js.Archive
	decoder := json.NewDecoder(os.Stdin)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&archive); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if err := js.Validate(archive); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
