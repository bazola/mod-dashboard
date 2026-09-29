# Model costs

The Costs panel opens a full-page view at `#costs`. It follows the existing
Living Azeroth frontend conventions and reads `data/accounting.json` every
30 seconds. No new web framework, port or worldserver binary is needed.

The data producer is the companion request-accounting feature in Headless DM,
including its `services/accounting` package. Install that backend change as well
as this dashboard change; the dashboard alone does not record model calls.
See Headless DM's `docs/accounting.md` for configuration and the complete snapshot
contract. Enable `ACCOUNTING_ENABLED=1` there, then run `python3 -m accounting.export`
from its `services/` directory. Point its
`--db` argument to the private accounting ledger and `--output` to
`Dashboard.DataRoot/accounting.json`; `--interval 30` enables recurring exports.
The ledger must not be stored in a directory served by the dashboard.

Snapshot API version 1 supplies `generated` (epoch seconds), `generated_at` (ISO
UTC), `available`, `totals`, `purposes`, `models`, `recent` (at most 100 records)
with `scope: "recorded_requests"` and `recentLimit: 100`. Totals and breakdowns cover all recorded
requests. Search and dropdown filters apply only to recent requests. USD costs
are nullable: zero is a reported free request; null is unknown billing. A missing source displays unavailable; snapshots
older than three minutes display stale. Failed refreshes retain the previous data.

Only request metadata is published. Anyone with dashboard access can see costs,
model names and actor names. Prompts, responses and errors are never included in
this public export. The exporter documentation specifies the complete allowlist.
The page still requires the existing worldserver-hosted dashboard to be running.

Run pure display/filter checks with `node --test tests/accounting.test.mjs`.
Run `python tests/accounting_browser.py --browser edge` (or `chrome`) for a
self-contained Selenium check against local fixtures. It tests automatic refresh
preserving open details and keyboard focus, escaping, filtering, pagination,
error/stale states and narrow layouts, without a running realm.
Browser checks should cover the `#costs` deep link, opening from the Costs panel,
search and dropdowns, request details, pagination, keyboard close/focus, phone
layout, stale/missing data, and rendering actor/provider text without HTML.

For the optional headless layout regression, install Selenium in a development
virtual environment and run `python tests/accounting_layout.py --browser edge`
(or `--browser chrome`) against a running dashboard. Use `--url` to select its
address and `--artifacts` for local screenshots. It checks both the sidebar and
full page at seven viewport widths, including large-number fixtures, without
sending commands or changing any server data. Browser drivers are managed by
Selenium. Selenium is not a runtime dependency of the dashboard.
