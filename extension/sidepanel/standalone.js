/**
 * Live Chat Intelligence - Standalone Mode
 * 
 * Can run in two modes:
 * 1. Extension context: Uses chrome.runtime messaging through background script
 * 2. Web context: Direct WebSocket connection (for OBS, etc.)
 */

// ============== CONFIGURATION ==============

const urlParams = new URLSearchParams(window.location.search);
const BACKEND_URL = urlParams.get('backend') || 'wss://web-production-6fa01.up.railway.app';
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
    topicComments: {},  // ticker -> [{text, author, sentiment, time}]
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

// Physics constants - LIQUID FEEL
const PHYSICS = {
    GRAVITY_STRENGTH: 0.00004,      // Reduced - gentler pull
    DAMPING: 0.96,                   // Less damping - more momentum
    COLLISION_RESPONSE: 0.06,        // Softer collisions
    DRIFT_STRENGTH: 0.025,           // Much more brownian motion
    CENTER_PULL_MULTIPLIER: 0.3,     // Weaker center pull
    MAX_VELOCITY: 1.8,               // Allow faster movement
    COLLISION_SOFTNESS: 0.5,
    ORBIT_TENDENCY: 0.03,            // Slow swirl/orbit motion (was 0.15)
    MASS_ATTRACTION: 0.00003         // Larger bubbles attract smaller
};

// Physics state for bubbles
const bubblePhysics = {};
let physicsAnimationId = null;

// Rising vibes state
const risingVibes = {};
let vibesAnimationId = null;
let particleIntervalId = null;

// Vibe drip queue - releases vibes organically instead of in batches
const vibeQueue = [];
let vibeDripIntervalId = null;
let lastBatchTime = null;
let estimatedBatchInterval = 30000;  // Start with 30s estimate, will adapt
const MIN_DRIP_DELAY = 300;          // Never faster than 300ms
const MAX_DRIP_DELAY = 5000;         // Never slower than 5s

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
        vibesContainer: document.getElementById('vibes-container')
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
        
        // Try to get transferred state from panel
        chrome.runtime.sendMessage({ type: 'GET_PANEL_STATE' }, (response) => {
            if (response?.state) {
                console.log('[Standalone] Received transferred state from panel');
                hydrateFromTransferredState(response.state);
            } else {
                console.log('[Standalone] No transferred state, starting fresh');
            }
        });
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
    
    // Auto-connect if video ID in URL (and no transferred state)
    if (initialVideoId && !state.videoId) {
        console.log('[Standalone] Auto-connecting to:', initialVideoId);
        if (elements.videoUrlInput) {
            elements.videoUrlInput.value = initialVideoId;
        }
        setTimeout(() => handleConnect(), 100);
    }
}

function hydrateFromTransferredState(transferred) {
    console.log('[Standalone] Hydrating state:', transferred);
    
    // Copy over all the data
    state.videoId = transferred.videoId;
    state.topics = transferred.topics || {};
    state.questions = transferred.questions || [];
    state.pulses = transferred.pulses || [];
    state.vibes = transferred.vibes || [];
    state.recentMessages = transferred.recentMessages || [];
    state.velocity = transferred.velocity || 0;
    
    // Update UI
    if (elements.videoUrlInput) {
        elements.videoUrlInput.value = transferred.videoId || '';
    }
    if (elements.streamTitle) {
        elements.streamTitle.textContent = transferred.streamTitle || `Video: ${transferred.videoId}`;
    }
    if (elements.streamChannel) {
        elements.streamChannel.textContent = transferred.streamChannel || '';
    }
    
    // Hide input section, show stream info
    if (elements.urlInputSection) {
        elements.urlInputSection.style.display = 'none';
    }
    if (elements.streamInfo) {
        elements.streamInfo.classList.remove('hidden');
    }
    
    // Mark as connected
    state.connected = true;
    updateConnectionStatus(true);
    
    if (elements.connectBtn) {
        elements.connectBtn.disabled = false;
        elements.connectBtn.textContent = 'Connected ✓';
    }
    
    // Show visualization state FIRST (so containers have dimensions)
    showState('visualization');
    
    // Clear any existing physics state so bubbles get repositioned for new container size
    Object.keys(bubblePhysics).forEach(key => delete bubblePhysics[key]);
    
    // Longer delay to ensure layout is fully computed in the new window
    setTimeout(() => {
        renderTopics();
        renderQuestions();
        renderPulses();
        renderVibes();
        console.log('[Standalone] Hydration complete, topics:', Object.keys(state.topics).length);
    }, 150);
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
            // Check if LLM is available on connect
            if (msg.llm_available === false) {
                handleRateLimitStatus({ llm_available: false, status: msg.rate_limit_status });
            }
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
            
        case 'rate_limit_status':
            handleRateLimitStatus(msg);
            break;
            
        case 'error':
            console.error('[Standalone] Backend error:', msg.message);
            showError(msg.message);
            break;
    }
}

