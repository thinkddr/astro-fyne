// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

package javascript

import (
	"errors"
	"fmt"
	"reflect"

	"github.com/dop251/goja"
	webui "github.com/thinkddr/astro-fyne/native"
)

// FontResourceFactoryHeader opts a compiled factory into the resource adapter ABI.
const FontResourceFactoryHeader = "/* astro-fyne font resources:1 */\n"

type fontResourceRequest struct {
	marked       bool
	initializing bool
	attempted    bool
	backend      webui.Backend
	err          error
}

func nilFontBinding(value any) bool {
	if value == nil {
		return true
	}
	v := reflect.ValueOf(value)
	switch v.Kind() {
	case reflect.Chan, reflect.Func, reflect.Interface, reflect.Map, reflect.Pointer, reflect.Slice:
		return v.IsNil()
	}
	return false
}

func (request *fontResourceRequest) bind(call goja.FunctionCall, explicit webui.FontResourceBinder, backends []webui.Backend) error {
	if !request.marked {
		return errors.New("javascript: font resources require FontResourceFactoryHeader")
	}
	if !request.initializing {
		return errors.New("javascript: font resources require synchronous factory initialization")
	}
	if request.attempted {
		return errors.New("javascript: font resources may be requested only once")
	}
	request.attempted = true
	if len(call.Arguments) != 3 || !goja.IsString(call.Argument(0)) || !goja.IsString(call.Argument(1)) || !goja.IsString(call.Argument(2)) || call.Argument(1).(goja.String).Length() != 1 || call.Argument(1).String() != "1" {
		return errors.New("javascript: font resources require host(\"font-resources\",\"1\",JSON-string)")
	}
	if call.Argument(2).(goja.String).Length() > 16*1024 {
		return errors.New("javascript: font resource request exceeds 16 KiB")
	}
	requirements, err := webui.ParseFontResourceRequirements([]byte(call.Argument(2).String()))
	if err != nil {
		return fmt.Errorf("javascript: %w", err)
	}
	backend, err := checkedFontBackend(explicit, backends, requirements)
	if err != nil {
		return err
	}
	request.backend = backend
	return nil
}

func checkedFontBackend(explicit webui.FontResourceBinder, backends []webui.Backend, requirements []webui.FontResourceRequirement) (backend webui.Backend, err error) {
	defer func() {
		if value := recover(); value != nil {
			backend = nil
			err = fmt.Errorf("javascript: font resource binder panicked: %v", value)
		}
	}()
	binder := explicit
	if binder == nil {
		var selected webui.Backend = webui.FyneBackend{}
		if len(backends) > 0 && backends[0] != nil {
			selected = backends[0]
		}
		switch value := selected.(type) {
		case webui.FyneBackend:
			binder = value
		case *webui.FyneBackend:
			if value != nil {
				binder = value
			}
		default:
			return nil, errors.New("javascript: custom backends require an explicit Options.FontResources binder")
		}
	}
	if nilFontBinding(binder) {
		return nil, errors.New("javascript: font resources require a nonnil binder")
	}
	backend, err = binder.BindFontResources(requirements)
	if err != nil {
		return nil, fmt.Errorf("javascript: font resource binding failed: %w", err)
	}
	if nilFontBinding(backend) {
		return nil, errors.New("javascript: font resource binder returned a nil backend")
	}
	return backend, nil
}
