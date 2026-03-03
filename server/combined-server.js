/**
 * Combined Production Server for Railway
 * Runs Next.js HTTP + WebSocket STT on a single port
 */

const { createServer } = require('http');
const { parse } = require('url');
const next = require('next');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

// Load Google credentials from env var (Railway)
if (process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON && !fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS || '')) {
  const credPath = path.join(require('os').tmpdir(), 'gcloud-creds.json');
  fs.writeFileSync(credPath, process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = credPath;
  console.log('[Combined] Loaded Google credentials from env var');
}

const PORT = parseInt(process.env.PORT) || 3000;
const dev = false;
const app = next({ dev });
const handle = app.getRequestHandler();

const sessions = new Map();

let globalSpeechClient = null;
function getSpeechClient() {
  if (!globalSpeechClient) {
    try {
      const { SpeechClient } = require('@google-cloud/speech');
      globalSpeechClient = new SpeechClient();
      console.log('[Combined] Google Speech client initialized');
    } catch (e) {
      console.error('[Combined] Failed to init Speech client:', e.message);
      return null;
    }
  }
  return globalSpeechClient;
}

function closeSession(ws, reason) {
  const session = sessions.get(ws);
  if (session) {
    try { session.stream?.end(); } catch (e) { /* ignore */ }
    console.log(`[STT] Session closed: ${session.sessionId} reason=${reason || 'unknown'}`);
    sessions.delete(ws);
  }
  if (ws.readyState === WebSocket.OPEN) ws.close();
}

/** Create a new Google STT stream for an existing session; keeps WebSocket open for whole call. */
function createNewStreamForSession(session, ws) {
  const client = session.client;
  const config = session.config;
  const sessionId = session.sessionId;
  const oldStream = session.stream;
  if (oldStream) {
    try { oldStream.removeAllListeners(); oldStream.end(); } catch (e) { /* ignore */ }
  }
  const newStream = client
    .streamingRecognize({ config, interimResults: true, singleUtterance: false })
    .on('error', (error) => {
      console.error(`[STT Error ${sessionId}]`, error.message, error);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'error', message: error.message }));
      }
      if (session.streamErrorRecycled) {
        closeSession(ws, 'stream_error');
        return;
      }
      session.streamErrorRecycled = true;
      session.stream = null;
      setImmediate(() => {
        if (ws.readyState !== WebSocket.OPEN || !sessions.has(ws)) return;
        try {
          createNewStreamForSession(session, ws);
          console.log(`[STT] Stream error, recycled new stream for session ${sessionId}`);
        } catch (e) {
          console.error('[STT] Stream recycle after error failed:', e);
          setTimeout(() => {
            if (ws.readyState !== WebSocket.OPEN || !sessions.has(ws)) return;
            try {
              createNewStreamForSession(session, ws);
              console.log(`[STT] Stream error recycle retry succeeded for session ${sessionId}`);
            } catch (e2) {
              console.error('[STT] Stream error recycle retry failed:', e2);
              closeSession(ws, 'stream_error');
            }
          }, 200);
        }
      });
    })
    .on('data', (data) => {
      const s = sessions.get(ws);
      if (!s || !s.stream || !data.results?.length) return;
      const result = data.results[0];
      const alt = result.alternatives?.[0];
      if (!alt?.transcript) return;
      let speakerTag = null;
      if (result.isFinal && alt.words?.length) {
        const tags = alt.words.map(w => w.speakerTag).filter(t => t !== undefined);
        if (tags.length) speakerTag = tags[tags.length - 1];
      }
      const event = {
        type: result.isFinal ? 'final' : 'partial',
        text: alt.transcript,
        speaker: s.speaker,
        speakerTag,
        isFinal: result.isFinal || false,
        confidence: alt.confidence || 0,
        timestamp: Date.now(),
      };
      s.lastActivity = Date.now();
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
    })
    .on('end', () => {
      if (session.stream !== newStream) return;
      session.stream = null;
      if (ws.readyState !== WebSocket.OPEN || !sessions.has(ws)) return;
      setImmediate(() => {
        if (ws.readyState !== WebSocket.OPEN || !sessions.has(ws)) return;
        try {
          createNewStreamForSession(session, ws);
          console.log(`[STT] Stream ended, recycling new stream for session ${sessionId}`);
        } catch (err) {
          console.error('[STT] Stream recycle failed:', err);
          try {
            setTimeout(() => {
              if (ws.readyState !== WebSocket.OPEN || !sessions.has(ws)) return;
              try {
                createNewStreamForSession(session, ws);
                console.log(`[STT] Stream recycle retry succeeded for session ${sessionId}`);
              } catch (e2) {
                console.error('[STT] Stream recycle retry failed:', e2);
                closeSession(ws, 'stream_error');
              }
            }, 200);
          } catch (_) {
            closeSession(ws, 'stream_error');
          }
        }
      });
    })
    .on('close', () => {
      if (session.stream !== newStream) return;
      session.stream = null;
      if (ws.readyState !== WebSocket.OPEN || !sessions.has(ws)) return;
      setImmediate(() => {
        if (ws.readyState !== WebSocket.OPEN || !sessions.has(ws)) return;
        try {
          createNewStreamForSession(session, ws);
          console.log(`[STT] Stream closed, recycling new stream for session ${sessionId}`);
        } catch (err) {
          console.error('[STT] Stream recycle failed:', err);
          try {
            setTimeout(() => {
              if (ws.readyState !== WebSocket.OPEN || !sessions.has(ws)) return;
              try {
                createNewStreamForSession(session, ws);
                console.log(`[STT] Stream recycle retry succeeded for session ${sessionId}`);
              } catch (e2) {
                console.error('[STT] Stream recycle retry failed:', e2);
                closeSession(ws, 'stream_error');
              }
            }, 200);
          } catch (_) {
            closeSession(ws, 'stream_error');
          }
        }
      });
    });
  session.stream = newStream;
  session.streamErrorRecycled = false;
  return newStream;
}

