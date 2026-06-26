// tableui.js — プレビュー内テーブルの列表示切替 / 列別検索 (ADR-0007)
// 状態は揮発（再描画のたびに作り直され、リセットされる）。
(function (Bricola) {
  'use strict';

  function cellText(el) { return (el.textContent || '').toLowerCase(); }

  // テーブルの idx 列に属する全セル（ヘッダ・フィルタ行・本文）を集める。
  function columnCells(table, idx) {
    const cells = [];
    table.querySelectorAll('tr').forEach(function (tr) {
      const c = tr.children[idx];
      if (c) cells.push(c);
    });
    return cells;
  }

  function setColumnVisible(table, idx, visible) {
    columnCells(table, idx).forEach(function (c) { c.style.display = visible ? '' : 'none'; });
  }

  // 列別の絞り込み（全列 AND・部分一致・大文字小文字無視）。
  function applyFilters(table) {
    const inputs = table.querySelectorAll('.mdv-filter-row .mdv-col-filter');
    const queries = [];
    inputs.forEach(function (inp, i) { queries[i] = inp.value.trim().toLowerCase(); });

    table.querySelectorAll('tbody tr').forEach(function (tr) {
      let show = true;
      for (let i = 0; i < queries.length; i++) {
        if (!queries[i]) continue;
        const cell = tr.children[i];
        if (!cell || cellText(cell).indexOf(queries[i]) === -1) { show = false; break; }
      }
      tr.style.display = show ? '' : 'none';
    });
  }

  function enhanceTable(table) {
    if (table.dataset.mdvEnhanced) return;
    const headRow = table.querySelector('thead tr');
    if (!headRow) return; // ヘッダのない表は対象外

    const headers = Array.prototype.slice.call(headRow.children);
    const names = headers.map(function (h, i) { return h.textContent.trim() || ('列' + (i + 1)); });

    // --- 列表示トグル ---
    const tools = document.createElement('div');
    tools.className = 'mdv-table-tools';
    tools.contentEditable = 'false'; // WYSIWYG 編集中も誤編集させない
    const label = document.createElement('span');
    label.className = 'mdv-tools-label';
    label.textContent = '列:';
    tools.appendChild(label);
    names.forEach(function (name, idx) {
      const lab = document.createElement('label');
      lab.className = 'mdv-col-toggle';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = true;
      cb.addEventListener('change', function () { setColumnVisible(table, idx, cb.checked); });
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(name));
      tools.appendChild(lab);
    });
    table.parentNode.insertBefore(tools, table);

    // --- 列別検索行 ---
    const filterRow = document.createElement('tr');
    filterRow.className = 'mdv-filter-row';
    filterRow.contentEditable = 'false';
    names.forEach(function () {
      const th = document.createElement('th');
      const inp = document.createElement('input');
      inp.type = 'search';
      inp.className = 'mdv-col-filter';
      inp.placeholder = '絞り込み';
      inp.addEventListener('input', function () { applyFilters(table); });
      th.appendChild(inp);
      filterRow.appendChild(th);
    });
    table.querySelector('thead').appendChild(filterRow);

    table.dataset.mdvEnhanced = '1';
  }

  Bricola.tableui = {
    enhance: function (container) {
      container.querySelectorAll('table').forEach(function (t) { enhanceTable(t); });
    }
  };
})(window.Bricola = window.Bricola || {});
