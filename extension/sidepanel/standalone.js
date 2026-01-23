/**
 * Live Chat Intelligence - Standalone Mode
 * 
 * Can run in two modes:
 * 1. Extension context: Uses chrome.runtime messaging through background script
 * 2. Web context: Direct WebSocket connection (for OBS, etc.)
 */

// ============== CONFIGURATION ==============

const urlParams = new URLSearchParams(window.location.search);
const BACKEND_URL = urlParams.get('backend') || 'ws://127.0.0.1:8765';
const initialVideoId = urlParams.get('v') || urlParams.get('video') || '';

// Detect if we're running in extension context
const isExtensionContext = typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id;

// Port connection to background script
let backgroundPort = null;

console.log('[Standalone] Initializing...');
console.log('[Standalone] Extension context:', isExtensionContext);
console.log('[Standalone] Backend URL:', BACKEND_URL);
console.log('[Standalone] Initial video ID:', initialVideoId);

// ============== STATE ==============

const state = {
    connected: false,
    videoId: null,
    ws: null,
    reconnectAttempts: 0,
    maxReconnectAttempts: 5,
    
    topics: {},
    questions: [],
    pulses: [],
    vibes: [],
    recentMessages: [],
    velocity: 0
};

const MAX_TOPICS = 24;
const MAX_QUESTIONS = 8;
const MAX_PULSES = 7;
const MAX_VIBES = 16;
const QUESTION_TTL = 30000;

// ============== DOM REFERENCES ==============

let elements = {};

function initElements() {
    elements = {
        connectionStatus: document.getElementById('connection-status'),
        velocityDisplay: document.getElementById('velocity-display'),
        velocityValue: document.getElementById('velocity-value'),
        urlInputSection: document.getElementById('url-input-section'),
        videoUrlInput: document.getElementById('video-url-input'),
        connectBtn: document.getElementById('connect-btn'),
        streamInfo: document.getElementById('stream-info'),
        streamTitle: document.getElementById('stream-title'),
        streamChannel: document.getElementById('stream-channel'),
        noStream: document.getElementById('no-stream'),
        connecting: document.getElementById('connecting'),
        connectingVideo: document.getElementById('connecting-video'),
        visualization: document.getElementById('visualization'),
        errorState: document.getElementById('error-state'),
        errorMessage: document.getElementById('error-message'),
        retryButton: document.getElementById('retry-button'),
        topicsContainer: document.getElementById('topics-container'),
        questionsContainer: document.getElementById('questions-container'),
        pulseContainer: document.getElementById('pulse-container'),
        vibesTicker: document.getElementById('vibes-ticker')
    };
    
    console.log('[Standalone] Elements initialized');
}

// ============== INITIALIZATION ==============

function init() {
    console.log('[Standalone] DOM ready, initializing...');
    
    initElements();
    
    // Event listeners
    if (elements.connectBtn) {
        elements.connectBtn.addEventListener('click', handleConnect);
    }
    if (elements.videoUrlInput) {
        elements.videoUrlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleConnect();
        });
    }
    if (elements.retryButton) {
        elements.retryButton.addEventListener('click', handleRetry);
    }
    
    // Set up port connection for extension context
    if (isExtensionContext) {
        connectToBackground();
    }
    
    // Start timers
    setInterval(calculateVelocity, 500);
    setInterval(cleanupQuestions, 5000);
    
    // Re-render on window resize
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            renderTopics();
        }, 100);
    });
    
    // Auto-connect if video ID in URL
    if (initialVideoId) {
        console.log('[Standalone] Auto-connecting to:', initialVideoId);
        if (elements.videoUrlInput) {
            elements.videoUrlInput.value = initialVideoId;
        }
        setTimeout(() => handleConnect(), 100);
    }
}

// ============== EXTENSION CONNECTION ==============

