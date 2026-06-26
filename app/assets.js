// assets.js — 相対パス画像を FSA 経由で Blob URL に解決する (ADR-0008)
// レンダリング後の <img> を走査し、リポジトリ内の相対画像を読み込んで表示する。
(function (Bricola) {
  'use strict';

  let active = []; // 現在文書で生成した Object URL（切替時に解放）

  function revokeAll() {
    active.forEach(function (u) { URL.revokeObjectURL(u); });
    active = [];
  }

  // 文書パス "examples/welcome.md" → 基点ディレクトリ ["examples"]
  function dirSegments(docPath) {
    const parts = docPath.split('/');
    parts.pop();
    return parts;
  }

  // 絶対 URL / データ URI / プロトコル相対は解決対象外。
  function isExternal(src) {
    return /^[a-z][a-z0-9+.-]*:/i.test(src) || src.indexOf('//') === 0;
  }

  // 基点ディレクトリからの相対 href をルート相対セグメント配列へ解決する。
  // ルート外（.. でルートを越える）や空は null を返す。
  function resolvePath(baseSegs, href) {
    href = href.split('#')[0].split('?')[0];
    if (!href) return null;
    let segs = href.charAt(0) === '/' ? [] : baseSegs.slice(); // 先頭 / はルート基点
    const parts = href.split('/');
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p === '' || p === '.') continue;
      if (p === '..') {
        if (segs.length === 0) return null; // ルート外
        segs.pop();
        continue;
      }
      segs.push(p);
    }
    return segs.length ? segs : null;
  }

  // container 内の相対画像を Blob URL に差し替える。
  async function resolve(container, docPath) {
    revokeAll();
    const base = dirSegments(docPath);
    const imgs = container.querySelectorAll('img[src]');
    for (let i = 0; i < imgs.length; i++) {
      const img = imgs[i];
      const raw = img.getAttribute('src');
      if (!raw || isExternal(raw)) continue;
      const segs = resolvePath(base, raw);
      if (!segs) { img.dataset.mdvUnresolved = '1'; continue; }
      try {
        const handle = await Bricola.repo.getFileHandleByPath(segs);
        const file = await handle.getFile();
        const url = URL.createObjectURL(file);
        active.push(url);
        img.src = url;
      } catch (e) {
        // 解決不可（ファイルなし等）は壊れ画像のまま残す（安全側・ADR-0008）
        img.dataset.mdvUnresolved = '1';
      }
    }
  }

  Bricola.assets = {
    resolve: resolve,
    revokeAll: revokeAll,
    resolvePath: resolvePath,   // テスト用に公開
    dirSegments: dirSegments,
    isExternal: isExternal
  };
})(window.Bricola = window.Bricola || {});
