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
  const sessionId = session ? session.sessionId : 'no-session';
  if (session) {
    try { session.stream?.end(); } catch (e) { /* ignore */ }
    sessions.delete(ws);
  }
  console.log(`[STT] Session closed: ${sessionId} (reason: ${reason || 'unknown'})`);
  if (ws.readyState === WebSocket.OPEN) ws.close();
}

/** When Google stream ends/closes, recreate it for the same client so the client WS stays open (fixes Tracy dying after first call). */
function replaceStreamForSession(ws, reason) {
  const session = sessions.get(ws);
  if (!session || ws.readyState !== WebSocket.OPEN) return;
  console.log(`[STT] Recreating Google stream for ${session.sessionId} (reason: ${reason})`);
  try {
    if (session.stream) {
      session.stream.removeAllListeners();
      try { session.stream.end(); } catch (e) { /* ignore */ }
    }
    const newStream = createRecognizeStream(ws, session.sessionId, session.speaker, session.diarize);
    session.stream = newStream;
    session.lastActivity = Date.now();
  } catch (err) {
    console.error(`[STT] Failed to recreate stream for ${session.sessionId}:`, err.message);
    closeSession(ws, 'recreate failed');
  }
}

/** Create a Google streamingRecognize stream; on end/close calls replaceStreamForSession (keep client open). */
function createRecognizeStream(ws, sessionId, speaker, diarize) {
  const client = getSpeechClient();
  if (!client) return null;
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
  const stream = client
    .streamingRecognize({ config, interimResults: true, singleUtterance: false })
    .on('error', (error) => {
      console.error(`[STT Error ${sessionId}] stream error:`, error.message, error.code || '', error.details || '');
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'error', message: error.message }));
      }
      closeSession(ws, 'stream error');
    })
    .on('data', (data) => {
      const session = sessions.get(ws);
      if (!session || !data.results?.length) return;
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
        speaker: session.speaker,
        speakerTag,
        isFinal: result.isFinal || false,
        confidence: alt.confidence || 0,
        timestamp: Date.now(),
      };
      session.lastActivity = Date.now();
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event));
    })
    .on('end', () => replaceStreamForSession(ws, 'stream end'))
    .on('close', () => replaceStreamForSession(ws, 'stream close'));
  return stream;
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
    const stream = createRecognizeStream(ws, sessionId, speaker, diarize);
    sessions.set(ws, { client, stream, speaker, sessionId, diarize, lastActivity: Date.now(), totalBytesReceived: 0 });
    ws.send(JSON.stringify({ type: 'connected', sessionId, speaker }));
  } catch (err) {
    console.error('[STT] Init error:', err);
    ws.send(JSON.stringify({ type: 'error', message: 'Failed to initialize STT' }));
    ws.close();
    return;
  }

  ws.on('message', (data) => {
    const session = sessions.get(ws);
    if (!session) return;
    try {
      const buffer = Buffer.isBuffer(data) ? data : (typeof data === 'string' ? Buffer.from(data, 'base64') : null);
      if (buffer) {
        session.stream.write(buffer);
        session.lastActivity = Date.now();
        session.totalBytesReceived += buffer.length;
      }
    } catch (err) { /* ignore write errors */ }
  });

  ws.on('close', () => closeSession(ws, 'client close'));
  ws.on('error', () => closeSession(ws, 'client error'));
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
