// editor.js — WYSIWYG(プレビュー編集)→ Markdown 逆変換 (ADR-0002)
// turndown を使い、編集後の HTML を md に戻す。変換はロッシーなので明示変換の場でのみ使う。
(function (Bricola) {
  'use strict';

  let td = null;
  function service() {
    if (td) return td;
    td = new window.TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      bulletListMarker: '-',
      emDelimiter: '*'
    });
    if (window.turndownPluginGfm) td.use(window.turndownPluginGfm.gfm);
    return td;
  }

  // --- テーブル直列化の補助 ---
  function normWs(s) { return String(s).replace(/\r?\n+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function escPipe(s) { return String(s).replace(/\|/g, '\\|'); }
  // DOM セル（th/td）→ インライン md（太字・リンク等を温存）
  function domCell(td) { return normWs(service().turndown(td.innerHTML)); }
  // raw の 1 行を `|` 区切り（エスケープ考慮）でセル配列へ
  function splitRawCells(line) {
    let s = line.trim();
    if (s.charAt(0) === '|') s = s.slice(1);
    if (s.charAt(s.length - 1) === '|') s = s.slice(0, -1);
    return s.split(/(?<!\\)\|/).map(normWs);
  }
  function parseTableRaw(raw) {
    const lines = raw.replace(/\n+$/, '').split('\n').filter(function (l) { return l.trim() !== ''; });
    if (lines.length < 2) return null;
    return {
      header: splitRawCells(lines[0]),
      delim: lines[1],
      body: lines.slice(2).map(splitRawCells)
    };
  }
  function domGrid(table) {
    const hr = table.querySelector('thead tr'); // 先頭 tr = 見出し（フィルタ行は後続）
    const header = hr ? Array.prototype.map.call(hr.children, domCell) : [];
    const body = Array.prototype.map.call(table.querySelectorAll('tbody tr'), function (tr) {
      return Array.prototype.map.call(tr.children, domCell);
    });
    return { header: header, body: body };
  }

  Bricola.editor = {
    // 編集後 HTML → Markdown 本文
    toMarkdown: function (html) {
      return service().turndown(html).trim() + '\n';
    },

    // ---- テーブル専用: セル値のみ差し替え、構造を壊さない (ADR-0003 隣接の課題) ----
    serializeTable: function (table, raw) {
      const parsed = parseTableRaw(raw);
      const grid = domGrid(table);
      const n = grid.header.length;
      let delim = null;
      if (parsed) {
        const dc = splitRawCells(parsed.delim);
        if (dc.length === n) delim = parsed.delim.trim(); // 元の桁揃え/区切りを温存
      }
      if (!delim) delim = '| ' + new Array(n).fill('---').join(' | ') + ' |';
      const rowOf = function (cells) { return '| ' + cells.map(escPipe).join(' | ') + ' |'; };
      const lines = [rowOf(grid.header), delim];
      grid.body.forEach(function (r) { lines.push(rowOf(r)); });
      return lines.join('\n') + '\n';
    },

    // DOM のセル値が元 md と一致するか（未編集判定）。
    tableUnchanged: function (table, raw) {
      const parsed = parseTableRaw(raw);
      if (!parsed) return false;
      const grid = domGrid(table);
      const norm = function (header, body) { return JSON.stringify([header].concat(body)); };
      return norm(parsed.header, parsed.body) === norm(grid.header, grid.body);
    },

    // 元 md に対し、turndown 往復で失われやすい記法を警告として列挙する。
    detectLossRisks: function (md) {
      const risks = [];
      if (/<!--[\s\S]*?-->/.test(md)) {
        risks.push('HTML コメント（<!-- -->）は失われます。');
      }
      if (/\[\^[^\]]+\]/.test(md)) {
        risks.push('脚注（[^...]）は変換で崩れる可能性があります。');
      }
      if (/^[ \t]{0,3}<([a-zA-Z][\w-]*)(\s|>|\/)/m.test(md)) {
        risks.push('直書き HTML は正規化・除去される可能性があります。');
      }
      return risks;
    }
  };
})(window.Bricola = window.Bricola || {});
