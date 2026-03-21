import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

const BaselineSchema = z.object({
  annual_consumption_kwh: z.number(),
  annual_cost_usd: z.number(),
  has_fossil_fuel_heating: z.boolean(),
  has_gas: z.boolean(),
  breakdown_pct: z.object({
    hvac: z.number(),
    water_heater: z.number(),
    plug_loads: z.number(),
    lighting: z.number(),
    cooking: z.number(),
  }),
})

export type UpgradeType =
  | 'solar_5kw'
  | 'solar_10kw'
  | 'heat_pump_hvac'
  | 'heat_pump_water_heater'
  | 'solar_plus_battery'
  | 'insulation'
  | 'ev_charger'

export interface RelevantUpgrade {
  upgrade_type: UpgradeType
  reason: string
  priority: 'high' | 'medium' | 'low'
}

export function registerRelevantUpgradesTool(server: McpServer) {
  server.tool(
    'get_relevant_upgrades',
    'Analyzes baseline energy data and returns a filtered list of relevant upgrades for this specific home. Call this after get_home_baseline and before running any scenarios — it prevents wasting API calls on irrelevant upgrades.',
    {
      baseline_json: z.string().describe('JSON string of the baseline result from get_home_baseline'),
    },
    async ({ baseline_json }) => {
      const baseline = BaselineSchema.parse(JSON.parse(baseline_json))
      const upgrades: RelevantUpgrade[] = []

      // Solar is almost always relevant unless very low consumption
      if (baseline.annual_consumption_kwh > 3000) {
        upgrades.push({
          upgrade_type: baseline.annual_consumption_kwh > 10000 ? 'solar_10kw' : 'solar_5kw',
          reason: `Home uses ${baseline.annual_consumption_kwh.toLocaleString()} kWh/year — solar has strong ROI`,
          priority: 'high',
        })
      }

      // Heat pump HVAC: high priority if gas heating or HVAC is large % of bill
      if (baseline.has_fossil_fuel_heating || baseline.breakdown_pct.hvac > 35) {
        upgrades.push({
          upgrade_type: 'heat_pump_hvac',
          reason: baseline.has_fossil_fuel_heating
            ? 'Home uses fossil fuel heating — heat pump eliminates gas dependency'
            : `HVAC is ${baseline.breakdown_pct.hvac}% of electricity use — heat pump improves efficiency`,
          priority: baseline.has_fossil_fuel_heating ? 'high' : 'medium',
        })
      }

      // Heat pump water heater: relevant if gas water heater or high water heating %
      if (baseline.has_gas || baseline.breakdown_pct.water_heater > 15) {
        upgrades.push({
          upgrade_type: 'heat_pump_water_heater',
          reason: baseline.has_gas
            ? 'Gas water heater — heat pump water heater reduces gas costs by ~70%'
            : `Water heating is ${baseline.breakdown_pct.water_heater}% of usage`,
          priority: 'medium',
        })
      }

      // Solar + battery: relevant if already recommending solar and high consumption
      if (baseline.annual_consumption_kwh > 8000) {
        upgrades.push({
          upgrade_type: 'solar_plus_battery',
          reason: 'High consumption home — battery storage maximizes solar self-consumption and adds resilience',
          priority: 'medium',
        })
      }

      // Insulation: relevant if high HVAC usage
      if (baseline.breakdown_pct.hvac > 40) {
        upgrades.push({
          upgrade_type: 'insulation',
          reason: `HVAC is ${baseline.breakdown_pct.hvac}% of usage — improved insulation reduces heating/cooling load`,
          priority: 'low',
        })
      }

      // Cap at 5 upgrades, sorted by priority
      const priorityOrder = { high: 0, medium: 1, low: 2 }
      const sorted = upgrades
        .sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])
        .slice(0, 5)

      return {
        content: [{ type: 'text', text: JSON.stringify({ upgrades: sorted }) }],
      }
    }
  )
}
