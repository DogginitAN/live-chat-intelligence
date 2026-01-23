"""
Live YouTube Chat Visualization Backend
Scrapes YouTube Live chat, classifies messages, serves via WebSocket
"""

import asyncio
import json
import re
import os
from datetime import datetime
from typing import Optional
import websockets
from websockets.server import serve
import pytchat
import httpx
import emoji

# Configuration
WEBSOCKET_PORT = 8765

# Ollama configuration (local on Spark)
OLLAMA_URL = "http://192.168.68.71:11434/api/generate"
OLLAMA_MODEL = "qwen2.5:3b"

# Connected WebSocket clients
connected_clients = set()

# Chat Pulse configuration
PULSE_INTERVAL = 120  # Generate summary every 2 minutes
PULSE_MESSAGE_WINDOW = 100  # Messages to consider for summary
pulse_message_buffer = []  # Rolling buffer of recent messages

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

# S&P 500 + Nasdaq 100 + Popular ETFs + Meme stocks + Crypto stocks
# This is ~600 of the most commonly discussed tickers
KNOWN_TICKERS = {
    # ===== MEGA CAPS =====
    'AAPL', 'MSFT', 'GOOGL', 'GOOG', 'AMZN', 'NVDA', 'META', 'TSLA', 'BRK', 'BRKB',
    'TSM', 'AVGO', 'LLY', 'JPM', 'UNH', 'V', 'MA', 'XOM', 'JNJ', 'WMT',
    
    # ===== TECH / SEMICONDUCTORS =====
    'AMD', 'INTC', 'MU', 'QCOM', 'TXN', 'AMAT', 'LRCX', 'KLAC', 'ADI', 'MRVL',
    'NXPI', 'MCHP', 'ON', 'SWKS', 'QRVO', 'MPWR', 'SMCI', 'ARM', 'ASML', 'SNPS',
    'CDNS', 'ANSS', 'WOLF', 'SLAB', 'CRUS', 'MKSI', 'ENTG', 'ACLS', 'COHR', 'IPGP',
    
    # ===== SOFTWARE / CLOUD =====
    'CRM', 'ORCL', 'ADBE', 'NOW', 'INTU', 'PANW', 'CRWD', 'SNOW', 'DDOG', 'ZS',
    'NET', 'PLTR', 'MDB', 'ESTC', 'SPLK', 'TEAM', 'OKTA', 'ZM', 'TWLO', 'HUBS',
    'DOCU', 'WDAY', 'VEEV', 'RNG', 'BILL', 'PATH', 'DOCN', 'CFLT', 'MNDY', 'GTLB',
    'S', 'TENB', 'CYBR', 'FTNT', 'RPD', 'QLYS', 'VRNS', 'SAIL', 'SMAR', 'APPN',
    
    # ===== AI / QUANTUM =====
    'IONQ', 'RGTI', 'QBTS', 'QUBT', 'ARQQ', 'SOUN', 'BBAI', 'AI', 'UPST', 'CXAI',
    
    # ===== INTERNET / SOCIAL =====
    'NFLX', 'SPOT', 'ROKU', 'TTD', 'PINS', 'SNAP', 'RBLX', 'U', 'TTWO', 'EA',
    'MTCH', 'BMBL', 'YELP', 'TRIP', 'EXPE', 'BKNG', 'ABNB', 'UBER', 'LYFT', 'DASH',
    'GRUB', 'DKNG', 'PENN', 'CHWY', 'ETSY', 'EBAY', 'MELI', 'SE', 'SHOP', 'SQ',
    
    # ===== FINTECH / PAYMENTS =====
    'PYPL', 'SQ', 'AFRM', 'SOFI', 'HOOD', 'COIN', 'UPST', 'LC', 'MQ', 'FOUR',
    'PAYO', 'DLO', 'STNE', 'PAGS', 'XP', 'NU', 'BILL', 'TOST', 'FLYW', 'OUST',
    
    # ===== BANKS / FINANCE =====
    'JPM', 'BAC', 'WFC', 'C', 'GS', 'MS', 'SCHW', 'BLK', 'BX', 'KKR',
    'APO', 'ARES', 'OWL', 'TROW', 'IVZ', 'BEN', 'AMG', 'LPLA', 'RJF', 'SEIC',
    'USB', 'PNC', 'TFC', 'MTB', 'FITB', 'KEY', 'RF', 'HBAN', 'CFG', 'ZION',
    'AXP', 'COF', 'DFS', 'SYF', 'ALLY', 'NAVI', 'SLM', 'FCNCA', 'WAL', 'EWBC',
    
    # ===== HEALTHCARE / BIOTECH =====
    'LLY', 'UNH', 'JNJ', 'PFE', 'ABBV', 'MRK', 'TMO', 'ABT', 'DHR', 'BMY',
    'AMGN', 'GILD', 'VRTX', 'REGN', 'MRNA', 'BNTX', 'BIIB', 'ILMN', 'ISRG', 'DXCM',
    'PODD', 'ALGN', 'IDXX', 'IQV', 'CRL', 'RVTY', 'TECH', 'BIO', 'A', 'WAT',
    'ZBH', 'SYK', 'BSX', 'MDT', 'EW', 'HCA', 'CVS', 'CI', 'ELV', 'HUM',
    'CNC', 'MOH', 'UHS', 'SGRY', 'DVA', 'HIMS', 'DOCS', 'TDOC', 'OSCR', 'CLOV',
    
    # ===== CONSUMER / RETAIL =====
    'WMT', 'COST', 'TGT', 'HD', 'LOW', 'DLTR', 'DG', 'FIVE', 'OLLI', 'BJ',
    'AMZN', 'BABA', 'JD', 'PDD', 'CPNG', 'W', 'OSTK', 'REAL', 'CVNA', 'CARG',
    'AN', 'LAD', 'KMX', 'SIG', 'ULTA', 'SEPHORA', 'EL', 'TPR', 'RL', 'PVH',
    'VFC', 'HBI', 'UAA', 'LULU', 'NKE', 'DECK', 'CROX', 'SKX', 'WWW', 'SHOO',
    'GPS', 'ANF', 'AEO', 'URBN', 'EXPR', 'TLRD', 'BURL', 'TJX', 'ROST', 'WSM',
    'RH', 'BBWI', 'WRBY', 'FIGS', 'BROS', 'SBUX', 'MCD', 'CMG', 'QSR', 'WEN',
    'DPZ', 'PZZA', 'YUM', 'WING', 'SHAK', 'JACK', 'DNUT', 'DIN', 'CAKE', 'EAT',
    'TXRH', 'BLMN', 'DRI', 'CBRL', 'PLAY', 'SIX', 'FUN', 'SEAS', 'CNK', 'IMAX',
    'PEP', 'KO', 'MNST', 'CELH', 'KDP', 'TAP', 'SAM', 'STZ', 'DEO', 'BF',
    'PM', 'MO', 'BTI', 'TPB', 'TLRY', 'CGC', 'ACB', 'CRON', 'SNDL', 'VFF',
    
    # ===== AUTOS / EV =====
    'TSLA', 'RIVN', 'LCID', 'NIO', 'XPEV', 'LI', 'FSR', 'NKLA', 'RIDE', 'WKHS',
    'GOEV', 'FFIE', 'MULN', 'VFS', 'PTRA', 'ARVL', 'LEV', 'HYLN', 'EVGO', 'CHPT',
    'BLNK', 'VLTA', 'DCFC', 'QS', 'MVST', 'SLDP', 'FREY', 'FREYR', 'ENVX', 'AMPX',
    'F', 'GM', 'TM', 'HMC', 'RACE', 'STLA', 'VWAGY', 'BMWYY', 'MBGAF', 'POAHY',
    
    # ===== INDUSTRIALS / AEROSPACE =====
    'BA', 'LMT', 'RTX', 'NOC', 'GD', 'HII', 'LHX', 'TDG', 'TXT', 'HWM',
    'CAT', 'DE', 'PCAR', 'CMI', 'AGCO', 'CNHI', 'TEX', 'ASTE', 'OSK', 'WNC',
    'GE', 'HON', 'MMM', 'EMR', 'ROK', 'AME', 'PH', 'ITW', 'NDSN', 'MIDD',
    'URI', 'HEES', 'WSC', 'ACM', 'PWR', 'EME', 'FIX', 'MTZ', 'AROC', 'TPC',
    'FDX', 'UPS', 'DAL', 'UAL', 'AAL', 'LUV', 'ALK', 'JBLU', 'SAVE', 'HA',
    'JBHT', 'KNX', 'ODFL', 'SAIA', 'XPO', 'GXO', 'CHRW', 'EXPD', 'LSTR', 'HUBG',
    
    # ===== ENERGY =====
    'XOM', 'CVX', 'COP', 'EOG', 'SLB', 'MPC', 'VLO', 'PSX', 'OXY', 'PXD',
    'DVN', 'FANG', 'HAL', 'BKR', 'NOV', 'HP', 'OII', 'RIG', 'VAL', 'DO',
    'AR', 'RRC', 'EQT', 'SWN', 'CNX', 'CTRA', 'MTDR', 'CHRD', 'PR', 'GPOR',
    
    # ===== UTILITIES / ENERGY TRANSITION =====
    'NEE', 'DUK', 'SO', 'D', 'AEP', 'XEL', 'SRE', 'ED', 'EIX', 'WEC',
    'ES', 'AWK', 'ATO', 'NI', 'CMS', 'DTE', 'FE', 'PPL', 'EVRG', 'AES',
    'PLUG', 'FCEL', 'BLDP', 'BE', 'BLOOM', 'ENPH', 'SEDG', 'RUN', 'NOVA', 'ARRY',
    'SHLS', 'MAXN', 'SPWR', 'FSLR', 'CSIQ', 'JKS', 'DQ', 'FLNC', 'STEM', 'GEVO',
    
    # ===== REITS =====
    'AMT', 'PLD', 'EQIX', 'CCI', 'PSA', 'DLR', 'SBAC', 'O', 'WELL', 'AVB',
    'EQR', 'VTR', 'ARE', 'MAA', 'UDR', 'ESS', 'CPT', 'SUI', 'ELS', 'INVH',
    'MPW', 'PEAK', 'DOC', 'HR', 'OHI', 'CTRE', 'SBRA', 'LTC', 'NHI', 'GMRE',
    
    # ===== MATERIALS / MINING =====
    'LIN', 'APD', 'SHW', 'DD', 'DOW', 'PPG', 'ECL', 'EMN', 'ALB', 'FMC',
    'NEM', 'FCX', 'NUE', 'STLD', 'CLF', 'X', 'AA', 'SCCO', 'TECK', 'RIO',
    'BHP', 'VALE', 'MT', 'BTU', 'ARCH', 'CNR', 'HCC', 'AMR', 'CEIX', 'ARLP',
    'MP', 'LAC', 'LTHM', 'SQM', 'LTBR', 'UUUU', 'DNN', 'NXE', 'URG', 'CCJ',
    
    # ===== SPACE =====
    'RKLB', 'LUNR', 'RDW', 'ASTS', 'BKSY', 'SPIR', 'PL', 'VORB', 'ASTR', 'MNTS',
    
    # ===== CRYPTO / BITCOIN =====
    'MSTR', 'COIN', 'MARA', 'RIOT', 'CLSK', 'IREN', 'HUT', 'BITF', 'BTBT', 'CIFR',
    'EBON', 'CORZ', 'ARBK', 'GREE', 'BTDR', 'WULF', 'BTCM', 'ETOR', 'SATO', 'DGHI',
    'IBIT', 'GBTC', 'FBTC', 'ARKB', 'BITB', 'HODL', 'BRRR', 'BTCO', 'DEFI', 'EZBC',
    'ETHE', 'ETHV', 'CETH', 'FETH', 'ETHA',  # ETH ETFs
    'MSTU', 'MSTX', 'MSTZ', 'CONL',  # Leveraged MSTR
    
    # ===== MEME / RETAIL FAVORITES =====
    'GME', 'AMC', 'BB', 'NOK', 'BBBY', 'KOSS', 'EXPR', 'NAKD', 'SNDL', 'TLRY',
    'WKHS', 'CLOV', 'WISH', 'SOFI', 'HOOD', 'LCID', 'RIVN', 'DWAC', 'PHUN', 'MARK',
    'SPCE', 'SKLZ', 'PLBY', 'BYND', 'CRSR', 'NNDM', 'SPRT', 'ATER', 'IRNT', 'SDC',
    'PROG', 'BBIG', 'TYDE', 'CEI', 'OCGN', 'AGRX', 'BIOR', 'SAVA', 'SRNE', 'EDSA',
    'DJT', 'SMFL', 'RDDT', 'LUNR',  # 2024-2025 faves
    
    # ===== ETFS =====
    'SPY', 'QQQ', 'IWM', 'DIA', 'VOO', 'VTI', 'VTV', 'VUG', 'VGT', 'VHT',
    'VNQ', 'VWO', 'VEA', 'VIG', 'SCHD', 'JEPI', 'JEPQ', 'QYLD', 'XYLD', 'RYLD',
    'XLF', 'XLE', 'XLK', 'XLV', 'XLI', 'XLY', 'XLP', 'XLU', 'XLB', 'XLRE',
    'IYR', 'ITB', 'XHB', 'KRE', 'KBE', 'OIH', 'XOP', 'AMLP', 'MLPA', 'TAN',
    'ICLN', 'PBW', 'QCLN', 'LIT', 'BATT', 'DRIV', 'IDRV', 'CARZ', 'KOMP', 'ARKK',
    'ARKW', 'ARKF', 'ARKG', 'ARKQ', 'ARKX', 'PRNT', 'IZRL', 'MOON', 'ROBO', 'BOTZ',
    'HACK', 'BUG', 'CIBR', 'WCLD', 'SKYY', 'CLOU', 'IGV', 'SOXX', 'SMH', 'PSI',
    'SOXL', 'SOXS', 'TQQQ', 'SQQQ', 'QLD', 'QID', 'SPXL', 'SPXS', 'SPXU', 'UPRO',
    'TNA', 'TZA', 'LABU', 'LABD', 'FAS', 'FAZ', 'ERX', 'ERY', 'NUGT', 'DUST',
    'JNUG', 'JDST', 'GUSH', 'DRIP', 'BOIL', 'KOLD', 'UCO', 'SCO', 'USO', 'UNG',
    'UVXY', 'SVXY', 'VXX', 'VIXY', 'SVOL', 'VIXM',
    
    # ===== INDEX NAMES =====
    'SPX', 'NDX', 'VIX', 'RUT', 'DJI',
    
    # ===== MACRO =====
    'CPI', 'PPI', 'PCE', 'GDP', 'NFP', 'JOBS', 'FOMC', 'FED', 'OPEC',
    
    # ===== CRYPTO (non-stock) =====
    'BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'ADA', 'AVAX', 'DOT', 'LINK', 'MATIC',
    'SHIB', 'LTC', 'BCH', 'UNI', 'AAVE', 'MKR', 'ATOM', 'FIL', 'ICP', 'APT',
}

