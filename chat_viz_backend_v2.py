"""
Live YouTube Chat Visualization Backend v2
Supports WebSocket-initiated stream connections (for Chrome extension)
"""

import asyncio
import json
import re
import os
from datetime import datetime
from typing import Optional, Dict, Set
import websockets
from websockets.server import serve
import pytchat
import httpx
import emoji

# Load .env file for local development
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # dotenv not required in production

# Configuration
WEBSOCKET_PORT = int(os.environ.get("PORT", os.environ.get("WEBSOCKET_PORT", 8765)))

# LLM Provider: "ollama" (local) or "groq" (cloud)
LLM_PROVIDER = os.environ.get("LLM_PROVIDER", "ollama")

# Ollama configuration (local dev)
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://192.168.68.71:11434/api/generate")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "qwen2.5:3b")

# Groq configuration (production)
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_MODEL = os.environ.get("GROQ_MODEL", "llama-3.1-8b-instant")
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

print(f"[Config] LLM Provider: {LLM_PROVIDER}")
print(f"[Config] WebSocket Port: {WEBSOCKET_PORT}")


# ============== UNIFIED LLM INTERFACE ==============

async def llm_complete(prompt: str, temperature: float = 0, timeout: float = 10.0) -> Optional[str]:
    """
    Unified LLM completion function.
    Uses Ollama locally or Groq in production based on LLM_PROVIDER.
    """
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            if LLM_PROVIDER == "groq" and GROQ_API_KEY:
                # Groq (OpenAI-compatible API)
                response = await client.post(
                    GROQ_URL,
                    headers={
                        "Authorization": f"Bearer {GROQ_API_KEY}",
                        "Content-Type": "application/json"
                    },
                    json={
                        "model": GROQ_MODEL,
                        "messages": [{"role": "user", "content": prompt}],
                        "temperature": temperature,
                        "max_tokens": 150
                    }
                )
                data = response.json()
                # Check for rate limit or other errors
                if "error" in data:
                    print(f"[LLM] Groq error: {data['error'].get('message', data['error'])}")
                    return None
                return data["choices"][0]["message"]["content"].strip()
            else:
                # Ollama (local)
                response = await client.post(
                    OLLAMA_URL,
                    json={
                        "model": OLLAMA_MODEL,
                        "prompt": prompt,
                        "stream": False,
                        "options": {"temperature": temperature}
                    }
                )
                return response.json()["response"].strip()
    except Exception as e:
        print(f"[LLM] Error: {e}")
        return None


# ============== CONNECTION MANAGEMENT ==============

# Connected clients per video
# Structure: { video_id: Set[websocket] }
video_clients: Dict[str, Set] = {}

# Active scrapers per video
# Structure: { video_id: asyncio.Task }
active_scrapers: Dict[str, asyncio.Task] = {}

# Global client set (for backwards compatibility)
connected_clients: Set = set()

# Chat Pulse configuration
PULSE_INTERVAL = 120  # Generate summary every 2 minutes
PULSE_MESSAGE_WINDOW = 100

# Rate limiting for Groq free tier (30 req/min)
# Prioritize pulse over vibe classification
VIBE_CHECK_INTERVAL = 30  # Check vibes every 30 seconds (was 3)
VIBE_BATCH_SIZE = 3  # Only classify 3 messages at a time (was 10)

# Per-video state
video_state: Dict[str, dict] = {}


def get_video_state(video_id: str) -> dict:
    """Get or create state for a video"""
    if video_id not in video_state:
        video_state[video_id] = {
            'pulse_buffer': [],
            'user_message_history': {},
            'session_discovered': set(),
        }
    return video_state[video_id]


# ============== TICKER DETECTION ==============

