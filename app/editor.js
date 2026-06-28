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

  // セル内専用サービス: md エスケープを抑止する。turndown 既定のエスケープは
  // 全角テキストや識別子（例 n3_cont_010）に不要な \ を入れ、桁揃えや
  // tableUnchanged の判定を崩す。太字・リンク等はエスケープではなくルールが
  // 生成するので、抑止しても影響を受けない。
  let tdInline = null;
  function inlineService() {
    if (tdInline) return tdInline;
    tdInline = new window.TurndownService({ emDelimiter: '*', bulletListMarker: '-' });
    if (window.turndownPluginGfm) tdInline.use(window.turndownPluginGfm.gfm);
    tdInline.escape = function (s) { return s; };
    return tdInline;
  }

  // --- テーブル直列化の補助 ---
  function normWs(s) { return String(s).replace(/\r?\n+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function escPipe(s) { return String(s).replace(/\|/g, '\\|'); }
  // DOM セル（th/td）→ インライン md（太字・リンク等を温存、エスケープは抑止）
  function domCell(td) { return normWs(inlineService().turndown(td.innerHTML)); }
  // raw セル文字列を DOM セルと同一経路（marked → sanitize → turndown）に通した正規形。
  // DOM 側に掛かるエスケープ/往復ロスと同じ変換を raw 側にも掛けて相殺し、
  // 往復ロスのあるセルでも両側に同じロスがかかって未編集と正しく判定できる。
  function rawCellNorm(text) {
    const html = window.DOMPurify.sanitize(window.marked.parseInline(String(text)));
    return normWs(inlineService().turndown(html));
  }
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
      lines: lines,                          // 原文行（桁揃えを温存して出力するため保持）
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
  // DOM 行と raw 行が一致するか（rawCellNorm で対称正規化して比較）。長さ違いは編集扱い。
  function rowUnchanged(domCells, rawCells) {
    if (domCells.length !== rawCells.length) return false;
    for (let i = 0; i < domCells.length; i++) {
      if (domCells[i] !== rawCellNorm(rawCells[i])) return false;
    }
    return true;
  }

  Bricola.editor = {
    // 編集後 HTML → Markdown 本文
    toMarkdown: function (html) {
      return service().turndown(html).trim() + '\n';
    },

    // ---- テーブル専用: セル値のみ差し替え、構造を壊さない（行単位の最小差分 / ADR-0010）----
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
      // 未編集行、または DOM 側で列が欠落している行（marked が描画時に詰めるケース）は
      // 原文行をそのまま使い、桁揃えの温存とデータ損失の防止を両立する。
      const keepRaw = function (domCells, rawCells) {
        return domCells.length !== rawCells.length || rowUnchanged(domCells, rawCells);
      };
      const headerLine = (parsed && keepRaw(grid.header, parsed.header)) ? parsed.lines[0] : rowOf(grid.header);
      const lines = [headerLine, delim];
      const sameShape = parsed && parsed.body.length === grid.body.length;
      grid.body.forEach(function (r, i) {
        if (sameShape && keepRaw(r, parsed.body[i])) lines.push(parsed.lines[2 + i]);
        else lines.push(rowOf(r));
      });
      return lines.join('\n') + '\n';
    },

    // DOM のセル値が元 md と一致するか（未編集判定）。比較は rawCellNorm で対称化し、
    // 往復ロスのあるセルも「変更」と誤判定しない。
    tableUnchanged: function (table, raw) {
      const parsed = parseTableRaw(raw);
      if (!parsed) return false;
      const grid = domGrid(table);
      if (!rowUnchanged(grid.header, parsed.header)) return false;
      if (grid.body.length !== parsed.body.length) return false;
      for (let i = 0; i < grid.body.length; i++) {
        if (!rowUnchanged(grid.body[i], parsed.body[i])) return false;
      }
      return true;
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
