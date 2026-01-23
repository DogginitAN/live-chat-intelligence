/**
 * Live Chat Intelligence - Content Script
 * 
 * Runs on YouTube pages to:
 * - Detect YouTube Live streams
 * - Extract video metadata
 * - Monitor for live chat presence
 */

// State
let currentVideoId = null;
let isLive = false;
let checkInterval = null;

console.log('[LCI] Content script loaded on:', window.location.href);

// ============== VIDEO ID EXTRACTION ==============

function extractVideoId() {
    const urlParams = new URLSearchParams(window.location.search);
    const videoId = urlParams.get('v');
    
    // Also check for /live/ format
    if (!videoId) {
        const liveMatch = window.location.pathname.match(/\/live\/([^/?]+)/);
        if (liveMatch) return liveMatch[1];
    }
    
    return videoId;
}

// ============== LIVE DETECTION ==============

function checkIfLive() {
    // Multiple signals that indicate a live stream:
    
    // 1. Live badge in video player (check multiple selectors)
    const liveBadge = document.querySelector('.ytp-live-badge');
    const isLiveBadgeVisible = liveBadge && 
        window.getComputedStyle(liveBadge).display !== 'none' &&
        liveBadge.offsetParent !== null;
    
    // 2. Live chat container present
    const chatFrame = document.querySelector('iframe#chatframe');
    const chatContainer = document.querySelector('ytd-live-chat-frame');
    const hasLiveChat = !!(chatFrame || chatContainer);
    
    // 3. "watching" in view count area (strongest signal for live)
    const viewCountSelectors = [
        '#view-count',
        '.view-count', 
        'ytd-video-view-count-renderer',
        '#info-container ytd-video-view-count-renderer span',
        '.ytd-video-primary-info-renderer #info span'
    ];
    
    let hasWatchingText = false;
    for (const selector of viewCountSelectors) {
        const el = document.querySelector(selector);
        if (el && el.textContent) {
            const text = el.textContent.toLowerCase();
            if (text.includes('watching')) {
                hasWatchingText = true;
                console.log('[LCI] Found "watching" in:', selector, '-', el.textContent);
                break;
            }
        }
    }
    
    // 4. Check for "LIVE" text anywhere in the info section
    const infoSection = document.querySelector('#info-contents, #info');
    const hasLiveText = infoSection && infoSection.textContent.toLowerCase().includes('started streaming');
    
    // 5. URL contains "live"
    const urlHasLive = window.location.pathname.includes('/live/');
    
    // 6. Check for live indicator dot (red dot near view count)
    const liveDot = document.querySelector('.ytp-live');
    const hasLiveDot = liveDot && liveDot.offsetParent !== null;
    
    const reasons = [];
    if (isLiveBadgeVisible) reasons.push('live-badge');
    if (hasLiveChat) reasons.push('live-chat');
    if (hasWatchingText) reasons.push('watching-text');
    if (hasLiveText) reasons.push('started-streaming');
    if (urlHasLive) reasons.push('url-live');
    if (hasLiveDot) reasons.push('live-dot');
    
    const isLiveStream = reasons.length > 0;
    
    if (isLiveStream) {
        console.log('[LCI] Live stream detected! Reasons:', reasons.join(', '));
    }
    
    return isLiveStream;
}

