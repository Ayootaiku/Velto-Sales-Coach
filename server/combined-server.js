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

// Prevent uncaught errors from killing the process (which would drop all WS with 1006)
process.on('uncaughtException', (err) => {
  console.error('[Combined] uncaughtException:', err?.message || err);
});
process.on('unhandledRejection', (reason, p) => {
  console.error('[Combined] unhandledRejection:', reason);
});

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
    try {
      if (session.stream) {
        // Do NOT call removeAllListeners() to prevent unhandled 'error' events crashing the Node.js process
        session.stream.end();
      }
    } catch (e) { /* ignore */ }
    console.log(`[STT] Session closed: ${session.sessionId} reason=${reason || 'unknown'}`);
    sessions.delete(ws);
  }
  // Send proper close frame (1000) so client sees normal close, not 1006
  if (ws.readyState === WebSocket.OPEN) {
    try { ws.close(1000, reason || 'session_closed'); } catch (e) { /* ignore */ }
  }
}

/** Create a new Google STT stream for an existing session; keeps WebSocket open for whole call. */
function createNewStreamForSession(session, ws) {
  const client = session.client;
  const config = session.config;
  const sessionId = session.sessionId;
  const oldStream = session.stream;
  if (oldStream) {
    try { oldStream.end(); } catch (e) { /* ignore */ }
  }
  const newStream = client
    .streamingRecognize({ config, interimResults: true, singleUtterance: false })
    .on('error', (error) => {
      console.error(`[STT Error ${sessionId}]`, error.message);
      // If Railway proxy or Google drops the stream, attempt ONE silent recreation 
      // before giving up and closing the WebSocket.
      if (!session.streamErrorRecycled && ws.readyState === WebSocket.OPEN) {
        console.log(`[STT] ${sessionId}: Attempting silent stream recovery...`);
        session.streamErrorRecycled = true;
        createNewStreamForSession(session, ws);
      } else {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'error', message: error.message }));
        }
        closeSession(ws, 'stream_error_max_retries');
      }
    })
    .on('data', (data) => {
      // (same as before)
      try {
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
      } catch (e) {
        console.error('[STT] Data handler error:', e?.message || e);
      }
    })
    .on('end', () => {
      if (session.stream !== newStream) return;
      console.log(`[STT] ${sessionId}: Stream ended (5min limit reached?). Recycling...`);
      createNewStreamForSession(session, ws);
    })
    .on('close', () => {
      // (same as 'end')
      if (session.stream !== newStream) return;
      console.log(`[STT] ${sessionId}: Stream closed by server. Recycling...`);
      createNewStreamForSession(session, ws);
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
      // Check if this is our small JSON 'pong' keep-alive packet (client side stringifies)
      // Since ws receives strings as Buffers by default, we safely decode small data packets:
      if (data.length < 50) {
        const str = Buffer.isBuffer(data) ? data.toString('utf8') : data;
        if (typeof str === 'string' && str.includes('"type":"pong"')) return;
      }

      const buffer = Buffer.isBuffer(data) ? data : (typeof data === 'string' ? Buffer.from(data, 'base64') : null);
      if (buffer) {
        session.stream.write(buffer);
        session.lastActivity = Date.now();
        session.totalBytesReceived += buffer.length;
      }
    } catch (err) { /* ignore write errors */ }
  });

  ws.on('close', (code, reason) => {
    const session = sessions.get(ws);
    console.log('[WS] close', { code, reason: reason?.toString?.(), sessionId: session?.sessionId });
    closeSession(ws, 'client_close_' + code); // removes session from sessions Map so new connections are not blocked
  });
  ws.on('error', (err) => {
    console.error('[WS] error', err);
    closeSession(ws, 'client_error'); // cleanup on error too so session is always removed
  });
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

  // Heartbeat every 5s to avoid proxy/platform idle timeout (1006); Railway can drop after ~10min without traffic
  const HEARTBEAT_MS = 5000;
  setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.ping();
          ws.send(JSON.stringify({ type: 'heartbeat', timestamp: Date.now() }));
        } catch (e) { /* ignore */ }
      }
    });
  }, HEARTBEAT_MS);

  // Route WebSocket upgrades to STT handler; enable TCP keepalive to reduce 1006 from proxy idle
  server.on('upgrade', (req, socket, head) => {
    try { socket.setKeepAlive(true, 5000); } catch (e) { /* ignore */ }
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
