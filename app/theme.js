// theme.js — ダーク/ライト切替（アプリ設定なので localStorage に永続化）
(function (Bricola) {
  'use strict';

  const KEY = 'bricola-theme';

  Bricola.theme = {
    init: function () {
      this.apply(localStorage.getItem(KEY) || 'light');
    },
    apply: function (t) {
      document.documentElement.dataset.theme = t;
      localStorage.setItem(KEY, t);
    },
    current: function () {
      return document.documentElement.dataset.theme || 'light';
    },
    toggle: function () {
      this.apply(this.current() === 'dark' ? 'light' : 'dark');
    }
  };
})(window.Bricola = window.Bricola || {});