# Company name to ticker mapping
COMPANY_NAMES = {
    'TESLA': 'TSLA', 'NVIDIA': 'NVDA', 'APPLE': 'AAPL', 'MICROSOFT': 'MSFT',
    'AMAZON': 'AMZN', 'GOOGLE': 'GOOGL', 'ALPHABET': 'GOOGL', 'PALANTIR': 'PLTR',
    'COINBASE': 'COIN', 'ROBINHOOD': 'HOOD', 'GAMESTOP': 'GME', 'SUPERMICRO': 'SMCI',
    'BROADCOM': 'AVGO', 'MICRON': 'MU', 'QUALCOMM': 'QCOM', 'NETFLIX': 'NFLX',
    'DISNEY': 'DIS', 'PAYPAL': 'PYPL', 'SNOWFLAKE': 'SNOW', 'CROWDSTRIKE': 'CRWD',
    'ROCKETLAB': 'RKLB', 'ROCKET': 'RKLB', 'SPACEX': 'SPACEX', 'DATADOG': 'DDOG',
    'SALESFORCE': 'CRM', 'ORACLE': 'ORCL', 'ADOBE': 'ADBE', 'INTEL': 'INTC',
    'COSTCO': 'COST', 'WALMART': 'WMT', 'TARGET': 'TGT', 'STARBUCKS': 'SBUX',
    'MCDONALDS': 'MCD', 'CHIPOTLE': 'CMG', 'BOEING': 'BA', 'LOCKHEED': 'LMT',
}

# ~600 commonly discussed tickers (abbreviated for this update)
KNOWN_TICKERS = {
    # MEGA CAPS
    'AAPL', 'MSFT', 'GOOGL', 'GOOG', 'AMZN', 'NVDA', 'META', 'TSLA', 'BRK', 'BRKB',
    'TSM', 'AVGO', 'LLY', 'JPM', 'UNH', 'V', 'MA', 'XOM', 'JNJ', 'WMT',
    # TECH / SEMICONDUCTORS
    'AMD', 'INTC', 'MU', 'QCOM', 'TXN', 'AMAT', 'LRCX', 'KLAC', 'ADI', 'MRVL',
    'NXPI', 'MCHP', 'ON', 'SWKS', 'QRVO', 'MPWR', 'SMCI', 'ARM', 'ASML', 'SNPS',
    # SOFTWARE / CLOUD
    'CRM', 'ORCL', 'ADBE', 'NOW', 'INTU', 'PANW', 'CRWD', 'SNOW', 'DDOG', 'ZS',
    'NET', 'PLTR', 'MDB', 'ESTC', 'TEAM', 'OKTA', 'ZM', 'TWLO', 'HUBS', 'DOCU',
    # AI / QUANTUM
    'IONQ', 'RGTI', 'QBTS', 'QUBT', 'ARQQ', 'SOUN', 'BBAI', 'AI', 'UPST', 'CXAI',
    # MEME / RETAIL
    'GME', 'AMC', 'BB', 'NOK', 'KOSS', 'SNDL', 'TLRY', 'LCID', 'RIVN', 'DJT', 'RDDT',
    # CRYPTO
    'MSTR', 'COIN', 'MARA', 'RIOT', 'CLSK', 'IREN', 'HUT', 'BITF',
    'IBIT', 'GBTC', 'FBTC', 'ARKB', 'ETHE',
    'BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'ADA', 'AVAX', 'DOT', 'LINK', 'SHIB',
    # ETFS
    'SPY', 'QQQ', 'IWM', 'DIA', 'VOO', 'VTI', 'ARKK', 'SOXL', 'TQQQ', 'UVXY',
    # INDEX
    'SPX', 'NDX', 'VIX', 'RUT', 'DJI',
}

