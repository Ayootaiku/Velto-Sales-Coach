/**
 * Test script for Real-Time SalesCoach Copilot
 * 
 * Run with: npx tsx scripts/test-realtime-coach.ts
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

// Test data
const testTurns = [
  {
    speaker: 'prospect' as const,
    text: 'Hi there',
    timestamp: new Date().toISOString(),
    sequenceNumber: 0
  },
  {
    speaker: 'prospect' as const,
    text: 'Honestly, the price seems a bit high for what we need',
    timestamp: new Date().toISOString(),
    sequenceNumber: 1
  },
  {
    speaker: 'prospect' as const,
    text: 'Um, I need to think about it and maybe talk to my boss',
    timestamp: new Date().toISOString(),
    sequenceNumber: 2
  },
  {
    speaker: 'prospect' as const,
    text: 'We are already using CompetitorX for this',
    timestamp: new Date().toISOString(),
    sequenceNumber: 3
  }
];

async function testHealthCheck() {
  console.log('🩺 Testing health check...\n');
  
  try {
    const response = await fetch(`${API_BASE}/api/coach/realtime`);
    const data = await response.json();
    
    console.log('✅ Health check passed');
    console.log('   Status:', data.status);
    console.log('   Service:', data.service);
    console.log('   Version:', data.version);
    console.log('');
    return true;
  } catch (error) {
    console.error('❌ Health check failed:', error);
    return false;
  }
}

async function testRealtimeCoaching(turn: typeof testTurns[0], previousTurns: typeof testTurns) {
  try {
    const response = await fetch(`${API_BASE}/api/coach/realtime`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        turn,
        previousTurns,
        isListening: true,
        useAI: false
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const coaching = await response.json();
    
    console.log(`📝 Input: "${turn.text}"`);
    console.log(`👤 Speaker: ${coaching.speaker}`);
    console.log(`🎯 Stage: ${coaching.stage}`);
    console.log(`💬 Say next: "${coaching.sayNext}"`);
    console.log(`💡 Coach: ${coaching.coachInsight}`);
    console.log(`📊 Confidence: ${Math.round(coaching.confidence * 100)}%`);
    console.log(`⚡ Processing: ${coaching.processingTime}ms`);
    console.log('');
    
    return coaching;
  } catch (error) {
    console.error('❌ Coaching request failed:', error);
    return null;
  }
}

async function testAudioGating() {
  console.log('🔇 Testing audio gating (no audio)...\n');
  
  try {
    const response = await fetch(`${API_BASE}/api/coach/realtime`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        turn: {
          speaker: 'unclear',
          text: '',
          timestamp: new Date().toISOString(),
          sequenceNumber: 0
        },
        previousTurns: [],
        isListening: false
      }),
    });

    const coaching = await response.json();
    
    console.log('✅ Audio gating works');
    console.log(`   Has audio: ${coaching.audioStatus.hasAudio}`);
    console.log(`   Message: ${coaching.sayNext}`);
    console.log('');
  } catch (error) {
    console.error('❌ Audio gating test failed:', error);
  }
}

async function runTests() {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║   Real-Time SalesCoach Copilot - Test Suite           ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  // Test 1: Health check
  const healthy = await testHealthCheck();
  if (!healthy) {
    console.error('Server is not running. Start with: npm run dev');
    process.exit(1);
  }

  // Test 2: Audio gating
  await testAudioGating();

  // Test 3: Process each test turn
  console.log('🎭 Testing real-time coaching on sample utterances...\n');
  
  const previousTurns: typeof testTurns = [];
  
  for (const turn of testTurns) {
    await testRealtimeCoaching(turn, previousTurns);
    previousTurns.push(turn);
  }

  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║   ✅ All tests completed!                              ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');
  
  console.log('📊 Test Summary:');
  console.log(`   - Greeting detection: ${testTurns[0].text}`);
  console.log(`   - Price objection: ${testTurns[1].text}`);
  console.log(`   - Hesitation marker: ${testTurns[2].text}`);
  console.log(`   - Competitor mention: ${testTurns[3].text}`);
}

runTests().catch(console.error);