function handleRateLimitStatus(data) {
    console.log('[Standalone] Rate limit status:', data);
    
    if (!data.llm_available) {
        const cooldown = data.status?.cooldown_remaining || 60;
        showDegradedIndicator(`AI features paused (${cooldown}s)`);
    } else {
        hideDegradedIndicator();
    }
}

function showDegradedIndicator(message) {
    let indicator = document.getElementById('degraded-indicator');
    
    if (!indicator) {
        indicator = document.createElement('div');
        indicator.id = 'degraded-indicator';
        indicator.className = 'degraded-indicator';
        // Insert after connection status
        const header = document.querySelector('.panel-header');
        if (header) {
            header.appendChild(indicator);
        }
    }
    
    indicator.innerHTML = `<span class="degraded-icon">⏸</span> ${message}`;
    indicator.classList.add('visible');
}

function hideDegradedIndicator() {
    const indicator = document.getElementById('degraded-indicator');
    if (indicator) {
        indicator.classList.remove('visible');
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
            lastUpdate: now,
            comments: []
        };
        
        state.topics[msg.topic] = {
            count: existing.count + 1,
            sentiment: {
                ...existing.sentiment,
                [msg.sentiment]: (existing.sentiment[msg.sentiment] || 0) + 1
            },
            lastUpdate: now,
            comments: [...existing.comments.slice(-4), { text: msg.text, sentiment: msg.sentiment }]
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
    
    const now = Date.now();
    const queueWasEmpty = vibeQueue.length === 0;
    
    // Queue the vibe for organic release
    vibeQueue.push({
        text: msg.text,
        vibe: msg.vibe,
        queuedAt: now
    });
    
    // Track batch timing - if queue was empty, this is a new batch
    if (queueWasEmpty && lastBatchTime) {
        const timeSinceLastBatch = now - lastBatchTime;
        // Smooth the estimate (weighted average)
        estimatedBatchInterval = estimatedBatchInterval * 0.3 + timeSinceLastBatch * 0.7;
        console.log('[Standalone] Batch interval estimate:', Math.round(estimatedBatchInterval / 1000) + 's');
    }
    
    if (queueWasEmpty) {
        lastBatchTime = now;
    }
    
    // Start drip process if not running
    startVibeDrip();
}

function startVibeDrip() {
    if (vibeDripIntervalId) return;  // Already running
    
    function dripNextVibe() {
        if (vibeQueue.length === 0) {
            // Queue empty, stop dripping
            vibeDripIntervalId = null;
            return;
        }
        
        // Release one vibe
        const vibe = vibeQueue.shift();
        
        state.vibes.push({
            text: vibe.text,
            vibe: vibe.vibe,
            time: Date.now()
        });
        
        if (state.vibes.length > MAX_VIBES) {
            state.vibes = state.vibes.slice(-MAX_VIBES);
        }
        
        renderVibes();
        
        // Calculate delay to spread remaining vibes across the expected batch window
        // If we have 5 vibes and expect 25s until next batch, drip every 5s
        const remainingVibes = vibeQueue.length + 1;  // +1 for timing headroom
        const timeSinceBatch = Date.now() - (lastBatchTime || Date.now());
        const timeUntilNextBatch = Math.max(estimatedBatchInterval - timeSinceBatch, 5000);
        
        let delay = timeUntilNextBatch / remainingVibes;
        
        // Velocity multiplier - faster chat = faster drip (popcorn effect!)
        // velocity 0-1 = normal, 2+ = double speed, 4+ = triple speed
        const velocityMultiplier = 1 / Math.max(1, 1 + (state.velocity * 0.5));
        delay = delay * velocityMultiplier;
        
        // Add small random jitter (±15%) for organic feel
        delay = delay * (0.85 + Math.random() * 0.3);
        
        // Clamp to reasonable bounds
        delay = Math.max(MIN_DRIP_DELAY, Math.min(MAX_DRIP_DELAY, delay));
        
        vibeDripIntervalId = setTimeout(dripNextVibe, delay);
    }
    
    // Start with a small initial delay
    vibeDripIntervalId = setTimeout(dripNextVibe, 200);
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
        stopPhysicsLoop();
        return;
    }
    
    const container = elements.topicsContainer;
    const containerRect = container.getBoundingClientRect();
    const centerX = containerRect.width / 2;
    const centerY = containerRect.height / 2;
    const now = Date.now();
    
    // Find max count for relative sizing
    const maxCount = sorted.length > 0 ? sorted[0][1].count : 1;
    const w = window.innerWidth;
    const minSize = w > 1200 ? 50 : 45;
    const maxSize = w > 1200 ? 160 : 140;
    
    // Initialize or update physics state
    sorted.forEach(([ticker, data], index) => {
        // Relative sizing - ratio of this ticker to the top ticker
        const ratio = data.count / maxCount;  // 0 to 1
        const size = minSize + (ratio * (maxSize - minSize));
        const radius = size / 2;
        
        if (!bubblePhysics[ticker]) {
            const angle = (index / sorted.length) * Math.PI * 2 + Math.random() * 0.5;
            const dist = 80 + Math.random() * 50;
            bubblePhysics[ticker] = {
                x: centerX + Math.cos(angle) * dist,
                y: centerY + Math.sin(angle) * dist,
                vx: (Math.random() - 0.5) * 0.15,
                vy: (Math.random() - 0.5) * 0.15,
                radius: radius,
                count: data.count
            };
        } else {
            const wasCount = bubblePhysics[ticker].count;
            bubblePhysics[ticker].radius = radius;
            bubblePhysics[ticker].count = data.count;
            if (data.count > wasCount) {
                bubblePhysics[ticker].justUpdated = true;
            }
        }
    });
    
    // Remove old tickers
    const activeTickers = new Set(sorted.map(([t]) => t));
    Object.keys(bubblePhysics).forEach(ticker => {
        if (!activeTickers.has(ticker)) delete bubblePhysics[ticker];
    });
    
    updateBubbleDOM(sorted);
    startPhysicsLoop();
}