function connectToBackground() {
    console.log('[Standalone] Connecting to background script...');
    
    try {
        backgroundPort = chrome.runtime.connect({ name: 'standalone' });
        
        backgroundPort.onMessage.addListener((message) => {
            console.log('[Standalone] Port message:', message.type);
            handleExtensionMessage(message);
        });
        
        backgroundPort.onDisconnect.addListener(() => {
            console.log('[Standalone] Port disconnected');
            backgroundPort = null;
            state.connected = false;
            updateConnectionStatus(false);
            
            // Try to reconnect after a delay
            setTimeout(() => {
                if (isExtensionContext && !backgroundPort) {
                    connectToBackground();
                }
            }, 2000);
        });
        
        console.log('[Standalone] Connected to background script');
        
    } catch (error) {
        console.error('[Standalone] Failed to connect to background:', error);
    }
}

function handleExtensionMessage(message) {
    console.log('[Standalone] Extension message:', message.type);
    
    switch (message.type) {
        case 'CONNECTION_STATUS':
            if (message.data?.connected) {
                state.connected = true;
                updateConnectionStatus(true);
                showState('visualization');
                
                if (elements.connectBtn) {
                    elements.connectBtn.disabled = false;
                    elements.connectBtn.textContent = 'Connected ✓';
                }
                if (elements.urlInputSection) {
                    elements.urlInputSection.style.display = 'none';
                }
                if (elements.streamInfo) {
                    elements.streamInfo.classList.remove('hidden');
                }
                if (elements.streamTitle) {
                    elements.streamTitle.textContent = `Video: ${state.videoId}`;
                }
            } else {
                state.connected = false;
                updateConnectionStatus(false);
            }
            break;
            
        case 'CHAT_DATA':
            // message.data contains the actual backend message
            // which has its own type like 'subscribed', 'message', 'vibe', etc.
            handleMessage(message.data);
            break;
            
        case 'CONNECTION_ERROR':
            console.error('[Standalone] Connection error:', message.data?.error);
            showError(message.data?.error || 'Connection failed');
            if (elements.connectBtn) {
                elements.connectBtn.disabled = false;
                elements.connectBtn.textContent = 'Connect';
            }
            break;
    }
}

// ============== CONNECTION ==============