# Words that look like tickers but AREN'T
IGNORE_WORDS = {
    # Common words that are real tickers nobody means in chat
    'ALL', 'ARE', 'BIG', 'BUY', 'CAN', 'CEO', 'DAY', 'DID', 'EOD', 'FOR',
    'GET', 'GOT', 'HAS', 'HER', 'HIM', 'HIS', 'HOW', 'ITS', 'LET', 'LOT',
    'LOW', 'MAN', 'MAY', 'NEW', 'NOT', 'NOW', 'OLD', 'ONE', 'OUR', 'OUT',
    'OWN', 'RUN', 'SAW', 'SAY', 'SEE', 'SET', 'SHE', 'THE', 'TOO', 'TRY',
    'TWO', 'USE', 'WAS', 'WAY', 'WHO', 'WHY', 'WIN', 'WON', 'YES', 'YET',
    'YOU', 'JUST', 'KNOW', 'LIKE', 'LOOK', 'MAKE', 'MORE', 'MOST', 'MUCH',
    'MUST', 'NEXT', 'ONLY', 'OVER', 'SAME', 'SELF', 'SOME', 'SUCH', 'TELL',
    'THAN', 'THAT', 'THEM', 'THEN', 'THIS', 'TIME', 'VERY', 'WANT', 'WELL',
    'WHAT', 'WHEN', 'WILL', 'WITH', 'WORK', 'YEAR', 'BEEN', 'COME', 'DOES',
    'DONE', 'EACH', 'EVEN', 'FIND', 'GIVE', 'GOOD', 'HAVE', 'HERE', 'INTO',
    'KEEP', 'LAST', 'LONG', 'TAKE', 'THEIR', 'THINK', 'THOSE', 'UNDER', 'COULD',
    'WOULD', 'ABOUT', 'AFTER', 'BEING', 'COULD', 'EVERY', 'FIRST', 'FOUND',
    'GREAT', 'NEVER', 'OTHER', 'PLACE', 'RIGHT', 'STILL', 'THINK', 'WHERE',
    'WHICH', 'WHILE', 'WORLD', 'THESE', 'THING', 'THROUGH',
    # Internet slang
    'LOL', 'LMAO', 'LMFAO', 'OMG', 'WTF', 'IMO', 'IMHO', 'BTW', 'FYI', 'TBH',
    'IDK', 'SMH', 'NGL', 'BRO', 'SIS', 'FAM', 'ASAP', 'TBD', 'RN', 'FR',
    'GG', 'GL', 'HF', 'AFK', 'BRB', 'IRL', 'GOAT', 'FWIW', 'TLDR', 'TL',
    # Trading jargon
    'ATH', 'ATL', 'AH', 'PM', 'IV', 'OI', 'RSI', 'EMA', 'SMA', 'MACD',
    'VWAP', 'OTM', 'ITM', 'ATM', 'DTE', 'VOL', 'AVG', 'MAX', 'MIN', 'BID',
    'ASK', 'HIGH', 'OPEN', 'YOLO', 'FOMO', 'HODL', 'MOON', 'DIP', 'RIP',
    'CALLS', 'PUTS', 'CALL', 'PUT', 'LONG', 'SHORT', 'SELL', 'HOLD',
    # Places
    'USA', 'NYC', 'LA', 'UK', 'EU', 'US',
    # Misc
    'AI', 'CEO', 'CFO', 'COO', 'CTO', 'IPO', 'SEC', 'IRS', 'FBI', 'CIA',
    # Common words people use that are also tickers
    'LOVE', 'LIFE', 'CARE', 'HELP', 'HOME', 'HOPE', 'KIND', 'MIND', 'REAL',
    'TRUE', 'BABY', 'BEST', 'FAST', 'FREE', 'FULL', 'GLAD', 'GOES', 'GONE',
    'HARD', 'HUGE', 'IDEA', 'JOBS', 'KIDS', 'LATE', 'LESS', 'LIVE', 'LOST',
    'LUCK', 'MAIN', 'NICE', 'OPEN', 'PAID', 'PLAY', 'POOR', 'RISK', 'SAFE',
    'SICK', 'SURE', 'TALK', 'WAIT', 'WALK', 'WILD', 'WISE', 'GUYS', 'NUTS',
    'KINDA', 'ELON',  # Specific to chat
}

