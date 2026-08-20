/**
 * The settings namespace this plugin serves.
 *
 * It lives alone in a module with no imports because BOTH halves need it and
 * they cannot share anything heavier: the Host half passes it through
 * `settingsNamespace()` from a Host-only package, and the browser bundle
 * cannot resolve that package at all. The string is load-bearing — the
 * Settings → Plugins tab renders the intersection of served namespaces and
 * registered cards, so if the two halves ever disagreed the card would simply
 * stop appearing, with nothing logged.
 *
 * @module dsh-whale-galgame/settings-namespace
 */

export const WHALE_SETTINGS_NS = 'dsh-whale-galgame'
