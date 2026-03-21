import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { callPalmetto, baselinePayload, sumVariable, monthlyValues } from '../utils/palmetto.js'

export function registerBaselineTool(server: McpServer) {
  server.tool(
    'get_home_baseline',
    'Fetches the current energy profile for a home address using the Palmetto EI API. ALWAYS call this first before any other tool.',
    { address: z.string().describe('Full property address e.g. "123 Main St, Austin TX 78701"') },
    async ({ address }) => {
      const intervals = await callPalmetto(baselinePayload(address, 'month'))

      if (!intervals || intervals.length === 0) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'No data returned for this address' }) }],
        }
      }

      // Annual totals
      const annualElecKwh = sumVariable(intervals, 'consumption.electricity')
      const annualCostElec = sumVariable(intervals, 'costs.electricity')
      const annualCostGas = sumVariable(intervals, 'costs.fossil_fuel')
      const annualCostTotal = annualCostElec + annualCostGas
      const annualEmissionsElec = sumVariable(intervals, 'emissions.electricity')
      const annualEmissionsGas = sumVariable(intervals, 'emissions.fossil_fuel')

      // Monthly cost breakdown (for chart)
      const monthlyElecCost = monthlyValues(intervals, 'costs.electricity')
      const monthlyGasCost = monthlyValues(intervals, 'costs.fossil_fuel')
      const monthlyCostTotal = monthlyElecCost.map((v, i) => +(v + monthlyGasCost[i]).toFixed(2))

      // End-use breakdown as percentages of total electricity
      const hvac = sumVariable(intervals, 'consumption.electricity.heating')
        + sumVariable(intervals, 'consumption.electricity.cooling')
      const waterHeater = sumVariable(intervals, 'consumption.electricity.hot_water')
      const plugLoads = sumVariable(intervals, 'consumption.electricity.plug_loads')
      const lighting = sumVariable(intervals, 'consumption.electricity.lighting')
      const cooking = sumVariable(intervals, 'consumption.electricity.cooking_range')

      const pct = (v: number) => annualElecKwh > 0 ? +(v / annualElecKwh * 100).toFixed(1) : 0

      // Detect fossil fuel usage
      const annualGasConsumption = sumVariable(intervals, 'consumption.fossil_fuel')
      const hasFossilFuelHeating = annualGasConsumption > 0

      // Annual end-use kWh (for scenario savings calculations)
      const annualHeatingKwh = sumVariable(intervals, 'consumption.electricity.heating')
      const annualCoolingKwh = sumVariable(intervals, 'consumption.electricity.cooling')
      const annualHotWaterKwh = sumVariable(intervals, 'consumption.electricity.hot_water')
      const electricityRate = annualElecKwh > 0 ? annualCostElec / annualElecKwh : 0.18

      const result = {
        address,
        annual_consumption_kwh: +annualElecKwh.toFixed(0),
        annual_cost_usd: +annualCostTotal.toFixed(0),
        annual_cost_electricity_usd: +annualCostElec.toFixed(0),
        annual_cost_gas_usd: +annualCostGas.toFixed(0),
        electricity_rate_per_kwh: +electricityRate.toFixed(4),
        annual_heating_kwh: +annualHeatingKwh.toFixed(0),
        annual_cooling_kwh: +annualCoolingKwh.toFixed(0),
        annual_hot_water_kwh: +annualHotWaterKwh.toFixed(0),
        monthly_cost_usd: monthlyCostTotal,
        breakdown_pct: {
          hvac: pct(hvac),
          water_heater: pct(waterHeater),
          plug_loads: pct(plugLoads),
          lighting: pct(lighting),
          cooking: pct(cooking),
        },
        annual_emissions_kg_co2: +(annualEmissionsElec + annualEmissionsGas).toFixed(0),
        has_fossil_fuel_heating: hasFossilFuelHeating,
        has_gas: annualGasConsumption > 0,
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      }
    }
  )
}
