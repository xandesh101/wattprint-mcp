const PALMETTO_BASE_URL = 'https://ei.palmetto.com'
const API_KEY = process.env.PALMETTO_API_KEY!

const FROM_DATE = '2024-01-01T00:00:00'
const TO_DATE = '2025-01-01T00:00:00'

export interface PalmettoInterval {
  [key: string]: string | number
}

export interface PalmettoResponse {
  data: {
    intervals: PalmettoInterval[]
  }
}

export async function callPalmetto(payload: object): Promise<PalmettoInterval[]> {
  const res = await fetch(`${PALMETTO_BASE_URL}/api/v0/bem/calculate`, {
    method: 'POST',
    headers: {
      'X-API-Key': API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const text = await res.text()

  if (!res.ok) {
    throw new Error(`Palmetto API error ${res.status}: ${text}`)
  }

  try {
    const json = JSON.parse(text) as PalmettoResponse
    return json.data?.intervals ?? []
  } catch {
    throw new Error(`Palmetto returned non-JSON response: ${text.slice(0, 200)}`)
  }
}

export function baselinePayload(address: string, groupBy: 'month' | 'year' = 'month') {
  return {
    location: { address },
    parameters: {
      from_datetime: FROM_DATE,
      to_datetime: TO_DATE,
      group_by: groupBy,
      interval_format: 'wide',
      variables: 'all_non_zero',
    },
  }
}

export function scenarioPayload(
  address: string,
  hypothetical: object = {},
  production?: object
) {
  return {
    location: { address },
    parameters: {
      from_datetime: FROM_DATE,
      to_datetime: TO_DATE,
      group_by: 'year',
      interval_format: 'wide',
      variables: 'all_non_zero',
    },
    ...(Object.keys(hypothetical).length > 0
      ? { consumption: { hypothetical } }
      : {}),
    ...(production ? { production } : {}),
  }
}

// Sum a variable across all monthly intervals
export function sumVariable(intervals: PalmettoInterval[], key: string): number {
  return intervals.reduce((sum, row) => sum + (Number(row[key]) || 0), 0)
}

// Extract monthly values for a variable
export function monthlyValues(intervals: PalmettoInterval[], key: string): number[] {
  return intervals.map(row => Number(row[key]) || 0)
}