# Track tickers discovered via $ prefix this session
session_discovered = set()

# Tickers that are also common words - require $ or stock context
AMBIGUOUS_TICKERS = {
    # Common 3-letter words that are tickers
    'ALL', 'ARE', 'BIG', 'CAN', 'CAR', 'DAY', 'FUN', 'FOR', 'GAS', 'GOT',
    'HAS', 'HIT', 'HOT', 'KEY', 'LOW', 'MAN', 'MEN', 'NET', 'NOW', 'OLD',
    'ONE', 'OUT', 'OWN', 'PAY', 'RUN', 'SEE', 'SIX', 'TEN', 'THE', 'TOP',
    'TRY', 'TWO', 'WAY', 'WIN', 'WON', 'YOU',
    # Common 4+ letter words that are tickers  
    'ALLY', 'APPS', 'BALL', 'BAND', 'BILL', 'BLUE', 'BOOM', 'CARS', 'CASH',
    'COST', 'DECK', 'DISH', 'DOOR', 'EDIT', 'EYES', 'FACT', 'FAST', 'FIVE',
    'FLOW', 'FOOD', 'FORM', 'FREE', 'FUEL', 'FULL', 'FUND', 'GAME', 'GOOD',
    'GROW', 'HAND', 'HEAR', 'HELP', 'HERE', 'HOME', 'HOPE', 'IDEA', 'INFO',
    'JOBS', 'KIDS', 'KIND', 'KNOW', 'LAND', 'LAST', 'LAWS', 'LEAD', 'LIFE',
    'LINE', 'LIVE', 'LOOK', 'LOVE', 'LUCK', 'MAKE', 'MATH', 'MEAN', 'MEET',
    'MIND', 'MOVE', 'MUST', 'NEAR', 'NEED', 'NEWS', 'NEXT', 'NICE', 'OPEN',
    'PACK', 'PAID', 'PASS', 'PATH', 'PEAK', 'PLAY', 'PLUS', 'POST', 'PUSH',
    'RACE', 'RARE', 'RATE', 'READ', 'REAL', 'REST', 'RIDE', 'RING', 'RISE',
    'ROAD', 'ROCK', 'ROLL', 'ROOF', 'ROOM', 'SAFE', 'SAIL', 'SALE', 'SAVE',
    'SEED', 'SELF', 'SHIP', 'SHOP', 'SHOW', 'SICK', 'SIDE', 'SIGN', 'SITE',
    'SIZE', 'SNAP', 'SOLO', 'SONG', 'SOON', 'SOUL', 'SPOT', 'STAR', 'STAY',
    'STEP', 'STOP', 'TALK', 'TALL', 'TEAM', 'TECH', 'TELL', 'TEST', 'TEXT',
    'TICK', 'TIES', 'TIRE', 'TOWN', 'TREE', 'TRIP', 'TRUE', 'TURN', 'UNIT',
    'VERY', 'VIEW', 'VOID', 'VOTE', 'WAIT', 'WALK', 'WALL', 'WARM', 'WASH',
    'WAVE', 'WAYS', 'WEAR', 'WEEK', 'WELL', 'WEST', 'WIDE', 'WIFE', 'WILD',
    'WING', 'WIRE', 'WISE', 'WISH', 'WOOD', 'WORD', 'WORK', 'WRAP', 'YARD',
    'YEAR', 'ZERO', 'ZONE',
    # Specific problematic ones - common words that are tickers
    'BROS',  # Dutch Bros - but "bros" is slang
    'MARK',  # Remark Holdings - but "mark" is a common word/name
    'TELL',  # Tellurian - but "tell" is common
    'HEAR',  # Turtle Beach - but "hear" is common
    'DISH',  # Dish Network - but "dish" is common
    'TRIP',  # TripAdvisor - but "trip" is common  
}