function extractVideoId(input) {
    if (!input) return null;
    input = input.trim();
    
    if (/^[a-zA-Z0-9_-]{11}$/.test(input)) return input;
    
    const patterns = [
        /(?:v=|\/v\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
        /(?:embed\/)([a-zA-Z0-9_-]{11})/,
        /(?:live\/)([a-zA-Z0-9_-]{11})/
    ];
    
    for (const p of patterns) {
        const m = input.match(p);
        if (m) return m[1];
    }
    
    return null;
}

function handleConnect() {
    const input = elements.videoUrlInput?.value || initialVideoId;
    const videoId = extractVideoId(input);
    
    console.log('[Standalone] handleConnect, input:', input, 'videoId:', videoId);
    
    if (!videoId) {
        showError('Invalid YouTube URL or video ID');
        return;
    }
    
    state.videoId = videoId;
    state.reconnectAttempts = 0;
    
    showState('connecting');
    if (elements.connectingVideo) {
        elements.connectingVideo.textContent = `Connecting to ${videoId}...`;
    }
    if (elements.connectBtn) {
        elements.connectBtn.disabled = true;
        elements.connectBtn.textContent = 'Connecting...';
    }
    
    if (isExtensionContext && backgroundPort) {
        // Use background script's WebSocket via port
        console.log('[Standalone] Connecting via extension background port');
        backgroundPort.postMessage({ 
            type: 'CONNECT_TO_STREAM', 
            videoId: videoId 
        });
    } else if (isExtensionContext) {
        // Fallback to runtime message
        console.log('[Standalone] Connecting via extension runtime message');
        chrome.runtime.sendMessage({ 
            type: 'CONNECT_TO_STREAM', 
            videoId: videoId 
        });
    } else {
        // Direct WebSocket (for non-extension contexts like OBS)
        connectWebSocket(videoId);
    }
}

function connectWebSocket(videoId) {
    console.log('[Standalone] Direct WebSocket connection to:', BACKEND_URL);
    
    if (state.ws) {
        state.ws.close();
        state.ws = null;
    }
    
    try {
        state.ws = new WebSocket(BACKEND_URL);
        
        state.ws.onopen = () => {
            console.log('[Standalone] WebSocket OPEN');
            state.ws.send(JSON.stringify({
                type: 'SUBSCRIBE',
                videoId: videoId
            }));
        };
        
        state.ws.onmessage = (event) => {
            try {
                const msg = JSON.parse(event.data);
                handleMessage(msg);
            } catch (e) {
                console.error('[Standalone] Parse error:', e);
            }
        };
        
        state.ws.onerror = (error) => {
            console.error('[Standalone] WebSocket error:', error);
            showError('Connection failed. Is the backend running?');
            if (elements.connectBtn) {
                elements.connectBtn.disabled = false;
                elements.connectBtn.textContent = 'Connect';
            }
        };
        
        state.ws.onclose = () => {
            console.log('[Standalone] WebSocket closed');
            state.connected = false;
            updateConnectionStatus(false);
            
            if (elements.connectBtn) {
                elements.connectBtn.disabled = false;
                elements.connectBtn.textContent = 'Connect';
            }
        };
        
    } catch (error) {
        console.error('[Standalone] WebSocket creation error:', error);
        showError('Failed to connect: ' + error.message);
    }
}

function handleMessage(msg) {
    switch (msg.type) {
        case 'connected':
            console.log('[Standalone] Backend connected');
            break;
            
        case 'subscribed':
            console.log('[Standalone] Subscribed to:', msg.videoId);
            state.connected = true;
            updateConnectionStatus(true);
            showState('visualization');
            
            if (elements.connectBtn) {
                elements.connectBtn.disabled = false;
                elements.connectBtn.textContent = 'Connected ✓';
            }
            if (elements.urlInputSection) {
                elements.urlInputSection.style.display = 'none';
            }
            if (elements.streamInfo) {
                elements.streamInfo.classList.remove('hidden');
            }
            if (elements.streamTitle) {
                elements.streamTitle.textContent = `Video: ${state.videoId}`;
            }
            break;
            
        case 'message':
            processMessage(msg.data);
            break;
            
        case 'vibe':
            processVibe(msg.data);
            break;
            
        case 'pulse':
            processPulse(msg.data);
            break;
            
        case 'error':
            console.error('[Standalone] Backend error:', msg.message);
            showError(msg.message);
            break;
    }
}

function handleRetry() {
    if (state.videoId) {
        handleConnect();
    } else {
        showState('no-stream');
        if (elements.urlInputSection) {
            elements.urlInputSection.style.display = 'block';
        }
    }
}

// ============== DATA PROCESSING ==============

function processMessage(msg) {
    const now = Date.now();
    state.recentMessages.push(now);
    
    if (msg.topic) {
        const existing = state.topics[msg.topic] || {
            count: 0,
            sentiment: { bullish: 0, bearish: 0, neutral: 0 },
            lastUpdate: now
        };
        
        state.topics[msg.topic] = {
            count: existing.count + 1,
            sentiment: {
                ...existing.sentiment,
                [msg.sentiment]: (existing.sentiment[msg.sentiment] || 0) + 1
            },
            lastUpdate: now
        };
        
        renderTopics();
    }
    
    if (msg.isQuestion) {
        const topic = msg.topic || 'GENERAL';
        const key = msg.topic || msg.text.slice(0, 30);
        const idx = state.questions.findIndex(q => q.key === key);
        
        if (idx >= 0) {
            state.questions[idx].count++;
            state.questions[idx].text = msg.text;
            state.questions[idx].author = msg.author;
            state.questions[idx].time = now;
        } else {
            state.questions.push({ key, topic, text: msg.text, author: msg.author, count: 1, time: now });
            if (state.questions.length > MAX_QUESTIONS) {
                state.questions = state.questions.slice(-MAX_QUESTIONS);
            }
        }
        
        renderQuestions();
    }
}

function processVibe(msg) {
    if (!msg.vibe) return;
    
    state.vibes.push({
        text: msg.text,
        vibe: msg.vibe,
        time: Date.now()
    });
    
    if (state.vibes.length > MAX_VIBES) {
        state.vibes = state.vibes.slice(-MAX_VIBES);
    }
    
    renderVibes();
}

function processPulse(data) {
    state.pulses.unshift({
        summary: data.summary,
        mood: data.mood,
        topTicker: data.top_ticker,
        time: Date.now()
    });
    
    if (state.pulses.length > MAX_PULSES) {
        state.pulses = state.pulses.slice(0, MAX_PULSES);
    }
    
    renderPulses();
}

// ============== RENDERING ==============

function renderTopics() {
    if (!elements.topicsContainer) return;
    
    const sorted = Object.entries(state.topics)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, MAX_TOPICS);
    
    if (!sorted.length) {
        elements.topicsContainer.innerHTML = '<div class="empty-state">Waiting for ticker mentions...</div>';
        return;
    }
    
    const now = Date.now();
    
    // Scale bubble sizes based on window width
    const w = window.innerWidth;
    const baseSize = w > 1600 ? 90 : w > 1200 ? 80 : w > 800 ? 70 : 60;
    const maxSize = w > 1600 ? 180 : w > 1200 ? 160 : w > 800 ? 140 : 120;
    const growthFactor = w > 1200 ? 22 : 18;
    
    elements.topicsContainer.innerHTML = sorted.map(([ticker, data]) => {
        const total = data.sentiment.bullish + data.sentiment.bearish;
        const bullishRatio = total === 0 ? 0.5 : data.sentiment.bullish / total;
        const contested = total > 0 && Math.min(data.sentiment.bullish, data.sentiment.bearish) / Math.max(data.sentiment.bullish, data.sentiment.bearish) > 0.5;
        
        const size = Math.min(maxSize, baseSize + Math.log2(data.count + 1) * growthFactor);
        const isRecent = now - data.lastUpdate < 2000;
        const sentimentClass = contested ? 'contested' : (bullishRatio > 0.5 ? 'bullish' : 'bearish');
        const fontSize = Math.max(14, size / 4.5);
        const tickerSize = Math.max(12, size / 5);
        
        return `
            <div class="topic-bubble ${sentimentClass} ${isRecent ? 'recent' : ''}" 
                 style="width: ${size}px; height: ${size}px;">
                <span class="ticker" style="font-size: ${tickerSize}px">${ticker}</span>
                <span class="count" style="font-size: ${fontSize}px">${data.count}</span>
            </div>
        `;
    }).join('');
}