IGNORE_WORDS = {
    'ALL', 'ARE', 'BIG', 'BUY', 'CAN', 'CEO', 'DAY', 'DID', 'EOD', 'FOR',
    'GET', 'GOT', 'HAS', 'HER', 'HIM', 'HIS', 'HOW', 'ITS', 'LET', 'LOT',
    'LOW', 'MAN', 'MAY', 'NEW', 'NOT', 'NOW', 'OLD', 'ONE', 'OUR', 'OUT',
    'OWN', 'RUN', 'SAW', 'SAY', 'SEE', 'SET', 'SHE', 'THE', 'TOO', 'TRY',
    'TWO', 'USE', 'WAS', 'WAY', 'WHO', 'WHY', 'WIN', 'WON', 'YES', 'YET',
    'YOU', 'JUST', 'KNOW', 'LIKE', 'LOOK', 'MAKE', 'MORE', 'MOST', 'MUCH',
    'LOL', 'LMAO', 'LMFAO', 'OMG', 'WTF', 'IMO', 'IMHO', 'BTW', 'FYI', 'TBH',
    'IDK', 'SMH', 'NGL', 'BRO', 'SIS', 'FAM', 'ASAP', 'GOAT', 'ELON',
}

AMBIGUOUS_TICKERS = {
    'ALLY', 'APPS', 'BALL', 'BAND', 'BILL', 'BLUE', 'BOOM', 'BROS', 'CARS',
    'CASH', 'COST', 'DECK', 'DISH', 'DOOR', 'EYES', 'FAST', 'FIVE', 'FLOW',
    'FOOD', 'FREE', 'FUEL', 'FULL', 'FUND', 'GAME', 'GOOD', 'GROW', 'HAND',
    'HEAR', 'HELP', 'HOME', 'HOPE', 'IDEA', 'INFO', 'JOBS', 'KIND', 'KNOW',
    'LAND', 'LAST', 'LEAD', 'LIFE', 'LINE', 'LIVE', 'LOOK', 'LOVE', 'LUCK',
    'MAKE', 'MARK', 'MIND', 'MOVE', 'NEED', 'NEWS', 'NEXT', 'NICE', 'OPEN',
    'PACK', 'PAID', 'PASS', 'PATH', 'PEAK', 'PLAY', 'PLUS', 'POST', 'PUSH',
    'RACE', 'RARE', 'RATE', 'READ', 'REAL', 'REST', 'RIDE', 'RING', 'RISE',
    'ROAD', 'ROCK', 'ROLL', 'ROOF', 'ROOM', 'SAFE', 'SAIL', 'SALE', 'SAVE',
    'SEED', 'SELF', 'SHIP', 'SHOP', 'SHOW', 'SICK', 'SIDE', 'SIGN', 'SITE',
    'SIZE', 'SNAP', 'SOLO', 'SONG', 'SOON', 'SOUL', 'SPOT', 'STAR', 'STAY',
    'STEP', 'STOP', 'TALK', 'TEAM', 'TECH', 'TELL', 'TEST', 'TEXT', 'TRIP',
    'TRUE', 'TURN', 'VIEW', 'VOTE', 'WAIT', 'WALK', 'WALL', 'WAVE', 'WAYS',
    'WELL', 'WILD', 'WING', 'WIRE', 'WISE', 'WISH', 'WOOD', 'WORD', 'WORK',
    'YEAR', 'ZERO', 'ZONE',
}

DOLLAR_ONLY_TICKERS = {
    'DO', 'GO', 'ON', 'SO', 'IT', 'AT', 'BE', 'BY', 'OR', 'AN', 'AS', 'IF',
    'NO', 'UP', 'WE', 'HE', 'ME', 'TV', 'A', 'I', 'U', 'AI', 'KO', 'CAT',
}

STOCK_CONTEXT_WORDS = {
    'buy', 'buying', 'bought', 'sell', 'selling', 'sold', 'calls', 'call',
    'puts', 'put', 'shares', 'stock', 'stocks', 'price', 'trading', 'trade',
    'long', 'short', 'bullish', 'bearish', 'options', 'option', 'squeeze',
    'moon', 'pump', 'dump', 'dip', 'rip', 'breakout', 'earnings', 'hold',
    'holding', 'position', 'entry', 'exit', 'target', 'strike', 'portfolio',
}


def has_stock_context(text: str) -> bool:
    text_lower = text.lower()
    words = set(re.findall(r'\w+', text_lower))
    return bool(words & STOCK_CONTEXT_WORDS)