# Tickers that are EXTREMELY common words - require $ prefix ONLY
# These are so common that even stock context isn't reliable
DOLLAR_ONLY_TICKERS = {
    # 2-letter words - way too common
    'DO', 'GO', 'ON', 'SO', 'IT', 'AT', 'BE', 'BY', 'OR', 'AN', 'AS', 'IF',
    'NO', 'UP', 'WE', 'HE', 'ME', 'TV',
    # Other extremely common words
    'A', 'I', 'U',  # Single letters sometimes used
    'AI',  # C3.ai ticker but "AI" is used constantly in tech chat
    'KO',  # Coca-Cola but also "knockout", "KO'd"
    'CAT',  # Caterpillar but "cat" is very common
    'DOG',  # Not a ticker but similar pattern
}

# Words that indicate stock context
STOCK_CONTEXT_WORDS = {
    'buy', 'buying', 'bought', 'sell', 'selling', 'sold', 'calls', 'call',
    'puts', 'put', 'shares', 'stock', 'stocks', 'price', 'trading', 'trade',
    'long', 'short', 'bullish', 'bearish', 'options', 'option', 'squeeze',
    'moon', 'pump', 'dump', 'dip', 'rip', 'breakout', 'earnings', 'er',
    'hold', 'holding', 'position', 'entry', 'exit', 'target', 'pt',
    'strike', 'exp', 'expiry', 'weekly', 'weeklies', 'leaps', 'spread',
    'portfolio', 'bag', 'bags', 'bagholder', 'avg', 'average',
    'profit', 'loss', 'gain', 'gains', 'tendies', 'yolo', 'fomo',
    'chart', 'ta', 'support', 'resistance', 'volume', 'float', 'si',
    'iv', 'oi', 'gamma', 'delta', 'theta', 'vega', 'greeks',
    'ripping', 'drilling', 'tanking', 'mooning', 'printing', 'sending',
    'weak', 'strong', 'green', 'red', 'bounce', 'fade', 'reversal',
    'oversold', 'overbought', 'undervalued', 'overvalued', 'cheap', 'expensive',
    'dividend', 'div', 'yield', 'pe', 'eps', 'revenue', 'guidance',
    'upgrade', 'downgrade', 'analyst', 'pt', 'rating', 'sector', 'etf',
    'rally', 'crash', 'correction', 'pullback', 'consolidation', 'channel',
    'ticker', 'symbol', 'stonk', 'stonks', 'invest', 'investing', 'investor',
}


def has_stock_context(text: str) -> bool:
    """Check if message has stock-related context words"""
    text_lower = text.lower()
    words = set(re.findall(r'\w+', text_lower))
    return bool(words & STOCK_CONTEXT_WORDS)


def extract_ticker(text: str) -> Optional[str]:
    """Extract ticker from text - context-aware approach"""
    text_upper = text.upper()
    
    # 1. $TICKER format - always trust it (highest priority)
    dollar_match = re.search(r'\$([A-Z]{1,5})\b', text_upper)
    if dollar_match:
        ticker = dollar_match.group(1)
        if ticker not in IGNORE_WORDS:
            session_discovered.add(ticker)
            return ticker
    
    # 2. Company name mapping - always trust
    for name, ticker in COMPANY_NAMES.items():
        if re.search(r'\b' + name + r'\b', text_upper):
            return ticker
    
    # 3. Find all potential tickers in message
    all_valid = KNOWN_TICKERS | session_discovered
    words = re.findall(r'\b([A-Z]{2,5})\b', text_upper)
    
    # First pass: look for UNAMBIGUOUS tickers (priority)
    # Skip both AMBIGUOUS_TICKERS and DOLLAR_ONLY_TICKERS
    for word in words:
        if word in IGNORE_WORDS:
            continue
        if word in DOLLAR_ONLY_TICKERS:
            continue  # These ONLY work with $ prefix
        if word in all_valid and word not in AMBIGUOUS_TICKERS:
            return word
    
    # Second pass: check ambiguous tickers (only if no unambiguous found)
    # Requires stock context words nearby
    has_context = has_stock_context(text)
    if has_context:
        for word in words:
            if word in IGNORE_WORDS:
                continue
            if word in DOLLAR_ONLY_TICKERS:
                continue  # These ONLY work with $ prefix, even with context
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
    'tendies', 'gains', 'bullish', 'lfg', 'letsgoo', 'bullrun', 'parabolic'
}

