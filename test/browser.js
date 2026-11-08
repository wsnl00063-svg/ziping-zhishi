'use strict';
const fs = require('fs');
const path = require('path');
const puppeteer = require('/tmp/ppt/node_modules/puppeteer-core');

const htmlPath = path.resolve(__dirname, '../index.html');
const shotDir = path.resolve(__dirname, 'shots');
fs.mkdirSync(shotDir, { recursive: true });

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  });
  let assertions = 0;
  const cases = [];
  const errors = [];
  const requests = [];
  const check = (v, m) => { assertions++; if (!v) throw new Error(m || 'fail'); };
  async function boot(page, iso) {
    await page.evaluateOnNewDocument(t => { window.ZS_NOW = t; }, iso);
    page.on('pageerror', e => errors.push(String(e)));
    await page.setRequestInterception(true);
    page.on('request', r => {
      if (/^https?:/i.test(r.url())) { requests.push(r.url()); r.abort(); }
      else r.continue();
    });
    await page.goto('file://' + htmlPath, { waitUntil: 'load' });
  }
  try {
    for (const width of [320, 390, 1280]) {
      const name = '视口 ' + width;
      const page = await browser.newPage();
      await page.setViewport({ width, height: width < 500 ? 844 : 900, isMobile: width < 500, deviceScaleFactor: 1 });
      await boot(page, '2026-11-15T12:00:00+08:00');
      const before = assertions;
      check(await page.$('#mainFour'), '首页四项');
      check(await page.$$eval('#mainFour .eyebrow', es => es.map(e => e.textContent).join(',')) === '本月主势,事业,财运,一句断语', '只显示四项');
      check(await page.$eval('#verdict', e => e.textContent.includes('亥') && e.textContent.includes('伤官见官')), '己亥断语');
      check(await page.evaluate(() => document.querySelector('#careerHome').textContent !== document.querySelector('#wealthHome').textContent), '事业财运不同');
      check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '不横向溢出');
      await page.click('#professional > summary');
      check(await page.$('#dLayers'), '关系在折叠页');
      await page.click('#bToday');
      await page.waitForSelector('#dayCard');
      await page.$eval('#hourCalc', e => { e.open = true; });
      const hour = await page.$eval('#hourCalc', e => e.innerText);
      const apiHour = await page.evaluate(() => ZhishiApp.at(Date.parse('2026-11-15T12:00:00+08:00'), false).calendar.hour);
      check(hour.includes(apiHour), '流时与接口一致 ' + apiHour);
      await page.click('#bMonth');
      await page.select('#pick', '2026-12-15');
      check(await page.$eval('#verdict', e => e.textContent.includes('刃') && e.textContent.includes('庚')), '庚子');
      await page.select('#pick', '2027-02-15');
      check(await page.$eval('#verdict', e => e.textContent.includes('申中壬') && e.textContent.includes('不是亥子') && !e.textContent.includes('水当令')), '壬寅');
      check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '换月后不溢出');
      await page.screenshot({ path: path.join(shotDir, 'month-' + width + '.png'), fullPage: true });
      cases.push({ name, assertions: assertions - before });
      await page.close();
    }

    {
      const page = await browser.newPage();
      await page.setViewport({ width: 390, height: 844, isMobile: true });
      await boot(page, '2026-11-15T23:00:00+08:00');
      const before = assertions;
      await page.evaluate(() => { window.COPIED = []; const write = async t => { window.COPIED.push(t); }; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: write } }); });
      const times = ['22:59:00', '23:00:00', '23:59:59'];
      const seen = [];
      for (const t of times) {
        await page.$eval('#clock', (e, v) => { e.value = v; e.dispatchEvent(new Event('change')); }, t);
        const row = await page.evaluate(() => {
          const r = ZhishiApp.result();
          return { day: r.calendar.day, hour: r.calendar.hour, month: r.calendar.month, verdict: r.month.verdict };
        });
        seen.push(row);
      }
      check(seen[0].day === seen[1].day && seen[1].day === seen[2].day, '23 点日柱不变');
      check(seen[0].hour !== seen[1].hour && seen[1].hour === seen[2].hour, '23 点时辰');
      check(seen.every(s => s.verdict === seen[0].verdict), '时辰不改月断');
      check(seen[1].hour === '壬子' && seen[1].day === '癸巳', '癸巳日 23 点是壬子，不是次日甲子');
      await page.click('#professional > summary');
      await page.click('#bToday');
      await page.$eval('#hourCalc', e => { e.open = true; });
      check(await page.$eval('#hourCalc', e => e.innerText.includes('壬子')), '页面流时显示壬子');
      await page.click('#copyDay');
      const copied = await page.evaluate(() => window.COPIED[window.COPIED.length - 1]);
      check(copied.includes('【流时】壬子') && copied.includes('癸巳'), '复制的时柱与页面相同');
      await page.click('#bMonth');
      await page.click('#copyMonth');
      const monthCopy = await page.evaluate(() => window.COPIED[window.COPIED.length - 1]);
      const brief = await page.evaluate(() => ZhishiApp.brief());
      check(monthCopy === brief && brief.includes('【本月主势】') && brief.includes('【事业】') && brief.includes('【财运】') && brief.includes('【一句断语】') && brief.includes('己亥'), '复制本月等于四项');
      await page.select('#pick', '2026-11-16');
      await page.$eval('#clock', e => { e.value = '00:00:01'; e.dispatchEvent(new Event('change')); });
      const next = await page.evaluate(() => { const r = ZhishiApp.result(); return r.calendar.day + ' ' + r.calendar.hour; });
      check(next === '甲午 甲子', '00:01 换成当日日干');
      await page.screenshot({ path: path.join(shotDir, 'hour-boundary.png'), fullPage: false });
      cases.push({ name: '23 点与 00 点的展示和复制', assertions: assertions - before });
      await page.close();
    }

    {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 900 });
      await boot(page, '2027-11-07T23:38:34+08:00');
      const before = assertions;
      const beforeJie = await page.evaluate(() => ZhishiApp.result().calendar.month + ' ' + ZhishiApp.result().calendar.hour);
      await page.$eval('#clock', e => { e.value = '23:38:35'; e.dispatchEvent(new Event('change')); });
      const afterJie = await page.evaluate(() => ZhishiApp.result().calendar.month + ' ' + ZhishiApp.result().calendar.hour + ' ' + ZhishiApp.result().calendar.day);
      check(beforeJie === '庚戌 丙子', '交节前');
      check(afterJie === '辛亥 丙子 庚寅', '交节后只换月');
      await page.select('#pick', '2027-02-04');
      await page.$eval('#clock', e => { e.value = '09:46:17'; e.dispatchEvent(new Event('change')); });
      const pre = await page.evaluate(() => { const c = ZhishiApp.result().calendar; return c.year + c.month + c.day + c.hour; });
      await page.$eval('#clock', e => { e.value = '09:46:18'; e.dispatchEvent(new Event('change')); });
      const post = await page.evaluate(() => { const c = ZhishiApp.result().calendar; return c.year + c.month + c.day + c.hour; });
      check(pre.slice(0, 2) === '丙午' && post.slice(0, 2) === '丁未', '立春换年');
      check(pre.slice(4) === post.slice(4), '立春不改日时');
      await page.click('#professional > summary');
      await page.click('#bBig');
      check(await page.$eval('#vBig', e => e.textContent.includes('壬午｜乙巳｜壬寅｜乙巳') && e.textContent.includes('2023—2032')), '本命大运未改');
      cases.push({ name: '交节与原局入口', assertions: assertions - before });
      await page.close();
    }

    for (const tz of ['UTC', 'America/Los_Angeles', 'Asia/Tokyo']) {
      const page = await browser.newPage();
      await page.emulateTimezone(tz);
      await boot(page, '2027-02-04T09:46:18+08:00');
      const before = assertions;
      const got = await page.evaluate(() => {
        const c = ZhishiApp.result().calendar;
        return c.year + ' ' + c.month + ' ' + c.day + ' ' + c.hour;
      });
      check(got === '丁未 壬寅 甲寅 己巳', tz + ' ' + got);
      cases.push({ name: '浏览器时区 ' + tz, assertions: assertions - before });
      await page.close();
    }

    check(requests.length === 0, '外部请求 ' + requests.join(','));
    check(errors.length === 0, '页面错误 ' + errors.join(' | '));
    const result = { passed: true, cases: cases.length, assertions, requests, errors, caseList: cases };
    fs.writeFileSync(path.join(__dirname, 'browser-results.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ passed: true, cases: cases.length, assertions, requests, errors, caseList: cases.map(c => c.name + ':' + c.assertions) }, null, 2));
  } finally {
    await browser.close();
  }
})().catch(err => { console.error(err); process.exit(1); });
