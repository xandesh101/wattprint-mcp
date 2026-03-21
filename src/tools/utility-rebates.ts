import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

// Common utility rebate patterns by state — updated manually for V1
// In V2, this will be replaced with live web search via Claude
const STATE_UTILITY_REBATES: Record<string, Array<{ program: string; amount: string; upgrade_types: string[] }>> = {
  CA: [
    { program: 'TECH Clean California Heat Pump Rebate', amount: 'Up to $3,000', upgrade_types: ['heat_pump_hvac'] },
    { program: 'Self-Generation Incentive Program (SGIP)', amount: 'Up to $1,000/kWh battery', upgrade_types: ['solar_plus_battery'] },
    { program: 'CHEERS EV Charger Rebate', amount: 'Up to $500', upgrade_types: ['ev_charger'] },
  ],
  TX: [
    { program: 'Austin Energy Value of Solar Tariff', amount: '~$0.097/kWh exported', upgrade_types: ['solar_5kw', 'solar_10kw'] },
    { program: 'CPS Energy Solar Rebate', amount: 'Up to $2,500', upgrade_types: ['solar_5kw', 'solar_10kw'] },
    { program: 'Oncor Home Energy Efficiency Program', amount: 'Up to $200', upgrade_types: ['insulation'] },
  ],
  NY: [
    { program: 'NY-Sun Megawatt Block Solar Incentive', amount: 'Varies by utility territory', upgrade_types: ['solar_5kw', 'solar_10kw'] },
    { program: 'Con Edison Heat Pump Rebate', amount: 'Up to $1,750', upgrade_types: ['heat_pump_hvac'] },
    { program: 'NYSERDA EmPower+ Heat Pump Water Heater', amount: 'Up to $750', upgrade_types: ['heat_pump_water_heater'] },
  ],
  FL: [
    { program: 'Duke Energy Solar Rebate', amount: 'Up to $0.05/kWh production', upgrade_types: ['solar_5kw', 'solar_10kw'] },
    { program: 'FPL On-Bill Financing for Heat Pumps', amount: '0% financing up to $15,000', upgrade_types: ['heat_pump_hvac'] },
  ],
  CO: [
    { program: 'Xcel Energy Solar*Rewards', amount: '$0.02/kWh for 10 years', upgrade_types: ['solar_5kw', 'solar_10kw'] },
    { program: 'Xcel Energy Heat Pump Rebate', amount: 'Up to $1,000', upgrade_types: ['heat_pump_hvac'] },
    { program: 'Colorado HPWH Rebate', amount: 'Up to $800', upgrade_types: ['heat_pump_water_heater'] },
  ],
  WA: [
    { program: 'PSE Home Energy Upgrade Solar Rebate', amount: 'Up to $2,000', upgrade_types: ['solar_5kw', 'solar_10kw'] },
    { program: 'Washington Clean Buildings Heat Pump Incentive', amount: 'Up to $1,200', upgrade_types: ['heat_pump_hvac'] },
  ],
  MA: [
    { program: 'Mass Save Heat Pump Rebate', amount: 'Up to $10,000', upgrade_types: ['heat_pump_hvac'] },
    { program: 'Mass Save Heat Pump Water Heater', amount: 'Up to $750', upgrade_types: ['heat_pump_water_heater'] },
    { program: 'SMART Solar Program', amount: 'Fixed monthly payment per kWh', upgrade_types: ['solar_5kw', 'solar_10kw'] },
  ],
}

export function registerUtilityRebatesTool(server: McpServer) {
  server.tool(
    'search_utility_rebates',
    'Returns available utility and state rebate programs for the property location. Call this once after get_incentives.',
    {
      state: z.string().describe('2-letter US state abbreviation e.g. "TX"'),
      utility_name: z.string().describe('Name of the utility company serving the property'),
      upgrade_types: z.string().describe('Comma-separated list of upgrade types that were simulated'),
    },
    async ({ state, utility_name, upgrade_types }) => {
      const upgrades = upgrade_types.split(',').map(u => u.trim())
      const stateRebates = STATE_UTILITY_REBATES[state.toUpperCase()] ?? []

      const matching = stateRebates.filter(rebate =>
        rebate.upgrade_types.some(ut => upgrades.includes(ut))
      )

      const result = {
        state,
        utility_name,
        rebates: matching,
        note: matching.length === 0
          ? `Check ${utility_name}'s website directly for current rebate programs in your area.`
          : `Verify current amounts at ${utility_name}'s website — rebates change frequently.`,
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      }
    }
  )
}
