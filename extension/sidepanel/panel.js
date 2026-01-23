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
    vibesTicker: document.getElementById('vibes-ticker')
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
        case 'connected':
            console.log('[Panel] Backend confirmed connection');
            break;
        case 'subscribed':
            console.log('[Panel] Subscribed to video:', data.videoId);
            break;
        case 'error':
            console.error('[Panel] Backend error:', data.message);
            break;
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
    
    state.vibes.push({
        text: msg.text,
        vibe: msg.vibe,
        time: Date.now(),
        id: Date.now() + Math.random()
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
        return;
    }
    
    const now = Date.now();
    
    elements.topicsContainer.innerHTML = sorted.map(([ticker, data]) => {
        const total = data.sentiment.bullish + data.sentiment.bearish;
        const bullishRatio = total === 0 ? 0.5 : data.sentiment.bullish / total;
        const contested = total > 0 && Math.min(data.sentiment.bullish, data.sentiment.bearish) / Math.max(data.sentiment.bullish, data.sentiment.bearish) > 0.5;
        
        const baseSize = 56;
        const growthFactor = Math.log2(data.count + 1) * 12;
        const size = Math.min(100, baseSize + growthFactor);
        
        const isRecent = now - data.lastUpdate < 2000;
        const sentimentClass = contested ? 'contested' : (bullishRatio > 0.5 ? 'bullish' : 'bearish');
        
        return `
            <div class="topic-bubble ${sentimentClass} ${isRecent ? 'recent' : ''}" 
                 style="width: ${size}px; height: ${size}px;">
                <span class="ticker" style="font-size: ${Math.max(10, size / 5)}px">${ticker}</span>
                <span class="count" style="font-size: ${Math.max(12, size / 4)}px">${data.count}</span>
                ${size >= 70 ? `
                    <div class="sentiment-bar">
                        <div class="sentiment-fill" style="width: ${bullishRatio * 100}%; background: linear-gradient(90deg, var(--green), var(--green))"></div>
                    </div>
                ` : ''}
            </div>
        `;
    }).join('');
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
