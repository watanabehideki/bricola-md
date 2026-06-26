// glob.js — 軽量 glob マッチャ (ADR-0005)
// 依存を増やさないための最小実装。`**` `*` `?` をサポートする。
(function (Bricola) {
  'use strict';

  // glob 文字列をパス全体に対する正規表現へ変換する。
  //   **/ … 0個以上のディレクトリ階層
  //   **  … スラッシュ含む任意
  //   *   … スラッシュを除く任意
  //   ?   … スラッシュを除く1文字
  function globToRegExp(glob) {
    let re = '';
    for (let i = 0; i < glob.length; i++) {
      const c = glob[i];
      if (c === '*') {
        if (glob[i + 1] === '*') {
          if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 2; }
          else { re += '.*'; i += 1; }
        } else {
          re += '[^/]*';
        }
      } else if (c === '?') {
        re += '[^/]';
      } else if ('.+^${}()|[]\\'.indexOf(c) !== -1) {
        re += '\\' + c;
      } else {
        re += c; // '/' や通常文字はそのまま
      }
    }
    return new RegExp('^' + re + '$');
  }

  const cache = new Map();
  function compiled(glob) {
    let r = cache.get(glob);
    if (!r) { r = globToRegExp(glob); cache.set(glob, r); }
    return r;
  }

  Bricola.glob = {
    match: function (path, glob) { return compiled(glob).test(path); },
    matchAny: function (path, globs) {
      for (let i = 0; i < globs.length; i++) {
        if (compiled(globs[i]).test(path)) return true;
      }
      return false;
    }
  };
})(window.Bricola = window.Bricola || {});
