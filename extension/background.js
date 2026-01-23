/**
 * Live Chat Intelligence - Background Service Worker
 * 
 * Responsibilities:
 * - Manage side panel lifecycle
 * - Coordinate between content script and side panel
 * - Handle WebSocket connection to backend
 * - Track active YouTube Live streams
 */

// Backend WebSocket URL
// Production: wss://web-production-6fa01.up.railway.app
// Local dev:  ws://localhost:8765
const BACKEND_URL = 'wss://web-production-6fa01.up.railway.app';

// Track state per tab
const tabStates = new Map();

// WebSocket connection (shared across tabs watching same stream)
let ws = null;
let currentVideoId = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

console.log('[BG] Live Chat Intelligence service worker started');

// ============== SIDE PANEL MANAGEMENT ==============

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
    console.log('[BG] Extension icon clicked on tab:', tab.id, tab.url);
    
    // Check if we're on YouTube
    if (!tab.url?.includes('youtube.com')) {
        console.log('[BG] Not on YouTube');
        return;
    }
    
    try {
        // Open the side panel
        await chrome.sidePanel.open({ tabId: tab.id });
        console.log('[BG] Side panel opened');
        
        // Set the panel options
        await chrome.sidePanel.setOptions({
            tabId: tab.id,
            path: 'sidepanel/panel.html',
            enabled: true
        });
        
        // Check if we already have state for this tab
        const state = tabStates.get(tab.id);
        if (state?.videoId && state?.isLive) {
            console.log('[BG] Tab has live stream, connecting...');
            // Small delay to let panel initialize
            setTimeout(() => {
                connectToStream(state.videoId);
            }, 500);
        }
    } catch (error) {
        console.error('[BG] Error opening side panel:', error);
    }
});

// ============== MESSAGE HANDLING ==============

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[BG] Message received:', message.type, 'from:', sender.tab?.id || 'extension');
    
    switch (message.type) {
        case 'YOUTUBE_LIVE_DETECTED':
            handleLiveDetected(message, sender.tab);
            sendResponse({ success: true });
            break;
            
        case 'YOUTUBE_LIVE_ENDED':
            handleLiveEnded(sender.tab);
            sendResponse({ success: true });
            break;
            
        case 'GET_STREAM_STATE':
            const state = getStreamState(message.tabId);
            console.log('[BG] Returning stream state:', state);
            sendResponse(state);
            break;
            
        case 'CONNECT_TO_STREAM':
            console.log('[BG] Connect request for video:', message.videoId);
            connectToStream(message.videoId);
            sendResponse({ success: true });
            break;
            
        case 'DISCONNECT_FROM_STREAM':
            disconnectFromStream();
            sendResponse({ success: true });
            break;
            
        case 'PANEL_READY':
            // Side panel is ready, check if we should connect
            handlePanelReady(message.tabId);
            sendResponse({ success: true });
            break;
            
        default:
            console.log('[BG] Unknown message type:', message.type);
    }
    
    return true; // Keep channel open for async response
});

// ============== STREAM STATE MANAGEMENT ==============

function handleLiveDetected(message, tab) {
    if (!tab) {
        console.log('[BG] No tab in message');
        return;
    }
    
    const { videoId, channelName, title, isLive } = message;
    
    console.log(`[BG] Live stream detected on tab ${tab.id}: ${videoId} - ${title}`);
    
    // Store state for this tab
    tabStates.set(tab.id, {
        videoId,
        channelName,
        title,
        isLive,
        detectedAt: Date.now()
    });
    
    // Update extension badge
    chrome.action.setBadgeText({ text: 'LIVE', tabId: tab.id });
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444', tabId: tab.id });
    
    // Broadcast to any open side panels
    broadcastToRuntime({
        type: 'STREAM_DETECTED',
        data: { videoId, channelName, title, isLive, tabId: tab.id }
    });
}

function handleLiveEnded(tab) {
    if (!tab) return;
    
    console.log(`[BG] Live ended for tab ${tab.id}`);
    
    tabStates.delete(tab.id);
    chrome.action.setBadgeText({ text: '', tabId: tab.id });
    
    broadcastToRuntime({
        type: 'STREAM_ENDED',
        data: { tabId: tab.id }
    });
}

function handlePanelReady(tabId) {
    console.log('[BG] Panel ready for tab:', tabId);
    
    // Find the state for the active tab
    if (tabId && tabStates.has(tabId)) {
        const state = tabStates.get(tabId);
        console.log('[BG] Found state for tab, sending to panel:', state);
        
        broadcastToRuntime({
            type: 'STREAM_DETECTED',
            data: { 
                videoId: state.videoId, 
                channelName: state.channelName, 
                title: state.title, 
                isLive: state.isLive,
                tabId 
            }
        });
        
        // Auto-connect if not already connected
        if (state.videoId && (!ws || ws.readyState !== WebSocket.OPEN)) {
            connectToStream(state.videoId);
        }
    } else {
        // Try to get current tab and query content script
        chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
            if (tabs[0] && tabs[0].url?.includes('youtube.com/watch')) {
                console.log('[BG] Querying content script for page info');
                try {
                    const response = await chrome.tabs.sendMessage(tabs[0].id, { type: 'GET_PAGE_INFO' });
                    console.log('[BG] Content script response:', response);
                    
                    if (response?.isLive && response?.videoId) {
                        handleLiveDetected({
                            videoId: response.videoId,
                            channelName: response.channelName,
                            title: response.title,
                            isLive: response.isLive
                        }, tabs[0]);
                    }
                } catch (error) {
                    console.log('[BG] Could not query content script:', error);
                }
            }
        });
    }
}

