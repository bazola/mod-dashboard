"""Headless component regression with local fixtures; no realm or model calls.

Requires Selenium and Edge or Chrome. Serves the real dashboard modules and CSS
on loopback, with a minimal host page and mutable accounting endpoint.
"""

import argparse
import json
import threading
import time
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait

WEB = Path(__file__).resolve().parents[1] / "web"
HTML = """<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="css/tokens.css"><link rel="stylesheet" href="css/base.css">
<link rel="stylesheet" href="css/components.css"><link rel="stylesheet" href="css/panels.css">
<link rel="stylesheet" href="css/archive.css"><link rel="stylesheet" href="css/accounting.css">
</head><body><div id="app"><div id="panel"></div></div><script type="module">
import {mountAccounting} from './js/components/accounting.js';
mountAccounting(document.querySelector('#panel'), document.body);
</script></body></html>"""


def fixture():
    totals = dict(attempts=30, calls=30, failures=0, pending=0, cost=0.03,
                  unknownCostCount=0, input=300, output=90, reasoning=0, unattributed=0)
    return dict(apiVersion=1, available=True, generated=int(time.time()),
                generated_at="2026-09-27T12:00:00Z", scope="recorded_requests", recentLimit=100,
                totals=totals, purposes=[dict(totals, purpose="lore_backstory")],
                models=[dict(totals, model="fixture-model")], recent=[
                    dict(requestId=f"req-{i}", timestamp="2026-09-27T12:00:00Z",
                         purpose="lore_backstory", model="fixture-model",
                         bot="<img src=x onerror=alert(1)>", botId=None,
                         status="success", cost=0.001, input=10, output=3,
                         reasoning=0, seconds=1, stage="write") for i in range(30)])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--browser", choices=["edge", "chrome"], default="edge")
    args = parser.parse_args()
    data = fixture()

    class Handler(SimpleHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            path = self.path.split("?", 1)[0]
            if path in ("/", "/data/accounting.json"):
                body = (HTML if path == "/" else json.dumps(data)).encode()
                self.send_response(200)
                self.send_header("Content-Type", "text/html" if path == "/" else "application/json")
                self.end_headers()
                self.wfile.write(body)
            else:
                super().do_GET()

    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, directory=str(WEB)))
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    options = webdriver.EdgeOptions() if args.browser == "edge" else webdriver.ChromeOptions()
    for option in ("--headless=new", "--disable-gpu", "--no-first-run"):
        options.add_argument(option)
    constructor = webdriver.Edge if args.browser == "edge" else webdriver.Chrome
    try:
        with constructor(options=options) as driver:
            driver.get(f"http://127.0.0.1:{server.server_port}/#costs")
            wait = WebDriverWait(driver, 15)
            wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, ".cost-request"))

            def refresh():
                result = driver.execute_async_script("""const done=arguments[0];
                  import('./js/api.js').then(api=>api.refreshAccounting()).then(()=>done(true), e=>done(String(e)));""")
                assert result is True, result

            def preserved():
                assert driver.execute_script("""return window.held.isConnected && window.held.open
                    && document.activeElement === window.held.querySelector('summary');"""), "Refresh lost open state or focus"

            # Details and focus survive equal data, changed data, and an inserted request.
            driver.execute_script("""window.held=document.querySelector('.cost-request');
                held.open=true; held.querySelector('summary').focus();""")
            refresh()
            preserved()
            data["recent"][0]["status"] = "invalid_response"
            refresh()
            preserved()
            assert "invalid_response" in driver.find_element(By.CSS_SELECTOR, ".cost-request").text
            data["recent"].insert(0, dict(data["recent"][0], requestId="new-request"))
            refresh()
            preserved()
            assert not driver.find_elements(By.CSS_SELECTOR, ".cost-request img"), "Actor text became HTML"

            # Evicting the focused row transfers focus to the request count, not the page behind it.
            data["recent"] = [row for row in data["recent"] if row["requestId"] != "req-0"]
            refresh()
            assert driver.execute_script("return document.activeElement.matches('.cost-note[role=status]');")

            search = driver.find_element(By.CSS_SELECTOR, 'input[type="search"]')
            search.send_keys("req-29")
            assert len(driver.find_elements(By.CSS_SELECTOR, ".cost-request")) == 1
            refresh()
            assert search.get_attribute("value") == "req-29"
            search.clear()
            search.send_keys(Keys.SPACE, Keys.BACKSPACE)
            driver.find_element(By.XPATH, '//button[text()="Next"]').click()
            assert len(driver.find_elements(By.CSS_SELECTOR, ".cost-request")) == 5
            refresh()
            assert len(driver.find_elements(By.CSS_SELECTOR, ".cost-request")) == 5

            data["generated"] = int(time.time()) - 240
            refresh()
            assert "stale snapshot" in driver.find_element(By.CSS_SELECTOR, ".cost-page .meta").text
            data["apiVersion"] = 99
            refresh()
            assert "refresh failed" in driver.find_element(By.CSS_SELECTOR, ".cost-page .meta").text
            assert driver.find_elements(By.CSS_SELECTOR, ".cost-request"), "Failed refresh discarded valid data"
            data["apiVersion"] = 1

            # A malformed payload with a supported version must preserve good state too.
            refresh()
            saved_totals = data["totals"]
            data["totals"] = {}
            refresh()
            assert "refresh failed" in driver.find_element(By.CSS_SELECTOR, ".cost-page .meta").text
            retained_cost = driver.execute_async_script("""const done=arguments[0];
                import('./js/state.js').then(({state})=>done(state.accounting.totals.cost));""")
            assert retained_cost == saved_totals["cost"], "Malformed snapshot replaced valid state"
            assert driver.find_elements(By.CSS_SELECTOR, ".cost-request")
            data["totals"] = saved_totals
            refresh()
            assert "refresh failed" not in driver.find_element(By.CSS_SELECTOR, ".cost-page .meta").text

            for width in (320, 390, 768, 820, 1024, 1280, 1440):
                driver.execute_cdp_cmd("Emulation.setDeviceMetricsOverride", dict(
                    width=width, height=1000, deviceScaleFactor=1, mobile=False))
                driver.execute_async_script("const done=arguments[0];requestAnimationFrame(()=>requestAnimationFrame(done));")
                assert driver.execute_script("const el=document.querySelector('.fx-scroll');return el.scrollWidth <= el.clientWidth+1;"), f"Overflow at {width}"

            data["available"] = False
            refresh()
            assert "Accounting is not available" in driver.find_element(By.CSS_SELECTOR, ".cost-page").text
            driver.find_element(By.CSS_SELECTOR, '[aria-label="Close costs"]').send_keys(Keys.ESCAPE)
            assert driver.find_element(By.CSS_SELECTOR, ".cost-page").get_attribute("hidden")
            assert driver.execute_script("return !document.getElementById('app').inert;")
            print("PASS refresh identity/focus, updates, eviction, escaping, filtering, pagination, stale/invalid/missing data, seven widths and close")
    finally:
        server.shutdown()
        server.server_close()
        worker.join()


if __name__ == "__main__":
    main()
