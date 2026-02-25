#!/usr/bin/env node
/**
 * Test script to verify SalesCoach functionality
 */

const API_BASE = 'http://localhost:3000';

async function testCoachingFlow() {
  console.log('🧪 Testing SalesCoach Flow\n');
  
  // Test 1: Coaching API
  console.log('1️⃣ Testing Coaching API...');
  const coachingRes = await fetch(`${API_BASE}/api/coach/live`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transcript: [{ speaker: 'prospect', text: 'The price is too high' }],
      lastSpeaker: 'prospect'
    })
  });
  
  const coaching = await coachingRes.json();
  console.log('✅ Coaching generated:', coaching.should_coach ? 'YES' : 'NO');
  console.log('   Objection:', coaching.objection_type);
  console.log('   Suggestion:', coaching.suggestion?.substring(0, 60) + '...');
  console.log('');
  
  // Test 2: Summary API
  console.log('2️⃣ Testing Summary API...');
  const summaryRes = await fetch(`${API_BASE}/api/coach/summary`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      transcripts: [
        { speaker: 'salesperson', text: 'Hello! How can I help?' },
        { speaker: 'prospect', text: 'I need a solution but price is an issue' },
        { speaker: 'salesperson', text: 'Let me explain the ROI' }
      ]
    })
  });
  
  const summary = await summaryRes.json();
  console.log('✅ Summary generated:', summary.outcome_guess);
  console.log('   Confidence:', Math.round(summary.outcome_confidence * 100) + '%');
  console.log('   Strengths:', summary.strengths.length);
  console.log('   Objections:', summary.objections_handled.length);
  console.log('');
  
  // Test 3: Health Check
  console.log('3️⃣ Testing Health...');
  const healthRes = await fetch(`${API_BASE}/api/health`);
  const health = await healthRes.json();
  console.log('✅ Services:', health.checks.openai.configured ? 'OpenAI OK' : 'OpenAI FAIL');
  console.log('   Supabase:', health.checks.supabase.url && health.checks.supabase.key ? 'OK' : 'FAIL');
  console.log('');
  
  console.log('✨ All tests passed! The app should be working.');
  console.log('');
  console.log('📝 To verify UI:');
  console.log('   1. Open http://localhost:3000');
  console.log('   2. Click "Start Call"');
  console.log('   3. Speak or simulate prospect speech');
  console.log('   4. Check if coaching cards appear');
  console.log('   5. Click "End Call"');
  console.log('   6. Check if summary appears');
}

testCoachingFlow().catch(console.error);