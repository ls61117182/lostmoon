/**
 * 运行时本地化入口。
 *
 * 使用方法：
 *   import { t, setLang } from '../core/Lang';
 *   label.string = t('btn.nextPhase');
 *   label.string = t('hud.movePhase', { n: 3, dice: '[2,5]' });
 *
 * 设计约定：
 *   - 文案都在 data/lang.csv 里维护；LangDB.ts 是自动生成产物（见 tools/buildLangDB.js）
 *   - 默认语言 = 中文，调用 setLang('en') 切换到英文
 *   - 占位符用 {name} 形式，传 params = { name: value } 替换
 *   - 值里的字面量 \n（反斜杠 + n）会被展开成真正的换行，方便 CSV 里写多行文案
 *   - 找不到 key 会打 warn 并返回 key 本身，不会抛异常；缺漏文案一眼可见
 */

import { LANG_DB, LangEntry } from './LangDB';

export type LangCode = 'zh' | 'en';

let currentLang: LangCode = 'zh';

export function setLang(lang: LangCode): void {
  currentLang = lang;
}

export function getLang(): LangCode {
  return currentLang;
}

/** 取文案，支持 {name} 占位符替换。找不到 key 时返回 key 本身 + console.warn。 */
export function t(key: string, params?: Record<string, string | number>): string {
  const row: LangEntry | undefined = LANG_DB[key];
  let s: string;
  if (!row) {
    console.warn(`[Lang] missing key: ${key}`);
    s = key;
  } else {
    s = row[currentLang] ?? row.zh ?? key;
  }
  // CSV 里写的 "\n"（两个字符）在这里展开成真正的换行
  if (s.indexOf('\\n') >= 0) {
    s = s.replace(/\\n/g, '\n');
  }
  if (params) {
    for (const k of Object.keys(params)) {
      const token = '{' + k + '}';
      if (s.indexOf(token) >= 0) {
        s = s.split(token).join(String(params[k]));
      }
    }
  }
  return s;
}
