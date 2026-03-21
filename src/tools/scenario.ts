import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { UpgradeType } from './relevant-upgrades.js'

// Upgrade cost estimates (USD) — industry averages
const UPGRADE_COSTS: Record<UpgradeType, number> = {
  solar_5kw: 15000,
  solar_10kw: 28000,
  heat_pump_hvac: 12000,
  heat_pump_water_heater: 1500,
  solar_plus_battery: 24000,
  insulation: 3500,
  ev_charger: 1200,
}

// Average peak sun hours by US region (used for solar yield estimates)
// TX/South: ~5.3h, Northeast: ~4.2h, Northwest: ~4.0h, Southwest: ~6.0h
// We default to 5.0 as a conservative national average
const PEAK_SUN_HOURS = 5.0
const PANEL_EFFICIENCY = 0.78 // accounts for inverter losses, shading, degradation

// Emissions factor: kg CO2 per kWh (US average grid)
const EMISSIONS_KG_PER_KWH = 0.386

function calcSavings(upgradeType: UpgradeType, inputs: {
  annualConsumptionKwh: number
  annualHeatingKwh: number
  annualCoolingKwh: number
  annualHotWaterKwh: number
  electricityRate: number
  annualGasCostUsd: number
  annualEmissionsKg: number
}): { annualSavingsUsd: number; carbonReductionKg: number } {
  const {
    annualConsumptionKwh, annualHeatingKwh, annualCoolingKwh,
    annualHotWaterKwh, electricityRate, annualGasCostUsd, annualEmissionsKg,
  } = inputs

  let annualSavingsUsd = 0
  let carbonReductionKg = 0

  switch (upgradeType) {
    case 'solar_5kw': {
      const generated = Math.min(5 * PEAK_SUN_HOURS * 365 * PANEL_EFFICIENCY, annualConsumptionKwh)
      annualSavingsUsd = generated * electricityRate
      carbonReductionKg = generated * EMISSIONS_KG_PER_KWH
      break
    }
    case 'solar_10kw': {
      const generated = Math.min(10 * PEAK_SUN_HOURS * 365 * PANEL_EFFICIENCY, annualConsumptionKwh)
      annualSavingsUsd = generated * electricityRate
      carbonReductionKg = generated * EMISSIONS_KG_PER_KWH
      break
    }
    case 'solar_plus_battery': {
      // 8kW system + battery increases self-consumption by ~15%
      const generated = Math.min(8 * PEAK_SUN_HOURS * 365 * PANEL_EFFICIENCY * 1.15, annualConsumptionKwh)
      annualSavingsUsd = generated * electricityRate
      carbonReductionKg = generated * EMISSIONS_KG_PER_KWH
      break
    }
    case 'heat_pump_hvac': {
      // Heat pump COP ~3.5 vs electric resistance COP 1.0 — 71% heating reduction
      // Also 20% more efficient cooling (SEER 18 vs typical 14)
      const heatingSavingsKwh = annualHeatingKwh * (1 - 1 / 3.5)
      const coolingSavingsKwh = annualCoolingKwh * 0.20
      annualSavingsUsd = (heatingSavingsKwh + coolingSavingsKwh) * electricityRate + annualGasCostUsd * 0.6
      carbonReductionKg = (heatingSavingsKwh + coolingSavingsKwh) * EMISSIONS_KG_PER_KWH + annualEmissionsKg * 0.02
      break
    }
    case 'heat_pump_water_heater': {
      // Heat pump WH COP ~2.8 vs electric resistance COP ~0.95 — 66% reduction
      const savingsKwh = annualHotWaterKwh > 0
        ? annualHotWaterKwh * (1 - 0.95 / 2.8)
        : annualConsumptionKwh * 0.12 * (1 - 0.95 / 2.8) // fallback: 12% of consumption
      annualSavingsUsd = savingsKwh * electricityRate + annualGasCostUsd * 0.3
      carbonReductionKg = savingsKwh * EMISSIONS_KG_PER_KWH
      break
    }
    case 'insulation': {
      // Improved insulation reduces heating + cooling load by ~20%
      const savedKwh = (annualHeatingKwh + annualCoolingKwh) * 0.20
      annualSavingsUsd = savedKwh * electricityRate
      carbonReductionKg = savedKwh * EMISSIONS_KG_PER_KWH
      break
    }
    case 'ev_charger': {
      // EV charger doesn't reduce home energy — but saves vs public charging
      // Assume 15,000 mi/yr, 3.5 mi/kWh, public charging at $0.35/kWh vs home at electricityRate
      const evKwhPerYear = 15000 / 3.5
      annualSavingsUsd = evKwhPerYear * Math.max(0.35 - electricityRate, 0.08)
      carbonReductionKg = 0 // EV savings are vehicle-level, not home-level
      break
    }
  }

  return {
    annualSavingsUsd: Math.round(annualSavingsUsd),
    carbonReductionKg: Math.round(carbonReductionKg),
  }
}

export function registerScenarioTool(server: McpServer) {
  server.tool(
    'run_upgrade_scenario',
    'Calculates estimated annual savings, ROI, and payback period for a specific upgrade using baseline energy data. Call once per upgrade returned by get_relevant_upgrades.',
    {
      upgrade_type: z.enum([
        'solar_5kw', 'solar_10kw', 'heat_pump_hvac', 'heat_pump_water_heater',
        'solar_plus_battery', 'insulation', 'ev_charger',
      ]).describe('Upgrade type to simulate'),
      annual_consumption_kwh: z.number().describe('From baseline: annual_consumption_kwh'),
      annual_heating_kwh: z.number().describe('From baseline: annual_heating_kwh'),
      annual_cooling_kwh: z.number().describe('From baseline: annual_cooling_kwh'),
      annual_hot_water_kwh: z.number().describe('From baseline: annual_hot_water_kwh'),
      electricity_rate_per_kwh: z.number().describe('From baseline: electricity_rate_per_kwh'),
      annual_gas_cost_usd: z.number().describe('From baseline: annual_cost_gas_usd'),
      annual_emissions_kg: z.number().describe('From baseline: annual_emissions_kg_co2'),
    },
    async ({ upgrade_type, annual_consumption_kwh, annual_heating_kwh, annual_cooling_kwh,
             annual_hot_water_kwh, electricity_rate_per_kwh, annual_gas_cost_usd, annual_emissions_kg }) => {

      const { annualSavingsUsd, carbonReductionKg } = calcSavings(upgrade_type as UpgradeType, {
        annualConsumptionKwh: annual_consumption_kwh,
        annualHeatingKwh: annual_heating_kwh,
        annualCoolingKwh: annual_cooling_kwh,
        annualHotWaterKwh: annual_hot_water_kwh,
        electricityRate: electricity_rate_per_kwh,
        annualGasCostUsd: annual_gas_cost_usd,
        annualEmissionsKg: annual_emissions_kg,
      })

      const upfrontCost = UPGRADE_COSTS[upgrade_type as UpgradeType]
      const paybackYears = annualSavingsUsd > 0 ? +(upfrontCost / annualSavingsUsd).toFixed(1) : null
      const roi10yr = annualSavingsUsd > 0
        ? +(((annualSavingsUsd * 10 - upfrontCost) / upfrontCost) * 100).toFixed(1)
        : null

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            upgrade_type,
            upfront_cost_usd: upfrontCost,
            annual_savings_usd: annualSavingsUsd,
            payback_years: paybackYears,
            roi_10yr_pct: roi10yr,
            carbon_reduction_kg_co2: carbonReductionKg,
          }),
        }],
      }
    }
  )
}
