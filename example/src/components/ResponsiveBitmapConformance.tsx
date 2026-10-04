// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

// A natural-size bitmap moves as its surrounding source flex boxes resize.
// Scale 1 is intentional: no interpolation or glyph raster parity is claimed.
export function ResponsiveBitmapConformance() {
  return (
    <main
      id="responsive-bitmap"
      style={{
        display: "flex",
        flexDirection: "row",
        width: "100%",
        height: 96,
        boxSizing: "border-box",
        paddingTop: 16,
        paddingRight: 16,
        paddingBottom: 16,
        paddingLeft: 16,
        gap: 12,
        alignItems: "center",
        backgroundColor: "#ffffff",
      }}
    >
      <div
        id="bitmap-left"
        style={{
          boxSizing: "border-box",
          minWidth: 0,
          minHeight: 0,
          flexBasis: 64,
          flexGrow: 1,
          flexShrink: 1,
          height: 32,
          backgroundColor: "#1769aa",
        }}
      />
      <img
        id="bitmap-image"
        src="/images/local-image.png"
        alt="Four solid color quadrants"
        style={{
          display: "block",
          boxSizing: "border-box",
          minWidth: 0,
          minHeight: 0,
          flexBasis: 16,
          flexGrow: 0,
          flexShrink: 0,
          width: 16,
          height: 16,
          margin: 0,
          paddingTop: 0,
          paddingRight: 0,
          paddingBottom: 0,
          paddingLeft: 0,
          borderWidth: 0,
          borderRadius: 0,
          objectFit: "fill",
          objectPosition: "50% 50%",
        }}
      />
      <div
        id="bitmap-right"
        style={{
          boxSizing: "border-box",
          minWidth: 0,
          minHeight: 0,
          flexBasis: 64,
          flexGrow: 1,
          flexShrink: 1,
          height: 32,
          backgroundColor: "#d73f40",
        }}
      />
    </main>
  );
}
