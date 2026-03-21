import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'

// Federal IRA incentives — stable through 2032, hardcoded
const FEDERAL_INCENTIVES: Record<string, { name: string; amount: string; type: string }[]> = {
  solar_5kw: [
    { name: 'Residential Clean Energy Credit (IRA)', amount: '30% of installation cost', type: 'tax_credit' },
  ],
  solar_10kw: [
    { name: 'Residential Clean Energy Credit (IRA)', amount: '30% of installation cost', type: 'tax_credit' },
  ],
  solar_plus_battery: [
    { name: 'Residential Clean Energy Credit (IRA)', amount: '30% of solar + battery cost', type: 'tax_credit' },
  ],
  heat_pump_hvac: [
    { name: 'Energy Efficient Home Improvement Credit (25C)', amount: 'Up to $2,000', type: 'tax_credit' },
  ],
  heat_pump_water_heater: [
    { name: 'Energy Efficient Home Improvement Credit (25C)', amount: 'Up to $2,000', type: 'tax_credit' },
  ],
  insulation: [
    { name: 'Energy Efficient Home Improvement Credit (25C)', amount: 'Up to $1,200 (30% of cost)', type: 'tax_credit' },
  ],
  ev_charger: [
    { name: 'Alternative Fuel Vehicle Refueling Property Credit (30C)', amount: 'Up to $1,000 (30% of cost)', type: 'tax_credit' },
  ],
}

interface RewiringIncentive {
  payment_methods: string[]
  items: Array<{ item: string; amount: number; representative_amount: number }>
  short_description: string
  program: string
  program_url: string
  more_info_url: string
  authority_type: string
  authority: string
  start_date: string
  end_date: string
  coverage: { state: string }
}

export function registerIncentivesTool(server: McpServer) {
  server.tool(
    'get_incentives',
    'Fetches applicable federal and state incentives for the upgrades that were run. Call this after all run_upgrade_scenario calls are complete.',
    {
      zip_code: z.string().describe('5-digit ZIP code of the property'),
      upgrade_types: z.string().describe('Comma-separated list of upgrade types that were simulated'),
    },
    async ({ zip_code, upgrade_types }) => {
      const upgrades = upgrade_types.split(',').map(u => u.trim())

      // Federal incentives from hardcoded IRA data
      const federal: Array<{ upgrade_type: string; name: string; amount: string; type: string }> = []
      for (const upgrade of upgrades) {
        const incentives = FEDERAL_INCENTIVES[upgrade] ?? []
        for (const inc of incentives) {
          federal.push({ upgrade_type: upgrade, ...inc })
        }
      }

      // State incentives from Rewiring America API
      const state: Array<{ upgrade_type: string; name: string; amount: string; authority: string; url: string }> = []
      try {
        const apiKey = process.env.REWIRING_AMERICA_API_KEY
        if (apiKey) {
          const res = await fetch(
            `https://api.rewiringamerica.org/api/v1/calculator?zip=${zip_code}&owner_status=homeowner&household_income=80000&tax_filing=joint&household_size=4`,
            { headers: { Authorization: `Bearer ${apiKey}` } }
          )

          if (res.ok) {
            const data = await res.json() as { incentives: RewiringIncentive[] }
            const incentives: RewiringIncentive[] = data.incentives ?? []

            for (const inc of incentives) {
              // Match incentives to our upgrade types
              const incText = (inc.short_description + ' ' + (inc.items?.[0]?.item ?? '')).toLowerCase()
              let matchedUpgrade: string | null = null

              if (incText.includes('solar') || incText.includes('photovoltaic')) {
                matchedUpgrade = upgrades.find(u => u.includes('solar')) ?? null
              } else if (incText.includes('heat pump') && incText.includes('water')) {
                matchedUpgrade = upgrades.includes('heat_pump_water_heater') ? 'heat_pump_water_heater' : null
              } else if (incText.includes('heat pump')) {
                matchedUpgrade = upgrades.includes('heat_pump_hvac') ? 'heat_pump_hvac' : null
              } else if (incText.includes('insulation') || incText.includes('weatheriz')) {
                matchedUpgrade = upgrades.includes('insulation') ? 'insulation' : null
              } else if (incText.includes('ev') || incText.includes('charger') || incText.includes('electric vehicle')) {
                matchedUpgrade = upgrades.includes('ev_charger') ? 'ev_charger' : null
              }

              if (matchedUpgrade) {
                const amount = inc.items?.[0]?.representative_amount
                state.push({
                  upgrade_type: matchedUpgrade,
                  name: inc.short_description,
                  amount: amount ? `$${amount.toLocaleString()}` : 'Varies',
                  authority: inc.authority ?? inc.authority_type,
                  url: inc.more_info_url ?? inc.program_url,
                })
              }
            }
          }
        }
      } catch (err) {
        console.error('Rewiring America API error:', err)
        // Non-fatal — federal incentives still returned
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ federal, state, zip_code }),
        }],
      }
    }
  )
}
