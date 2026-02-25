"use client"

import { useState, useEffect, useCallback, useRef } from "react"

// Type definitions for Web Speech API
interface SpeechRecognitionEvent extends Event {
  resultIndex: number
  results: SpeechRecognitionResultList
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string
}

interface SpeechRecognitionResultList {
  length: number
  item(index: number): SpeechRecognitionResult
  [index: number]: SpeechRecognitionResult
}

interface SpeechRecognitionResult {
  isFinal: boolean
  length: number
  item(index: number): SpeechRecognitionAlternative
  [index: number]: SpeechRecognitionAlternative
}

interface SpeechRecognitionAlternative {
  transcript: string
  confidence: number
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  onstart: (() => void) | null
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognition
}

declare global {
  interface Window {
    SpeechRecognition: SpeechRecognitionConstructor
    webkitSpeechRecognition: SpeechRecognitionConstructor
  }
}

export interface SpeechRecognitionState {
  isSupported: boolean
  isListening: boolean
  transcript: string
  interimTranscript: string
  error: string | null
}

export interface UseSpeechRecognitionOptions {
  onTranscript?: (text: string) => void
  onInterimTranscript?: (text: string) => void
  continuous?: boolean
  language?: string
}

export function useSpeechRecognition(options: UseSpeechRecognitionOptions = {}) {
  const { onTranscript, onInterimTranscript, continuous = true, language = "en-US" } = options

  const [state, setState] = useState<SpeechRecognitionState>({
    isSupported: false,
    isListening: false,
    transcript: "",
    interimTranscript: "",
    error: null,
  })

  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const isListeningRef = useRef(false)

  // Check for SpeechRecognition support
  useEffect(() => {
    if (typeof window !== "undefined") {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
      if (SpeechRecognition) {
        setState((prev) => ({ ...prev, isSupported: true }))
      }
    }
  }, [])

  const startListening = useCallback(() => {
    if (!state.isSupported) {
      setState((prev) => ({ ...prev, error: "Speech recognition not supported in this browser" }))
      return
    }

    try {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
      const recognition = new SpeechRecognition()

      recognition.continuous = continuous
      recognition.interimResults = true
      recognition.lang = language

      recognition.onstart = () => {
        isListeningRef.current = true
        setState((prev) => ({ ...prev, isListening: true, error: null }))
      }

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let interimText = ""
        let finalText = ""

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript
          if (event.results[i].isFinal) {
            finalText += transcript + " "
          } else {
            interimText += transcript
          }
        }

        if (interimText) {
          console.log('[Speech Recognition] Interim:', interimText)
          setState((prev) => ({ ...prev, interimTranscript: interimText }))
          onInterimTranscript?.(interimText)
        }

        if (finalText) {
          console.log('[Speech Recognition] Final:', finalText.trim())
          setState((prev) => ({
            ...prev,
            transcript: prev.transcript + finalText,
            interimTranscript: "",
          }))
          onTranscript?.(finalText.trim())
        }
      }

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        // Silently ignore common non-critical errors
        if (event.error === "no-speech" || event.error === "audio-capture") {
          // These are normal - no speech detected or mic not available
          return
        }
        if (event.error === "aborted" || event.error === "not-allowed") {
          // User stopped or denied permission
          return
        }
        // Only log and show real errors
        console.error("Speech recognition error:", event.error)
        setState((prev) => ({ ...prev, error: event.error }))
      }

      recognition.onend = () => {
        console.log('[Speech Recognition] onend fired - isListeningRef:', isListeningRef.current, 'recognitionRef exists:', !!recognitionRef.current, 'continuous:', continuous)
        isListeningRef.current = false
        setState((prev) => ({ ...prev, isListening: false }))

        // Restart if we're still supposed to be listening
        // FIXED: Don't check recognitionRef.current here - it might be null if stopListening was called
        if (continuous) {
          console.log('[Speech Recognition] Attempting auto-restart...')
          setTimeout(() => {
            // Only restart if not manually stopped AND not already listening
            if (!isListeningRef.current && recognitionRef.current !== null) {
              console.log('[Speech Recognition] Restarting now...')
              try {
                // Create a fresh recognition instance - old one can't be reused
                const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
                const newRecognition = new SpeechRecognition()
                
                // Copy all the same settings
                newRecognition.continuous = continuous
                newRecognition.interimResults = true
                newRecognition.lang = language
                
                // Copy all the same event handlers
                newRecognition.onstart = recognition.onstart
                newRecognition.onresult = recognition.onresult
                newRecognition.onerror = recognition.onerror
                newRecognition.onend = recognition.onend
                
                recognitionRef.current = newRecognition
                newRecognition.start()
                console.log('[Speech Recognition] ✅ Restart successful')
              } catch (err) {
                console.error('[Speech Recognition] ❌ Failed to restart:', err)
              }
            } else {
              console.log('[Speech Recognition] ⏭️ Skipping restart - isListening:', isListeningRef.current, 'ref exists:', recognitionRef.current !== null)
            }
          }, 300) // Increased delay to prevent rapid restart loops
        } else {
          console.log('[Speech Recognition] ⏹️ Not restarting - continuous mode disabled')
        }
      }

      recognitionRef.current = recognition
      recognition.start()
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Failed to start speech recognition"
      setState((prev) => ({ ...prev, error: errorMessage }))
      console.error("Speech recognition start error:", err)
    }
  }, [state.isSupported, continuous, language, onTranscript, onInterimTranscript])

  const stopListening = useCallback(() => {
    console.log('[Speech Recognition] stopListening called - will set ref to null')
    if (recognitionRef.current) {
      isListeningRef.current = false
      recognitionRef.current.stop()
      recognitionRef.current = null // This prevents auto-restart!
    }
    setState((prev) => ({ ...prev, isListening: false, interimTranscript: "" }))
  }, [])

  const resetTranscript = useCallback(() => {
    setState((prev) => ({
      ...prev,
      transcript: "",
      interimTranscript: "",
    }))
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        isListeningRef.current = false
        recognitionRef.current.stop()
        recognitionRef.current = null
      }
    }
  }, [])

  return {
    ...state,
    startListening,
    stopListening,
    resetTranscript,
  }
}
