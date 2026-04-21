# Observability add-on

Prometheus + Grafana stack layered on top of the dev compose file. Covers
infra-level metrics (postgres, redis) that Dozzle (logs) does not. NestJS
app services (backend, bff, auth-service) expose default Node + process
metrics at `/metrics` via `@willsoto/nestjs-prometheus`; custom RED/USE
metrics are still TODO — see "App metrics" below.

## What's here

| File | Purpose |
| --- | --- |
| `compose.yml` | Extra compose file: `prometheus`, `grafana`, `postgres-exporter`, `redis-exporter`. Joins existing `app-internal` network. |
| `prometheus.yml` | Scrape config — infra exporters + backend/bff/auth `/metrics` jobs (live: default Node + process metrics emitted by `@willsoto/nestjs-prometheus`). |
| `grafana/provisioning/datasources/prometheus.yml` | Auto-wires the Prometheus datasource. |
| `grafana/provisioning/dashboards/dashboards.yml` | Loads any JSON in `grafana/dashboards/` into the "Hackathone" folder. |
| `grafana/dashboards/overview.json` | Single dashboard: scrape status, postgres connections, postgres tx rate, redis memory, redis client count. |

## Run

From `app/`:

```bash
docker compose -f docker-compose.dev.yml -f observability/compose.yml up -d
```

To stop only the observability layer (leaves app stack running):

```bash
docker compose -f docker-compose.dev.yml -f observability/compose.yml stop \
  prometheus grafana postgres-exporter redis-exporter
```

Full teardown (incl. volumes):

```bash
docker compose -f docker-compose.dev.yml -f observability/compose.yml down -v
```

## URLs

| Service | URL | Notes |
| --- | --- | --- |
| Prometheus | http://localhost:9090 | Targets page: `/targets` |
| Grafana   | http://localhost:3030 | Anonymous Viewer enabled; admin login `admin` / `admin` for editing |
| postgres-exporter | (internal `:9187`) | Not exposed on host — scraped by Prometheus over `app-internal` |
| redis-exporter    | (internal `:9121`) | Not exposed on host — scraped by Prometheus over `app-internal` |

Port choices: `9090` is Prometheus default and unused by the app stack;
`3030` for Grafana avoids the frontend `3007`, BFF `3006`, auth `3003`,
backend `3004`, and Dozzle `9999`.

## App metrics

`backend`, `bff`, and `auth-service` expose `/metrics` (default Node +
process metrics) via `@willsoto/nestjs-prometheus`. The endpoint lives at
the root path — `setGlobalPrefix('api/v1', { exclude: ['/metrics'] })` in
each service's `main.ts` keeps it off the `api/v1` surface so Prometheus
can scrape `metrics_path: /metrics` directly. After one scrape interval
(~15 s) the dashboard's "Service scrape status" panel flips those jobs
from DOWN → UP automatically.

Domain RED/USE metrics (request rate, error rate, message-publish counters,
etc.) are still TODO — wire custom prom-client `Counter` / `Histogram`
providers via `makeCounterProvider()` / `makeHistogramProvider()` per
module, then increment them from controllers / interceptors.

## Adding a dashboard

Drop a `*.json` file into `grafana/dashboards/`. Grafana picks it up within
30 s (`updateIntervalSeconds`). Use Prometheus datasource UID `Prometheus`
in the panel queries (matches the provisioning name).
