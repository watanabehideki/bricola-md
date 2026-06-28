// main.js — 起動・DOM 配線・オーケストレーション
// M1: 閲覧コア / M2: 相対画像 / M3: コード編集・保存・競合検知
(function (Bricola) {
  'use strict';

  const el = {};
  const SESSION_KEY = 'bricola-session'; // 蓄積ノード + 最後に開いた md の永続化 (ADR-0014)
  const state = {
    nodes: [],            // 蓄積したディレクトリノード [{path, segments, mds:[{name,path,handle}], expanded}] (ADR-0014)
    selected: new Set(),  // D&D 用の複数選択パス (ADR-0003)
    text: '',             // 現在の作業テキスト（唯一の真実 / ADR-0002）
    editMode: false,      // 編集モードか
    view: 'preview',      // 'preview'(WYSIWYG) | 'code'
    previewTouched: false,// プレビュー編集の未同期フラグ（未保存表示用）
    fm: '',               // 編集中文書の frontmatter（温存用 / ADR-0010）
    blocks: { raw: [], html: [], gapAfter: [], leadingWS: '' } // ブロック単位の最小差分用スナップショット（gap=原文の空行温存 / ADR-0010）
  };

  // 別文書/リポジトリへ移る前の確認。続行可なら true。
  // 編集中は確認ダイアログを出し、了承時は編集を破棄して終了する。
  function confirmLeaveEdit() {
    if (state.editMode) {
      const msg = hasUnsaved()
        ? '編集中で未保存の変更があります。破棄して別のファイルを開きますか?'
        : '編集を終了して別のファイルを開きますか?';
      if (!window.confirm(msg)) return false;
      state.editMode = false;
      state.previewTouched = false;
      return true;
    }
    return guardDiscard();
  }

  // パス → ハンドル（蓄積ノード内の md から探す）
  function handleOf(path) {
    for (let i = 0; i < state.nodes.length; i++) {
      const mds = state.nodes[i].mds;
      for (let j = 0; j < mds.length; j++) {
        if (mds[j].path === path) return mds[j].handle;
      }
    }
    return null;
  }
  // 選択中パスを「選択した順」で返す（Set は挿入順を保持）
  function orderedSelected() {
    return Array.from(state.selected);
  }

  // 選択解除ボタンの表示と件数を更新する。
  function updateSelectionUI() {
    const n = state.selected.size;
    el.btnClearSel.hidden = n === 0;
    el.btnClearSel.textContent = '選択解除 (' + n + ')';
  }

  function clearSelection() {
    state.selected.clear();
    renderFileList();
  }

  function $(id) { return document.getElementById(id); }

  function setStatus(msg, kind) {
    el.status.textContent = msg || '';
    el.status.dataset.kind = kind || '';
  }

  function isDirty() { return Bricola.docstate.isDirty(state.text); }

  // 未同期のプレビュー編集も含めた「未保存」判定。
  function hasUnsaved() {
    return isDirty() || (state.editMode && state.view === 'preview' && state.previewTouched);
  }

  function updateDirtyUI() {
    const dirty = hasUnsaved();
    el.dirty.textContent = dirty ? '● 未保存' : '';
    el.btnSave.disabled = !Bricola.docstate.cur || !dirty;
  }

  // 未保存があれば破棄確認する。続行可なら true（ADR-0006）。
  function guardDiscard() {
    if (hasUnsaved()) {
      return window.confirm('未保存の変更があります。破棄して続行しますか?');
    }
    return true;
  }

  // ---- サイドバー（蓄積したディレクトリノード / ADR-0014） ----
  let selOrderCache = [];

  // ノードの表示ラベル（ルートは "/"）。
  function nodeLabel(node) { return node.path === '' ? '/' : node.path; }

  // 1 ファイル行（選択・D&D・順番バッジ・開く を保持）
  function renderFileItem(f) {
    const curPath = Bricola.docstate.cur ? Bricola.docstate.cur.path : null;
    const li = document.createElement('li');
    li.className = 'tree-file';
    li.title = f.path + '（Cmd/Ctrl+クリックで複数選択→ドラッグで差し込み）';
    li.draggable = true;
    if (f.path === curPath) li.classList.add('active');
    if (state.selected.has(f.path)) {
      li.classList.add('selected');
      const badge = document.createElement('span');
      badge.className = 'order-badge';
      badge.textContent = String(selOrderCache.indexOf(f.path) + 1);
      li.appendChild(badge);
    }
    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = f.name;
    li.appendChild(name);

    li.addEventListener('click', function (e) {
      if (e.metaKey || e.ctrlKey) {
        if (state.selected.has(f.path)) state.selected.delete(f.path);
        else state.selected.add(f.path);
        renderSidebar();
      } else {
        state.selected.clear();
        openDocument({ path: f.path, handle: f.handle });
      }
    });
    li.addEventListener('dragstart', function (e) {
      const paths = (state.selected.has(f.path) && state.selected.size) ? orderedSelected() : [f.path];
      e.dataTransfer.setData('application/x-bricola-paths', JSON.stringify(paths));
      e.dataTransfer.effectAllowed = 'copy';
    });
    return li;
  }

  // 1 ディレクトリノード（ヘッダ＋直下 md 一覧）を描画する。
  // q（検索語）があれば一致する md だけを残し、無一致ノードは null を返して隠す。
  function renderNode(node, q) {
    const mds = q
      ? node.mds.filter(function (m) { return m.name.toLowerCase().indexOf(q) !== -1; })
      : node.mds;
    if (q && !mds.length) return null;

    const li = document.createElement('li');
    li.className = 'tree-dir';
    const expanded = q ? true : node.expanded; // 検索中は強制展開
    if (!expanded) li.classList.add('collapsed');

    const row = document.createElement('div');
    row.className = 'tree-row dir-row';
    const chev = document.createElement('span');
    chev.className = 'chev';
    chev.textContent = '▸';
    const icon = document.createElement('span');
    icon.className = 'dir-icon';
    const label = document.createElement('span');
    label.className = 'dir-name';
    label.textContent = nodeLabel(node);
    label.title = nodeLabel(node);
    const del = document.createElement('button');
    del.className = 'node-del';
    del.textContent = '×';
    del.title = 'このディレクトリをサイドバーから外す';
    del.addEventListener('click', function (e) {
      e.stopPropagation();
      removeNode(node);
    });
    row.appendChild(chev);
    row.appendChild(icon);
    row.appendChild(label);
    row.appendChild(del);
    row.addEventListener('click', function () {
      node.expanded = !node.expanded;
      persistSession();
      renderSidebar();
    });

    const ul = document.createElement('ul');
    ul.className = 'tree';
    mds.slice().sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; })
      .forEach(function (m) { ul.appendChild(renderFileItem(m)); });

    li.appendChild(row);
    li.appendChild(ul);
    return li;
  }

  function renderSidebar() {
    el.fileList.innerHTML = '';
    selOrderCache = orderedSelected();
    const q = (el.search.value || '').trim().toLowerCase();
    const ul = document.createElement('ul');
    ul.className = 'tree tree-root';
    state.nodes.forEach(function (node) {
      const li = renderNode(node, q);
      if (li) ul.appendChild(li);
    });
    el.fileList.appendChild(ul);

    const active = el.fileList.querySelector('.tree-file.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
    updateSelectionUI();
  }

  // 既存呼び出し名の互換
  function renderFileList() { renderSidebar(); }

  // ---- ディレクトリノードの操作 / パス指定ロード (ADR-0014) ----

  function splitPath(p) {
    return String(p || '').split('/').filter(function (s) { return s.length > 0; });
  }
  function byName(a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; }
  function findNode(path) {
    for (let i = 0; i < state.nodes.length; i++) {
      if (state.nodes[i].path === path) return state.nodes[i];
    }
    return null;
  }

  // ディレクトリ直下の md だけを {name, path, handle} で返す（再帰しない・ライブ読込）。
  async function listMdOfDir(segments) {
    const entries = await Bricola.repo.listDir(segments);
    const prefix = segments.length ? segments.join('/') + '/' : '';
    return entries
      .filter(function (e) { return e.kind === 'file' && /\.md$/i.test(e.name); })
      .map(function (e) { return { name: e.name, path: prefix + e.name, handle: e.handle }; })
      .sort(byName);
  }

  // ディレクトリ指定: 直下 md を全部出すノード（kind:'dir'）。既存は再利用＝重複させない。
  // 直下 md 0 件で新規なら追加せず null を返す。成功時はノードを返す。
  async function addDirNode(segments) {
    const path = segments.join('/');
    const mds = await listMdOfDir(segments); // 毎回ライブで entries() し直す
    let node = findNode(path);
    if (node) {
      node.kind = 'dir';
      node.mds = mds;       // 内容を最新化（kind:'files' だったら昇格）
      node.expanded = true;
    } else {
      if (!mds.length) return null; // 0 件は新規追加しない
      node = { path: path, segments: segments.slice(), kind: 'dir', mds: mds, expanded: true };
      state.nodes.push(node);
    }
    return node;
  }

  // ファイル指定: その md「だけ」をノードに足す（kind:'files'）。親 dir でグルーピングするが
  // 直下全部は出さない。同じ親に既に dir ノードがあればそれを使い、files ノードなら和集合。
  // 戻り値 { node, md }。
  async function addFileNode(segments, handle) {
    const parentSegs = segments.slice(0, -1);
    const parentPath = parentSegs.join('/');
    const name = segments[segments.length - 1];
    const path = parentPath ? parentPath + '/' + name : name;
    if (!handle) handle = await Bricola.repo.getFileHandleByPath(segments);
    const md = { name: name, path: path, handle: handle };

    let node = findNode(parentPath);
    if (node) {
      node.expanded = true;
      const existing = node.mds.filter(function (m) { return m.path === path; })[0];
      if (existing) return { node: node, md: existing };
      node.mds.push(md);          // dir ノードでも欠けていれば足す / files ノードは和集合
      node.mds.sort(byName);
      return { node: node, md: md };
    }
    node = { path: parentPath, segments: parentSegs, kind: 'files', mds: [md], expanded: true };
    state.nodes.push(node);
    return { node: node, md: md };
  }

  function removeNode(node) {
    const i = state.nodes.indexOf(node);
    if (i !== -1) state.nodes.splice(i, 1);
    persistSession();
    renderSidebar();
  }

  // パスバー確定時の処理。FS 種別で自動判定（ADR-0014）。
  async function openPath(input) {
    if (!Bricola.repo.rootHandle) {
      setStatus('先に「リポジトリを選択」してください。', 'error');
      return;
    }
    let res;
    try {
      res = await Bricola.repo.resolvePath(input);
    } catch (e) {
      setStatus('パスの解決に失敗: ' + (e && e.message ? e.message : e), 'error');
      return;
    }
    if (res.kind === 'missing') {
      setStatus('パスが見つかりません: ' + (input || '(空)'), 'error');
      return;
    }
    if (res.kind === 'file') {
      const last = res.segments[res.segments.length - 1];
      if (!/\.md$/i.test(last)) {
        setStatus('md ファイルではありません: ' + input, 'error');
        return;
      }
      const added = await addFileNode(res.segments, res.handle); // 指定した md だけを足す
      persistSession();
      renderSidebar();
      if (added && added.md) openDocument({ path: added.md.path, handle: added.md.handle });
      el.pathInput.value = '';
      return;
    }
    // ディレクトリ
    const node = await addDirNode(res.segments);
    if (!node) {
      setStatus('このディレクトリ直下に md はありません: ' + (input || '/'), 'warn');
      return;
    }
    persistSession();
    renderSidebar();
    setStatus(nodeLabel(node) + ' を開きました（直下 md ' + node.mds.length + ' 件）。');
    el.pathInput.value = '';
  }

  // 蓄積ノードと最後に開いた md を localStorage に保存（ADR-0014）。
  // dir ノードはパスのみ（復元時に再 entries()）。files ノードは個別 md パスを保存。
  function persistSession() {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({
        nodes: state.nodes.map(function (n) {
          return n.kind === 'files'
            ? { path: n.path, kind: 'files', expanded: n.expanded, files: n.mds.map(function (m) { return m.path; }) }
            : { path: n.path, kind: 'dir', expanded: n.expanded };
        }),
        open: Bricola.docstate.cur ? Bricola.docstate.cur.path : null
      }));
    } catch (e) { /* 永続化失敗は致命的でない */ }
  }

  // 保存済みセッションを復元する。dir は再 entries()、files は各 md を再解決して足す。
  async function restoreSession() {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); }
    catch (e) { saved = null; }
    if (!saved || !saved.nodes) return;
    for (let i = 0; i < saved.nodes.length; i++) {
      const rec = saved.nodes[i];
      try {
        if (rec.kind === 'files') {
          let node = null;
          const files = rec.files || [];
          for (let j = 0; j < files.length; j++) {
            try { node = (await addFileNode(splitPath(files[j]))).node; } catch (e) { /* 消えた md はスキップ */ }
          }
          if (node && rec.expanded === false) node.expanded = false;
        } else {
          const node = await addDirNode(splitPath(rec.path));
          if (node && rec.expanded === false) node.expanded = false;
        }
      } catch (e) { /* 消えた/権限切れはスキップ */ }
    }
    renderSidebar();
    if (saved.open) {
      const h = handleOf(saved.open);
      if (h) await openDocument({ path: saved.open, handle: h });
    }
  }

  // ドラッグされたファイル群を結合した md スニペットを作る（実体貼付 / ADR-0003）。
  async function buildSnippet(paths) {
    const texts = [];
    for (let i = 0; i < paths.length; i++) {
      const h = handleOf(paths[i]);
      if (!h) continue;
      texts.push(await Bricola.repo.readText(h));
    }
    return texts.join('\n\n');
  }

  // コードエディタのキャレット位置にスニペットを挿入する。
  async function insertSnippetAt(pos, paths) {
    const snippet = await buildSnippet(paths);
    if (!snippet) return;
    const v = el.code.value;
    el.code.value = v.slice(0, pos) + snippet + v.slice(pos);
    state.text = el.code.value;
    el.code.selectionStart = el.code.selectionEnd = pos + snippet.length;
    updateDirtyUI();
    el.code.focus();
    setStatus(paths.length + ' 件を差し込みました。');
  }

  function renderOutline(items) {
    el.outline.innerHTML = '';
    items.forEach(function (it) {
      const li = document.createElement('li');
      li.className = 'outline-item lvl-' + it.level;
      li.textContent = it.text;
      li.addEventListener('click', function () {
        const t = document.getElementById(it.id);
        if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      el.outline.appendChild(li);
    });
  }

  // 現在の作業テキストをプレビューへ反映する。
  async function renderPreview() {
    el.preview.innerHTML = Bricola.render.toHtml(state.text);
    Bricola.mermaid.enhance(el.preview);            // ```mermaid → SVG 図 (ADR-0012)
    renderOutline(Bricola.outline.build(el.preview));
    const path = Bricola.docstate.cur ? Bricola.docstate.cur.path : '';
    await Bricola.assets.resolve(el.preview, path); // 相対画像 (ADR-0008)
    Bricola.tableui.enhance(el.preview);            // テーブル操作 (ADR-0007)
  }

  // ====== 編集経路の統一: 1つの編集モード × 2ビュー(プレビュー/コード) ======
  // state.text が唯一の真実。ビュー切替・保存・閲覧復帰の境界でのみ md 同期する。

  // アウトラインを state.text から作る（コードビューでも有効）。
  function refreshOutline() {
    const tmp = document.createElement('div');
    tmp.innerHTML = Bricola.render.toHtml(state.text);
    renderOutline(Bricola.outline.build(tmp));
  }

  function updateModeButtons() {
    el.btnEdit.textContent = state.editMode ? '編集終了' : '編集';
    el.btnEdit.classList.toggle('active', state.editMode);
    el.btnView.textContent = state.view === 'code' ? 'プレビュー' : 'コード';
  }

  // 変換確認モーダル。反映可否を Promise<boolean> で返す。
  function confirmConversion(md, warnings) {
    return new Promise(function (resolve) {
      el.convPreview.textContent = md;
      el.convWarnings.innerHTML = '';
      if (warnings.length) {
        el.convWarnings.hidden = false;
        const ul = document.createElement('ul');
        warnings.forEach(function (w) {
          const li = document.createElement('li');
          li.textContent = w;
          ul.appendChild(li);
        });
        el.convWarnings.appendChild(ul);
      } else {
        el.convWarnings.hidden = true;
      }
      el.modal.hidden = false;
      function finish(val) {
        el.convApply.onclick = null;
        el.convCancel.onclick = null;
        el.modal.hidden = true;
        resolve(val);
      }
      el.convApply.onclick = function () { finish(true); };
      el.convCancel.onclick = function () { finish(false); };
    });
  }

  // プレビューをブロック分割し contentEditable 化（WYSIWYG / ブロック最小差分）。
  // space トークン（ブロック間の空行）は DOM 化せず gapAfter / leadingWS に温存し、
  // 保存時に未編集領域の空白を原形のまま復元できるようにする（ADR-0010）。
  async function buildWysiwyg() {
    const split = Bricola.render.splitFrontmatter(state.text);
    state.fm = split.fm;
    state.blocks = { raw: [], html: [], gapAfter: [], leadingWS: '' };
    state.previewTouched = false;

    const tokens = window.marked.lexer(split.body);
    el.preview.innerHTML = '';
    let pendingGap = '';   // 直前ブロックの後ろに続く空行の生テキスト
    let started = false;   // 最初のブロックが出たか
    tokens.forEach(function (tok) {
      if (tok.type === 'space') {
        if (started) pendingGap += tok.raw; else state.blocks.leadingWS += tok.raw;
        return;
      }
      if (started) state.blocks.gapAfter[state.blocks.raw.length - 1] = pendingGap;
      pendingGap = '';
      started = true;
      const wrap = document.createElement('div');
      wrap.className = 'mdv-block';
      wrap.dataset.idx = String(state.blocks.raw.length);
      if (tok.type === 'table') wrap.dataset.mdvTable = '1'; // テーブルはセル単位で扱う
      wrap.innerHTML = Bricola.render.toHtml(tok.raw);
      state.blocks.raw.push(tok.raw);
      state.blocks.gapAfter.push(''); // 既定（末尾ブロックなら下で末尾空行を入れる）
      el.preview.appendChild(wrap);
    });
    // 末尾に残った空行（最後のブロックの後ろ）を温存する。
    if (started) state.blocks.gapAfter[state.blocks.raw.length - 1] = pendingGap;
    else state.blocks.leadingWS += pendingGap;
    await Bricola.assets.resolve(el.preview, Bricola.docstate.cur.path);
    Bricola.tableui.enhance(el.preview); // 編集中も列トグル・絞り込みを使える (ADR-0007)
    Array.prototype.forEach.call(el.preview.children, function (wrap) {
      if (wrap.dataset && wrap.dataset.idx !== undefined) state.blocks.html[+wrap.dataset.idx] = wrap.innerHTML;
    });
    el.preview.contentEditable = 'true';
    el.preview.classList.add('editing');
  }

  // 編集後 DOM → md。未編集ブロックは原文 raw を、ブロック間の空行も原文 gap を
  // そのまま温存し、編集したブロックだけ再シリアライズする（最小差分 / ADR-0002, 0010）。
  function computeWysiwygMd() {
    const b = state.blocks;
    const pieces = [];
    const changedSources = [];
    let prevIdx = -1;   // 直前に出力した既存ブロックの原文インデックス
    let first = true;

    // raw 末尾の改行列（marked は空行を後続 space トークンへ回すため、無ければ空）。
    // 編集ブロックを原文と同じ末尾で閉じ、空行は後続 gap がそのまま担う。
    function tailOf(raw) {
      const m = raw && raw.match(/\n+$/);
      return m ? m[0] : '';
    }
    // piece を、原文で隣接する未編集の並びなら原文 gap で、そうでなければ
    // 最低 1 空行になるよう不足分だけ補って前に繋ぐ（構造変化した箇所のみ）。
    function emit(piece, idx) {
      if (first) {
        if (idx === 0 && b.leadingWS) pieces.push(b.leadingWS);
        first = false;
      } else if (idx >= 0 && prevIdx >= 0 && idx === prevIdx + 1) {
        pieces.push(b.gapAfter[prevIdx] || '');
      } else {
        const prev = pieces.length ? pieces[pieces.length - 1] : '';
        const have = (prev.match(/\n+$/) || [''])[0].length;
        pieces.push('\n'.repeat(Math.max(0, 2 - have))); // 区切りを 1 空行に揃える
      }
      pieces.push(piece);
      prevIdx = idx;
    }

    Array.prototype.forEach.call(el.preview.childNodes, function (node) {
      if (node.nodeType === 3) {
        const txt = node.textContent.replace(/^\s+|\s+$/g, '');
        if (txt !== '') emit(txt + '\n', -1);
        return;
      }
      if (node.nodeType !== 1) return;
      const idxAttr = node.dataset ? node.dataset.idx : undefined;
      const i = (idxAttr !== undefined) ? +idxAttr : -1;
      let piece;
      if (node.dataset && node.dataset.mdvTable === '1' && i >= 0) {
        // テーブルはセル値のみ差し替え、構造を温存（turndown を通さない）。
        const table = node.querySelector('table');
        const raw = b.raw[i];
        if (table && Bricola.editor.tableUnchanged(table, raw)) {
          piece = raw;
        } else if (table) {
          piece = Bricola.editor.serializeTable(table, raw).replace(/\n+$/, '') + tailOf(raw);
        } else {
          piece = raw;
        }
      } else if (i >= 0 && node.innerHTML === b.html[i]) {
        piece = b.raw[i]; // 無編集：原文そのまま（前後の空白も保たれる）
      } else if (i >= 0) {
        piece = Bricola.editor.toMarkdown(node.innerHTML).replace(/\n+$/, '') + tailOf(b.raw[i]);
        changedSources.push(b.raw[i]);
      } else {
        const md = Bricola.editor.toMarkdown(node.outerHTML).replace(/\n+$/, '');
        if (md === '') return;
        piece = md + '\n';
      }
      emit(piece, i);
    });

    // 末尾ブロックの後ろの空行（原文末尾の空白）を温存する。
    if (prevIdx >= 0) pieces.push(b.gapAfter[prevIdx] || '');

    const newText = state.fm + pieces.join('');
    return {
      newText: newText,
      warnings: Bricola.editor.detectLossRisks(changedSources.join('\n')),
      changed: newText !== state.text
    };
  }

  // WYSIWYG の編集を state.text へ同期。続行可なら true（キャンセルで false）。
  // ロス警告があるときだけ確認モーダルを出す（通常は最小差分でシームレス）。
  async function syncWysiwyg() {
    const res = computeWysiwygMd();
    if (!res.changed) { state.previewTouched = false; return true; }
    if (res.warnings.length) {
      const ok = await confirmConversion(res.newText, res.warnings);
      if (!ok) return false;
    }
    state.text = res.newText;
    el.code.value = res.newText;
    state.previewTouched = false;
    updateDirtyUI();
    return true;
  }

  // 現在の editMode/view に合わせて表示を作り直す。
  async function refreshView() {
    const code = state.view === 'code';
    el.code.hidden = !code;
    el.preview.hidden = code;
    if (code) {
      el.preview.contentEditable = 'false';
      el.preview.classList.remove('editing');
      el.code.value = state.text;
      el.code.readOnly = !state.editMode;
      refreshOutline();
      if (state.editMode) el.code.focus();
    } else if (state.editMode) {
      await buildWysiwyg();
      refreshOutline();
      el.preview.focus();
    } else {
      el.preview.contentEditable = 'false';
      el.preview.classList.remove('editing');
      await renderPreview();
    }
    updateModeButtons();
    updateDirtyUI();
  }

  // ビュー切替（プレビュー ⇄ コード）。WYSIWYG から離れる時のみ同期。
  async function toggleView() {
    if (!Bricola.docstate.cur) return;
    const target = state.view === 'code' ? 'preview' : 'code';
    if (state.editMode && state.view === 'preview') {
      if (!(await syncWysiwyg())) return;
    } else if (state.view === 'code') {
      state.text = el.code.value;
    }
    state.view = target;
    await refreshView();
  }

  // 編集モード ⇄ 閲覧モード。
  async function enterEdit() {
    state.editMode = true;
    await refreshView();
    setStatus('編集モード（' + (state.view === 'code' ? 'コード' : 'プレビュー') + '）。保存で書き込み。', 'warn');
  }
  async function exitEdit() {
    if (state.view === 'preview') {
      if (!(await syncWysiwyg())) return;
    } else {
      state.text = el.code.value;
    }
    state.editMode = false;
    await refreshView();
    setStatus('閲覧モード。');
  }
  function toggleEdit() {
    if (!Bricola.docstate.cur) return;
    if (state.editMode) exitEdit();
    else enterEdit();
  }

  // ---- 文書を開く ----
  async function openDocument(doc) {
    if (!confirmLeaveEdit()) return;
    try {
      setStatus('読み込み中: ' + doc.path);
      const stat = await Bricola.repo.readWithStat(doc.handle);
      Bricola.docstate.load(doc.path, doc.handle, stat);
      Bricola.tableui.reset(); // 別文書ではテーブル状態を引き継がない (ADR-0007)
      state.text = stat.text;
      el.code.value = state.text;
      state.editMode = false;
      state.view = 'preview';
      state.previewTouched = false;
      renderSidebar();
      persistSession();
      await refreshView();
      setStatus(doc.path);
    } catch (e) {
      setStatus('読み込み失敗: ' + e.message, 'error');
    }
  }

  // ---- 保存（競合検知つき / ADR-0006, ADR-0010）----
  async function save() {
    const cur = Bricola.docstate.cur;
    if (!cur) return;
    // 保存前に現在ビューの編集内容を state.text へ取り込む。
    if (state.editMode && state.view === 'preview') {
      if (!(await syncWysiwyg())) return;
    } else if (state.view === 'code') {
      state.text = el.code.value;
    }
    if (!isDirty()) { setStatus('変更はありません。'); return; }

    try {
      // 保存直前にディスク側の変化を確認する。
      const stat = await Bricola.repo.statOf(cur.handle);
      if (Bricola.docstate.isStale(stat)) {
        const ok = window.confirm(
          'このファイルは読み込み後にディスク側で変更されています。\n' +
          'あなたの編集で上書きしますか?（相手の変更は失われます）'
        );
        if (!ok) { setStatus('保存を中止しました（競合）。', 'warn'); return; }
      }
      if (!(await Bricola.repo.ensureWritable(cur.handle))) {
        setStatus('書込み権限がありません。', 'error');
        return;
      }
      await Bricola.repo.writeText(cur.handle, state.text);
      const after = await Bricola.repo.statOf(cur.handle);
      Bricola.docstate.commit(state.text, after);
      // プレビュー編集中はベースラインを更新（以後の最小差分の基準に）。
      if (state.editMode && state.view === 'preview') await buildWysiwyg();
      updateDirtyUI();
      setStatus('保存しました: ' + cur.path);
    } catch (e) {
      setStatus('保存失敗: ' + e.message, 'error');
    }
  }

  // ---- 再読み込み（ディスクから / ADR-0006）----
  async function reload() {
    const cur = Bricola.docstate.cur;
    if (!cur) return;
    if (hasUnsaved() && !window.confirm('未保存の変更があります。破棄してディスクから再読み込みしますか?')) return;
    try {
      const stat = await Bricola.repo.readWithStat(cur.handle);
      Bricola.docstate.load(cur.path, cur.handle, stat);
      Bricola.tableui.reset(); // 再読込でディスク内容が変わり得るためリセット (ADR-0007)
      state.text = stat.text;
      el.code.value = state.text;
      state.editMode = false;   // 再読み込み後は閲覧モードに戻す
      state.view = 'preview';
      state.previewTouched = false;
      await refreshView();
      setStatus('再読み込みしました: ' + cur.path);
    } catch (e) {
      setStatus('再読み込み失敗: ' + e.message, 'error');
    }
  }

  // ---- リポジトリ初期化（rootHandle が設定・許可済みである前提 / ADR-0014）----
  // restore=true: 前回のセッション（蓄積ノード＋最後の md）を復元。
  // restore=false: セッションを破棄し空のサイドバーから開始（リポジトリ選び直し）。
  async function initRepo(restore) {
    Bricola.docstate.clear();
    Bricola.assets.revokeAll();
    state.nodes = [];
    state.selected.clear();
    state.text = '';
    el.preview.innerHTML = '';
    el.code.value = '';
    el.outline.innerHTML = '';
    el.search.value = '';
    el.pathInput.value = '';
    // ヘッダにリポジトリ（選択フォルダ）名を表示。FSA は絶対パスを公開しないため
    // 取得できるのはフォルダ名（handle.name）のみ。
    const repoName = Bricola.repo.rootHandle ? Bricola.repo.rootHandle.name : '';
    el.repoName.textContent = repoName;
    el.repoName.title = repoName ? ('リポジトリ: ' + repoName + '（ブラウザの制約で絶対パスは取得不可）') : '';
    el.repoName.hidden = !repoName;
    updateDirtyUI();
    renderSidebar();

    if (restore) {
      await restoreSession();
      setStatus(state.nodes.length
        ? 'セッションを復元しました。パスを入力して md を開けます（TAB で補完）。'
        : 'パスを入力して md を開いてください（TAB で補完）。');
    } else {
      try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* noop */ }
      setStatus('パスを入力して md を開いてください（TAB で補完）。');
    }
  }

  // ピッカーでフォルダを選び直す（＝セッションは破棄して空から）。
  async function selectRepository() {
    if (!Bricola.repo.supported()) {
      setStatus('このブラウザは File System Access API 非対応です。Chrome / Edge をご利用ください。', 'error');
      return;
    }
    if (!confirmLeaveEdit()) return;
    try {
      await Bricola.repo.pick();
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      setStatus('フォルダ選択に失敗: ' + e.message, 'error');
      return;
    }
    try { await Bricola.repo.saveRoot(); } catch (e) { /* 永続化失敗は致命的でない */ }
    el.btnRestore.hidden = true;
    await initRepo(false);
  }

  // 前回のフォルダをリロード後に再開する（要権限再付与・ユーザ操作・セッション復元）。
  async function restoreRepository(handle) {
    if (!confirmLeaveEdit()) return;
    Bricola.repo.rootHandle = handle;
    let ok = false;
    try { ok = await Bricola.repo.ensureWritable(handle); } catch (e) { ok = false; }
    if (!ok) { setStatus('フォルダへのアクセスが許可されませんでした。', 'error'); return; }
    el.btnRestore.hidden = true;
    await initRepo(true);
  }

  // ---- 起動 ----
  function boot() {
    el.fileList = $('file-list');
    el.outline = $('outline');
    el.preview = $('preview');
    el.code = $('code');
    el.status = $('status');
    el.dirty = $('dirty');
    el.btnSave = $('btn-save');
    el.btnView = $('btn-mode');
    el.btnEdit = $('btn-edit');
    el.btnClearSel = $('btn-clear-sel');
    el.btnRestore = $('btn-restore');
    el.repoName = $('repo-name');
    el.search = $('file-search');
    el.pathInput = $('path-input');
    el.pathCandidates = $('path-candidates');
    el.btnPathOpen = $('btn-path-open');
    el.modal = $('convert-modal');
    el.convPreview = $('convert-preview');
    el.convWarnings = $('convert-warnings');
    el.convApply = $('convert-apply');
    el.convCancel = $('convert-cancel');

    $('btn-open').addEventListener('click', selectRepository);
    el.btnClearSel.addEventListener('click', clearSelection);
    el.btnEdit.addEventListener('click', toggleEdit);
    el.btnView.addEventListener('click', toggleView);
    el.btnSave.addEventListener('click', save);
    $('btn-reload').addEventListener('click', reload);
    $('btn-theme').addEventListener('click', function () { Bricola.theme.toggle(); });
    el.search.addEventListener('input', renderSidebar);

    // パスバー + TAB 補完 (ADR-0014)
    Bricola.pathbar.init({
      input: el.pathInput,
      candidates: el.pathCandidates,
      button: el.btnPathOpen,
      onOpen: openPath
    });

    // サイドバー折りたたみ（左右それぞれ・状態を localStorage に保持）
    const leftBtn = $('btn-toggle-sidebar');
    const rightBtn = $('btn-toggle-outline');
    function applyCollapse(side, collapsed) {
      document.body.classList.toggle(side + '-collapsed', collapsed);
      localStorage.setItem('mdv-' + side, collapsed ? '1' : '0');
      // 折りたたみ方向を示すアイコン（«=畳む / »=開く）
      if (side === 'left') leftBtn.textContent = collapsed ? '»' : '«';
      else rightBtn.textContent = collapsed ? '«' : '»';
    }
    applyCollapse('left', localStorage.getItem('bricola-left') === '1');
    applyCollapse('right', localStorage.getItem('bricola-right') === '1');
    leftBtn.addEventListener('click', function () {
      applyCollapse('left', !document.body.classList.contains('left-collapsed'));
    });
    rightBtn.addEventListener('click', function () {
      applyCollapse('right', !document.body.classList.contains('right-collapsed'));
    });

    el.code.addEventListener('input', function () {
      if (!state.editMode) return;
      state.text = el.code.value;
      updateDirtyUI();
    });

    // プレビュー(WYSIWYG)編集の入力で未保存表示を出す。
    // テーブルの列トグル・絞り込み操作は編集ではないので除外する。
    el.preview.addEventListener('input', function (e) {
      if (!(state.editMode && state.view === 'preview')) return;
      if (e.target && e.target.closest && e.target.closest('.mdv-table-tools, .mdv-filter-row')) return;
      state.previewTouched = true;
      updateDirtyUI();
    });

    // サイドバーからの差し込み（コードエディタが受け口 / ADR-0003）
    function hasMdvPaths(e) {
      return e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types, 'application/x-bricola-paths') !== -1;
    }
    el.code.addEventListener('dragover', function (e) {
      if (!hasMdvPaths(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      el.code.classList.add('drop-target');
    });
    el.code.addEventListener('dragleave', function () { el.code.classList.remove('drop-target'); });
    el.code.addEventListener('drop', function (e) {
      const raw = e.dataTransfer.getData('application/x-bricola-paths');
      el.code.classList.remove('drop-target');
      if (!raw || !Bricola.docstate.cur) return;
      e.preventDefault();
      const pos = el.code.selectionStart; // ドロップ時のキャレット位置
      insertSnippetAt(pos, JSON.parse(raw));
    });

    // 未保存のままタブを閉じる/離れるのを防ぐ（ADR-0006）。
    window.addEventListener('beforeunload', function (e) {
      if (hasUnsaved()) { e.preventDefault(); e.returnValue = ''; }
    });

    Bricola.theme.init();
    updateDirtyUI();

    if (!Bricola.repo.supported()) {
      setStatus('Chrome / Edge で開いてください（File System Access API 必須）。', 'error');
      return;
    }
    setStatus('「リポジトリを選択」からフォルダを開いてください。');

    // 前回のフォルダを自動で開く。権限が残っていれば即時、無ければワンクリック。
    Bricola.repo.loadRoot().then(async function (handle) {
      if (!handle) return;
      Bricola.repo.rootHandle = handle;
      let perm = 'prompt';
      try { perm = await handle.queryPermission({ mode: 'readwrite' }); } catch (e) { /* noop */ }
      if (perm === 'granted') {
        await initRepo(true); // 権限が残っているのでセッション復元して自動再開
        return;
      }
      // 権限がリセットされている場合はユーザ操作が必要（1クリックで再開）。
      el.btnRestore.hidden = false;
      el.btnRestore.textContent = '前回のフォルダを開く: ' + handle.name;
      el.btnRestore.addEventListener('click', function () { restoreRepository(handle); });
      setStatus('前回のフォルダ「' + handle.name + '」を開くには上のボタンを押してください。');
    }).catch(function () { /* 保存ハンドルなし */ });
  }

  document.addEventListener('DOMContentLoaded', boot);
})(window.Bricola = window.Bricola || {});
