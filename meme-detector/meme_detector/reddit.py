import re
import time
import requests
from datetime import datetime, timedelta
from collections import defaultdict

from .config import SUBREDDITS, SUBREDDIT_WEIGHTS, FILTER_WORDS, REDDIT_HEADERS


class RedditScanner:
    def __init__(self, subreddits=None):
        self.subreddits = subreddits or SUBREDDITS
        self.session = requests.Session()
        self.session.headers.update(REDDIT_HEADERS)

    def _fetch_posts(self, subreddit, limit=100):
        posts = []
        for sort in ['hot', 'new']:
            url = f'https://www.reddit.com/r/{subreddit}/{sort}.json?limit={limit}'
            try:
                resp = self.session.get(url, timeout=15)
                if resp.status_code == 200:
                    data = resp.json()
                    posts.extend(data['data']['children'])
                elif resp.status_code == 429:
                    time.sleep(5)
                time.sleep(0.75)  # respect Reddit rate limits
            except Exception:
                pass
        return posts

    def _extract_tickers(self, text):
        tickers = set()
        upper = text.upper()

        # $TICKER pattern is the most reliable signal
        dollar_tickers = re.findall(r'\$([A-Z]{1,5})\b', upper)
        tickers.update(dollar_tickers)

        # Standalone ALL-CAPS words (2-5 chars), filtered against common words
        standalone = re.findall(r'(?<![A-Z$])([A-Z]{2,5})(?![A-Z])', upper)
        for word in standalone:
            if word not in FILTER_WORDS and not word.isdigit():
                tickers.add(word)

        return tickers

    def scan(self, verbose=False):
        """Scan subreddits, return {ticker: mention_data} sorted by 24h activity."""
        now = datetime.utcnow()
        cutoff_24h = now - timedelta(hours=24)
        cutoff_7d = now - timedelta(days=7)

        mention_data = defaultdict(lambda: {
            'mentions_24h': 0.0,
            'mentions_7d': 0.0,
            'upvotes_24h': 0,
            'subreddits': set(),
        })

        for subreddit in self.subreddits:
            weight = SUBREDDIT_WEIGHTS.get(subreddit, 1.0)
            if verbose:
                print(f"  Scanning r/{subreddit}...")
            posts = self._fetch_posts(subreddit)

            for wrapper in posts:
                post = wrapper['data']
                post_time = datetime.utcfromtimestamp(post['created_utc'])

                text = f"{post.get('title', '')} {post.get('selftext', '')}"
                tickers = self._extract_tickers(text)
                post_score = max(1, post.get('score', 1))

                for ticker in tickers:
                    if post_time > cutoff_7d:
                        mention_data[ticker]['mentions_7d'] += weight
                        mention_data[ticker]['subreddits'].add(subreddit)
                    if post_time > cutoff_24h:
                        mention_data[ticker]['mentions_24h'] += weight
                        mention_data[ticker]['upvotes_24h'] += post_score

        return dict(
            sorted(mention_data.items(), key=lambda x: x[1]['mentions_24h'], reverse=True)
        )
