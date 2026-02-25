export type OpenAIResponse = {
  choices?: Array<{ message?: { content?: string } }>
  error?: string
}

export async function callChat(model: string, messages: Array<{role:string, content:string}>, apiKey: string, maxTokens = 1000, temperature = 0.4) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature }),
  })
  if (!res.ok) throw new Error(`OpenAI error: ${res.status} ${res.statusText}`)
  const data = await res.json()
  return data as OpenAIResponse
}

export function buildPrompts(transcript: string, context: any, model: string) {
  const sys = { role: 'system', content: 'You are a sales agent.' } as const
  const user = { role: 'user', content: `Transcript: ${transcript}\nContext: ${JSON.stringify(context)}` } as const
  return { sys, user }
}
