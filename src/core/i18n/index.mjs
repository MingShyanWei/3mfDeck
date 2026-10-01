// M24 (SPEC 3.12): UI language. English is the primary language; Traditional
// and Simplified Chinese are full translations. Every user-facing string is a
// key looked up here (one flat dictionary per language). Shared by main,
// renderer and core; no network, no fourth language.
import en from './en.mjs';
import zhTW from './zh-TW.mjs';
import zhCN from './zh-CN.mjs';

export const LANGS = ['en', 'zh-TW', 'zh-CN'];
export const DEFAULT_LANG = 'en';
export const DICTS = { en, 'zh-TW': zhTW, 'zh-CN': zhCN };
/** Each language's own name, for the language picker. */
export const LANG_NAMES = { en: 'English', 'zh-TW': '繁體中文', 'zh-CN': '简体中文' };

/** The UI language for the system's preferred locales (first match wins; default English). */
export function pickLang(locales = []) {
  for (const raw of locales) {
    const l = String(raw).toLowerCase().replace('_', '-');
    if (/^zh-(hant|tw|hk|mo)/.test(l)) return 'zh-TW';
    if (/^zh(-|$)/.test(l)) return 'zh-CN'; // zh, zh-Hans, zh-CN, zh-SG
    if (/^en(-|$)/.test(l)) return 'en';
  }
  return DEFAULT_LANG;
}

const fill = (s, params) => (params ? s.replace(/\{(\w+)\}/g, (m, k) => (params[k] ?? m)) : s);

/** Look `key` up in `lang` (falls back to English, then to the key itself). */
export function translate(lang, key, params) {
  const s = DICTS[lang]?.[key] ?? en[key];
  return s === undefined ? key : fill(s, params);
}

// The current language of this process (main or renderer); core modules that
// produce user-facing text (warnings, errors, report rows) use it.
let current = DEFAULT_LANG;
export const setLang = (lang) => {
  current = LANGS.includes(lang) ? lang : DEFAULT_LANG;
};
export const getLang = () => current;
export const t = (key, params) => translate(current, key, params);
/** Intl locale for numbers and dates in the current language. */
export const locale = () => current;
