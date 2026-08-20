/**
 * The plugin's host settings namespace.
 *
 * This exists so the plugin configuration card can render at all. The
 * `settings.plugin.item` slot is keyed, and the Settings → Plugins tab
 * dispatches it once per settings namespace the Host serves:
 *
 *   namespaces.map((ns) => renderSlot('settings.plugin.item', {}, { entryKey: ns }))
 *
 * so a card whose key is not a served namespace is never rendered. Registering
 * a namespace is what puts this plugin into that list.
 *
 * Only the DashScope block and the side-story recency window live here. Those
 * are the settings that exist ONLY as cordis entry config — everything else the
 * card edits (enabled, character, chat model, cooldown, seed source) is already
 * stored per user in the plugin's own save file and served over its own API, so
 * declaring it here as well would make this namespace a second writer for a
 * value that already has an owner.
 *
 * The API key is declared `role('secret')`: the settings service strips such
 * fields before the value crosses to the browser and reports only whether one
 * is set, so a key configured here is never shipped to the client. Until now
 * the only way to supply it was hand-writing it into cordis.patch.yml.
 *
 * IMPORTANT: src/index.ts must import this module DYNAMICALLY. The two
 * packages below are resolved from the Host's own module tree, and a dsh older
 * than 0.1.0-rc.7 does not have them — dsh profiles are created with
 * `autoInstallPeers: false`, so declaring them as peers does not put them
 * there either. A static import is resolved before any code runs, so it would
 * not degrade to "no card": it would fail the whole plugin at load with
 * ERR_MODULE_NOT_FOUND, taking the pet and the galgame tab with it. Imported
 * dynamically, the bundler emits this file as its own chunk and an older host
 * simply never loads it. test/settings-namespace.ts pins that.
 *
 * @module dsh-whale-galgame/settings
 */

import type { Context } from '@deepseek-ai/cordis'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { WHALE_SETTINGS_NS } from './settings-namespace.ts'

/** The entry-config values a user may edit at runtime. */
export interface WhaleHostSettings {
  dashscopeBaseUrl: string
  dashscopeApiKey: string
  dashscopeModel: string
  dashscopeSize: string
  sideStoryRecencyDays: number
}

export const WhaleHostSettings: z<WhaleHostSettings> = z.object({
  dashscopeBaseUrl: z.string().default('https://dashscope.aliyuncs.com'),
  dashscopeApiKey: z.string().role('secret').default(''),
  dashscopeModel: z.string().default('qwen-image-3.0'),
  dashscopeSize: z.string().default('1920*1080'),
  sideStoryRecencyDays: z.number().default(14),
})

/**
 * Wire the namespace so a saved change reaches the running plugin.
 *
 * `installSettingsSection` rides the scoped fiber, so a host with no settings
 * service — every dsh before 0.1.0-rc.7 — never runs any of this and the entry
 * configuration stands as composed. That is why there is no version check here.
 *
 * @param ctx - the plugin context owning the wiring.
 * @param resolved - the live config object the plugin reads on each request.
 */
export function installWhaleSettings(ctx: Context, resolved: WhaleHostSettings): void {
  const entry: WhaleHostSettings = {
    dashscopeBaseUrl: resolved.dashscopeBaseUrl,
    dashscopeApiKey: resolved.dashscopeApiKey,
    dashscopeModel: resolved.dashscopeModel,
    dashscopeSize: resolved.dashscopeSize,
    sideStoryRecencyDays: resolved.sideStoryRecencyDays,
  }
  let source = (): WhaleHostSettings => entry
  // Called on the plugin's OWN context, not on a settings-scoped one. The
  // helper already injects `settings` itself, so a host without the service
  // never runs any of it; and it compares `isUnloading(ctx)` against the
  // context handed to it, so passing the settings scope would make its
  // teardown mistake "the provider went away" for "the plugin is unloading"
  // and leave the last user-layer values — the API key among them — in place
  // instead of falling back to the composition entry.
  installSettingsSection(ctx, settingsNamespace(WHALE_SETTINGS_NS), WhaleHostSettings, entry, {
    setSource: (current) => { source = current },
    // Assign only what this namespace owns. Writing back a field the plugin
    // stores in its save file is how a setting loses its memory.
    onChange: () => {
      const next = source()
      resolved.dashscopeBaseUrl = next.dashscopeBaseUrl
      resolved.dashscopeApiKey = next.dashscopeApiKey
      resolved.dashscopeModel = next.dashscopeModel
      resolved.dashscopeSize = next.dashscopeSize
      resolved.sideStoryRecencyDays = next.sideStoryRecencyDays
    },
  })
}
