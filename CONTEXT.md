# Live Chat Intelligence - Project Context

> **Last Updated:** January 23, 2026
> **Status:** Chrome Extension MVP Complete + Pop-Out Window Feature
> **Location:** `/Users/andrewnolan/Desktop/chat-viz/`

---

## Project Vision

**Phase 1 (Current):** Analytical dashboard for trading streams - ticker detection, sentiment, questions
**Phase 2 (Future):** Experiential visualization - chat as art, not chaos

Two deployment modes from one engine:
- **Viewer Mode:** Anyone watching a live stream can visualize the chat
- **Creator Mode:** Channel owner gets additional tools (Q&A queue, analytics, highlights)

---

## What We Built

### Core Engine (All Working ✅)

| Feature | Description | Tech |
|---------|-------------|------|
| **Ticker Detection** | 600+ stocks, ETFs, crypto via 3-tier system | Regex + whitelist |
| **Sentiment Analysis** | Bullish/bearish per message | Keywords + emoji |
| **Topic Bubbles** | Visual clusters that grow organically | JS + CSS |
| **Questions Panel** | Surfaces questions from chat | 12-pattern regex |
| **Spam Filter** | Hybrid rule-based + LLM fallback | ~90% accuracy |
| **Chat Pulse** | AI summaries every 2 minutes | Ollama local |
| **Community Vibes** | Funny/uplifting message ticker | LLM classification |

### Chrome Extension (Complete ✅)

```
extension/
├── manifest.json          # Manifest V3 + tabs permission
├── background.js          # Service worker, WebSocket, port broadcasting
├── content.js             # YouTube live stream detection
├── sidepanel/
│   ├── panel.html         # Side panel UI
│   ├── panel.css          # Shared styling
│   ├── panel.js           # Side panel logic + port connection
│   ├── standalone.html    # Pop-out window (full-screen responsive)
│   └── standalone.js      # Standalone logic (ports or direct WebSocket)
└── icons/                 # Extension icons (16, 48, 128px)
```

### Pop-Out Window Feature (NEW ✅)

- **⧉ button** in side panel header launches standalone window
- Works for: **second monitors, OBS browser sources, dedicated windows**
- Responsive grid layout that fills entire screen
- Bubbles scale dynamically based on window size
- Can also work outside extension context (direct WebSocket for OBS)

### Backend v2 (Complete ✅)

- Accepts video ID via WebSocket (not just CLI)
- Multi-tenant: one scraper per stream, fans out to all viewers
- Supports SUBSCRIBE/UNSUBSCRIBE messages from extension
- Runs in virtual environment with all dependencies

---

## File Structure

```
/Users/andrewnolan/Desktop/chat-viz/
├── chat_viz_backend.py        # Original backend (CLI only)
├── chat_viz_backend_v2.py     # WebSocket-initiated streams
├── chat_viz_frontend.html     # Standalone frontend (legacy)
├── start.sh                   # Startup script
├── extension/                 # Chrome extension
│   ├── manifest.json
│   ├── background.js
│   ├── content.js
│   ├── sidepanel/
│   │   ├── panel.html
│   │   ├── panel.css
│   │   ├── panel.js
│   │   ├── standalone.html    # Pop-out window
│   │   └── standalone.js
│   └── icons/
├── venv/                      # Python virtual environment
├── .env
└── CONTEXT.md
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    BROWSER (Chrome)                              │
│                                                                  │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │  YouTube    │    │ content.js  │    │ background  │         │
│  │  Live Page  │───▶│ (detect     │───▶│ (WebSocket  │         │
│  │             │    │  live)      │    │  manager)   │         │
│  └─────────────┘    └─────────────┘    └──────┬──────┘         │
│                                               │                 │
│         ┌─────────────────────────────────────┤                 │
│         │ Port connections (chrome.runtime.connect)             │
│         ▼                                     ▼                 │
│  ┌─────────────────┐              ┌─────────────────┐          │
│  │   SIDE PANEL    │              │  POP-OUT WINDOW │          │
│  │   (panel.js)    │              │ (standalone.js) │          │
│  │                 │              │                 │          │
│  │ Topics|Questions│              │ Full-screen     │          │
│  │ Pulse | Vibes   │              │ responsive grid │          │
│  └─────────────────┘              └─────────────────┘          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼ WebSocket (:8765)
┌─────────────────────────────────────────────────────────────────┐
│                    BACKEND (localhost:8765)                      │
│                                                                  │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │  WebSocket  │    │   pytchat   │    │   Ollama    │         │
│  │   Server    │◀───│  (scraper)  │───▶│  (AI/LLM)   │         │
│  └─────────────┘    └─────────────┘    └─────────────┘         │
│         │                                      │                 │
│         └──────────────────────────────────────┘                 │
│              One scraper per stream, fans out                    │
└─────────────────────────────────────────────────────────────────┘
```

### Pop-Out Window Layout (Full Screen)

```
┌─────────────────────────────┬──────────────────┐
│                             │                  │
│      TOPIC CLUSTERS         │    QUESTIONS     │
│      (bubbles scale         │                  │
│       with window)          │                  │
│                             │                  │
├─────────────────────────────┴──────────────────┤
│                  CHAT PULSE                    │
├────────────────────────────────────────────────┤
│               COMMUNITY VIBES                  │
└────────────────────────────────────────────────┘
```

