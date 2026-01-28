/**
 * Live Chat Intelligence - Side Panel Logic
 * 
 * Manages visualization state and UI updates
 */

// ============== STATE ==============

const state = {
    connected: false,
    videoId: null,
    streamTitle: null,
    streamChannel: null,
    tabId: null,
    
    // Data
    topics: {},
    topicComments: {},  // ticker -> [{text, author, sentiment, time}]
    questions: [],
    pulses: [],
    vibes: [],
    
    // Velocity tracking
    recentMessages: [],
    velocity: 0
};

// Constants
const MAX_TOPICS = 24;
const MAX_QUESTIONS = 5;
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

// Physics state for topic bubbles
const bubblePhysics = {};  // ticker -> { x, y, vx, vy, radius }
let physicsAnimationId = null;

// Rising vibes state
const risingVibes = {};  // id -> { x, y, wobbleOffset, wobbleSpeed, scale, startTime, duration }
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

const elements = {
    connectionStatus: document.getElementById('connection-status'),
    popoutBtn: document.getElementById('popout-btn'),
    velocityDisplay: document.getElementById('velocity-display'),
    velocityValue: document.getElementById('velocity-value'),
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

// Port connection to background
let backgroundPort = null;

function connectToBackground() {
    console.log('[Panel] Connecting to background script...');
    
    try {
        backgroundPort = chrome.runtime.connect({ name: 'panel' });
        
        backgroundPort.onMessage.addListener((message) => {
            console.log('[Panel] Port message:', message.type);
            handleBackgroundMessage(message);
        });
        
        backgroundPort.onDisconnect.addListener(() => {
            console.log('[Panel] Port disconnected');
            backgroundPort = null;
            
            // Try to reconnect
            setTimeout(connectToBackground, 2000);
        });
        
        console.log('[Panel] Connected to background script');
        
    } catch (error) {
        console.error('[Panel] Failed to connect to background:', error);
    }
}

// Send message via port if available, else runtime
function sendToBackground(message) {
    if (backgroundPort) {
        backgroundPort.postMessage(message);
    } else {
        chrome.runtime.sendMessage(message).catch(e => console.log('[Panel] Send failed:', e));
    }
}

// ============== INITIALIZATION ==============

async function init() {
    console.log('[Panel] Initializing side panel');
    
    // Set up port connection FIRST (more reliable than runtime.onMessage)
    connectToBackground();
    
    // Also keep runtime listener for backwards compatibility
    chrome.runtime.onMessage.addListener(handleBackgroundMessage);
    
    // Set up retry button
    elements.retryButton.addEventListener('click', retryConnection);
    
    // Set up pop out button
    elements.popoutBtn.addEventListener('click', handlePopOut);
    
    // Start velocity calculator
    setInterval(calculateVelocity, 500);
    
    // Clean up old questions periodically
    setInterval(cleanupQuestions, 5000);
    
    // Get current tab and notify background we're ready
    try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        console.log('[Panel] Current tab:', tab?.id, tab?.url);
        
        if (tab) {
            state.tabId = tab.id;
            
            // Tell background we're ready
            chrome.runtime.sendMessage({ 
                type: 'PANEL_READY', 
                tabId: tab.id 
            }).catch(e => console.log('[Panel] Could not send PANEL_READY:', e));
            
            // Also directly ask for stream state
            setTimeout(async () => {
                await checkCurrentTab();
            }, 300);
        }
    } catch (error) {
        console.error('[Panel] Init error:', error);
        showState('no-stream');
    }
}

