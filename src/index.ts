import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'

import { registerBaselineTool } from './tools/baseline.js'
import { registerRelevantUpgradesTool } from './tools/relevant-upgrades.js'
import { registerScenarioTool } from './tools/scenario.js'
import { registerIncentivesTool } from './tools/incentives.js'
import { registerUtilityRebatesTool } from './tools/utility-rebates.js'

const PORT = Number(process.env.PORT ?? 3001)

// Create and configure MCP server
const mcpServer = new McpServer({
  name: 'wattprint-mcp',
  version: '1.0.0',
})

registerBaselineTool(mcpServer)
registerRelevantUpgradesTool(mcpServer)
registerScenarioTool(mcpServer)
registerIncentivesTool(mcpServer)
registerUtilityRebatesTool(mcpServer)

// Express app for HTTP/SSE transport
const app = express()
app.use(cors())
app.use(express.json())

// Track active SSE transports
const transports = new Map<string, SSEServerTransport>()

// SSE endpoint — clients connect here to start a session
app.get('/sse', async (req, res) => {
  const transport = new SSEServerTransport('/messages', res)
  transports.set(transport.sessionId, transport)

  res.on('close', () => {
    transports.delete(transport.sessionId)
  })

  await mcpServer.connect(transport)
})

// Message endpoint — clients post tool calls here
app.post('/messages', async (req, res) => {
  const sessionId = req.query.sessionId as string
  const transport = transports.get(sessionId)

  if (!transport) {
    res.status(404).json({ error: 'Session not found' })
    return
  }

  await transport.handlePostMessage(req, res, req.body)
})

// Debug: dump raw Palmetto intervals for field discovery
app.get('/debug-palmetto', async (_req, res) => {
  const { callPalmetto, baselinePayload, scenarioPayload } = await import('./utils/palmetto.js')
  const address = '3032 Maryanne Lane, Pflugerville, TX 78660'

  // Baseline (year grouped)
  const baseIntervals = await callPalmetto(baselinePayload(address, 'year'))
  const base = baseIntervals[0] ?? {}

  // Solar 10kW scenario
  const solarPayload = scenarioPayload(address, {}, { pv_arrays: [{ tilt: 20, azimuth: 180, capacity: 10.0 }] })
  const solarIntervals = await callPalmetto(solarPayload)
  const solar = solarIntervals[0] ?? {}

  // Heat pump scenario
  const hpPayload = scenarioPayload(address, { heating_fuel: 'Electric', heat_pump: true, heat_pump_cop: 3.2 })
  const hpIntervals = await callPalmetto(hpPayload)
  const hp = hpIntervals[0] ?? {}

  res.json({
    baseline: { costs_elec: base['costs.electricity'], costs_gas: base['costs.fossil_fuel'], costs_total: base['costs'], all_keys: Object.keys(base) },
    solar_10kw: { costs_elec: solar['costs.electricity'], costs_gas: solar['costs.fossil_fuel'], costs_total: solar['costs'], savings: Number(base['costs.electricity'] ?? 0) + Number(base['costs.fossil_fuel'] ?? 0) - Number(solar['costs.electricity'] ?? 0) - Number(solar['costs.fossil_fuel'] ?? 0) },
    heat_pump: { costs_elec: hp['costs.electricity'], costs_gas: hp['costs.fossil_fuel'], costs_total: hp['costs'], savings: Number(base['costs.electricity'] ?? 0) + Number(base['costs.fossil_fuel'] ?? 0) - Number(hp['costs.electricity'] ?? 0) - Number(hp['costs.fossil_fuel'] ?? 0) },
  })
})

// Health check
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    tools: 5,
    server: 'wattprint-mcp',
    palmetto_key_loaded: !!process.env.PALMETTO_API_KEY,
    palmetto_key_prefix: process.env.PALMETTO_API_KEY?.slice(0, 6) ?? 'MISSING',
  })
})

app.listen(PORT, () => {
  console.log(`Wattprint MCP server running on http://localhost:${PORT}`)
  console.log(`SSE endpoint: http://localhost:${PORT}/sse`)
  console.log(`Health check: http://localhost:${PORT}/health`)
})
