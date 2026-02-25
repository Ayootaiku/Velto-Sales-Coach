"use client"

import React, { useState, useCallback, useEffect, useRef } from "react"
import { X, Mic, MicOff, Terminal } from "lucide-react"
import { cn } from "@/lib/utils"
import type { CoachingStatus } from "./status-indicator"
import { PresenceOrb } from "./presence-orb"
import { CoachingCard, type CoachingCardData } from "./coaching-card"

import { CallSummary } from "./call-summary"
import { CompactOverlay } from "./compact-overlay"
import { AnimatedWaveVisualizer } from "@/components/ui/animated-wave-visualizer"
import { useMicrophone } from "@/hooks/use-microphone"
import { useSpeechRecognition } from "@/hooks/use-speech-recognition"
import { useSTTStream } from "@/hooks/use-stt-stream-ws"
import {
  Stepper,
  StepperIndicator,
  StepperItem,
  StepperSeparator,
} from "@/components/ui/stepper"
import { generateLiveCoaching, generatePostCallSummary, type TranscriptTurn } from "@/lib/salescoach-ai"
import { processTranscriptUltraFast, type TranscriptTurn as CopilotTurn } from "@/lib/salescoach-copilot"
import { createTurnManager } from "@/lib/turn-manager"

// Helper component to handle async summary generation
function AsyncSummaryGenerator({ generator, onClose }: { generator: () => Promise<any>, onClose: () => void }) {
  const [summaryData, setSummaryData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchSummary = async () => {
      setLoading(true)
      setError(null)
      try {
        const data = await generator()
        if (!data) {
          throw new Error('Summary returned empty data')
        }
        setSummaryData(data)
      } catch (err) {
        console.error('[AsyncSummary] Error:', err)
        const message = err instanceof Error ? err.message : 'Failed to generate summary'
        setError(message)
      } finally {
        setLoading(false)
      }
    }
    fetchSummary()
  }, [generator])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-[480px] text-zinc-400">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500 mb-4" />
        <p className="text-sm">Generating your strategic summary...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-[480px] text-center gap-3 text-zinc-300 p-4">
        <p className="text-sm font-semibold text-red-300">Couldn&apos;t generate summary</p>
        <p className="text-xs text-zinc-500 max-w-xs">{error}</p>
        <div className="text-[10px] text-zinc-600 font-mono bg-zinc-900/50 p-2 rounded border border-zinc-800 max-w-xs overflow-auto">
          <p>Check browser console for:</p>
          <p className="text-zinc-500">[Summary Client]</p>
          <p className="text-zinc-500">[Summary API]</p>
          <p className="text-zinc-500">[End Call]</p>
        </div>
        <button
          onClick={onClose}
          className="px-4 py-2 text-xs font-semibold rounded-lg bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 transition-colors"
        >
          Start a new session
        </button>
      </div>
    )
  }

  return <CallSummary data={summaryData} onClose={onClose} />
}

