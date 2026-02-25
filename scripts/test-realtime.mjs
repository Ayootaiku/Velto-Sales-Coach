#!/usr/bin/env node
/**
 * Test real-time coaching with debug indicators
 */

const API_BASE = 'http://localhost:3000';

async function testRealtimeCoaching() {
  console.log('🧪 Testing Real-Time Coaching System\n');
  
  // Test 1: Fast greeting detection
  console.log('1️⃣ Testing fast greeting detection...');
  const start1 = Date.now();
  const res1 = await fetch(`${API_BASE}/api/coach/live`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transcript: [{ speaker: 'prospect', text: 'hi' }],
      lastSpeaker: 'prospect'
    })
  });
  const latency1 = Date.now() - start1;
  const result1 = await res1.json();
  
  console.log(`   Stage: ${result1.stage}`);
  console.log(`   Latency: ${latency1}ms ${latency1 < 100 ? '✅' : '⚠️'}`);
  console.log(`   Say next: ${result1.say_next?.substring(0, 50)}...`);
  console.log();
  
  // Test 2: Minimal context payload
  console.log('2️⃣ Testing minimal context (last 1-2 turns only)...');
  const start2 = Date.now();
  const res2 = await fetch(`${API_BASE}/api/coach/live`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transcript: [
        { speaker: 'salesperson', text: 'Hello how can I help' },
        { speaker: 'prospect', text: 'The price is too high' }
      ],
      lastSpeaker: 'prospect'
    })
  });
  const latency2 = Date.now() - start2;
  const result2 = await res2.json();
  
  console.log(`   Stage: ${result2.stage}`);
  console.log(`   Objection Type: ${result2.objection_type || 'N/A'}`);
  console.log(`   Latency: ${latency2}ms`);
  console.log();
  
  // Test 3: Filler word detection
  console.log('3️⃣ Testing filler word handling...');
  const res3 = await fetch(`${API_BASE}/api/coach/live`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transcript: [{ speaker: 'prospect', text: 'um uh' }],
      lastSpeaker: 'prospect'
    })
  });
  const result3 = await res3.json();
  
  console.log(`   Stage: ${result3.stage} (should be Hesitation)`);
  console.log(`   Confidence: ${result3.confidence}%`);
  console.log();
  
  console.log('✅ Real-time coaching system tests complete!');
  console.log('\n📊 Expected behavior:');
  console.log('   - Greetings: < 100ms response');
  console.log('   - Objections: Fast local detection');
  console.log('   - Filler words: Identified as Hesitation');
  console.log('   - Debug indicators: Updating 20x/sec');
}

testRealtimeCoaching().catch(console.error);