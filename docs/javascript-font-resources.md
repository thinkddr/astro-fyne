<!-- SPDX-License-Identifier: Apache-2.0 -->

# JavaScript font resource requests

A native JavaScript factory can opt into an explicit resource adapter ABI before
its first native view is built. Its compiled `archive.Code` must begin with the
exact exported `javascript.FontResourceFactoryHeader` string:

```js
/* astro-fyne font resources:1 */
function (host, archive) {
  host("font-resources", "1", JSON.stringify([
    { family: "Host", weight: 400, style: "normal", hash: "<lowercase SHA-256>" }
  ]));
  // Initialize the component and return the normal runtime operations.
}
```

The call returns `null`. All three arguments must be primitive strings, with no
extra arguments. Version `"1"` accepts the closed JSON array documented by
`native.ParseFontResourceRequirements`: 1–16 exact static faces within 16 KiB,
explicit family/weight/style/hash fields, and no repeated or unknown fields.

The marker, including its terminating newline, is covered by `codeHash`. A
marked factory must make one successful request during its synchronous call,
before using other host boundaries.
Unmarked factories cannot use this boundary. The adapter uses a `try/finally`
trampoline to close the request window before Promise microtasks run. This new
ABI adds a caller frame and does not promise caller-introspection parity.
The marked ABI also requires `JSON.stringify` to return a primitive string when
runtime operations are decoded. Serialization hooks cannot hide a failed request.
Requests in microtasks, `flush`, events, replay, snapshots, export or cleanup
fail. The runtime parses and binds
the request on every construction, including restoration of a warm checkpoint.
The operation never enters the deterministic journal, and restored history does
not substitute for checking the current host resources.

The focused hand-written fixture tests preserve both empty history and a seeded
valid nonempty journal exactly across construction and export. That fixture copies
history; it does not demonstrate consumption of recorded host calls during replay.
The existing source-fonts conformance gate separately exercises legacy replay.

Without an explicit binder, the runtime accepts only an exact `webui.FyneBackend`
value or a nonnil `*webui.FyneBackend`. It uses the same selection as the view:
the first backend when nonnil, otherwise the default Fyne backend. Later
variadic backends are ignored. The returned checked backend paints the view.
The Fyne binder freezes resource bytes and validates their exact descriptors and
SHA-256 identities.

Custom backends must supply a trusted binder explicitly:

```go
options := javascript.Options{FontResources: trustedBinder}
view, err := javascript.NewWithOptions(archive, actions, options, customBackend)
```

The runtime uses the binder's returned backend directly. The binder must preserve
any custom text, box, editor and optional admission behavior that its host needs.
An explicitly supplied binder is trusted to validate and freeze the required
resource bytes; the runtime validates the request and the nonnil result, rather
than attesting an arbitrary custom backend's implementation.
A promoted `FyneBackend.BindFontResources` method is deliberately not selected
implicitly on an outer custom backend: doing so could silently drop its
overrides. An existing checked private binder or the optional nominal backend
can be passed explicitly. Binder errors, panics, nil and typed-nil results all
produce diagnostics.

Request failures are persistent even if JavaScript catches the exception. Later
host calls, runtime operations and export remain blocked. Failure before view
creation produces no native tree. A failure during an event retains the previous
native frame and stops subsequent events. This is not rollback: JavaScript state
mutations or host effects that happened before the failure are not undone.
`Close` still stops scheduling and releases the runtime; failed source work is
not retried.

Unmarked archives retain the original direct factory invocation, call stack,
backend and journal behavior. Marked archives remain valid portable data and can
generate native Go output. Browser component construction and web generation,
including catalogue conversion and `--check`, diagnose the missing browser
resource adapter before running the factory or writing output.

This bridge is an explicit native factory contract. It does not add automatic
source bundler emission, browser font admission, foreign-widget font-origin
attestation, fallback-free rendering or pixel equivalence.
