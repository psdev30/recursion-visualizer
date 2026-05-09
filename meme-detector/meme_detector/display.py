import datetime
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich import box

console = Console()


class Display:
    def header(self):
        console.print(Panel(
            "[bold red]  MEME STOCK DETECTOR[/bold red]\n"
            "[dim]Early identification via Reddit buzz + short squeeze setup + volume surge[/dim]",
            box=box.DOUBLE_EDGE,
            border_style="red",
        ))

    def status(self, msg):
        console.print(f"[cyan]→[/cyan] {msg}")

    def results(self, ranked):
        if not ranked:
            console.print("\n[yellow]No stocks met the minimum score threshold.[/yellow]")
            return

        table = Table(
            title=f"Meme Stock Candidates  —  {datetime.date.today()}",
            box=box.ROUNDED,
            header_style="bold cyan",
            border_style="dim",
            show_lines=False,
        )
        table.add_column("#", style="dim", width=3, justify="right")
        table.add_column("Ticker", style="bold white", width=7)
        table.add_column("Name", width=22, no_wrap=True)
        table.add_column("Price", justify="right", width=9)
        table.add_column("1W%", justify="right", width=8)
        table.add_column("Vol/Avg", justify="right", width=8)
        table.add_column("Short%", justify="right", width=8)
        table.add_column("Reddit24h", justify="right", width=10)
        table.add_column("Score", justify="right", width=7)
        table.add_column("Signal", width=10)

        for i, (ticker, data, score) in enumerate(ranked, 1):
            total = score['total']

            if total >= 70:
                signal = "[bold red]HOT[/bold red]"
                sc_style = "bold red"
            elif total >= 50:
                signal = "[bold yellow]WARM[/bold yellow]"
                sc_style = "bold yellow"
            else:
                signal = "[green]WATCH[/green]"
                sc_style = "green"

            m1w = data.get('momentum_1w', 0)
            mom_color = 'green' if m1w > 0 else 'red'
            mom_str = f"[{mom_color}]{m1w:+.1f}%[/]"

            vr = data.get('volume_ratio', 0)
            vr_color = 'red' if vr > 5 else ('yellow' if vr > 2 else 'white')
            vr_str = f"[{vr_color}]{vr:.1f}x[/]"

            sf = data.get('short_float_pct', 0)
            sf_color = 'red' if sf > 20 else ('yellow' if sf > 10 else 'white')
            sf_str = f"[{sf_color}]{sf:.1f}%[/]"

            rd = data.get('reddit_mentions', {})
            rd24 = rd.get('mentions_24h', 0)
            rd_str = f"{rd24:.0f}" if rd24 > 0 else "[dim]—[/dim]"

            name = (data.get('name') or ticker)[:22]

            table.add_row(
                str(i),
                ticker,
                name,
                f"${data.get('price', 0):.2f}",
                mom_str,
                vr_str,
                sf_str,
                rd_str,
                f"[{sc_style}]{total:.0f}[/]",
                signal,
            )

        console.print()
        console.print(table)

    def detail(self, ticker, data, score):
        """Print a score breakdown panel for a single ticker."""
        lines = [
            f"[bold]{ticker}[/bold]  {data.get('name', '')}",
            f"Price: ${data.get('price', 0):.2f}  |  "
            f"Market Cap: ${data.get('market_cap', 0) / 1e9:.2f}B",
            "",
            f"  Reddit Buzz    {score.get('reddit_buzz', 0):5.1f} / 100",
            f"  Short Squeeze  {score.get('short_squeeze', 0):5.1f} / 100"
            f"  (short float {data.get('short_float_pct', 0):.1f}%)",
            f"  Volume Surge   {score.get('volume_surge', 0):5.1f} / 100"
            f"  ({data.get('volume_ratio', 0):.1f}x avg)",
            f"  Momentum       {score.get('momentum', 0):5.1f} / 100"
            f"  (1w {data.get('momentum_1w', 0):+.1f}%)",
            f"  Accessibility  {score.get('accessibility', 0):5.1f} / 100",
            "",
            f"  [bold]TOTAL SCORE:   {score.get('total', 0):5.1f} / 100[/bold]",
        ]
        console.print(Panel("\n".join(lines), title="Score Breakdown", border_style="cyan"))

    def disclaimer(self):
        console.print(
            "\n[dim red]⚠  DISCLAIMER: For informational/educational use only. "
            "Meme stocks carry extreme risk — you can lose everything. "
            "This is not financial advice.[/dim red]\n"
        )
