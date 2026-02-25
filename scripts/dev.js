/**
 * Combined Server - Next.js + WebSocket STT
 * Run with: npm run dev
 * This starts both the Next.js app and WebSocket STT server together
 */

const { spawn } = require('child_process');
const path = require('path');

// Colors for console output
const colors = {
  next: '\x1b[36m',    // Cyan
  ws: '\x1b[35m',      // Magenta
  error: '\x1b[31m',   // Red
  success: '\x1b[32m', // Green
  reset: '\x1b[0m'
};

console.log(`${colors.success}🚀 Starting Combined Development Server...${colors.reset}\n`);

// Track process states
let nextReady = false;
let wsReady = false;

function checkAllReady() {
  if (nextReady && wsReady) {
    console.log(`\n${colors.success}✅ All servers ready!${colors.reset}`);
    console.log(`${colors.next}  → Next.js app:${colors.reset} http://localhost:3000`);
    console.log(`${colors.ws}  → WebSocket STT:${colors.reset} ws://localhost:3002`);
    console.log(`\n${colors.success}🎤 Audio transcription is ready to use!${colors.reset}\n`);
  }
}

// Start Next.js dev server
const nextProcess = spawn('npx', ['next', 'dev'], {
  stdio: 'pipe',
  shell: true,
  cwd: path.join(__dirname, '..')
});

// Start WebSocket STT Server
const wsProcess = spawn('node', ['server/websocket-stt-server.js'], {
  stdio: 'pipe',
  cwd: path.join(__dirname, '..')
});

// Prefix logs from Next.js
nextProcess.stdout.on('data', (data) => {
  const lines = data.toString().trim().split('\n');
  lines.forEach(line => {
    if (line.trim()) {
      // Detect when Next.js is ready
      if (line.includes('Ready') || line.includes('ready')) {
        nextReady = true;
        checkAllReady();
      }
      console.log(`${colors.next}[Next.js]${colors.reset} ${line}`);
    }
  });
});

nextProcess.stderr.on('data', (data) => {
  const lines = data.toString().trim().split('\n');
  lines.forEach(line => {
    if (line.trim()) {
      console.error(`${colors.error}[Next.js Error]${colors.reset} ${line}`);
    }
  });
});

// Prefix logs from WebSocket server
wsProcess.stdout.on('data', (data) => {
  const lines = data.toString().trim().split('\n');
  lines.forEach(line => {
    if (line.trim()) {
      // Detect when WebSocket is ready
      if (line.includes('Ready to accept connections')) {
        wsReady = true;
        checkAllReady();
      }
      console.log(`${colors.ws}[WebSocket]${colors.reset} ${line}`);
    }
  });
});

wsProcess.stderr.on('data', (data) => {
  const lines = data.toString().trim().split('\n');
  lines.forEach(line => {
    if (line.trim()) {
      console.error(`${colors.error}[WebSocket Error]${colors.reset} ${line}`);
    }
  });
});

// Handle process exits
nextProcess.on('close', (code) => {
  console.log(`${colors.next}[Next.js]${colors.reset} process exited with code ${code}`);
  wsProcess.kill();
  process.exit(code);
});

wsProcess.on('close', (code) => {
  console.log(`${colors.ws}[WebSocket]${colors.reset} process exited with code ${code}`);
  nextProcess.kill();
  process.exit(code);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log(`\n${colors.error}Shutting down servers...${colors.reset}`);
  nextProcess.kill('SIGINT');
  wsProcess.kill('SIGINT');
});

process.on('SIGTERM', () => {
  console.log(`\n${colors.error}Shutting down servers...${colors.reset}`);
  nextProcess.kill('SIGTERM');
  wsProcess.kill('SIGTERM');
});

console.log(`${colors.next}[Next.js]${colors.reset} Starting on port 3000...`);
console.log(`${colors.ws}[WebSocket]${colors.reset} Starting on port 3002...\n`);
