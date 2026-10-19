<!-- SPDX-License-Identifier: Apache-2.0 -->
<!-- Copyright 2026 Astro Fyne contributors. -->

# Automatic CSS height animations

Supported source `@keyframes` and `animation` declarations are compiled automatically
by the JavaScript route. Fyne samples the same compiled timing code and updates
the height used by its own flow layout. Following siblings reflow. No target map,
Go callback, manual clip definition or geometry binding is required for this route.

```tsx
import "./panel.css";

export default function Panel() {
  return (
    <main>
      <section className="panel" />
      <section className="following" />
    </main>
  );
}
```

```css
.panel {
  height: 20px;
  animation: grow 1000ms linear 100ms 2 alternate both;
}
.following {
  height: 24px;
}
@keyframes grow {
  from {
    height: 20px;
  }
  to {
    height: 100px;
  }
}
```

Use the existing CLI in either direction:

```sh
astro-fyne to-fyne src/Panel.tsx
astro-fyne to-web Panel.javascript.json
astro-fyne to-fyne exported.javascript.json
```

Save the JSON returned by the native widget's `ExportJavascript()` as
`Panel.javascript.json`, or the browser handle's `exportJavascript()` as
`exported.javascript.json`. These archives retain the original CSS bytes and
compiled behavior; source generation embeds the initial archive in its Go code.
To change the source animation, edit the stylesheet and compile the source again.
The generated browser wrapper applies the sampled height itself; retained source
files are not installed as a second CSS animation. Exporting an arbitrary Fyne
object cannot reconstruct original selectors or keyframes without this archive.

## Accepted source profile

This first adapter accepts one stable, auto-width block root with empty block
panels directly inside it. Every panel has an explicit positive pixel height.
Padding, borders, margins and gap must be absent or zero. Panel and root widths
must follow their containing viewport. The root may use automatic height or an
explicit positive height. The host supplies the matching viewport and origin.

One animation per target may change only `height`. Each track needs explicit
`0%` and `100%` endpoints; `from`, `to`, percentage selector lists and duplicate
offsets are supported. Values must remain positive native pixels; individual
heights and maximum aggregate flow height are limited to 1,000,000px. This bound
prevents overflow; it does not promise exact browser subpixel geometry at that
size. CSS `!important` base heights take precedence over animation samples.

Durations, delays and logical times stay within `1e12`ms. Iterations are finite,
including zero and fractional counts, with at most `1e9` repetitions. All four
directions and fill modes are supported. Easing is `linear`, a named CSS easing,
or a `cubic-bezier` whose four control coordinates lie in `[0,1]`. Source names
use the diagnosed ASCII identifier profile. Source play state must be running;
the runtime controls below can pause an instance.

Changing target selection, timing, base heights or the flow tree requires a
remount. Text, controls, nested panels, live container or ancestor listeners,
nonzero decorations, authored widths, Flexbox/Grid, transforms, implicit
endpoints, percentage/automatic heights, infinite iteration, animation lists,
interval easing, animation events and animation timelines require further
adapters. Source layout or paint styles on the synthetic host ancestors are
diagnosed; inherited text styles and inert zero resets are retained. The adapter
does not add automatic `@font-face` support: font resources still use explicit
validated font metadata.

## Instance clocks and checkpoints

Animated archives use JavaScript archive schema 2 and a versioned `animation`
envelope containing `timeMs` and `playState`. Archives without animations keep
schema 1 and omit timeline fields. Schema 2 event records require monotonic
logical times, allowing the shared runtime to replay timed semantic events
before comparing the exact saved frame. The current source flow profile has no
interactive controls; timed event replay has separate runtime coverage.

Fyne's normal `javascript.New` constructor owns a default scheduler. Calls and
widget updates occur on Fyne's UI goroutine. `Close` releases the scheduler and
invalidates pending callbacks. For controlled tests or a host-owned clock use
`NewWithOptions(archive, actions, Options{ManualAnimations: true}, backends...)`.
The widget exposes `AnimationState`, `AdvanceAnimations`, `TickAnimations`,
`PauseAnimations` and `PlayAnimations`.
Generated animated Go widgets also provide
`NewPanelWithOptions(props, actions, javascript.Options{ManualAnimations: true}, backends...)`.
The existing `NewPanel` constructor keeps its automatic scheduler default.

Generated Preact handles expose `animationState()`, `advanceAnimations(timeMs)`,
`pauseAnimations()` and `playAnimations()`. Pass `animation={{manual: true}}` to
own logical ticks, or a stable `animation={{now: monotonicClock}}` to test its
automatic scheduler. Changing clock ownership requires remounting. Invalid
explicit backward/nonfinite seeks are rejected before changing a committed frame.
An explicit seek may advance a paused instance without resuming it; play resumes
a paused instance, and a finished animation requires remounting to restart.

Export captures one committed logical time and frame without permanently pausing
the live instance. Focus and pending editor changes remain subject to the normal
export guards. Restoration replays and verifies the saved frame before anchoring
a running instance to a fresh host clock. Time spent transporting JSON does not
advance the restored animation. Catalogue island checkpoints preserve this
schema and keep each instance's clock independent.

## Evidence and remaining precision work

`ci/css-height-roundtrip.ts prepare|verify` builds the actual generated Go package
and a retained native race-test binary, loads the original CSS in Chromium, and
compares actual root, panel and sibling bounds. Eight declared integer-height
samples require zero RGBA differences in the 320×240, DPR 1 rectangle profile.
The gate also restores a native checkpoint in the generated Astro page, exports a
paused browser checkpoint back through the CLI, and continues it in native code.
It checks object identity, independent timelines, controlled automatic clocks,
capture consistency, invalid seeks, CSS source bytes and unmount cleanup.

Separate linear and eased samples at 333ms retain native/browser geometry and
pixel differences as uncertified diagnostics. Chromium's used geometry has
subpixel quantization while Fyne stores float32 geometry. Fractional/eased samples
are not certified by the integer-frame gate, and no guessed rounding or nonzero
tolerance is substituted for an exact result. General `pixelPerfectVerified`
remains false; this adapter does not establish universal animation or CSS parity.

The same hosted gate also retains a browser-only scale oracle. Separate default
and `--force-device-scale-factor=2` browser processes each capture an unemulated
`viewport: null` baseline and contexts requesting DPR 1 and 2. The report records
the actual browser ELF hash, version, kernel/CDP arguments and supplied launch
options before and after capture. Authored static, linear and eased cases cover
half-pixel boundaries, fractional siblings and positive heights below 1/64px,
with exact CSS/HTML bytes, full bounds, animation times and PNG hashes. Requested
DPR does not establish internal layout zoom: Chromium's
[screen metrics emulator](https://github.com/chromium/chromium/blob/971a7443b0c9b0a9b2860529b33331b76077ec62/third_party/blink/renderer/core/frame/screen_metrics_emulator.cc#L132-L140)
preserves the original process scale for its compositor parameters while exposing
the requested scale separately. The oracle selects no native quantization or
paint rule. Internal layout zoom and native handling of zero used heights remain
unverified.

Timing follows [CSS Animations](https://www.w3.org/TR/css-animations-1/) and
[Web Animations](https://www.w3.org/TR/web-animations-1/).
