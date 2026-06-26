// config.js — .bricola.yaml の解釈 (ADR-0005, ADR-0009)
// include/exclude の glob のみを扱う。設定は必須。
(function (Bricola) {
  'use strict';

  function toArray(v) {
    if (v == null) return [];
    return Array.isArray(v) ? v.map(String) : [String(v)];
  }

  Bricola.config = {
    // YAML テキスト → { include:[], exclude:[], raw }
    parse: function (text) {
      const data = window.jsyaml.load(text) || {};
      return {
        include: toArray(data.include),
        exclude: toArray(data.exclude),
        raw: data
      };
    },

    // パスが対象か判定する。include に当たり exclude に当たらないもの。
    matches: function (path, cfg) {
      if (!cfg.include.length) return false;
      if (!Bricola.glob.matchAny(path, cfg.include)) return false;
      if (cfg.exclude.length && Bricola.glob.matchAny(path, cfg.exclude)) return false;
      return true;
    }
  };
})(window.Bricola = window.Bricola || {});
