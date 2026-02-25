/**
 * SSE Streaming Bridge for Google STT
 * Server-Sent Events for real-time transcript delivery
 */

import { SpeechClient } from '@google-cloud/speech';
import type { protos } from '@google-cloud/speech';

// Active streaming sessions
const sessions = new Map<string, {
  client: SpeechClient;
  stream: any;
  encoder: any;
  lastActivity: number;
  speaker: 'salesperson' | 'prospect';
}>();

// Session timeout (1 hour - keep alive indefinitely for long conversations)
const SESSION_TIMEOUT_MS = 3600000;

// Cleanup inactive sessions periodically
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of sessions.entries()) {
    if (now - session.lastActivity > SESSION_TIMEOUT_MS) {
      console.log(`[STT Stream] Cleaning up inactive session: ${sessionId}`);
      closeSession(sessionId);
    }
  }
}, 10000);

function closeSession(sessionId: string) {
  const session = sessions.get(sessionId);
  if (session) {
    try {
      session.stream?.end();
    } catch (e) {
      // Ignore
    }
    sessions.delete(sessionId);
  }
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get('session');

  if (!sessionId) {
    return new Response(JSON.stringify({ error: 'Missing session ID' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = await req.json();
    const { action, speaker, audioChunk } = body;

    // START: Initialize new streaming session
    if (action === 'start') {
      console.log(`[STT Bridge] Init ${speaker}: ${sessionId.substring(0, 12)}...`);
      console.log(`[STT Bridge] GOOGLE_APPLICATION_CREDENTIALS: ${process.env.GOOGLE_APPLICATION_CREDENTIALS || 'NOT SET'}`);

      // Don't close existing session immediately - let it be replaced
      // This prevents race conditions with SSE reconnects
      const existingSession = sessions.get(sessionId);
      if (existingSession) {
        console.log(`[STT Bridge] Replacing existing session: ${sessionId.substring(0, 12)}...`);
        // Close old session in background
        setTimeout(() => closeSession(sessionId), 100);
      }

      try {
        console.log(`[STT Bridge] Creating SpeechClient...`);
        console.log(`[STT Bridge] GOOGLE_APPLICATION_CREDENTIALS: ${process.env.GOOGLE_APPLICATION_CREDENTIALS || 'NOT SET'}`);
        const client = new SpeechClient();
        console.log(`[STT Bridge] SpeechClient created successfully`);

        const config: protos.google.cloud.speech.v1.IRecognitionConfig = {
          encoding: 'OGG_OPUS',
          sampleRateHertz: 48000,
          languageCode: 'en-US',
          model: 'latest_short',
          enableAutomaticPunctuation: true,
          useEnhanced: true,
        };

        const streamingConfig: protos.google.cloud.speech.v1.IStreamingRecognitionConfig = {
          config,
          interimResults: true,
          singleUtterance: false, // keep stream open across utterances
        };

        const stream = client
          .streamingRecognize(streamingConfig)
          .on('error', (error: any) => {
            console.error(`[STT Bridge Error ${sessionId.substring(0, 8)}]`, error.message || error);
            console.error(`[STT Bridge Error Details]`, error);
            // Add error event to session so client can see it
            const session = sessions.get(sessionId);
            if (session) {
              (session as any).lastEvents = (session as any).lastEvents || [];
              (session as any).lastEvents.push({
                type: 'error',
                message: error.message || 'STT stream error',
                timestamp: Date.now(),
              });
            }
            closeSession(sessionId);
          })
          .on('end', () => {
            console.log(`[STT Bridge End] ${sessionId.substring(0, 8)}`);
            closeSession(sessionId);
          })
          .on('data', (data: any) => {
            const session = sessions.get(sessionId);
            if (!session) {
              console.log(`[STT Bridge] No session found for ${sessionId?.substring(0, 8)}`);
              return;
            }

            console.log(`[STT Bridge] Got data from Google STT for ${session.speaker}:`, JSON.stringify(data.results?.[0]).substring(0, 100));

            if (data.results && data.results.length > 0) {
              const result = data.results[0];
              const alternative = result.alternatives?.[0];

              if (alternative?.transcript) {
                const event = {
                  type: result.isFinal ? 'final' : 'partial',
                  text: alternative.transcript,
                  speaker: session.speaker,
                  isFinal: result.isFinal || false,
                  confidence: alternative.confidence || 0,
                  timestamp: Date.now(),
                };

                (session as any).lastEvents = (session as any).lastEvents || [];
                (session as any).lastEvents.push(event);
                if ((session as any).lastEvents.length > 50) (session as any).lastEvents.shift();

                session.lastActivity = Date.now();
                console.log(`[STT Bridge] ${event.type === 'final' ? '✅' : '📝'} ${session.speaker}: "${event.text.substring(0, 40)}..."`);
              } else {
                console.log(`[STT Bridge] No transcript in alternatives for ${session.speaker}`);
              }
            } else {
              console.log(`[STT Bridge] No results from Google STT for ${session.speaker}`);
            }
          });

        sessions.set(sessionId, {
          client,
          stream,
          encoder: null,
          lastActivity: Date.now(),
          speaker: speaker || 'salesperson',
        });

        return new Response(JSON.stringify({ success: true, sessionId }), {
          headers: { 'Content-Type': 'application/json' },
        });
      } catch (err: any) {
        console.error(`[STT Bridge Init Fail]`, err);
        console.error(`[STT Bridge Init Fail] Error details:`, err?.message, err?.stack);
        return new Response(JSON.stringify({ error: 'Failed to init STT: ' + (err?.message || 'Unknown error') }), { status: 500 });
      }
    }

    // CHUNK: Send audio data
    if (action === 'chunk') {
      const session = sessions.get(sessionId);
      if (!session) {
        console.log(`[STT Bridge] Chunk received but session not found: ${sessionId?.substring(0, 8)}`);
        return new Response(JSON.stringify({ error: 'Session not found' }), { status: 404 });
      }
      if (!session.stream || (session.stream as any).destroyed) {
        console.log(`[STT Bridge] Chunk received but stream closed: ${sessionId?.substring(0, 8)}`);
        closeSession(sessionId);
        return new Response(JSON.stringify({ error: 'Stream closed' }), { status: 409 });
      }

      if (audioChunk) {
        const audioBuffer = Buffer.from(audioChunk, 'base64');
        console.log(`[STT Bridge] Received chunk for ${session.speaker}: ${audioBuffer.length} bytes`);
        try {
          // Write raw buffer, not wrapped object
          session.stream.write(audioBuffer);
          session.lastActivity = Date.now();
        } catch (err: any) {
          console.error(`[STT Bridge Error ${sessionId.substring(0, 8)}] write failed`, err?.message || err);
          closeSession(sessionId);
          return new Response(JSON.stringify({ error: 'Stream write failed' }), { status: 409 });
        }
      } else {
        console.log(`[STT Bridge] Chunk received but no audio data`);
      }
      return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    // STOP: Close session
    if (action === 'stop') {
      closeSession(sessionId);
      return new Response(JSON.stringify({ success: true }), { headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), { status: 400 });

  } catch (error: any) {
    console.error('[STT Bridge Root Error]', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
}

// SSE endpoint for receiving transcripts
export async function GET(req: Request) {
  const url = new URL(req.url);
  const sessionId = url.searchParams.get('session');

  console.log(`[STT SSE] GET request for session: ${sessionId?.substring(0, 12)}...`);

  if (!sessionId) return new Response('Missing session ID', { status: 400 });

  let session = sessions.get(sessionId);

  // Wait up to 2 seconds for session to be created (handles race conditions)
  let attempts = 0;
  while (!session && attempts < 10) {
    await new Promise(resolve => setTimeout(resolve, 200));
    session = sessions.get(sessionId);
    attempts++;
  }

  if (!session) {
    console.log(`[STT SSE] Session not found after ${attempts} attempts: ${sessionId?.substring(0, 12)}...`);
    return new Response('Session not found', { status: 404 });
  }

  console.log(`[STT SSE] Session found after ${attempts} waits, starting SSE stream for ${session.speaker}`);

  // Create SSE stream
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode('data: {"type":"connected"}\n\n'));

      const interval = setInterval(() => {
        const currentSession = sessions.get(sessionId);
        if (!currentSession) {
          // Session was closed
          clearInterval(interval);
          return;
        }

        const events = (currentSession as any).lastEvents || [];
        if (events.length > 0) {
          events.forEach((event: any) => {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          });
          (currentSession as any).lastEvents = [];
        }
        controller.enqueue(encoder.encode(': keepalive\n\n'));
      }, 100);

      req.signal.addEventListener('abort', () => {
        clearInterval(interval);
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
