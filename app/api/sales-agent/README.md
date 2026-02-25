OpenAI integration for the Sales Agent
- Environment variables:
- OPENAI_API_KEY
- OPENAI_MODEL (default: gpt-4-turbo)
- Endpoint: POST /api/sales-agent
- Payload example:
  {
    "transcript": "...",
    "context": { /* optional contextual data */ }
  }