function renderQuestions() {
    if (!elements.questionsContainer) return;
    
    const now = Date.now();
    const active = state.questions.filter(q => now - q.time < QUESTION_TTL);
    
    if (!active.length) {
        elements.questionsContainer.innerHTML = '<div class="empty-state">No questions yet...</div>';
        return;
    }
    
    elements.questionsContainer.innerHTML = active.map(q => {
        const isRecent = now - q.time < 3000;
        const opacity = Math.max(0.4, 1 - (now - q.time) / QUESTION_TTL);
        
        return `
            <div class="question-card ${isRecent ? 'recent' : ''}" style="opacity: ${opacity}">
                <div class="question-header">
                    <span class="question-topic">${q.topic}</span>
                    ${q.count > 1 ? `<span class="question-count">x${q.count}</span>` : ''}
                </div>
                <p class="question-text">"${escapeHtml(q.text)}"</p>
                <p class="question-author">@${escapeHtml(q.author)}</p>
            </div>
        `;
    }).join('');
}

function renderPulses() {
    if (!elements.pulseContainer) return;
    
    if (!state.pulses.length) {
        elements.pulseContainer.innerHTML = '<div class="empty-state">Generating first summary...</div>';
        return;
    }
    
    const now = Date.now();
    
    elements.pulseContainer.innerHTML = state.pulses.map((p, i) => {
        const age = (now - p.time) / 60000;
        const timeLabel = age < 1 ? 'just now' : `${Math.round(age)}m ago`;
        
        return `
            <div class="pulse-card ${i === 0 ? 'newest' : ''}">
                <div class="pulse-header">
                    <span class="pulse-mood">${p.mood}</span>
                    <div class="pulse-content">
                        <p class="pulse-summary">${escapeHtml(p.summary)}</p>
                        <div class="pulse-meta">
                            ${p.topTicker ? `<span class="pulse-ticker">$${p.topTicker}</span>` : ''}
                            <span class="pulse-time">${timeLabel}</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function renderVibes() {
    if (!elements.vibesTicker) return;
    
    if (!state.vibes.length) {
        elements.vibesTicker.innerHTML = '<div class="empty-state">Waiting for vibes...</div>';
        return;
    }
    
    const items = [...state.vibes, ...state.vibes];
    
    elements.vibesTicker.innerHTML = `
        <div class="vibes-track">
            ${items.map(v => `
                <div class="vibe-item ${v.vibe}">
                    <span class="vibe-emoji">${v.vibe === 'funny' ? '😂' : '💖'}</span>
                    <span class="vibe-text">${escapeHtml(v.text)}</span>
                </div>
            `).join('')}
        </div>
    `;
}

// ============== UI HELPERS ==============

function showState(name) {
    console.log('[Standalone] showState:', name);
    
    if (elements.noStream) elements.noStream.classList.add('hidden');
    if (elements.connecting) elements.connecting.classList.add('hidden');
    if (elements.visualization) elements.visualization.classList.add('hidden');
    if (elements.errorState) elements.errorState.classList.add('hidden');
    
    switch (name) {
        case 'no-stream':
            if (elements.noStream) elements.noStream.classList.remove('hidden');
            break;
        case 'connecting':
            if (elements.connecting) elements.connecting.classList.remove('hidden');
            break;
        case 'visualization':
            if (elements.visualization) elements.visualization.classList.remove('hidden');
            break;
        case 'error':
            if (elements.errorState) elements.errorState.classList.remove('hidden');
            break;
    }
}

function showError(msg) {
    console.error('[Standalone] showError:', msg);
    showState('error');
    if (elements.errorMessage) {
        elements.errorMessage.textContent = msg;
    }
}

function updateConnectionStatus(connected) {
    if (elements.connectionStatus) {
        elements.connectionStatus.className = `status ${connected ? 'connected' : 'disconnected'}`;
        const statusText = elements.connectionStatus.querySelector('.status-text');
        if (statusText) {
            statusText.textContent = connected ? 'Connected' : 'Disconnected';
        }
    }
}

function calculateVelocity() {
    const now = Date.now();
    state.recentMessages = state.recentMessages.filter(t => now - t < 5000);
    state.velocity = state.recentMessages.length / 5;
    
    if (elements.velocityValue) {
        elements.velocityValue.textContent = state.velocity.toFixed(1);
    }
    
    let cls = 'quiet';
    if (state.velocity >= 4) cls = 'hype';
    else if (state.velocity >= 2) cls = 'busy';
    else if (state.velocity >= 0.5) cls = 'active';
    
    if (elements.velocityDisplay) {
        elements.velocityDisplay.className = cls;
    }
}

function cleanupQuestions() {
    const now = Date.now();
    const before = state.questions.length;
    state.questions = state.questions.filter(q => now - q.time < QUESTION_TTL);
    if (state.questions.length !== before) renderQuestions();
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============== START ==============

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
