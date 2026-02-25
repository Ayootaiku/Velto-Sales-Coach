"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { Mic, MicOff, PhoneOff, AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"
import { PresenceOrb } from "./presence-orb"
import { useMicrophone } from "@/hooks/use-microphone"
import { useSTTStream } from "@/hooks/use-stt-stream-ws"
import { Skeleton } from "@/components/ui/skeleton"
import {
  processInterimTranscript,
  processFinalTranscript,
  getAudioHealth,
  resetCoachState,
  generateSummary,
  type CoachingResponse
} from "@/lib/salescoach-copilot-client"
import { createCall, updateCallStatus } from "@/lib/mcp-client"

// Minimal UI - Only what the salesperson needs
export function RealtimeCoachOverlay() {
  // Core state
  const [isActive, setIsActive] = useState(false);
  const [callId, setCallId] = useState<string | null>(null);
  const [coaching, setCoaching] = useState<CoachingResponse | null>(null);
  const [isDraft, setIsDraft] = useState(false);
  const [isProcessingAI, setIsProcessingAI] = useState(false);
  const [hasProspectActivity, setHasProspectActivity] = useState(false);
  const [callTime, setCallTime] = useState(0);
  const [audioStatus, setAudioStatus] = useState<'LIVE' | 'NO AUDIO' | 'ERROR'>('NO AUDIO');
  const [prospectAudioLevel, setProspectAudioLevel] = useState(0);
  const [salespersonAudioLevel, setSalespersonAudioLevel] = useState(0);

  // Refs
  const lastAudioTimeRef = useRef<number>(0);
  const audioCheckIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const prospectStreamRef = useRef<ReturnType<typeof useSTTStream> | null>(null);
  const salespersonStreamRef = useRef<ReturnType<typeof useSTTStream> | null>(null);

  // Hooks
  const microphone = useMicrophone();
  
  // Prospect STT Stream - Continuous listening
  const prospectSTT = useSTTStream((transcript) => {
    if (!isActive || !transcript.text.trim()) return;
    
    lastAudioTimeRef.current = Date.now();
    setProspectAudioLevel(80);
    setHasProspectActivity(true);
    setIsProcessingAI(true);
    
    // Process EVERY prospect transcript continuously
    processFinalTranscript(transcript.text, 'prospect', async (finalCoaching) => {
      setIsProcessingAI(false);
      setHasProspectActivity(false);
      if (finalCoaching) {
        setCoaching(finalCoaching);
        setIsDraft(false);
        
        // Restart STT streams after AI responds to ensure fresh connection
        console.log('[Coach] AI responded, restarting STT streams...');
        await restartSTTStreams();
      }
    });
  });
  
  // Salesperson STT Stream - Continuous listening
  const salespersonSTT = useSTTStream((transcript) => {
    if (!isActive || !transcript.text.trim()) return;
    
    lastAudioTimeRef.current = Date.now();
    setSalespersonAudioLevel(80);
    
    // Process salesperson speech without blocking prospect
    const draft = processInterimTranscript(transcript.text, 'salesperson');
    if (draft && draft.confidence > 40) {
      setCoaching(draft);
      setIsDraft(true);
    }
  });

  // Audio health monitoring and audio level decay
  useEffect(() => {
    if (!isActive) return;

    audioCheckIntervalRef.current = setInterval(() => {
      const isListening = prospectSTT.isStreaming || salespersonSTT.isStreaming;
      const health = getAudioHealth(isListening);
      setAudioStatus(health.status);

      // Decay audio levels
      setProspectAudioLevel(prev => Math.max(0, prev - 10));
      setSalespersonAudioLevel(prev => Math.max(0, prev - 10));

      // Auto-restart if no audio for 5 seconds
      if (health.secondsSinceAudio > 5 && isListening) {
        console.log('[Coach] 🔄 Auto-restarting STT streams (no audio for 5s)');
        prospectSTT.stopStream();
        salespersonSTT.stopStream();
        
        setTimeout(() => {
          if (isActive) {
            console.log('[Coach] 🎤 Restarting STT streams...');
            startSTTStreams();
          }
        }, 500);
      }
    }, 200);

    return () => {
      if (audioCheckIntervalRef.current) {
        clearInterval(audioCheckIntervalRef.current);
      }
    };
  }, [isActive, prospectSTT, salespersonSTT]);

  // Call timer
  useEffect(() => {
    if (!isActive) return;
    const timer = setInterval(() => setCallTime(t => t + 1), 1000);
    return () => clearInterval(timer);
  }, [isActive]);

  // Helper to start STT streams
  const startSTTStreams = useCallback(async () => {
    try {
      // Get microphone stream
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 16000
        }
      });
      
      // Start both streams with the same audio input
      await prospectSTT.startStream('prospect', stream);
      await salespersonSTT.startStream('salesperson', stream);
    } catch (err) {
      console.error('[Coach] Failed to start STT streams:', err);
    }
  }, [prospectSTT, salespersonSTT]);

  // Helper to restart STT streams (stop then start fresh)
  const restartSTTStreams = useCallback(async () => {
    console.log('[Coach] Restarting STT streams...');
    
    // Stop existing streams
    prospectSTT.stopStream();
    salespersonSTT.stopStream();
    
    // Small delay to ensure clean shutdown
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Start fresh streams
    await startSTTStreams();
    
    console.log('[Coach] STT streams restarted successfully');
  }, [prospectSTT, salespersonSTT, startSTTStreams]);

  // Start call
  const startCall = useCallback(async () => {
    resetCoachState();
    setIsActive(true);
    setCallTime(0);
    setCoaching(null);
    setIsProcessingAI(false);
    setHasProspectActivity(false);
    
    // Create call record
    const result = await createCall('prospect');
    if (result.success && (result.data as any)?.call?.id) {
      setCallId((result.data as any).call.id);
    }
    
    // Start audio
    await microphone.startListening();
    await startSTTStreams();
    lastAudioTimeRef.current = Date.now();
  }, [microphone, startSTTStreams]);

  // End call
  const endCall = useCallback(async () => {
    setIsActive(false);
    microphone.stopListening();
    prospectSTT.stopStream();
    salespersonSTT.stopStream();
    
    if (callId) {
      const summary = await generateSummary(callId);
      await updateCallStatus(callId, 'completed', summary?.outcome, summary?.outcomeConfidence, callTime);
    }
    
    // Show summary modal (simplified for now)
    setCoaching(null);
    setIsProcessingAI(false);
  }, [callId, callTime, microphone, prospectSTT, salespersonSTT]);

  // Format time
  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  return (
    <div className="w-[360px] rounded-2xl overflow-hidden bg-zinc-950 border border-zinc-800 shadow-2xl">
      
      {/* Header - Minimal */}
      <div className="h-12 border-b border-zinc-800 flex items-center justify-between px-4 bg-zinc-900/80">
        <div className="flex items-center gap-2">
          {/* LIVE Indicator */}
          <div className={cn(
            "w-2 h-2 rounded-full transition-all duration-300",
            audioStatus === 'LIVE' && "bg-emerald-500 animate-pulse",
            audioStatus === 'NO AUDIO' && "bg-amber-500",
            audioStatus === 'ERROR' && "bg-red-500"
          )} />
          <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-400">
            {audioStatus === 'LIVE' ? 'Live' : audioStatus === 'NO AUDIO' ? 'No Audio' : 'Error'}
          </span>
        </div>
        
        {isActive && (
          <span className="text-xs font-mono text-zinc-500">
            {formatTime(callTime)}
          </span>
        )}
      </div>

      {/* Main Content */}
      <div className="p-5">
        
        {/* Ready State */}
        {!isActive && (
          <div className="flex flex-col items-center text-center py-8">
            <PresenceOrb state="idle" />
            
            <h2 className="text-lg font-semibold text-white mt-4 mb-2">
              SalesCoach
            </h2>
            <p className="text-xs text-zinc-500 mb-6">
              Tell you what to say next
            </p>
            
            <button
              onClick={startCall}
              className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white text-sm font-medium rounded-lg transition-all"
            >
              <Mic className="w-4 h-4" />
              Start Call
            </button>
          </div>
        )}

        {/* Active Coaching */}
        {isActive && (
          <div className="space-y-4">
            {/* Orb */}
            <div className="flex justify-center py-2">
              <PresenceOrb state={coaching ? "active" : "listening"} />
            </div>

            {/* Audio Visualization Bars */}
            <div className="space-y-2">
              {/* Prospect Audio Bar */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-zinc-500 w-16">Prospect</span>
                <div className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className={cn(
                      "h-full transition-all duration-200 rounded-full",
                      prospectAudioLevel > 0 ? "bg-emerald-500" : "bg-zinc-700"
                    )}
                    style={{ width: `${prospectAudioLevel}%` }}
                  />
                </div>
              </div>
              {/* Salesperson Audio Bar */}
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-zinc-500 w-16">You</span>
                <div className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className={cn(
                      "h-full transition-all duration-200 rounded-full",
                      salespersonAudioLevel > 0 ? "bg-blue-500" : "bg-zinc-700"
                    )}
                    style={{ width: `${salespersonAudioLevel}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Coaching Card - Screenshot Design */}
            {coaching ? (
              <div className="bg-zinc-900/80 rounded-xl p-5 border border-zinc-800 animate-in fade-in duration-300">
                {/* Stage Badge with Icon */}
                <div className="flex items-center gap-2 mb-4">
                  <AlertTriangle className={cn(
                    "w-4 h-4",
                    coaching.stage.startsWith('Objection:') && "text-amber-500",
                    coaching.stage === 'Greeting' && "text-blue-500",
                    coaching.stage === 'Discovery' && "text-purple-500",
                    coaching.stage === 'Hesitation' && "text-zinc-500",
                    coaching.stage === 'Close' && "text-emerald-500",
                    coaching.stage === 'Competitor' && "text-orange-500",
                    coaching.stage === 'Logistics' && "text-cyan-500"
                  )} />
                  <span className={cn(
                    "text-[10px] font-bold uppercase tracking-wider",
                    coaching.stage.startsWith('Objection:') && "text-amber-500",
                    coaching.stage === 'Greeting' && "text-blue-500",
                    coaching.stage === 'Discovery' && "text-purple-500",
                    coaching.stage === 'Hesitation' && "text-zinc-500",
                    coaching.stage === 'Close' && "text-emerald-500",
                    coaching.stage === 'Competitor' && "text-orange-500",
                    coaching.stage === 'Logistics' && "text-cyan-500"
                  )}>
                    {coaching.stage.startsWith('Objection:') ? coaching.stage.replace('Objection:', 'OBJECTION:') : coaching.stage.toUpperCase()}
                  </span>
                  {isDraft && (
                    <span className="text-[9px] text-zinc-500 ml-auto">analyzing...</span>
                  )}
                </div>

                {/* Say Next - Large Quote */}
                <p className="text-lg text-white font-medium leading-relaxed mb-4">
                  "{coaching.say_next}"
                </p>

                {/* WHY Section */}
                <div className="pt-3 border-t border-zinc-800">
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1">
                    Why:
                  </p>
                  <p className="text-sm text-zinc-400 leading-relaxed">
                    {coaching.insight}
                  </p>
                </div>

                {/* Confidence - Subtle */}
                <div className="flex items-center justify-between mt-4 pt-3 border-t border-zinc-800">
                  <span className="text-[10px] text-zinc-600">
                    {coaching.confidence}% match
                  </span>
                  <div className="flex items-center gap-1">
                    <div className={cn(
                      "w-1.5 h-1.5 rounded-full",
                      coaching.confidence >= 80 ? "bg-emerald-500" :
                      coaching.confidence >= 60 ? "bg-amber-500" : "bg-red-500"
                    )} />
                    <span className="text-[10px] text-zinc-500">
                      {coaching.confidence >= 80 ? 'high' : coaching.confidence >= 60 ? 'medium' : 'low'}
                    </span>
                  </div>
                </div>
              </div>
            ) : hasProspectActivity || isProcessingAI ? (
              // Skeleton UI while prospect is speaking or AI is processing
              <div className="bg-zinc-900/80 rounded-xl p-5 border border-zinc-800 animate-pulse">
                {/* Stage Badge Skeleton */}
                <div className="flex items-center gap-2 mb-4">
                  <Skeleton className="w-4 h-4 rounded-full bg-zinc-700" />
                  <Skeleton className="h-3 w-20 bg-zinc-700" />
                  <span className="text-[9px] text-zinc-500 ml-auto">
                    {isProcessingAI ? 'analyzing...' : 'listening...'}
                  </span>
                </div>

                {/* Say Next Skeleton */}
                <Skeleton className="h-6 w-full bg-zinc-700 mb-2" />
                <Skeleton className="h-6 w-3/4 bg-zinc-700 mb-4" />

                {/* WHY Section Skeleton */}
                <div className="pt-3 border-t border-zinc-800">
                  <Skeleton className="h-2 w-8 bg-zinc-700 mb-2" />
                  <Skeleton className="h-4 w-full bg-zinc-700 mb-1" />
                  <Skeleton className="h-4 w-5/6 bg-zinc-700" />
                </div>

                {/* Confidence Skeleton */}
                <div className="flex items-center justify-between mt-4 pt-3 border-t border-zinc-800">
                  <Skeleton className="h-2 w-16 bg-zinc-700" />
                  <div className="flex items-center gap-1">
                    <Skeleton className="w-1.5 h-1.5 rounded-full bg-zinc-700" />
                    <Skeleton className="h-2 w-10 bg-zinc-700" />
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-zinc-500">
                <p className="text-sm">Listening for prospect...</p>
                <p className="text-xs mt-1">Coaching will appear here</p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer Controls */}
      {isActive && (
        <div className="p-4 bg-zinc-900 border-t border-zinc-800">
          {/* Status Bar */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <div className={cn(
                  "w-2 h-2 rounded-full",
                  salespersonAudioLevel > 0 ? "bg-emerald-500 animate-pulse" : "bg-zinc-600"
                )} />
                <span className="text-xs text-zinc-400">You</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className={cn(
                  "w-2 h-2 rounded-full",
                  prospectAudioLevel > 0 ? "bg-blue-500 animate-pulse" : "bg-zinc-600"
                )} />
                <span className="text-xs text-zinc-400">Prospect</span>
              </div>
            </div>
            <span className="text-xs text-zinc-500">
              {coaching ? 'Ready' : 'Waiting...'}
            </span>
          </div>

          {/* Controls */}
          <div className="flex items-center justify-between">
            <button
              onClick={microphone.toggleMute}
              className={cn(
                "w-10 h-10 rounded-full flex items-center justify-center transition-all",
                microphone.isMuted
                  ? "bg-red-500/10 text-red-400 border border-red-500/20"
                  : "bg-zinc-800 text-zinc-400 hover:text-white"
              )}
            >
              {microphone.isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>

            <button
              onClick={endCall}
              className="flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors"
            >
              <PhoneOff className="w-4 h-4" />
              End Session
            </button>
          </div>
        </div>
      )}
    </div>
  );
}