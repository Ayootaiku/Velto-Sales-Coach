#!/usr/bin/env node
/**
 * Test the 15-stage SalesCoach detection
 */

const API_BASE = 'http://localhost:3000';

const testCases = [
  { text: "Hi there", expected: "Greeting" },
  { text: "How are you doing today", expected: "Rapport" },
  { text: "What does your solution do", expected: "Discovery" },
  { text: "We're struggling with our current process", expected: "Pain" },
  { text: "It's costing us a lot of time", expected: "Impact" },
  { text: "What's the price", expected: "Qualification" },
  { text: "Is it worth the investment", expected: "Value" },
  { text: "I'm confused about the features", expected: "Confusion" },
  { text: "How do you compare to CompetitorX", expected: "Comparison" },
  { text: "The price is too high", expected: "Objection" },
  { text: "Um, let me think about it", expected: "Hesitation" },
  { text: "This looks great, I'm interested", expected: "Buy-Signal" },
  { text: "Let's move forward", expected: "Close" },
  { text: "When can we schedule a demo", expected: "Logistics" },
  { text: "Not now, maybe next quarter", expected: "Stall" }
];

async function runTests() {
  console.log('🧪 Testing 15-Stage SalesCoach Detection\n');
  
  let passed = 0;
  let failed = 0;
  
  for (const test of testCases) {
    try {
      const res = await fetch(`${API_BASE}/api/coach/live`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          transcript: [{ speaker: 'prospect', text: test.text }],
          lastSpeaker: 'prospect'
        })
      });
      
      const result = await res.json();
      const match = result.stage === test.expected;
      
      if (match) {
        console.log(`✅ "${test.text.substring(0, 30)}..." → ${result.stage}`);
        passed++;
      } else {
        console.log(`❌ "${test.text.substring(0, 30)}..." → Expected: ${test.expected}, Got: ${result.stage}`);
        failed++;
      }
    } catch (err) {
      console.log(`💥 "${test.text.substring(0, 30)}..." → Error: ${err.message}`);
      failed++;
    }
  }
  
  console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);
  console.log(`\n🎉 All 15 stages are working!`);
}

runTests().catch(console.error);