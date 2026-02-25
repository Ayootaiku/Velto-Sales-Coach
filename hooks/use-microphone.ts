"use client"

import { useState, useEffect, useCallback, useRef } from "react"

export interface MicrophoneState {
  isSupported: boolean
  isListening: boolean
  isMuted: boolean
  error: string | null
  stream: MediaStream | null
}

export function useMicrophone() {
  // Start with false for isSupported to avoid hydration mismatch
  // We'll detect browser support in useEffect
  const [state, setState] = useState<MicrophoneState>({
    isSupported: false,
    isListening: false,
    isMuted: false,
    error: null,
    stream: null,
  })

  const streamRef = useRef<MediaStream | null>(null)

  // Detect browser support on mount (client-side only)
  useEffect(() => {
    const isSupported = typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia
    setState((prev) => ({ ...prev, isSupported }))
  }, [])

  const startListening = useCallback(async () => {
    if (!state.isSupported) {
      setState((prev) => ({ ...prev, error: "Microphone not supported in this browser" }))
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 44100,
        },
      })

      streamRef.current = stream
      setState((prev) => ({
        ...prev,
        stream,
        isListening: true,
        error: null,
      }))
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to access microphone"
      setState((prev) => ({ ...prev, error: errorMessage }))
      console.error("Microphone access error:", err)
    }
  }, [state.isSupported])

  const stopListening = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    setState((prev) => ({
      ...prev,
      stream: null,
      isListening: false,
    }))
  }, [])

  const toggleMute = useCallback(() => {
    if (streamRef.current) {
      const audioTracks = streamRef.current.getAudioTracks()
      const newMutedState = !state.isMuted
      audioTracks.forEach((track) => {
        track.enabled = !newMutedState
      })
      setState((prev) => ({ ...prev, isMuted: newMutedState }))
    }
  }, [state.isMuted])

  const setMuted = useCallback((muted: boolean) => {
    if (streamRef.current) {
      const audioTracks = streamRef.current.getAudioTracks()
      audioTracks.forEach((track) => {
        track.enabled = !muted
      })
      setState((prev) => ({ ...prev, isMuted: muted }))
    }
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
      }
    }
  }, [])

  return {
    ...state,
    startListening,
    stopListening,
    toggleMute,
    setMuted,
  }
}
