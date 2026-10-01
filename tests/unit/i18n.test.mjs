// M24 (SPEC 3.12): UI languages — dictionaries, language choice, and a guard
// that no user-facing Chinese literal is left outside the dictionaries.
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { LANGS, DICTS, DEFAULT_LANG, pickLang, translate, setLang, getLang, t, locale } from '../../src/core/i18n/index.mjs';
import { formatDate, formatInt } from '../../src/renderer/format.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const SAME_AS_EN = [];
const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('dictionaries', () => {
  it('every language has exactly the same keys, all non-empty, with the same placeholders', () => {
    const keys = Object.keys(DICTS.en).sort();
    expect(keys.length).toBeGreaterThan(300);
    for (const lang of LANGS) {
      expect([lang, Object.keys(DICTS[lang]).sort()]).toEqual([lang, keys]);
      for (const k of keys) {
        expect([lang, k, DICTS[lang][k].length > 0]).toEqual([lang, k, true]);
        expect([lang, k, placeholders(DICTS[lang][k])]).toEqual([lang, k, placeholders(DICTS.en[k])]);
      }
    }
  });

  it('English has no Chinese; the Chinese dictionaries are not English copies', () => {
    for (const [k, v] of Object.entries(DICTS.en)) expect([k, /[一-鿿]/.test(v)]).toEqual([k, false]);
    // only language-neutral strings may be identical to English
    const same = (lang) => Object.keys(DICTS.en).filter((k) => DICTS[lang][k] === DICTS.en[k]);
    expect(same('zh-TW')).toEqual(SAME_AS_EN);
    expect(same('zh-CN')).toEqual(SAME_AS_EN);
  });

  it('every key used in the code exists', () => {
    const prefixes = [...new Set(Object.keys(DICTS.en).map((k) => k.split('.')[0]))].join('|');
    const re = new RegExp(`['"\`]((?:${prefixes})\\.[A-Za-z0-9_.]+)['"\`]`, 'g');
    const missing = [];
    for (const file of sourceFiles()) for (const m of fs.readFileSync(file, 'utf8').matchAll(re)) if (!(m[1] in DICTS.en)) missing.push(`${path.relative(ROOT, file)}: ${m[1]}`);
    expect(missing).toEqual([]);
  });
});

describe('language choice', () => {
  afterEach(() => setLang('zh-TW')); // the unit-test default (tests/unit/setup.mjs)

  it('pickLang: the first supported system locale wins, English otherwise', () => {
    expect(pickLang(['zh-Hant-TW', 'en-US'])).toBe('zh-TW');
    expect(pickLang(['zh-TW'])).toBe('zh-TW');
    expect(pickLang(['zh-HK'])).toBe('zh-TW');
    expect(pickLang(['zh_TW'])).toBe('zh-TW');
    expect(pickLang(['zh-Hans-CN'])).toBe('zh-CN');
    expect(pickLang(['zh-CN'])).toBe('zh-CN');
    expect(pickLang(['zh'])).toBe('zh-CN');
    expect(pickLang(['ja-JP', 'en-GB', 'zh-TW'])).toBe('en');
    expect(pickLang(['fr-FR', 'de'])).toBe(DEFAULT_LANG);
    expect(pickLang([])).toBe('en');
  });

  it('translate fills placeholders, falls back to English, then to the key', () => {
    expect(translate('en', 'badge.colors', { n: 4 })).toBe('4 colours');
    expect(translate('zh-TW', 'badge.colors', { n: 4 })).toBe('4 色');
    expect(translate('zh-CN', 'side.trash')).toBe('回收站');
    expect(translate('xx', 'side.trash')).toBe('Trash');
    expect(translate('en', 'no.such.key')).toBe('no.such.key');
    expect(translate('en', 'import.title', { i: 1 })).toBe('Import 1 / {n}'); // missing param stays visible
  });

  it('setLang switches t() and the Intl locale; unknown languages fall back to English', () => {
    setLang('en');
    expect([getLang(), t('side.all'), locale()]).toEqual(['en', 'All', 'en']);
    setLang('zh-CN');
    expect([t('side.all'), t('slot.n', { n: 2 })]).toEqual(['全部', '槽2']);
    setLang('fr');
    expect(getLang()).toBe('en');
  });

  it('numbers and dates follow the language (Intl)', () => {
    setLang('en');
    expect(formatInt(1234567)).toBe('1,234,567');
    expect(formatDate('2026-10-02T12:00:00Z')).toMatch(/^10\/0[23]\/2026$/);
    setLang('zh-TW');
    expect(formatDate('2026-10-02T12:00:00Z')).toMatch(/^2026\/10\/0[23]$/);
  });
});

// --- no Chinese literal outside the dictionaries ---------------------------

function sourceFiles() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (p !== path.join(ROOT, 'src/core/i18n')) walk(p);
      } else if (/\.(mjs|cjs|js|jsx|html)$/.test(e.name)) out.push(p);
    }
  };
  walk(path.join(ROOT, 'src'));
  walk(path.join(ROOT, 'electron'));
  return out;
}

// Drop comments (line, block, JSX) without touching strings; good enough for this codebase's style.
function stripComments(src) {
  const blank = (m) => m.replace(/[^\n]/g, ''); // keep line numbers
  return src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, blank)
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/<!--[\s\S]*?-->/g, blank)
    .split('\n')
    .map((line) => line.replace(/(^|[\s;,{}()])\/\/.*$/, '$1'))
    .join('\n');
}

describe('CJK-literal scanner', () => {
  it('finds no Chinese text in code outside src/core/i18n (lines marked i18n-ignore excepted)', () => {
    const hits = [];
    for (const file of sourceFiles()) {
      const raw = fs.readFileSync(file, 'utf8').split('\n');
      stripComments(raw.join('\n')).split('\n').forEach((line, i) => {
        if (/[一-鿿]/.test(line) && !raw[i]?.includes('i18n-ignore')) hits.push(`${path.relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it('the scanner itself catches a literal and ignores comments', () => {
    const lines = stripComments("const a = '紅'; // 紅\n/* 藍 */ const b = 1;\n{/* 綠 */}\n// 白").split('\n');
    expect(lines.filter((l) => /[一-鿿]/.test(l))).toEqual(["const a = '紅'; "]);
  });
});
