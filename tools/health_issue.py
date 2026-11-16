"""Prints a GitHub issue body when shops that used to work have been failing for three days; nothing otherwise."""
import json, pathlib, sys
p = pathlib.Path("data/health.json")
if not p.exists(): sys.exit(0)
h = json.loads(p.read_text())
if not h["broken"]: sys.exit(0)
print(f"**{h['date']}** — {len(h['broken'])} shop(s) that used to update have failed 3+ days in a row. {h['ok']} shops are updating normally.\n")
print("| Shop | Days failing | Last worked | Reason |\n|---|---|---|---|")
for b in h["broken"]: print(f"| {b['shop']} | {b['days']} | {b['last_ok']} | {b['reason']} |")
