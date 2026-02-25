/**
 * Standalone WebSocket STT Server
 * Run with: node server/websocket-stt-server.js
 */

const { SpeechClient } = require('@google-cloud/speech');
const WebSocket = require('ws');
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config({ path: '.env.local' });

// Auto-discover available port (3002-3010)
const DEFAULT_PORT = parseInt(process.env.WS_PORT) || 3002;
const PORT_RANGE_START = 3002;
const PORT_RANGE_END = 3010;

// Check if port is available
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', () => resolve(false))
      .once('listening', () => {
        tester.close();
        resolve(true);
      })
      .listen(port);
  });
}

// Find first available port in range
async function findAvailablePort() {
  // Try preferred port first
  if (await isPortAvailable(DEFAULT_PORT)) {
    return DEFAULT_PORT;
  }

  // Try range
  for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
    if (await isPortAvailable(port)) {
      console.log(`[WS Server] Port ${DEFAULT_PORT} in use, using ${port} instead`);
      return port;
    }
  }

  return null;
}

// Save port to file for client to read
function savePortToFile(port) {
  try {
    const portFile = path.join(__dirname, '..', '.ws-port');
    fs.writeFileSync(portFile, port.toString());
    console.log(`[WS Server] Port saved to ${portFile}`);
  } catch (e) {
    console.error('[WS Server] Could not save port file:', e.message);
  }
}

// Active streaming sessions
const sessions = new Map();

// Reuse a single SpeechClient instance
let globalSpeechClient = null;
function getSpeechClient() {
  if (!globalSpeechClient) {
    globalSpeechClient = new (require('@google-cloud/speech').SpeechClient)();
  }
  return globalSpeechClient;
}

// Session timeout logic removed to ensure continuous listening

