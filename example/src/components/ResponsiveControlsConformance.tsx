// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.
import { useState } from "preact/hooks";

// Definite bases and cross sizes exercise the source layout independently of
// glyph measurement. Text remains visible in every captured PNG.
export function ResponsiveControlsConformance() {
  const [value, setValue] = useState("A");
  const [inputs, setInputs] = useState(0);
  const [commits, setCommits] = useState(0);
  const [clicks, setClicks] = useState(0);
  const [events, setEvents] = useState("");
  const [disabled, setDisabled] = useState(false);
  return (
    <main
      id="responsive-controls"
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: 320,
        boxSizing: "border-box",
        paddingTop: 16,
        paddingRight: 16,
        paddingBottom: 16,
        paddingLeft: 16,
        gap: 8,
        alignItems: "stretch",
        backgroundColor: "#ffffff",
      }}
    >
      <p
        id="controls-title"
        style={{
          boxSizing: "border-box",
          minWidth: 0,
          minHeight: 0,
          flexGrow: 0,
          flexShrink: 0,
          flexBasis: 24,
          height: 24,
          margin: 0,
          fontFamily: "AstroNoto",
          fontSize: 14,
          lineHeight: "20px",
          fontWeight: 400,
          fontStyle: "normal",
          whiteSpace: "nowrap",
          textAlign: "left",
          color: "#11232b",
        }}
      >
        Responsive controls
      </p>
      <div
        id="controls-editor-row"
        style={{
          boxSizing: "border-box",
          minWidth: 0,
          minHeight: 0,
          flexGrow: 0,
          flexShrink: 0,
          flexBasis: 40,
          height: 40,
          display: "flex",
          flexDirection: "row",
          gap: 12,
          alignItems: "center",
        }}
      >
        <input
          id="controls-input"
          type="text"
          value={value}
          disabled={disabled}
          onInput={(event) => {
            setValue(event.currentTarget.value);
            setInputs((previous) => previous + 1);
            setEvents((previous) => previous + "I");
          }}
          onChange={() => {
            setCommits((previous) => previous + 1);
            setEvents((previous) => previous + "C");
          }}
          style={{
            boxSizing: "border-box",
            minWidth: 0,
            minHeight: 0,
            flexBasis: 96,
            flexGrow: 1,
            flexShrink: 1,
            height: 32,
            margin: 0,
            appearance: "none",
            paddingTop: 0,
            paddingBottom: 0,
            paddingLeft: 8,
            paddingRight: 8,
            borderWidth: 1,
            borderStyle: "solid",
            borderColor: "#456174",
            borderRadius: 0,
            backgroundColor: "#ffffff",
            color: "#11232b",
            fontFamily: "AstroNoto",
            fontSize: 14,
            lineHeight: "20px",
            fontWeight: 400,
            fontStyle: "normal",
            whiteSpace: "nowrap",
            textAlign: "left",
          }}
        />
        <button
          id="controls-commit"
          type="button"
          disabled={disabled}
          onClick={() => {
            setClicks((previous) => previous + 1);
            setEvents((previous) => previous + "B");
          }}
          style={{
            boxSizing: "border-box",
            minWidth: 0,
            minHeight: 0,
            flexGrow: 0,
            flexShrink: 0,
            flexBasis: 80,
            height: 32,
            margin: 0,
            appearance: "none",
            paddingTop: 0,
            paddingRight: 0,
            paddingBottom: 0,
            paddingLeft: 0,
            borderWidth: 0,
            borderStyle: "solid",
            borderColor: "#1769aa",
            borderRadius: 0,
            backgroundColor: "#1769aa",
            color: "#ffffff",
            fontFamily: "AstroNoto",
            fontSize: 14,
            lineHeight: "20px",
            fontWeight: 400,
            fontStyle: "normal",
            whiteSpace: "nowrap",
            textAlign: "center",
          }}
        >
          Commit
        </button>
      </div>
      <div
        id="controls-toggle-row"
        style={{
          boxSizing: "border-box",
          minWidth: 0,
          minHeight: 0,
          flexGrow: 0,
          flexShrink: 0,
          flexBasis: 32,
          height: 32,
          display: "flex",
          flexDirection: "row",
          alignItems: "stretch",
        }}
      >
        <button
          id="controls-toggle-disabled"
          type="button"
          onClick={() => {
            setDisabled((previous) => !previous);
            setEvents((previous) => previous + "D");
          }}
          style={{
            boxSizing: "border-box",
            minWidth: 0,
            minHeight: 0,
            flexGrow: 0,
            flexShrink: 0,
            flexBasis: 96,
            height: 32,
            margin: 0,
            appearance: "none",
            paddingTop: 0,
            paddingRight: 0,
            paddingBottom: 0,
            paddingLeft: 0,
            borderWidth: 0,
            borderStyle: "solid",
            borderColor: "#263c46",
            borderRadius: 0,
            backgroundColor: "#263c46",
            color: "#ffffff",
            fontFamily: "AstroNoto",
            fontSize: 14,
            lineHeight: "20px",
            fontWeight: 400,
            fontStyle: "normal",
            whiteSpace: "nowrap",
            textAlign: "center",
          }}
        >
          Toggle
        </button>
      </div>
      <p
        id="status-value"
        style={{
          boxSizing: "border-box",
          minWidth: 0,
          minHeight: 0,
          flexGrow: 0,
          flexShrink: 0,
          flexBasis: 20,
          height: 20,
          margin: 0,
          fontFamily: "AstroNoto",
          fontSize: 14,
          lineHeight: "20px",
          fontWeight: 400,
          fontStyle: "normal",
          whiteSpace: "nowrap",
          textAlign: "left",
          color: "#11232b",
        }}
      >
        value={value}
      </p>
      <p
        id="status-inputs"
        style={{
          boxSizing: "border-box",
          minWidth: 0,
          minHeight: 0,
          flexGrow: 0,
          flexShrink: 0,
          flexBasis: 20,
          height: 20,
          margin: 0,
          fontFamily: "AstroNoto",
          fontSize: 14,
          lineHeight: "20px",
          fontWeight: 400,
          fontStyle: "normal",
          whiteSpace: "nowrap",
          textAlign: "left",
          color: "#11232b",
        }}
      >
        inputs={inputs}
      </p>
      <p
        id="status-commits"
        style={{
          boxSizing: "border-box",
          minWidth: 0,
          minHeight: 0,
          flexGrow: 0,
          flexShrink: 0,
          flexBasis: 20,
          height: 20,
          margin: 0,
          fontFamily: "AstroNoto",
          fontSize: 14,
          lineHeight: "20px",
          fontWeight: 400,
          fontStyle: "normal",
          whiteSpace: "nowrap",
          textAlign: "left",
          color: "#11232b",
        }}
      >
        commits={commits}
      </p>
      <p
        id="status-clicks"
        style={{
          boxSizing: "border-box",
          minWidth: 0,
          minHeight: 0,
          flexGrow: 0,
          flexShrink: 0,
          flexBasis: 20,
          height: 20,
          margin: 0,
          fontFamily: "AstroNoto",
          fontSize: 14,
          lineHeight: "20px",
          fontWeight: 400,
          fontStyle: "normal",
          whiteSpace: "nowrap",
          textAlign: "left",
          color: "#11232b",
        }}
      >
        clicks={clicks}
      </p>
      <p
        id="status-events"
        style={{
          boxSizing: "border-box",
          minWidth: 0,
          minHeight: 0,
          flexGrow: 0,
          flexShrink: 0,
          flexBasis: 20,
          height: 20,
          margin: 0,
          fontFamily: "AstroNoto",
          fontSize: 14,
          lineHeight: "20px",
          fontWeight: 400,
          fontStyle: "normal",
          whiteSpace: "nowrap",
          textAlign: "left",
          color: "#11232b",
        }}
      >
        events={events}
      </p>
      <p
        id="status-disabled"
        style={{
          boxSizing: "border-box",
          minWidth: 0,
          minHeight: 0,
          flexGrow: 0,
          flexShrink: 0,
          flexBasis: 20,
          height: 20,
          margin: 0,
          fontFamily: "AstroNoto",
          fontSize: 14,
          lineHeight: "20px",
          fontWeight: 400,
          fontStyle: "normal",
          whiteSpace: "nowrap",
          textAlign: "left",
          color: "#11232b",
        }}
      >
        disabled={String(disabled)}
      </p>
    </main>
  );
}
