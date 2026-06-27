// pathbar.js — パスバー入力 + 補完 (ADR-0014)
// 入力するたびに前方一致候補をドロップダウン表示し、最有力候補の「後方」を入力欄に
// インライン補完（選択状態）する。TAB/↑↓で候補を順送りし、ドロップダウンの選択も連動する。
// 候補はディレクトリと .md のみ。1 階層だけ entries() するので全木は舐めない。
(function (Bricola) {
  'use strict';

  // 入力値を「確定済みディレクトリ部分(base, 末尾/付き)」と「補完中の断片(frag)」に割る。
  function splitInput(value) {
    const idx = value.lastIndexOf('/');
    if (idx === -1) return { base: '', frag: value, dirSegs: [] };
    const base = value.slice(0, idx + 1);
    const frag = value.slice(idx + 1);
    const dirSegs = base.split('/').filter(function (s) { return s.length > 0; });
    return { base: base, frag: frag, dirSegs: dirSegs };
  }

  function isMd(name) { return /\.md$/i.test(name); }

  Bricola.pathbar = {
    // opts: { input, candidates(DOM), button, onOpen(path) }
    init: function (opts) {
      const input = opts.input;
      const listEl = opts.candidates;

      let base = '';        // 直近 recompute の base
      let frag = '';        // 直近 recompute の frag（ユーザ入力の断片）
      let typedPrefix = ''; // 入力欄の「確定済み」前半（選択範囲の手前）。サイクル判定に使う。
      let matches = [];     // 現在の候補
      let index = 0;        // ハイライト/インライン補完中の候補番号
      let seq = 0;          // 非同期の競合ガード

      function hide() { listEl.hidden = true; listEl.innerHTML = ''; }

      function renderDropdown() {
        listEl.innerHTML = '';
        if (!matches.length) { listEl.hidden = true; return; }
        matches.forEach(function (m, i) {
          const suffix = m.kind === 'directory' ? '/' : '';
          const div = document.createElement('div');
          div.className = 'path-cand' + (m.kind === 'directory' ? ' is-dir' : '') + (i === index ? ' active' : '');
          div.textContent = m.name + suffix;
          div.addEventListener('mousedown', function (e) {
            e.preventDefault();
            index = i;
            applyFill();
            collapseCaret();
            hide();
            input.focus();
          });
          listEl.appendChild(div);
        });
        listEl.hidden = false;
        const act = listEl.querySelector('.path-cand.active');
        if (act) act.scrollIntoView({ block: 'nearest' });
      }

      // 候補 index を入力欄へインライン補完する（後半を選択状態に）。
      function applyFill() {
        const m = matches[index];
        const suffix = m.kind === 'directory' ? '/' : '';
        const value = base + m.name + suffix;
        input.value = value;
        // 選択開始 = base + 入力済み断片の長さ（後半だけを選択 → そのまま打てば上書き）。
        const start = base.length + frag.length;
        input.setSelectionRange(start, value.length);
        typedPrefix = input.value.slice(0, start);
        renderDropdown();
      }

      function collapseCaret() {
        const end = input.value.length;
        input.setSelectionRange(end, end);
      }

      // シェル流: 候補が 1 つなら選択状態を残さず確定する（dir は末尾 / を付ける）。
      // matches を空にするので、次の TAB は再計算され dir ならその中へ降りる。
      function commitSingle() {
        const m = matches[0];
        const suffix = m.kind === 'directory' ? '/' : '';
        input.value = base + m.name + suffix;
        collapseCaret();
        typedPrefix = input.value;
        matches = [];
        hide();
      }

      // typedLogical（= ユーザが実際に打った前半）で候補を計算する。
      async function recompute(typedLogical) {
        const parts = splitInput(typedLogical);
        base = parts.base; frag = parts.frag; typedPrefix = typedLogical;
        const my = ++seq;
        let entries;
        try { entries = await Bricola.repo.listDir(parts.dirSegs); }
        catch (e) { if (my === seq) { matches = []; hide(); } return false; }
        if (my !== seq) return false; // 後発の入力に追い越された
        const fragLower = frag.toLowerCase();
        matches = entries.filter(function (e) {
          if (e.name.toLowerCase().indexOf(fragLower) !== 0) return false;
          return e.kind === 'directory' || isMd(e.name);
        }).sort(function (a, b) {
          if ((a.kind === 'directory') !== (b.kind === 'directory')) return a.kind === 'directory' ? -1 : 1;
          return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
        });
        index = 0;
        if (!matches.length) { hide(); return false; }
        renderDropdown();
        return true;
      }

      // TAB/↓: 複数候補で前半が同じならサイクル。それ以外は再計算し、
      // 候補が 1 つならシェル流に確定、複数なら先頭をインライン補完して一覧表示。
      async function step(dir) {
        const typedLogical = input.value.slice(0, input.selectionStart);
        if (matches.length > 1 && typedLogical === typedPrefix) {
          index = (index + dir + matches.length) % matches.length;
          applyFill();
          return;
        }
        const ok = await recompute(typedLogical);
        if (!ok) return;
        if (matches.length === 1) commitSingle();
        else applyFill();
      }

      input.addEventListener('keydown', function (e) {
        if (e.key === 'Tab' || e.key === 'ArrowDown') {
          e.preventDefault();
          step(1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          step(-1);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          // ディレクトリ（末尾 /）で Enter は「開く」ではなく中へ降りて候補を出す。
          // ディレクトリ自体を開きたいときは「開く」ボタンを使う。
          if (/\/$/.test(input.value)) {
            collapseCaret();
            recompute(input.value).then(function (ok) { if (ok) applyFill(); });
            return;
          }
          collapseCaret();
          const v = input.value.trim();
          hide();
          matches = [];
          opts.onOpen(v);
        } else if (e.key === 'Escape') {
          hide();
        }
      });

      // 入力のたびに前方一致候補を出し、削除でなければ後半をインライン補完する。
      input.addEventListener('input', function (e) {
        const del = e.inputType && /^delete/.test(e.inputType);
        const typedLogical = input.value;
        recompute(typedLogical).then(function (ok) {
          if (ok && !del) applyFill(); // 削除中はインライン補完しない（消せなくなるため）
        });
      });

      if (opts.button) {
        opts.button.addEventListener('click', function () {
          const v = input.value.trim();
          hide();
          matches = [];
          opts.onOpen(v);
        });
      }
      document.addEventListener('click', function (e) {
        if (e.target !== input && !listEl.contains(e.target)) hide();
      });
    }
  };
})(window.Bricola = window.Bricola || {});