function getStreamMetadata() {
    // Get channel name - try multiple selectors
    const channelSelectors = [
        '#channel-name a',
        'ytd-video-owner-renderer #channel-name a',
        'ytd-channel-name a',
        '#owner #channel-name a',
        '.ytd-channel-name a',
        '#upload-info #channel-name a'
    ];
    
    let channelName = 'Unknown Channel';
    for (const selector of channelSelectors) {
        const el = document.querySelector(selector);
        if (el && el.textContent.trim()) {
            channelName = el.textContent.trim();
            break;
        }
    }
    
    // Get video title - try multiple selectors
    const titleSelectors = [
        'h1.ytd-video-primary-info-renderer',
        '#title h1',
        'yt-formatted-string.ytd-video-primary-info-renderer',
        '#container h1.title',
        'h1.title'
    ];
    
    let title = document.title.replace(' - YouTube', '');
    for (const selector of titleSelectors) {
        const el = document.querySelector(selector);
        if (el && el.textContent.trim()) {
            title = el.textContent.trim();
            break;
        }
    }
    
    // Get viewer count
    const viewerSelectors = [
        '#view-count',
        '.view-count',
        'ytd-video-view-count-renderer span'
    ];
    
    let viewerCount = null;
    for (const selector of viewerSelectors) {
        const el = document.querySelector(selector);
        if (el && el.textContent) {
            const match = el.textContent.match(/[\d,]+/);
            if (match) {
                viewerCount = parseInt(match[0].replace(/,/g, ''));
                break;
            }
        }
    }
    
    console.log('[LCI] Metadata:', { channelName, title, viewerCount });
    
    return {
        channelName,
        title,
        viewerCount
    };
}

// ============== MAIN DETECTION LOOP ==============

function runDetection() {
    const videoId = extractVideoId();
    
    console.log('[LCI] Running detection. VideoId:', videoId, 'URL:', window.location.href);
    
    // Not on a video page
    if (!videoId) {
        if (currentVideoId) {
            console.log('[LCI] Left video page');
            notifyBackground('YOUTUBE_LIVE_ENDED', { videoId: currentVideoId });
            currentVideoId = null;
            isLive = false;
        }
        return;
    }
    
    // Check if this video is live
    const nowLive = checkIfLive();
    
    console.log('[LCI] Detection result - videoId:', videoId, 'isLive:', nowLive, 'wasLive:', isLive, 'prevVideoId:', currentVideoId);
    
    // New video or live status changed
    if (videoId !== currentVideoId || nowLive !== isLive) {
        currentVideoId = videoId;
        isLive = nowLive;
        
        if (isLive) {
            const metadata = getStreamMetadata();
            console.log('[LCI] Sending YOUTUBE_LIVE_DETECTED:', videoId);
            
            notifyBackground('YOUTUBE_LIVE_DETECTED', {
                videoId,
                isLive: true,
                ...metadata
            });
        } else if (!nowLive && currentVideoId) {
            console.log('[LCI] Not a live stream');
        }
    }
}

function notifyBackground(type, data) {
    console.log('[LCI] Notifying background:', type, data);
    
    chrome.runtime.sendMessage({ type, ...data })
        .then(response => {
            console.log('[LCI] Background response:', response);
        })
        .catch((error) => {
            console.log('[LCI] Could not reach background:', error.message);
        });
}

// ============== INITIALIZATION ==============

function init() {
    console.log('[LCI] Initializing content script');
    
    // Wait a bit for YouTube to fully render
    setTimeout(() => {
        console.log('[LCI] Running initial detection after delay');
        runDetection();
    }, 1500);
    
    // Re-check periodically (YouTube is an SPA, page doesn't reload)
    checkInterval = setInterval(() => {
        runDetection();
    }, 3000);
    
    // Also check on URL changes (YouTube navigation)
    let lastUrl = window.location.href;
    const observer = new MutationObserver(() => {
        if (window.location.href !== lastUrl) {
            lastUrl = window.location.href;
            console.log('[LCI] URL changed to:', lastUrl);
            // Longer delay for navigation to allow DOM to update
            setTimeout(runDetection, 2000);
        }
    });
    
    observer.observe(document.body, { childList: true, subtree: true });
}

// Listen for messages from background/side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('[LCI] Received message:', message);
    
    if (message.type === 'GET_PAGE_INFO') {
        const videoId = extractVideoId();
        const metadata = getStreamMetadata();
        const live = checkIfLive();
        
        const response = {
            videoId,
            isLive: live,
            ...metadata
        };
        console.log('[LCI] Responding with page info:', response);
        sendResponse(response);
    }
    
    if (message.type === 'FORCE_CHECK') {
        console.log('[LCI] Force check requested');
        runDetection();
        sendResponse({ checked: true });
    }
    
    return true;
});

// Run when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
