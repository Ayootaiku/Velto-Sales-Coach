"use client"

import React, { useState, useCallback, useEffect, useRef } from "react"
import { X, Mic, MicOff, Terminal, Settings } from "lucide-react"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { generateLiveCoaching, generatePostCallSummary, getApiUrl, type TranscriptTurn } from "@/lib/salescoach-ai"
import { processTranscriptUltraFast, type TranscriptTurn as CopilotTurn } from "@/lib/salescoach-copilot"
import { createTurnManager } from "@/lib/turn-manager"

export interface CoachSettings {
  emotionStyle: 'Assertive' | 'Empathetic' | 'Energetic';
  companyName: string;
  productDescription: string;
  targetAudience: string;
  callType: 'Cold Call' | 'Discovery' | 'Demo' | 'Closing' | 'Follow-up';
  primaryObjective: string;
  keyDifferentiators: string;
  objectionMode: 'Soft Reframe' | 'Hard Pushback' | 'Question-Based' | 'Story-Based';
  /** Optional: secret for POST /api/restart (stored in settings, not in bundle). */
  restartSecret?: string;
}

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

const SHOW_MOVABLE_ORB_KEY = 'showMovableOrb'

function SettingsPanel({
  settings,
  onSave,
  onClose
}: {
  settings: CoachSettings,
  onSave: (s: CoachSettings) => void,
  onClose: () => void
}) {
  const [localSettings, setLocalSettings] = useState<CoachSettings>(settings)
  const [showMovableOrb, setShowMovableOrb] = useState(true)
  const inExtension = typeof chrome !== 'undefined' && !!chrome.runtime?.id

  useEffect(() => {
    if (!inExtension) return
    chrome.storage.local.get([SHOW_MOVABLE_ORB_KEY], (result) => {
      if (result[SHOW_MOVABLE_ORB_KEY] !== undefined) setShowMovableOrb(Boolean(result[SHOW_MOVABLE_ORB_KEY]))
    })
  }, [inExtension])

  const emotionMap: Record<string, number> = {
    'Empathetic': 0,
    'Energetic': 50,
    'Assertive': 100
  }

  const reverseEmotionMap: Record<number, CoachSettings['emotionStyle']> = {
    0: 'Empathetic',
    50: 'Energetic',
    100: 'Assertive'
  }

  return (
    <div className="absolute inset-0 z-50 bg-[#18181b] flex flex-col animate-in fade-in slide-in-from-right duration-300">
      <div className="h-14 flex items-center justify-between px-5 border-b border-[#27272a] shrink-0">
        <h2 className="text-sm font-bold text-white uppercase tracking-wider">Coach Settings</h2>
        <button onClick={onClose} className="text-[#a1a1aa] hover:text-[#fafafa]">
          <X className="w-4 h-4" />
        </button>
      </div>

      <ScrollArea className="flex-1 p-5">
        <div className="space-y-6 pb-20">
          {inExtension && (
            <div className="space-y-2">
              <Label className="text-[10px] uppercase font-bold text-zinc-500 tracking-widest">Show movable orb on pages</Label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showMovableOrb}
                  onChange={(e) => {
                    const v = e.target.checked
                    setShowMovableOrb(v)
                    chrome.storage.local.set({ [SHOW_MOVABLE_ORB_KEY]: v })
                  }}
                  className="rounded border-[#3f3f46] bg-[#27272a] text-[#d4ff32] focus:ring-[#d4ff32]"
                />
                <span className="text-sm text-white">Show the orb on web pages</span>
              </label>
            </div>
          )}
          {/* Emotion Style Slider */}
          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <Label className="text-[10px] uppercase font-bold text-zinc-500 tracking-widest">Emotion Style</Label>
              <span className="text-[10px] font-bold text-[#d4ff32] uppercase">{localSettings.emotionStyle}</span>
            </div>
            <div className="px-2">
              <Slider
                value={[emotionMap[localSettings.emotionStyle]]}
                max={100}
                step={50}
                onValueChange={(vals) => {
                  const val = vals[0]
                  setLocalSettings({ ...localSettings, emotionStyle: reverseEmotionMap[val] })
                }}
                className="py-4"
              />
              <div className="flex justify-between text-[8px] text-zinc-500 uppercase font-bold px-1 mt-1">
                <span>Empathetic</span>
                <span>Energetic</span>
                <span>Assertive</span>
              </div>
            </div>
          </div>

          {/* Company Name */}
          <div className="space-y-2">
            <Label className="text-[10px] uppercase font-bold text-zinc-500 tracking-widest">Company Name</Label>
            <Input
              value={localSettings.companyName}
              onChange={(e) => setLocalSettings({ ...localSettings, companyName: e.target.value })}
              placeholder="e.g. Acme Corp"
              className="bg-[#27272a] border-[#3f3f46] text-white h-11 focus-visible:ring-[#d4ff32] focus-visible:ring-inset focus-visible:ring-2 focus-visible:ring-offset-0"
            />
          </div>

          {/* Product/Service */}
          <div className="space-y-2">
            <Label className="text-[10px] uppercase font-bold text-zinc-500 tracking-widest">Product / Service</Label>
            <Textarea
              value={localSettings.productDescription}
              onChange={(e) => setLocalSettings({ ...localSettings, productDescription: e.target.value })}
              placeholder="What are you selling?"
              className="bg-[#27272a] border-[#3f3f46] text-white min-h-[80px] focus-visible:ring-[#d4ff32] focus-visible:ring-inset focus-visible:ring-2 focus-visible:ring-offset-0"
            />
          </div>

          {/* Target Audience */}
          <div className="space-y-2">
            <Label className="text-[10px] uppercase font-bold text-zinc-500 tracking-widest">Target Audience</Label>
            <Input
              value={localSettings.targetAudience}
              onChange={(e) => setLocalSettings({ ...localSettings, targetAudience: e.target.value })}
              placeholder="e.g. HR Managers"
              className="bg-[#27272a] border-[#3f3f46] text-white h-11 focus-visible:ring-[#d4ff32] focus-visible:ring-inset focus-visible:ring-2 focus-visible:ring-offset-0"
            />
          </div>

          {/* Call Type */}
          <div className="space-y-2">
            <Label className="text-[10px] uppercase font-bold text-zinc-500 tracking-widest">Call Type</Label>
            <Select
              value={localSettings.callType}
              onValueChange={(v: any) => setLocalSettings({ ...localSettings, callType: v })}
            >
              <SelectTrigger className="bg-[#27272a] border-[#3f3f46] text-white h-11 focus:ring-[#d4ff32] focus:ring-inset focus:ring-2 focus:ring-offset-0">
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent className="bg-[#1c1c1f] border-[#3f3f46] text-white">
                <SelectItem value="Cold Call">Cold Call</SelectItem>
                <SelectItem value="Discovery">Discovery</SelectItem>
                <SelectItem value="Demo">Demo</SelectItem>
                <SelectItem value="Closing">Closing</SelectItem>
                <SelectItem value="Follow-up">Follow-up</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Primary Objective */}
          <div className="space-y-2">
            <Label className="text-[10px] uppercase font-bold text-zinc-500 tracking-widest">Primary Objective</Label>
            <Input
              value={localSettings.primaryObjective}
              onChange={(e) => setLocalSettings({ ...localSettings, primaryObjective: e.target.value })}
              placeholder="e.g. Book a demo"
              className="bg-[#27272a] border-[#3f3f46] text-white h-11 focus-visible:ring-[#d4ff32] focus-visible:ring-inset focus-visible:ring-2 focus-visible:ring-offset-0"
            />
          </div>

          {/* Key Differentiators */}
          <div className="space-y-2">
            <Label className="text-[10px] uppercase font-bold text-zinc-500 tracking-widest">Key Differentiators (Bullets)</Label>
            <Textarea
              value={localSettings.keyDifferentiators}
              onChange={(e) => setLocalSettings({ ...localSettings, keyDifferentiators: e.target.value })}
              placeholder="- Built-in AI&#10;- Low cost&#10;- 24/7 Support"
              className="bg-[#27272a] border-[#3f3f46] text-white min-h-[100px] focus-visible:ring-[#d4ff32] focus-visible:ring-inset focus-visible:ring-2 focus-visible:ring-offset-0"
            />
          </div>

          {/* Objection Mode */}
          <div className="space-y-2">
            <Label className="text-[10px] uppercase font-bold text-zinc-500 tracking-widest">Objection Handling</Label>
            <Select
              value={localSettings.objectionMode}
              onValueChange={(v: any) => setLocalSettings({ ...localSettings, objectionMode: v })}
            >
              <SelectTrigger className="bg-[#27272a] border-[#3f3f46] text-white h-11 focus:ring-[#d4ff32] focus:ring-inset focus:ring-2 focus:ring-offset-0">
                <SelectValue placeholder="Select mode" />
              </SelectTrigger>
              <SelectContent className="bg-[#1c1c1f] border-[#3f3f46] text-white">
                <SelectItem value="Soft Reframe">Soft Reframe</SelectItem>
                <SelectItem value="Hard Pushback">Hard Pushback</SelectItem>
                <SelectItem value="Question-Based">Question-Based</SelectItem>
                <SelectItem value="Story-Based">Story-Based</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Restart secret (optional): used when clicking Start New Session to trigger server restart workaround */}
          <div className="space-y-2">
            <Label className="text-[10px] uppercase font-bold text-zinc-500 tracking-widest">Restart secret (optional)</Label>
            <Input
              type="password"
              value={localSettings.restartSecret ?? ''}
              onChange={(e) => setLocalSettings({ ...localSettings, restartSecret: e.target.value || undefined })}
              placeholder="Same value as RESTART_SECRET on server"
              className="bg-[#27272a] border-[#3f3f46] text-white h-11 focus-visible:ring-[#d4ff32] focus-visible:ring-inset focus-visible:ring-2 focus-visible:ring-offset-0"
            />
          </div>
        </div>
      </ScrollArea>

      <div className="p-5 border-t border-[#27272a] bg-[#18181b]/80 backdrop-blur-md shrink-0">
        <Button
          onClick={() => {
            onSave(localSettings);
            onClose();
          }}
          className="w-full bg-[#d4ff32] hover:bg-[#e0ff66] text-black font-bold h-12 rounded-xl"
        >
          Save Settings
        </Button>
      </div>
    </div>
  )
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
  const [showSettings, setShowSettings] = useState(false)
  const [restartTriggered, setRestartTriggered] = useState(false)
  const [restartComplete, setRestartComplete] = useState(false)
  const [restartLoading, setRestartLoading] = useState(false)
  const [settings, setSettings] = useState<CoachSettings>({
    emotionStyle: 'Empathetic',
    companyName: '',
    productDescription: '',
    targetAudience: '',
    callType: 'Discovery',
    primaryObjective: '',
    keyDifferentiators: '',
    objectionMode: 'Soft Reframe'
  })

  // Load settings on mount
  useEffect(() => {
    const saved = localStorage.getItem('coach_settings')
    if (saved) {
      try {
        setSettings(JSON.parse(saved))
      } catch (e) {
        console.error('Failed to parse settings', e)
      }
    }
  }, [])

  // Save settings to localStorage
  useEffect(() => {
    localStorage.setItem('coach_settings', JSON.stringify(settings))
  }, [settings])

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
  const didAutoStartInRoomRef = useRef(false)
  const hasHadPreviousSessionRef = useRef(false)
  const isStartingDualRef = useRef(false)
  /** Tab-capture stream from getDisplayMedia (dual mode); stopped explicitly on end call so browser releases "Sharing this tab" */
  const prospectCaptureStreamRef = useRef<MediaStream | null>(null)

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

      if (handleTranscriptRef.current) {
        addLog(`[Diarize] Routing turn to handleTranscript as ${identifiedSpeaker.toUpperCase()}`)
        handleTranscriptRef.current(result.text, identifiedSpeaker)
      } else {
        console.warn(`[Diarize] ❌ handleTranscriptRef is NULL!`)
      }

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
      addLog(`🎯 Prospect Turn End: "${transcript.text.substring(0, 30)}..."`)
      handleTranscriptRef.current(transcript.text, 'prospect')
      console.log(`[Prospect onSpeechEnd] ✅ handleTranscript completed`)
    } else {
      console.error(`[Prospect onSpeechEnd] ❌ handleTranscriptRef.current is NULL!`)
      addLog(`❌ ERROR: handleTranscriptRef is missing`)
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
    addLog(`[Trace] runCoaching Entry: speaker=${speaker}, turns=${turns.length}`)
    const startTime = Date.now()
    const lastTurn = turns[turns.length - 1]
    const currentSessionId = isDiarized ? salespersonStream.sessionId : prospectStream.sessionId

    // ONLY trigger coaching for PROSPECT speech
    const isProspect = speaker === 'prospect'

    if (!isProspect) {
      addLog(`⏭️ Skip: RunCoaching called for ${speaker}, but we only coach on Prospect turns.`)
      return
    }

    // Prevent duplicate coaching requests
    if (isCoachingInProgressRef.current) {
      addLog(`⏳ Skip: Coaching already in progress (Ref: ${isCoachingInProgressRef.current})`)
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
      addLog(`⏭️ Skip: TurnManager rejected (${turnCheck.reason})`)
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
        addLog(`⚠️ Coaching timeout [Turn ${nextTurnId}] - Resetting...`)
        isCoachingInProgressRef.current = false
        turnManagerRef.current.completeGeneration()
        // Reset trace so it doesn't stay stuck on C
        updateTrace({ C: false, turnId: nextTurnId })
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
      }, settings).then(result => {
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

      // Rely on same WebSocket + hook watchdogs (no-audio 5s, silent buffer 4s, connection-health 20s) instead of post-turn restart

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

      // Rely on same WebSocket + hook watchdogs; no post-turn restart on error
    }
  }, [addLog, prospectStream.isConnected, prospectStream.isStreaming, updateTrace, salespersonStream, trace.turnId, prospectStream.sessionId, isDiarized])

  const handleTranscript = useCallback((text: string, speaker: 'salesperson' | 'prospect' = 'salesperson') => {
    if (!text || text.trim().length === 0) {
      return
    }

    addLog(`🎯 handleTranscript called: speaker=${speaker}, textLen=${text.length}`)

    const turn: TranscriptTurn = { speaker, text, timestamp: new Date().toISOString() }
    transcriptTurnsRef.current.push(turn)

    if (speaker === 'prospect') {
      addLog(`⚡ TRIGGERING AI COACHING for prospect speech`)
      runCoaching([...transcriptTurnsRef.current], speaker)
    } else {
      addLog(`ℹ️ Salesperson speech stored. Coaching skipped.`)
    }
  }, [runCoaching, addLog])

  // Set up ref for callback access
  useEffect(() => {
    handleTranscriptRef.current = handleTranscript
  }, [handleTranscript])

  // PROGRESSIVE COACHING: Trigger after 1.2s of silence even if no 'final' from STT
  // This fixes the "no-response" bug when STT doesn't finalize
  useEffect(() => {
    // In diarized mode, we look at the salesperson stream (which captures everyone)
    // Otherwise, we look at the prospect stream
    const activeStream = isDiarized ? salespersonStream : prospectStream
    const activePartial = isDiarized ? salespersonStream.lastPartial : prospectStream.lastPartial

    // Only trigger if we definitely aren't speaking anymore
    if (!activeStream.isSpeaking && activePartial && !isCoachingInProgressRef.current) {
      // Heuristic: If manual speaker is prospect, or we are in dual stream mode
      const likelyProspect = !isDiarized || manualSpeaker === 'prospect'
      if (!likelyProspect) return

      const timer = setTimeout(() => {
        addLog(`⏱️ SILENCE WATCHDOG: Triggering coaching for non-final transcript`)
        handleTranscript(activePartial.text, 'prospect')
      }, 400)
      return () => clearTimeout(timer)
    }
  }, [prospectStream.isSpeaking, prospectStream.lastPartial, salespersonStream.isSpeaking, salespersonStream.lastPartial, isDiarized, manualSpeaker, handleTranscript, addLog])


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

    const copilotResponse = processTranscriptUltraFast(currentTurn, previousTurns, settings);
    if (!copilotResponse) return

    partialDraftShownRef.current = true
    addLog(`⚡ Instant coaching from partial prospect speech`)

    setCards([{
      id: `draft-${Date.now()}`,
      suggestion: copilotResponse.say_next,
      reason: `${copilotResponse.insight} (draft)`,
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

  // Connection-dead recovery: if we're listening/coaching but not connected for 5–8s, force full restart once
  const connectionDeadRecoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const connectionDeadRecoveryFiredRef = useRef(false)
  useEffect(() => {
    if (prospectStream.isConnected) {
      if (connectionDeadRecoveryTimerRef.current) {
        clearTimeout(connectionDeadRecoveryTimerRef.current)
        connectionDeadRecoveryTimerRef.current = null
      }
      connectionDeadRecoveryFiredRef.current = false
      return
    }
    if (status !== 'listening' && status !== 'coaching') return
    if (connectionDeadRecoveryFiredRef.current) return
    // In dual mode, skip 7s auto-restart: replacement connection often gets 1006 and loops; user can Start again manually
    if (!isDiarized) return
    addLog('⚠️ Prospect disconnected; recovery in 7s if still disconnected')
    connectionDeadRecoveryTimerRef.current = setTimeout(() => {
      connectionDeadRecoveryTimerRef.current = null
      if (prospectStream.isConnected || (status !== 'listening' && status !== 'coaching')) return
      connectionDeadRecoveryFiredRef.current = true
      addLog('🔄 Connection dead 7s — forcing full restart (prospect stream)')
      prospectStream.startAutomatic()
    }, 7000)
    return () => {
      if (connectionDeadRecoveryTimerRef.current) {
        clearTimeout(connectionDeadRecoveryTimerRef.current)
        connectionDeadRecoveryTimerRef.current = null
      }
    }
  }, [status, prospectStream.isConnected, prospectStream.startAutomatic, addLog, isDiarized])

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

  const setupProspectStream = async (capturedStream?: MediaStream | null) => {
    try {
      let stream: MediaStream | null = null
      if (capturedStream) {
        stream = capturedStream
      } else {
        addLog("Requesting system audio...")
        try {
          stream = await (navigator as any).mediaDevices.getDisplayMedia({
            audio: true,
            video: true
          })
        } catch (displayErr) {
          addLog("Display media denied, trying alternative...")
          return null
        }
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

      // Validate stream is live before start (avoids TRACE-C/audio bar failing after refresh)
      if (audioTrack.readyState !== 'live' || !stream.active) {
        addLog("❌ Tab share is inactive or ended. Please click Start and share the tab again.")
        stream.getTracks().forEach((t: MediaStreamTrack) => t.stop())
        return null
      }

      addLog("✅ Audio track captured")
      const audioStream = new MediaStream([audioTrack])
      try {
        await prospectStream.startStream('prospect', audioStream)
      } catch (startErr: any) {
        const msg = startErr?.message || String(startErr)
        addLog(`❌ ${msg.includes('inactive') || msg.includes('ended') ? 'Tab share ended — please click Start and share the tab again.' : msg}`)
        stream.getTracks().forEach((t: MediaStreamTrack) => t.stop())
        return null
      }

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
    setRestartTriggered(false)
    setRestartComplete(true)
    setRestartLoading(false)

    const diarize = mode === 'diarized'

    // In-room: go to next screen immediately so button "works", request mic (extension: optional permission first, then getUserMedia — same as website prompt)
    if (diarize) {
      setIsDiarized(true)
      addLog("Starting session (DIARIZED mode)...")
      resetTrace()
      setStatus("listening")
      setCallTime(0)
      setCards([])
      transcriptTurnsRef.current = []
      setSalespersonTag(null)
      setManualSpeaker('salesperson')

      const audioConstraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 16000
        }
      }
      const requestMic = (): Promise<MediaStream> => navigator.mediaDevices.getUserMedia(audioConstraints)
      requestMic()
        .then((micStreamForDiarized: MediaStream) => {
          addLog("🚀 INITIALIZING IN-ROOM CAPTURE (Diarization V1.2)...")
          updateTrace({ A: true, turnId: 0 })
          salespersonStream.startStream('salesperson', micStreamForDiarized, true).then(() => {
            addLog("✅ WEBSOCKET CONNECTED - Port 3002")
            addLog("🎙️ CAPTURE ACTIVE: Use the buttons to switch speakers.")
          }).catch((e: any) => {
            addLog(`❌ Diarization failed: ${e?.message || e}`)
            micStreamForDiarized.getTracks().forEach((t) => t.stop())
            setStatus("ready")
          })
        })
        .catch((e: any) => {
          setStatus("ready")
          setIsDiarized(false)
          addLog(`❌ Microphone denied: ${e?.message || e}`)
          if (e?.name === 'NotAllowedError' || e?.message?.includes('Permission dismissed')) {
            addLog("Click In-Room Mode again and choose Allow when the browser asks for microphone.")
          }
        })
      return
    }

    // Dual mode: getDisplayMedia FIRST (user gesture) then setState
    setIsDiarized(false)
    if (isStartingDualRef.current) {
      addLog("Already starting session, please wait.")
      return
    }
    isStartingDualRef.current = true
    addLog("Starting session (DUAL mode)...")

    try {
      console.log('[SECOND-SESSION] About to call getDisplayMedia, hasHadPreviousSession:', hasHadPreviousSessionRef.current)
      if (hasHadPreviousSessionRef.current) {
        await new Promise((r) => setTimeout(r, 400))
      }

      let capturedStream: MediaStream | null = null
      try {
        capturedStream = await (navigator as any).mediaDevices.getDisplayMedia({
          audio: true,
          video: true
        })
      } catch (displayErr) {
        console.error('[SECOND-SESSION] getDisplayMedia failed:', displayErr)
        addLog("Display media denied or cancelled.")
        return
      }
      if (!capturedStream) {
        addLog("❌ Failed to get display media stream")
        return
      }
      console.log('[SECOND-SESSION] getDisplayMedia resolved, stream.active:', !!capturedStream?.active, 'audioTracks:', capturedStream?.getAudioTracks?.()?.length, 'firstTrackState:', capturedStream?.getAudioTracks?.()?.[0]?.readyState)
      const audioTrack = capturedStream.getAudioTracks()[0]
      if (!audioTrack || audioTrack.readyState !== 'live' || !capturedStream.active) {
        console.warn('[SECOND-SESSION] Stream validation failed:', { hasTrack: !!audioTrack, readyState: audioTrack?.readyState, streamActive: capturedStream?.active })
        addLog("❌ Tab share invalid or ended. Check 'Share tab audio' and try again.")
        capturedStream.getTracks().forEach((t: MediaStreamTrack) => t.stop())
        return
      }

      addLog("Initializing dual-stream prospect audio...")
      prospectCaptureStreamRef.current = capturedStream
      const prospectResult = await setupProspectStream(capturedStream)
      if (!prospectResult) {
        if (prospectCaptureStreamRef.current) {
          prospectCaptureStreamRef.current.getTracks().forEach((t: MediaStreamTrack) => t.stop())
          prospectCaptureStreamRef.current = null
        }
        addLog("❌ CRITICAL: Prospect stream failed - no prospect audio captured!")
        setStatus("ready")
        setCards([{
          id: 'error-' + Date.now(),
          suggestion: "⚠️ Prospect audio not captured",
          reason: "Click Start and choose the tab with prospect audio (check Share tab audio).",
          type: 'reframe'
        }])
        return
      }
      // Set status only after prospect stream is connected so "listening" effects see consistent state
      resetTrace()
      setStatus("listening")
      setCallTime(0)
      setCards([])
      transcriptTurnsRef.current = []
    } finally {
      isStartingDualRef.current = false
    }
  }, [salespersonStream, addLog, resetTrace, updateTrace])

  // When opened from extension via ?start=inroom, auto-start In-Room on the website (bypass extension mic limits)
  useEffect(() => {
    if (typeof window === 'undefined' || didAutoStartInRoomRef.current) return
    const inExtension = typeof chrome !== 'undefined' && !!chrome.runtime?.id
    if (inExtension) return
    const params = new URLSearchParams(window.location.search)
    if (params.get('start') !== 'inroom') return
    didAutoStartInRoomRef.current = true
    handleStartCoaching('diarized')
    window.history.replaceState({}, '', window.location.pathname + (window.location.hash || ''))
  }, [handleStartCoaching])

  const handleEndCall = useCallback(async () => {
    addLog("Ending call...")
    setStatus("summary")
    microphone.stopListening()
    speechRecognition.stopListening()
    if (prospectCaptureStreamRef.current) {
      prospectCaptureStreamRef.current.getTracks().forEach((t: MediaStreamTrack) => t.stop())
      prospectCaptureStreamRef.current = null
    }
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

  const handleReset = useCallback(async () => {
    microphone.stopListening()
    speechRecognition.stopListening()
    if (prospectCaptureStreamRef.current) {
      prospectCaptureStreamRef.current.getTracks().forEach((t: MediaStreamTrack) => t.stop())
      prospectCaptureStreamRef.current = null
    }
    await salespersonStream.stopStream()
    await prospectStream.stopStream()

    // Chrome audio reset: clear routing so next getDisplayMedia works (second-session fix)
    try {
      const releaseStream = await navigator.mediaDevices.getUserMedia({ audio: true })
      releaseStream.getTracks().forEach((t: MediaStreamTrack) => t.stop())
      await new Promise((r) => setTimeout(r, 2000))
    } catch (_) {
      /* ignore */
    }
    hasHadPreviousSessionRef.current = true

    setStatus("ready")
    setCallTime(0)
    setCards([])
    setTranscript("")
    setIsPaused(false)
    transcriptTurnsRef.current = []
    turnManagerRef.current.reset()
    setSalespersonTag(null)
    setManualSpeaker('salesperson')
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

  const handleStartNewSession = useCallback(async () => {
    const secret = settings.restartSecret?.trim()
    if (secret) {
      try {
        await fetch(getApiUrl('/api/restart'), {
          method: 'POST',
          headers: { 'X-Restart-Secret': secret },
        })
      } catch (_) {
        /* ignore */
      }
      setRestartTriggered(true)
      setRestartComplete(false)
    }
    await handleReset()
  }, [settings.restartSecret, handleReset])

  // Background poll for "restart complete" when on home and restart was triggered
  useEffect(() => {
    if (status !== 'ready' || !restartTriggered || restartComplete) return
    const interval = setInterval(async () => {
      try {
        const res = await fetch(getApiUrl('/api/health'))
        if (res.ok) {
          setRestartComplete(true)
          setRestartTriggered(false)
        }
      } catch (_) {
        /* ignore */
      }
    }, 2500)
    return () => clearInterval(interval)
  }, [status, restartTriggered, restartComplete])

  const tryStartSession = useCallback(
    async (mode: 'dual' | 'diarized') => {
      if (restartTriggered && !restartComplete) {
        setRestartLoading(true)
        while (true) {
          try {
            const res = await fetch(getApiUrl('/api/health'))
            if (res.ok) break
          } catch (_) {
            /* ignore */
          }
          await new Promise((r) => setTimeout(r, 2000))
        }
        setRestartComplete(true)
        setRestartTriggered(false)
        setRestartLoading(false)
      }
      const inExtension = typeof chrome !== 'undefined' && !!chrome.runtime?.id
      if (mode === 'diarized' && inExtension) {
        const websiteUrl = 'https://velto-sales-coach-production.up.railway.app'
        window.open(`${websiteUrl}?start=inroom`, '_blank')
        return
      }
      handleStartCoaching(mode)
    },
    [restartTriggered, restartComplete, handleStartCoaching]
  )

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = s % 60
    return `${m}:${sec.toString().padStart(2, "0")}`
  }

  if (isCompact) return <CompactOverlay status={status} onExpand={() => setIsCompact(false)} />

  return (
    <div className="relative bg-[#18181b] border border-[#27272a] shadow-2xl w-[360px] rounded-[1.5rem] overflow-hidden flex flex-col transition-all duration-500">
      {/* Header */}
      <div className="h-14 flex items-center justify-between px-5 bg-[#18181b] shrink-0">
        <div className="flex items-center gap-2.5">
          <div className={cn("w-1.5 h-1.5 rounded-full", status === "ready" ? "bg-[#52525b]" : "bg-[#eaf57e] animate-pulse")} />
          <span className="text-[10px] font-semibold text-[#fafafa] uppercase tracking-widest">velto sales coach</span>
          {(status === "listening" || status === "coaching") && (
            <span className="text-[10px] text-[#a1a1aa] font-mono bg-[#27272a] px-2 py-0.5 rounded-full border border-[#3f3f46]">{formatTime(callTime)}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowSettings(true)}
            className="text-[#a1a1aa] hover:text-[#d4ff32] transition-colors p-1 rounded-full hover:bg-[#27272a]"
          >
            <Settings className="w-4 h-4" />
          </button>
          {/* Enhanced 5-Stage Pipeline Stepper */}
          <button onClick={() => setIsCompact(true)} className="text-[#a1a1aa] hover:text-[#fafafa] transition-colors p-1 rounded-full hover:bg-[#27272a]">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar max-h-[600px] flex flex-col relative bg-[#18181b]">
        {status === "ready" && restartLoading && (
          <div className="flex flex-col items-center justify-center h-[480px] text-zinc-400 bg-[#18181b]">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-500 mb-4" />
            <p className="text-sm">Preparing new session...</p>
          </div>
        )}
        {status === "ready" && !restartLoading && (
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
                  type="button"
                  onClick={() => tryStartSession('dual')}
                  className="w-full py-3.5 rounded-xl bg-[#d4ff32] hover:bg-[#e0ff66] text-[#000000] text-[13px] font-bold tracking-wide transition-all shadow-lg shadow-[#d4ff32]/10"
                >
                  Start Session
                </button>
                <button
                  type="button"
                  onClick={() => tryStartSession('diarized')}
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
            <div className="flex items-center justify-center shrink-0 min-h-[120px]">
              <PresenceOrb
                state={(trace.C || trace.D || trace.E) ? "active" : (status === "coaching" ? "active" : "listening")}
                label={(trace.C || trace.D || trace.E) ? "Thinking" : "Listening"}
              />
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
              onClose={handleStartNewSession}
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

      {showSettings && (
        <SettingsPanel
          settings={settings}
          onSave={setSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  )
}

