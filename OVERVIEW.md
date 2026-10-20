Shows live status of a local Strata inference server. A sidebar row is always visible and shows decode and prefill tokens per second (the last request's speeds when idle); clicking it opens a screen with a speed graph, request state and queue, GPU and memory use, and recent requests.

The daemon reads Strata's `/metrics` endpoint once per poll and shares that result between open clients. Polling runs only while the screen is open, every second while a request is running and every three seconds otherwise.

By default the daemon tries `http://127.0.0.1:8080` and then `http://127.0.0.1:8093`. Set `STRATA_URL` in the daemon environment to use another address, and `STRATA_API_KEY` if the server needs a bearer token. Only the Strata server's own metrics are read; nothing is sent elsewhere.
