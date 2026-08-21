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
  // Nearly empty on purpose: this change ships the mechanism and the strings
  // follow. These few are here because a table with no entries makes every
  // test of the mechanism an identity test — translation, provenance and the
  // stored-vs-served split all pass trivially and prove nothing. Each one below
  // is reached by a test.
  '鲸鱼娘': '鯨魚娘',
  '那就继续聊聊吧': '那就繼續聊聊吧',
  '工作区主模型': '工作區主模型',
  '把角色来源切换为 ': '把角色來源切換為 ',
  ' 登场了。）': ' 登場了。）',
  '「主人，又见面啦～今天也想听你说话呢。」': '「主人，又見面啦～今天也想聽你說話喔。」',
  '温暖浪漫的日常氛围（旧版主题摘要已隐藏）': '溫暖浪漫的日常氛圍（舊版主題摘要已隱藏）',
  '找不到这场小剧场的记录': '找不到這場小劇場的紀錄',
  '生成被重启打断，请重新触发': '生成被重啟打斷，請重新觸發',
}
