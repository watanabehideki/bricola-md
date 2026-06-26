// render.js — md → サニタイズ済み HTML (ADR-0004)
// marked でレンダリングし DOMPurify を必ず通す。相対画像解決は M2 で追加する。
(function (Bricola) {
  'use strict';

  // marked の設定は一度だけ行う。
  if (window.marked && window.marked.setOptions) {
    window.marked.setOptions({ gfm: true, breaks: false });
  }

  // 先頭の YAML frontmatter (--- ... ---) を {fm, body} に分割する。
  // fm は区切りを含む文字列（無ければ ''）。WYSIWYG 変換時の温存に使う（ADR-0010）。
  function splitFrontmatter(md) {
    if (!/^---\r?\n/.test(md)) return { fm: '', body: md };
    const m = md.match(/^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*\r?\n?/);
    if (!m) return { fm: '', body: md };
    return { fm: m[0], body: md.slice(m[0].length) };
  }

  // 表示用に frontmatter を除去する（レンダリング専用）。
  function stripFrontmatter(md) {
    return splitFrontmatter(md).body;
  }

  Bricola.render = {
    splitFrontmatter: splitFrontmatter,
    stripFrontmatter: stripFrontmatter,
    // md テキスト → サニタイズ済み HTML 文字列
    toHtml: function (md) {
      const raw = window.marked.parse(stripFrontmatter(md));
      return window.DOMPurify.sanitize(raw);
    }
  };
})(window.Bricola = window.Bricola || {});
