// docstate.js — 現在文書の状態（単一文書 / ADR-0007, ADR-0006）
// baseText はディスクと一致する確定テキスト。mtime/size は読込時のスナップショット。
(function (Bricola) {
  'use strict';

  Bricola.docstate = {
    cur: null, // { path, handle, baseText, mtime, size }

    // 文書を読み込んだ時点のスナップショットを設定する。
    load: function (path, handle, stat) {
      this.cur = {
        path: path,
        handle: handle,
        baseText: stat.text,
        mtime: stat.mtime,
        size: stat.size
      };
    },

    // 保存後にスナップショットを更新する。
    commit: function (text, stat) {
      if (!this.cur) return;
      this.cur.baseText = text;
      this.cur.mtime = stat.mtime;
      this.cur.size = stat.size;
    },

    // 与えられた編集中テキストが確定テキストと異なるか。
    isDirty: function (text) {
      return !!this.cur && text !== this.cur.baseText;
    },

    // 読込時から見てディスク側が変化したか（競合検知 / ADR-0006）。
    isStale: function (stat) {
      return !!this.cur && (stat.mtime !== this.cur.mtime || stat.size !== this.cur.size);
    },

    clear: function () { this.cur = null; }
  };
})(window.Bricola = window.Bricola || {});