BEARISH_WORDS = {
    'sell', 'selling', 'sold', 'short', 'puts', 'put', 'bearish', 'dump',
    'dumping', 'crash', 'crashing', 'tank', 'tanking', 'drill', 'drilling',
    'red', 'down', 'lower', 'weak', 'resistance', 'rejection', 'fade',
    'overvalued', 'expensive', 'bubble', 'top', 'topped', 'rug', 'rugged',
    'rekt', 'trapped', 'baghold', 'bagholder', 'dead', 'cliff', 'sink',
    'capitulate', 'capitulation', 'bloodbath', 'slaughter'
}

# Question detection patterns - smarter heuristics
QUESTION_PATTERNS = [
    r'\?',                                              # Any question mark
    r'^(what|when|where|why|how|is|are|do|does|will|should|can|could|would|any)\b',  # Starts with question word
    r'\b(what|which|who).*\b(is|are|should|would|do)\b',  # "what is", "which should"
    r'\b(thoughts|opinion|think|reckon)\b.*\b(on|about)\b',  # "thoughts on X"
    r'\bgood\s+(price|entry|time|level|spot)\b',        # "good entry point"
    r'\b(should|would)\s+(i|we|you)\b',                 # "should I buy"
    r'\b(buy|sell|hold)\s+(or|now)\b',                  # "buy or sell", "buy now"
    r'\bworth\s+(it|buying|holding)\b',                 # "worth it", "worth buying"
    r'\bany\s+(news|update|thoughts)\b',                # "any news on"
    r'\bentry\s*(point|price|level)?\b',                # "entry point"
    r'\btarget\s*(price)?\b.*\bfor\b',                 # "target price for"
    r'\bpt\b.*\bfor\b',                                 # "PT for NVDA"
]
QUESTION_PATTERN = re.compile('|'.join(QUESTION_PATTERNS), re.IGNORECASE)


# ============== SPAM DETECTION ==============

# User message history for duplicate/rate detection
# Structure: {author: [(timestamp, text_hash), ...]}
user_message_history = {}
HISTORY_WINDOW = 60  # seconds to keep history
MAX_HISTORY_PER_USER = 20

# Spam link patterns
SPAM_LINK_PATTERNS = [
    r'discord\.gg/', r't\.me/', r'bit\.ly/', r'tinyurl\.com/',
    r'telegram\.', r'whatsapp\.', r'signal\.group/',
    r'join.*group', r'join.*channel', r'join.*server',
    r'click.*link', r'check.*bio', r'link.*bio',
    r'dm.*me', r'dm.*for', r'message.*me',
]
SPAM_LINK_RE = re.compile('|'.join(SPAM_LINK_PATTERNS), re.IGNORECASE)

# Pump/promo phrases
SPAM_PUMP_PHRASES = [
    r'guaranteed.*gains', r'100x', r'1000x', r'10x.*guaranteed',
    r'free.*money', r'free.*crypto', r'free.*bitcoin',
    r'airdrop', r'giveaway.*crypto', r'send.*eth', r'send.*btc',
    r'double.*your', r'triple.*your', r'10x.*your',
    r'insider.*info', r'insider.*tip', r'trust.*me.*bro',
    r'financial.*freedom', r'quit.*job', r'passive.*income',
    r'limited.*spots', r'act.*now', r'hurry.*up',
    r'once.*lifetime', r'cant.*miss', r"can't.*miss",
    r'get.*rich', r'millionaire', r'lambo',
    r'pump.*coming', r'moon.*guaranteed', r'easy.*money',
    r'secret.*strategy', r'they.*dont.*want',
    r'subscribe.*my', r'follow.*my', r'check.*my.*channel',
]
SPAM_PUMP_RE = re.compile('|'.join(SPAM_PUMP_PHRASES), re.IGNORECASE)

# Crypto scam patterns
SPAM_CRYPTO_SCAM = [
    r'send.*\d+.*eth', r'send.*\d+.*btc', r'send.*\d+.*sol',
    r'wallet.*address', r'connect.*wallet',
    r'validate.*wallet', r'sync.*wallet',
    r'claim.*reward', r'claim.*token', r'claim.*airdrop',
]
SPAM_CRYPTO_RE = re.compile('|'.join(SPAM_CRYPTO_SCAM), re.IGNORECASE)


def clean_history(author: str, current_time: float):
    """Remove old entries from user history"""
    if author in user_message_history:
        user_message_history[author] = [
            (ts, h) for ts, h in user_message_history[author]
            if current_time - ts < HISTORY_WINDOW
        ][-MAX_HISTORY_PER_USER:]


def detect_spam(text: str, author: str) -> dict:
    """
    Detect spam using rule-based heuristics.
    Returns: {'is_spam': bool, 'reason': str or None, 'confidence': float}
    """
    current_time = datetime.now().timestamp()
    clean_history(author, current_time)
    
    text_lower = text.lower()
    text_hash = hash(text_lower.strip())
    reasons = []
    confidence = 0.0
    
    # 1. Duplicate message detection (same user, same text)
    if author in user_message_history:
        recent_hashes = [h for _, h in user_message_history[author]]
        if text_hash in recent_hashes:
            reasons.append('duplicate')
            confidence = max(confidence, 0.9)
    
    # 2. Rapid-fire detection (>3 messages in 10 seconds)
    if author in user_message_history:
        recent_timestamps = [ts for ts, _ in user_message_history[author]]
        recent_10s = [ts for ts in recent_timestamps if current_time - ts < 10]
        if len(recent_10s) >= 3:
            reasons.append('rapid_fire')
            confidence = max(confidence, 0.8)
    
    # 3. Link spam
    if SPAM_LINK_RE.search(text):
        reasons.append('promo_link')
        confidence = max(confidence, 0.85)
    
    # 4. Pump/promo phrases
    if SPAM_PUMP_RE.search(text):
        reasons.append('pump_promo')
        confidence = max(confidence, 0.8)
    
    # 5. Crypto scam patterns
    if SPAM_CRYPTO_RE.search(text):
        reasons.append('crypto_scam')
        confidence = max(confidence, 0.95)
    
    # 6. Excessive caps (>70% caps, min 10 chars)
    alpha_chars = [c for c in text if c.isalpha()]
    if len(alpha_chars) >= 10:
        caps_ratio = sum(1 for c in alpha_chars if c.isupper()) / len(alpha_chars)
        if caps_ratio > 0.7:
            reasons.append('excessive_caps')
            confidence = max(confidence, 0.5)  # Lower confidence, caps alone isn't definitive
    
    # 7. Repetitive characters (e.g., "BUYYYYYYY" or "🚀🚀🚀🚀🚀🚀🚀🚀")
    # 5+ of same char in a row
    if re.search(r'(.)\1{4,}', text):
        reasons.append('repetitive_chars')
        confidence = max(confidence, 0.4)  # Low confidence alone
    
    # 8. Excessive emojis (>10 emojis)
    emoji_count = len([c for c in text if c in emoji.EMOJI_DATA])
    if emoji_count > 10:
        reasons.append('excessive_emojis')
        confidence = max(confidence, 0.5)
    
    # Store in history
    if author not in user_message_history:
        user_message_history[author] = []
    user_message_history[author].append((current_time, text_hash))
    
    # Combine weak signals
    if len(reasons) >= 2 and confidence < 0.7:
        confidence = min(0.75, confidence + 0.2)
    
    is_spam = confidence >= 0.7
    
    return {
        'is_spam': is_spam,
        'reason': reasons[0] if reasons else None,
        'reasons': reasons,
        'confidence': round(confidence, 2)
    }


