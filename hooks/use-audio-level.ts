"use client"

import { useState, useEffect, useCallback, useRef } from "react"

export interface AudioLevelState {
  level: number // 0-100
  isActive: boolean
}

export function useAudioLevel(stream: MediaStream | null) {
  const [state, setState] = useState<AudioLevelState>({
    level: 0,
    isActive: false,
  })

  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const rafRef = useRef<number | null>(null)
  const isActiveRef = useRef(false)
  const lastUpdateRef = useRef(0)

  const cleanup = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect()
      sourceRef.current = null
    }
    if (analyserRef.current) {
      analyserRef.current.disconnect()
      analyserRef.current = null
    }
    if (audioContextRef.current && audioContextRef.current.state !== "closed") {
      audioContextRef.current.close()
      audioContextRef.current = null
    }
    isActiveRef.current = false
  }, [])

  useEffect(() => {
    if (!stream) {
      cleanup()
      setState({ level: 0, isActive: false })
      return
    }

    const setupAudioAnalysis = async () => {
      try {
        // Create audio context
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext
        if (!AudioContextClass) {
          console.warn("AudioContext not supported")
          return
        }

        const audioContext = new AudioContextClass()
        audioContextRef.current = audioContext

        // Create analyser
        const analyser = audioContext.createAnalyser()
        analyser.fftSize = 256
        analyser.smoothingTimeConstant = 0.8
        analyserRef.current = analyser

        // Create source from stream
        const source = audioContext.createMediaStreamSource(stream)
        source.connect(analyser)
        sourceRef.current = source

        // Create data array for analysis
        const bufferLength = analyser.frequencyBinCount
        const dataArray = new Uint8Array(bufferLength)

        isActiveRef.current = true

        const analyze = () => {
          if (!isActiveRef.current || !analyserRef.current) return

          analyserRef.current.getByteFrequencyData(dataArray)

          // Calculate average volume
          let sum = 0
          for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i]
          }
          const average = sum / bufferLength

          // Normalize to 0-100 range
          const normalizedLevel = Math.min(100, Math.max(0, (average / 255) * 100 * 3))

          // Throttle state updates to every 100ms to prevent React re-render loop
          const now = Date.now()
          if (now - lastUpdateRef.current > 100) {
            setState({
              level: Math.round(normalizedLevel),
              isActive: normalizedLevel > 5,
            })
            lastUpdateRef.current = now
          }

          rafRef.current = requestAnimationFrame(analyze)
        }

        // Handle audio context state
        if (audioContext.state === "suspended") {
          await audioContext.resume()
        }

        analyze()
      } catch (err) {
        console.error("Error setting up audio analysis:", err)
      }
    }

    setupAudioAnalysis()

    return cleanup
  }, [stream, cleanup])

  return state
}