def extract_ticker(text: str, session_discovered: set) -> Optional[str]:
    text_upper = text.upper()
    
    # 1. $TICKER format
    dollar_match = re.search(r'\$([A-Z]{1,5})\b', text_upper)
    if dollar_match:
        ticker = dollar_match.group(1)
        if ticker not in IGNORE_WORDS:
            session_discovered.add(ticker)
            return ticker
    
    # 2. Company names
    for name, ticker in COMPANY_NAMES.items():
        if re.search(r'\b' + name + r'\b', text_upper):
            return ticker
    
    # 3. Known tickers
    all_valid = KNOWN_TICKERS | session_discovered
    words = re.findall(r'\b([A-Z]{2,5})\b', text_upper)
    
    for word in words:
        if word in IGNORE_WORDS or word in DOLLAR_ONLY_TICKERS:
            continue
        if word in all_valid and word not in AMBIGUOUS_TICKERS:
            return word
    
    # Check ambiguous with context
    if has_stock_context(text):
        for word in words:
            if word in IGNORE_WORDS or word in DOLLAR_ONLY_TICKERS:
                continue
            if word in all_valid and word in AMBIGUOUS_TICKERS:
                return word
    
    return None


# ============== SENTIMENT ==============

BULLISH_WORDS = {
    'buy', 'buying', 'bought', 'long', 'calls', 'call', 'bullish', 'moon',
    'rocket', 'pump', 'breakout', 'rip', 'ripping', 'squeeze', 'green',
    'up', 'higher', 'strong', 'support', 'bounce', 'reversal', 'cheap',
    'dip', 'accumulate', 'load', 'loading', 'ath', 'highs', 'beat',
    'crush', 'smash', 'blast', 'fly', 'flying', 'soar', 'send', 'print',
    'tendies', 'gains', 'lfg', 'letsgoo', 'parabolic'
}

BEARISH_WORDS = {
    'sell', 'selling', 'sold', 'short', 'puts', 'put', 'bearish', 'dump',
    'dumping', 'crash', 'crashing', 'tank', 'tanking', 'drill', 'drilling',
    'red', 'down', 'lower', 'weak', 'resistance', 'rejection', 'fade',
    'overvalued', 'expensive', 'bubble', 'top', 'topped', 'rug', 'rugged',
    'rekt', 'trapped', 'baghold', 'bagholder', 'dead', 'cliff', 'sink',
}

QUESTION_PATTERNS = [
    r'\?',
    r'^(what|when|where|why|how|is|are|do|does|will|should|can|could|would|any)\b',
    r'\b(what|which|who).*\b(is|are|should|would|do)\b',
    r'\b(thoughts|opinion|think|reckon)\b.*\b(on|about)\b',
    r'\bgood\s+(price|entry|time|level|spot)\b',
    r'\b(should|would)\s+(i|we|you)\b',
    r'\b(buy|sell|hold)\s+(or|now)\b',
    r'\bworth\s+(it|buying|holding)\b',
    r'\bany\s+(news|update|thoughts)\b',
    r'\bentry\s*(point|price|level)?\b',
    r'\btarget\s*(price)?\b.*\bfor\b',
    r'\bpt\b.*\bfor\b',
]
QUESTION_PATTERN = re.compile('|'.join(QUESTION_PATTERNS), re.IGNORECASE)


def analyze_sentiment(text: str) -> str:
    text_lower = text.lower()
    words = set(re.findall(r'\w+', text_lower))
    bullish_count = len(words & BULLISH_WORDS)
    bearish_count = len(words & BEARISH_WORDS)
    if '🚀' in text or '📈' in text or '💚' in text or '🟢' in text or '🔥' in text:
        bullish_count += 2
    if '📉' in text or '💔' in text or '🔴' in text or '🩸' in text or '💀' in text:
        bearish_count += 2
    if bullish_count > bearish_count:
        return 'bullish'
    elif bearish_count > bullish_count:
        return 'bearish'
    return 'neutral'