function updateBubbleDOM(sorted) {
    const container = elements.topicsContainer;
    const existingElements = {};
    container.querySelectorAll('.topic-bubble').forEach(el => {
        if (el.dataset.ticker) existingElements[el.dataset.ticker] = el;
    });
    
    sorted.forEach(([ticker, data]) => {
        const physics = bubblePhysics[ticker];
        if (!physics) return;
        
        const total = data.sentiment.bullish + data.sentiment.bearish;
        const bullishRatio = total === 0 ? 0.5 : data.sentiment.bullish / total;
        const contested = total > 0 && Math.min(data.sentiment.bullish, data.sentiment.bearish) / Math.max(data.sentiment.bullish, data.sentiment.bearish) > 0.5;
        const sentimentClass = contested ? 'contested' : (bullishRatio > 0.5 ? 'bullish' : 'bearish');
        const size = physics.radius * 2;
        const glowHigh = data.count >= 10;
        
        // Sentiment label for tooltip
        const sentimentLabel = contested ? 'Mixed' : (bullishRatio > 0.5 ? 'Bullish' : 'Bearish');
        const sentimentPercent = Math.round((bullishRatio > 0.5 ? bullishRatio : 1 - bullishRatio) * 100);
        
        let el = existingElements[ticker];
        
        if (!el) {
            el = document.createElement('div');
            el.className = `topic-bubble ${sentimentClass}`;
            el.dataset.ticker = ticker;
            el.innerHTML = `
                <span class="ticker"></span>
                <span class="count"></span>
                <div class="bubble-tooltip">
                    <div class="tooltip-header">
                        <span class="tooltip-ticker">${ticker}</span>
                        <span class="tooltip-sentiment ${sentimentClass}">${sentimentLabel} ${sentimentPercent}%</span>
                    </div>
                    <div class="tooltip-comments"></div>
                </div>
            `;
            container.appendChild(el);
        }
        
        el.className = `topic-bubble ${sentimentClass}${glowHigh ? ' glow-high' : ''}`;
        
        if (physics.justUpdated) {
            el.classList.add('pulse');
            setTimeout(() => el.classList.remove('pulse'), 600);
            physics.justUpdated = false;
        }
        
        el.style.left = `${physics.x - physics.radius}px`;
        el.style.top = `${physics.y - physics.radius}px`;
        el.style.width = `${size}px`;
        el.style.height = `${size}px`;
        el.style.zIndex = Math.floor(data.count);
        
        const tickerSpan = el.querySelector('.ticker');
        const countSpan = el.querySelector('.count');
        tickerSpan.textContent = ticker;
        tickerSpan.style.fontSize = `${Math.max(10, size * 0.22)}px`;
        countSpan.textContent = data.count;
        countSpan.style.fontSize = `${Math.max(9, size * 0.16)}px`;
        
        // Update tooltip
        const tooltipSentiment = el.querySelector('.tooltip-sentiment');
        const tooltipComments = el.querySelector('.tooltip-comments');
        
        if (tooltipSentiment) {
            tooltipSentiment.className = `tooltip-sentiment ${sentimentClass}`;
            tooltipSentiment.textContent = `${sentimentLabel} ${sentimentPercent}%`;
        }
        
        if (tooltipComments && data.comments && data.comments.length > 0) {
            tooltipComments.innerHTML = data.comments.slice(-3).map(c => `
                <div class="tooltip-comment">
                    <span class="comment-sentiment ${c.sentiment}"></span>
                    ${escapeHtml(c.text.slice(0, 50))}${c.text.length > 50 ? '...' : ''}
                </div>
            `).join('');
        } else if (tooltipComments) {
            tooltipComments.innerHTML = '<div class="tooltip-comment" style="opacity: 0.5;">No recent comments</div>';
        }
        
        delete existingElements[ticker];
    });
    
    Object.values(existingElements).forEach(el => el.remove());
}

