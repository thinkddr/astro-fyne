// SPDX-License-Identifier: Apache-2.0
export interface JavascriptEvent {
  node: string;
  type: "click" | "input" | "change";
  value?: string;
  timeMs?: number;
}
export interface JavascriptAnimationState {
  schema: 1;
  timeMs: number;
  playState: "running" | "paused" | "finished";
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
  checked?: boolean;
  css?: boolean;
  events?: string[];
  children?: JavascriptFrame[];
}
export interface JavascriptArchive {
  schema: 1 | 2;
  kind: "astro-fyne-javascript";
  code: string;
  codeHash: string;
  sources: { path: string; hash: string }[];
  stylesheets?: { path: string; hash: string; text: string }[];
  props: Record<string, unknown>;
  actions: string[];
  events: JavascriptEvent[];
  journal: JavascriptJournal[];
  frame?: JavascriptFrame[];
  animation?: JavascriptAnimationState;
}
export interface JavascriptAPI {
  snapshot(): JavascriptFrame[];
  dispatch(event: JavascriptEvent): boolean | void;
  replay(event: JavascriptEvent): void;
  finishReplay(): void;
  flush(): void;
  export(): JavascriptArchive;
  dispose(): void;
  animationState?(): JavascriptAnimationState;
  advanceAnimations?(timeMs: number): void;
  pauseAnimations?(): void;
  playAnimations?(): void;
}
export type JavascriptActions = Record<string, (...args: any[]) => unknown>;
export type JavascriptFactory = (
  host: (kind: string, name: string, args: string) => unknown,
  archive: JavascriptArchive,
) => JavascriptAPI;
