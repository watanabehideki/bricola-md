// repository.js — File System Access API ラッパ (ADR-0001, ADR-0011)
// ルートディレクトリの選択・設定読込（選択 repo 内 .bricola.yaml を FSA で）・配下走査・ファイル読取りを担う。
// M1 では読取りのみ。書込み/競合検知は M3 で追加する。
(function (Bricola) {
  'use strict';

  const CONFIG_NAME = '.bricola.yaml';

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

    // 選択リポジトリ直下の設定ファイル .bricola.yaml を読む。
    // file:// では fetch 不可のため FSA ハンドル経由で読む（ADR-0011）。無ければ NotFoundError。
    readConfigText: async function () {
      const h = await this.rootHandle.getFileHandle(CONFIG_NAME);
      const f = await h.getFile();
      return await f.text();
    },

    // 配下の全ファイルを {path, handle} で列挙する（path はルート相対）。
    walk: async function () {
      const out = [];
      async function recurse(dirHandle, prefix) {
        for await (const [name, handle] of dirHandle.entries()) {
          const p = prefix ? prefix + '/' + name : name;
          if (handle.kind === 'directory') {
            await recurse(handle, p);
          } else {
            out.push({ path: p, handle: handle });
          }
        }
      }
      await recurse(this.rootHandle, '');
      return out;
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

  repo.CONFIG_NAME = CONFIG_NAME;
  Bricola.repo = repo;
})(window.Bricola = window.Bricola || {});