function getStreamState(tabId) {
    const state = tabStates.get(tabId);
    return {
        hasStream: !!state,
        ...state,
        isConnected: ws?.readyState === WebSocket.OPEN,
        currentVideoId
    };
}

// ============== WEBSOCKET MANAGEMENT ==============

function connectToStream(videoId) {
    console.log(`[BG] connectToStream called for: ${videoId}`);
    
    // Don't reconnect if already connected to same stream
    if (currentVideoId === videoId && ws?.readyState === WebSocket.OPEN) {
        console.log('[BG] Already connected to this stream');
        broadcastToRuntime({
            type: 'CONNECTION_STATUS',
            data: { connected: true, videoId }
        });
        return;
    }
    
    // Disconnect from previous stream if different
    if (currentVideoId !== videoId && ws) {
        console.log('[BG] Disconnecting from previous stream');
        ws.close();
        ws = null;
    }
    
    currentVideoId = videoId;
    reconnectAttempts = 0;
    
    console.log(`[BG] Creating WebSocket connection to ${BACKEND_URL}`);
    
    try {
        ws = new WebSocket(BACKEND_URL);
        
        ws.onopen = () => {
            console.log('[BG] WebSocket connected!');
            reconnectAttempts = 0;
            
            // Subscribe to the video
            const subscribeMsg = {
                type: 'SUBSCRIBE',
                videoId: videoId
            };
            console.log('[BG] Sending subscribe:', subscribeMsg);
            ws.send(JSON.stringify(subscribeMsg));
            
            broadcastToRuntime({
                type: 'CONNECTION_STATUS',
                data: { connected: true, videoId }
            });
        };
        
        ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                console.log('[BG] WebSocket message:', message.type);
                
                // Forward all messages to side panel
                broadcastToRuntime({
                    type: 'CHAT_DATA',
                    data: message
                });
            } catch (e) {
                console.error('[BG] Failed to parse WebSocket message:', e);
            }
        };
        
        ws.onerror = (error) => {
            console.error('[BG] WebSocket error:', error);
            broadcastToRuntime({
                type: 'CONNECTION_ERROR',
                data: { error: 'WebSocket connection failed' }
            });
        };
        
        ws.onclose = (event) => {
            console.log('[BG] WebSocket closed:', event.code, event.reason);
            
            broadcastToRuntime({
                type: 'CONNECTION_STATUS',
                data: { connected: false, videoId: currentVideoId }
            });
            
            // Attempt reconnect if we still have a video
            if (currentVideoId && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                reconnectAttempts++;
                const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
                console.log(`[BG] Reconnecting in ${delay}ms (attempt ${reconnectAttempts})`);
                setTimeout(() => {
                    if (currentVideoId) {
                        connectToStream(currentVideoId);
                    }
                }, delay);
            }
        };
        
    } catch (error) {
        console.error('[BG] Failed to create WebSocket:', error);
        broadcastToRuntime({
            type: 'CONNECTION_ERROR',
            data: { error: error.message }
        });
    }
}

function disconnectFromStream() {
    console.log('[BG] disconnectFromStream called');
    if (ws) {
        ws.close();
        ws = null;
    }
    currentVideoId = null;
    reconnectAttempts = 0;
}

// ============== BROADCASTING ==============

// Connected ports for extension pages (side panels, standalone windows)
const connectedPorts = new Set();

// Listen for port connections from extension pages
chrome.runtime.onConnect.addListener((port) => {
    console.log('[BG] Port connected:', port.name);
    connectedPorts.add(port);
    
    // Send current state
    if (ws?.readyState === WebSocket.OPEN && currentVideoId) {
        port.postMessage({
            type: 'CONNECTION_STATUS',
            data: { connected: true, videoId: currentVideoId }
        });
    }
    
    port.onDisconnect.addListener(() => {
        console.log('[BG] Port disconnected:', port.name);
        connectedPorts.delete(port);
    });
    
    port.onMessage.addListener((message) => {
        console.log('[BG] Port message:', message.type);
        
        if (message.type === 'CONNECT_TO_STREAM') {
            connectToStream(message.videoId);
        } else if (message.type === 'DISCONNECT_FROM_STREAM') {
            disconnectFromStream();
        }
    });
});

function broadcastToRuntime(message) {
    console.log('[BG] Broadcasting to', connectedPorts.size, 'ports:', message.type);
    
    // Send to all connected ports
    for (const port of connectedPorts) {
        try {
            port.postMessage(message);
        } catch (e) {
            console.log('[BG] Failed to send to port:', e);
            connectedPorts.delete(port);
        }
    }
    
    // Also try runtime.sendMessage for backwards compatibility
    chrome.runtime.sendMessage(message).catch(() => {});
}

// ============== TAB LIFECYCLE ==============

// Clean up when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
    console.log('[BG] Tab closed:', tabId);
    tabStates.delete(tabId);
});

// Re-check when tab URL changes
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url) {
        console.log('[BG] Tab URL changed:', tabId, changeInfo.url);
        
        if (!changeInfo.url.includes('youtube.com/watch')) {
            tabStates.delete(tabId);
            chrome.action.setBadgeText({ text: '', tabId });
        }
    }
});

// When tab becomes active, check for state
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    console.log('[BG] Tab activated:', activeInfo.tabId);
    
    const state = tabStates.get(activeInfo.tabId);
    if (state?.isLive) {
        broadcastToRuntime({
            type: 'STREAM_DETECTED',
            data: { ...state, tabId: activeInfo.tabId }
        });
    }
});
