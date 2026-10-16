// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import { useLayoutEffect, useRef } from "preact/hooks";

export function JavascriptEvents({
  observe,
}: {
  observe: (...values: any[]) => null;
}) {
  const options = useRef<HTMLButtonElement>(null);
  const mutation = useRef<HTMLButtonElement>(null);
  const property = useRef<HTMLButtonElement>(null);
  const recursive = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const first = options.current!;
    const once = () => observe("listener-once");
    first.addEventListener("click", once, { once: true });
    first.addEventListener("click", once, { capture: false });
    const capture = (event: Event) =>
      observe("listener-capture", event.eventPhase, event.cancelable);
    first.addEventListener("click", capture, { capture: true });
    const passive = (event: Event) => {
      event.preventDefault();
      observe("listener-passive", event.defaultPrevented);
    };
    first.addEventListener("click", passive, { passive: true });
    const object = {
      handleEvent(event: Event) {
        observe(
          "listener-object",
          this === object,
          event.currentTarget === first,
        );
      },
    };
    first.addEventListener("click", object);

    const second = mutation.current!;
    const removed = () => observe("listener-removed");
    const late = () => observe("listener-late");
    const change = () => {
      observe("listener-mutate");
      second.removeEventListener("click", removed, { capture: false });
      second.addEventListener("click", late);
    };
    second.addEventListener("click", change);
    second.addEventListener("click", removed);

    const third = property.current!;
    const handler = () => observe("listener-property");
    const regular = () => observe("listener-regular");
    third.onclick = handler;
    third.addEventListener("click", regular);
    third.onclick = null;
    third.onclick = handler;

    const fourth = recursive.current!;
    const nested = () => {
      observe("listener-recursive-once");
      fourth.click();
    };
    const tail = () => observe("listener-recursive-tail");
    fourth.addEventListener("click", nested, { once: true });
    fourth.addEventListener("click", tail);

    return () => {
      first.removeEventListener("click", once);
      first.removeEventListener("click", capture, true);
      first.removeEventListener("click", passive);
      first.removeEventListener("click", object);
      second.removeEventListener("click", change);
      second.removeEventListener("click", removed);
      second.removeEventListener("click", late);
      third.onclick = null;
      third.removeEventListener("click", regular);
      fourth.removeEventListener("click", nested);
      fourth.removeEventListener("click", tail);
    };
  }, [observe]);
  return (
    <section>
      <button id="js-events-options" ref={options}>
        Listener options
      </button>
      <button id="js-events-mutation" ref={mutation}>
        Listener mutation
      </button>
      <button id="js-events-property" ref={property}>
        Event property ordering
      </button>
      <button id="js-events-recursive-target" ref={recursive}>
        Programmatic target
      </button>
      <button
        id="js-events-recursive"
        onClick={() => recursive.current!.click()}
      >
        Programmatic reentry
      </button>
    </section>
  );
}
