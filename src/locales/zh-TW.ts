/**
 * Traditional Chinese (Taiwan) strings.
 *
 * Keys are the zh-CN source strings exactly as they appear in src/. A key that
 * is missing here falls back to its zh-CN source, so this table may be partial
 * and a half-finished language never breaks the UI.
 *
 * Deliberately NOT translated, and deliberately absent from this table:
 *   - the CG prompt markers in src/index.ts:1076-1083, which parse prompts
 *     that earlier runs already wrote into the user's save file
 *   - SIDE_STORY_TOPIC_BLOCKLIST, which is a safety filter matched against
 *     fetched web text rather than display copy
 *   - ROSTER.system / ROSTER.affectionHigh, which nothing reads
 *
 * @module dsh-whale-galgame/locales/zh-TW
 */

export const zhTW: Readonly<Record<string, string>> = {
  // Empty on purpose: this change ships the mechanism, the strings follow.
}
