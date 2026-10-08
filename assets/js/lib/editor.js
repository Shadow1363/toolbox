/**
 * Code input for Dev tools. Renders a plain <textarea> immediately (so the page works offline and
 * before anything loads), then swaps in CodeMirror 6 from the CDN with the same text, selection and API.
 *
 *   const ed = createEditor(el, { value, lang: 'json', label: 'Original', onChange: (text) => run() });
 *   ed.value;                       // current text (getter/setter; setting it does not call onChange)
 *   ed.setLang('html');             // 'json' | 'html' | 'xml' | 'css' | null (plain text)
 *   ed.setMarks([{ from, to, class: 'rx-m1' }]);   // highlight ranges (CodeMirror only; ignored on the fallback)
 *
 * Offsets are UTF-16 indexes into `ed.value` (both CodeMirror and textareas turn \r\n into \n).
 * Syntax colors come from `classHighlighter` (`.tok-*` classes) styled in styles.css §14, so they follow the theme.
 */
import { loadLib } from './cdn.js';
import { h } from './dom.js';

const LANGS = { json: ['cmJson', 'json'], html: ['cmHtml', 'html'], xml: ['cmXml', 'xml'], css: ['cmCss', 'css'] };

let corePromise = null;
function loadCore() {
  corePromise ||= Promise.all(['cmState', 'cmView', 'cmCommands', 'cmLanguage', 'cmHighlight'].map(loadLib))
    .then(([state, view, commands, language, highlight]) => ({ ...state, ...view, ...commands, ...language, ...highlight }))
    .catch((err) => { corePromise = null; throw err; });
  return corePromise;
}

async function langExtension(lang) {
  const spec = LANGS[lang];
  if (!spec) return [];
  const mod = await loadLib(spec[0]);
  return mod[spec[1]]();
}

let warned = false;

export function createEditor(parent, {
  value = '', lang = null, readOnly = false, wrap = true, lineNumbers = true, placeholder = '', label = 'Code', onChange,
} = {}) {
  const ta = h('textarea', { class: 'code-fallback', spellcheck: 'false', autocomplete: 'off', placeholder: placeholder || null, 'aria-label': label, readonly: readOnly || null });
  ta.value = value;
  ta.addEventListener('input', () => onChange?.(ta.value));
  const host = h('div', { class: 'code-editor' }, ta);
  parent.append(host);

  let view = null;
  let cm = null;
  let currentLang = lang;
  let pendingMarks = [];
  let langComp = null;
  let setMarksEffect = null;

  const ready = loadCore().then(async (core) => {
    cm = core;
    const { EditorView, EditorState, Compartment, StateField, StateEffect, Decoration, keymap, drawSelection,
      highlightActiveLine, history, historyKeymap, defaultKeymap, indentWithTab, bracketMatching, syntaxHighlighting,
      classHighlighter, Annotation } = core;
    setMarksEffect = StateEffect.define();
    const marksField = StateField.define({
      create: () => Decoration.none,
      update(set, tr) {
        set = set.map(tr.changes);
        for (const e of tr.effects) if (e.is(setMarksEffect)) set = e.value;
        return set;
      },
      provide: (f) => EditorView.decorations.from(f),
    });
    const programmatic = Annotation.define();
    langComp = new Compartment();
    const extensions = [
      lineNumbers ? core.lineNumbers() : [],
      history(), drawSelection(), bracketMatching(),
      readOnly ? [] : highlightActiveLine(),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      syntaxHighlighting(classHighlighter),
      wrap ? EditorView.lineWrapping : [],
      placeholder ? core.placeholder(placeholder) : [],
      EditorState.readOnly.of(readOnly),
      EditorView.contentAttributes.of({ 'aria-label': label, spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off' }),
      langComp.of(await langExtension(currentLang).catch(() => [])),
      marksField,
      EditorView.updateListener.of((u) => {
        if (u.docChanged && !u.transactions.some((tr) => tr.annotation(programmatic))) onChange?.(u.state.doc.toString());
      }),
    ];
    const hadFocus = document.activeElement === ta;
    const sel = [ta.selectionStart, ta.selectionEnd];
    const doc = ta.value;
    view = new EditorView({ state: EditorState.create({ doc, extensions, selection: { anchor: Math.min(sel[0], doc.length), head: Math.min(sel[1], doc.length) } }) });
    view.programmatic = programmatic;
    ta.replaceWith(view.dom);
    if (hadFocus) view.focus();
    if (pendingMarks.length) api.setMarks(pendingMarks);
    host.classList.add('is-cm');
  }).catch((err) => {
    if (!warned) console.warn('CodeMirror unavailable, using a plain text area.', err);
    warned = true;
  });

  const api = {
    el: host,
    ready,
    get view() { return view; },
    get value() { return view ? view.state.doc.toString() : ta.value; },
    set value(v) {
      v = String(v ?? '');
      if (!view) { ta.value = v; return; }
      if (v === view.state.doc.toString()) return;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v }, annotations: view.programmatic.of(true) });
    },
    async setLang(l) {
      currentLang = l;
      if (!view) return;
      const ext = await langExtension(l).catch(() => []);
      if (currentLang === l && view) view.dispatch({ effects: langComp.reconfigure(ext) });
    },
    setMarks(marks) {
      pendingMarks = marks;
      if (!view) return;
      const len = view.state.doc.length;
      const ranges = marks
        .filter((m) => m.to > m.from && m.from >= 0 && m.to <= len)
        .sort((a, b) => a.from - b.from || a.to - b.to)
        .map((m) => cm.Decoration.mark({ class: m.class }).range(m.from, m.to));
      view.dispatch({ effects: setMarksEffect.of(cm.Decoration.set(ranges, true)) });
    },
    /** Select a range and scroll it into view. */
    select(from, to = from) {
      if (view) {
        view.dispatch({ selection: { anchor: from, head: to }, scrollIntoView: true });
        view.focus();
      } else {
        ta.focus();
        ta.setSelectionRange(from, to);
      }
    },
    focus() { (view || ta).focus(); },
  };
  return api;
}
