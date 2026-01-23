#!/bin/bash
# Chat Viz Quick Start (Local Mac)

cd "$(dirname "$0")"

# Load environment variables
if [ -f .env ]; then
    export $(cat .env | xargs)
fi

# Activate virtual environment
source venv/bin/activate

if [ -z "$1" ]; then
    echo ""
    echo "Usage: ./start.sh <youtube_live_url>"
    echo "Example: ./start.sh https://www.youtube.com/watch?v=abc123"
    exit 1
fi

# Kill any existing processes on our ports
pkill -f "http.server 8080" 2>/dev/null
pkill -f "chat_viz_backend" 2>/dev/null

echo ""
echo "========================================"
echo "  Live Chat Intelligence"
echo "========================================"
echo ""
echo "Frontend: http://localhost:8080/chat_viz_frontend.html"
echo "WebSocket: ws://localhost:8765"
echo ""
echo "Starting with: $1"
echo "Press Ctrl+C to stop"
echo ""

# Start HTTP server for frontend (background)
python3 -m http.server 8080 &
HTTP_PID=$!

# Run backend
python3 chat_viz_backend.py "$1"

# Cleanup
kill $HTTP_PID 2>/dev/null
