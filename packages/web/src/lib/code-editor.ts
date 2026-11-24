import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { json } from "@codemirror/lang-json";
import {
  bracketMatching,
  HighlightStyle,
  indentOnInput,
  StreamLanguage,
  syntaxHighlighting,
} from "@codemirror/language";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { type Diagnostic, linter, lintGutter } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { EditorView, highlightActiveLine, keymap, lineNumbers } from "@codemirror/view";
import { tags } from "@lezer/highlight";

export type Lang = "json" | "ini";
export type Diagnose = (text: string) => { line: number; message: string } | null;

export interface EditorHandle {
  load(text: string, lang: Lang, label: string): void;
  destroy(): void;
}

const colours = HighlightStyle.define([
  { tag: tags.propertyName, color: "var(--live)" },
  { tag: tags.string, color: "var(--ok)" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--ink)", fontWeight: "700" },
  { tag: [tags.comment, tags.lineComment], color: "var(--muted)", fontStyle: "italic" },
  { tag: tags.heading, color: "var(--ink)", fontWeight: "700" },
]);

const look = EditorView.theme({
  "&": { height: "100%", background: "var(--paper)", color: "var(--ink)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { font: "500 13px/1.6 var(--mono)" },
  ".cm-content": { caretColor: "var(--ink)", padding: "var(--s3) 0" },
  ".cm-cursor": { borderLeftColor: "var(--ink)", borderLeftWidth: "2px" },
  ".cm-gutters": { background: "var(--sunk)", color: "var(--muted)", border: "0" },
  ".cm-activeLine, .cm-activeLineGutter": {
    background: "color-mix(in oklch, var(--ink) 5%, transparent)",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    background: "color-mix(in oklch, var(--accent) 30%, transparent)",
  },
  ".cm-lintRange-error": { backgroundImage: "none", textDecoration: "wavy underline var(--err)" },
  ".cm-tooltip": {
    background: "var(--paper)",
    color: "var(--ink)",
    border: "1px solid var(--line-2)",
  },
});

const language = (lang: Lang) => (lang === "json" ? json() : StreamLanguage.define(properties));

export function createEditor(
  parent: HTMLElement,
  opts: {
    text: string;
    lang: Lang;
    label: string;
    described: string;
    change(text: string): void;
    diagnose: Diagnose;
  },
): EditorHandle {
  const attrs = (label: string) =>
    EditorView.contentAttributes.compute(["doc"], (state) => ({
      tabindex: "0",
      "aria-label": label,
      "aria-describedby": opts.described,
      "aria-invalid": String(opts.diagnose(state.doc.toString()) !== null),
    }));
  const lint = linter(
    (view): Diagnostic[] => {
      const found = opts.diagnose(view.state.doc.toString());
      if (!found) return [];
      const line = view.state.doc.line(Math.min(found.line, view.state.doc.lines));
      return [{ from: line.from, to: line.to, severity: "error", message: found.message }];
    },
    { delay: 250 },
  );
  const state = (text: string, lang: Lang, label: string) =>
    EditorState.create({
      doc: text,
      extensions: [
        lineNumbers(),
        history(),
        indentOnInput(),
        bracketMatching(),
        highlightActiveLine(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        language(lang),
        attrs(label),
        syntaxHighlighting(colours),
        lint,
        lintGutter(),
        look,
        EditorView.updateListener.of((update) => {
          if (update.docChanged) opts.change(update.state.doc.toString());
        }),
      ],
    });
  const view = new EditorView({ parent, state: state(opts.text, opts.lang, opts.label) });
  return {
    load: (text, lang, label) => view.setState(state(text, lang, label)),
    destroy: () => view.destroy(),
  };
}
