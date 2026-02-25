"use client"

import { useState, useCallback, useRef, useEffect } from 'react'

export interface TranscriptResult {
  text: string
  isFinal: boolean
  speaker: 'salesperson' | 'prospect'
  confidence: number
  timestamp: number
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
  startStream: (speaker: 'salesperson' | 'prospect', stream?: MediaStream) => Promise<void>
  stopStream: () => void
  error: string | null
  onSpeechEnd?: (transcript: TranscriptResult) => void
}

const SILENCE_THRESHOLD_MS = 200 // Reduced for much faster response
const FINAL_SILENCE_THRESHOLD_MS = 800 // Time to wait before treating partial as final
const CHUNK_INTERVAL_MS = 100
const SMOOTHING_FACTOR = 0.3

export function useSTTStream(onSpeechEnd?: (transcript: TranscriptResult) => void): UseSTTStreamReturn {
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
  const eventSourceRef = useRef<EventSource | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const isSpeakingRef = useRef(false)
  const silenceStartRef = useRef<number | null>(null)
  const lastFinalTextRef = useRef<string>('')
  const audioLevelRef = useRef(0)
  const speakerRef = useRef<'salesperson' | 'prospect'>('salesperson')
  const pendingPartialRef = useRef<TranscriptResult | null>(null)
  const finalSilenceStartRef = useRef<number | null>(null)
  const lastPartialRef = useRef<TranscriptResult | null>(null)

  // Generate unique session ID
  const getSessionId = useCallback(() => {
    return sessionIdRef.current
  }, [])

  // Start streaming
  const startStream = useCallback(async (speaker: 'salesperson' | 'prospect', stream?: MediaStream) => {
    console.log(`[STT Stream ${speaker}] === STARTING STREAM ===`)
    try {
      setError(null)
      speakerRef.current = speaker

      const newSessionId = `session-${speaker}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
      sessionIdRef.current = newSessionId
      console.log(`[STT Stream ${speaker}] Session ID: ${newSessionId.substring(0, 12)}...`)

      // Get audio stream
      let audioStream = stream
      if (!audioStream) {
        console.log(`[STT Stream ${speaker}] Getting user media...`)
        audioStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            sampleRate: 48000,
          }
        })
        console.log(`[STT Stream ${speaker}] ✅ Got user media`)
      }

      streamRef.current = audioStream

      // 1. Initialize Google STT session FIRST via POST
      const startUrl = `/api/stt/stream?session=${newSessionId}`
      console.log(`[STT Stream ${speaker}] Initializing STT session at:`, startUrl)
      console.log(`[STT Stream ${speaker}] Full URL:`, typeof window !== 'undefined' ? window.location.origin + startUrl : startUrl)

      const startRes = await fetch(startUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache'
        },
        body: JSON.stringify({
          action: 'start',
          speaker,
        }),
      })

      console.log(`[STT Stream ${speaker}] STT init response:`, startRes.status, startRes.statusText)

      if (!startRes.ok) {
        const errorText = await startRes.text()
        console.error(`[STT Stream ${speaker}] ❌ Failed to start session:`, startRes.status, errorText)
        setError(`Failed to start: ${startRes.status} - ${errorText}`)
        throw new Error(`Failed to start STT session: ${startRes.status} - ${errorText}`)
      }

      console.log(`[STT Stream ${speaker}] ✅ STT session initialized`)

      // 2. NOW connect to SSE for transcripts and wait for connection
      console.log(`[STT Stream ${speaker}] Creating EventSource for SSE...`)

      const eventSource = new EventSource(`/api/stt/stream?session=${newSessionId}`)
      eventSourceRef.current = eventSource

      // Track if we've received the connected message
      let connectedReceived = false

      // Set up message handler FIRST (before waiting for connection)
      // This ensures we don't miss any messages
      // Set up message handler FIRST to catch all messages including "connected"
      eventSource.onmessage = (event) => {
        try {
          console.log(`[STT Stream ${speaker}] Raw message received:`, event.data?.substring(0, 100))
          const data = JSON.parse(event.data)
          console.log(`[STT Stream ${speaker}] Parsed event:`, { type: data.type, text: data.text?.substring(0, 30) })

          if (data.type === 'connected') {
            console.log(`[STT Stream ${speaker}] Connected event received`)
            connectedReceived = true
            setIsConnected(true)
            return
          }

          if (data.type === 'error') {
            console.error(`[STT Stream ${speaker}] ❌ Server error:`, data.message)
            setError(data.message || 'STT stream error')
            return
          }

          if (data.type === 'final') {
            console.log(`[STT Stream ${speaker}] ✅ FINAL TRANSCRIPT: "${data.text}"`)
            const result: TranscriptResult = {
              text: data.text,
              isFinal: true,
              speaker: data.speaker,
              confidence: data.confidence,
              timestamp: data.timestamp,
            }

            setTranscripts(prev => [...prev, result])
            setTranscriptCount(prev => prev + 1)

            // Clear any pending partial
            setLastPartial(null)
            lastPartialRef.current = null
            pendingPartialRef.current = null
            finalSilenceStartRef.current = null

            if (data.text !== lastFinalTextRef.current) {
              lastFinalTextRef.current = data.text
              console.log(`[STT Stream ${speaker}] Setting lastFinal to: "${data.text.substring(0, 30)}..."`)
              setLastFinal(result)
            } else {
              console.log(`[STT Stream ${speaker}] Duplicate transcript, skipping`)
            }
          } else if (data.type === 'partial') {
            console.log(`[STT Stream ${speaker}] 📝 PARTIAL: "${data.text?.substring(0, 30)}..."`)
            const result: TranscriptResult = {
              text: data.text,
              isFinal: false,
              speaker: data.speaker || speakerRef.current,
              confidence: data.confidence || 0,
              timestamp: data.timestamp || Date.now(),
            }
            setLastPartial(result)
            lastPartialRef.current = result
          } else {
            console.log(`[STT Stream ${speaker}] Unknown event type:`, data.type)
          }
        } catch (e) {
          console.error('[STT Stream] Error parsing event:', e, 'Raw data:', event.data)
        }
      }

      // Wait for SSE connection with timeout
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('SSE connection timeout'))
        }, 5000)

        const checkConnected = setInterval(() => {
          if (connectedReceived) {
            clearTimeout(timeout)
            clearInterval(checkConnected)
            console.log(`[STT Stream ${speaker}] ✅ SSE connected and ready`)
            setIsConnected(true)
            setError(null)
            resolve()
          }
        }, 100)

        eventSource.onerror = (err) => {
          clearTimeout(timeout)
          clearInterval(checkConnected)
          console.error(`[STT Stream ${speaker}] ❌ SSE error:`, err)
          setError('SSE connection failed')
          setIsConnected(false)
          reject(new Error('SSE connection failed'))
        }
      })

      // Set up audio analysis
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()

      if (audioContext.state === 'suspended') {
        await audioContext.resume()
      }

      audioContextRef.current = audioContext

      const source = audioContext.createMediaStreamSource(audioStream)
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = SMOOTHING_FACTOR
      source.connect(analyser)
      analyserRef.current = analyser

      const mimeType = MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
        ? 'audio/ogg;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm'

      const recorder = new MediaRecorder(audioStream, {
        mimeType,
        audioBitsPerSecond: 128000,
      })

      mediaRecorderRef.current = recorder

      recorder.ondataavailable = async (event) => {
        if (event.data.size > 0) {
          console.log(`[STT Stream ${speaker}] 🎵 Audio chunk: ${event.data.size} bytes`)
          const arrayBuffer = await event.data.arrayBuffer()
          const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)))

          fetch(`/api/stt/stream?session=${newSessionId}&_t=${Date.now()}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Cache-Control': 'no-cache'
            },
            body: JSON.stringify({
              action: 'chunk',
              audioChunk: base64,
            }),
          }).catch((err) => {
            console.error(`[STT Stream ${speaker}] ❌ Failed to send chunk:`, err)
          })
        }
      }

      recorder.start(CHUNK_INTERVAL_MS)
      console.log(`[STT Stream ${speaker}] 🎙️ MediaRecorder started (state: ${recorder.state})`)
      setIsStreaming(true)

      const checkAudio = () => {
        if (!analyserRef.current || !recorder || recorder.state !== 'recording') return
        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount)
        analyserRef.current.getByteFrequencyData(dataArray)
        const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length
        const normalizedLevel = Math.min(100, Math.round((avg / 255) * 100))
        audioLevelRef.current = audioLevelRef.current * (1 - SMOOTHING_FACTOR) + normalizedLevel * SMOOTHING_FACTOR
        setAudioLevel(Math.round(audioLevelRef.current))

        if (avg > 10) {
          if (!isSpeakingRef.current) {
            isSpeakingRef.current = true
            setIsSpeaking(true)
          }
          silenceStartRef.current = null
          finalSilenceStartRef.current = null
        } else {
          if (isSpeakingRef.current) {
            if (!silenceStartRef.current) {
              silenceStartRef.current = Date.now()
            } else if (Date.now() - silenceStartRef.current > SILENCE_THRESHOLD_MS) {
              isSpeakingRef.current = false
              setIsSpeaking(false)
              // Speech just ended - start tracking for final silence
              finalSilenceStartRef.current = Date.now()
              // Save current partial as pending
              if (lastPartialRef.current?.text && lastPartialRef.current.text !== lastFinalTextRef.current) {
                pendingPartialRef.current = lastPartialRef.current
                console.log(`[STT Stream ${speakerRef.current}] 🎤 Speech ended, pending partial: "${lastPartialRef.current.text.substring(0, 30)}..."`)
              }
            }
          } else if (finalSilenceStartRef.current && pendingPartialRef.current) {
            // Check if we've been silent long enough to treat partial as final
            const silenceDuration = Date.now() - finalSilenceStartRef.current
            if (silenceDuration > FINAL_SILENCE_THRESHOLD_MS) {
              // Treat pending partial as final
              const finalResult: TranscriptResult = {
                ...pendingPartialRef.current,
                isFinal: true,
                timestamp: Date.now()
              }
              console.log(`[STT Stream ${speakerRef.current}] ✅ SILENCE FINALIZED: "${finalResult.text.substring(0, 40)}..."`)

              // Update state
              setTranscripts(prev => [...prev, finalResult])
              setTranscriptCount(prev => prev + 1)
              setLastPartial(null)
              lastFinalTextRef.current = finalResult.text
              setLastFinal(finalResult)

              // Call callback
              if (onSpeechEnd) {
                onSpeechEnd(finalResult)
              }

              // Clear pending
              pendingPartialRef.current = null
              finalSilenceStartRef.current = null
            }
          }
        }
        requestAnimationFrame(checkAudio)
      }
      checkAudio()

    } catch (err: any) {
      console.error('[STT Stream] Error:', err)
      setError(err.message || 'Failed to start stream')
      setIsStreaming(false)
      setIsConnected(false)
    }
  }, [])

  const stopStream = useCallback(async () => {
    const sessionId = sessionIdRef.current
    if (mediaRecorderRef.current?.state !== 'inactive') mediaRecorderRef.current?.stop()
    if (eventSourceRef.current) eventSourceRef.current.close()
    if (audioContextRef.current) await audioContextRef.current.close()
    if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop())

    try {
      await fetch(`/api/stt/stream?session=${sessionId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stop' }),
      })
    } catch (e) { }

    setIsStreaming(false)
    setIsConnected(false)
    setAudioLevel(0)
    setIsSpeaking(false)
    setLastPartial(null)
  }, [])

  useEffect(() => {
    return () => { void stopStream() }
  }, [stopStream])

  return { isConnected, isStreaming, transcripts, lastFinal, lastPartial, audioLevel, isSpeaking, transcriptCount, sessionId: sessionIdRef.current, startStream, stopStream, error }
}