async function checkCurrentTab() {
    console.log('[Panel] checkCurrentTab called');
    
    try {
        // Get current tab
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        
        console.log('[Panel] Current tab:', tab?.url);
        
        if (!tab || !tab.url?.includes('youtube.com')) {
            console.log('[Panel] Not on YouTube');
            showState('no-stream');
            return;
        }
        
        state.tabId = tab.id;
        
        // Ask background for stream state
        const response = await chrome.runtime.sendMessage({ 
            type: 'GET_STREAM_STATE', 
            tabId: tab.id 
        });
        
        console.log('[Panel] Stream state from background:', response);
        
        if (response?.hasStream && response?.videoId) {
            state.videoId = response.videoId;
            state.streamTitle = response.title;
            state.streamChannel = response.channelName;
            
            updateStreamInfo();
            
            if (response.isConnected) {
                console.log('[Panel] Already connected');
                showState('visualization');
                updateConnectionStatus(true);
            } else {
                console.log('[Panel] Requesting connection');
                showState('connecting');
                elements.connectingVideo.textContent = `Connecting to ${response.videoId}...`;
                sendToBackground({ type: 'CONNECT_TO_STREAM', videoId: response.videoId });
            }
        } else {
            console.log('[Panel] No stream state from background, querying content script');
            
            // Try to query content script directly
            try {
                const pageInfo = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_INFO' });
                console.log('[Panel] Page info from content script:', pageInfo);
                
                if (pageInfo?.isLive && pageInfo?.videoId) {
                    state.videoId = pageInfo.videoId;
                    state.streamTitle = pageInfo.title;
                    state.streamChannel = pageInfo.channelName;
                    
                    updateStreamInfo();
                    showState('connecting');
                    elements.connectingVideo.textContent = `Connecting to ${pageInfo.videoId}...`;
                    
                    sendToBackground({ type: 'CONNECT_TO_STREAM', videoId: pageInfo.videoId });
                } else {
                    console.log('[Panel] Content script says not live');
                    showState('no-stream');
                }
            } catch (contentError) {
                console.log('[Panel] Could not query content script:', contentError);
                showState('no-stream');
            }
        }
    } catch (error) {
        console.error('[Panel] Error checking tab:', error);
        showState('no-stream');
    }
}

// ============== MESSAGE HANDLING ==============

function handleBackgroundMessage(message, sender, sendResponse) {
    console.log('[Panel] Received message:', message.type, message);
    
    switch (message.type) {
        case 'STREAM_DETECTED':
            handleStreamDetected(message.data);
            break;
            
        case 'STREAM_ENDED':
            handleStreamEnded();
            break;
            
        case 'CONNECTION_STATUS':
            handleConnectionStatus(message.data);
            break;
            
        case 'CONNECTION_ERROR':
            handleConnectionError(message.data);
            break;
            
        case 'CHAT_DATA':
            handleChatData(message.data);
            break;
    }
    
    // Return true to indicate we might send a response
    return true;
}

function handleStreamDetected(data) {
    console.log('[Panel] Stream detected:', data);
    
    state.videoId = data.videoId;
    state.streamTitle = data.title;
    state.streamChannel = data.channelName;
    
    updateStreamInfo();
    
    // Check if we should be in connecting or visualization state
    if (state.connected) {
        showState('visualization');
    } else {
        showState('connecting');
        elements.connectingVideo.textContent = `Connecting to ${data.videoId}...`;
        
        // Request connection if not already requested
        sendToBackground({ type: 'CONNECT_TO_STREAM', videoId: data.videoId });
    }
}

function handleStreamEnded() {
    console.log('[Panel] Stream ended');
    state.videoId = null;
    resetData();
    showState('no-stream');
    updateConnectionStatus(false);
}

function handleConnectionStatus(data) {
    console.log('[Panel] Connection status:', data);
    state.connected = data.connected;
    updateConnectionStatus(data.connected);
    
    if (data.connected && state.videoId) {
        showState('visualization');
    }
}

function handleConnectionError(data) {
    console.log('[Panel] Connection error:', data);
    showState('error');
    elements.errorMessage.textContent = data.error || 'Unable to connect to backend';
    updateConnectionStatus(false);
}

function handleChatData(data) {
    // Route to appropriate handler based on message type
    switch (data.type) {
        case 'message':
            processMessage(data.data);
            break;
        case 'vibe':
            processVibe(data.data);
            break;
        case 'pulse':
            processPulse(data.data);
            break;
        case 'rate_limit_status':
            handleRateLimitStatus(data);
            break;
        case 'connected':
            console.log('[Panel] Backend confirmed connection');
            // Check if LLM is available on connect
            if (data.llm_available === false) {
                handleRateLimitStatus({ llm_available: false, status: data.rate_limit_status });
            }
            break;
        case 'subscribed':
            console.log('[Panel] Subscribed to video:', data.videoId);
            break;
        case 'error':
            console.error('[Panel] Backend error:', data.message);
            break;
    }
}

