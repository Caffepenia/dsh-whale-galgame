import { clientBundle } from './build/tsdown.client.ts'

export default clientBundle('dsh-whale-galgame', ['src/index.ts'], {
  portableCssModuleIds: true,
  // Host-provided peer APIs, resolved at runtime from the dsh profile tree
  // rather than from this repo's install, exactly like @deepseek-ai/cordis.
  libExternal: ['@deepseek-ai/dsh-settings', '@deepseek-ai/schemastery'],
})
