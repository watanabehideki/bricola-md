// repository.js — File System Access API ラッパ (ADR-0001, ADR-0011, ADR-0014)
// ルートディレクトリの選択・パス解決・1 階層の列挙・ファイル読取り/書込みを担う。
// 設定（.bricola.yaml）や全木走査は ADR-0014 で廃止。パス指定で必要な階層だけを辿る。
(function (Bricola) {
  'use strict';

  // ルート相対パス文字列を空要素を除いたセグメント配列にする。
  function splitPath(p) {
    return String(p || '').split('/').filter(function (s) { return s.length > 0; });
  }

  const repo = {
    rootHandle: null,

    supported: function () {
      return typeof window.showDirectoryPicker === 'function';
    },

    // ユーザ操作でルートフォルダを選ぶ（要ジェスチャ）。
    // 保存（ADR-0006）に備え readwrite で要求する。
    pick: async function () {
      this.rootHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
      return this.rootHandle;
    },

    // セグメント配列の指すディレクトリハンドルを辿る（segments=[] はルート自身）。
    getDirHandleByPath: async function (segments) {
      let dir = this.rootHandle;
      for (let i = 0; i < segments.length; i++) {
        dir = await dir.getDirectoryHandle(segments[i]);
      }
      return dir;
    },

    // 1 ディレクトリの直下エントリだけを列挙する（再帰しない / ADR-0014）。
    // TAB 補完とノード展開の共通土台。全木は舐めない＝起動が重くならない。
    // 返り値: [{ name, kind:'file'|'directory', handle }]
    listDir: async function (segments) {
      const dir = await this.getDirHandleByPath(segments);
      const out = [];
      for await (const [name, handle] of dir.entries()) {
        out.push({ name: name, kind: handle.kind, handle: handle });
      }
      return out;
    },

    // ルート相対パスを FS 上の種別で解決する（ADR-0014）。
    // 返り値: { kind:'dir'|'file'|'missing', segments, handle? }
    resolvePath: async function (path) {
      const segments = splitPath(path);
      if (!segments.length) return { kind: 'dir', segments: [], handle: this.rootHandle };
      try {
        const handle = await this.getDirHandleByPath(segments);
        return { kind: 'dir', segments: segments, handle: handle };
      } catch (e) { /* ディレクトリではない → ファイルを試す */ }
      try {
        const handle = await this.getFileHandleByPath(segments);
        return { kind: 'file', segments: segments, handle: handle };
      } catch (e) { /* ファイルでもない */ }
      return { kind: 'missing', segments: segments };
    },

    // ファイルハンドルからテキストを読む。
    readText: async function (handle) {
      const f = await handle.getFile();
      return await f.text();
    },

    // ファイルのテキストと更新情報を併せて読む（競合検知用 / ADR-0006）。
    readWithStat: async function (handle) {
      const f = await handle.getFile();
      const text = await f.text();
      return { text: text, mtime: f.lastModified, size: f.size };
    },

    // 現在のディスク上の更新情報のみ取得する。
    statOf: async function (handle) {
      const f = await handle.getFile();
      return { mtime: f.lastModified, size: f.size };
    },

    // 書込み権限を確保する（無ければ要求）。
    ensureWritable: async function (handle) {
      const opts = { mode: 'readwrite' };
      if ((await handle.queryPermission(opts)) === 'granted') return true;
      return (await handle.requestPermission(opts)) === 'granted';
    },

    // --- リロード後の再開用に root ハンドルを IndexedDB へ保存／復元する ---
    _idb: function () {
      return new Promise(function (res, rej) {
        const r = window.indexedDB.open('bricola', 1);
        r.onupgradeneeded = function () { r.result.createObjectStore('handles'); };
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { rej(r.error); };
      });
    },
    saveRoot: async function () {
      if (!this.rootHandle) return;
      const db = await this._idb();
      const h = this.rootHandle;
      await new Promise(function (res, rej) {
        const tx = db.transaction('handles', 'readwrite');
        tx.objectStore('handles').put(h, 'root');
        tx.oncomplete = res;
        tx.onerror = function () { rej(tx.error); };
      });
    },
    loadRoot: async function () {
      const db = await this._idb();
      return await new Promise(function (res, rej) {
        const tx = db.transaction('handles', 'readonly');
        const rq = tx.objectStore('handles').get('root');
        rq.onsuccess = function () { res(rq.result || null); };
        rq.onerror = function () { rej(rq.error); };
      });
    },

    // テキストをそのまま書き戻す（原形保持 / ADR-0010）。
    writeText: async function (handle, text) {
      const w = await handle.createWritable();
      await w.write(text);
      await w.close();
    },

    // ルート相対のパスセグメント配列から FileHandle を辿る。
    // 見つからなければ getDirectoryHandle/getFileHandle が NotFoundError を投げる。
    getFileHandleByPath: async function (segments) {
      let dir = this.rootHandle;
      for (let i = 0; i < segments.length - 1; i++) {
        dir = await dir.getDirectoryHandle(segments[i]);
      }
      return await dir.getFileHandle(segments[segments.length - 1]);
    }
  };

  Bricola.repo = repo;
})(window.Bricola = window.Bricola || {});
