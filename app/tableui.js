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

  // ヘッダ右端にドラッグ用ハンドルを付け、列幅を調整できるようにする。
  // auto レイアウトのまま th の width/min-width を更新する（幅は揮発・再描画でリセット）。
  function addColumnResizer(th) {
    const grip = document.createElement('div');
    grip.className = 'mdv-col-resizer';
    grip.contentEditable = 'false';
    let startX = 0, startW = 0;
    function onMove(e) {
      const w = Math.max(40, startW + (e.clientX - startX));
      th.style.width = w + 'px';
      th.style.minWidth = w + 'px';
    }
    function onUp() {
      grip.classList.remove('dragging');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
    }
    grip.addEventListener('mousedown', function (e) {
      e.preventDefault();   // ヘッダ文字へのキャレット移動・選択を防ぐ
      e.stopPropagation();
      startX = e.clientX;
      startW = th.offsetWidth;
      grip.classList.add('dragging');
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
    th.appendChild(grip);
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

    const cbs = [];

    // 全 ON/OFF マスター。個別変更時は indeterminate を反映する。
    const masterLab = document.createElement('label');
    masterLab.className = 'mdv-col-toggle mdv-col-toggle-all';
    const master = document.createElement('input');
    master.type = 'checkbox';
    master.checked = true;
    masterLab.appendChild(master);
    masterLab.appendChild(document.createTextNode('全て'));
    tools.appendChild(masterLab);

    const sep = document.createElement('span');
    sep.className = 'mdv-tools-sep';
    tools.appendChild(sep);

    function updateMaster() {
      const on = cbs.filter(function (c) { return c.checked; }).length;
      master.checked = on === cbs.length;
      master.indeterminate = on > 0 && on < cbs.length;
    }
    master.addEventListener('change', function () {
      cbs.forEach(function (cb, idx) {
        cb.checked = master.checked;
        setColumnVisible(table, idx, master.checked);
      });
      master.indeterminate = false;
    });

    names.forEach(function (name, idx) {
      const lab = document.createElement('label');
      lab.className = 'mdv-col-toggle';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = true;
      cb.addEventListener('change', function () {
        setColumnVisible(table, idx, cb.checked);
        updateMaster();
      });
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(name));
      tools.appendChild(lab);
      cbs.push(cb);
    });
    // --- 横スクロール用ラッパで包む。横長テーブルはこのラッパ内だけがスクロールし、
    //     見出し・段落やページ全体は流れない。ツールはラッパ外に置きスクロールさせない。 ---
    const parent = table.parentNode;
    const scroller = document.createElement('div');
    scroller.className = 'md-table-scroll';
    parent.insertBefore(scroller, table); // テーブルの位置にラッパを挿入
    parent.insertBefore(tools, scroller); // ツールはラッパの前（固定表示）
    scroller.appendChild(table);          // テーブルをラッパ内へ移動

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

    // --- 列幅調整ハンドル（名前ヘッダの各 th 右端） ---
    headers.forEach(function (th) { addColumnResizer(th); });

    table.dataset.mdvEnhanced = '1';
  }

  Bricola.tableui = {
    enhance: function (container) {
      container.querySelectorAll('table').forEach(function (t) { enhanceTable(t); });
    }
  };
})(window.Bricola = window.Bricola || {});
