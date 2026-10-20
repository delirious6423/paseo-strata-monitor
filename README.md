# Strata monitor for Paseo

A [Paseo](https://paseo.sh) plugin that shows live status of a local Strata inference server: an always-visible sidebar row with prefill and decode tok/s, and a detail screen with a speed graph, queue, GPU/RAM use and recent requests.

## Install

```bash
paseo plugin add git:delirious6423/paseo-strata-monitor
```

Requires Paseo 0.12.0 or later.

## Configure

Set in the daemon's environment (all optional):

- `STRATA_URL`: comma-separated server URLs. Default `http://127.0.0.1:8080,http://127.0.0.1:8093`.
- `STRATA_API_KEY`: bearer token, if your server requires one.

The daemon reads `GET /metrics` once per poll (1 s while generating, 3 s otherwise, only while the app shows the plugin) and shares the result between clients.

## Develop

```bash
npm install
npm run typecheck
npm test
```

MIT licensed.