function startPhysicsLoop() {
    if (physicsAnimationId) return;
    
    function physicsStep() {
        const container = elements.topicsContainer;
        if (!container) {
            physicsAnimationId = requestAnimationFrame(physicsStep);
            return;
        }
        
        // Recalculate bounds each frame (handles resize and state transfer)
        const containerRect = container.getBoundingClientRect();
        const width = containerRect.width;
        const height = containerRect.height;
        const centerX = width / 2;
        const centerY = height / 2;
        
        const tickers = Object.keys(bubblePhysics);
        
        // Recalculate max count
        let maxCount = 1;
        tickers.forEach(t => {
            if (bubblePhysics[t].count > maxCount) maxCount = bubblePhysics[t].count;
        });
        
        tickers.forEach(ticker => {
            const b = bubblePhysics[ticker];
            
            // Distance from center
            const dx = centerX - b.x;
            const dy = centerY - b.y;
            const distToCenter = Math.sqrt(dx * dx + dy * dy);
            
            const mass = b.count || 1;
            const popularity = mass / maxCount;  // 0-1 normalized
            
            // Popular bubbles get pulled to center MORE strongly
            const gravityForce = PHYSICS.GRAVITY_STRENGTH * (0.5 + popularity * 2) * PHYSICS.CENTER_PULL_MULTIPLIER;
            
            if (distToCenter > 1) {
                b.vx += (dx / distToCenter) * gravityForce;
                b.vy += (dy / distToCenter) * gravityForce;
            }
            
            // Orbital motion - perpendicular to center direction
            // Less popular bubbles orbit more, but slower than before (50% reduction at rim)
            if (distToCenter > 20) {
                const orbitStrength = PHYSICS.ORBIT_TENDENCY * (0.5 - popularity * 0.2);
                b.vx += (-dy / distToCenter) * orbitStrength;
                b.vy += (dx / distToCenter) * orbitStrength;
            }
            
            // Brownian drift - more for smaller bubbles
            const driftFactor = PHYSICS.DRIFT_STRENGTH * (1.5 - popularity);
            b.vx += (Math.random() - 0.5) * driftFactor;
            b.vy += (Math.random() - 0.5) * driftFactor;
            
            // Mass attraction - larger bubbles pull smaller ones
            tickers.forEach(otherTicker => {
                if (otherTicker === ticker) return;
                const other = bubblePhysics[otherTicker];
                
                const odx = other.x - b.x;
                const ody = other.y - b.y;
                const dist = Math.sqrt(odx * odx + ody * ody);
                
                // Only attract if other is larger
                if (other.count > b.count && dist > 0 && dist < 200) {
                    const attractForce = PHYSICS.MASS_ATTRACTION * (other.count - b.count);
                    b.vx += (odx / dist) * attractForce;
                    b.vy += (ody / dist) * attractForce;
                }
                
                // Soft collision
                const minDist = b.radius + other.radius + 8;
                if (dist < minDist && dist > 0) {
                    const overlap = (minDist - dist) / minDist;
                    const softOverlap = Math.pow(overlap, PHYSICS.COLLISION_SOFTNESS);
                    const pushStrength = softOverlap * PHYSICS.COLLISION_RESPONSE;
                    
                    b.vx -= (odx / dist) * pushStrength;
                    b.vy -= (ody / dist) * pushStrength;
                }
            });
            
            const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
            if (speed > PHYSICS.MAX_VELOCITY) {
                b.vx = (b.vx / speed) * PHYSICS.MAX_VELOCITY;
                b.vy = (b.vy / speed) * PHYSICS.MAX_VELOCITY;
            }
            
            b.vx *= PHYSICS.DAMPING;
            b.vy *= PHYSICS.DAMPING;
            
            b.x += b.vx;
            b.y += b.vy;
            
            const margin = b.radius + 10;
            if (b.x < margin) { b.x = margin; b.vx *= -0.3; }
            if (b.x > width - margin) { b.x = width - margin; b.vx *= -0.3; }
            if (b.y < margin) { b.y = margin; b.vy *= -0.3; }
            if (b.y > height - margin) { b.y = height - margin; b.vy *= -0.3; }
        });
        
        tickers.forEach(ticker => {
            const b = bubblePhysics[ticker];
            const el = elements.topicsContainer.querySelector(`[data-ticker="${ticker}"]`);
            if (el) {
                el.style.left = `${b.x - b.radius}px`;
                el.style.top = `${b.y - b.radius}px`;
            }
        });
        
        physicsAnimationId = requestAnimationFrame(physicsStep);
    }
    
    physicsAnimationId = requestAnimationFrame(physicsStep);
}

