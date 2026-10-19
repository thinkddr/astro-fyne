// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Astro Fyne contributors.

export function ResponsiveReverseFlexConformance({
  observe,
}: {
  observe: (id: string) => void;
}) {
  return (
    <div
      id="reverse-flex"
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: 2400,
        boxSizing: "border-box",
        paddingLeft: 12,
        paddingRight: 20,
        paddingTop: 8,
        paddingBottom: 8,
        gap: 8,
        backgroundColor: "#ffffff",
      }}
    >
      <div
        id="row-flex-start"
        style={{
          minWidth: 0,
          minHeight: 0,
          boxSizing: "border-box",
          flexGrow: 0,
          flexShrink: 0,
          display: "flex",
          flexDirection: "row-reverse",
          flexBasis: 64,
          paddingLeft: 8,
          paddingRight: 10,
          paddingTop: 3,
          paddingBottom: 7,
          borderWidth: 1,
          borderStyle: "solid",
          borderColor: "#193443",
          gap: 6,
          backgroundColor: "#eaf0f4",
          justifyContent: "flex-start",
        }}
      >
        <div
          id="row-flex-start-1"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0,
            flexShrink: 0,
            flexBasis: 30,
            backgroundColor: "#d94a37",
            alignSelf: "flex-start",
            height: 12,
          }}
        />
        <div
          id="row-flex-start-2"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0,
            flexShrink: 0,
            flexBasis: 42,
            backgroundColor: "#238655",
            alignSelf: "center",
            height: 20,
          }}
        />
        <div
          id="row-flex-start-3"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0,
            flexShrink: 0,
            flexBasis: 52,
            backgroundColor: "#2e66c5",
            alignSelf: "flex-end",
            height: 28,
          }}
        />
      </div>
      <div
        id="row-flex-end"
        style={{
          minWidth: 0,
          minHeight: 0,
          boxSizing: "border-box",
          flexGrow: 0,
          flexShrink: 0,
          display: "flex",
          flexDirection: "row-reverse",
          flexBasis: 64,
          paddingLeft: 8,
          paddingRight: 10,
          paddingTop: 3,
          paddingBottom: 7,
          borderWidth: 1,
          borderStyle: "solid",
          borderColor: "#193443",
          gap: 6,
          backgroundColor: "#eaf0f4",
          justifyContent: "flex-end",
        }}
      >
        <div
          id="row-flex-end-1"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0,
            flexShrink: 0,
            flexBasis: 30,
            backgroundColor: "#d94a37",
            alignSelf: "flex-start",
            height: 12,
          }}
        />
        <div
          id="row-flex-end-2"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            marginLeft: 3,
            marginRight: 5,
            marginTop: 2,
            flexGrow: 0,
            flexShrink: 0,
            flexBasis: 42,
            backgroundColor: "#238655",
            alignSelf: "center",
            height: 20,
          }}
        />
        <div
          id="row-flex-end-3"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0,
            flexShrink: 0,
            flexBasis: 52,
            backgroundColor: "#2e66c5",
            alignSelf: "flex-end",
            height: 28,
          }}
        />
      </div>
      <div
        id="row-center"
        style={{
          minWidth: 0,
          minHeight: 0,
          boxSizing: "border-box",
          flexGrow: 0,
          flexShrink: 0,
          display: "flex",
          flexDirection: "row-reverse",
          flexBasis: 64,
          paddingLeft: 8,
          paddingRight: 10,
          paddingTop: 3,
          paddingBottom: 7,
          borderWidth: 1,
          borderStyle: "solid",
          borderColor: "#193443",
          gap: 6,
          backgroundColor: "#eaf0f4",
          justifyContent: "center",
        }}
      >
        <div
          id="row-center-1"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            order: 2,
            flexGrow: 0,
            flexShrink: 0,
            flexBasis: 30,
            backgroundColor: "#d94a37",
            alignSelf: "flex-start",
            height: 12,
          }}
        />
        <div
          id="row-center-2"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0,
            flexShrink: 0,
            flexBasis: 42,
            backgroundColor: "#238655",
            alignSelf: "center",
            height: 20,
          }}
        />
        <div
          id="row-center-3"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0,
            flexShrink: 0,
            flexBasis: 52,
            backgroundColor: "#2e66c5",
            alignSelf: "flex-end",
            height: 28,
          }}
        />
      </div>
      <div
        id="row-space-between"
        style={{
          minWidth: 0,
          minHeight: 0,
          boxSizing: "border-box",
          flexGrow: 0,
          flexShrink: 0,
          display: "flex",
          flexDirection: "row-reverse",
          flexBasis: 64,
          paddingLeft: 8,
          paddingRight: 10,
          paddingTop: 3,
          paddingBottom: 7,
          borderWidth: 1,
          borderStyle: "solid",
          borderColor: "#193443",
          gap: 6,
          backgroundColor: "#eaf0f4",
          justifyContent: "space-between",
        }}
      >
        <div
          id="row-space-between-1"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0,
            flexShrink: 0,
            flexBasis: 30,
            backgroundColor: "#d94a37",
            alignSelf: "flex-start",
            height: 12,
          }}
        />
        <div
          id="row-space-between-2"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0,
            flexShrink: 0,
            flexBasis: 42,
            backgroundColor: "#238655",
            alignSelf: "center",
            height: 20,
          }}
        />
        <div
          id="row-space-between-3"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0,
            flexShrink: 0,
            flexBasis: 52,
            backgroundColor: "#2e66c5",
            alignSelf: "flex-end",
            height: 28,
          }}
        />
      </div>
      <div
        id="row-space-around"
        style={{
          minWidth: 0,
          minHeight: 0,
          boxSizing: "border-box",
          flexGrow: 0,
          flexShrink: 0,
          display: "flex",
          flexDirection: "row-reverse",
          flexBasis: 64,
          paddingLeft: 8,
          paddingRight: 10,
          paddingTop: 3,
          paddingBottom: 7,
          borderWidth: 1,
          borderStyle: "solid",
          borderColor: "#193443",
          gap: 6,
          backgroundColor: "#eaf0f4",
          justifyContent: "space-around",
        }}
      >
        <div
          id="row-space-around-1"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0,
            flexShrink: 0,
            flexBasis: 30,
            backgroundColor: "#d94a37",
            alignSelf: "flex-start",
            height: 12,
          }}
        />
        <div
          id="row-space-around-2"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0,
            flexShrink: 0,
            flexBasis: 42,
            backgroundColor: "#238655",
            alignSelf: "center",
            height: 20,
          }}
        />
        <div
          id="row-space-around-3"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0,
            flexShrink: 0,
            flexBasis: 52,
            backgroundColor: "#2e66c5",
            alignSelf: "flex-end",
            height: 28,
          }}
        />
      </div>
      <div
        id="row-space-evenly"
        style={{
          minWidth: 0,
          minHeight: 0,
          boxSizing: "border-box",
          flexGrow: 0,
          flexShrink: 0,
          display: "flex",
          flexDirection: "row-reverse",
          flexBasis: 64,
          paddingLeft: 8,
          paddingRight: 10,
          paddingTop: 3,
          paddingBottom: 7,
          borderWidth: 1,
          borderStyle: "solid",
          borderColor: "#193443",
          gap: 6,
          backgroundColor: "#eaf0f4",
          justifyContent: "space-evenly",
        }}
      >
        <div
          id="row-space-evenly-1"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0,
            flexShrink: 0,
            flexBasis: 30,
            backgroundColor: "#d94a37",
            alignSelf: "flex-start",
            height: 12,
          }}
        />
        <div
          id="row-space-evenly-2"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0,
            flexShrink: 0,
            flexBasis: 42,
            backgroundColor: "#238655",
            alignSelf: "center",
            height: 20,
          }}
        />
        <div
          id="row-space-evenly-3"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0,
            flexShrink: 0,
            flexBasis: 52,
            backgroundColor: "#2e66c5",
            alignSelf: "flex-end",
            height: 28,
          }}
        />
      </div>
      <div
        id="column-flex-start"
        style={{
          minWidth: 0,
          minHeight: 0,
          boxSizing: "border-box",
          flexGrow: 0,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column-reverse",
          flexBasis: 128,
          paddingLeft: 8,
          paddingRight: 10,
          paddingTop: 3,
          paddingBottom: 7,
          borderWidth: 1,
          borderStyle: "solid",
          borderColor: "#193443",
          gap: 6,
          backgroundColor: "#eaf0f4",
          justifyContent: "flex-start",
        }}
      >
        <div
          id="column-flex-start-1"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0,
            flexShrink: 0,
            flexBasis: 20,
            backgroundColor: "#d94a37",
            alignSelf: "flex-start",
            width: 40,
          }}
        />
        <div
          id="column-flex-start-2"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0,
            flexShrink: 0,
            flexBasis: 28,
            backgroundColor: "#238655",
            alignSelf: "center",
            width: 56,
          }}
        />
        <div
          id="column-flex-start-3"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0,
            flexShrink: 0,
            flexBasis: 32,
            backgroundColor: "#2e66c5",
            alignSelf: "flex-end",
            width: 72,
          }}
        />
      </div>
      <div
        id="column-flex-end"
        style={{
          minWidth: 0,
          minHeight: 0,
          boxSizing: "border-box",
          flexGrow: 0,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column-reverse",
          flexBasis: 128,
          paddingLeft: 8,
          paddingRight: 10,
          paddingTop: 3,
          paddingBottom: 7,
          borderWidth: 1,
          borderStyle: "solid",
          borderColor: "#193443",
          gap: 6,
          backgroundColor: "#eaf0f4",
          justifyContent: "flex-end",
        }}
      >
        <div
          id="column-flex-end-1"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0,
            flexShrink: 0,
            flexBasis: 20,
            backgroundColor: "#d94a37",
            alignSelf: "flex-start",
            width: 40,
          }}
        />
        <div
          id="column-flex-end-2"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0,
            flexShrink: 0,
            flexBasis: 28,
            backgroundColor: "#238655",
            alignSelf: "center",
            width: 56,
          }}
        />
        <div
          id="column-flex-end-3"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0,
            flexShrink: 0,
            flexBasis: 32,
            backgroundColor: "#2e66c5",
            alignSelf: "flex-end",
            width: 72,
          }}
        />
      </div>
      <div
        id="column-center"
        style={{
          minWidth: 0,
          minHeight: 0,
          boxSizing: "border-box",
          flexGrow: 0,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column-reverse",
          flexBasis: 128,
          paddingLeft: 8,
          paddingRight: 10,
          paddingTop: 3,
          paddingBottom: 7,
          borderWidth: 1,
          borderStyle: "solid",
          borderColor: "#193443",
          gap: 6,
          backgroundColor: "#eaf0f4",
          justifyContent: "center",
        }}
      >
        <div
          id="column-center-1"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            margin: 4,
            flexGrow: 0,
            flexShrink: 0,
            flexBasis: 20,
            backgroundColor: "#d94a37",
            alignSelf: "flex-start",
            width: 40,
          }}
        />
        <div
          id="column-center-2"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0,
            flexShrink: 0,
            flexBasis: 28,
            backgroundColor: "#238655",
            alignSelf: "center",
            width: 56,
          }}
        />
        <div
          id="column-center-3"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0,
            flexShrink: 0,
            flexBasis: 32,
            backgroundColor: "#2e66c5",
            alignSelf: "flex-end",
            width: 72,
          }}
        />
      </div>
      <div
        id="column-space-between"
        style={{
          minWidth: 0,
          minHeight: 0,
          boxSizing: "border-box",
          flexGrow: 0,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column-reverse",
          flexBasis: 128,
          paddingLeft: 8,
          paddingRight: 10,
          paddingTop: 3,
          paddingBottom: 7,
          borderWidth: 1,
          borderStyle: "solid",
          borderColor: "#193443",
          gap: 6,
          backgroundColor: "#eaf0f4",
          justifyContent: "space-between",
        }}
      >
        <div
          id="column-space-between-1"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0,
            flexShrink: 0,
            flexBasis: 20,
            backgroundColor: "#d94a37",
            alignSelf: "flex-start",
            width: 40,
          }}
        />
        <div
          id="column-space-between-2"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0,
            flexShrink: 0,
            flexBasis: 28,
            backgroundColor: "#238655",
            alignSelf: "center",
            width: 56,
          }}
        />
        <div
          id="column-space-between-3"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            order: -1,
            flexGrow: 0,
            flexShrink: 0,
            flexBasis: 32,
            backgroundColor: "#2e66c5",
            alignSelf: "flex-end",
            width: 72,
          }}
        />
      </div>
      <div
        id="column-space-around"
        style={{
          minWidth: 0,
          minHeight: 0,
          boxSizing: "border-box",
          flexGrow: 0,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column-reverse",
          flexBasis: 128,
          paddingLeft: 8,
          paddingRight: 10,
          paddingTop: 3,
          paddingBottom: 7,
          borderWidth: 1,
          borderStyle: "solid",
          borderColor: "#193443",
          gap: 6,
          backgroundColor: "#eaf0f4",
          justifyContent: "space-around",
        }}
      >
        <div
          id="column-space-around-1"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0,
            flexShrink: 0,
            flexBasis: 20,
            backgroundColor: "#d94a37",
            alignSelf: "flex-start",
            width: 40,
          }}
        />
        <div
          id="column-space-around-2"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0,
            flexShrink: 0,
            flexBasis: 28,
            backgroundColor: "#238655",
            alignSelf: "center",
            width: 56,
          }}
        />
        <div
          id="column-space-around-3"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0,
            flexShrink: 0,
            flexBasis: 32,
            backgroundColor: "#2e66c5",
            alignSelf: "flex-end",
            width: 72,
          }}
        />
      </div>
      <div
        id="column-space-evenly"
        style={{
          minWidth: 0,
          minHeight: 0,
          boxSizing: "border-box",
          flexGrow: 0,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column-reverse",
          flexBasis: 128,
          paddingLeft: 8,
          paddingRight: 10,
          paddingTop: 3,
          paddingBottom: 7,
          borderWidth: 1,
          borderStyle: "solid",
          borderColor: "#193443",
          gap: 6,
          backgroundColor: "#eaf0f4",
          justifyContent: "space-evenly",
        }}
      >
        <div
          id="column-space-evenly-1"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0,
            flexShrink: 0,
            flexBasis: 20,
            backgroundColor: "#d94a37",
            alignSelf: "flex-start",
            width: 40,
          }}
        />
        <div
          id="column-space-evenly-2"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0,
            flexShrink: 0,
            flexBasis: 28,
            backgroundColor: "#238655",
            alignSelf: "center",
            width: 56,
          }}
        />
        <div
          id="column-space-evenly-3"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0,
            flexShrink: 0,
            flexBasis: 32,
            backgroundColor: "#2e66c5",
            alignSelf: "flex-end",
            width: 72,
          }}
        />
      </div>
      <div
        id="reverse-grow"
        style={{
          minWidth: 0,
          minHeight: 0,
          boxSizing: "border-box",
          flexGrow: 0,
          flexShrink: 0,
          display: "flex",
          flexDirection: "row-reverse",
          flexBasis: 64,
          paddingLeft: 8,
          paddingRight: 10,
          paddingTop: 3,
          paddingBottom: 7,
          borderWidth: 1,
          borderStyle: "solid",
          borderColor: "#193443",
          gap: 4,
          backgroundColor: "#eaf0f4",
        }}
      >
        <div
          id="grow-a"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            order: 1,
            flexGrow: 1,
            flexShrink: 1,
            flexBasis: 96,
            backgroundColor: "#2376b7",
          }}
        />
        <div
          id="grow-b"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            marginLeft: 6,
            flexGrow: 2,
            flexShrink: 2,
            flexBasis: 96,
            backgroundColor: "#e18523",
          }}
        />
      </div>
      <div
        id="reverse-partial"
        style={{
          minWidth: 0,
          minHeight: 0,
          boxSizing: "border-box",
          flexGrow: 0,
          flexShrink: 0,
          display: "flex",
          flexDirection: "row-reverse",
          flexBasis: 64,
          paddingLeft: 8,
          paddingRight: 10,
          paddingTop: 3,
          paddingBottom: 7,
          borderWidth: 1,
          borderStyle: "solid",
          borderColor: "#193443",
          gap: 4,
          backgroundColor: "#eaf0f4",
          justifyContent: "center",
        }}
      >
        <div
          id="partial-a"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0.25,
            flexShrink: 0,
            flexBasis: 48,
            backgroundColor: "#2376b7",
          }}
        />
        <div
          id="partial-b"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0.25,
            flexShrink: 0,
            flexBasis: 48,
            backgroundColor: "#e18523",
          }}
        />
      </div>
      <div
        id="reverse-floor"
        style={{
          minWidth: 0,
          minHeight: 0,
          boxSizing: "border-box",
          flexGrow: 0,
          flexShrink: 0,
          display: "flex",
          flexDirection: "row-reverse",
          flexBasis: 64,
          paddingLeft: 8,
          paddingRight: 10,
          paddingTop: 3,
          paddingBottom: 7,
          borderWidth: 1,
          borderStyle: "solid",
          borderColor: "#193443",
          gap: 4,
          backgroundColor: "#eaf0f4",
          justifyContent: "center",
        }}
      >
        <div
          id="floor-a"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0,
            flexShrink: 10,
            flexBasis: 100,
            backgroundColor: "#b44488",
            paddingLeft: 28,
            paddingRight: 36,
          }}
        />
        <div
          id="floor-b"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0,
            flexShrink: 1,
            flexBasis: 120,
            backgroundColor: "#d38a22",
          }}
        />
      </div>
      <div
        id="reverse-nested"
        style={{
          minWidth: 0,
          minHeight: 0,
          boxSizing: "border-box",
          flexGrow: 0,
          flexShrink: 0,
          display: "flex",
          flexDirection: "column-reverse",
          flexBasis: 128,
          paddingLeft: 8,
          paddingRight: 10,
          paddingTop: 3,
          paddingBottom: 7,
          borderWidth: 1,
          borderStyle: "solid",
          borderColor: "#193443",
          gap: 6,
          backgroundColor: "#eaf0f4",
          justifyContent: "space-between",
        }}
      >
        <div
          id="nested-row-1"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0,
            flexShrink: 0,
            display: "flex",
            flexDirection: "row-reverse",
            flexBasis: 40,
            paddingLeft: 8,
            paddingRight: 10,
            paddingTop: 1,
            paddingBottom: 3,
            borderWidth: 1,
            borderStyle: "solid",
            borderColor: "#193443",
            gap: 6,
            backgroundColor: "#eaf0f4",
            justifyContent: "space-between",
          }}
        >
          <div
            id="nested-1-a"
            style={{
              minWidth: 0,
              minHeight: 0,
              boxSizing: "border-box",
              flexGrow: 0,
              flexShrink: 0,
              flexBasis: 20,
              backgroundColor: "#2376b7",
            }}
          />
          <div
            id="nested-1-b"
            style={{
              minWidth: 0,
              minHeight: 0,
              boxSizing: "border-box",
              flexGrow: 0,
              flexShrink: 0,
              flexBasis: 30,
              backgroundColor: "#d38a22",
            }}
          />
        </div>
        <div
          id="nested-row-2"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0,
            flexShrink: 0,
            display: "flex",
            flexDirection: "row-reverse",
            flexBasis: 40,
            paddingLeft: 8,
            paddingRight: 10,
            paddingTop: 1,
            paddingBottom: 3,
            borderWidth: 1,
            borderStyle: "solid",
            borderColor: "#193443",
            gap: 6,
            backgroundColor: "#eaf0f4",
            justifyContent: "space-between",
          }}
        >
          <div
            id="nested-2-a"
            style={{
              minWidth: 0,
              minHeight: 0,
              boxSizing: "border-box",
              flexGrow: 0,
              flexShrink: 0,
              flexBasis: 20,
              backgroundColor: "#2376b7",
            }}
          />
          <div
            id="nested-2-b"
            style={{
              minWidth: 0,
              minHeight: 0,
              boxSizing: "border-box",
              flexGrow: 0,
              flexShrink: 0,
              flexBasis: 30,
              backgroundColor: "#d38a22",
            }}
          />
        </div>
      </div>
      <div
        id="negative-flex-start"
        style={{
          minWidth: 0,
          minHeight: 0,
          boxSizing: "border-box",
          flexGrow: 0,
          flexShrink: 0,
          display: "flex",
          flexDirection: "row",
          flexBasis: 112,
          paddingLeft: 48,
          paddingTop: 40,
          gap: 8,
          backgroundColor: "#ffffff",
        }}
      >
        <div
          id="negative-flex-start-row-reverse"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0,
            flexShrink: 0,
            display: "flex",
            flexDirection: "row-reverse",
            flexBasis: 70,
            height: 70,
            paddingLeft: 8,
            paddingRight: 10,
            paddingTop: 3,
            paddingBottom: 7,
            borderWidth: 1,
            borderStyle: "solid",
            borderColor: "#193443",
            gap: 10,
            justifyContent: "flex-start",
            backgroundColor: "#eaf0f4",
          }}
        >
          <div
            id="negative-flex-start-row-reverse-1"
            style={{
              minWidth: 0,
              minHeight: 0,
              boxSizing: "border-box",
              flexGrow: 0,
              flexShrink: 0,
              flexBasis: 40,
              backgroundColor: "#d94a37",
              height: 20,
            }}
          />
          <div
            id="negative-flex-start-row-reverse-2"
            style={{
              minWidth: 0,
              minHeight: 0,
              boxSizing: "border-box",
              flexGrow: 0,
              flexShrink: 0,
              flexBasis: 50,
              backgroundColor: "#2e66c5",
              height: 20,
            }}
          />
        </div>
        <div
          id="negative-flex-start-column-reverse"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0,
            flexShrink: 0,
            display: "flex",
            flexDirection: "column-reverse",
            flexBasis: 70,
            height: 70,
            paddingLeft: 8,
            paddingRight: 10,
            paddingTop: 3,
            paddingBottom: 7,
            borderWidth: 1,
            borderStyle: "solid",
            borderColor: "#193443",
            gap: 10,
            justifyContent: "flex-start",
            backgroundColor: "#eaf0f4",
          }}
        >
          <div
            id="negative-flex-start-column-reverse-1"
            style={{
              minWidth: 0,
              minHeight: 0,
              boxSizing: "border-box",
              flexGrow: 0,
              flexShrink: 0,
              flexBasis: 40,
              backgroundColor: "#d94a37",
              width: 20,
            }}
          />
          <div
            id="negative-flex-start-column-reverse-2"
            style={{
              minWidth: 0,
              minHeight: 0,
              boxSizing: "border-box",
              flexGrow: 0,
              flexShrink: 0,
              flexBasis: 50,
              backgroundColor: "#2e66c5",
              width: 20,
            }}
          />
        </div>
      </div>
      <div
        id="negative-flex-end"
        style={{
          minWidth: 0,
          minHeight: 0,
          boxSizing: "border-box",
          flexGrow: 0,
          flexShrink: 0,
          display: "flex",
          flexDirection: "row",
          flexBasis: 112,
          paddingLeft: 48,
          paddingTop: 40,
          gap: 8,
          backgroundColor: "#ffffff",
        }}
      >
        <div
          id="negative-flex-end-row-reverse"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0,
            flexShrink: 0,
            display: "flex",
            flexDirection: "row-reverse",
            flexBasis: 70,
            height: 70,
            paddingLeft: 8,
            paddingRight: 10,
            paddingTop: 3,
            paddingBottom: 7,
            borderWidth: 1,
            borderStyle: "solid",
            borderColor: "#193443",
            gap: 10,
            justifyContent: "flex-end",
            backgroundColor: "#eaf0f4",
          }}
        >
          <div
            id="negative-flex-end-row-reverse-1"
            style={{
              minWidth: 0,
              minHeight: 0,
              boxSizing: "border-box",
              flexGrow: 0,
              flexShrink: 0,
              flexBasis: 40,
              backgroundColor: "#d94a37",
              height: 20,
            }}
          />
          <div
            id="negative-flex-end-row-reverse-2"
            style={{
              minWidth: 0,
              minHeight: 0,
              boxSizing: "border-box",
              flexGrow: 0,
              flexShrink: 0,
              flexBasis: 50,
              backgroundColor: "#2e66c5",
              height: 20,
            }}
          />
        </div>
        <div
          id="negative-flex-end-column-reverse"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0,
            flexShrink: 0,
            display: "flex",
            flexDirection: "column-reverse",
            flexBasis: 70,
            height: 70,
            paddingLeft: 8,
            paddingRight: 10,
            paddingTop: 3,
            paddingBottom: 7,
            borderWidth: 1,
            borderStyle: "solid",
            borderColor: "#193443",
            gap: 10,
            justifyContent: "flex-end",
            backgroundColor: "#eaf0f4",
          }}
        >
          <div
            id="negative-flex-end-column-reverse-1"
            style={{
              minWidth: 0,
              minHeight: 0,
              boxSizing: "border-box",
              flexGrow: 0,
              flexShrink: 0,
              flexBasis: 40,
              backgroundColor: "#d94a37",
              width: 20,
            }}
          />
          <div
            id="negative-flex-end-column-reverse-2"
            style={{
              minWidth: 0,
              minHeight: 0,
              boxSizing: "border-box",
              flexGrow: 0,
              flexShrink: 0,
              flexBasis: 50,
              backgroundColor: "#2e66c5",
              width: 20,
            }}
          />
        </div>
      </div>
      <div
        id="negative-center"
        style={{
          minWidth: 0,
          minHeight: 0,
          boxSizing: "border-box",
          flexGrow: 0,
          flexShrink: 0,
          display: "flex",
          flexDirection: "row",
          flexBasis: 112,
          paddingLeft: 48,
          paddingTop: 40,
          gap: 8,
          backgroundColor: "#ffffff",
        }}
      >
        <div
          id="negative-center-row-reverse"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0,
            flexShrink: 0,
            display: "flex",
            flexDirection: "row-reverse",
            flexBasis: 70,
            height: 70,
            paddingLeft: 8,
            paddingRight: 10,
            paddingTop: 3,
            paddingBottom: 7,
            borderWidth: 1,
            borderStyle: "solid",
            borderColor: "#193443",
            gap: 10,
            justifyContent: "center",
            backgroundColor: "#eaf0f4",
          }}
        >
          <div
            id="negative-center-row-reverse-1"
            style={{
              minWidth: 0,
              minHeight: 0,
              boxSizing: "border-box",
              flexGrow: 0,
              flexShrink: 0,
              flexBasis: 40,
              backgroundColor: "#d94a37",
              height: 20,
            }}
          />
          <div
            id="negative-center-row-reverse-2"
            style={{
              minWidth: 0,
              minHeight: 0,
              boxSizing: "border-box",
              order: -1,
              flexGrow: 0,
              flexShrink: 0,
              flexBasis: 50,
              backgroundColor: "#2e66c5",
              height: 20,
            }}
          />
        </div>
        <div
          id="negative-center-column-reverse"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0,
            flexShrink: 0,
            display: "flex",
            flexDirection: "column-reverse",
            flexBasis: 70,
            height: 70,
            paddingLeft: 8,
            paddingRight: 10,
            paddingTop: 3,
            paddingBottom: 7,
            borderWidth: 1,
            borderStyle: "solid",
            borderColor: "#193443",
            gap: 10,
            justifyContent: "center",
            backgroundColor: "#eaf0f4",
          }}
        >
          <div
            id="negative-center-column-reverse-1"
            style={{
              minWidth: 0,
              minHeight: 0,
              boxSizing: "border-box",
              flexGrow: 0,
              flexShrink: 0,
              flexBasis: 40,
              backgroundColor: "#d94a37",
              width: 20,
            }}
          />
          <div
            id="negative-center-column-reverse-2"
            style={{
              minWidth: 0,
              minHeight: 0,
              boxSizing: "border-box",
              flexGrow: 0,
              flexShrink: 0,
              flexBasis: 50,
              backgroundColor: "#2e66c5",
              width: 20,
            }}
          />
        </div>
      </div>
      <div
        id="negative-space-between"
        style={{
          minWidth: 0,
          minHeight: 0,
          boxSizing: "border-box",
          flexGrow: 0,
          flexShrink: 0,
          display: "flex",
          flexDirection: "row",
          flexBasis: 112,
          paddingLeft: 48,
          paddingTop: 40,
          gap: 8,
          backgroundColor: "#ffffff",
        }}
      >
        <div
          id="negative-space-between-row-reverse"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0,
            flexShrink: 0,
            display: "flex",
            flexDirection: "row-reverse",
            flexBasis: 70,
            height: 70,
            paddingLeft: 8,
            paddingRight: 10,
            paddingTop: 3,
            paddingBottom: 7,
            borderWidth: 1,
            borderStyle: "solid",
            borderColor: "#193443",
            gap: 10,
            justifyContent: "space-between",
            backgroundColor: "#eaf0f4",
          }}
        >
          <div
            id="negative-space-between-row-reverse-1"
            style={{
              minWidth: 0,
              minHeight: 0,
              boxSizing: "border-box",
              flexGrow: 0,
              flexShrink: 0,
              flexBasis: 40,
              backgroundColor: "#d94a37",
              height: 20,
            }}
          />
          <div
            id="negative-space-between-row-reverse-2"
            style={{
              minWidth: 0,
              minHeight: 0,
              boxSizing: "border-box",
              flexGrow: 0,
              flexShrink: 0,
              flexBasis: 50,
              backgroundColor: "#2e66c5",
              height: 20,
            }}
          />
        </div>
        <div
          id="negative-space-between-column-reverse"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0,
            flexShrink: 0,
            display: "flex",
            flexDirection: "column-reverse",
            flexBasis: 70,
            height: 70,
            paddingLeft: 8,
            paddingRight: 10,
            paddingTop: 3,
            paddingBottom: 7,
            borderWidth: 1,
            borderStyle: "solid",
            borderColor: "#193443",
            gap: 10,
            justifyContent: "space-between",
            backgroundColor: "#eaf0f4",
          }}
        >
          <div
            id="negative-space-between-column-reverse-1"
            style={{
              minWidth: 0,
              minHeight: 0,
              boxSizing: "border-box",
              marginBottom: 3,
              flexGrow: 0,
              flexShrink: 0,
              flexBasis: 40,
              backgroundColor: "#d94a37",
              width: 20,
            }}
          />
          <div
            id="negative-space-between-column-reverse-2"
            style={{
              minWidth: 0,
              minHeight: 0,
              boxSizing: "border-box",
              flexGrow: 0,
              flexShrink: 0,
              flexBasis: 50,
              backgroundColor: "#2e66c5",
              width: 20,
            }}
          />
        </div>
      </div>
      <div
        id="negative-space-around"
        style={{
          minWidth: 0,
          minHeight: 0,
          boxSizing: "border-box",
          flexGrow: 0,
          flexShrink: 0,
          display: "flex",
          flexDirection: "row",
          flexBasis: 112,
          paddingLeft: 48,
          paddingTop: 40,
          gap: 8,
          backgroundColor: "#ffffff",
        }}
      >
        <div
          id="negative-space-around-row-reverse"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0,
            flexShrink: 0,
            display: "flex",
            flexDirection: "row-reverse",
            flexBasis: 70,
            height: 70,
            paddingLeft: 8,
            paddingRight: 10,
            paddingTop: 3,
            paddingBottom: 7,
            borderWidth: 1,
            borderStyle: "solid",
            borderColor: "#193443",
            gap: 10,
            justifyContent: "space-around",
            backgroundColor: "#eaf0f4",
          }}
        >
          <div
            id="negative-space-around-row-reverse-1"
            style={{
              minWidth: 0,
              minHeight: 0,
              boxSizing: "border-box",
              flexGrow: 0,
              flexShrink: 0,
              flexBasis: 40,
              backgroundColor: "#d94a37",
              height: 20,
            }}
          />
          <div
            id="negative-space-around-row-reverse-2"
            style={{
              minWidth: 0,
              minHeight: 0,
              boxSizing: "border-box",
              flexGrow: 0,
              flexShrink: 0,
              flexBasis: 50,
              backgroundColor: "#2e66c5",
              height: 20,
            }}
          />
        </div>
        <div
          id="negative-space-around-column-reverse"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0,
            flexShrink: 0,
            display: "flex",
            flexDirection: "column-reverse",
            flexBasis: 70,
            height: 70,
            paddingLeft: 8,
            paddingRight: 10,
            paddingTop: 3,
            paddingBottom: 7,
            borderWidth: 1,
            borderStyle: "solid",
            borderColor: "#193443",
            gap: 10,
            justifyContent: "space-around",
            backgroundColor: "#eaf0f4",
          }}
        >
          <div
            id="negative-space-around-column-reverse-1"
            style={{
              minWidth: 0,
              minHeight: 0,
              boxSizing: "border-box",
              flexGrow: 0,
              flexShrink: 0,
              flexBasis: 40,
              backgroundColor: "#d94a37",
              width: 20,
            }}
          />
          <div
            id="negative-space-around-column-reverse-2"
            style={{
              minWidth: 0,
              minHeight: 0,
              boxSizing: "border-box",
              flexGrow: 0,
              flexShrink: 0,
              flexBasis: 50,
              backgroundColor: "#2e66c5",
              width: 20,
            }}
          />
        </div>
      </div>
      <div
        id="negative-space-evenly"
        style={{
          minWidth: 0,
          minHeight: 0,
          boxSizing: "border-box",
          flexGrow: 0,
          flexShrink: 0,
          display: "flex",
          flexDirection: "row",
          flexBasis: 112,
          paddingLeft: 48,
          paddingTop: 40,
          gap: 8,
          backgroundColor: "#ffffff",
        }}
      >
        <div
          id="negative-space-evenly-row-reverse"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0,
            flexShrink: 0,
            display: "flex",
            flexDirection: "row-reverse",
            flexBasis: 70,
            height: 70,
            paddingLeft: 8,
            paddingRight: 10,
            paddingTop: 3,
            paddingBottom: 7,
            borderWidth: 1,
            borderStyle: "solid",
            borderColor: "#193443",
            gap: 10,
            justifyContent: "space-evenly",
            backgroundColor: "#eaf0f4",
          }}
        >
          <div
            id="negative-space-evenly-row-reverse-1"
            style={{
              minWidth: 0,
              minHeight: 0,
              boxSizing: "border-box",
              flexGrow: 0,
              flexShrink: 0,
              flexBasis: 40,
              backgroundColor: "#d94a37",
              height: 20,
            }}
          />
          <div
            id="negative-space-evenly-row-reverse-2"
            style={{
              minWidth: 0,
              minHeight: 0,
              boxSizing: "border-box",
              flexGrow: 0,
              flexShrink: 0,
              flexBasis: 50,
              backgroundColor: "#2e66c5",
              height: 20,
            }}
          />
        </div>
        <div
          id="negative-space-evenly-column-reverse"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0,
            flexShrink: 0,
            display: "flex",
            flexDirection: "column-reverse",
            flexBasis: 70,
            height: 70,
            paddingLeft: 8,
            paddingRight: 10,
            paddingTop: 3,
            paddingBottom: 7,
            borderWidth: 1,
            borderStyle: "solid",
            borderColor: "#193443",
            gap: 10,
            justifyContent: "space-evenly",
            backgroundColor: "#eaf0f4",
          }}
        >
          <div
            id="negative-space-evenly-column-reverse-1"
            style={{
              minWidth: 0,
              minHeight: 0,
              boxSizing: "border-box",
              flexGrow: 0,
              flexShrink: 0,
              flexBasis: 40,
              backgroundColor: "#d94a37",
              width: 20,
            }}
          />
          <div
            id="negative-space-evenly-column-reverse-2"
            style={{
              minWidth: 0,
              minHeight: 0,
              boxSizing: "border-box",
              flexGrow: 0,
              flexShrink: 0,
              flexBasis: 50,
              backgroundColor: "#2e66c5",
              width: 20,
            }}
          />
        </div>
      </div>
      <div
        id="reverse-actions"
        style={{
          minWidth: 0,
          minHeight: 0,
          boxSizing: "border-box",
          flexGrow: 0,
          flexShrink: 0,
          display: "flex",
          flexDirection: "row-reverse",
          flexBasis: 48,
          paddingLeft: 8,
          paddingRight: 10,
          paddingTop: 0,
          paddingBottom: 0,
          borderWidth: 0,
          borderStyle: "solid",
          borderColor: "#193443",
          gap: 8,
          backgroundColor: "#eaf0f4",
          justifyContent: "flex-start",
          alignItems: "center",
        }}
      >
        <button
          id="action-a"
          type="button"
          aria-label="action-a"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0,
            flexShrink: 0,
            flexBasis: 32,
            height: 32,
            margin: 0,
            appearance: "none",
            padding: 0,
            borderWidth: 0,
            borderStyle: "solid",
            borderColor: "#000000",
            borderRadius: 0,
            backgroundColor: "#b44488",
            color: "#11232b",
            fontFamily: "AstroNoto",
            fontWeight: 400,
            fontStyle: "normal",
            fontSize: 14,
            lineHeight: "20px",
            whiteSpace: "nowrap",
            textAlign: "left",
          }}
          onClick={() => observe("action-a")}
        />
        <button
          id="action-b"
          type="button"
          aria-label="action-b"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0,
            flexShrink: 0,
            flexBasis: 32,
            height: 32,
            margin: 0,
            appearance: "none",
            padding: 0,
            borderWidth: 0,
            borderStyle: "solid",
            borderColor: "#000000",
            borderRadius: 0,
            backgroundColor: "#d38a22",
            color: "#11232b",
            fontFamily: "AstroNoto",
            fontWeight: 400,
            fontStyle: "normal",
            fontSize: 14,
            lineHeight: "20px",
            whiteSpace: "nowrap",
            textAlign: "left",
          }}
          onClick={() => observe("action-b")}
        />
        <button
          id="action-c"
          type="button"
          aria-label="action-c"
          style={{
            minWidth: 0,
            minHeight: 0,
            boxSizing: "border-box",
            flexGrow: 0,
            flexShrink: 0,
            flexBasis: 32,
            height: 32,
            margin: 0,
            appearance: "none",
            padding: 0,
            borderWidth: 0,
            borderStyle: "solid",
            borderColor: "#000000",
            borderRadius: 0,
            backgroundColor: "#2e66c5",
            color: "#11232b",
            fontFamily: "AstroNoto",
            fontWeight: 400,
            fontStyle: "normal",
            fontSize: 14,
            lineHeight: "20px",
            whiteSpace: "nowrap",
            textAlign: "left",
          }}
          onClick={() => observe("action-c")}
        />
      </div>
    </div>
  );
}

export function ResponsiveReverseFlexHost() {
  return (
    <ResponsiveReverseFlexConformance
      observe={(id) => {
        const host = window as Window & { reverseFlexEvents?: string[] };
        (host.reverseFlexEvents ??= []).push(id);
      }}
    />
  );
}