function handleRateLimitStatus(data) {
    console.log('[Panel] Rate limit status:', data);
    
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

// ============== DATA PROCESSING ==============

function processMessage(msg) {
    const now = Date.now();
    
    // Track for velocity
    state.recentMessages.push(now);
    
    // Process topic
    if (msg.topic) {
        const existing = state.topics[msg.topic] || {
            count: 0,
            sentiment: { bullish: 0, bearish: 0, neutral: 0 },
            lastUpdate: now,
            lastSentiment: msg.sentiment,
            comments: []
        };
        
        state.topics[msg.topic] = {
            count: existing.count + 1,
            sentiment: {
                ...existing.sentiment,
                [msg.sentiment]: existing.sentiment[msg.sentiment] + 1
            },
            lastUpdate: now,
            lastSentiment: msg.sentiment,
            comments: [...existing.comments.slice(-4), { text: msg.text, sentiment: msg.sentiment }]
        };
        
        renderTopics();
    }
    
    // Process question
    if (msg.isQuestion) {
        const topic = msg.topic || 'GENERAL';
        const key = msg.topic || msg.text.slice(0, 30);
        
        const existingIndex = state.questions.findIndex(q => q.key === key);
        
        if (existingIndex >= 0) {
            state.questions[existingIndex] = {
                ...state.questions[existingIndex],
                count: state.questions[existingIndex].count + 1,
                text: msg.text,
                author: msg.author,
                time: now
            };
        } else {
            state.questions.push({
                key,
                topic,
                text: msg.text,
                author: msg.author,
                count: 1,
                time: now
            });
            
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
        console.log('[Panel] Batch interval estimate:', Math.round(estimatedBatchInterval / 1000) + 's');
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
            time: Date.now(),
            id: Date.now() + Math.random()
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
        time: Date.now(),
        id: Date.now() + Math.random()
    });
    
    if (state.pulses.length > MAX_PULSES) {
        state.pulses = state.pulses.slice(0, MAX_PULSES);
    }
    
    renderPulses();
}

// ============== RENDERING ==============

function renderTopics() {
    const sorted = Object.entries(state.topics)
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, MAX_TOPICS);
    
    if (sorted.length === 0) {
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
    const minSize = 45;
    const maxSize = 140;
    
    // Initialize or update physics state for each bubble
    sorted.forEach(([ticker, data], index) => {
        // Relative sizing - ratio of this ticker to the top ticker
        const ratio = data.count / maxCount;  // 0 to 1
        const size = minSize + (ratio * (maxSize - minSize));
        const radius = size / 2;
        
        if (!bubblePhysics[ticker]) {
            // New bubble - spawn at random position around edge
            const angle = (index / sorted.length) * Math.PI * 2 + Math.random() * 0.5;
            const dist = 80 + Math.random() * 40;
            bubblePhysics[ticker] = {
                x: centerX + Math.cos(angle) * dist,
                y: centerY + Math.sin(angle) * dist,
                vx: (Math.random() - 0.5) * 0.15,
                vy: (Math.random() - 0.5) * 0.15,
                radius: radius,
                count: data.count
            };
        } else {
            // Existing bubble - check if count increased (trigger pulse)
            const wasCount = bubblePhysics[ticker].count;
            bubblePhysics[ticker].radius = radius;
            bubblePhysics[ticker].count = data.count;
            if (data.count > wasCount) {
                bubblePhysics[ticker].justUpdated = true;
            }
        }
    });
    
    // Remove physics for tickers no longer in top list
    const activeTickers = new Set(sorted.map(([t]) => t));
    Object.keys(bubblePhysics).forEach(ticker => {
        if (!activeTickers.has(ticker)) {
            delete bubblePhysics[ticker];
        }
    });
    
    // Render bubbles (DOM update)
    updateBubbleDOM(sorted, centerX, centerY);
    
    // Start physics loop if not running
    startPhysicsLoop(centerX, centerY, containerRect.width, containerRect.height);
}

function updateBubbleDOM(sorted, centerX, centerY) {
    const now = Date.now();
    const container = elements.topicsContainer;
    
    // Build map of existing DOM elements
    const existingElements = {};
    container.querySelectorAll('.topic-bubble').forEach(el => {
        const ticker = el.dataset.ticker;
        if (ticker) existingElements[ticker] = el;
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
            // Create new element with tooltip
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
        
        // Update classes
        el.className = `topic-bubble ${sentimentClass}${glowHigh ? ' glow-high' : ''}`;
        
        // Trigger pulse animation on update
        if (physics.justUpdated) {
            el.classList.add('pulse');
            setTimeout(() => el.classList.remove('pulse'), 600);
            physics.justUpdated = false;
        }
        
        // Update position and size
        el.style.left = `${physics.x - physics.radius}px`;
        el.style.top = `${physics.y - physics.radius}px`;
        el.style.width = `${size}px`;
        el.style.height = `${size}px`;
        el.style.zIndex = Math.floor(data.count);
        
        // Update text
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
    
    // Remove elements for tickers no longer shown
    Object.values(existingElements).forEach(el => el.remove());
}

function startPhysicsLoop(centerX, centerY, width, height) {
    if (physicsAnimationId) return; // Already running
    
    // Find max count for normalization
    let maxCount = 1;
    Object.values(bubblePhysics).forEach(b => {
        if (b.count > maxCount) maxCount = b.count;
    });
    
    function physicsStep() {
        const tickers = Object.keys(bubblePhysics);
        
        // Recalculate max count periodically
        maxCount = 1;
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
            // Less popular bubbles have weaker pull (orbit the edges)
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
                    
                    // Push away from collision
                    b.vx -= (odx / dist) * pushStrength;
                    b.vy -= (ody / dist) * pushStrength;
                }
            });
            
            // Velocity capping
            const speed = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
            if (speed > PHYSICS.MAX_VELOCITY) {
                b.vx = (b.vx / speed) * PHYSICS.MAX_VELOCITY;
                b.vy = (b.vy / speed) * PHYSICS.MAX_VELOCITY;
            }
            
            // Apply viscous damping
            b.vx *= PHYSICS.DAMPING;
            b.vy *= PHYSICS.DAMPING;
            
            // Update position
            b.x += b.vx;
            b.y += b.vy;
            
            // Soft boundary constraints
            const margin = b.radius + 10;
            if (b.x < margin) { b.x = margin; b.vx *= -0.3; }
            if (b.x > width - margin) { b.x = width - margin; b.vx *= -0.3; }
            if (b.y < margin) { b.y = margin; b.vy *= -0.3; }
            if (b.y > height - margin) { b.y = height - margin; b.vy *= -0.3; }
        });
        
        // Update DOM positions
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
    const now = Date.now();
    const active = state.questions.filter(q => now - q.time < QUESTION_TTL);
    
    if (active.length === 0) {
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
                    ${q.count > 1 ? `<span class="question-count">x${q.count} asking</span>` : ''}
                </div>
                <p class="question-text">"${escapeHtml(q.text)}"</p>
                <p class="question-author">@${escapeHtml(q.author)}</p>
            </div>
        `;
    }).join('');
}

function renderPulses() {
    if (state.pulses.length === 0) {
        elements.pulseContainer.innerHTML = '<div class="empty-state">Generating first summary...</div>';
        return;
    }
    
    const now = Date.now();
    
    elements.pulseContainer.innerHTML = state.pulses.map((pulse, i) => {
        const ageMinutes = (now - pulse.time) / 1000 / 60;
        const opacity = Math.max(0.4, 1 - (ageMinutes / 15));
        const timeLabel = ageMinutes < 1 ? 'just now' : `${Math.round(ageMinutes)}m ago`;
        
        return `
            <div class="pulse-card ${i === 0 ? 'newest slide-in' : ''}" style="opacity: ${opacity}">
                <div class="pulse-header">
                    <span class="pulse-mood">${pulse.mood}</span>
                    <div class="pulse-content">
                        <p class="pulse-summary">${escapeHtml(pulse.summary)}</p>
                        <div class="pulse-meta">
                            ${pulse.topTicker ? `<span class="pulse-ticker">$${pulse.topTicker}</span>` : ''}
                            <span class="pulse-time">${timeLabel}</span>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function renderVibes() {
    if (state.vibes.length === 0) {
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
    state.vibes.forEach(vibe => {
        const vibeId = String(vibe.id);
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
    const container = elements.vibesContainer;
    container.querySelectorAll('.vibe-bubble').forEach(el => el.remove());
    container.querySelectorAll('.vibes-particles').forEach(el => el.remove());
}

// ============== UI STATE MANAGEMENT ==============

function showState(stateName) {
    console.log('[Panel] Showing state:', stateName);
    
    elements.noStream.classList.add('hidden');
    elements.connecting.classList.add('hidden');
    elements.visualization.classList.add('hidden');
    elements.errorState.classList.add('hidden');
    
    switch (stateName) {
        case 'no-stream':
            elements.noStream.classList.remove('hidden');
            elements.streamInfo.classList.add('hidden');
            break;
        case 'connecting':
            elements.connecting.classList.remove('hidden');
            elements.streamInfo.classList.remove('hidden');
            break;
        case 'visualization':
            elements.visualization.classList.remove('hidden');
            elements.streamInfo.classList.remove('hidden');
            break;
        case 'error':
            elements.errorState.classList.remove('hidden');
            elements.streamInfo.classList.add('hidden');
            break;
    }
}

function updateConnectionStatus(connected) {
    state.connected = connected;
    
    elements.connectionStatus.className = `status ${connected ? 'connected' : 'disconnected'}`;
    elements.connectionStatus.querySelector('.status-text').textContent = connected ? 'Connected' : 'Disconnected';
}

function updateStreamInfo() {
    elements.streamTitle.textContent = state.streamTitle || 'Unknown Stream';
    elements.streamChannel.textContent = state.streamChannel || '';
}

// ============== VELOCITY ==============

function calculateVelocity() {
    const now = Date.now();
    const window = 5000;
    
    state.recentMessages = state.recentMessages.filter(t => now - t < window);
    state.velocity = state.recentMessages.length / (window / 1000);
    
    elements.velocityValue.textContent = state.velocity.toFixed(1);
    
    let velocityClass = 'quiet';
    if (state.velocity >= 4) velocityClass = 'hype';
    else if (state.velocity >= 2) velocityClass = 'busy';
    else if (state.velocity >= 0.5) velocityClass = 'active';
    
    elements.velocityDisplay.className = velocityClass;
}

// ============== CLEANUP ==============

function cleanupQuestions() {
    const now = Date.now();
    const before = state.questions.length;
    state.questions = state.questions.filter(q => now - q.time < QUESTION_TTL);
    
    if (state.questions.length !== before) {
        renderQuestions();
    }
}

function resetData() {
    state.topics = {};
    state.questions = [];
    state.pulses = [];
    state.vibes = [];
    state.recentMessages = [];
    state.velocity = 0;
    
    // Stop animations
    stopPhysicsLoop();
    stopVibesAnimation();
    
    renderTopics();
    renderQuestions();
    renderPulses();
    renderVibes();
}

// ============== UTILITIES ==============

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

async function retryConnection() {
    console.log('[Panel] Retry connection clicked');
    
    if (state.videoId) {
        showState('connecting');
        elements.connectingVideo.textContent = `Reconnecting to ${state.videoId}...`;
        sendToBackground({ type: 'CONNECT_TO_STREAM', videoId: state.videoId });
    } else {
        await checkCurrentTab();
    }
}

function handlePopOut() {
    console.log('[Panel] Pop out clicked, videoId:', state.videoId);
    
    // Store current state in background for standalone to pick up
    const stateToTransfer = {
        videoId: state.videoId,
        streamTitle: state.streamTitle,
        streamChannel: state.streamChannel,
        topics: { ...state.topics },
        questions: [...state.questions],
        pulses: [...state.pulses],
        vibes: [...state.vibes],
        recentMessages: [...state.recentMessages],
        velocity: state.velocity
    };
    
    console.log('[Panel] Storing state for transfer:', Object.keys(stateToTransfer));
    
    chrome.runtime.sendMessage({
        type: 'STORE_PANEL_STATE',
        state: stateToTransfer
    }).catch(e => console.log('[Panel] Could not store state:', e));
    
    // Build URL with video ID
    const standaloneUrl = chrome.runtime.getURL('sidepanel/standalone.html');
    const fullUrl = state.videoId 
        ? `${standaloneUrl}?v=${state.videoId}` 
        : standaloneUrl;
    
    // Open in new window
    // Use specific dimensions good for second monitor / OBS
    chrome.windows.create({
        url: fullUrl,
        type: 'popup',
        width: 500,
        height: 900,
        left: 100,
        top: 100
    }, (newWindow) => {
        console.log('[Panel] Pop out window created:', newWindow?.id);
    });
}

// ============== START ==============

document.addEventListener('DOMContentLoaded', init);
