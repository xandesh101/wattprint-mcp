import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { UpgradeType } from './relevant-upgrades.js'
import { callPalmetto, scenarioPayload } from '../utils/palmetto.js'

// Upgrade cost estimates (USD) — industry averages
const UPGRADE_COSTS: Record<UpgradeType, number> = {
  solar_5kw: 15000,
  solar_10kw: 28000,
  heat_pump_hvac: 12000,
  heat_pump_water_heater: 1500,
  solar_plus_battery: 34000,
  insulation: 3500,
  ev_charger: 1200,
}

// Build Palmetto scenario params per upgrade type
function buildScenarioParams(upgradeType: UpgradeType): {
  hypothetical: Record<string, unknown>
  production?: Record<string, unknown>
} {
  switch (upgradeType) {
    case 'solar_5kw':
      return { hypothetical: {}, production: { panel_arrays: [{ capacity: 5, tilt: 20, azimuth: 180 }] } }
    case 'solar_10kw':
      return { hypothetical: {}, production: { panel_arrays: [{ capacity: 10, tilt: 20, azimuth: 180 }] } }
    case 'solar_plus_battery':
      return { hypothetical: {}, production: { panel_arrays: [{ capacity: 8, tilt: 20, azimuth: 180 }] } }
    case 'heat_pump_hvac':
      return { hypothetical: { hvac_heat_pump: true, hvac_heating_efficiency: 3.5 } }
    case 'heat_pump_water_heater':
      return { hypothetical: { water_heater_type: 'heat_pump' } }
    case 'insulation':
      return { hypothetical: { ceiling_insulation: 49, wall_insulation: 19 } }
    case 'ev_charger':
      // Handled separately — API models added consumption, not vs-public-charging savings
      return { hypothetical: {} }
  }
}

// EV charger: savings are vs public charging ($0.35/kWh), not vs baseline home usage
// The API would show higher home costs (new load added), so we keep the formula here
function calcEvChargerSavings(electricityRate: number): { annualSavingsUsd: number; carbonReductionKg: number } {
  const evKwhPerYear = 15000 / 3.5
  const annualSavingsUsd = Math.round(evKwhPerYear * Math.max(0.35 - electricityRate, 0.08))
  return { annualSavingsUsd, carbonReductionKg: 0 }
}

export function registerScenarioTool(server: McpServer) {
  server.tool(
    'run_upgrade_scenario',
    'Models annual savings, ROI, and payback for a specific upgrade using Palmetto EI scenario API. Calls Palmetto with hypothetical building attributes and diffs against baseline costs. Call once per upgrade returned by get_relevant_upgrades.',
    {
      upgrade_type: z.enum([
        'solar_5kw', 'solar_10kw', 'heat_pump_hvac', 'heat_pump_water_heater',
        'solar_plus_battery', 'insulation', 'ev_charger',
      ]).describe('Upgrade type to simulate'),
      address: z.string().describe('Full property address — same address used in get_home_baseline'),
      annual_cost_electricity_usd: z.number().describe('From baseline: annual_cost_electricity_usd'),
      annual_cost_gas_usd: z.number().describe('From baseline: annual_cost_gas_usd'),
      annual_emissions_kg: z.number().describe('From baseline: annual_emissions_kg_co2'),
      electricity_rate_per_kwh: z.number().describe('From baseline: electricity_rate_per_kwh'),
    },
    async ({ upgrade_type, address, annual_cost_electricity_usd, annual_cost_gas_usd, annual_emissions_kg, electricity_rate_per_kwh }) => {
      const upfrontCost = UPGRADE_COSTS[upgrade_type as UpgradeType]

      // EV charger: keep formula
      if (upgrade_type === 'ev_charger') {
        const { annualSavingsUsd, carbonReductionKg } = calcEvChargerSavings(electricity_rate_per_kwh)
        const paybackYears = annualSavingsUsd > 0 ? +(upfrontCost / annualSavingsUsd).toFixed(1) : null
        const roi10yr = annualSavingsUsd > 0
          ? +(((annualSavingsUsd * 10 - upfrontCost) / upfrontCost) * 100).toFixed(1)
          : null
        return {
          content: [{ type: 'text', text: JSON.stringify({
            upgrade_type,
            upfront_cost_usd: upfrontCost,
            annual_savings_usd: annualSavingsUsd,
            payback_years: paybackYears,
            roi_10yr_pct: roi10yr,
            carbon_reduction_kg_co2: carbonReductionKg,
            data_source: 'formula',
          }) }],
        }
      }

      // All other upgrades: call Palmetto scenario API
      const { hypothetical, production } = buildScenarioParams(upgrade_type as UpgradeType)
      const payload = scenarioPayload(address, hypothetical, production)
      const intervals = await callPalmetto(payload)

      if (!intervals || intervals.length === 0) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'No scenario data returned from Palmetto API' }) }],
        }
      }

      const row = intervals[0]

      const scenarioCostElec = Number(row['costs.electricity'] || 0)
      const scenarioCostGas = Number(row['costs.fossil_fuel'] || 0)
      const scenarioEmissions = Number(row['emissions.electricity'] || 0) + Number(row['emissions.fossil_fuel'] || 0)

      const baselineCostTotal = annual_cost_electricity_usd + annual_cost_gas_usd
      const scenarioCostTotal = scenarioCostElec + scenarioCostGas

      const annualSavingsUsd = Math.round(baselineCostTotal - scenarioCostTotal)
      const carbonReductionKg = Math.round(annual_emissions_kg - scenarioEmissions)

      const paybackYears = annualSavingsUsd > 0 ? +(upfrontCost / annualSavingsUsd).toFixed(1) : null
      const roi10yr = annualSavingsUsd > 0
        ? +(((annualSavingsUsd * 10 - upfrontCost) / upfrontCost) * 100).toFixed(1)
        : null

      return {
        content: [{ type: 'text', text: JSON.stringify({
          upgrade_type,
          upfront_cost_usd: upfrontCost,
          annual_savings_usd: annualSavingsUsd,
          payback_years: paybackYears,
          roi_10yr_pct: roi10yr,
          carbon_reduction_kg_co2: carbonReductionKg,
          data_source: 'palmetto_api',
        }) }],
      }
    }
  )
}