def is_question(text: str) -> bool:
    return bool(QUESTION_PATTERN.search(text))


# ============== SPAM DETECTION ==============

SPAM_LINK_RE = re.compile(r'discord\.gg/|t\.me/|bit\.ly/|tinyurl\.com/|telegram\.|join.*group|join.*channel|dm.*me', re.IGNORECASE)
SPAM_PUMP_RE = re.compile(r'guaranteed.*gains|100x|1000x|free.*money|free.*crypto|airdrop|giveaway.*crypto|double.*your|insider.*info|financial.*freedom|limited.*spots|get.*rich|pump.*coming|moon.*guaranteed|subscribe.*my|follow.*my', re.IGNORECASE)
SPAM_CRYPTO_RE = re.compile(r'send.*\d+.*eth|send.*\d+.*btc|wallet.*address|connect.*wallet|validate.*wallet|claim.*reward', re.IGNORECASE)

HISTORY_WINDOW = 60
MAX_HISTORY_PER_USER = 20


def clean_history(author: str, current_time: float, user_history: dict):
    if author in user_history:
        user_history[author] = [
            (ts, h) for ts, h in user_history[author]
            if current_time - ts < HISTORY_WINDOW
        ][-MAX_HISTORY_PER_USER:]


def detect_spam(text: str, author: str, user_history: dict) -> dict:
    current_time = datetime.now().timestamp()
    clean_history(author, current_time, user_history)
    
    text_lower = text.lower()
    text_hash = hash(text_lower.strip())
    reasons = []
    confidence = 0.0
    
    if author in user_history:
        recent_hashes = [h for _, h in user_history[author]]
        if text_hash in recent_hashes:
            reasons.append('duplicate')
            confidence = max(confidence, 0.9)
    
    if author in user_history:
        recent_timestamps = [ts for ts, _ in user_history[author]]
        recent_10s = [ts for ts in recent_timestamps if current_time - ts < 10]
        if len(recent_10s) >= 5:  # Was 3 - more lenient for active chatters
            reasons.append('rapid_fire')
            confidence = max(confidence, 0.6)  # Was 0.8 - triggers LLM check, not auto-drop
    
    if SPAM_LINK_RE.search(text):
        reasons.append('promo_link')
        confidence = max(confidence, 0.85)
    
    if SPAM_PUMP_RE.search(text):
        reasons.append('pump_promo')
        confidence = max(confidence, 0.8)
    
    if SPAM_CRYPTO_RE.search(text):
        reasons.append('crypto_scam')
        confidence = max(confidence, 0.95)
    
    alpha_chars = [c for c in text if c.isalpha()]
    if len(alpha_chars) >= 10:
        caps_ratio = sum(1 for c in alpha_chars if c.isupper()) / len(alpha_chars)
        if caps_ratio > 0.7:
            reasons.append('excessive_caps')
            confidence = max(confidence, 0.5)
    
    if re.search(r'(.)\1{4,}', text):
        reasons.append('repetitive_chars')
        confidence = max(confidence, 0.4)
    
    emoji_count = len([c for c in text if c in emoji.EMOJI_DATA])
    if emoji_count > 10:
        reasons.append('excessive_emojis')
        confidence = max(confidence, 0.5)
    
    if author not in user_history:
        user_history[author] = []
    user_history[author].append((current_time, text_hash))
    
    if len(reasons) >= 2 and confidence < 0.7:
        confidence = min(0.75, confidence + 0.2)
    
    return {
        'is_spam': confidence >= 0.7,
        'reason': reasons[0] if reasons else None,
        'reasons': reasons,
        'confidence': round(confidence, 2)
    }


async def llm_spam_check(text: str) -> bool:
    prompt = f"""Is this YouTube chat message spam, promotion, or bot-generated?
Message: "{text}"
Reply with ONLY: yes or no"""
    
    result = await llm_complete(prompt, temperature=0, timeout=3.0)
    if result:
        return "yes" in result.lower()
    return False


