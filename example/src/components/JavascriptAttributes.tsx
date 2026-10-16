// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import { useLayoutEffect, useRef } from "preact/hooks";

export function JavascriptAttributes() {
  const host = useRef<HTMLDivElement>(null);
  const output = useRef<HTMLParagraphElement>(null);
  const step = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const input = document.createElement("InPuT") as HTMLInputElement;
    const textarea = document.createElement("TEXTAREA") as HTMLTextAreaElement;
    const button = document.createElement("BUTTON") as HTMLButtonElement;
    const nullable = null as unknown as string;
    let phase = 0;
    let clicks = 0;
    input.setAttribute("ID", "js-attrs-input");
    input.setAttribute("TyPe", "TeXt");
    input.setAttribute("VaLuE", "A\r\nB");
    input.setAttribute("DiSaBlEd", "false");
    input.setAttribute("DATA-note", nullable);
    textarea.id = "js-attrs-textarea";
    textarea.appendChild(document.createTextNode("one\r\ntwo"));
    textarea.appendChild(document.createTextNode("\rthree"));
    button.id = "js-attrs-target";
    button.textContent = "Attribute target";
    button.value = "seed";
    button.setAttribute("DiSaBlEd", "false");
    button.onclick = () => {
      clicks++;
    };
    for (const control of [input, textarea, button])
      host.current!.appendChild(control);
    const publish = () => {
      output.current!.textContent = JSON.stringify({
        phase,
        input: {
          tag: input.localName,
          type: input.getAttribute("TYPE"),
          attr: input.getAttribute("VALUE"),
          default: input.defaultValue,
          live: input.value,
          checked: input.checked,
          defaultChecked: input.defaultChecked,
          disabled: input.disabled,
          disabledAttr: input.getAttribute("DISABLED"),
          note: input.getAttribute("DATA-note"),
        },
        textarea: {
          attr: textarea.getAttribute("VALUE"),
          default: textarea.defaultValue,
          live: textarea.value,
          text: textarea.textContent,
          disabled: textarea.disabled,
        },
        button: {
          attr: button.getAttribute("VALUE"),
          live: button.value,
          disabled: button.disabled,
          disabledAttr: button.getAttribute("DISABLED"),
          clicks,
        },
      });
    };
    step.current!.onclick = () => {
      phase++;
      switch (phase) {
        case 1:
          input.value = "dirty\r\ntext";
          input.setAttribute("VaLuE", "next\r\ndefault");
          input.disabled = false;
          (textarea.firstChild as Text).data = "changed\r";
          button.click();
          button.disabled = false;
          button.click();
          break;
        case 2:
          input.value = nullable;
          input.defaultValue = nullable;
          input.setAttribute("DiSaBlEd", "false");
          textarea.value = "edited\r\nvalue\rend";
          textarea.defaultValue = nullable;
          button.value = nullable;
          button.setAttribute("DiSaBlEd", "false");
          button.click();
          break;
        case 3:
          input.value = "checked-value";
          input.setAttribute("TyPe", "ChEcKbOx");
          input.value = nullable;
          input.setAttribute("CHECKED", "false");
          input.checked = false;
          input.disabled = false;
          textarea.defaultValue = "after\r\ndefault";
          (textarea.firstChild as Text).data = "mutated\rdefault";
          textarea.setAttribute("VaLuE", "ignored");
          button.disabled = false;
          button.click();
          break;
        case 4:
          input.value = "box\r\nvalue";
          input.removeAttribute("CHECKED");
          input.checked = true;
          textarea.removeChild(textarea.firstChild!);
          textarea.appendChild(document.createTextNode("added\rtail"));
          button.value = "button\r\nvalue";
          break;
        case 5:
          input.setAttribute("TYPE", "tExT");
          input.setAttribute("VALUE", "pristine\r\nagain");
          input.defaultChecked = true;
          textarea.value = nullable;
          textarea.disabled = true;
          button.disabled = true;
          break;
        case 6:
          input.setAttribute("type", "CHECKBOX");
          input.value = "return\r\ntext";
          input.removeAttribute("TYPE");
          input.removeAttribute("VALUE");
          input.defaultChecked = false;
          textarea.textContent = "last\r\nbase";
          textarea.disabled = false;
          button.disabled = false;
          button.click();
          break;
        case 7:
          input.defaultValue = nullable;
          textarea.defaultValue = nullable;
          button.value = nullable;
          button.click();
          break;
        case 8:
          input.value = "final\r\nedit";
          input.removeAttribute("VaLuE");
          input.setAttribute("TyPe", "TEXT");
          textarea.value = "final\r\ntextarea";
          button.setAttribute("DISABLED", "false");
          button.click();
          break;
        default:
          throw new Error("Unexpected attribute conformance phase");
      }
      publish();
    };
    publish();
    return () => {
      step.current!.onclick = null;
      button.onclick = null;
      for (const control of [input, textarea, button])
        host.current!.removeChild(control);
    };
  }, []);
  return (
    <section>
      <div ref={host} />
      <p id="js-attrs-state" ref={output} />
      <button id="js-attrs-step" ref={step}>
        Advance attribute state
      </button>
    </section>
  );
}
