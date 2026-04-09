import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { UpgradeType } from './relevant-upgrades.js'
import { callPalmetto, scenarioPayload } from '../utils/palmetto.js'

// Upgrade cost estimates (USD) — national averages
// Sources: EnergySage, NREL, HomeAdvisor 2024 data
const UPGRADE_COSTS: Record<UpgradeType, number> = {
  solar_5kw: 15000,
  solar_10kw: 28000,
  heat_pump_hvac: 12000,
  heat_pump_water_heater: 1500,
  solar_plus_battery: 34000,
  insulation: 3500,
  ev_charger: 1200,
}

// State-level cost adjustment factors relative to national average.
// Reflects regional labor rates, permitting costs, and market competition.
// Sources: NREL State Solar Scorecard, BLS regional wage data, EnergySage regional reports.
const STATE_COST_FACTORS: Record<string, number> = {
  HI: 1.40, AK: 1.30,
  NY: 1.22, MA: 1.20, CT: 1.18, NJ: 1.18, DC: 1.12,
  CA: 1.15, WA: 1.08, OR: 1.05,
  MD: 1.04, IL: 1.02, PA: 1.00, MN: 1.00,
  OH: 0.98, MI: 0.98, WI: 0.98, CO: 0.98,
  VA: 0.96, MT: 0.96, WY: 0.96, ND: 0.97, SD: 0.97, IA: 0.96,
  NE: 0.96, ID: 0.94, UT: 0.95, NV: 0.95, IN: 0.95, KS: 0.95,
  MO: 0.95, FL: 0.95, NM: 0.93, GA: 0.93, NC: 0.93,
  SC: 0.92, TN: 0.92, TX: 0.92, AZ: 0.91,
  KY: 0.92, AL: 0.90, MS: 0.90, WV: 0.90, AR: 0.90, OK: 0.90,
  LA: 0.88,
}

function extractState(address: string): string | null {
  const match = address.match(/[,\s]+([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?[,\s]*$/i)
  return match ? match[1].toUpperCase() : null
}

function adjustedCost(base: number, state: string | null): number {
  const factor = (state && STATE_COST_FACTORS[state]) ? STATE_COST_FACTORS[state] : 1.00
  return Math.round(base * factor)
}

// Build Palmetto scenario params per upgrade type
function buildScenarioParams(upgradeType: UpgradeType): {
  hypothetical: Record<string, unknown>
  production?: Record<string, unknown>
} {
  switch (upgradeType) {
    case 'solar_5kw':
      // pv_arrays confirmed working in debug endpoint (panel_arrays was silently ignored)
      return { hypothetical: {}, production: { pv_arrays: [{ capacity: 5, tilt: 20, azimuth: 180 }] } }
    case 'solar_10kw':
      return { hypothetical: {}, production: { pv_arrays: [{ capacity: 10, tilt: 20, azimuth: 180 }] } }
    case 'solar_plus_battery':
      return { hypothetical: {}, production: { pv_arrays: [{ capacity: 8, tilt: 20, azimuth: 180 }] } }
    case 'heat_pump_hvac':
      // heating_fuel + heat_pump + heat_pump_cop confirmed working in debug endpoint
      return { hypothetical: { heating_fuel: 'Electric', heat_pump: true, heat_pump_cop: 3.2 } }
    case 'heat_pump_water_heater':
      // Following Palmetto naming pattern from confirmed heat pump HVAC params
      return { hypothetical: { water_heater_fuel: 'Electric', water_heater_heat_pump: true } }
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
      const state = extractState(address)
      const upfrontCost = adjustedCost(UPGRADE_COSTS[upgrade_type as UpgradeType], state)
      const regionFactor = (state && STATE_COST_FACTORS[state]) ? STATE_COST_FACTORS[state] : 1.00

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
            region_cost_factor: regionFactor,
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

      // DEBUG: log raw scenario response so we can see what fields Palmetto returns
      console.log(`[scenario:${upgrade_type}] raw response keys:`, Object.keys(row))
      console.log(`[scenario:${upgrade_type}] costs.electricity:`, row['costs.electricity'])
      console.log(`[scenario:${upgrade_type}] costs.fossil_fuel:`, row['costs.fossil_fuel'])
      console.log(`[scenario:${upgrade_type}] production.electricity:`, row['production.electricity'])
      console.log(`[scenario:${upgrade_type}] payload sent:`, JSON.stringify(payload))

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
          region_cost_factor: regionFactor,
          data_source: 'palmetto_api',
        }) }],
      }
    }
  )
}
