# Live search worker

Lets the app search every brand **right now** (not just the daily snapshot) when you tell it what you're after.

## One-time setup (about 5 minutes)
1. Create a free account at https://dash.cloudflare.com/sign-up
2. **Workers & Pages → Create → Create Worker**, name it `fashionplace-search`, click **Deploy**.
3. Click **Edit code**, replace everything with the contents of `live-search.js`, then **Deploy**.
4. Copy the worker's address (looks like `https://fashionplace-search.<you>.workers.dev`).
5. Put it in `config/live.json` as `{"search_url": "https://fashionplace-search.<you>.workers.dev"}`, or just send it to Claude.

Prices are converted to pounds using the rates in config/brands.json.