async def llm_spam_check(text: str) -> bool:
    """Fallback LLM check for borderline cases (confidence 0.5-0.7)"""
    prompt = f"""Is this YouTube chat message spam, promotion, or bot-generated?
Look for: self-promotion, scams, meaningless repetition, bot patterns.

Message: "{text}"

Reply with ONLY: yes or no"""
    
    try:
        async with httpx.AsyncClient(timeout=3.0) as client:
            response = await client.post(OLLAMA_URL, json={
                "model": OLLAMA_MODEL,
                "prompt": prompt,
                "stream": False,
                "options": {"temperature": 0}
            })
            result = response.json()["response"].strip().lower()
            return "yes" in result
    except Exception as e:
        print(f"LLM spam check error: {e}")
        return False


# ============== CHAT PULSE SUMMARIES ==============

async def generate_pulse_summary(messages: list) -> dict:
    """
    Generate a brief summary of recent chat activity.
    Returns: {'mood': str, 'topics': str, 'vibe': str, 'highlight': str}
    """
    if not messages:
        return None
    
    # Build context from messages
    texts = [m['text'] for m in messages[-PULSE_MESSAGE_WINDOW:]]
    tickers = [m['topic'] for m in messages if m.get('topic')]
    sentiments = [m['sentiment'] for m in messages if m.get('sentiment') != 'neutral']
    
    # Count tickers and sentiments
    ticker_counts = {}
    for t in tickers:
        ticker_counts[t] = ticker_counts.get(t, 0) + 1
    top_tickers = sorted(ticker_counts.items(), key=lambda x: -x[1])[:3]
    
    bullish_count = sentiments.count('bullish')
    bearish_count = sentiments.count('bearish')
    
    # Build prompt
    sample_msgs = "\n".join(texts[-30:])  # Last 30 messages for context
    ticker_summary = ", ".join([f"{t}({c})" for t, c in top_tickers]) if top_tickers else "none"
    sentiment_summary = f"{bullish_count} bullish, {bearish_count} bearish"
    
    prompt = f"""Summarize this YouTube live chat in ONE short sentence (under 15 words).
Capture the overall mood and what people are talking about.

Top tickers mentioned: {ticker_summary}
Sentiment: {sentiment_summary}

Recent messages:
{sample_msgs}

Write a brief, casual summary like:
- "Bullish energy on NVDA, everyone waiting for earnings"
- "Mixed feelings, lots of jokes about Jerome Powell"
- "Quiet chat, mostly questions about entry points"

Summary:"""
    
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(OLLAMA_URL, json={
                "model": OLLAMA_MODEL,
                "prompt": prompt,
                "stream": False,
                "options": {"temperature": 0.7}  # Slight creativity
            })
            summary = response.json()["response"].strip()
            # Clean up the response
            summary = summary.replace('"', '').strip()
            if summary.startswith('-'):
                summary = summary[1:].strip()
            # Truncate if too long
            if len(summary) > 80:
                summary = summary[:77] + "..."
            
            # Determine mood emoji
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
    except Exception as e:
        print(f"Pulse generation error: {e}")
        return None


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


# ============== VIBE CLASSIFICATION ==============

async def classify_vibe_single(text: str) -> Optional[str]:
    """Classify a single message using local Ollama"""
    prompt = f"""Classify this YouTube chat message into EXACTLY ONE category:
- funny: jokes, humor, laughter (lmao, haha, 😂, etc.)
- uplifting: encouragement, positivity, support
- none: neutral, questions, or anything else

Message: "{text}"

Reply with ONLY one word: funny, uplifting, or none"""
    
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.post(OLLAMA_URL, json={
                "model": OLLAMA_MODEL,
                "prompt": prompt,
                "stream": False,
                "options": {"temperature": 0}
            })
            result = response.json()["response"].strip().lower()
            # Extract classification word
            for word in ["funny", "uplifting", "none"]:
                if word in result:
                    return word if word != "none" else None
    except Exception as e:
        print(f"Ollama classification error: {e}")
    return None


async def classify_vibe_batch(messages: list) -> list:
    """Classify messages using local Ollama (processes in parallel)"""
    if not messages:
        return messages
    
    # Process up to 10 messages concurrently
    tasks = [classify_vibe_single(msg['text']) for msg in messages[:10]]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    for i, (msg, vibe) in enumerate(zip(messages[:10], results)):
        if isinstance(vibe, str) and vibe in ('funny', 'uplifting'):
            msg['vibe'] = vibe
    
    return messages


