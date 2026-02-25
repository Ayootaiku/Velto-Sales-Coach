# Gemini Constitution

## 1) Mission
Build deterministic, self-healing automation using the B.L.A.S.T. protocol across the A.N.T. 3-layer architecture.

## 2) Data Schemas (Authoritative)

### 2.1 Schema Status
- Status: `CONFIRMED (2026-02-12)`
- Rule: `tools/` scripting allowed for Link handshakes and deterministic pipeline implementation.

### 2.2 Input Schema (Confirmed)
```json
{
  "north_star": "sales coaching",
  "integrations": [
    {
      "name": "supabase|openai",
      "enabled": true,
      "credentials_ready": true,
      "notes": "string"
    }
  ],
  "source_of_truth": {
    "system": "supabase",
    "location": "postgres",
    "access_mode": "db"
  },
  "run_context": {
    "call_id": "uuid",
    "salesperson_id": "string",
    "mode": "live|post_call"
  },
  "transcript_events": [
    {
      "speaker": "salesperson|prospect",
      "text": "string",
      "sequence_number": 0,
      "confidence_score": 1.0
    }
  ],
  "delivery_payload": {
    "destination": "supabase",
    "format": "database_write",
    "frequency": "once|scheduled|event_driven"
  },
  "behavioral_rules": {
    "tone": "concise executive + detailed analyst",
    "logic_constraints": ["strict factual"],
    "do_not_rules": ["string"]
  }
}
```

### 2.3 Output Schema (Confirmed)
```json
{
  "run_id": "string",
  "status": "ok|warning|error",
  "timestamp_utc": "ISO-8601",
  "payload": {
    "destination": "supabase",
    "format": "database_write",
    "writes": {
      "coaching_events": [
        {
          "call_id": "uuid",
          "speaker_detected": "salesperson|prospect",
          "objection_type": "string|null",
          "objection_text": "string|null",
          "suggestion_text": "string",
          "rationale": "string",
          "was_used": false
        }
      ],
      "summaries": [
        {
          "call_id": "uuid",
          "outcome_guess": "string|null",
          "outcome_confidence": 0.0,
          "objections_handled": [],
          "strengths": [],
          "improvement_areas": [],
          "focus_next_call": [],
          "ai_summary_text": "string",
          "summary_quality_score": 0.0
        }
      ]
    }
  },
  "evidence": {
    "inputs_used": {},
    "steps": ["string"],
    "validation": [
      {
        "check": "string",
        "result": "pass|fail",
        "details": "string"
      }
    ]
  },
  "errors": [
    {
      "code": "string",
      "message": "string",
      "retryable": true
    }
  ]
}
```

## 3) Behavioral Rules
- Reliability over speed.
- Do not infer missing business logic.
- All non-trivial logic must be deterministic and testable.
- Response style: concise executive framing with optional analyst detail.
- Grounding: strictly factual outputs only.
- Analyze stack traces before patching.
- Record meaningful discoveries in `findings.md`.
- Record every meaningful action in `progress.md`.

## 4) Architectural Invariants
- Layer 1 (`architecture/`) is the source of operational truth for procedure.
- Layer 2 (navigation) only orchestrates; it does not encode business rules ad hoc.
- Layer 3 (`tools/`) scripts are atomic, deterministic, and environment-driven.
- `.tmp/` is for intermediate artifacts only.
- Cloud payload delivery is required for completion.

## 5) Maintenance Log
- 2026-02-12: Constitution initialized. Schemas marked draft pending user confirmation.
- 2026-02-12: Discovery completed. Payload schema confirmed for sales coaching writes into Supabase.
