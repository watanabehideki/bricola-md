// main.js — 起動・DOM 配線・オーケストレーション
// M1: 閲覧コア / M2: 相対画像 / M3: コード編集・保存・競合検知
(function (Bricola) {
  'use strict';

  const el = {};
  const state = {
    cfg: null,            // パース済み設定
    docs: [],             // 対象 md [{path, handle}]
    selected: new Set(),  // D&D 用の複数選択パス (ADR-0003)
    expandedDirs: new Set(), // 展開中フォルダのパス（再描画で維持）
    text: '',             // 現在の作業テキスト（唯一の真実 / ADR-0002）
    editMode: false,      // 編集モードか
    view: 'preview',      // 'preview'(WYSIWYG) | 'code'
    previewTouched: false,// プレビュー編集の未同期フラグ（未保存表示用）
    fm: '',               // 編集中文書の frontmatter（温存用 / ADR-0010）
    blocks: { raw: [], html: [] } // ブロック単位の最小差分用スナップショット
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

  // パス → ハンドル
  function handleOf(path) {
    for (let i = 0; i < state.docs.length; i++) {
      if (state.docs[i].path === path) return state.docs[i].handle;
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

  // ---- サイドバー（VSCode 風ディレクトリツリー） ----
  let selOrderCache = [];

  // フラットなパス一覧をディレクトリツリーに変換する。
  function buildTree(docs) {
    const root = { dirs: {}, files: [] };
    docs.forEach(function (d) {
      const parts = d.path.split('/');
      let node = root;
      for (let i = 0; i < parts.length - 1; i++) {
        const name = parts[i];
        node.dirs[name] = node.dirs[name] || { dirs: {}, files: [] };
        node = node.dirs[name];
      }
      node.files.push({ name: parts[parts.length - 1], path: d.path, handle: d.handle });
    });
    return root;
  }

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
        renderTree();
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

  // パスの親フォルダ群を展開状態にする（trailing slash 形式）。
  function expandToPath(path) {
    const parts = path.split('/');
    let pre = '';
    for (let i = 0; i < parts.length - 1; i++) { pre += parts[i] + '/'; state.expandedDirs.add(pre); }
  }

  // ツリーを再帰描画。expandAll=true（検索中）は全フォルダ展開。
  // 展開状態は state.expandedDirs に保持し、再描画で失われないようにする。
  function renderTreeNode(node, expandAll, prefix) {
    const ul = document.createElement('ul');
    ul.className = 'tree';
    Object.keys(node.dirs).sort().forEach(function (dirName) {
      const dirPath = prefix + dirName + '/';
      const li = document.createElement('li');
      li.className = 'tree-dir';
      const expanded = expandAll || state.expandedDirs.has(dirPath);
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
      label.textContent = dirName;
      row.appendChild(chev);
      row.appendChild(icon);
      row.appendChild(label);
      row.addEventListener('click', function () {
        if (state.expandedDirs.has(dirPath)) state.expandedDirs.delete(dirPath);
        else state.expandedDirs.add(dirPath);
        li.classList.toggle('collapsed');
      });

      li.appendChild(row);
      li.appendChild(renderTreeNode(node.dirs[dirName], expandAll, dirPath));
      ul.appendChild(li);
    });
    node.files.slice().sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; })
      .forEach(function (f) { ul.appendChild(renderFileItem(f)); });
    return ul;
  }

  function renderTree() {
    el.fileList.innerHTML = '';
    selOrderCache = orderedSelected();
    const cur = Bricola.docstate.cur;
    if (cur) expandToPath(cur.path); // 現在ファイルまでの経路は展開
    const q = (el.search.value || '').trim().toLowerCase();
    const docs = q ? state.docs.filter(function (d) { return d.path.toLowerCase().indexOf(q) !== -1; }) : state.docs;
    el.fileList.appendChild(renderTreeNode(buildTree(docs), q !== '', ''));

    const active = el.fileList.querySelector('.tree-file.active');
    if (active) active.scrollIntoView({ block: 'nearest' });
    updateSelectionUI();
  }

  // 既存呼び出し名の互換
  function renderFileList() { renderTree(); }

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
  async function buildWysiwyg() {
    const split = Bricola.render.splitFrontmatter(state.text);
    state.fm = split.fm;
    state.blocks = { raw: [], html: [] };
    state.previewTouched = false;

    const tokens = window.marked.lexer(split.body);
    el.preview.innerHTML = '';
    tokens.forEach(function (tok) {
      if (tok.type === 'space') return;
      const wrap = document.createElement('div');
      wrap.className = 'mdv-block';
      wrap.dataset.idx = String(state.blocks.raw.length);
      if (tok.type === 'table') wrap.dataset.mdvTable = '1'; // テーブルはセル単位で扱う
      wrap.innerHTML = Bricola.render.toHtml(tok.raw);
      state.blocks.raw.push(tok.raw);
      el.preview.appendChild(wrap);
    });
    await Bricola.assets.resolve(el.preview, Bricola.docstate.cur.path);
    Bricola.tableui.enhance(el.preview); // 編集中も列トグル・絞り込みを使える (ADR-0007)
    Array.prototype.forEach.call(el.preview.children, function (wrap) {
      if (wrap.dataset && wrap.dataset.idx !== undefined) state.blocks.html[+wrap.dataset.idx] = wrap.innerHTML;
    });
    el.preview.contentEditable = 'true';
    el.preview.classList.add('editing');
  }

  // 編集後 DOM → md（未編集ブロックは原文保持 / ADR-0002, 0010）。
  function computeWysiwygMd() {
    const parts = [];
    const changedSources = [];
    Array.prototype.forEach.call(el.preview.childNodes, function (node) {
      if (node.nodeType === 3) {
        const txt = node.textContent.replace(/^\n+/, '').replace(/\n+$/, '');
        if (txt.trim() !== '') parts.push(txt);
        return;
      }
      if (node.nodeType !== 1) return;
      const idxAttr = node.dataset ? node.dataset.idx : undefined;
      const i = (idxAttr !== undefined) ? +idxAttr : -1;
      let md;
      // テーブルはセル値のみ差し替え、構造を温存（turndown を通さない）。
      if (node.dataset && node.dataset.mdvTable === '1' && i >= 0) {
        const table = node.querySelector('table');
        md = (table && Bricola.editor.tableUnchanged(table, state.blocks.raw[i]))
          ? state.blocks.raw[i]
          : (table ? Bricola.editor.serializeTable(table, state.blocks.raw[i]) : state.blocks.raw[i]);
      } else if (i >= 0 && node.innerHTML === state.blocks.html[i]) {
        md = state.blocks.raw[i];
      } else {
        md = Bricola.editor.toMarkdown(i >= 0 ? node.innerHTML : node.outerHTML);
        if (i >= 0) changedSources.push(state.blocks.raw[i]);
      }
      md = md.replace(/^\n+/, '').replace(/\n+$/, '');
      if (md !== '') parts.push(md);
    });
    const body = parts.length ? parts.join('\n\n') + '\n' : '';
    const newText = state.fm ? state.fm + body : body;
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
      state.text = stat.text;
      el.code.value = state.text;
      state.editMode = false;
      state.view = 'preview';
      state.previewTouched = false;
      renderTree();
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

  // ---- リポジトリ選択〜一覧構築 ----
  // 設定読込・走査・描画（rootHandle が設定・許可済みである前提）。
  async function loadFromRoot() {
    // 設定は選択リポジトリ直下の .bricola.yaml を FSA で読む (ADR-0011)。
    // file:// では fetch 不可だが、FSA ハンドル経由なら起動時に読める。
    // glob は「選択した repo」を起点に評価する（config.matches はルート相対パス判定）。
    let cfgText;
    try {
      cfgText = await Bricola.repo.readConfigText();
    } catch (e) {
      setStatus('設定ファイル ' + Bricola.repo.CONFIG_NAME + ' が見つかりません。リポジトリ直下に作成してください。', 'error');
      return;
    }
    try {
      state.cfg = Bricola.config.parse(cfgText);
    } catch (e) {
      setStatus('設定の解析に失敗: ' + e.message, 'error');
      return;
    }

    setStatus('走査中...');
    const all = await Bricola.repo.walk();
    state.docs = all
      .filter(function (f) { return Bricola.config.matches(f.path, state.cfg); })
      .sort(function (a, b) { return a.path < b.path ? -1 : a.path > b.path ? 1 : 0; });

    Bricola.docstate.clear();
    Bricola.assets.revokeAll();
    state.selected.clear();
    state.text = '';
    el.preview.innerHTML = '';
    el.code.value = '';
    el.outline.innerHTML = '';
    el.search.value = '';
    updateDirtyUI();
    renderTree();

    if (!state.docs.length) {
      setStatus('対象 md が 0 件でした。include/exclude を確認してください。', 'warn');
    } else {
      setStatus(state.docs.length + ' 件の md を読み込みました。');
      openDocument(state.docs[0]);
    }
  }

  // ピッカーでフォルダを選び直す。
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
    await loadFromRoot();
  }

  // 前回のフォルダをリロード後に再開する（要権限再付与・ユーザ操作）。
  async function restoreRepository(handle) {
    if (!confirmLeaveEdit()) return;
    Bricola.repo.rootHandle = handle;
    let ok = false;
    try { ok = await Bricola.repo.ensureWritable(handle); } catch (e) { ok = false; }
    if (!ok) { setStatus('フォルダへのアクセスが許可されませんでした。', 'error'); return; }
    el.btnRestore.hidden = true;
    await loadFromRoot();
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
    el.search = $('file-search');
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
    el.search.addEventListener('input', renderTree);

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
        await loadFromRoot(); // 権限が残っているので自動再開
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