// Start server with auto port discovery
async function startServer() {
  const PORT = await findAvailablePort();

  if (!PORT) {
    console.error(`[WS Server] ❌ ERROR: All ports ${PORT_RANGE_START}-${PORT_RANGE_END} are in use!`);
    console.error('[WS Server] Run: taskkill /F /IM node.exe');
    console.error('[WS Server] Or: lsof -ti:3002 | xargs kill -9');
    process.exit(1);
  }

  console.log('[WS Server] Starting WebSocket STT Server...');
  console.log('[WS Server] Port:', PORT);
  console.log('[WS Server] GOOGLE_APPLICATION_CREDENTIALS:', process.env.GOOGLE_APPLICATION_CREDENTIALS || 'NOT SET');

  // Save port for client
  savePortToFile(PORT);

  // REMOVED: Inactive session cleanup - keep sessions alive indefinitely as requested
  // setInterval(() => { ... }, 10000);

  function closeSession(ws) {
    const session = sessions.get(ws);
    if (session) {
      try {
        session.stream?.end();
        console.log(`[WS Server] Session closed: ${session.sessionId}`);
      } catch (e) {
        // Ignore
      }
      sessions.delete(ws);
    }
    if (ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  }

  // Create WebSocket server
  const wss = new WebSocket.Server({ port: PORT });

  // Set up ping interval to keep connections alive (every 10 seconds for more aggressive keep-alive)
  // We send both a Ping frame AND a JSON message to ensure load balancers see activity
  setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
        try {
          ws.send(JSON.stringify({ type: 'heartbeat', timestamp: Date.now() }));
        } catch (e) {
          // Ignore send errors during heartbeat
        }
      }
    });
  }, 10000);

  console.log(`[WS Server] WebSocket server started on port ${PORT}`);

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const sessionId = url.searchParams.get('session') || `session-${Date.now()}`;
    const speaker = url.searchParams.get('speaker') || 'salesperson';
    const diarize = url.searchParams.get('diarize') === 'true';

    console.log(`[WS Server] New connection: ${sessionId} (${speaker}) diarize=${diarize} from ${req.socket.remoteAddress}`);

    // Initialize Google STT
    try {
      const client = getSpeechClient();

      const config = {
        encoding: 'LINEAR16',
        sampleRateHertz: 16000,
        languageCode: 'en-US',
        model: 'latest_long',
        enableAutomaticPunctuation: true,
        useEnhanced: true,
      };

      // Add Diarization if requested
      if (diarize) {
        config.diarizationConfig = {
          enableSpeakerDiarization: true,
          minSpeakerCount: 2,
          maxSpeakerCount: 2,
        };
      }

      const streamingConfig = {
        config,
        interimResults: true,
        singleUtterance: false,
      };

      // DIAGNOSTIC: Track stream state
      let dataEventCount = 0;
      let finalCount = 0;

      const stream = client
        .streamingRecognize(streamingConfig)
        .on('error', (error) => {
          console.error(`[WS Server Error ${sessionId}]`, error.message || error);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: 'error',
              message: error.message || 'STT stream error'
            }));
          }
          closeSession(ws);
        })
        .on('data', (data) => {
          dataEventCount++;
          const session = sessions.get(ws);
          if (!session) {
            console.log(`[DIAGNOSTIC ${sessionId}] Received STT data but no session found`);
            return;
          }

          if (data.results && data.results.length > 0) {
            const result = data.results[0];
            const alternative = result.alternatives?.[0];

            if (alternative?.transcript) {
              if (result.isFinal) {
                finalCount++;
                console.log(`[DIAGNOSTIC ${sessionId}] FINAL #${finalCount}: "${alternative.transcript.substring(0, 40)}..."`);
              }

              // Extract speaker tag if diarization is enabled
              let speakerTag = null;
              if (result.isFinal && alternative.words && alternative.words.length > 0) {
                const tags = alternative.words.map(w => w.speakerTag).filter(t => t !== undefined);
                if (tags.length > 0) {
                  speakerTag = tags[tags.length - 1]; // Use last word's tag as the speaker for the sentence
                }
              }

              const event = {
                type: result.isFinal ? 'final' : 'partial',
                text: alternative.transcript,
                speaker: session.speaker,
                speakerTag,
                isFinal: result.isFinal || false,
                confidence: alternative.confidence || 0,
                timestamp: Date.now(),
              };

              session.lastActivity = Date.now();

              if (ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(event));
                console.log(`[WS Server] ${event.type === 'final' ? '✅' : '📝'} ${session.speaker}: "${event.text.substring(0, 60)}..." (data events: ${dataEventCount}, finals: ${finalCount})`);
              } else {
                console.log(`[WS Server] WebSocket not open, can't send: ${event.type}`);
              }
            }
          } else {
            console.log(`[DIAGNOSTIC ${sessionId}] Received STT data but no results`);
          }
        })
        .on('end', () => {
          console.log(`[DIAGNOSTIC ${sessionId}] STT stream END event - closing session`);
          closeSession(ws);
        })
        .on('close', () => {
          console.log(`[DIAGNOSTIC ${sessionId}] STT stream CLOSE event - closing session`);
          closeSession(ws);
        })
        .on('drain', () => {
          // No action needed for drain
        });

      sessions.set(ws, {
        client,
        stream,
        speaker,
        sessionId,
        lastActivity: Date.now(),
        totalBytesReceived: 0,
        startTime: Date.now()
      });

      // Send connected event
      ws.send(JSON.stringify({ type: 'connected', sessionId, speaker }));
      console.log(`[WS Server] Session initialized: ${sessionId}`);

    } catch (err) {
      console.error(`[WS Server] Failed to initialize:`, err);
      ws.send(JSON.stringify({
        type: 'error',
        message: 'Failed to initialize STT session'
      }));
      ws.close();
      return;
    }

    // DIAGNOSTIC: Track audio writes
    let writeCount = 0;
    let backpressureCount = 0;

    // Handle incoming audio data (expecting PCM LINEAR16 Int16Array)
    ws.on('message', (data) => {
      const session = sessions.get(ws);
      if (!session) {
        console.log(`[WS Server] Received audio but no session found`);
        return;
      }

      try {
        let buffer;
        // Data should be PCM Int16 bytes
        if (Buffer.isBuffer(data)) {
          buffer = data;
        } else if (typeof data === 'string') {
          // Handle base64 encoded PCM
          buffer = Buffer.from(data, 'base64');
        }

        if (buffer) {
          writeCount++;
          session.totalBytesReceived += buffer.length;

          const canWrite = session.stream.write(buffer);
          session.lastActivity = Date.now();

          // DIAGNOSTIC: Log volume every 5MB or every 500 writes
          if (writeCount % 500 === 0) {
            const mb = (session.totalBytesReceived / (1024 * 1024)).toFixed(2);
            console.log(`[WS Server ${sessionId}] 📈 Data received: ${mb}MB (${writeCount} chunks)`);
          }

          if (!canWrite) {
            backpressureCount++;
            console.log(`[DIAGNOSTIC ${sessionId}] BACKPRESSURE! total: ${backpressureCount}`);
          }
        }
      } catch (err) {
        console.error(`[WS Server] Error writing audio:`, err);
      }
    });

    ws.on('close', () => {
      console.log(`[WS Server] Connection closed: ${sessionId}`);
      closeSession(ws);
    });

    ws.on('error', (err) => {
      console.error(`[WS Server] WebSocket error:`, err);
      closeSession(ws);
    });
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n[WS Server] Shutting down...');
    wss.close(() => {
      console.log('[WS Server] WebSocket server closed');
      process.exit(0);
    });
  });

  process.on('SIGTERM', () => {
    console.log('\n[WS Server] Shutting down...');
    wss.close(() => {
      console.log('[WS Server] WebSocket server closed');
      process.exit(0);
    });
  });

  console.log('[WS Server] Ready to accept connections');
}

// Start the server
startServer().catch(err => {
  console.error('[WS Server] Fatal error:', err);
  process.exit(1);
});
