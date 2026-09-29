"""Opt-in headless Selenium layout check against a running dashboard.

Requires selenium and Edge or Chrome. Changes browser state only; no server
commands or model requests are sent. Screenshots are optional local artifacts.
"""

import argparse
from pathlib import Path

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait


BOUNDS = """
const root = document.querySelector(arguments[0]);
const issues = [];
for (const card of root.querySelectorAll('.kpi')) {
  const box = card.getBoundingClientRect();
  if (!box.width) continue;
  for (const el of card.querySelectorAll('b, span')) {
    const range = document.createRange(); range.selectNodeContents(el);
    for (const text of range.getClientRects()) {
      if (text.right > box.right - 4 || text.left < box.left + 4)
        issues.push({text: el.textContent, cardWidth: box.width, textWidth: text.width});
    }
  }
}
return issues;
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--url', default='http://127.0.0.1:8787/')
    parser.add_argument('--browser', choices=['edge', 'chrome'], default='edge')
    parser.add_argument('--artifacts', type=Path)
    args = parser.parse_args()
    options = webdriver.EdgeOptions() if args.browser == 'edge' else webdriver.ChromeOptions()
    options.add_argument('--headless=new')
    options.add_argument('--disable-gpu')
    options.add_argument('--no-first-run')
    constructor = webdriver.Edge if args.browser == 'edge' else webdriver.Chrome
    with constructor(options=options) as driver:
        driver.get(args.url.split('#')[0])
        wait = WebDriverWait(driver, 25)
        wait.until(lambda d: d.find_elements(By.CSS_SELECTOR, '[data-panel="costs"] .kpi b'))
        button = driver.find_element(By.XPATH, '//button[contains(@class,"rail-btn")][span[text()="Costs"]]')
        if not driver.find_element(By.CSS_SELECTOR, '[data-panel="costs"]').is_displayed():
            button.click()
        for width in [320, 390, 768, 820, 1024, 1280, 1440]:
            driver.execute_cdp_cmd('Emulation.setDeviceMetricsOverride', {
                'width': width, 'height': 1000, 'deviceScaleFactor': 1, 'mobile': False,
            })
            # Wait for two animation frames so browser layout has settled.
            driver.execute_async_script('const done=arguments[0];requestAnimationFrame(()=>requestAnimationFrame(done));')
            assert not driver.execute_script(BOUNDS, '[data-panel="costs"]'), f'Dock value clipped at {width}'
            driver.find_element(By.CSS_SELECTOR, '[data-panel="costs"] > .btn').click()
            wait.until(lambda d: d.find_element(By.CSS_SELECTOR, '.cost-page').is_displayed())
            wait.until(lambda d: d.execute_script('return getComputedStyle(document.querySelector(".cost-page")).opacity === "1"'))
            assert not driver.execute_script(BOUNDS, '.cost-page'), f'Page value clipped at {width}'
            assert driver.execute_script('const el=document.querySelector(".cost-page .fx-scroll");return el.scrollWidth <= el.clientWidth + 1'), f'Page overflow at {width}'
            if args.artifacts and width in [390, 820, 1440]:
                args.artifacts.mkdir(parents=True, exist_ok=True)
                driver.save_screenshot(str(args.artifacts / f'costs-page-{width}.png'))
            driver.find_element(By.CSS_SELECTOR, '[aria-label="Close costs"]').click()
            wait.until(lambda d: not d.find_element(By.CSS_SELECTOR, '.cost-page').is_displayed())
            if args.artifacts and width == 1440:
                driver.save_screenshot(str(args.artifacts / 'costs-dock-1440.png'))
            print(f'PASS dock and full page: {width}px')
        def large_values():
            result = driver.execute_async_script("""const done=arguments[0];
              Promise.all([import('./js/api.js'), import('./js/state.js')]).then(async ([api,{state,emit}])=>{
                await api.refreshAccounting();
                state.accounting={...state.accounting,totals:{...state.accounting.totals,cost:123456789.123456,attempts:123456789}};
                emit('accounting');done(true);
              }).catch(error=>done(String(error)));""")
            assert result is True, result

        for width in [320, 820]:
            driver.execute_cdp_cmd('Emulation.setDeviceMetricsOverride', {
                'width': width, 'height': 1000, 'deviceScaleFactor': 1, 'mobile': False,
            })
            large_values()
            assert '123,456,789' in driver.find_element(By.CSS_SELECTOR, '[data-panel="costs"] .kpi b').text
            assert not driver.execute_script(BOUNDS, '[data-panel="costs"]'), f'Large dock value clipped at {width}'
            driver.find_element(By.CSS_SELECTOR, '[data-panel="costs"] > .btn').click()
            large_values()
            assert '123,456,789' in driver.find_element(By.CSS_SELECTOR, '.cost-page .kpi b').text
            assert not driver.execute_script(BOUNDS, '.cost-page'), f'Large page value clipped at {width}'
            driver.find_element(By.CSS_SELECTOR, '[aria-label="Close costs"]').click()
        print('PASS large cost/count values; no data changed on the server')


if __name__ == '__main__':
    main()
