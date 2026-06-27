// tableui.js — プレビュー内テーブルの列表示切替 / 列別検索 (ADR-0007)
// 状態はセッション内で保持する: プレビュー⇄編集のビュー再構築をまたいでも、
// 同一文書なら絞り込み・列表示・列幅を復元する（文書切替/再読込/リロードでリセット）。
(function (Bricola) {
  'use strict';

  // テーブルの「文書内での出現順(ordinal)」をキーに状態を退避するセッションストア。
  // 同一 md ならビューを作り直しても ordinal が一致するため復元できる。
  // { filters: string[], hidden: boolean[], widths: (string|null)[] }
  const store = new Map();

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
  // auto レイアウトのまま th の width/min-width を更新する。確定時に状態を退避する。
  function addColumnResizer(th, persist) {
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
      if (persist) persist();
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

  function enhanceTable(table, ord) {
    if (table.dataset.mdvEnhanced) return;
    const headRow = table.querySelector('thead tr');
    if (!headRow) return; // ヘッダのない表は対象外

    const headers = Array.prototype.slice.call(headRow.children);
    const names = headers.map(function (h, i) { return h.textContent.trim() || ('列' + (i + 1)); });

    // 現在の状態を ordinal キーでストアへ退避する。
    function persist() {
      const filters = [];
      table.querySelectorAll('.mdv-filter-row .mdv-col-filter').forEach(function (inp, i) { filters[i] = inp.value; });
      const hidden = chips.map(function (c) { return !chipOn(c); });
      const widths = headers.map(function (h) { return h.style.width || null; });
      store.set(ord, { filters: filters, hidden: hidden, widths: widths });
    }
    function chipOn(chip) { return chip.classList.contains('on'); }
    function setChip(chip, on) {
      chip.classList.toggle('on', on);
      chip.setAttribute('aria-pressed', on ? 'true' : 'false');
    }

    // --- 列表示トグル（チップボタン） ---
    const tools = document.createElement('div');
    tools.className = 'mdv-table-tools';
    tools.contentEditable = 'false'; // WYSIWYG 編集中も誤編集させない

    const chips = [];

    // 「全て」は独立した行に置く。クリックで全 ON/OFF を切り替える。
    const allRow = document.createElement('div');
    allRow.className = 'mdv-tools-row mdv-tools-all-row';
    const label = document.createElement('span');
    label.className = 'mdv-tools-label';
    label.textContent = '列:';
    allRow.appendChild(label);
    const allChip = document.createElement('button');
    allChip.type = 'button';
    allChip.className = 'mdv-col-chip mdv-col-chip-all on';
    allChip.textContent = '全て';
    allChip.setAttribute('aria-pressed', 'true');
    allRow.appendChild(allChip);
    tools.appendChild(allRow);

    // カラムごとのチップを並べる行。
    const chipRow = document.createElement('div');
    chipRow.className = 'mdv-tools-row mdv-tools-chip-row';
    tools.appendChild(chipRow);

    // 全チップの ON 数から「全て」チップの見た目（全 ON / 一部 ON）を更新する。
    function updateAll() {
      const on = chips.filter(chipOn).length;
      setChip(allChip, on === chips.length);
      allChip.classList.toggle('partial', on > 0 && on < chips.length);
    }
    allChip.addEventListener('click', function () {
      const turnOn = chips.some(function (c) { return !chipOn(c); }); // 1つでも OFF なら全 ON、でなければ全 OFF
      chips.forEach(function (chip, idx) { setChip(chip, turnOn); setColumnVisible(table, idx, turnOn); });
      updateAll();
      persist();
    });

    names.forEach(function (name, idx) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'mdv-col-chip on';
      chip.textContent = name;
      chip.setAttribute('aria-pressed', 'true');
      chip.addEventListener('click', function () {
        const on = !chipOn(chip);
        setChip(chip, on);
        setColumnVisible(table, idx, on);
        updateAll();
        persist();
      });
      chipRow.appendChild(chip);
      chips.push(chip);
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
      inp.addEventListener('input', function () { applyFilters(table); persist(); });
      th.appendChild(inp);
      filterRow.appendChild(th);
    });
    table.querySelector('thead').appendChild(filterRow);

    // --- 列幅調整ハンドル（名前ヘッダの各 th 右端） ---
    headers.forEach(function (th) { addColumnResizer(th, persist); });

    // --- セッションに退避した状態を復元（プレビュー⇄編集の再構築をまたぐ / ADR-0007）---
    const saved = store.get(ord);
    if (saved) {
      const filterInputs = table.querySelectorAll('.mdv-filter-row .mdv-col-filter');
      (saved.filters || []).forEach(function (v, i) { if (filterInputs[i]) filterInputs[i].value = v; });
      (saved.hidden || []).forEach(function (h, i) {
        if (h && chips[i]) { setChip(chips[i], false); setColumnVisible(table, i, false); }
      });
      (saved.widths || []).forEach(function (w, i) {
        if (w && headers[i]) { headers[i].style.width = w; headers[i].style.minWidth = w; }
      });
      updateAll();
      applyFilters(table);
    }

    table.dataset.mdvEnhanced = '1';
  }

  Bricola.tableui = {
    // 文書内の出現順を ordinal として渡す。プレビューと編集ビューで順序が一致するため、
    // 同一 md ならビュー再構築をまたいで状態が復元される。
    enhance: function (container) {
      container.querySelectorAll('table').forEach(function (t, i) { enhanceTable(t, i); });
    },
    // 文書切替・再読込時に退避状態を破棄する（別文書で ordinal が衝突しないように）。
    reset: function () { store.clear(); }
  };
})(window.Bricola = window.Bricola || {});