def convert_emoji_codes(text: str) -> str:
    """Convert YouTube emoji codes like :rolling_on_floor_laughing: to actual emojis"""
    
    # YouTube-specific emoji mapping (covers most common ones)
    yt_emoji_map = {
        # Faces - laughing/happy
        ':rolling_on_floor_laughing:': '🤣',
        ':face_with_tears_of_joy:': '😂',
        ':grinning_face:': '😀',
        ':grinning_face_with_big_eyes:': '😃',
        ':grinning_face_with_smiling_eyes:': '😄',
        ':beaming_face_with_smiling_eyes:': '😁',
        ':grinning_squinting_face:': '😆',
        ':smiling_face_with_halo:': '😇',
        ':slightly_smiling_face:': '🙂',
        ':upside_down_face:': '🙃',
        ':winking_face:': '😉',
        ':relieved_face:': '😌',
        ':smiling_face_with_heart_eyes:': '😍',
        ':smiling_face_with_hearts:': '🥰',
        ':face_blowing_a_kiss:': '😘',
        ':kissing_face:': '😗',
        ':kissing_face_with_closed_eyes:': '😚',
        ':kissing_face_with_smiling_eyes:': '😙',
        ':star_struck:': '🤩',
        ':partying_face:': '🥳',
        ':smiling_face_with_sunglasses:': '😎',
        ':nerd_face:': '🤓',
        ':face_with_monocle:': '🧐',
        # Faces - thinking/neutral
        ':thinking_face:': '🤔',
        ':thinking:': '🤔',
        ':face_with_raised_eyebrow:': '🤨',
        ':neutral_face:': '😐',
        ':expressionless_face:': '😑',
        ':face_without_mouth:': '😶',
        ':face_with_rolling_eyes:': '🙄',
        ':smirking_face:': '😏',
        ':persevering_face:': '😣',
        ':confused_face:': '😕',
        ':worried_face:': '😟',
        ':slightly_frowning_face:': '🙁',
        ':frowning_face:': '☹️',
        # Faces - sad/crying
        ':loudly_crying_face:': '😭',
        ':crying_face:': '😢',
        ':disappointed_face:': '😞',
        ':sad_but_relieved_face:': '😥',
        ':pleading_face:': '🥺',
        # Faces - angry/negative
        ':angry_face:': '😠',
        ':pouting_face:': '😡',
        ':face_with_symbols_on_mouth:': '🤬',
        ':skull:': '💀',
        ':skull_and_crossbones:': '☠️',
        # Faces - sick/tired
        ':hot_face:': '🥵',
        ':cold_face:': '🥶',
        ':woozy_face:': '🥴',
        ':dizzy_face:': '😵',
        ':face_with_spiral_eyes:': '😵‍💫',
        ':exploding_head:': '🤯',
        ':face_vomiting:': '🤮',
        ':sneezing_face:': '🤧',
        ':sleeping_face:': '😴',
        ':sleepy_face:': '😪',
        ':drooling_face:': '🤤',
        # Faces - misc
        ':zany_face:': '🤪',
        ':shushing_face:': '🤫',
        ':lying_face:': '🤥',
        ':grimacing_face:': '😬',
        ':anxious_face_with_sweat:': '😰',
        ':face_screaming_in_fear:': '😱',
        ':fearful_face:': '😨',
        ':astonished_face:': '😲',
        ':flushed_face:': '😳',
        ':clown_face:': '🤡',
        ':clown:': '🤡',
        ':pile_of_poo:': '💩',
        ':poop:': '💩',
        # Gestures/hands
        ':thumbs_up:': '👍',
        ':thumbsup:': '👍',
        ':+1:': '👍',
        ':thumbs_down:': '👎',
        ':thumbsdown:': '👎',
        ':-1:': '👎',
        ':raised_hands:': '🙌',
        ':clapping_hands:': '👏',
        ':folded_hands:': '🙏',
        ':pray:': '🙏',
        ':handshake:': '🤝',
        ':ok_hand:': '👌',
        ':victory_hand:': '✌️',
        ':crossed_fingers:': '🤞',
        ':love_you_gesture:': '🤟',
        ':sign_of_the_horns:': '🤘',
        ':call_me_hand:': '🤙',
        ':backhand_index_pointing_left:': '👈',
        ':backhand_index_pointing_right:': '👉',
        ':backhand_index_pointing_up:': '👆',
        ':backhand_index_pointing_down:': '👇',
        ':middle_finger:': '🖕',
        ':raised_fist:': '✊',
        ':oncoming_fist:': '👊',
        ':flexed_biceps:': '💪',
        ':muscle:': '💪',
        ':writing_hand:': '✍️',
        ':eyes:': '👀',
        ':eye:': '👁️',
        ':brain:': '🧠',
        # Hearts/love
        ':red_heart:': '❤️',
        ':heart:': '❤️',
        ':orange_heart:': '🧡',
        ':yellow_heart:': '💛',
        ':green_heart:': '💚',
        ':blue_heart:': '💙',
        ':purple_heart:': '💜',
        ':black_heart:': '🖤',
        ':white_heart:': '🤍',
        ':broken_heart:': '💔',
        ':sparkling_heart:': '💖',
        ':heart_on_fire:': '❤️‍🔥',
        ':two_hearts:': '💕',
        ':revolving_hearts:': '💞',
        ':heartbeat:': '💓',
        ':heartpulse:': '💗',
        ':growing_heart:': '💗',
        ':heart_exclamation:': '❣️',
        # Symbols/misc
        ':fire:': '🔥',
        ':flame:': '🔥',
        ':sparkles:': '✨',
        ':star:': '⭐',
        ':glowing_star:': '🌟',
        ':dizzy:': '💫',
        ':collision:': '💥',
        ':boom:': '💥',
        ':lightning:': '⚡',
        ':zap:': '⚡',
        ':high_voltage:': '⚡',
        ':snowflake:': '❄️',
        ':cloud:': '☁️',
        ':sun:': '☀️',
        ':sunny:': '☀️',
        ':rainbow:': '🌈',
        ':moon:': '🌙',
        ':full_moon:': '🌕',
        ':new_moon_face:': '🌚',
        ':full_moon_face:': '🌝',
        ':hundred_points:': '💯',
        ':100:': '💯',
        ':check_mark:': '✔️',
        ':check_mark_button:': '✅',
        ':cross_mark:': '❌',
        ':x:': '❌',
        ':warning:': '⚠️',
        ':no_entry:': '⛔',
        ':exclamation:': '❗',
        ':question:': '❓',
        ':red_question_mark:': '❓',
        # Objects - money
        ':money_bag:': '💰',
        ':moneybag:': '💰',
        ':money_with_wings:': '💸',
        ':dollar:': '💵',
        ':dollar_banknote:': '💵',
        ':yen_banknote:': '💴',
        ':euro_banknote:': '💶',
        ':pound_banknote:': '💷',
        ':gem:': '💎',
        ':gem_stone:': '💎',
        ':coin:': '🪙',
        ':chart_increasing:': '📈',
        ':chart_decreasing:': '📉',
        # Objects - misc
        ':rocket:': '🚀',
        ':airplane:': '✈️',
        ':red_circle:': '🔴',
        ':orange_circle:': '🟠',
        ':yellow_circle:': '🟡',
        ':green_circle:': '🟢',
        ':blue_circle:': '🔵',
        ':purple_circle:': '🟣',
        ':white_circle:': '⚪',
        ':black_circle:': '⚫',
        ':trophy:': '🏆',
        ':medal:': '🏅',
        ':crown:': '👑',
        ':bell:': '🔔',
        ':megaphone:': '📣',
        ':loudspeaker:': '📢',
        # Animals
        ':bear:': '🐻',
        ':bear_face:': '🐻',
        ':bull:': '🐂',
        ':ox:': '🐂',
        ':cow_face:': '🐮',
        ':cow:': '🐄',
        ':gorilla:': '🦍',
        ':ape:': '🦍',
        ':monkey:': '🐒',
        ':monkey_face:': '🐵',
        ':dog:': '🐕',
        ':dog_face:': '🐶',
        ':cat:': '🐈',
        ':cat_face:': '🐱',
        ':unicorn:': '🦄',
        ':unicorn_face:': '🦄',
        ':dragon:': '🐉',
        ':dragon_face:': '🐲',
        ':snake:': '🐍',
        ':eagle:': '🦅',
        ':shark:': '🦈',
        ':whale:': '🐋',
        ':dolphin:': '🐬',
        ':turtle:': '🐢',
        ':frog:': '🐸',
        ':frog_face:': '🐸',
        ':butterfly:': '🦋',
        ':bee:': '🐝',
        ':honeybee:': '🐝',
        # Food/drink
        ':beer:': '🍺',
        ':beers:': '🍻',
        ':wine_glass:': '🍷',
        ':cocktail:': '🍸',
        ':champagne:': '🍾',
        ':coffee:': '☕',
        ':popcorn:': '🍿',
        ':pizza:': '🍕',
        ':hamburger:': '🍔',
        ':taco:': '🌮',
        ':hot_dog:': '🌭',
    }
    
    # First apply our manual map
    for code, emj in yt_emoji_map.items():
        text = text.replace(code, emj)
    
    # Then try emoji library for any remaining :code: patterns
    # Try multiple emoji library formats
    text = emoji.emojize(text, language='alias')  # :thumbsup: style
    text = emoji.emojize(text, language='en')     # :thumbs_up: style
    
    # Fallback: try to catch any remaining :word_word: patterns and convert underscores
    import re
    remaining = re.findall(r'(:[a-z_]+:)', text)
    for code in remaining:
        # Try without underscores
        alt_code = code.replace('_', '')
        converted = emoji.emojize(alt_code, language='alias')
        if converted != alt_code:  # Successfully converted
            text = text.replace(code, converted)
    
    return text


