// SPDX-License-Identifier: Apache-2.0
export interface JavascriptEvent {
  node: string;
  type: "click" | "input" | "change";
  value?: string;
}
export interface JavascriptJournal {
  kind: "random" | "now" | "action";
  name: string;
  args: string;
  value?: string;
  error?: string;
}
export interface JavascriptFrame {
  uid: string;
  tag: string;
  text?: string;
  attrs?: Record<string, string>;
  style?: Record<string, string | number>;
  value?: string;
  disabled?: boolean;
  events?: string[];
  children?: JavascriptFrame[];
}
export interface JavascriptArchive {
  schema: 1;
  kind: "astro-fyne-javascript";
  code: string;
  codeHash: string;
  sources: { path: string; hash: string }[];
  props: Record<string, unknown>;
  actions: string[];
  events: JavascriptEvent[];
  journal: JavascriptJournal[];
  frame?: JavascriptFrame[];
}
export interface JavascriptAPI {
  snapshot(): JavascriptFrame[];
  dispatch(event: JavascriptEvent): void;
  replay(event: JavascriptEvent): void;
  finishReplay(): void;
  flush(): void;
  export(): JavascriptArchive;
  dispose(): void;
}
export type JavascriptActions = Record<string, (...args: any[]) => unknown>;
export type JavascriptFactory = (
  host: (kind: string, name: string, args: string) => unknown,
  archive: JavascriptArchive,
) => JavascriptAPI;
