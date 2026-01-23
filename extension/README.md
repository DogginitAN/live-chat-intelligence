# Live Chat Intelligence - Chrome Extension

## Quick Start

### 1. Load the Extension

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in top right)
3. Click **Load unpacked**
4. Select this folder: `/Users/andrewnolan/Desktop/chat-viz/extension`

### 2. Start the Backend

In a terminal:
```bash
cd /Users/andrewnolan/Desktop/chat-viz
./start.sh "https://www.youtube.com/watch?v=VIDEO_ID"
```

Or manually:
```bash
# Terminal 1: Start backend
source venv/bin/activate
python3 chat_viz_backend.py "YOUTUBE_LIVE_URL"
```

### 3. Use the Extension

1. Navigate to a YouTube Live stream
2. Click the extension icon in Chrome toolbar
3. The side panel opens with live chat visualization

---

## File Structure

```
extension/
├── manifest.json          # Extension configuration (Manifest V3)
├── background.js          # Service worker - manages connections
├── content.js             # Runs on YouTube - detects live streams
├── sidepanel/
│   ├── panel.html         # Side panel UI structure
│   ├── panel.css          # Styling
│   └── panel.js           # Visualization logic
└── icons/
    ├── icon16.png
    ├── icon32.png
    ├── icon48.png
    └── icon128.png
```

---

## How It Works

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   YouTube Page  │────▶│  content.js     │────▶│  background.js  │
│   (Live Stream) │     │  (Detects live) │     │  (WebSocket)    │
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                         │
                                                         ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│    Side Panel   │◀────│   panel.js      │◀────│    Backend      │
│  (Visualization)│     │  (Renders UI)   │     │  (localhost)    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

1. **content.js** runs on YouTube, detects when you're on a live stream
2. **background.js** receives detection, shows "LIVE" badge, manages WebSocket
3. User clicks extension icon → **side panel** opens
4. **panel.js** receives chat data via background and renders visualization

---

## Development

### Reload Extension
After making changes:
1. Go to `chrome://extensions/`
2. Click the refresh icon on the extension card

### View Logs
- **Content script**: F12 on YouTube page → Console
- **Background**: `chrome://extensions/` → "service worker" link → Console
- **Side panel**: Right-click panel → Inspect → Console

### Key Files to Edit

| To change... | Edit... |
|--------------|---------|
| What streams are detected | `content.js` |
| WebSocket connection | `background.js` |
| UI layout | `sidepanel/panel.html` |
| Visual styling | `sidepanel/panel.css` |
| Data handling & rendering | `sidepanel/panel.js` |

---

## Backend Requirements

The extension connects to `ws://localhost:8765` by default.

To use the extension, you need:
1. The chat_viz_backend.py running locally
2. Ollama running on Spark (192.168.68.71:11434) for AI features

### Changing Backend URL

In `background.js`, line 12:
```javascript
const BACKEND_URL = 'ws://localhost:8765';  // Change this
```

---

## Next Steps

### Phase 1: Test locally
- [ ] Load extension in Chrome
- [ ] Test with a live YouTube stream
- [ ] Verify data flows end-to-end

### Phase 2: Backend deployment
- [ ] Modify backend to accept video URL via WebSocket
- [ ] Deploy backend to Railway/Fly.io
- [ ] Update extension to use deployed backend

### Phase 3: Creator mode
- [ ] Add YouTube OAuth
- [ ] Implement creator verification
- [ ] Add creator-only features (Q&A queue, etc.)

---

## Troubleshooting

**Extension doesn't show "LIVE" badge:**
- Check if the stream is actually live (not a premiere or VOD)
- Open F12 on YouTube and check for content.js logs

**Side panel shows "Disconnected":**
- Make sure backend is running: `lsof -i :8765`
- Check background.js console for WebSocket errors

**No data appearing:**
- Verify backend is receiving chat: check backend terminal output
- Make sure the YouTube stream has active chat