function handleSTTConnection(ws, req) {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const sessionId = url.searchParams.get('session') || `session-${Date.now()}`;
  const speaker = url.searchParams.get('speaker') || 'salesperson';
  const diarize = url.searchParams.get('diarize') === 'true';

  console.log(`[STT] New connection: ${sessionId} (${speaker}) diarize=${diarize}`);

  const client = getSpeechClient();
  if (!client) {
    ws.send(JSON.stringify({ type: 'error', message: 'Google STT not configured' }));
    ws.close();
    return;
  }

  try {
    const config = {
      encoding: 'LINEAR16',
      sampleRateHertz: 16000,
      languageCode: 'en-US',
      model: 'latest_long',
      enableAutomaticPunctuation: true,
      useEnhanced: true,
    };

    if (diarize) {
      config.diarizationConfig = {
        enableSpeakerDiarization: true,
        minSpeakerCount: 2,
        maxSpeakerCount: 2,
      };
    }

    const session = {
      client,
      stream: null,
      speaker,
      sessionId,
      lastActivity: Date.now(),
      totalBytesReceived: 0,
      config,
      diarize,
      streamErrorRecycled: false,
    };
    sessions.set(ws, session);
    createNewStreamForSession(session, ws);
    ws.send(JSON.stringify({ type: 'connected', sessionId, speaker }));

  } catch (err) {
    console.error('[STT] Init error:', err);
    ws.send(JSON.stringify({ type: 'error', message: 'Failed to initialize STT' }));
    ws.close();
    return;
  }

  ws.on('message', (data) => {
    const session = sessions.get(ws);
    if (!session || !session.stream) return;
    try {
      const buffer = Buffer.isBuffer(data) ? data : (typeof data === 'string' ? Buffer.from(data, 'base64') : null);
      if (buffer) {
        session.stream.write(buffer);
        session.lastActivity = Date.now();
        session.totalBytesReceived += buffer.length;
      }
    } catch (err) { /* ignore write errors */ }
  });

  ws.on('close', () => closeSession(ws, 'client_close'));
  ws.on('error', () => closeSession(ws, 'client_error'));
}

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url, true);

    // CORS for extension
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    handle(req, res, parsedUrl);
  });

  const wss = new WebSocket.Server({ noServer: true });

  // Heartbeat to keep connections alive
  setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
        try { ws.send(JSON.stringify({ type: 'heartbeat', timestamp: Date.now() })); } catch (e) { /* ignore */ }
      }
    });
  }, 10000);

  // Route WebSocket upgrades to STT handler
  server.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      handleSTTConnection(ws, req);
    });
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[Combined] Server ready on port ${PORT}`);
    console.log(`[Combined] Next.js: http://0.0.0.0:${PORT}`);
    console.log(`[Combined] WebSocket STT: ws://0.0.0.0:${PORT}`);
  });
});