function stopPhysicsLoop() {
    if (physicsAnimationId) {
        cancelAnimationFrame(physicsAnimationId);
        physicsAnimationId = null;
    }
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
    if (!elements.vibesContainer) return;
    
    if (!state.vibes.length) {
        elements.vibesContainer.innerHTML = '<div class="empty-state">Waiting for vibes...</div>';
        stopVibesAnimation();
        return;
    }
    
    const container = elements.vibesContainer;
    
    // Clear empty state if present
    const emptyState = container.querySelector('.empty-state');
    if (emptyState) emptyState.remove();
    
    // Add particles container if not present
    if (!container.querySelector('.vibes-particles')) {
        const particlesDiv = document.createElement('div');
        particlesDiv.className = 'vibes-particles';
        container.insertBefore(particlesDiv, container.firstChild);
        startParticleSpawning();
    }
    
    // Initialize physics for new vibes
    const now = Date.now();
    state.vibes.forEach((vibe, index) => {
        const vibeId = `${vibe.time}-${index}`;
        if (!risingVibes[vibeId]) {
            // New vibe - spawn at bottom with random properties
            risingVibes[vibeId] = {
                x: 10 + Math.random() * 70,  // 10-80% from left
                y: 100,                       // Start at bottom
                wobbleOffset: Math.random() * Math.PI * 2,
                wobbleSpeed: 0.5 + Math.random() * 1,
                scale: 0.85 + Math.random() * 0.3,
                startTime: now,
                duration: 10 + Math.random() * 5,  // 10-15 seconds to rise
                vibe: vibe.vibe,
                text: vibe.text
            };
            
            // Create DOM element
            const el = document.createElement('div');
            el.className = `vibe-bubble ${vibe.vibe}`;
            el.dataset.vibeId = vibeId;
            el.innerHTML = `
                <span class="vibe-emoji">${vibe.vibe === 'funny' ? '😂' : '💖'}</span>
                <span class="vibe-text">${escapeHtml(vibe.text)}</span>
            `;
            container.appendChild(el);
        }
    });
    
    // Start animation loop if not running
    startVibesAnimation();
}

