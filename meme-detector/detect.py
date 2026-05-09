#!/usr/bin/env python3
"""Meme stock detector — identify potential meme stocks before they pop."""

import argparse
import sys

from meme_detector.reddit import RedditScanner
from meme_detector.stocks import StockAnalyzer
from meme_detector.scorer import MemeScorer
from meme_detector.display import Display, console


def main():
    parser = argparse.ArgumentParser(
        description='Detect potential meme stocks based on Reddit buzz, short interest, and volume.'
    )
    parser.add_argument(
        'tickers', nargs='*',
        help='Specific tickers to analyze. If omitted, scans Reddit to discover trending tickers.'
    )
    parser.add_argument(
        '--top', type=int, default=25,
        help='Number of Reddit-discovered tickers to evaluate (default: 25)'
    )
    parser.add_argument(
        '--min-score', type=float, default=30,
        help='Minimum meme score (0-100) to include in results (default: 30)'
    )
    parser.add_argument(
        '--detail', action='store_true',
        help='Show per-ticker score breakdown'
    )
    parser.add_argument(
        '--subreddits', nargs='+',
        metavar='SUB',
        help='Override which subreddits to scan'
    )
    parser.add_argument(
        '--demo', action='store_true',
        help='Run with built-in sample data (no network required)'
    )
    args = parser.parse_args()

    display = Display()
    display.header()

    scorer = MemeScorer()

    if args.demo:
        from meme_detector.demo_data import DEMO_STOCKS
        display.status("Running in demo mode with sample data...")
        stocks = DEMO_STOCKS
    elif args.tickers:
        analyzer = StockAnalyzer()
        tickers = [t.upper().lstrip('$') for t in args.tickers]
        display.status(f"Analyzing {len(tickers)} ticker(s): {', '.join(tickers)}")
        stocks = analyzer.analyze_batch(tickers)
        for data in stocks.values():
            data['reddit_mentions'] = {}
    else:
        analyzer = StockAnalyzer()
        display.status("Scanning Reddit for trending tickers...")
        scanner = RedditScanner(subreddits=args.subreddits)
        mentions = scanner.scan(verbose=True)
        console.print(f"  [dim]Found {len(mentions)} candidate tickers from Reddit[/dim]")

        top_tickers = list(mentions.keys())[: args.top * 2]
        display.status(f"Fetching stock data for top {len(top_tickers)} mentions...")
        stocks = analyzer.analyze_batch(top_tickers)

        for ticker, data in stocks.items():
            data['reddit_mentions'] = mentions.get(ticker, {})

    if not stocks:
        console.print("[red]No valid stock data found. Check your tickers or network.[/red]")
        sys.exit(1)

    display.status(f"Scoring {len(stocks)} stocks...")

    ranked = []
    for ticker, data in stocks.items():
        score = scorer.score(ticker, data)
        if score['total'] >= args.min_score:
            ranked.append((ticker, data, score))

    ranked.sort(key=lambda x: x[2]['total'], reverse=True)

    display.results(ranked)

    if args.detail:
        for ticker, data, score in ranked:
            display.detail(ticker, data, score)

    display.disclaimer()


if __name__ == '__main__':
    main()
