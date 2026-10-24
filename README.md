# Strata monitor for Paseo

A [Paseo](https://paseo.sh) plugin that shows live status of a local [Strata](https://github.com/niko1221/strata) inference server: an always-visible sidebar row with prefill and decode tok/s, and a detail screen with engine controls (pick a model, Load, Abort, Stop), a speed graph, queue, GPU/RAM use and recent requests.

## Install

```bash
paseo plugin add git:delirious6423/paseo-strata-monitor
```

Requires Paseo 0.12.0 or later.

## Configure

Set in the daemon's environment (all optional):

- `STRATA_URL`: comma-separated server URLs. Default `http://127.0.0.1:8080,http://127.0.0.1:8093`.
- `STRATA_API_KEY`: bearer token, if your server requires one.
- `STRATA_ROOT`: Strata checkout for engine control. Default `/mnt/data4tb/Strata-new`.

Engine control drives user systemd services: one `strata@<model>` per `run-<model>.sh` in `STRATA_ROOT` (port 8080), plus `strata-exl3-quality.service` (port 8093) if its unit file exists. Load stops any other running engine first, because each needs the whole GPU. Abort/Stop runs `systemctl --user stop`. Only discovered units are ever touched.

The daemon reads `GET /metrics` once per poll (1 s while generating, 3 s otherwise, only while the app shows the plugin) and shares the result between clients.

## Develop

```bash
npm install
npm run typecheck
npm test
```

![Strata monitor screenshot](assets/screenshot.png)

MIT licensed.