export function SalesCoachOverlay() {
  const [status, setStatus] = useState<CoachingStatus>("ready")
  const [isDiarized, setIsDiarized] = useState(false)
  const [isCompact, setIsCompact] = useState(false)
  const [cards, setCards] = useState<CoachingCardData[]>([])
  const [callTime, setCallTime] = useState(0)
  const [transcript, setTranscript] = useState("")
  const [isPaused, setIsPaused] = useState(false)
  const [manualInput, setManualInput] = useState("")
  const [showManualInput, setShowManualInput] = useState(false)
  const [useWebSpeechFallback, setUseWebSpeechFallback] = useState(false)
  const [debugLogs, setDebugLogs] = useState<string[]>([])
  const [salespersonTag, setSalespersonTag] = useState<number | null>(null)
  const [manualSpeaker, setManualSpeaker] = useState<'salesperson' | 'prospect'>('salesperson')
  const manualSpeakerRef = useRef<'salesperson' | 'prospect'>('salesperson')

  // Keep ref in sync for the stream callback
  useEffect(() => {
    manualSpeakerRef.current = manualSpeaker
  }, [manualSpeaker])

  // TRACE: Pipeline checkpoints A-E
  const [trace, setTrace] = useState({
    A: false, // prospectStreamReady
    B: false, // transcriptReceived
    C: false, // coachRequestStarted
    D: false, // coachResponseReceived
    E: false, // cardRendered
    lastTranscriptLen: 0,
    lastResponseLen: 0,
    cardId: '',
    turnId: 0,
  })
  const updateTrace = useCallback((updates: Partial<typeof trace>) => {
    setTrace(prev => ({ ...prev, ...updates }))
  }, [])

  const transcriptTurnsRef = useRef<TranscriptTurn[]>([])
  const turnManagerRef = useRef(createTurnManager())
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleTranscriptRef = useRef<((text: string, speaker: 'salesperson' | 'prospect') => void) | null>(null)
  const coachingDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isCoachingInProgressRef = useRef(false)
  const partialDraftShownRef = useRef(false)

  // DEDUPLICATION: Track last processed transcript to prevent duplicate callbacks
  const lastProcessedTranscriptRef = useRef<string>('')
  const lastProcessedTimeRef = useRef<number>(0)
  const DEDUP_WINDOW_MS = 2000 // 2 second deduplication window
  const MIN_PARTIAL_CHARS_FOR_DRAFT = 8

  const microphone = useMicrophone()

  // STABILIZED SUMMARY GENERATOR (Top Level to avoid hook violations)
  const summaryGenerator = useCallback(async () => {
    const safeSummary = {
      outcome: "No transcript captured",
      wentWell: "We didn't receive any audio or transcript from this call.",
      improvement: "Ensure the mic is enabled and the browser share-tab-audio checkbox is selected before ending the call.",
      nextFocus: "Restart the session and speak a short test phrase to confirm capture.",
      duration: "0:00",
      objectionsHandled: 0
    };

    if (!Array.isArray(transcriptTurnsRef.current) || transcriptTurnsRef.current.length === 0) {
      return safeSummary;
    }

    try {
      let lastError: Error | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          if (attempt > 0) {
            await new Promise(r => setTimeout(r, 250));
          }

          const summary = await generatePostCallSummary(transcriptTurnsRef.current);

          return {
            outcome: summary?.outcome?.result || "Unknown",
            wentWell: summary?.salesperson_performance?.strengths?.[0] || "Call completed",
            improvement: summary?.improvement_focus?.objection_handling_upgrade || "Continue practicing active listening.",
            nextFocus: summary?.improvement_focus?.recommended_next_action || "Schedule follow-up",
            duration: "Generated",
            objectionsHandled: Array.isArray(summary?.objections)
              ? summary.objections.filter((o: any) => o.handled === "Yes" || o.handled === "Partial").length
              : 0
          };
        } catch (err) {
          lastError = err as Error;
          console.error(`[Summary] Attempt ${attempt + 1} failed:`, err);
        }
      }

      console.error("[Summary] All attempts failed, returning safe fallback", lastError);
      return {
        ...safeSummary,
        outcome: "Summary unavailable",
        wentWell: "Call completed but summary could not be generated",
        improvement: "Try again with a stronger internet connection"
      };
    } catch (e) {
      console.error("[Summary] Unexpected error:", e);
      return safeSummary;
    }
  }, []);

  const salespersonStream = useSTTStream(undefined, (result, speakerCode) => {
    // If we're in diarization mode, this single stream handles BOTH speakers
    if (isDiarized) {
      // Route based on MANUAL BUTTON selection (as requested by user)
      const identifiedSpeaker = manualSpeakerRef.current

      console.log(`[Diarization Turn] Tag ${result.speakerTag} -> ${identifiedSpeaker.toUpperCase()}: ${result.text}`)

      // If identified as prospect, trigger Step B trace
      if (identifiedSpeaker === 'prospect') {
        addLog(`🎤 PROSPECT: "${result.text.substring(0, 30)}..."`)
        updateTrace({ B: true, lastTranscriptLen: result.text.length })
      }

      handleTranscript(result.text, identifiedSpeaker)

      // AUTO-REFRESH WATCHDOG: Restart stream on speaker turn to reset Google's 60s clock
      if (identifiedSpeaker === 'prospect') {
        addLog("🔄 HEARTBEAT: Turn complete, refreshing WebSocket...")
        salespersonStream.startAutomatic()
      }
    }
  })
  const prospectStream = useSTTStream((transcript) => {
    // Regular dual-stream mode uses this callback
    if (isDiarized) return // Ignore if we are in diarization mode

    // DEDUPLICATION CHECK: Skip if same transcript within dedup window
    const now = Date.now()
    const isDuplicate =
      transcript.text === lastProcessedTranscriptRef.current &&
      now - lastProcessedTimeRef.current < DEDUP_WINDOW_MS

    if (isDuplicate) {
      console.log(`[Prospect onSpeechEnd] ⏭️ SKIPPING duplicate transcript (within ${DEDUP_WINDOW_MS}ms window)`)
      return
    }

    // Update deduplication tracking
    lastProcessedTranscriptRef.current = transcript.text
    lastProcessedTimeRef.current = now

    console.log(`[Prospect onSpeechEnd] handleTranscriptRef exists:`, !!handleTranscriptRef.current)
    // Trigger coaching when prospect speech ends
    if (handleTranscriptRef.current) {
      console.log(`[Prospect onSpeechEnd] ✅ Calling handleTranscript...`)
      handleTranscriptRef.current(transcript.text, 'prospect')
      console.log(`[Prospect onSpeechEnd] ✅ handleTranscript completed`)
    } else {
      console.error(`[Prospect onSpeechEnd] ❌ handleTranscriptRef.current is NULL!`)
    }
  })

  const addLog = useCallback((msg: string) => {
    setDebugLogs(prev => [...prev.slice(-19), `${new Date().toLocaleTimeString()}: ${msg}`])
  }, [])

  // Reset trace when starting new session
  const resetTrace = useCallback(() => {
    updateTrace({ A: false, B: false, C: false, D: false, E: false, lastTranscriptLen: 0, lastResponseLen: 0, cardId: '' })
  }, [updateTrace])

  // CHECKPOINT RECOVERY: Reset all coaching state to allow new requests
  const resetCoachingState = useCallback(() => {
    isCoachingInProgressRef.current = false
    turnManagerRef.current.reset()
    if (coachingDebounceRef.current) {
      clearTimeout(coachingDebounceRef.current)
      coachingDebounceRef.current = null
    }
    // RESET TRACE to Step A
    updateTrace({ B: false, C: false, D: false, E: false, lastTranscriptLen: 0, lastResponseLen: 0, cardId: '' })
    addLog(`🔄 Turn ${trace.turnId} Complete - Trace Reset (Session: ${prospectStream.sessionId || 'Ready'})`)
  }, [addLog, updateTrace, prospectStream.sessionId, trace.turnId])

  // AUTOMATIC RESET AFTER E (IMMEDIATE)
  useEffect(() => {
    if (trace.E) {
      resetCoachingState()
    }
  }, [trace.E, resetCoachingState])

  // Track the last transcript we've seen to ensure Step B re-fires
  const lastTracedTranscriptRef = useRef<string>('')

  useEffect(() => {
    if ((status === "listening" || status === "coaching") && !isPaused) {
      const timer = setInterval(() => setCallTime((t) => t + 1), 1000)
      return () => clearInterval(timer)
    }
  }, [status, isPaused])

  // Allow one instant draft coaching per utterance (first meaningful partial)
  useEffect(() => {
    if (!prospectStream.isSpeaking) {
      partialDraftShownRef.current = false
    }
  }, [prospectStream.isSpeaking])

  const runCoaching = useCallback(async (turns: TranscriptTurn[], speaker: 'salesperson' | 'prospect', force = false) => {
    console.log(`[runCoaching] 🚀 ENTRY - speaker: ${speaker}, turns: ${turns.length}, force: ${force}`)
    const startTime = Date.now()
    const lastTurn = turns[turns.length - 1]

    // ONLY trigger coaching for PROSPECT speech
    // This ensures we wait for prospect to finish talking before responding
    const isProspect = speaker === 'prospect'

    if (!isProspect) {
      console.log(`[runCoaching] ⏭️ SKIP - Not prospect (speaker: ${speaker})`)
      addLog(`ℹ️ Skipping AI coaching for salesperson speech`)
      return
    }

    // Prevent duplicate coaching requests
    console.log(`[runCoaching] Checking isCoachingInProgress:`, isCoachingInProgressRef.current)
    if (isCoachingInProgressRef.current) {
      console.log(`[runCoaching] ⏳ BLOCKED - Coaching already in progress!`)
      addLog(`⏳ Coaching already in progress, skipping duplicate request`)
      return
    }

    // Clear any pending debounce timer
    if (coachingDebounceRef.current) {
      clearTimeout(coachingDebounceRef.current)
      coachingDebounceRef.current = null
    }

    // Use turn manager to prevent duplicate coaching
    const turnManager = turnManagerRef.current
    const turnCheck = turnManager.shouldGenerateCard(
      { speaker, text: lastTurn.text, timestamp: lastTurn.timestamp },
      true // isFinal
    )

    if (!turnCheck.shouldGenerate) {
      addLog(`⏭️ Skipping duplicate coaching: ${turnCheck.reason}`)
      return
    }

    // Mark generation as started
    const nextTurnId = trace.turnId + 1
    turnManager.startGeneration()
    isCoachingInProgressRef.current = true

    // SAFETY NET: Auto-reset isCoachingInProgress after 10 seconds to prevent permanent blocking
    const safetyResetTimer = setTimeout(() => {
      if (isCoachingInProgressRef.current) {
        console.warn('[runCoaching] ⚠️ Safety reset triggered after 10s - resetting isCoachingInProgress')
        isCoachingInProgressRef.current = false
        turnManagerRef.current.completeGeneration()
      }
    }, 10000)

    addLog(`🚀 COACHING TRIGGERED [Turn ${nextTurnId}]: ${speaker} - "${lastTurn.text.substring(0, 30)}..."`)

    // CHECKPOINT C: Coach request started
    addLog(`[Trace] Step C: Coach Request Started (Turn: ${nextTurnId}, Session: ${prospectStream.sessionId})`)
    updateTrace({ C: true, turnId: nextTurnId })


    // Track timeout to clear it if API responds successfully
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let hasCompleted = false
    const streamingCardId = `stream-${Date.now()}`

    try {
      // Call AI with STREAMING support for faster perceived response
      const coachingPromise = generateLiveCoaching(turns, speaker, (partial) => {
        // STREAMING UPDATE: Update the card as words arrive
        // REMOVED gate: Show card as soon as we have ANY insight or suggestion
        if (partial.insight || (partial.say_next && partial.say_next.length > 0)) {
          setCards([{
            id: streamingCardId,
            suggestion: partial.say_next || "Strategizing...",
            reason: partial.insight || "Analyzing prospect's psychological state...",
            type: 'reframe'
          }]);
        }
      }).then(result => {
        // Clear timeout if API responds successfully
        if (timeoutId) {
          clearTimeout(timeoutId)
          timeoutId = null
        }
        hasCompleted = true
        return result
      })

      // Add timeout to ensure we never wait too long
      const timeoutPromise = new Promise<{ say_next: string, insight: string, objection_type?: string }>((resolve) => {
        timeoutId = setTimeout(() => {
          if (!hasCompleted) {
            resolve({
              say_next: "I hear you. Can you tell me more about that?",
              insight: "Quick response to keep the conversation flowing",
              objection_type: undefined
            })
          }
        }, 8000) // Slightly longer wait for streaming full completion
      })

      const coaching = await Promise.race([coachingPromise, timeoutPromise])
      const elapsed = Date.now() - startTime
      addLog(`✅ AI Replied (${elapsed}ms)`)

      // Clear safety timer since we completed successfully
      clearTimeout(safetyResetTimer)

      // Mark generation as complete and IMMEDIATELY allow next coaching
      turnManagerRef.current.completeGeneration()
      isCoachingInProgressRef.current = false // Reset immediately so new speech can trigger coaching

      // CHECKPOINT D: Response received
      const responseText = JSON.stringify(coaching)
      addLog(`[Trace] Step D: Coach Response Received (Turn: ${trace.turnId}, Session: ${prospectStream.sessionId})`)
      updateTrace({ D: true, lastResponseLen: responseText.length })

      // Ensure we always have a suggestion
      let safeSuggestion = coaching.say_next?.trim()
      if (!safeSuggestion || safeSuggestion.length < 5) {
        safeSuggestion = isProspect
          ? "I hear you. Can you tell me more about what you're looking for?"
          : "Acknowledge their point and ask a clarifying question."
        addLog(`⚠️ Using fallback suggestion`)
      }

      // FINAL RENDER: Ensure the last finalized text is set
      setCards([{
        id: streamingCardId,
        suggestion: safeSuggestion,
        reason: coaching.insight || "Tactical response based on prospect's statement",
        type: 'reframe'
      }])

      // CHECKPOINT E: Card rendered
      addLog(`[Trace] Step E: Card Rendered (Turn: ${trace.turnId}, ID: ${streamingCardId})`)
      updateTrace({ E: true, cardId: streamingCardId })

      // AUTO-START NEW STREAM: Now that AI has responded, start a fresh prospect stream
      // This is identical to clicking the 'Start' button for the prospect
      console.log(`[Prospect AI Response] 🔄 Turn complete. Starting NEW prospect stream...`)
      if (isDiarized) {
        // Force Hardware Reset after AI card to ensure clean state
        addLog("⚡ SYSTEM: HARDWARE RESET (Immediate Post-Response)...")
        setTimeout(() => {
          console.warn("[IN-ROOM WATCHDOG] 🔄 Refreshing audio pulse to prevent timeout...")
          salespersonStream.startAutomatic()
        }, 100)
      } else {
        prospectStream.startAutomatic()
      }

    } catch (e) {
      addLog(`❌ AI Error: ${e}`)
      console.error('[AI Error]', e)

      // Clear safety timer since we're handling the error
      clearTimeout(safetyResetTimer)

      // Mark generation as complete (even on error) and reset immediately
      turnManagerRef.current.completeGeneration()
      isCoachingInProgressRef.current = false // Reset immediately so new speech can trigger coaching

      // Clear any pending timeout
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }

      // CHECKPOINT D: Response received (error case)
      addLog(`[Trace] Step D: Coach Response (ERROR) (Turn: ${trace.turnId}, Session: ${prospectStream.sessionId})`)
      updateTrace({ D: true, lastResponseLen: 0 })

      // Even on error, show a fallback card so user isn't left hanging
      const cardId = Date.now().toString()
      setCards([{
        id: cardId,
        suggestion: "I understand. Can you tell me more about your situation?",
        reason: "Fallback response while AI service recovers",
        type: 'reframe'
      }])

      // CHECKPOINT E: Card rendered (fallback)
      addLog(`[Trace] Step E: Card Rendered (Turn: ${trace.turnId}, ID: ${cardId})`)
      updateTrace({ E: true, cardId })

      // AUTO-START NEW STREAM even on error to keep the loop going
      console.log(`[Prospect AI Error] 🔄 Error turn complete. Starting NEW prospect stream...`)
      prospectStream.startAutomatic()
    }
  }, [addLog, prospectStream.isConnected, prospectStream.isStreaming, updateTrace, salespersonStream])

  const handleTranscript = useCallback((text: string, speaker: 'salesperson' | 'prospect' = 'salesperson') => {

    if (!text || text.trim().length === 0) {
      return
    }

    addLog(`🎯 SPEECH END detected for ${speaker}: "${text.substring(0, 30)}..."`)

    const turn: TranscriptTurn = {
      speaker,
      text,
      timestamp: new Date().toISOString()
    }
    transcriptTurnsRef.current.push(turn)

    // Only trigger AI coaching when PROSPECT finishes speaking
    // This ensures the AI responds to what the prospect actually said
    if (speaker === 'prospect') {
      addLog(`⚡ TRIGGERING AI COACHING for prospect speech`)
      runCoaching([...transcriptTurnsRef.current], speaker)
    } else {
      addLog(`ℹ️ Salesperson speech detected - storing transcript only`)
    }
  }, [runCoaching, addLog])

  // Set up ref for callback access
  useEffect(() => {
    handleTranscriptRef.current = handleTranscript
  }, [handleTranscript])

  // Track transcripts for display/storage (but don't trigger coaching from here)
  // Coaching is only triggered via onSpeechEnd callback for prospect stream
  useEffect(() => {
    // CRITICAL FIX: In Diarization mode, the stream callback handles everything based on buttons.
    // We MUST NOT handle it here, otherwise it will force-label everything as 'salesperson'.
    if (isDiarized) return

    if (salespersonStream.lastFinal) {
      addLog(`🎤 SALES transcript: "${salespersonStream.lastFinal.text.substring(0, 30)}..."`)
      // Only add to transcript history, don't trigger coaching
      const turn: TranscriptTurn = {
        speaker: 'salesperson',
        text: salespersonStream.lastFinal.text,
        timestamp: new Date().toISOString()
      }
      transcriptTurnsRef.current.push(turn)
    }
  }, [salespersonStream.lastFinal, addLog, isDiarized])

  useEffect(() => {
    if (prospectStream.lastFinal) {
      // Avoid duplicate B-step logs for the same result object
      if (lastTracedTranscriptRef.current === prospectStream.lastFinal.text && trace.B) {
        return
      }
      lastTracedTranscriptRef.current = prospectStream.lastFinal.text

      addLog(`🎤 PROSPECT transcript: "${prospectStream.lastFinal.text.substring(0, 30)}..."`)
      addLog(`[Trace] Step B: Transcript Received (Session: ${prospectStream.sessionId})`)
      updateTrace({ B: true, lastTranscriptLen: prospectStream.lastFinal.text.length }) // CHECKPOINT B

      // NOTE: History is already added in handleTranscript via the STT callback.
      // We only update trace/logs here to avoid the "Double History" bug.
    }
  }, [prospectStream.lastFinal, addLog, updateTrace])

  // DEFAULT: respond as soon as prospect starts speaking using partial transcript
  useEffect(() => {
    const partial = prospectStream.lastPartial

    if (!partial) return
    if (status !== 'listening' && status !== 'coaching') return
    if (isPaused) return
    if (!prospectStream.isSpeaking) return
    if (partialDraftShownRef.current) return

    const text = partial.text?.trim() || ''
    if (text.length < MIN_PARTIAL_CHARS_FOR_DRAFT) return

    const previousTurns: CopilotTurn[] = transcriptTurnsRef.current.slice(-6).map((turn, idx) => ({
      speaker: turn.speaker,
      text: turn.text,
      timestamp: Date.now() - ((6 - idx) * 1000),
      isFinal: true,
    }))

    const currentTurn: CopilotTurn = {
      speaker: 'prospect',
      text,
      timestamp: Date.now(),
      isFinal: false,
    }

    const instantDraft = processTranscriptUltraFast(currentTurn, previousTurns)
    if (!instantDraft) return

    partialDraftShownRef.current = true
    addLog(`⚡ Instant coaching from partial prospect speech`)

    setCards([{
      id: `draft-${Date.now()}`,
      suggestion: instantDraft.say_next,
      reason: `${instantDraft.insight} (draft)`,
      type: 'reframe'
    }])
  }, [prospectStream.lastPartial, prospectStream.isSpeaking, status, isPaused, addLog])

  // Monitor prospect stream connection status
  useEffect(() => {
    if (prospectStream.isConnected) {
      if (!trace.A) {
        addLog(`[Trace] Step A: Prospect Stream READY (Session: ${prospectStream.sessionId})`)
        updateTrace({ A: true }) // CHECKPOINT A: Stream ready
      }
    } else if (status === 'listening' || status === 'coaching') {
      if (trace.A) {
        addLog(`⚠️ Prospect stream DISCONNECTED`)
        updateTrace({ A: false })
      }
    }
  }, [prospectStream.isConnected, status, addLog, updateTrace, trace.A, prospectStream.sessionId])

  const speechRecognition = useSpeechRecognition({
    onTranscript: (text) => {
      if (!useWebSpeechFallback) return
      handleTranscript(text, 'salesperson')
    },
    continuous: true,
  })

  // If streaming connects, disable fallback mic to avoid duplicates
  useEffect(() => {
    if (salespersonStream.isConnected && useWebSpeechFallback) {
      addLog("Streaming STT connected, stopping Web Speech fallback")
      setUseWebSpeechFallback(false)
      speechRecognition.stopListening()
    }
  }, [salespersonStream.isConnected, useWebSpeechFallback, speechRecognition, addLog])

  // Log streaming errors
  useEffect(() => {
    if (salespersonStream.error) {
      addLog(`❌ STT Error: ${salespersonStream.error}`)
    }
  }, [salespersonStream.error, addLog])

  // Note: Draft coaching disabled - only AI-generated cards will show

  const setupProspectStream = async () => {
    try {
      addLog("Requesting system audio...")

      // Try getDisplayMedia first (for system/tab audio)
      let stream: MediaStream | null = null
      try {
        stream = await (navigator as any).mediaDevices.getDisplayMedia({
          audio: true,
          video: true
        })
      } catch (displayErr) {
        addLog("Display media denied, trying alternative...")
        // Fallback: try to get audio from another source
        return null
      }

      if (!stream) {
        addLog("❌ Failed to get display media stream")
        return null
      }

      const audioTrack = stream.getAudioTracks()[0]
      if (!audioTrack) {
        addLog("❌ No audio track! User missed checkbox?")
        alert("⚠️ IMPORTANT: Check 'Share tab audio' in the popup to capture prospect audio!")
        stream.getTracks().forEach((t: MediaStreamTrack) => t.stop())
        return null
      }

      addLog("✅ Audio track captured")
      const audioStream = new MediaStream([audioTrack])
      await prospectStream.startStream('prospect', audioStream)

      // FIXED: Don't stop stream when audio track ends - it might be temporary
      // Only stop when user explicitly ends the call
      audioTrack.onended = () => {
        addLog("⚠️ Audio track ended (but stream continues)")
        // Stream recreation on the server-side will handle reconnection
        // Don't stop the stream here!
      }

      return stream
    } catch (err) {
      addLog(`❌ Permission denied: ${err}`)
      return null
    }
  }

  // SILENCE WATCHDOG: Reset hardware after 10 seconds of continuous silence
  // Only active in In-Room mode when Prospect is selected
  // Uses a ref for the callback to prevent React re-render thrashing
  const watchdogCallbackRef = useRef(salespersonStream.startAutomatic)
  useEffect(() => {
    watchdogCallbackRef.current = salespersonStream.startAutomatic
  }, [salespersonStream.startAutomatic])

  const silenceWatchdogRef = useRef<number | null>(null)
  const silenceResetDoneRef = useRef(false)
  const isSpeakingRef = useRef(salespersonStream.isSpeaking)
  useEffect(() => {
    isSpeakingRef.current = salespersonStream.isSpeaking
  }, [salespersonStream.isSpeaking])

  useEffect(() => {
    if (status !== "listening" || !isDiarized || manualSpeaker !== 'prospect') {
      // Not in prospect mode — clear silence tracking
      silenceWatchdogRef.current = null
      silenceResetDoneRef.current = false
      return
    }

    // Monitor silence every 2 seconds
    const interval = setInterval(() => {
      if (isSpeakingRef.current) {
        // Someone is talking — reset silence timer
        silenceWatchdogRef.current = null
        silenceResetDoneRef.current = false
        return
      }

      // Silent — start or continue tracking
      if (silenceWatchdogRef.current === null) {
        silenceWatchdogRef.current = Date.now()
      }

      const silenceDuration = Date.now() - silenceWatchdogRef.current

      if (silenceDuration >= 10000 && !silenceResetDoneRef.current) {
        // 10 seconds of silence — trigger ONE hardware reset
        console.warn(`[IN-ROOM WATCHDOG] 🔄 ${Math.round(silenceDuration / 1000)}s silence detected — Refreshing audio...`)
        addLog("⚡ SYSTEM: HARDWARE RESET (10s Silence Watchdog)...")
        watchdogCallbackRef.current()
        silenceResetDoneRef.current = true // Prevent repeated resets until voice returns
        silenceWatchdogRef.current = null // Reset so it can fire again after another 10s of silence
      }
    }, 2000)

    return () => clearInterval(interval)
  }, [status, isDiarized, manualSpeaker, addLog])

  // SPEAKER SWITCH WATCHDOG: Automatically reset hardware when switching back to Prospect
  // This ensures the mic is fresh when the user stops talking and hands over to the prospect
  useEffect(() => {
    if (status === "listening" && isDiarized && manualSpeaker === 'prospect') {
      addLog("⚡ SYSTEM: HARDWARE RESET (Speaker Switch to Prospect)...")
      console.warn("[IN-ROOM WATCHDOG] 🔄 Refreshing audio pulse to prevent timeout...")
      salespersonStream.startAutomatic()
    }
  }, [manualSpeaker, isDiarized, status, salespersonStream.startAutomatic, addLog])

  const handleStartCoaching = useCallback(async (mode: 'dual' | 'diarized' = 'dual') => {
    const diarize = mode === 'diarized'
    setIsDiarized(diarize)

    addLog(`Starting session (${mode.toUpperCase()} mode)...`)
    resetTrace() // Reset trace at start
    setStatus("listening") // Immediate transition

    setCallTime(0)
    setCards([])
    transcriptTurnsRef.current = []

    if (diarize) {
      addLog("🚀 INITIALIZING IN-ROOM CAPTURE (Diarization V1.2)...")
      setSalespersonTag(null)
      setManualSpeaker('salesperson')
      try {
        updateTrace({ A: true, turnId: 0 })
        // Use 5.0x gain boost for diarization (enhanced room capture)
        await salespersonStream.startStream('salesperson', undefined, true)
        addLog("✅ WEBSOCKET CONNECTED - Port 3002")
        addLog("🎙️ CAPTURE ACTIVE: Use the buttons to switch speakers.")
      } catch (e: any) {
        addLog(`❌ Diarization failed: ${e.message || e}`)
        setStatus("ready")
      }
    } else {
      addLog("Initializing dual-stream prospect audio...")
      const prospectResult = await setupProspectStream()
      if (!prospectResult) {
        addLog("❌ CRITICAL: Prospect stream failed - no prospect audio captured!")
        setCards([{
          id: 'error-' + Date.now(),
          suggestion: "⚠️ Prospect audio not captured",
          reason: "Click 'Share Session' and CHECK 'Share tab audio' in terminal popup",
          type: 'reframe'
        }])
      }
    }
  }, [salespersonStream, addLog, resetTrace, updateTrace])

  const handleEndCall = useCallback(async () => {
    addLog("Ending call...")
    setStatus("summary")
    microphone.stopListening()
    speechRecognition.stopListening()
    await salespersonStream.stopStream()
    await prospectStream.stopStream()
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current)
      fallbackTimerRef.current = null
    }
    if (coachingDebounceRef.current) {
      clearTimeout(coachingDebounceRef.current)
      coachingDebounceRef.current = null
    }
    isCoachingInProgressRef.current = false
    setUseWebSpeechFallback(false)
    setDebugLogs([])
    setSalespersonTag(null)
    setManualSpeaker('salesperson')
  }, [microphone, speechRecognition, salespersonStream, prospectStream, addLog])

  const handleReset = useCallback(() => {
    setStatus("ready")
    setCallTime(0)
    setCards([])
    setTranscript("")
    setIsPaused(false)
    transcriptTurnsRef.current = []
    turnManagerRef.current.reset()
    setSalespersonTag(null)
    setManualSpeaker('salesperson')
    microphone.stopListening()
    speechRecognition.stopListening()
    salespersonStream.stopStream()
    prospectStream.stopStream()
    if (fallbackTimerRef.current) {
      clearTimeout(fallbackTimerRef.current)
      fallbackTimerRef.current = null
    }
    if (coachingDebounceRef.current) {
      clearTimeout(coachingDebounceRef.current)
      coachingDebounceRef.current = null
    }
    isCoachingInProgressRef.current = false
    setUseWebSpeechFallback(false)
    setDebugLogs([])
  }, [microphone, speechRecognition, salespersonStream, prospectStream])

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${sec.toString().padStart(2, "0")}`
  }

  if (isCompact) return <CompactOverlay status={status} onExpand={() => setIsCompact(false)} />

  return (
    <div className="bg-[#18181b] border border-[#27272a] shadow-2xl w-[360px] rounded-[1.5rem] overflow-hidden flex flex-col transition-all duration-500">
      {/* Header */}
      <div className="h-14 flex items-center justify-between px-5 bg-[#18181b] shrink-0">
        <div className="flex items-center gap-2.5">
          <div className={cn("w-1.5 h-1.5 rounded-full", status === "ready" ? "bg-[#52525b]" : "bg-[#eaf57e] animate-pulse")} />
          <span className="text-[10px] font-semibold text-[#fafafa] uppercase tracking-widest">velto sales coach</span>
          {(status === "listening" || status === "coaching") && (
            <span className="text-[10px] text-[#a1a1aa] font-mono bg-[#27272a] px-2 py-0.5 rounded-full border border-[#3f3f46]">{formatTime(callTime)}</span>
          )}
        </div>
        <div className="flex items-center gap-4">
          {/* Enhanced 5-Stage Pipeline Stepper */}
          <button onClick={() => setIsCompact(true)} className="text-[#a1a1aa] hover:text-[#fafafa] transition-colors p-1 rounded-full hover:bg-[#27272a]">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar max-h-[600px] flex flex-col relative bg-[#18181b]">
        {status === "ready" && (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center min-h-[480px] bg-[#18181b]">
            {/* Position wave audio visualization UP in empty space */}
            <div className="w-[150%] -ml-[25%] h-48 mb-4 opacity-60 mix-blend-screen flex items-center justify-center -mt-16 relative z-0 pointer-events-none">
              <AnimatedWaveVisualizer />
            </div>

            <div className="relative z-10 flex flex-col items-center w-full">
              <h3 className="text-2xl tracking-tight mb-3 text-[#ffffff] font-bold">Ready to Coach</h3>
              <p className="text-[14px] text-[#a1a1aa] font-medium max-w-[240px] leading-relaxed mb-10">
                Analyze your voice session and receive tactical advice in real-time.
              </p>

              <div className="flex flex-col gap-3 w-full px-6">
                <button
                  onClick={() => handleStartCoaching('dual')}
                  className="w-full py-3.5 rounded-xl bg-[#d4ff32] hover:bg-[#e0ff66] text-[#000000] text-[13px] font-bold tracking-wide transition-all shadow-lg shadow-[#d4ff32]/10"
                >
                  Start Session
                </button>
                <button
                  onClick={() => handleStartCoaching('diarized')}
                  className="w-full py-3.5 rounded-xl bg-transparent border border-[#3f3f46] hover:bg-[#2c2c2e] text-[#ffffff] text-[13px] font-bold tracking-wide transition-all"
                >
                  In-Room Mode
                </button>
              </div>
            </div>
          </div>
        )}

        {(status === "listening" || status === "coaching") && (
          <div className="flex flex-col p-5 gap-6 flex-1">
            <div className="h-24 flex items-center justify-center shrink-0">
              <PresenceOrb state={status === "coaching" ? "active" : "listening"} />
            </div>

            {/* In-Room Mode: Manual Speaker Switcher */}
            {isDiarized && (
              <div className="flex gap-2 bg-[#27272a] p-1.5 rounded-2xl border border-[#3f3f46]">
                <button
                  onClick={() => setManualSpeaker('salesperson')}
                  className={cn(
                    "flex-1 py-3 rounded-xl font-bold text-[12px] tracking-wide transition-all duration-300 relative overflow-hidden group",
                    manualSpeaker === 'salesperson'
                      ? "bg-[#d4ff32] text-[#000000] shadow-sm"
                      : "bg-transparent text-[#71717a] hover:text-[#ffffff]"
                  )}
                >
                  <div className="flex items-center justify-center gap-2">
                    <Mic className={cn("w-4 h-4", manualSpeaker === 'salesperson' ? "text-[#000000]" : "text-[#71717a]")} />
                    <span>You</span>
                  </div>
                </button>
                <button
                  onClick={() => setManualSpeaker('prospect')}
                  className={cn(
                    "flex-1 py-3 rounded-xl font-bold text-[12px] tracking-wide transition-all duration-300 relative overflow-hidden group",
                    manualSpeaker === 'prospect'
                      ? "bg-[#27272a] text-[#ffffff] shadow-sm"
                      : "bg-transparent text-[#71717a] hover:text-[#ffffff]"
                  )}
                >
                  <div className="flex items-center justify-center gap-2">
                    <div className={cn("w-4 h-4 flex items-center justify-center rounded-full border-2 transition-colors", manualSpeaker === 'prospect' ? "border-[#d4ff32]" : "border-[#71717a]")}>
                      <div className={cn("w-1.5 h-1.5 rounded-full", manualSpeaker === 'prospect' ? "bg-[#d4ff32]" : "bg-transparent")} />
                    </div>
                    <span>Prospect</span>
                  </div>
                </button>
              </div>
            )}

            {/* AI Result Cards */}
            <div className="space-y-4 pb-4">
              {cards.map((card) => (
                <CoachingCard
                  key={card.id}
                  card={card}
                  onDismiss={(id) => setCards(prev => prev.filter(c => c.id !== id))}
                />
              ))}
            </div>
          </div>
        )}

        {status === "summary" && (
          <div className="flex-1 p-5 min-h-[480px]">
            <AsyncSummaryGenerator
              generator={summaryGenerator}
              onClose={handleReset}
            />
          </div>
        )}
      </div>

      {/* Footer Controls */}
      {(status === "listening" || status === "coaching") && (
        <div className="p-6 bg-[#18181b] flex flex-col gap-3 rounded-b-[1.5rem] shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-6">
              <div className="flex flex-col gap-2.5 w-16">
                <div className="flex items-center gap-2">
                  <div className={cn("w-2 h-2 rounded-full", salespersonStream.isConnected ? "bg-[#52525b]" : "bg-[#27272a]")} />
                  <span className="text-[10px] text-[#a1a1aa] uppercase font-bold tracking-widest">You</span>
                </div>
                <div className="h-1.5 bg-[#27272a] rounded-full overflow-hidden border border-[#3f3f46]">
                  <div className="h-full bg-[#a1a1aa] transition-all duration-75" style={{ width: `${salespersonStream.audioLevel}%` }} />
                </div>
              </div>
              <div className="flex flex-col gap-2.5 w-16">
                <div className="flex items-center gap-2">
                  <div className={cn("w-2 h-2 rounded-full", prospectStream.isConnected ? "bg-[#d4ff32]" : "bg-[#27272a]")} />
                  <span className="text-[10px] text-[#d4ff32] uppercase font-bold tracking-widest">Them</span>
                </div>
                <div className="h-1.5 bg-[#27272a] rounded-full overflow-hidden border border-[#3f3f46]">
                  <div className="h-full bg-[#d4ff32] transition-all duration-75" style={{ width: `${prospectStream.audioLevel}%` }} />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <button onClick={microphone.toggleMute} className={cn("p-3 rounded-full transition-colors border", microphone.isMuted ? "bg-amber-500/10 border-amber-500/20 text-amber-500" : "bg-[#27272a] border-[#3f3f46] hover:bg-[#3f3f46] text-[#ffffff]")}>
                {microphone.isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>
              <button onClick={handleEndCall} className="px-6 py-3 bg-[#d4ff32] hover:bg-[#e0ff66] text-[#000000] text-[13px] font-bold rounded-full tracking-wide transition-all hover:-translate-y-px shadow-lg shadow-[#d4ff32]/20">
                End Call
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

