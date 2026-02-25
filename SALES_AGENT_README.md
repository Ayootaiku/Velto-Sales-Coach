# AI Sales Agent Coach

A real-time sales coaching system that captures audio from your microphone, detects objections, and provides AI-powered guidance using OpenAI's GPT models.

## Features

- **Real-time Audio Capture**: Listens to live conversations via microphone
- **Objection Detection**: Automatically identifies common sales objections (price, timing, value, competitors, trust, authority)
- **Instant Coaching**: Provides immediate response suggestions with explanations
- **AI-Powered Analysis**: Uses OpenAI GPT-4o for deeper conversation insights
- **Structured Output**: Delivers clear, actionable recommendations

## Quick Start

### 1. Setup Environment Variables

```bash
# Copy the example env file
cp .env.local.example .env.local

# Add your OpenAI API key
# Get it from: https://platform.openai.com/api-keys
```

Edit `.env.local`:
```
OPENAI_API_KEY=sk-your-actual-api-key-here
OPENAI_MODEL=gpt-4o
```

### 2. Install Dependencies

```bash
npm install
# or
yarn install
# or
pnpm install
```

### 3. Run the Development Server

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
```

### 4. Access the Sales Agent

Open your browser and navigate to:
```
http://localhost:3000/sales-agent
```

## How to Use

1. **Start Listening**: Click the "Start Listening" button to enable microphone access
2. **Speak**: Talk naturally - the system listens for objections in real-time
3. **Get Coaching**: When an objection is detected, you'll see:
   - The objection type identified
   - What to say next (exact response)
   - Why this response works
4. **AI Insights**: The system also sends transcripts to OpenAI for deeper analysis

## Architecture

### Frontend Components

- **`Panel.jsx`**: Main UI component displaying coaching and AI insights
- **`RealTimeCoach.jsx`**: Handles audio capture and real-time objection detection using Web Speech API
- **`page.tsx`**: Next.js page hosting the sales agent panel

### Backend API

- **`/api/sales-agent/route.ts`**: 
  - Receives transcript data
  - Calls OpenAI API when `OPENAI_API_KEY` is configured
  - Falls back to mock data if no API key is present
  - Returns structured JSON with objections, recommendations, and insights

### Data Flow

1. User speaks → Microphone captures audio
2. Web Speech API transcribes speech to text
3. RealTimeCoach detects objections in transcript
4. Panel displays real-time coaching
5. Panel sends transcript to `/api/sales-agent`
6. API calls OpenAI (if key configured) or returns mock data
7. AI insights displayed in UI

## Configuration Options

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENAI_API_KEY` | No | - | Your OpenAI API key for AI analysis |
| `OPENAI_MODEL` | No | `gpt-4o` | OpenAI model to use (gpt-4o, gpt-4-turbo, gpt-3.5-turbo) |

### Without OpenAI API Key

The system works without an API key using built-in mock data:
- Real-time coaching still functions via Web Speech API
- AI insights show demo/example data
- Perfect for testing and development

## Objection Types Detected

| Type | Keywords | Response Strategy |
|------|----------|-------------------|
| **Price** | price, cost, expensive | Isolate objection, shift to value |
| **Timing** | timing, when, delay | Test true readiness and urgency |
| **Value** | value, ROI, return on investment | Anchor on ROI with specifics |
| **Competitor** | competitor, competition, other | Differentiate with unique value |
| **Trust** | trust, reliability | Address with credibility and track record |
| **Authority** | decision maker, buying group, approval | Enable momentum with stakeholder materials |

## Browser Support

- **Chrome/Edge**: Full support (Web Speech API + all features)
- **Safari**: Limited support (Web Speech API may not work)
- **Firefox**: Limited support (Web Speech API may not work)

## Troubleshooting

### "No audio detected" message
- Check microphone permissions in browser
- Ensure microphone is not muted
- Try refreshing the page and clicking "Start Listening" again

### Build errors
- Make sure all files have `"use client"` directive at the top
- Run `npm install` to ensure dependencies are installed
- Clear `.next` cache: `rm -rf .next`

### OpenAI API errors
- Verify your API key is correct in `.env.local`
- Check if you have API credits available
- Review OpenAI status page for outages

## File Structure

```
app/
├── sales-agent/
│   └── page.tsx              # Sales agent page
├── api/
│   └── sales-agent/
│       └── route.ts          # OpenAI API integration
ui/
└── sales-agent/
    ├── Panel.jsx             # Main UI component
    ├── RealTimeCoach.jsx     # Audio capture & real-time coaching
    └── styles.css            # Styling
.env.local.example            # Environment template
```

## Next Steps / Future Enhancements

- [ ] Add conversation history persistence
- [ ] Implement more sophisticated objection detection with ML
- [ ] Add call recording and playback
- [ ] Create analytics dashboard for call metrics
- [ ] Support multiple languages
- [ ] Add team collaboration features

## Support

For issues with:
- **OpenAI integration**: Check OpenAI documentation and API status
- **Web Speech API**: Review browser compatibility and permissions
- **General bugs**: Check browser console for error messages
