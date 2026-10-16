// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

export function ImageEnlargementConformance() {
  return (
    <main
      id="enlargement-root"
      style={{
        display: "flex",
        flexDirection: "row",
        width: "100%",
        height: 80,
        boxSizing: "border-box",
        paddingTop: 16,
        paddingRight: 16,
        paddingBottom: 16,
        paddingLeft: 16,
        gap: 16,
        backgroundColor: "#ffffff",
      }}
    >
      <img
        id="even-image"
        src="/images/enlargement-even.png"
        alt="even channel interpolation pattern"
        style={{
          display: "block",
          boxSizing: "border-box",
          minWidth: 0,
          minHeight: 0,
          flexBasis: 32,
          flexGrow: 0,
          flexShrink: 0,
          width: 32,
          height: 32,
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
      <img
        id="odd-image"
        src="/images/enlargement-odd.png"
        alt="odd channel interpolation pattern"
        style={{
          display: "block",
          boxSizing: "border-box",
          minWidth: 0,
          minHeight: 0,
          flexBasis: 32,
          flexGrow: 0,
          flexShrink: 0,
          width: 32,
          height: 32,
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
      <img
        id="alpha-image"
        src="/images/enlargement-alpha.png"
        alt="alpha channel interpolation pattern"
        style={{
          display: "block",
          boxSizing: "border-box",
          minWidth: 0,
          minHeight: 0,
          flexBasis: 32,
          flexGrow: 0,
          flexShrink: 0,
          width: 32,
          height: 32,
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
    </main>
  );
}
