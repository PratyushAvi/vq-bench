// The JSON config editor, dry-run against vq-bench as you type.
//
// Errors come from `validate_config`, which calls each quantizer's own `build`
// -- so the messages here are vq-bench's, not a JS approximation of its rules.

import { useEffect, useRef } from "react";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { json } from "@codemirror/lang-json";
import { linter, lintGutter, type Diagnostic } from "@codemirror/lint";

type Props = {
  value: string;
  onChange: (next: string) => void;
  /** Returns the problems with a config, or [] when it is valid. */
  validate: (config: string) => Promise<string[]>;
};

export function ConfigEditor({ value, onChange, validate }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(null);

  // Keep the newest callbacks reachable without rebuilding the editor, which
  // would drop cursor position and undo history on every keystroke.
  const latest = useRef({ onChange, validate });
  latest.current = { onChange, validate };

  useEffect(() => {
    if (!host.current) return;

    const dryRun = linter(async (view): Promise<Diagnostic[]> => {
      const text = view.state.doc.toString();
      const problems = await latest.current.validate(text);
      if (problems.length === 0) return [];
      // vq-bench reports problems against the config as a whole rather than at
      // a position, so they attach to the document, not to a span.
      return problems.map((message) => ({
        from: 0,
        to: Math.min(text.length, view.state.doc.line(1).to),
        severity: "error" as const,
        message,
      }));
    }, { delay: 400 });

    const editor = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          history(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          json(),
          dryRun,
          lintGutter(),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) latest.current.onChange(update.state.doc.toString());
          }),
          EditorView.theme({
            // Matches the app's --text-xs floor; CodeMirror sets its own size
            // and does not inherit the utility scale.
            "&": { fontSize: "13px", backgroundColor: "transparent" },
            ".cm-content": { fontFamily: "ui-monospace, SFMono-Regular, monospace" },
            "&.cm-focused": { outline: "none" },
            ".cm-gutters": { backgroundColor: "transparent", border: "none" },
          }),
        ],
      }),
    });
    view.current = editor;
    return () => editor.destroy();
    // Built once: `value` seeds the document, later changes flow through the
    // effect below so typing is never interrupted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Adopt an outside change (the picker rewriting the config), but never echo
  // back what the user just typed.
  useEffect(() => {
    const editor = view.current;
    if (!editor || editor.state.doc.toString() === value) return;
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: value },
    });
  }, [value]);

  return (
    <div
      ref={host}
      className="overflow-hidden rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 focus-within:border-slate-500 focus-within:ring-1 focus-within:ring-slate-500"
    />
  );
}
