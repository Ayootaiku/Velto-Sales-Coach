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
  isInputEnabled: boolean
  setIsInputEnabled: (enabled: boolean) => void
  startStream: (speaker: 'salesperson' | 'prospect', stream?: MediaStream, diarize?: boolean, externalSessionId?: string) => Promise<void>
  stopStream: (keepTracks?: boolean, forceKillContext?: boolean) => Promise<void>
  startAutomatic: (speakerOverride?: 'salesperson' | 'prospect') => Promise<void>
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
  const [isInputEnabled, setIsInputEnabled] = useState(true)

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
  const healthCheckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastServerMessageTimeRef = useRef<number>(0)
  const watchdogAliveIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const onSpeechEndRef = useRef(onSpeechEnd)
  const onSpeakerTurnRef = useRef(onSpeakerTurn)
  const isDiarizedRef = useRef(false)
  const startInProgressRef = useRef(false)
  const watchdogEnabledRef = useRef(false)
  const externalSessionIdRef = useRef<string | null>(null)
  const isInputEnabledRef = useRef(true)

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

  useEffect(() => {
    isInputEnabledRef.current = isInputEnabled
  }, [isInputEnabled])

  const MAX_RECONNECT_ATTEMPTS = 999999 // Effectively infinite — never give up until user stops session
  const MAX_RECONNECT_DELAY_MS = 2000 // Cap delay so recovery stays quick (was 1s, 2s, 3s... forever)
  const CONNECTION_HEALTH_CHECK_MS = 15000 // Check every 15s
  const CONNECTION_HEALTH_DEAD_MS = 20000 // No server message for 20s → full restart
  const WATCHDOG_ALIVE_LOG_MS = 30000 // Log "watchdog alive" every 30s so user sees new code is loaded
  // We do NOT restart on silence (4s/8s) — that was killing the connection; only restart on no callbacks (15s) or no server msg (20s).

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
  const connectWebSocket = useCallback(async (
    speaker: 'salesperson' | 'prospect', 
    sessionId: string, 
    diarize = false,
    onMessage?: (e: MessageEvent) => void,
    onClose?: (e: CloseEvent) => void,
    onError?: (e: Event) => void
  ): Promise<WebSocket> => {
    const params = `?session=${sessionId}&speaker=${speaker}${diarize ? '&diarize=true' : ''}`

    // Production/Manifest standard: prioritize cloud production server (Railway) to ensure website matches extension performance
    const inExtension = typeof chrome !== 'undefined' && !!chrome.runtime?.id
    const railwayWss = (typeof import.meta !== 'undefined' && (import.meta as { env?: { VITE_RAILWAY_WSS?: string } }).env?.VITE_RAILWAY_WSS) || ''
    const railwayFallback = 'wss://velto-sales-coach-production.up.railway.app'

    // TRACE-A Log enhancement for visibility: Universal fallback to production just like manifest context
    const cloudBase = _wssBaseUrl || railwayWss || railwayFallback

    if (cloudBase) {
      console.log(`[TRACE-A] ${speaker} - Using production system (Cloud): ${cloudBase}`)
      return new Promise((resolve, reject) => {
        console.log(`[TRACE-A] ${speaker} - Connecting to cloud WSS: ${cloudBase}`)
        const ws = new WebSocket(`${cloudBase}${params}`)
        if (onMessage) ws.onmessage = onMessage
        if (onClose) ws.onclose = onClose
        ws.onopen = () => { console.log(`[TRACE-A] ${speaker} - Cloud WSS CONNECTED`); resolve(ws) }
        ws.onerror = (e) => { 
          if (onError) onError(e)
          reject(new Error('Cloud WSS failed')) 
        }
      })
    }

    const tryPort = (port: number): Promise<WebSocket> => {
      return new Promise((resolve, reject) => {
        console.log(`[TRACE-A] ${speaker} - Trying WebSocket on port ${port}... (diarize: ${diarize})`)
        const ws = new WebSocket(`ws://localhost:${port}${params}`)
        if (onMessage) ws.onmessage = onMessage
        if (onClose) ws.onclose = onClose
        ws.onopen = () => { console.log(`[TRACE-A] ${speaker} - WebSocket CONNECTED on port ${port}`); resolve(ws) }
        ws.onerror = (e) => { 
          if (onError) onError(e)
          reject(new Error(`Failed on port ${port}`)) 
        }
      })
    }

    const currentPort = typeof window !== 'undefined' ? parseInt(window.location.port) : 0
    const ports = Array.from(new Set([currentPort, 3000, 3002, 3003, 3004, 3005, 3006, 3007, 3008, 3009, 3010].filter(p => p > 0)))
    let lastError: Error | null = null
    for (const port of ports) {
      try { return await tryPort(port) } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        console.log(`[TRACE-A] ${speaker} - Port ${port} failed, trying next...`)
      }
    }
    console.error(`[WS STT ${speaker}] All ports failed (3002-3010)`)
    throw lastError || new Error('WebSocket connection failed - server may not be running')
  }, [_wssBaseUrl])


  const startStream = useCallback(async (speaker: 'salesperson' | 'prospect', audioStream?: MediaStream, diarize = false, externalSessionId?: string) => {
    if (startInProgressRef.current) {
      console.warn(`[WS STT ${speaker}] startStream ignored - already in progress`)
      return
    }
    startInProgressRef.current = true

    // Reset intentional-close flag for fresh session so legitimate 1006s
    // during this session will correctly trigger reconnect
    isStoppingRef.current = false

    try {
      speakerRef.current = speaker
      isDiarizedRef.current = diarize

      // Generate session ID or use external one
      const newSessionId = externalSessionId || `${speaker}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
      externalSessionIdRef.current = externalSessionId || null
      sessionIdRef.current = newSessionId
      transcriptCountRef.current = 0
      bytesSentRef.current = 0
      reconnectAttemptsRef.current = 0
      isStoppingRef.current = false

      console.log(`[TRACE] ${speaker} - Starting STT stream with session: ${newSessionId} (Logic: v1.2.6-FINAL-FIX)`)

      // Get audio stream
      let audioStreamToUse: MediaStream
      if (audioStream) {
        // VALIDATION: If caller provided a stream, it must be live. Do NOT fall back to mic (would be wrong for prospect/tab audio).
        const tracks = audioStream.getTracks()
        const isActive = audioStream.active && tracks.length > 0 && tracks.every(t => t.readyState === 'live')

        if (!isActive) {
          const msg = 'Provided media stream is inactive or ended. Please share the tab again.'
          console.warn(`[WS STT ${speaker}] ${msg}`)
          throw new Error(msg)
        }
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

      const messageHandler = (event: MessageEvent) => {
        // SESSION ISOLATION: Ignore messages from ghost sessions
        if (newSessionId !== sessionIdRef.current) {
          return;
        }

        try {
          const data = JSON.parse(event.data)
          lastServerMessageTimeRef.current = Date.now()

          if (data.type === 'connected') {
            console.log(`[TRACE-B] ${speaker} - STT stream CREATED (session=${newSessionId})`)
            reconnectAttemptsRef.current = 0 // Reset attempts on successful connection
            setIsConnected(true)
            if (speaker === 'prospect') console.log('[prospect] stream connected = true (server confirmed)')
            return
          }

          if (data.type === 'heartbeat') {
            // Respond to keep Railway's proxy connection alive natively even if Chrome throttles JS
            const currentWs = wsRef.current;
            if (currentWs && currentWs.readyState === WebSocket.OPEN) {
              currentWs.send(JSON.stringify({ type: 'pong' }));
            }
            return
          }

          if (data.type === 'error') {
            console.error(`[WS STT ${speaker}] ❌ Server Error:`, data.message)
            setError(data.message)
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
            // TRACE C: gotPartial — keep backoff reset so next disconnect recovers quickly
            reconnectAttemptsRef.current = 0
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

      const closeHandler = (e?: CloseEvent) => {
        // CLOSE ISOLATION: Ensure this handler only acts on the session it belongs to.
        if (newSessionId !== sessionIdRef.current) {
          console.log(`[WS STT ${speaker}] Ignoring ghost CLOSE event from previous session: ${newSessionId}`);
          return;
        }

        // Close code: 1000=normal, 1006=abnormal (no close frame received — connection dropped)
        const code = e?.code ?? '?'
        const reason = e?.reason ?? '?'
        console.log(`[TRACE-E] ${speaker} - WebSocket CLOSED code=${code} reason=${reason} sessionId=${newSessionId} (finals received: ${transcriptCountRef.current}) isStoppingRef=${isStoppingRef.current}`)

        // SILENT RECONNECT on 1006 (Abnormal Closure)
        if (code === 1006 && isStreamingRef.current && !isStoppingRef.current) {
          console.warn(`[RECOVERY] 1006 Detected for ${speaker}. Attempting silent reconnect...`)
          setTimeout(() => {
            if (wsRef.current?.readyState !== WebSocket.OPEN) {
              setIsConnected(false)
            }
          }, 2000)

          startAutomatic().catch(err => {
            console.error('[RECOVERY] Silent reconnect failed:', err)
            setIsConnected(false)
          })
          return
        }

        // NOW safe to reset — the 1006 check above already saw the true value
        isStoppingRef.current = false
        setIsConnected(false)
      }

      console.log('[WS STT] startStream for', speaker, 'sessionId', newSessionId, 'streamActive', audioStreamToUse?.active)
      // Connect to WebSocket with handlers attached from the start
      const ws = await connectWebSocket(speaker, newSessionId, diarize, messageHandler, closeHandler, (evt) => {
        if (newSessionId === sessionIdRef.current) {
          console.error('[WS STT] WebSocket failed to connect or error during handshake', speaker, newSessionId, evt)
        }
      })

      // RACE-TO-START GUARD: If stopStream was called while we were awaiting connection, 
      // the new WebSocket is now a ZOMBIE. Close it immediately.
      if (isStoppingRef.current || sessionIdRef.current !== newSessionId) {
        console.warn(`[WS STT ${speaker}] Start was aborted during connection. Closing zombie WS ${newSessionId}`)
        try { ws.close() } catch (_) { /* ignore */ }
        return
      }

      wsRef.current = ws
      setIsConnected(true)
      if (speaker === 'prospect') console.log('[prospect] stream connected = true')
      setError(null)
      lastServerMessageTimeRef.current = Date.now()
      watchdogEnabledRef.current = true
      
      // Mark streaming true as soon as we have a live connection so 1006 during setup triggers reconnect (second-session fix)
      setIsStreaming(true)
      isStreamingRef.current = true

      // Set up Web Audio API for PCM capture
      // Always create a new AudioContext so every session is fresh (avoids "works once" after refresh).
      const existingCtx = audioContextRef.current
      if (existingCtx) {
        console.log(`[WS STT ${speaker}] Cleaning up previous AudioContext before new session...`)
        try {
          if (existingCtx.state !== 'closed') {
            await existingCtx.close()
          }
        } catch (e) {
          console.warn('Error closing old AudioContext during restart:', e)
        }
        audioContextRef.current = null
      }
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
      audioContextRef.current = audioContext

      if (audioContext.state === 'suspended') {
        console.log(`[WS STT ${speaker}] Resuming AudioContext...`)
        try {
          await audioContext.resume()
        } catch (err) {
          console.warn(`[WS STT ${speaker}] Failed to resume AudioContext:`, err)
        }
      }
      console.log(`[WS STT ${speaker}] AudioContext state: ${audioContext.state}`)

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
        
        // SKIP sending if input is disabled (manual speaker switching in In-Room mode)
        if (!isInputEnabledRef.current) return

        // Do NOT restart on silence (4s/8s zero RMS) — keeps connection up so prospectStream.isConnected stays true; only no-audio 15s and connection-health 20s trigger restart.

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

            // Log data volume every ~100KB for better visibility during short calls
            if (Math.floor(bytesSentRef.current / (100 * 1024)) > Math.floor((bytesSentRef.current - pcmData.byteLength) / (100 * 1024))) {
              const totalKB = (bytesSentRef.current / 1024).toFixed(0)
              console.log(`[WS STT ${speaker}] 📤 Audio sent: ${totalKB}KB`)
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
        const isWatchdogActive = watchdogEnabledRef.current
 
        // Only restart if no audio callbacks for 15s (was 5s — avoid killing during tab throttle or slow capture start)
        if (isWatchdogActive && isStreamingRef.current && timeSinceLastAudio > 15000) {
          console.warn(`[WATCHDOG] ${speaker} - 🔥 NO AUDIO CAPTURE FOR ${timeSinceLastAudio}ms. FORCE RESTARTING...`)
          startAutomatic()
        }
      }, 2000)

      // Connection-health watchdog: if server stops sending anything (e.g. proxy, stuck stream), full restart
      if (healthCheckIntervalRef.current) clearInterval(healthCheckIntervalRef.current)
      healthCheckIntervalRef.current = setInterval(() => {
        const now = Date.now()
        const timeSinceLastServerMessage = now - lastServerMessageTimeRef.current
        const isWatchdogActive = watchdogEnabledRef.current
        if (isWatchdogActive && lastServerMessageTimeRef.current > 0 && isStreamingRef.current && timeSinceLastServerMessage > CONNECTION_HEALTH_DEAD_MS) {
          console.warn(`[WATCHDOG] ${speaker} - No server message for ${timeSinceLastServerMessage}ms. FORCE RESTARTING...`)
          startAutomatic()
        }
      }, CONNECTION_HEALTH_CHECK_MS)

      console.log(`[WS STT ${speaker}] ✅ Audio processing started (stream active: ${audioStreamToUse.active})`)
      // Ensure prospect STT indicator is true when pipeline is fully up (first or second session)
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        setIsConnected(true)
        if (speaker === 'prospect') console.log('[prospect] stream connected = true (pipeline up)')
      }
      console.warn(`[WATCHDOG] *** ENABLED *** ${speaker}: No-audio 15s | Connection-health 20s | Overlay recovery 7s (no reconnect on close, no silence restart)`)
      console.log(`[WATCHDOG] ${speaker} - Watchdogs active: no-audio 15s, connection-health 20s`)

      // Periodic "watchdog alive" log so user can confirm new code is running (every 30s)
      if (watchdogAliveIntervalRef.current) clearInterval(watchdogAliveIntervalRef.current)
      watchdogAliveIntervalRef.current = setInterval(() => {
        if (isStreamingRef.current) {
          const noAudio = Math.round((Date.now() - lastAudioProcessTimeRef.current) / 1000)
          const noServer = lastServerMessageTimeRef.current > 0 ? Math.round((Date.now() - lastServerMessageTimeRef.current) / 1000) : -1
          console.log(`[WATCHDOG] ${speaker} - alive | last audio ${noAudio}s ago | last server msg ${noServer >= 0 ? noServer + 's ago' : 'n/a'}`)
        }
      }, WATCHDOG_ALIVE_LOG_MS)
    } catch (err) {
      console.error(`[WS STT ${speaker}] ❌ Error starting stream:`, err)
      setError(err instanceof Error ? err.message : 'Failed to start stream')
    } finally {
      startInProgressRef.current = false
    }
  }, [connectWebSocket, resampleAudio, calculateRMS]) // Removed isStreaming dependency

  const stopStream = useCallback(async (keepTracks = false, forceKillContext = false) => {
    // Prevent double-stopping
    if (isStoppingRef.current && !forceKillContext) return
    isStoppingRef.current = true

    const sessionId = sessionIdRef.current
    const speaker = speakerRef.current
    console.log(`[STOP] ${speaker} - Rebuilding session termination (sessionId=${sessionId}, keepTracks=${keepTracks})`)

    // 1. Immediately disable UI and state
    setIsStreaming(false)
    isStreamingRef.current = false
    watchdogEnabledRef.current = false
    setIsConnected(false)
    reconnectAttemptsRef.current = 0

    // 2. Clear ALL Watchdogs immediately so no restarts happen during cleanup
    if (watchdogIntervalRef.current) {
      clearInterval(watchdogIntervalRef.current)
      watchdogIntervalRef.current = null
    }
    if (healthCheckIntervalRef.current) {
      clearInterval(healthCheckIntervalRef.current)
      healthCheckIntervalRef.current = null
    }
    if (watchdogAliveIntervalRef.current) {
      clearInterval(watchdogAliveIntervalRef.current)
      watchdogAliveIntervalRef.current = null
    }

    // 3. Close WebSocket and detach handlers
    if (wsRef.current) {
      console.log(`[STOP] ${speaker} - Closing WebSocket`)
      const ws = wsRef.current
      ws.onmessage = null
      ws.onclose = null
      ws.onerror = null
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        console.log(`[STOP] ${speaker} - Sending explicit closure: 1000 'Session ended'`)
        try { ws.close(1000, 'Session ended') } catch (_) { /* ignore */ }
      }
      wsRef.current = null
    }

    // 4. Disconnect and Dispose Audio Nodes
    if (scriptProcessorRef.current) {
      try {
        scriptProcessorRef.current.onaudioprocess = null
        scriptProcessorRef.current.disconnect()
      } catch (_) { /* ignore */ }
      scriptProcessorRef.current = null
    }

    if (sourceRef.current) {
      try {
        sourceRef.current.disconnect()
      } catch (_) { /* ignore */ }
      sourceRef.current = null
    }

    // 5. Hard Reset AudioContext to free hardware locks
    const audioContext = audioContextRef.current
    if (audioContext && (!keepTracks || forceKillContext)) {
      console.log(`[STOP] ${speaker} - Closing AudioContext to release hardware`)
      try {
        if (audioContext.state !== 'closed') {
          await audioContext.close()
        }
      } catch (e) {
        console.warn('[STOP] AudioContext close error:', e)
      }
      audioContextRef.current = null
    }

    // 6. Stop MediaStream Tracks (unless requested to keep alive, e.g. for In-Room rollover)
    if (streamRef.current && !keepTracks) {
      console.log(`[STOP] ${speaker} - Stopping MediaStream tracks`)
      try {
        streamRef.current.getTracks().forEach(track => track.stop())
      } catch (_) { /* ignore */ }
      streamRef.current = null
    }

    console.log(`[STOP] ${speaker} - Termination complete for ${sessionId}`)
    // NOTE: isStoppingRef stays true until a fresh startStream resets it.
  }, [])

  const startAutomatic = useCallback(async (speakerOverride?: 'salesperson' | 'prospect') => {
    const speaker = speakerOverride || speakerRef.current
    const oldSessionId = sessionIdRef.current
    const existingStream = streamRef.current

    if (!speaker) {
      console.warn('[AUTO-START] No speaker identified, cannot start.')
      return
    }

    console.log(`[TRACE-AUTO] ${speaker} - 🔄 Starting NEW stream automatically (replacing ${oldSessionId})...`)

    // 1. Stop processing but keep audio tracks alive to avoid reprompting
    // We pass true for forceKillContext to ensure the AudioContext is fully reset
    await stopStream(true, true)

    // 2. Delay so hardware/stack is released before new stream (reduces TRACE-C gap on restart)
    await new Promise(resolve => setTimeout(resolve, 800))

    // 3. Start from fresh with internal nodes
    try {
      // Re-verify stream is still alive
      if (existingStream && existingStream.getTracks().some(t => t.readyState === 'ended')) {
        console.warn(`[TRACE-AUTO] ${speaker} - Existing stream died during restart. Dropping.`)
        // Pass undefined to force re-acquisition
        await startStream(speaker, undefined, isDiarizedRef.current, externalSessionIdRef.current || undefined)
      } else {
        await startStream(speaker, existingStream || undefined, isDiarizedRef.current, externalSessionIdRef.current || undefined)
      }
      console.log(`[TRACE-AUTO] ${speaker} - ✅ AUTO-START COMPLETE (Context Recreated)`)
    } catch (err) {
      console.error(`[TRACE-AUTO] ${speaker} - ❌ AUTO-START FAILED:`, err)
      setError(`Auto-start failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [stopStream, startStream])

  useEffect(() => {
    return () => {
      // In extension side panel, do not stop stream on unmount (e.g. panel hide/recreate).
      // Otherwise the trace (A→E) is killed and "LISTENING" breaks. Stream only stops on End Call or startAutomatic.
      const inExtension = typeof chrome !== 'undefined' && !!chrome.runtime?.id
      if (inExtension && isStreamingRef.current) return
      void stopStream()
    }
  }, [stopStream])

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
    isInputEnabled,
    setIsInputEnabled,
    startStream,
    stopStream,
    error,
    onSpeechEnd,
    startAutomatic
  }
}
