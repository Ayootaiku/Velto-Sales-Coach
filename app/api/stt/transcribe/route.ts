import { NextRequest, NextResponse } from 'next/server';
import { SpeechClient } from '@google-cloud/speech';
import type { protos } from '@google-cloud/speech';

const client = new SpeechClient();

/**
 * Google Speech-to-Text v2 transcription endpoint
 * Replaces the Whisper API with Google STT for better real-time performance
 */
export async function POST(req: NextRequest) {
    try {
        const start = Date.now();
        const formData = await req.formData();
        const file = formData.get('file') as Blob | null;
        const speaker = formData.get('speaker') as string || 'prospect';

        if (!file) {
            return NextResponse.json(
                { error: 'No file provided' },
                { status: 400 }
            );
        }

        // Convert blob to buffer
        const arrayBuffer = await file.arrayBuffer();
        const audioBytes = Buffer.from(arrayBuffer);

        // Configure recognition
        const audio: protos.google.cloud.speech.v1.IRecognitionAudio = {
            content: audioBytes,
        };

        const config: protos.google.cloud.speech.v1.IRecognitionConfig = {
            encoding: 'WEBM_OPUS' as any,
            sampleRateHertz: 48000,
            languageCode: 'en-US',
            model: 'latest_short', // Optimized for low latency
            enableAutomaticPunctuation: true,
            useEnhanced: true,
        };

        const request: protos.google.cloud.speech.v1.IRecognizeRequest = {
            audio,
            config,
        };

        // Perform recognition
        const [response] = await client.recognize(request);
        const transcription = response.results
            ?.map((result) => result.alternatives?.[0]?.transcript)
            .filter(Boolean)
            .join(' ');

        const confidence = response.results?.[0]?.alternatives?.[0]?.confidence || 0;

        console.log(`[Google STT ${speaker}] Success in`, Date.now() - start, 'ms');
        console.log(`[Google STT ${speaker}] Transcript:`, transcription);
        console.log(`[Google STT ${speaker}] Confidence:`, confidence);

        return NextResponse.json({
            text: transcription || '',
            confidence,
            speaker
        });

    } catch (error: any) {
        console.error('[Google STT API Error]', error);
        return NextResponse.json(
            { error: error.message || 'Failed to transcribe audio' },
            { status: 500 }
        );
    }
}