# ============== CHAT PULSE ==============

async def generate_pulse_summary(messages: list) -> dict:
    if not messages:
        return None
    
    texts = [m['text'] for m in messages[-PULSE_MESSAGE_WINDOW:]]
    tickers = [m['topic'] for m in messages if m.get('topic')]
    sentiments = [m['sentiment'] for m in messages if m.get('sentiment') != 'neutral']
    
    ticker_counts = {}
    for t in tickers:
        ticker_counts[t] = ticker_counts.get(t, 0) + 1
    top_tickers = sorted(ticker_counts.items(), key=lambda x: -x[1])[:3]
    
    bullish_count = sentiments.count('bullish')
    bearish_count = sentiments.count('bearish')
    
    sample_msgs = "\n".join(texts[-30:])
    ticker_summary = ", ".join([f"{t}({c})" for t, c in top_tickers]) if top_tickers else "none"
    sentiment_summary = f"{bullish_count} bullish, {bearish_count} bearish"
    
    prompt = f"""Summarize this YouTube live chat in ONE short sentence (under 15 words).
Top tickers: {ticker_summary}
Sentiment: {sentiment_summary}

Recent messages:
{sample_msgs}

Summary:"""
    
    summary = await llm_complete(prompt, temperature=0.7, timeout=10.0)
    if not summary:
        return None
    
    summary = summary.replace('"', '').strip()
    if summary.startswith('-'):
        summary = summary[1:].strip()
    if len(summary) > 80:
        summary = summary[:77] + "..."
    
    if bullish_count > bearish_count * 2:
        mood = "🟢"
    elif bearish_count > bullish_count * 2:
        mood = "🔴"
    elif bullish_count > 0 or bearish_count > 0:
        mood = "🟡"
    else:
        mood = "⚪"
    
    return {
        'summary': summary,
        'mood': mood,
        'top_ticker': top_tickers[0][0] if top_tickers else None,
        'msg_count': len(messages),
        'timestamp': datetime.now().isoformat()
    }


# ============== VIBE CLASSIFICATION ==============

async def classify_vibe_single(text: str) -> Optional[str]:
    prompt = f"""Classify this YouTube chat message into EXACTLY ONE category:
- funny: jokes, humor, laughter (lmao, haha, 😂, etc.)
- uplifting: encouragement, positivity, support
- none: neutral, questions, or anything else

Message: "{text}"
Reply with ONLY one word: funny, uplifting, or none"""
    
    result = await llm_complete(prompt, temperature=0, timeout=5.0)
    if result:
        result_lower = result.lower()
        for word in ["funny", "uplifting", "none"]:
            if word in result_lower:
                return word if word != "none" else None
    return None


async def classify_vibe_batch(messages: list) -> list:
    if not messages:
        return messages
    
    # Only classify a few messages to stay within rate limits
    tasks = [classify_vibe_single(msg['text']) for msg in messages[:VIBE_BATCH_SIZE]]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    for i, (msg, vibe) in enumerate(zip(messages[:VIBE_BATCH_SIZE], results)):
        if isinstance(vibe, str) and vibe in ('funny', 'uplifting'):
            msg['vibe'] = vibe
    
    return messages


def convert_emoji_codes(text: str) -> str:
    yt_emoji_map = {
        ':rolling_on_floor_laughing:': '🤣', ':face_with_tears_of_joy:': '😂',
        ':fire:': '🔥', ':rocket:': '🚀', ':thumbs_up:': '👍', ':thumbs_down:': '👎',
        ':red_heart:': '❤️', ':skull:': '💀', ':money_bag:': '💰',
        ':chart_increasing:': '📈', ':chart_decreasing:': '📉',
    }
    for code, emj in yt_emoji_map.items():
        text = text.replace(code, emj)
    text = emoji.emojize(text, language='alias')
    return text


