# Optional server management

This is an adapter to a separately deployed management service. It does not
install a Docker controller, launch systemd units, or run shell commands itself.
The Server tab appears only when the standalone host advertises configured
management through `GET /host-health`. The original worldserver-hosted dashboard
keeps working and does not show this tab.

Set `DASHBOARD_CONTROL_URL` to the backend's HTTP(S) origin and
`DASHBOARD_CONTROL_TOKEN` to a dedicated random value of at least 32 characters.
The browser sends that token in `X-Control-Token`; it is stored in this browser's
local storage. The host forwards only the fixed routes below, validates their
JSON responses, and never returns backend credentials. Cross-origin browser
requests are rejected. Operations are never retried or redirected. After a
timeout, check the latest job and service state before trying again.

## Portable protocol (`v1`)

Set `DASHBOARD_CONTROL_PROTOCOL=v1` and `DASHBOARD_CONTROL_BACKEND_TOKEN` to a
separate random value of at least 32 characters. Every backend request uses
`Authorization: Bearer <backend token>`. The backend must verify this token.
Use TLS when traffic crosses an untrusted network. An optional
`DASHBOARD_CONTROL_HOST_HEADER` overrides the URL's Host header.

Implement these three routes, returning `application/json`:

| Route | Response |
| --- | --- |
| `GET /api/state` | State object below, HTTP 200 |
| `GET /api/job` | Latest job, or `null` when none exists, HTTP 200 |
| `POST /api/action` | Accepted job, HTTP 200 or 202; body exactly `{"action":"start"}` or `{"action":"stop"}` |

```json
{
  "available": true,
  "phase": "online",
  "checkedAt": 1790500000000,
  "realmRunning": true,
  "databaseRunning": true,
  "logicalCpus": 16,
  "samples": [{"time": 1790500000000, "cpuPercent": 125.5, "memoryBytes": 2147483648}]
}
```

Times are Unix milliseconds. `phase` is `online`, `starting`, `stopped`,
`unknown`, or `unavailable`. `logicalCpus` is a positive integer or `null`.
Samples contain finite nonnegative numbers, at most 120 entries, oldest first.
CPU usage covers the managed realm and database together: 100% means one logical
CPU, so multicore usage can exceed 100%. Memory is their combined usage in bytes.
An empty sample list is valid when resource collection is unavailable.

A job has a nonempty string `id`, the requested `action` (`start` or `stop`),
and `status` (`running`, `done`, or `failed`). Start and stop define realm
lifecycle; a running database may remain up after the realm stops. The backend
owns its service names and lifecycle sequencing. For example, a systemd adapter
can map these actions to fixed realm units and collect cgroup resource totals;
it should report `online` only after the worldserver is ready. The browser cannot
supply unit names or commands. This repository does not include that adapter.

## Existing local admin protocol (`legacy-admin`, default)

This compatibility adapter supports the existing Headless DM local admin service.
Configure `DASHBOARD_CONTROL_REALM_UNIT` and `DASHBOARD_CONTROL_DATABASE_UNIT`
when your container names differ from the defaults `hdm-workshop` and
`hdm-database`. Container names are used only to read status; the admin service
owns which services its start/stop action controls.

The required backend routes and fields are:

| Route | Required JSON |
| --- | --- |
| `GET /api/state` | `time` (Unix ms), `docker` (boolean), `containers` (array of `{name, Running}`), `samples` (array of `{time, cpu, memory}`) |
| `GET /api/job` | Job as above, or `null`; `action` may name another admin task |
| `GET /api/session` | `{"token":"session token"}` |
| `POST /api/action` | Start/stop body as above, authenticated with `X-Admin-Token` from the session; returns a job |

The state may also include `runtime: {worldReady, services: {world}, cpuCount}`.
The legacy admin shares its job slot with console, account and other tasks.
Their status is readable so the panel can wait for them to finish; their output
is discarded. Only start and stop can be submitted from this dashboard.
`world` is a supervisor state such as `RUNNING`, `STARTING`, `STOPPED`, `EXITED`
or `FATAL`. `worldReady` must be true and the realm container and world process
running to report online. Without runtime readiness the state is unknown.
Resource units match the portable protocol. Only the latest 120 samples are sent
to the browser; unrelated backend fields are discarded.

This legacy service issues its session without authentication; anyone who can
reach it may obtain control. Its Host header check is not authentication.
Keep it on loopback or a trusted private network. Prefer the bearer-authenticated
portable protocol for a new deployment.

For Docker Desktop reaching the existing Windows admin on port 8789, use
`DASHBOARD_CONTROL_URL=http://host.docker.internal:8789` and
`DASHBOARD_CONTROL_HOST_HEADER=127.0.0.1:8789`. The standalone host needs no
Docker socket mount. Do not point the control URL at the worldserver dashboard.
