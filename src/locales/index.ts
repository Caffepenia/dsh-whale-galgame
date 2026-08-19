/**
 * Minimal string-table localisation for the plugin's two halves.
 *
 * The lookup key IS the zh-CN source string. That choice is deliberate:
 *   - a missing translation falls back to readable Chinese, never to a raw key
 *   - there is no key inventory to invent, review, or keep in sync
 *   - adding a language is one file, and a reviewer can diff a translation
 *     table straight against the source strings
 *
 * zh-CN therefore needs no table of its own: it is the key space, and the
 * plugin behaves exactly as before when no locale is selected.
 *
 * NOT every Chinese string in this codebase belongs here. Strings that
 * round-trip through a save file (the CG prompt markers in src/index.ts) or
 * that a model must echo back verbatim (JSON field names embedded in prompts)
 * are a wire format, not display text, and stay zh-CN in every locale.
 *
 * @module dsh-whale-galgame/locales
 */

import { zhTW } from './zh-TW.ts'

/** Locales the plugin can render. */
export const LOCALES = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko'] as const

export type Locale = (typeof LOCALES)[number]

/** Plugin `language` config values: an explicit locale, or follow the host. */
export type LanguageSetting = Locale | 'auto'

/**
 * Translation tables. zh-CN is absent on purpose (identity). A partial table is
 * fine and expected: every key it lacks falls through to the zh-CN source, so a
 * half-finished translation degrades one string at a time instead of breaking.
 */
const TABLES: Partial<Record<Locale, Readonly<Record<string, string>>>> = {
  'zh-TW': zhTW,
}

/**
 * DSH exposes only `zh` and `en` and collapses regional subtags (`zh-Hans-CN`
 * -> `zh`), so `auto` can never resolve to zh-TW. Traditional Chinese is
 * reachable by explicit choice only, which is why the plugin carries its own
 * language setting instead of just following the host.
 */
export function resolveLocale(setting: string | undefined, hostLocale: string | undefined): Locale {
  if (setting && setting !== 'auto' && (LOCALES as readonly string[]).includes(setting)) {
    return setting as Locale
  }
  return hostLocale === 'en' ? 'en' : 'zh-CN'
}

let current: Locale = 'zh-CN'

/** Set the active locale. An unknown value falls back to zh-CN rather than throwing. */
export function setLocale(locale: string | undefined): void {
  current = (LOCALES as readonly string[]).includes(String(locale)) ? (locale as Locale) : 'zh-CN'
}

export function getLocale(): Locale {
  return current
}

/** Translate one zh-CN source string into the active locale. */
export function t(source: string): string {
  const table = TABLES[current]
  const hit = table && table[source]
  return typeof hit === 'string' && hit ? hit : source
}
