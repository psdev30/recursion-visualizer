import yfinance as yf
from concurrent.futures import ThreadPoolExecutor, as_completed

from .config import MIN_PRICE


class StockAnalyzer:
    def _fetch(self, ticker):
        try:
            stock = yf.Ticker(ticker)
            info = stock.info

            price = (
                info.get('regularMarketPrice')
                or info.get('currentPrice')
                or info.get('navPrice')
            )
            if not price or price < MIN_PRICE:
                return None

            hist = stock.history(period='35d')
            if hist.empty or len(hist) < 3:
                return None

            avg_vol_30d = hist['Volume'].mean()
            vol_today = hist['Volume'].iloc[-1]
            volume_ratio = (vol_today / avg_vol_30d) if avg_vol_30d > 0 else 0

            def momentum(days):
                if len(hist) > days:
                    past = hist['Close'].iloc[-(days + 1)]
                    return ((price - past) / past) * 100 if past > 0 else 0
                return 0

            shares_short = info.get('sharesShort') or 0
            float_shares = info.get('floatShares') or info.get('sharesOutstanding') or 0
            short_float_pct = (shares_short / float_shares * 100) if float_shares > 0 else 0

            call_put_ratio = None
            try:
                dates = stock.options
                if dates:
                    chain = stock.option_chain(dates[0])
                    call_oi = chain.calls['openInterest'].sum()
                    put_oi = chain.puts['openInterest'].sum()
                    if put_oi > 0:
                        call_put_ratio = call_oi / put_oi
            except Exception:
                pass

            return {
                'ticker': ticker,
                'name': info.get('shortName') or ticker,
                'price': price,
                'change_today_pct': info.get('regularMarketChangePercent') or 0,
                'market_cap': info.get('marketCap') or 0,
                'float_shares': float_shares,
                'avg_volume_30d': avg_vol_30d,
                'volume_today': vol_today,
                'volume_ratio': volume_ratio,
                'short_float_pct': short_float_pct,
                'days_to_cover': info.get('shortRatio') or 0,
                'momentum_1w': momentum(5),
                'momentum_2w': momentum(10),
                'call_put_ratio': call_put_ratio,
                'sector': info.get('sector') or 'Unknown',
                'has_options': bool(call_put_ratio is not None),
                '52w_high': info.get('fiftyTwoWeekHigh') or 0,
                '52w_low': info.get('fiftyTwoWeekLow') or 0,
                'reddit_mentions': {},  # populated by caller when doing Reddit scan
            }
        except Exception:
            return None

    def analyze_batch(self, tickers, max_workers=8):
        results = {}
        with ThreadPoolExecutor(max_workers=max_workers) as ex:
            futures = {ex.submit(self._fetch, t): t for t in tickers}
            for future in as_completed(futures):
                data = future.result()
                if data:
                    results[data['ticker']] = data
        return results