# ============== MESSAGE PROCESSING ==============

def process_message(chat_msg, video_state: dict) -> dict:
    text = convert_emoji_codes(chat_msg.message)
    author = chat_msg.author.name
    
    # Skip spam detection for channel owner and moderators
    is_privileged = getattr(chat_msg.author, 'isChatOwner', False) or getattr(chat_msg.author, 'isChatModerator', False)
    
    if is_privileged:
        spam_result = {'is_spam': False, 'reason': None, 'reasons': [], 'confidence': 0.0}
    else:
        spam_result = detect_spam(text, author, video_state['user_message_history'])
    
    result = {
        'text': text,
        'author': author,
        'timestamp': datetime.now().isoformat(),
        'topic': extract_ticker(text, video_state['session_discovered']),
        'sentiment': 'neutral',
        'isQuestion': is_question(text),
        'vibe': None,
        'spam': spam_result
    }
    if result['topic']:
        result['sentiment'] = analyze_sentiment(text)
    return result


# ============== BROADCAST ==============

async def broadcast_to_video(video_id: str, message: dict):
    """Broadcast message to all clients watching a specific video"""
    if video_id not in video_clients:
        return
    
    clients = video_clients[video_id].copy()
    if not clients:
        return
    
    msg_json = json.dumps(message)
    await asyncio.gather(
        *[c.send(msg_json) for c in clients],
        return_exceptions=True
    )


async def broadcast_global(message: dict):
    """Broadcast to all connected clients (backwards compatibility)"""
    if not connected_clients:
        return
    msg_json = json.dumps(message)
    await asyncio.gather(
        *[c.send(msg_json) for c in connected_clients],
        return_exceptions=True
    )


# ============== YOUTUBE SCRAPER ==============

