"use client"

import { useState, useCallback, useRef, useEffect } from 'react'

let _wssBaseUrl = '';
export function setWssBaseUrl(url: string) { _wssBaseUrl = url; }

export interface TranscriptResult {
  text: string
  isFinal: boolean
  speaker: 'salesperson' | 'prospect'
  confidence: number
  timestamp: number
  speakerTag?: number | null
}

export interface UseSTTStreamReturn {
  isConnected: boolean
  isStreaming: boolean
  transcripts: TranscriptResult[]
  lastFinal: TranscriptResult | null
  lastPartial: TranscriptResult | null
  audioLevel: number // 0-100
  isSpeaking: boolean
  transcriptCount: number
  sessionId: string
  startStream: (speaker: 'salesperson' | 'prospect', stream?: MediaStream, diarize?: boolean) => Promise<void>
  stopStream: () => void
  startAutomatic: () => Promise<void>
  error: string | null
  onSpeechEnd?: (transcript: TranscriptResult) => void
}

const SILENCE_THRESHOLD_MS = 200
const FINAL_SILENCE_THRESHOLD_MS = 800
const RMS_THRESHOLD = 0.01 // Minimum RMS to consider as real audio

type PCMBuffer = Int16Array;

export function useSTTStream(
  onSpeechEnd?: (transcript: TranscriptResult) => void,
  onSpeakerTurn?: (result: TranscriptResult, speakerCode: 'salesperson' | 'prospect') => void
): UseSTTStreamReturn {
  const [isConnected, setIsConnected] = useState(false)
  const [isStreaming, setIsStreaming] = useState(false)
  const [transcripts, setTranscripts] = useState<TranscriptResult[]>([])
  const [lastFinal, setLastFinal] = useState<TranscriptResult | null>(null)
  const [lastPartial, setLastPartial] = useState<TranscriptResult | null>(null)
  const [audioLevel, setAudioLevel] = useState(0)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [transcriptCount, setTranscriptCount] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const sessionIdRef = useRef<string>('')
  const wsRef = useRef<WebSocket | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)

  const isSpeakingRef = useRef(false)
  const silenceStartRef = useRef<number | null>(null)
  const lastFinalTextRef = useRef<string>('')
  const audioLevelRef = useRef(0)
  const speakerRef = useRef<'salesperson' | 'prospect'>('salesperson')
  const pendingPartialRef = useRef<TranscriptResult | null>(null)
  const finalSilenceStartRef = useRef<number | null>(null)
  const lastPartialRef = useRef<TranscriptResult | null>(null)
  const rmsHistoryRef = useRef<number[]>([])
  const bytesSentRef = useRef<number>(0)
  const lastActiveTimeRef = useRef<number>(Date.now()) // Track when we last saw REAL audio (RMS > 0)
  const reconnectAttemptsRef = useRef(0)
  const isStoppingRef = useRef(false)
  const transcriptCountRef = useRef(0)
  const lastAudioProcessTimeRef = useRef<number>(Date.now())
  const isStreamingRef = useRef(false) // Use ref for stable closure access
  const watchdogIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const resumeCheckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const onSpeechEndRef = useRef(onSpeechEnd)
  const onSpeakerTurnRef = useRef(onSpeakerTurn)
  const isDiarizedRef = useRef(false)

  // DEDUPLICATION: Track server-finalized text to prevent double finalization
  const serverFinalizedTextRef = useRef<string>('')
  const serverFinalizedTimeRef = useRef<number>(0)

  // Keep callback ref updated
  useEffect(() => {
    onSpeechEndRef.current = onSpeechEnd
  }, [onSpeechEnd])

  useEffect(() => {
    onSpeakerTurnRef.current = onSpeakerTurn
  }, [onSpeakerTurn])

  const MAX_RECONNECT_ATTEMPTS = 999999 // Effectively infinite to avoid "secret" timeouts

  // Resample audio from input sample rate to 16000Hz
  const resampleAudio = useCallback((inputBuffer: Float32Array, inputSampleRate: number): Int16Array => {
    const outputSampleRate = 16000
    const ratio = outputSampleRate / inputSampleRate
    const outputLength = Math.floor(inputBuffer.length * ratio)
    const outputBuffer = new Int16Array(outputLength)

    for (let i = 0; i < outputLength; i++) {
      const index = i / ratio
      const indexFloor = Math.floor(index)
      const indexCeil = Math.min(indexFloor + 1, inputBuffer.length - 1)
      const fraction = index - indexFloor

      // Linear interpolation
      const sample = inputBuffer[indexFloor] * (1 - fraction) + inputBuffer[indexCeil] * fraction
      // Convert float32 to int16
      outputBuffer[i] = Math.max(-32768, Math.min(32767, sample * 32767))
    }

    return outputBuffer
  }, [])

  // Calculate RMS (Root Mean Square) for audio validation
  const calculateRMS = useCallback((buffer: Float32Array): number => {
    let sum = 0
    for (let i = 0; i < buffer.length; i++) {
      sum += buffer[i] * buffer[i]
    }
    return Math.sqrt(sum / buffer.length)
  }, [])

  // Connect to WebSocket server (cloud WSS or local port discovery)
  const connectWebSocket = useCallback(async (speaker: 'salesperson' | 'prospect', sessionId: string, diarize = false): Promise<WebSocket> => {
    const params = `?session=${sessionId}&speaker=${speaker}${diarize ? '&diarize=true' : ''}`

    // Extension: always use Railway (setter, then Vite define, then hardcoded fallback — never localhost)
    const inExtension = typeof chrome !== 'undefined' && !!chrome.runtime?.id
    const railwayWss = (typeof import.meta !== 'undefined' && (import.meta as { env?: { VITE_RAILWAY_WSS?: string } }).env?.VITE_RAILWAY_WSS) || ''
    const railwayFallback = 'wss://velto-sales-coach-production.up.railway.app'
    const cloudBase = inExtension
      ? (_wssBaseUrl || railwayWss || railwayFallback)
      : (_wssBaseUrl || railwayWss || '')

    if (cloudBase) {
      return new Promise((resolve, reject) => {
        console.log(`[TRACE-A] ${speaker} - Connecting to cloud WSS: ${cloudBase}`)
        const ws = new WebSocket(`${cloudBase}${params}`)
        const timeout = setTimeout(() => { ws.close(); reject(new Error('Cloud WSS timeout')) }, 5000)
        ws.onopen = () => { clearTimeout(timeout); console.log(`[TRACE-A] ${speaker} - Cloud WSS CONNECTED`); resolve(ws) }
        ws.onerror = () => { clearTimeout(timeout); reject(new Error('Cloud WSS failed')) }
      })
    }

    const tryPort = (port: number): Promise<WebSocket> => {
      return new Promise((resolve, reject) => {
        console.log(`[TRACE-A] ${speaker} - Trying WebSocket on port ${port}... (diarize: ${diarize})`)
        const ws = new WebSocket(`ws://localhost:${port}${params}`)
        const timeout = setTimeout(() => { ws.close(); reject(new Error(`Timeout on port ${port}`)) }, 3000)
        ws.onopen = () => { clearTimeout(timeout); console.log(`[TRACE-A] ${speaker} - WebSocket CONNECTED on port ${port}`); resolve(ws) }
        ws.onerror = () => { clearTimeout(timeout); reject(new Error(`Failed on port ${port}`)) }
      })
    }

    const ports = [3002, 3003, 3004, 3005, 3006, 3007, 3008, 3009, 3010]
    let lastError: Error | null = null
    for (const port of ports) {
      try { return await tryPort(port) } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        console.log(`[TRACE-A] ${speaker} - Port ${port} failed, trying next...`)
      }
    }
    console.error(`[WS STT ${speaker}] All ports failed (3002-3010)`)
    throw lastError || new Error('WebSocket connection failed - server may not be running')
  }, [])


  const startStream = useCallback(async (speaker: 'salesperson' | 'prospect', audioStream?: MediaStream, diarize = false) => {
    try {
      speakerRef.current = speaker
      isDiarizedRef.current = diarize

      // Generate session ID
      const newSessionId = `${speaker}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
      sessionIdRef.current = newSessionId
      transcriptCountRef.current = 0
      bytesSentRef.current = 0

      console.log(`[TRACE] ${speaker} - Starting STT stream with session: ${newSessionId}`)

      // Get audio stream
      let audioStreamToUse: MediaStream
      if (audioStream) {
        // VALIDATION: If using existing stream, ensure it's actually alive
        const tracks = audioStream.getTracks()
        const isActive = audioStream.active && tracks.length > 0 && tracks.every(t => t.readyState === 'live')

        if (!isActive) {
          console.warn(`[WS STT ${speaker}] Existing stream is DEAD or INACTIVE. Requesting fresh stream...`)
          // Fall through to getUserMedia logic below by not assigning it
          audioStream = undefined as any
        }
      }

      if (audioStream) {
        audioStreamToUse = audioStream
      } else {
        audioStreamToUse = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            channelCount: 1,
            sampleRate: 16000
          }
        })
      }
      streamRef.current = audioStreamToUse

      // Connect to WebSocket
      const ws = await connectWebSocket(speaker, newSessionId, diarize)
      wsRef.current = ws
      setIsConnected(true)
      setError(null)

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)

          if (data.type === 'connected') {
            console.log(`[TRACE-B] ${speaker} - STT stream CREATED`)
            reconnectAttemptsRef.current = 0 // Reset attempts on successful connection
            return
          }

          if (data.type === 'final') {
            // TRACE D: gotFinal
            transcriptCountRef.current++
            console.log(`[TRACE-D] ${speaker} - Got FINAL #${transcriptCountRef.current}: "${data.text.substring(0, 40)}..."`)

            // Handle speaker mapping during diarization
            let assignedSpeaker: 'salesperson' | 'prospect' = speaker
            if (isDiarizedRef.current && data.speakerTag) {
              // Map Tag 1 to salesperson, Tag 2 to prospect
              assignedSpeaker = data.speakerTag === 1 ? 'salesperson' : 'prospect'
              console.log(`[DIARIZE] Mapped Tag ${data.speakerTag} to ${assignedSpeaker.toUpperCase()}`)
            }

            const result: TranscriptResult = {
              text: data.text,
              isFinal: true,
              speaker: assignedSpeaker,
              confidence: data.confidence || 0,
              timestamp: data.timestamp || Date.now(),
              speakerTag: data.speakerTag || null
            }

            setTranscripts(prev => [...prev, result])
            setTranscriptCount(prev => prev + 1)
            setLastPartial(null)
            pendingPartialRef.current = null
            finalSilenceStartRef.current = null

            // DEDUPLICATION: Mark this text as server-finalized to prevent client-side duplicate
            serverFinalizedTextRef.current = data.text
            serverFinalizedTimeRef.current = Date.now()

            // Always update lastFinal and trigger callbacks
            lastFinalTextRef.current = data.text
            setLastFinal(result)

            // NEW: Diarization turn callback
            if (onSpeakerTurnRef.current) {
              onSpeakerTurnRef.current(result, assignedSpeaker)
            }

            // CRITICAL: Trigger onSpeechEnd if it's our speaker OR we are diarizing everything here
            if (onSpeechEndRef.current && (assignedSpeaker === speaker || isDiarizedRef.current)) {
              console.log(`[TRACE] ${speaker} - Triggering onSpeechEnd callback (server final)`)
              onSpeechEndRef.current(result)
            }
          } else if (data.type === 'partial') {
            // TRACE C: gotPartial
            console.log(`[TRACE-C] ${speaker} - Got partial:`, data.text.substring(0, 30))
            const result: TranscriptResult = {
              text: data.text,
              isFinal: false,
              speaker: speakerRef.current,
              confidence: data.confidence || 0,
              timestamp: data.timestamp || Date.now(),
            }
            setLastPartial(result)
            lastPartialRef.current = result
          }
        } catch (e) {
          console.error('[WS STT] Error parsing message:', e)
        }
      }

      ws.onclose = () => {
        // TRACE E: sttStreamEnded (WebSocket close)
        console.log(`[TRACE-E] ${speaker} - WebSocket CLOSED (finals received: ${transcriptCountRef.current})`)
        setIsConnected(false)

        // Auto-reconnect logic
        if (isStreaming && reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttemptsRef.current++

          setTimeout(async () => {
            try {
              if (!streamRef.current) return
              const newWs = await connectWebSocket(speaker, newSessionId, isDiarizedRef.current)
              wsRef.current = newWs
              setIsConnected(true)

              // Re-attach message handler
              newWs.onmessage = ws.onmessage
            } catch (err) {
              console.error(`[WS STT ${speaker}] ❌ Reconnect failed:`, err)
              if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
                setIsStreaming(false)
                setError('WebSocket connection lost. Please restart session.')
              }
            }
          }, 1000 * reconnectAttemptsRef.current) // Exponential backoff: 1s, 2s, 3s
        }
      }

      // Set up Web Audio API for PCM capture
      // 1. Recycle existing AudioContext if possible (must be NOT closed)
      let audioContext = audioContextRef.current
      if (!audioContext || audioContext.state === 'closed') {
        audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
        audioContextRef.current = audioContext
      }

      if (audioContext.state === 'suspended') {
        console.log(`[WS STT ${speaker}] Resuming AudioContext...`)
        try {
          await audioContext.resume()
        } catch (err) {
          console.warn(`[WS STT ${speaker}] Failed to resume AudioContext:`, err)
        }
      }
      console.log(`[WS STT ${speaker}] AudioContext state: ${audioContext.state}`)

      audioContextRef.current = audioContext

      // 2. Add a GainNode to boost the signal slightly for Google STT
      const gainNode = audioContext.createGain()
      // Use higher gain (5.0x) for diarization (in-room) to capture distant voices better
      gainNode.gain.value = isDiarizedRef.current ? 5.0 : 2.0

      const source = audioContext.createMediaStreamSource(audioStreamToUse)
      sourceRef.current = source
      source.connect(gainNode)

      // Create ScriptProcessor for raw PCM access
      // Buffer size: 4096 samples at 48kHz = ~85ms, we'll accumulate and resample
      const bufferSize = 4096
      const scriptProcessor = audioContext.createScriptProcessor(bufferSize, 1, 1)
      scriptProcessorRef.current = scriptProcessor
      gainNode.connect(scriptProcessor)

      let pcmAccumulator: number[] = []
      const targetBufferSize = 16000 * 0.1 // 100ms at 16kHz = 1600 samples

      scriptProcessor.onaudioprocess = (audioEvent) => {
        const now = Date.now()
        lastAudioProcessTimeRef.current = now // Mark that we're receiving callbacks (before any early return)

        // ALWAYS use the current WS reference (it might change during rollover)
        const currentWs = wsRef.current
        if (!currentWs || currentWs.readyState !== WebSocket.OPEN) return

        const inputBuffer = audioEvent.inputBuffer
        const inputData = inputBuffer.getChannelData(0) // Mono

        // Calculate RMS for audio validation
        const rms = calculateRMS(inputData)
        rmsHistoryRef.current.push(rms)
        if (rmsHistoryRef.current.length > 30) rmsHistoryRef.current.shift()
        const avgRMS = rmsHistoryRef.current.reduce((a, b) => a + b, 0) / rmsHistoryRef.current.length
        const normalizedLevel = Math.min(100, Math.round(avgRMS * 500))
        audioLevelRef.current = audioLevelRef.current * 0.7 + normalizedLevel * 0.3
        setAudioLevel(Math.round(audioLevelRef.current))

        if (avgRMS > 0.0001) {
          lastActiveTimeRef.current = now
        }

        // Detect silent buffer bug: If RMS is exactly 0 for 4 seconds, the browser audio stack is stuck
        if (now - lastActiveTimeRef.current > 4000 && isStreamingRef.current) {
          console.warn(`[SILENT BUFFER BUG] ${speaker} - Buffer is 0.0000. FORCING HARDWARE RESET...`)
          lastActiveTimeRef.current = now // Prevent loop
          startAutomatic()
          return
        }

        // Log pulse every ~5 seconds to show activity
        if (now % 5000 < 100) {
          console.log(`[WS STT ${speaker}] 🎵 Audio Pulse: capturing... (RMS: ${avgRMS.toFixed(4)})`)
        }

        // Detect speech/silence
        if (avgRMS > RMS_THRESHOLD) {
          if (!isSpeakingRef.current) {
            isSpeakingRef.current = true
            setIsSpeaking(true)
          }
          silenceStartRef.current = null
          finalSilenceStartRef.current = null
        } else {
          if (isSpeakingRef.current) {
            if (!silenceStartRef.current) {
              silenceStartRef.current = now
            } else if (now - silenceStartRef.current > SILENCE_THRESHOLD_MS) {
              isSpeakingRef.current = false
              setIsSpeaking(false)
              finalSilenceStartRef.current = now
            }
          }
        }

        // ALWAYS send audio to prevent Google STT timeout
        // Resample from input rate to 16000Hz
        const inputSampleRate = audioContext.sampleRate
        const resampled = resampleAudio(inputData, inputSampleRate)

        // Accumulate
        pcmAccumulator.push(...resampled)

        // Send when we have 100ms of audio (Better balance for network/speed)
        const sendBufferSize = 16000 * 0.1 // 100ms at 16kHz = 1600 samples
        while (pcmAccumulator.length >= sendBufferSize) {
          const pcmData = new Int16Array(pcmAccumulator.slice(0, sendBufferSize))
          pcmAccumulator = pcmAccumulator.slice(sendBufferSize)

          // Send to WebSocket (ALWAYS check fresh ref)
          const wsToSend = wsRef.current
          if (wsToSend && wsToSend.readyState === WebSocket.OPEN) {
            bytesSentRef.current += pcmData.byteLength
            wsToSend.send(pcmData.buffer)

            // Log data volume every ~1MB
            if (Math.floor(bytesSentRef.current / (1024 * 1024)) > Math.floor((bytesSentRef.current - pcmData.byteLength) / (1024 * 1024))) {
              const totalMB = (bytesSentRef.current / (1024 * 1024)).toFixed(1)
              console.log(`[WS STT ${speaker}] 📤 Total audio sent: ${totalMB}MB`)
            }
          }
        }
      }

      // gainNode already connected to scriptProcessor earlier
      scriptProcessor.connect(audioContext.destination)

      setIsStreaming(true)
      isStreamingRef.current = true
      lastAudioProcessTimeRef.current = Date.now()

      // Start Watchdog: Use ref to avoid stale state in interval
      if (watchdogIntervalRef.current) clearInterval(watchdogIntervalRef.current)
      watchdogIntervalRef.current = setInterval(() => {
        const now = Date.now()
        const timeSinceLastAudio = now - lastAudioProcessTimeRef.current

        if (isStreamingRef.current && timeSinceLastAudio > 5000) {
          console.warn(`[WATCHDOG] ${speaker} - 🔥 NO AUDIO CAPTURE FOR ${timeSinceLastAudio}ms. FORCE RESTARTING...`)
          startAutomatic()
        }
      }, 2000)

      console.log(`[WS STT ${speaker}] ✅ Audio processing started (stream active: ${audioStreamToUse.active})`)

      // Periodically resume AudioContext if suspended (e.g. side panel lost focus) so TRACE-C/TRACE-D can receive partials/finals
      if (resumeCheckIntervalRef.current) clearInterval(resumeCheckIntervalRef.current)
      resumeCheckIntervalRef.current = setInterval(() => {
        const ctx = audioContextRef.current
        if (ctx && ctx.state === 'suspended' && isStreamingRef.current) {
          ctx.resume().then(() => {
            console.log(`[WS STT ${speaker}] AudioContext resumed (was suspended)`)
          }).catch(() => {})
        }
      }, 3000)
    } catch (err) {
      console.error(`[WS STT ${speaker}] ❌ Error starting stream:`, err)
      setError(err instanceof Error ? err.message : 'Failed to start stream')
    }
  }, [connectWebSocket, resampleAudio, calculateRMS]) // Removed isStreaming dependency

  const stopStream = useCallback(async (keepTracks = false) => {
    if (isStoppingRef.current) return
    isStoppingRef.current = true

    const sessionId = sessionIdRef.current
    console.log(`[TRACE-STOP] ${speakerRef.current} - stopStream(keepTracks=${keepTracks}) for ${sessionId}`)

    setIsStreaming(false)
    isStreamingRef.current = false
    reconnectAttemptsRef.current = 0

    if (wsRef.current) {
      wsRef.current.onclose = null // Prevent triggering auto-reconnect
      wsRef.current.close()
      wsRef.current = null
    }

    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect()
      scriptProcessorRef.current = null
    }

    if (sourceRef.current) {
      sourceRef.current.disconnect()
      sourceRef.current = null
    }

    // Only close AudioContext if we are NOT doing a rollover (keepTracks = false)
    // OR if we are forcing a full hardware reset (forceKillContext = true)
    // This is crucial for fixing the "In-Room Death" bug
    if (audioContextRef.current && (!keepTracks || ((window as any).forceKillContext))) {
      try {
        if (audioContextRef.current.state !== 'closed') {
          await audioContextRef.current.close()
        }
      } catch (e) {
        console.warn('Error closing AudioContext:', e)
      }
      audioContextRef.current = null
    }

    if (watchdogIntervalRef.current) {
      clearInterval(watchdogIntervalRef.current)
      watchdogIntervalRef.current = null
    }
    if (resumeCheckIntervalRef.current) {
      clearInterval(resumeCheckIntervalRef.current)
      resumeCheckIntervalRef.current = null
    }

    if (streamRef.current && !keepTracks) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }

    console.log(`[TRACE-STOP] ${speakerRef.current} - Stream stopped for ${sessionId}`)
    isStoppingRef.current = false
  }, [])

  const startAutomatic = useCallback(async () => {
    const speaker = speakerRef.current
    const oldSessionId = sessionIdRef.current
    const existingStream = streamRef.current

    if (!speaker) {
      console.warn('[AUTO-START] No speaker identified, cannot start.')
      return
    }

    console.log(`[TRACE-AUTO] ${speaker} - 🔄 Starting NEW stream automatically (replacing ${oldSessionId})...`)

      // 1. Stop processing but keep audio tracks alive to avoid reprompting
      // FORCE KILL: Signal stopStream to kill the AudioContext even though we keep tracks
      ; (window as any).forceKillContext = true
    stopStream(true)
      ; (window as any).forceKillContext = false

    // 2. Larger delay to ensure hardware/stack is fully released
    await new Promise(resolve => setTimeout(resolve, 800))

    // 3. Start from fresh with internal nodes
    try {
      // Re-verify stream is still alive
      if (existingStream && existingStream.getTracks().some(t => t.readyState === 'ended')) {
        console.warn(`[TRACE-AUTO] ${speaker} - Existing stream died during restart. Dropping.`)
        // Pass undefined to force re-acquisition
        await startStream(speaker, undefined, isDiarizedRef.current)
      } else {
        await startStream(speaker, existingStream || undefined, isDiarizedRef.current)
      }
      console.log(`[TRACE-AUTO] ${speaker} - ✅ AUTO-START COMPLETE (Context Recreated)`)
    } catch (err) {
      console.error(`[TRACE-AUTO] ${speaker} - ❌ AUTO-START FAILED:`, err)
      setError(`Auto-start failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [stopStream, startStream])

  useEffect(() => {
    return () => { void stopStream() }
  }, [stopStream])

  // Keep AudioContext running when side panel becomes visible (Chrome often suspends when panel loses focus; no audio = no TRACE-C)
  useEffect(() => {
    const onVisibilityChange = () => {
      if (typeof document === 'undefined' || document.visibilityState !== 'visible') return
      const ctx = audioContextRef.current
      if (ctx && ctx.state === 'suspended') {
        ctx.resume().then(() => {
          console.log('[WS STT] AudioContext resumed on visibility (was suspended)')
        }).catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [])

  return {
    isConnected,
    isStreaming,
    transcripts,
    lastFinal,
    lastPartial,
    audioLevel,
    isSpeaking,
    transcriptCount,
    sessionId: sessionIdRef.current,
    startStream,
    stopStream,
    error,
    onSpeechEnd,
    startAutomatic
  }
}
