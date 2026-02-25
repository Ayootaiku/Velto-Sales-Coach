/**
 * Voice Activity Detection (VAD) Service
 * Automatically detects who is speaking based on audio patterns
 */

interface VADResult {
  isSpeaking: boolean;
  speaker: 'salesperson' | 'prospect' | 'unknown';
  confidence: number;
  audioLevel: number;
}

interface VADConfig {
  threshold: number;
  sampleRate: number;
  bufferSize: number;
}

export class VoiceActivityDetector {
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private mediaStream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private isRunning: boolean = false;
  private onVADResult: ((result: VADResult) => void) | null = null;
  private config: VADConfig;
  private lastSpeaker: 'salesperson' | 'prospect' = 'salesperson';
  private speakerHistory: Array<{ speaker: 'salesperson' | 'prospect'; timestamp: number }> = [];
  
  constructor(
    onResult: (result: VADResult) => void,
    config: Partial<VADConfig> = {}
  ) {
    this.onVADResult = onResult;
    this.config = {
      threshold: config.threshold || 30, // Audio level threshold
      sampleRate: config.sampleRate || 44100,
      bufferSize: config.bufferSize || 2048,
    };
  }

  async start(stream: MediaStream): Promise<void> {
    try {
      this.mediaStream = stream;
      
      // Create audio context
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
        sampleRate: this.config.sampleRate,
      });

      // Create analyser
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = this.config.bufferSize;
      this.analyser.smoothingTimeConstant = 0.8;

      // Connect stream to analyser
      this.source = this.audioContext.createMediaStreamSource(stream);
      this.source.connect(this.analyser);

      this.isRunning = true;
      this.analyzeAudio();

      console.log('[VAD] Started');
    } catch (error) {
      console.error('[VAD] Start error:', error);
      throw error;
    }
  }

  stop(): void {
    this.isRunning = false;
    
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    
    this.analyser = null;
    this.mediaStream = null;
    
    console.log('[VAD] Stopped');
  }

  private analyzeAudio(): void {
    if (!this.isRunning || !this.analyser) return;

    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(dataArray);

    // Calculate audio level (RMS)
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i] * dataArray[i];
    }
    const rms = Math.sqrt(sum / dataArray.length);
    const audioLevel = Math.min(100, (rms / 128) * 100);

    // Detect if someone is speaking
    const isSpeaking = audioLevel > this.config.threshold;

    // Determine speaker based on patterns
    const speaker = this.determineSpeaker(isSpeaking, audioLevel);

    // Emit result
    if (this.onVADResult) {
      this.onVADResult({
        isSpeaking,
        speaker,
        confidence: isSpeaking ? Math.min(1, audioLevel / 50) : 0,
        audioLevel,
      });
    }

    // Continue analyzing
    if (this.isRunning) {
      requestAnimationFrame(() => this.analyzeAudio());
    }
  }

  private determineSpeaker(isSpeaking: boolean, audioLevel: number): 'salesperson' | 'prospect' | 'unknown' {
    if (!isSpeaking) {
      return 'unknown';
    }

    // Simple speaker alternation logic
    // In a real implementation, you'd use more sophisticated ML models
    // to identify speakers based on voice characteristics
    
    const now = Date.now();
    
    // Check if we recently detected speech
    const recentSpeech = this.speakerHistory.filter(
      h => now - h.timestamp < 2000
    );
    
    if (recentSpeech.length === 0) {
      // No recent speech, alternate from last known speaker
      this.lastSpeaker = this.lastSpeaker === 'salesperson' ? 'prospect' : 'salesperson';
    }

    // Record this detection
    this.speakerHistory.push({
      speaker: this.lastSpeaker,
      timestamp: now,
    });

    // Clean old history
    this.speakerHistory = this.speakerHistory.filter(
      h => now - h.timestamp < 5000
    );

    return this.lastSpeaker;
  }

  // Get current audio level without full VAD
  getAudioLevel(): number {
    if (!this.analyser) return 0;
    
    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(dataArray);
    
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i];
    }
    
    return Math.min(100, (sum / dataArray.length / 128) * 100);
  }
}

// Simple hook for using VAD
export function useVAD(
  onSpeakerChange: (speaker: 'salesperson' | 'prospect') => void,
  onAudioLevel: (level: number) => void
) {
  const vadRef = React.useRef<VoiceActivityDetector | null>(null);

  const startVAD = async (stream: MediaStream) => {
    vadRef.current = new VoiceActivityDetector((result) => {
      onAudioLevel(result.audioLevel);
      
      if (result.isSpeaking && result.speaker !== 'unknown') {
        onSpeakerChange(result.speaker);
      }
    });

    await vadRef.current.start(stream);
  };

  const stopVAD = () => {
    vadRef.current?.stop();
    vadRef.current = null;
  };

  return { startVAD, stopVAD };
}

import React from 'react';
