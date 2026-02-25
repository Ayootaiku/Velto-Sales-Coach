/**
 * Google Speech-to-Text v2 Streaming Service
 * Server-side only - handles gRPC streaming to Google Cloud
 */

import { SpeechClient } from '@google-cloud/speech';
import type { protos } from '@google-cloud/speech';

type StreamingRecognizeRequest = protos.google.cloud.speech.v1.IStreamingRecognizeRequest;
type StreamingRecognitionConfig = protos.google.cloud.speech.v1.IStreamingRecognitionConfig;
type RecognitionConfig = protos.google.cloud.speech.v1.IRecognitionConfig;

export interface TranscriptResult {
    text: string;
    isFinal: boolean;
    confidence: number;
    speaker: 'salesperson' | 'prospect';
}

export interface StreamConfig {
    speaker: 'salesperson' | 'prospect';
    sampleRate?: number;
    encoding?: string;
}

/**
 * Google STT v2 Streaming Manager
 * Manages long-lived streaming connections for real-time transcription
 */
export class GoogleSTTStreamingService {
    private client: SpeechClient;
    private stream: any = null;
    private isActive: boolean = false;
    private speaker: 'salesperson' | 'prospect';
    private onTranscript: (result: TranscriptResult) => void;
    private onError: (error: Error) => void;

    constructor(
        speaker: 'salesperson' | 'prospect',
        onTranscript: (result: TranscriptResult) => void,
        onError: (error: Error) => void
    ) {
        // Initialize Google Speech client with Application Default Credentials
        this.client = new SpeechClient();
        this.speaker = speaker;
        this.onTranscript = onTranscript;
        this.onError = onError;
    }

    /**
     * Start streaming recognition
     */
    async startStreaming(config: StreamConfig = { speaker: this.speaker }): Promise<void> {
        if (this.isActive) {
            console.warn('[Google STT] Stream already active');
            return;
        }

        const recognitionConfig: RecognitionConfig = {
            encoding: 'WEBM_OPUS' as any,
            sampleRateHertz: config.sampleRate || 48000,
            languageCode: 'en-US',
            model: 'latest_short', // Optimized for low latency
            enableAutomaticPunctuation: true,
            useEnhanced: true,
        };

        const streamingConfig: StreamingRecognitionConfig = {
            config: recognitionConfig,
            interimResults: true, // Get partial transcripts
            singleUtterance: false, // Keep stream alive for multiple utterances
        };

        try {
            // Create streaming recognize request
            this.stream = this.client
                .streamingRecognize({ config: streamingConfig } as any)
                .on('error', (error: Error) => {
                    console.error(`[Google STT ${this.speaker}] Stream error:`, error);
                    this.onError(error);
                    this.isActive = false;
                })
                .on('data', (data: any) => {
                    if (data.results && data.results.length > 0) {
                        const result = data.results[0];
                        const alternative = result.alternatives[0];

                        if (alternative && alternative.transcript) {
                            const transcriptResult: TranscriptResult = {
                                text: alternative.transcript,
                                isFinal: result.isFinal || false,
                                confidence: alternative.confidence || 0,
                                speaker: this.speaker,
                            };

                            console.log(`[Google STT ${this.speaker}] ${transcriptResult.isFinal ? 'FINAL' : 'partial'}:`, transcriptResult.text);
                            this.onTranscript(transcriptResult);
                        }
                    }
                })
                .on('end', () => {
                    console.log(`[Google STT ${this.speaker}] Stream ended`);
                    this.isActive = false;
                });

            this.isActive = true;
            console.log(`[Google STT ${this.speaker}] Stream started`);
        } catch (error) {
            console.error(`[Google STT ${this.speaker}] Failed to start stream:`, error);
            this.onError(error as Error);
            throw error;
        }
    }

    /**
     * Send audio chunk to Google STT
     */
    sendAudioChunk(audioData: Buffer | Uint8Array): void {
        if (!this.isActive || !this.stream) {
            console.warn(`[Google STT ${this.speaker}] Cannot send audio - stream not active`);
            return;
        }

        try {
            this.stream.write({ audioContent: audioData });
        } catch (error) {
            console.error(`[Google STT ${this.speaker}] Error sending audio:`, error);
            this.onError(error as Error);
        }
    }

    /**
     * Stop streaming and close connection
     */
    stopStreaming(): void {
        if (!this.isActive || !this.stream) {
            return;
        }

        try {
            this.stream.end();
            this.isActive = false;
            console.log(`[Google STT ${this.speaker}] Stream stopped`);
        } catch (error) {
            console.error(`[Google STT ${this.speaker}] Error stopping stream:`, error);
        }
    }

    /**
     * Check if stream is active
     */
    isStreamActive(): boolean {
        return this.isActive;
    }
}

/**
 * Create a new streaming service instance
 */
export function createStreamingService(
    speaker: 'salesperson' | 'prospect',
    onTranscript: (result: TranscriptResult) => void,
    onError: (error: Error) => void
): GoogleSTTStreamingService {
    return new GoogleSTTStreamingService(speaker, onTranscript, onError);
}
