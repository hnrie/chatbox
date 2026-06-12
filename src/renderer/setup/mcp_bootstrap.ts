import { getBuiltinServerConfig } from '@/packages/mcp/builtin'
import { mcpController } from '@/packages/mcp/controller'
import platform from '@/platform'
import { initSettingsStore } from '@/stores/settingsStore'
import { NODE_ENV } from '@/variables'

function monitorServerStatus() {
  setInterval(() => {
    console.debug(
      'MCP Servers:',
      JSON.stringify(
        Array.from(mcpController.servers.values()).map(({ config, instance: server }) => {
          return {
            id: config.id,
            name: config.name,
            status: server.status,
          }
        }),
        null,
        2
      )
    )
  }, 10000)
}

initSettingsStore()
  .then((settings) => {
    const { mcp, licenseKey } = settings
    const servers = [
      ...(mcp.enabledBuiltinServers || []).map((id) => getBuiltinServerConfig(id, licenseKey)).filter((s) => !!s),
      ...(mcp.servers || []), // user defined servers
    ].filter(
      // stdio servers run through the Electron main process; outside the
      // desktop app they can never start (e.g. settings imported from desktop).
      (server) => platform.type === 'desktop' || server.transport.type !== 'stdio'
    )
    console.info(`mcp bootstrap ${servers.length} servers, with license key: ${!!licenseKey}`)
    mcpController.bootstrap(servers)
    if (NODE_ENV === 'development') {
      monitorServerStatus()
    }
  })
  .catch((err) => {
    console.error('mcp bootstrap error', err)
  })