---

## How to Run

### 1. Start Backend

```bash
cd /Users/andrewnolan/Desktop/chat-viz
source venv/bin/activate
python3 chat_viz_backend_v2.py
```

### 2. Load/Reload Chrome Extension

1. Go to `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked** (first time) or **Refresh** icon
4. Select `/Users/andrewnolan/Desktop/chat-viz/extension`

### 3. Use on YouTube

1. Navigate to any YouTube Live stream
2. Click extension icon to open side panel
3. Side panel auto-connects and shows visualization
4. Click **⧉** button to pop out to separate window

---

## Key Technical Details

### Port-Based Messaging
- `background.js` uses `chrome.runtime.onConnect` to accept port connections
- `panel.js` and `standalone.js` both connect via `chrome.runtime.connect()`
- Background broadcasts to all connected ports when data arrives
- More reliable than `runtime.sendMessage` for persistent connections

### Standalone Window Modes
1. **Extension context:** Uses port connection through background script
2. **Direct WebSocket:** Falls back to direct connection (for OBS browser sources)

### Responsive Bubble Sizing
```javascript
const w = window.innerWidth;
const baseSize = w > 1600 ? 90 : w > 1200 ? 80 : w > 800 ? 70 : 60;
const maxSize = w > 1600 ? 180 : w > 1200 ? 160 : w > 800 ? 140 : 120;
```

---

## Deployment

### Backend Deployment (Ready!)

The backend now supports both Ollama (local) and Groq (cloud) via environment variables.

**Files created:**
- `requirements.txt` - Python dependencies
- `railway.toml` - Railway config
- `render.yaml` - Render config
- `Procfile` - Generic process file
- `.gitignore` - Excludes sensitive files
- `.env.example` - Environment variable template

**Environment Variables:**
| Variable | Description | Default |
|----------|-------------|--------|
| `LLM_PROVIDER` | "ollama" or "groq" | ollama |
| `GROQ_API_KEY` | Groq API key (required if provider=groq) | - |
| `GROQ_MODEL` | Groq model name | llama-3.1-8b-instant |
| `PORT` | WebSocket port (auto-set by Railway/Render) | 8765 |

**Railway Deployment:**
```bash
# 1. Push to GitHub
cd /Users/andrewnolan/Desktop/chat-viz
git init && git add . && git commit -m "Initial commit"
git remote add origin https://github.com/yourusername/live-chat-intelligence.git
git push -u origin main

# 2. In Railway dashboard:
#    - New Project → Deploy from GitHub repo
#    - Add environment variables:
#      - LLM_PROVIDER=groq
#      - GROQ_API_KEY=your_key_here
#    - Railway assigns URL like: live-chat-intelligence-production.up.railway.app
```

**Get a Groq API Key:**
1. Go to https://console.groq.com
2. Sign up (free tier: 30 req/min, 6000 tokens/min)
3. Create API key

### After Deployment
- [ ] Update `BACKEND_URL` in extension to Railway/Render URL
- [ ] Host standalone.html publicly for OBS users
- [ ] Submit to Chrome Web Store

## Next Steps

### Features
- [ ] Creator mode with YouTube OAuth
- [ ] Save/export session data
- [ ] Customizable ticker watchlist
- [ ] Sound alerts for specific tickers or high activity
- [ ] Settings panel (backend URL, theme preferences)

### Polish
- [ ] Chrome Web Store submission
- [ ] Better onboarding (first-time user experience)
- [ ] Loading states and error handling improvements
- [ ] Reconnection UX (show countdown, status)

### Technical Debt
- [ ] Update `websockets` import (deprecation warning)
- [ ] Add proper TypeScript types (optional)
- [ ] Unit tests for ticker detection

---

## Key Decisions Made

| Decision | Reasoning |
|----------|-----------|
| Chrome extension | Works for both creators AND viewers from same codebase |
| Side panel (not popup) | Better for dashboard-style persistent UI |
| Port-based messaging | More reliable than runtime.sendMessage for multiple windows |
| Pop-out as extension page | Shares code with side panel, gets extension permissions |
| WebSocket subscription model | One backend scraper per stream, scales to many viewers |
| Manifest V3 | Required for new Chrome extensions |
| Local Ollama first | Zero cost during development, swap to Groq for deployment |
| Virtual environment | Isolates Python dependencies, avoids system conflicts |

---

## Dependencies

**Backend:**
- Python 3.10+
- pytchat
- websockets
- httpx
- emoji

**Extension:**
- Chrome 114+ (for side panel API)
- Manifest V3

**AI:**
- Ollama on Spark (192.168.68.71:11434)
- Model: qwen2.5:3b

---

## Commands Reference

```bash
# Start backend (with venv)
cd /Users/andrewnolan/Desktop/chat-viz
source venv/bin/activate
python3 chat_viz_backend_v2.py

# Stop backend
pkill -f "chat_viz_backend_v2.py"

# Check what's running on WebSocket port
lsof -i :8765

# Test Ollama
curl http://192.168.68.71:11434/api/tags

# Install/update dependencies (if needed)
source venv/bin/activate
pip install websockets pytchat httpx emoji
```