def extract_video_id(url: str) -> str:
    patterns = [
        r'(?:v=|/v/|youtu\.be/)([^&?\s]+)',
        r'(?:embed/)([^&?\s]+)',
        r'(?:live/)([^&?\s]+)',
        r'^([a-zA-Z0-9_-]{11})$'
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return url


async def scrape_youtube_chat(video_id: str):
    """Scrape chat for a specific video and broadcast to subscribers"""
    print(f"[Scraper] Starting scrape for video: {video_id}")
    
    state = get_video_state(video_id)
    
    try:
        chat = pytchat.create(video_id=video_id)
        print(f"[Scraper] Connected to YouTube chat for {video_id}")
        
        await broadcast_to_video(video_id, {
            'type': 'connected',
            'message': f'Connected to chat for {video_id}'
        })
        
        vibe_batch = []
        last_vibe_check = asyncio.get_event_loop().time()
        last_pulse_time = asyncio.get_event_loop().time()
        
        spam_count = 0
        msg_count = 0
        
        while chat.is_alive():
            # Check if anyone is still watching
            if video_id not in video_clients or not video_clients[video_id]:
                print(f"[Scraper] No more clients for {video_id}, stopping")
                break
            
            for c in chat.get().sync_items():
                processed = process_message(c, state)
                msg_count += 1
                
                spam_info = processed.get('spam', {})
                if spam_info.get('is_spam'):
                    spam_count += 1
                    continue
                
                if spam_info.get('confidence', 0) >= 0.5:
                    if await llm_spam_check(processed['text']):
                        spam_count += 1
                        continue
                
                if processed['topic'] or processed['isQuestion']:
                    await broadcast_to_video(video_id, {'type': 'message', 'data': processed})
                
                vibe_batch.append(processed)
                state['pulse_buffer'].append(processed)
            
            current_time = asyncio.get_event_loop().time()
            
            # Vibe classification (throttled for rate limits)
            if current_time - last_vibe_check >= VIBE_CHECK_INTERVAL and vibe_batch:
                classified = await classify_vibe_batch(vibe_batch[-20:])
                for msg in classified:
                    if msg.get('vibe'):
                        await broadcast_to_video(video_id, {'type': 'vibe', 'data': msg})
                vibe_batch = []
                last_vibe_check = current_time
            
            # Pulse summary
            if current_time - last_pulse_time >= PULSE_INTERVAL and len(state['pulse_buffer']) >= 10:
                pulse = await generate_pulse_summary(state['pulse_buffer'])
                if pulse:
                    await broadcast_to_video(video_id, {'type': 'pulse', 'data': pulse})
                state['pulse_buffer'] = []
                last_pulse_time = current_time
            
            await asyncio.sleep(0.5)
            
    except Exception as e:
        print(f"[Scraper] Error for {video_id}: {e}")
        await broadcast_to_video(video_id, {'type': 'error', 'message': str(e)})
    finally:
        # Cleanup
        if video_id in active_scrapers:
            del active_scrapers[video_id]
        print(f"[Scraper] Stopped scraping {video_id}")


# ============== WEBSOCKET HANDLER ==============

async def handle_client(websocket):
    """Handle a WebSocket client connection"""
    connected_clients.add(websocket)
    client_video_id = None
    
    print(f"[WS] Client connected. Total: {len(connected_clients)}")
    
    try:
        await websocket.send(json.dumps({
            'type': 'connected',
            'message': 'Connected to FlowState backend'
        }))
        
        async for message in websocket:
            try:
                data = json.loads(message)
                msg_type = data.get('type')
                
                if msg_type == 'SUBSCRIBE':
                    # Client wants to subscribe to a video
                    video_id = data.get('videoId')
                    if not video_id:
                        video_id = extract_video_id(data.get('url', ''))
                    
                    if video_id:
                        # Unsubscribe from previous video if any
                        if client_video_id and client_video_id in video_clients:
                            video_clients[client_video_id].discard(websocket)
                        
                        # Subscribe to new video
                        client_video_id = video_id
                        if video_id not in video_clients:
                            video_clients[video_id] = set()
                        video_clients[video_id].add(websocket)
                        
                        print(f"[WS] Client subscribed to {video_id}")
                        
                        # Start scraper if not already running
                        if video_id not in active_scrapers:
                            task = asyncio.create_task(scrape_youtube_chat(video_id))
                            active_scrapers[video_id] = task
                        
                        await websocket.send(json.dumps({
                            'type': 'subscribed',
                            'videoId': video_id
                        }))
                    else:
                        await websocket.send(json.dumps({
                            'type': 'error',
                            'message': 'Invalid video ID or URL'
                        }))
                
                elif msg_type == 'UNSUBSCRIBE':
                    if client_video_id and client_video_id in video_clients:
                        video_clients[client_video_id].discard(websocket)
                        client_video_id = None
                        
                        await websocket.send(json.dumps({
                            'type': 'unsubscribed'
                        }))
                
                else:
                    print(f"[WS] Unknown message type: {msg_type}")
                    
            except json.JSONDecodeError:
                print(f"[WS] Invalid JSON received")
                
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        connected_clients.discard(websocket)
        if client_video_id and client_video_id in video_clients:
            video_clients[client_video_id].discard(websocket)
        print(f"[WS] Client disconnected. Total: {len(connected_clients)}")


# ============== MAIN ==============

async def main(video_url: str = None):
    """Start the WebSocket server, optionally with a default video"""
    print(f"Starting FlowState backend on port {WEBSOCKET_PORT}")
    print(f"WebSocket: ws://0.0.0.0:{WEBSOCKET_PORT}")
    
    if video_url:
        video_id = extract_video_id(video_url)
        print(f"Default video: {video_id}")
        # Start scraper for CLI-provided video
        task = asyncio.create_task(scrape_youtube_chat(video_id))
        active_scrapers[video_id] = task
    
    async with serve(handle_client, "0.0.0.0", WEBSOCKET_PORT):
        await asyncio.Future()  # Run forever


if __name__ == "__main__":
    import sys
    video_url = sys.argv[1] if len(sys.argv) > 1 else None
    asyncio.run(main(video_url))
