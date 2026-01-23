# Live Chat Intelligence

Real-time YouTube live chat visualization with AI-powered topic clustering, sentiment analysis, and community vibe detection.

## Quick Deploy to Spark

### 1. Copy files to Spark
```bash
scp -r ~/Desktop/chat-viz dogginitan@192.168.68.71:~/
```

### 2. SSH to Spark and run
```bash
ssh dogginitan@192.168.68.71
cd ~/chat-viz
chmod +x start.sh

# Set your OpenAI API key (for vibe detection)
export OPENAI_API_KEY="your-key-here"

# Start with a YouTube Live URL
./start.sh "https://www.youtube.com/watch?v=YOUR_VIDEO_ID"
```

### 3. Open visualization
On your Mac, open: http://192.168.68.71:8080/chat_viz_frontend.html

Full-screen this on your second monitor!

## Features

- **Topic Bubbles**: Tickers mentioned cluster into bubbles that grow with mentions
- **Sentiment Battle**: Bull/bear tug-of-war indicator shows contested tickers
- **Questions Surface**: AI detects questions and clusters similar ones
- **Community Vibes**: Funny and uplifting comments scroll along the bottom
- **Velocity Meter**: See how fast chat is moving

## Architecture

```
YouTube Live Chat
       ↓
  [pytchat scraper]
       ↓
  [AI Classification]
   - Ticker extraction (regex)
   - Sentiment (keywords)
   - Questions (regex)
   - Vibes (GPT-4o-mini)
       ↓
  [WebSocket Server :8765]
       ↓
  [React Frontend]
```

## Files

- `chat_viz_backend.py` - Python backend (WebSocket + YouTube scraper)
- `chat_viz_frontend.html` - React visualization UI
- `start.sh` - Launcher script

## Ports

- 8080: HTTP server for frontend
- 8765: WebSocket server for real-time data