# ============== MESSAGE PROCESSING ==============

def process_message(chat_msg) -> dict:
    text = convert_emoji_codes(chat_msg.message)  # Convert emoji codes to actual emojis
    author = chat_msg.author.name
    
    # Check for spam first
    spam_result = detect_spam(text, author)
    
    result = {
        'text': text,
        'author': author,
        'timestamp': datetime.now().isoformat(),
        'topic': extract_ticker(text),
        'sentiment': 'neutral',
        'isQuestion': is_question(text),
        'vibe': None,
        'spam': spam_result
    }
    if result['topic']:
        result['sentiment'] = analyze_sentiment(text)
    return result


# ============== WEBSOCKET SERVER ==============

async def broadcast(message: dict):
    if connected_clients:
        msg_json = json.dumps(message)
        await asyncio.gather(
            *[c.send(msg_json) for c in connected_clients],
            return_exceptions=True
        )


async def handle_client(websocket):
    connected_clients.add(websocket)
    print(f"Client connected. Total: {len(connected_clients)}")
    try:
        await websocket.send(json.dumps({
            'type': 'connected',
            'message': 'Connected to chat visualization backend'
        }))
        async for message in websocket:
            data = json.loads(message)
            print(f"Received: {data}")
    except websockets.exceptions.ConnectionClosed:
        pass
    finally:
        connected_clients.remove(websocket)
        print(f"Client disconnected. Total: {len(connected_clients)}")


# ============== YOUTUBE SCRAPER ==============

async def scrape_youtube_chat(video_url: str):
    print(f"Connecting to YouTube chat: {video_url}")
    try:
        chat = pytchat.create(video_id=extract_video_id(video_url))
        print("Connected to YouTube chat!")
        print(f"Tracking {len(KNOWN_TICKERS)} tickers")
        
        vibe_batch = []
        last_vibe_check = asyncio.get_event_loop().time()
        
        spam_count = 0
        msg_count = 0
        
        # Pulse tracking
        last_pulse_time = asyncio.get_event_loop().time()
        pulse_buffer = []  # Messages since last pulse
        
        while chat.is_alive():
            for c in chat.get().sync_items():
                processed = process_message(c)
                msg_count += 1
                
                # Filter spam
                spam_info = processed.get('spam', {})
                if spam_info.get('is_spam'):
                    spam_count += 1
                    # Log spam for debugging (every 10th)
                    if spam_count % 10 == 1:
                        print(f"[SPAM {spam_count}] {spam_info['reason']}: {processed['text'][:50]}...")
                    continue  # Skip spam messages entirely
                
                # Borderline case (0.5-0.7 confidence) - use LLM
                if spam_info.get('confidence', 0) >= 0.5:
                    if await llm_spam_check(processed['text']):
                        spam_count += 1
                        continue
                
                # Process non-spam messages
                if processed['topic'] or processed['isQuestion']:
                    await broadcast({'type': 'message', 'data': processed})
                vibe_batch.append(processed)
                pulse_buffer.append(processed)  # Add to pulse buffer
            
            current_time = asyncio.get_event_loop().time()
            
            # Vibe classification (every 3 seconds)
            if current_time - last_vibe_check >= 3 and vibe_batch:
                # Only classify non-spam messages for vibes
                classified = await classify_vibe_batch(vibe_batch[-20:])
                for msg in classified:
                    if msg.get('vibe'):
                        await broadcast({'type': 'vibe', 'data': msg})
                vibe_batch = []
                last_vibe_check = current_time
                
                # Periodic stats
                if msg_count > 0:
                    spam_pct = (spam_count / msg_count) * 100
                    print(f"[STATS] {msg_count} msgs, {spam_count} spam ({spam_pct:.1f}%)")
            
            # Pulse summary generation (every PULSE_INTERVAL seconds)
            if current_time - last_pulse_time >= PULSE_INTERVAL and len(pulse_buffer) >= 10:
                print(f"[PULSE] Generating summary from {len(pulse_buffer)} messages...")
                pulse = await generate_pulse_summary(pulse_buffer)
                if pulse:
                    print(f"[PULSE] {pulse['mood']} {pulse['summary']}")
                    await broadcast({'type': 'pulse', 'data': pulse})
                pulse_buffer = []  # Reset buffer
                last_pulse_time = current_time
            
            await asyncio.sleep(0.5)
    except Exception as e:
        print(f"YouTube chat error: {e}")
        await broadcast({'type': 'error', 'message': str(e)})


def extract_video_id(url: str) -> str:
    patterns = [
        r'(?:v=|/v/|youtu\.be/)([^&?\s]+)',
        r'(?:embed/)([^&?\s]+)',
        r'^([a-zA-Z0-9_-]{11})$'
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return url


async def main(video_url: str):
    print(f"Starting backend on port {WEBSOCKET_PORT}")
    async with serve(handle_client, "0.0.0.0", WEBSOCKET_PORT):
        print(f"WebSocket: ws://0.0.0.0:{WEBSOCKET_PORT}")
        await scrape_youtube_chat(video_url)


if __name__ == "__main__":
    import sys
    if len(sys.argv) < 2:
        print("Usage: python chat_viz_backend.py <youtube_live_url>")
        sys.exit(1)
    asyncio.run(main(sys.argv[1]))
