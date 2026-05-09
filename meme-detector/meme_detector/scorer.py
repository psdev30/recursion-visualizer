from .config import SCORE_WEIGHTS


class MemeScorer:
    def score(self, ticker, data):
        scores = {}

        # --- Reddit Buzz (0-100) ---
        rd = data.get('reddit_mentions', {})
        m24 = rd.get('mentions_24h', 0)
        m7d = rd.get('mentions_7d', 0)
        daily_avg = m7d / 7 if m7d > 0 else 0
        # Velocity: how much faster than the weekly average are mentions coming in?
        velocity = (m24 / daily_avg) if daily_avg > 0 else (1 if m24 > 0 else 0)
        buzz_raw = (m24 * 4) + (velocity * 8)
        scores['reddit_buzz'] = min(100.0, buzz_raw)

        # --- Short Squeeze Potential (0-100) ---
        sf = data.get('short_float_pct', 0)
        dtc = data.get('days_to_cover', 0)
        if sf >= 30:
            squeeze = 100.0
        elif sf >= 20:
            squeeze = 80.0
        elif sf >= 10:
            squeeze = 50.0
        elif sf >= 5:
            squeeze = 25.0
        else:
            squeeze = sf * 2
        if dtc >= 10:
            squeeze = min(100, squeeze + 20)
        elif dtc >= 5:
            squeeze = min(100, squeeze + 10)
        # Bonus: rising call/put ratio signals retail is loading calls (gamma squeeze setup)
        cpr = data.get('call_put_ratio')
        if cpr and cpr > 2:
            squeeze = min(100, squeeze + 10)
        scores['short_squeeze'] = squeeze

        # --- Volume Surge (0-100) ---
        vr = data.get('volume_ratio', 0)
        if vr >= 10:
            vol_score = 100.0
        elif vr >= 5:
            vol_score = 80.0
        elif vr >= 3:
            vol_score = 60.0
        elif vr >= 2:
            vol_score = 40.0
        elif vr >= 1.5:
            vol_score = 20.0
        else:
            vol_score = 0.0
        scores['volume_surge'] = vol_score

        # --- Momentum (0-100) ---
        # Sweet spot for early detection: moderate upward move, not yet parabolic
        m1w = data.get('momentum_1w', 0)
        if 3 <= m1w <= 25:
            mom = 75.0   # rising but not peaked — ideal entry window
        elif 25 < m1w <= 50:
            mom = 55.0   # strong, might be getting late
        elif m1w > 50:
            mom = 20.0   # already parabolic, FOMO territory
        elif 0 <= m1w < 3:
            mom = 40.0   # just starting to move
        elif -15 <= m1w < 0:
            mom = 30.0   # slight pullback — possible setup
        else:
            mom = 10.0   # heavy downtrend
        scores['momentum'] = mom

        # --- Retail Accessibility (0-100) ---
        price = data.get('price', 0)
        mcap = data.get('market_cap', 0)

        if price <= 5:
            price_score = 100.0
        elif price <= 20:
            price_score = 80.0
        elif price <= 50:
            price_score = 60.0
        elif price <= 100:
            price_score = 40.0
        elif price <= 200:
            price_score = 25.0
        else:
            price_score = 10.0

        if mcap == 0:
            cap_score = 50.0
        elif mcap <= 50_000_000:
            cap_score = 100.0
        elif mcap <= 300_000_000:
            cap_score = 80.0
        elif mcap <= 2_000_000_000:
            cap_score = 60.0
        elif mcap <= 10_000_000_000:
            cap_score = 30.0
        else:
            cap_score = 10.0

        scores['accessibility'] = (price_score + cap_score) / 2

        scores['total'] = round(
            sum(scores[k] * SCORE_WEIGHTS[k] for k in SCORE_WEIGHTS), 1
        )
        return scores
