SUBREDDITS = [
    'wallstreetbets',
    'Shortsqueeze',
    'smallstreetbets',
    'stocks',
    'pennystocks',
]

SUBREDDIT_WEIGHTS = {
    'wallstreetbets': 3.0,
    'Shortsqueeze': 2.5,
    'smallstreetbets': 2.0,
    'pennystocks': 1.5,
    'stocks': 1.0,
    'investing': 0.8,
}

# Words to never treat as tickers
FILTER_WORDS = {
    # Single/double letters
    'A', 'I', 'AN', 'AS', 'AT', 'BE', 'BY', 'DO', 'GO', 'HE', 'IF',
    'IN', 'IS', 'IT', 'ME', 'MY', 'NO', 'OF', 'ON', 'OR', 'SO', 'TO',
    'UP', 'US', 'WE', 'AM', 'PM', 'RE', 'OK', 'HI', 'HA', 'OH', 'MY',
    # Common 3-letter words
    'THE', 'AND', 'FOR', 'ARE', 'BUT', 'NOT', 'YOU', 'ALL', 'CAN',
    'HAS', 'HER', 'WAS', 'ONE', 'OUR', 'OUT', 'DAY', 'GET', 'HIM',
    'HOW', 'ITS', 'NEW', 'NOW', 'OLD', 'SEE', 'TWO', 'WAY', 'WHO',
    'BOY', 'DID', 'HIS', 'LET', 'MAN', 'PUT', 'SAY', 'SHE', 'TOO',
    'USE', 'HAD', 'HIT', 'HOT', 'LET', 'OFF', 'OWN', 'RUN', 'TRY',
    'WIN', 'YET', 'AGO', 'ASK', 'BIG', 'FAR', 'FEW', 'GOT', 'GUY',
    'HER', 'SET', 'SIT', 'SIX', 'TEN', 'TIP', 'TOP', 'VIA', 'WIN',
    # Common 4-letter words
    'THAT', 'HAVE', 'THIS', 'WILL', 'YOUR', 'FROM', 'THEY', 'KNOW',
    'WANT', 'BEEN', 'GOOD', 'MUCH', 'SOME', 'TIME', 'VERY', 'WHEN',
    'COME', 'HERE', 'JUST', 'LIKE', 'LONG', 'MAKE', 'MANY', 'MORE',
    'ONLY', 'OVER', 'SUCH', 'TAKE', 'THAN', 'THEM', 'WELL', 'WERE',
    'WITH', 'ALSO', 'BACK', 'EVEN', 'FIND', 'GIVE', 'LOOK', 'MOST',
    'NEED', 'NEXT', 'SAME', 'SEEM', 'SHOW', 'TURN', 'WEEK', 'YEAR',
    'CALL', 'DOWN', 'EACH', 'DOES', 'FEEL', 'HOLD', 'KEEP', 'LAST',
    'LEFT', 'LIFE', 'LIVE', 'MOVE', 'MUST', 'OPEN', 'PART', 'PLAY',
    'READ', 'REAL', 'SAID', 'TELL', 'THEN', 'TOLD', 'USED', 'WENT',
    'WORK', 'CASE', 'HAND', 'HIGH', 'HOME', 'IDEA', 'INTO', 'KIND',
    'LAND', 'LINE', 'MEAN', 'MIND', 'NAME', 'NEAR', 'ONCE', 'PAST',
    'PLAN', 'ROOM', 'SHOW', 'SIDE', 'SIGN', 'SOON', 'SURE', 'TALK',
    'UPON', 'VIEW', 'WAIT', 'WALK', 'WORD', 'ABLE',
    # Finance non-ticker abbreviations
    'IPO', 'SEC', 'FDA', 'ETF', 'EPS', 'GDP', 'ATH', 'ATL', 'EOD',
    'EOW', 'YTD', 'YOLO', 'FOMO', 'DD', 'WSB', 'OTC', 'CNBC',
    'USD', 'BOJ', 'ECB', 'FED', 'CPI', 'PPI', 'CEO', 'CFO',
    'CTO', 'COO', 'PUTS', 'CALLS', 'LOL', 'OMG', 'WTF', 'BUY',
    'SELL', 'HOLD', 'MOON', 'REKT', 'LOSS', 'GAIN', 'BULL', 'BEAR',
    'PUMP', 'DUMP', 'NEWS', 'OPEN', 'CLOSE', 'AVG', 'RSI', 'MACD',
    'VWAP', 'LEAPS', 'ITM', 'OTM', 'ATM', 'DTE', 'WSJ', 'TLDR',
    'EDIT', 'IMO', 'IIRC', 'AFAIK', 'FWIW', 'TIL', 'NYSE', 'AMEX',
    'Q1', 'Q2', 'Q3', 'Q4', 'H1', 'H2', 'FY', 'YOY', 'QOQ', 'MOM',
    'FCF', 'DCF', 'NPV', 'IRR', 'CAGR', 'LMAO', 'SMH', 'APES',
    'TECH', 'CORP', 'INC', 'LLC', 'LTD', 'FUND', 'BANK',
    'CPU', 'GPU', 'RAM', 'SSD', 'API', 'URL', 'PDF',
    'NASDAQ', 'CALLS', 'PUTS', 'LONG', 'SHORT',
}

SCORE_WEIGHTS = {
    'reddit_buzz': 0.30,
    'short_squeeze': 0.25,
    'volume_surge': 0.25,
    'momentum': 0.10,
    'accessibility': 0.10,
}

REDDIT_HEADERS = {
    'User-Agent': 'MemeStockDetector/1.0 (educational research tool)',
}

# Minimum thresholds to consider a ticker valid
MIN_PRICE = 0.10
MAX_PRICE_FOR_ACCESSIBILITY = 500.0