function startParticleSpawning() {
    if (particleIntervalId) return;  // Already running
    
    function spawnParticle() {
        const container = elements.vibesContainer?.querySelector('.vibes-particles');
        if (!container) return;
        
        const particle = document.createElement('div');
        const isPurple = Math.random() > 0.5;
        particle.className = `ambient-particle ${isPurple ? 'purple' : 'pink'}`;
        
        // Random position and timing
        const leftPos = 5 + Math.random() * 90;
        const duration = 6 + Math.random() * 4;  // 6-10 seconds
        const delay = Math.random() * 0.5;
        const drift = (Math.random() - 0.5) * 30;  // -15 to +15 px drift
        const size = 2 + Math.random() * 2;  // 2-4px
        
        particle.style.cssText = `
            left: ${leftPos}%;
            bottom: 0;
            width: ${size}px;
            height: ${size}px;
            --drift: ${drift}px;
            animation-duration: ${duration}s;
            animation-delay: ${delay}s;
        `;
        
        container.appendChild(particle);
        
        // Remove after animation completes
        setTimeout(() => particle.remove(), (duration + delay) * 1000 + 100);
    }
    
    // Spawn initial batch
    for (let i = 0; i < 5; i++) {
        setTimeout(spawnParticle, i * 200);
    }
    
    // Continue spawning
    particleIntervalId = setInterval(spawnParticle, 800);
}

function stopParticleSpawning() {
    if (particleIntervalId) {
        clearInterval(particleIntervalId);
        particleIntervalId = null;
    }
}

function startVibesAnimation() {
    if (vibesAnimationId) return;  // Already running
    
    function vibesStep() {
        const now = Date.now();
        const container = elements.vibesContainer;
        if (!container) return;
        
        const vibeIds = Object.keys(risingVibes);
        
        vibeIds.forEach(vibeId => {
            const v = risingVibes[vibeId];
            const elapsed = (now - v.startTime) / 1000;
            const progress = elapsed / v.duration;
            
            if (progress >= 1) {
                // Remove completed bubble
                const el = container.querySelector(`[data-vibe-id="${vibeId}"]`);
                if (el) el.remove();
                delete risingVibes[vibeId];
                return;
            }
            
            // Calculate position
            const y = 100 - (progress * 120);  // Rise from 100% to -20%
            const wobbleX = Math.sin(elapsed * v.wobbleSpeed + v.wobbleOffset) * 3;
            
            // Calculate opacity (fade in at bottom, fade out at top)
            let opacity = 1;
            if (y > 80) opacity = (100 - y) / 20;  // Fade in
            if (y < 15) opacity = Math.max(0, y / 15);  // Fade out
            
            // Update DOM
            const el = container.querySelector(`[data-vibe-id="${vibeId}"]`);
            if (el) {
                el.style.left = `${v.x + wobbleX}%`;
                el.style.top = `${y}%`;
                el.style.opacity = opacity;
                el.style.transform = `translate(-50%, -50%) scale(${v.scale})`;
            }
        });
        
        // Continue loop if there are still bubbles
        if (Object.keys(risingVibes).length > 0) {
            vibesAnimationId = requestAnimationFrame(vibesStep);
        } else {
            vibesAnimationId = null;
        }
    }
    
    vibesAnimationId = requestAnimationFrame(vibesStep);
}

function stopVibesAnimation() {
    if (vibesAnimationId) {
        cancelAnimationFrame(vibesAnimationId);
        vibesAnimationId = null;
    }
    
    // Stop particle spawning
    stopParticleSpawning();
    
    // Clear all rising vibes
    Object.keys(risingVibes).forEach(id => delete risingVibes[id]);
    
    // Clear DOM
    if (elements.vibesContainer) {
        elements.vibesContainer.querySelectorAll('.vibe-bubble').forEach(el => el.remove());
        elements.vibesContainer.querySelectorAll('.vibes-particles').forEach(el => el.remove());
    }
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
