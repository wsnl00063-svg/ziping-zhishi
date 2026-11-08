'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const htmlPath = path.join(root, 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const engineSrc = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const data = JSON.parse(html.match(/id="zsdata">([\s\S]*?)<\/script>/)[1]);
const G = '甲乙丙丁戊己庚辛壬癸';
const Z = '子丑寅卯辰巳午未申酉戌亥';

function load(src) {
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx.ZSStructure;
}
const E = load(engineSrc);

const cases = [];
let assertions = 0;
function check(v, m) {
  assertions++;
  if (!v) throw new Error(m || 'assertion failed');
}
function test(name, fn) {
  const before = assertions;
  fn();
  cases.push({ name, assertions: assertions - before });
}

function hourOf(day, h) {
  const z = Math.floor((h + 1) / 2) % 12;
  const ds = G.indexOf(day[0]);
  return G[((ds % 5) * 2 + z) % 10] + Z[z];
}
function nextGz(gz) {
  let k = 0;
  for (; k < 60; k++) if (G[k % 10] + Z[k % 12] === gz) break;
  return G[((k + 1) % 60) % 10] + Z[((k + 1) % 60) % 12];
}
function at(iso) {
  return E.at(Date.parse(iso), data.terms, false);
}
function atDay(iso) {
  return E.at(Date.parse(iso), data.terms, true);
}

test('引擎不写死测试月份，也不保留 23 点改日干', () => {
  check(!/if\s*\(\s*h\s*===\s*23\s*\)/.test(engineSrc), '23 点特例还在');
  check(!/己亥|庚子|壬寅月|2026|2027/.test(engineSrc), '判断代码写进了测试日期');
  check(!/中余气|偏有利|偏不利|未添亥子|印被克尽|已经失效/.test(engineSrc), '旧的笼统判断还在');
  check(!/\bscore\b|\bweight\b|百分比/.test(engineSrc), '出现了分数');
  check(engineSrc.includes('申') && engineSrc.includes('中气'), '没有把申的中气写进判断');
});

test('页面仍是单文件离线', () => {
  check(!/fetch\s*\(|DecompressionStream|https?:\/\/|cdn\./i.test(html), '有外链或解压接口');
  check(data.range[0] === '2026-11-01' && data.range[1] === '2027-12-31', '日期范围被改');
  check(data.natal.pillars_fixed.join(' ') === '壬午 乙巳 壬寅 乙巳', '本命被改');
  check(data.natal.dayun_fixed[0].join(',') === '戊申,2023,2032', '大运被改');
  check(data.version === 'ZS-v4.5', '版本');
  check(/00:00/.test(data.dateRule) && /23:00至23:59/.test(data.dateRule), '日界说明');
});

const clocks = [
  ['2026-11-15T22:59:00+08:00', '2026-11-15T23:00:00+08:00', '2026-11-15T23:59:59+08:00', '2026-11-16T00:00:00+08:00', '2026-11-16T00:00:01+08:00'],
  ['2026-12-31T22:59:00+08:00', '2026-12-31T23:00:00+08:00', '2026-12-31T23:59:59+08:00', '2027-01-01T00:00:00+08:00', '2027-01-01T00:00:01+08:00'],
  ['2027-02-03T22:59:00+08:00', '2027-02-03T23:00:00+08:00', '2027-02-03T23:59:59+08:00', '2027-02-04T00:00:00+08:00', '2027-02-04T00:00:01+08:00'],
  ['2027-11-07T22:59:00+08:00', '2027-11-07T23:00:00+08:00', '2027-11-07T23:38:34+08:00', '2027-11-07T23:59:59+08:00', '2027-11-08T00:00:00+08:00']
];
clocks.forEach((group, gi) => {
  test('日界五时点 ' + group[0].slice(0, 10), () => {
    const rows = group.map(iso => {
      const c = E.calendar(Date.parse(iso), data.terms);
      const via = E.at(Date.parse(iso), data.terms, true).calendar;
      check(JSON.stringify(c) === JSON.stringify(via), 'calendar 与 at 不一致 ' + iso);
      const hh = Number(iso.slice(11, 13));
      check(c.hour === hourOf(c.day, hh), iso + ' 时干不是当日日干 ' + c.day + ' ' + c.hour);
      if (hh === 23) check(c.hour !== hourOf(nextGz(c.day), hh), iso + ' 仍在用次日干');
      return c;
    });
    check(rows[0].day === rows[1].day && rows[1].day === rows[2].day, '23 点前一日柱被换掉');
    check(rows[0].hour !== rows[1].hour, '22:59 与 23:00 应换时辰');
    check(rows[1].hour === rows[2].hour || group[2].includes('23:38'), '23:00 与 23:59 时柱应相同');
    check(rows[3].day === nextGz(rows[2].day) || rows[4].day === nextGz(rows[1].day), '00 点没有换日');
    check(rows[3].hour === hourOf(rows[3].day, Number(group[3].slice(11, 13))), '00 点时干');
    const monthVerdicts = group.slice(0, 3).map(iso => at(iso).month.verdict);
    check(monthVerdicts.every(v => v === monthVerdicts[0]), '同一日的 22:59/23 点改了月断');
  });
});

test('2027 立冬交在 23 点内，只换月，不换日干和时干', () => {
  const term = data.terms.find(t => t.time === '2027-11-07 23:38:35');
  const before = E.calendar(term.ms - 1000, data.terms);
  const on = E.calendar(term.ms, data.terms);
  const after = E.calendar(term.ms + 1000, data.terms);
  check(before.month === '庚戌' && on.month === '辛亥' && after.month === '辛亥', '立冬换月');
  check(before.year === '丁未' && on.year === '丁未', '立冬不换年');
  check(before.day === on.day && on.day === after.day && on.day === '庚寅', '交节不换日');
  check(before.hour === on.hour && on.hour === after.hour && on.hour === hourOf('庚寅', 23), '23 点交节时干跟着庚寅');
  check(on.hour !== hourOf('辛卯', 23), '没有提前用次日辛卯');
});

test('立春换年不带动日柱和时柱', () => {
  const term = data.terms.find(t => t.time === '2027-02-04 09:46:18');
  const before = E.calendar(term.ms - 1000, data.terms);
  const on = E.calendar(term.ms, data.terms);
  check(before.year === '丙午' && before.month === '辛丑', '立春前');
  check(on.year === '丁未' && on.month === '壬寅', '立春后');
  check(before.day === on.day && before.hour === on.hour, '日时不被立春改写');
  check(at(stampIso(term.ms - 1000)).month.verdict !== at(stampIso(term.ms)).month.verdict, '立春前后月断应不同');
});

test('十二节边界都按表上的秒切换，日时保持连续', () => {
  for (let i = 1; i < data.terms.length - 1; i++) {
    const prev = data.terms[i - 1], term = data.terms[i];
    const a = E.calendar(term.ms - 1000, data.terms);
    const b = E.calendar(term.ms, data.terms);
    const c = E.calendar(term.ms + 1000, data.terms);
    check(a.month === prev.month && a.year === prev.year, term.name + ' 前一秒年月');
    check(b.month === term.month && b.year === term.year, term.name + ' 当秒年月');
    check(c.month === term.month && c.year === term.year, term.name + ' 后一秒年月');
    check(a.day === b.day && a.hour === b.hour, term.name + ' 交节改了日时');
  }
});

test('表内 426 日的日柱连续，正午和 23:30 都对得上', () => {
  data.days.forEach((d, i) => {
    const noon = E.calendar(Date.parse(d.date + 'T12:00:00+08:00'), data.terms);
    const late = E.calendar(Date.parse(d.date + 'T23:30:00+08:00'), data.terms);
    check(noon.day === d.day_gz && late.day === d.day_gz, d.date + ' 日柱');
    check(late.hour === hourOf(d.day_gz, 23), d.date + ' 23:30 时柱');
    check(noon.hour === hourOf(d.day_gz, 12), d.date + ' 正午时柱');
    if (i) check(d.day_gz === nextGz(data.days[i - 1].day_gz), d.date + ' 不是次日');
  });
});

['UTC', 'Asia/Shanghai', 'America/Los_Angeles', 'Pacific/Kiritimati'].forEach(tz => {
  test('系统时区 ' + tz + ' 不改变排柱', () => {
    const out = execFileSync(process.execPath, ['-e', `
      const fs=require('fs'),vm=require('vm');
      const html=fs.readFileSync(process.argv[1],'utf8');
      const src=html.match(/<script>([\\s\\S]*?)<\\/script>/)[1];
      const data=JSON.parse(html.match(/id="zsdata">([\\s\\S]*?)<\\/script>/)[1]);
      const ctx={}; vm.createContext(ctx); vm.runInContext(src, ctx);
      const E=ctx.ZSStructure;
      const times=['2026-11-15T23:00:00+08:00','2026-12-31T23:59:59+08:00','2027-01-01T00:00:00+08:00','2027-02-04T09:46:18+08:00','2027-11-07T23:38:35+08:00'];
      const rows=times.map(t=>{const c=E.calendar(Date.parse(t), data.terms); const r=E.at(Date.parse(t), data.terms, true); return {t, c:{year:c.year,month:c.month,day:c.day,hour:c.hour,stamp:c.stamp}, v:r.month.verdict, day:r.day.verdict};});
      process.stdout.write(JSON.stringify(rows));
    `, htmlPath], { env: Object.assign({}, process.env, { TZ: tz }), encoding: 'utf8' });
    const rows = JSON.parse(out);
    rows.forEach(row => {
      const local = E.calendar(Date.parse(row.t), data.terms);
      check(row.c.year === local.year && row.c.month === local.month && row.c.day === local.day && row.c.hour === local.hour && row.c.stamp === local.stamp, tz + ' ' + row.t);
      check(row.v === at(row.t).month.verdict, tz + ' 月断');
    });
  });
});

function stampIso(ms) {
  const s = E.stamp(ms);
  return s.replace(' ', 'T') + '+08:00';
}
function monthAt(iso) {
  const r = at(iso);
  return r;
}

test('2026-11-15 己亥：本气禄与申中长生分开，印未透', () => {
  const r = monthAt('2026-11-15T12:00:00+08:00');
  check(r.calendar.month === '己亥' && r.calendar.year === '丙午', '历法月份');
  const v = r.month.verdict;
  check(v.includes('亥') && v.includes('禄') && v.includes('伤官见官'), '这个月转到见官，并见到禄');
  check(r.month.mechanisms.waterZhong.some(x => x.z === '申' && x.qi === '中气'), '申中长生留在结构里，不写进月断主句');
  check(!/水当令|木当令|金当令|火当令|土当令/.test(v), '月断不是季令套话');
  check(r.month.mechanisms.capacity && !r.month.mechanisms.source, '承载标志不能再代表印有效');
  check(r.month.mechanisms.sealPath === 'hidden', '印路径');
  check(r.month.mechanisms.waterBen.some(x => x.z === '亥') && r.month.mechanisms.waterZhong.some(x => x.z === '申'), '根的分类');
  check(r.month.mechanisms.waterZhong.every(x => x.qi === '中气'), '申不是本气水根');
  check(r.month.key.length === 2, '依据仍是两条');
  check(r.month.careerText !== r.month.wealth && r.month.careerText.includes('正官') && r.month.wealth.includes('根'), '事业看正官，财运看根');
  check(/己正官/.test(r.month.careerText+r.month.verdict) && /戊七杀/.test(r.month.careerText) && !/己七杀|伤官见官的底子/.test(r.month.careerText+r.month.verdict), '己是正官，戊才是七杀');
  check(!/^(改善|加重|未决|主矛盾未改)/.test(r.month.verdict), '不再用四个标签起句');
});

test('2026-12-15 庚子：刃、长生、余气和乙庚争合都在，印未被勾销', () => {
  const r = monthAt('2026-12-15T12:00:00+08:00');
  check(r.calendar.month === '庚子', '月份');
  const v = r.month.verdict;
  check(v.includes('刃') && r.month.mechanisms.waterZhong.some(x => x.z === '申'), '刃在月断，长生留在根里');
  check(v.includes('庚') && v.includes('乙') && v.includes('争合'), '透印与伤官相牵');
  check(v.includes('丙') && v.includes('印还在') && !/没有生效|已经无效/.test(v), '丙来制只是牵制，印还在');
  check(r.month.careerText !== r.month.wealth, '事业与财运不是同一句');
  check(!v.includes('克尽') && !v.includes('失效') && !v.includes('偏有利'), '没有旧结论');
  check(r.month.mechanisms.sealPath === 'tangled' && r.month.mechanisms.source === false, '牵住不等于无效');
  check(r.month.graph.roots.some(x => x.g === '庚' && x.z === '巳' && x.qi === '余气'), '巳中庚是余气');
  check(r.month.graph.roots.some(x => x.g === '庚' && x.z === '申' && x.qi === '本气' && x.disturbed), '申中庚受牵仍在');
});

test('2027-02-15 壬寅：木令泄身，申中壬不算亥子，流日不改这条月断', () => {
  const r = atDay('2027-02-15T12:00:00+08:00');
  check(r.calendar.year === '丁未' && r.calendar.month === '壬寅', '立春后的年月');
  const v = r.month.verdict;
  check(!/水当令|木当令/.test(v), '不按木令套断');
  check(v.includes('伤官生财当令') && v.includes('申中壬') && v.includes('不是亥子') && !v.startsWith('申') && !v.startsWith('寅'), '当令是主势，冲只牵动长生');
  check(!/比不得亥子|未添亥子/.test(v + r.month.wealth), '财运不拿根的等级代替这个月');
  check(r.month.reading.pattern === '财格' && r.month.reading.issue === '伤官生财当令' && r.month.reading.prev === '财生杀', '承接上一年的财生杀，月令才换主导');
  check(r.month.mechanisms.waterBen.length === 0 && r.month.mechanisms.waterZhong.some(x => x.z === '申'), '分类');
  check(r.month.mechanisms.drain && !r.month.mechanisms.capacity, '泄身不是得水令');
  check(r.month.graph.relations.some(rel => rel.kind === '干合' && rel.pair.includes('丁') && rel.pair.includes('壬')), '丁壬合仍在图里');
  check(!v.includes('干合'), '首页不把干合写成主势');
  check(r.year.mechanisms.flow === '' && r.year.verdict.includes('不占月令'), '流年不占月令');
  check(r.year.graph.groups.some(x => x.chars.includes('巳') && x.chars.includes('午') && x.chars.includes('未')), '巳午未留在关系里');
  const bare = at('2027-02-15T12:00:00+08:00');
  check(bare.month.verdict === r.month.verdict && bare.year.verdict === r.year.verdict, '带上流日仍是同一月断');
  check(r.day.verdict.includes('不据一日推翻'), '日断自己写明不推翻');
  check(r.day.parent === r.month && r.month.parent === r.year && r.year.parent === r.dayun, '层级');
});

test('同月不同年：子月的庚与壬、酉月的丙辛合与无合', () => {
  const a = E.atPillars('丙午', '庚子').month;
  const b = E.atPillars('丁未', '壬子').month;
  check(a.verdict !== b.verdict, '两个子月被写成同一句');
  check(a.verdict.includes('庚') && a.verdict.includes('乙') && !b.verdict.includes('庚偏印'), '庚子的印是庚');
  check(b.mechanisms.sealPath === 'hidden' && !/庚偏印透出/.test(b.verdict) && /藏/.test(b.careerText) && /不能证实/.test(b.careerText), '壬子月不透庚，藏印未证');
  check(a.mechanisms.waterBen.some(x => x.z === '子') && b.mechanisms.waterBen.some(x => x.z === '子'), '两边都有刃');
  check(a.mechanisms.waterZhong.some(x => x.z === '申') && b.mechanisms.waterZhong.some(x => x.z === '申'), '两边都保留申中壬');
  const x = E.atPillars('丙午', '辛酉').month;
  const y = E.atPillars('壬子', '辛酉').month;
  const z = E.atPillars('丁未', '己酉').month;
  check(x.verdict !== y.verdict && y.verdict !== z.verdict, '酉月三种岁运没有分开');
  check(x.mechanisms.sealPath === 'tangled' && x.verdict.includes('丙') && x.verdict.includes('相合') && !x.verdict.includes('乙'), '辛合的是丙，不是乙');
  check(x.mechanisms.cleanBen.some(r => r.z === '酉') && /印还在/.test(x.verdict) && !/没有生效|已经无效|生财变窄|被克尽|合死/.test(x.verdict + x.wealth), '有合有制时印还在，生财未被收窄');
  check(x.verdict !== y.verdict && x.careerText !== y.careerText, '同一辛酉，岁运不同则论断不同');
  check(y.mechanisms.sealPath === 'open' && y.mechanisms.source === false, '路径清楚也不再使用旧的有效开关');
  check(y.verdict.includes('克伤官') && y.wealth.includes('生财'), '印生身与财源分开说');
  check(z.mechanisms.sealPath === 'hidden' && z.mechanisms.hiddenSeal.some(h => h.z === '酉' && h.qi === '本气') && /不能证实/.test(z.careerText) && z.careerText.includes('官') && !z.wealth.includes('事业') && !/一部分|已经化/.test(z.verdict + z.careerText + z.wealth), '藏印不写成已经化掉');
});

test('亥月跨年：己亥与辛亥不是同一条印', () => {
  const early = monthAt('2026-11-15T12:00:00+08:00').month;
  const late = monthAt('2027-11-15T12:00:00+08:00').month;
  check(late.layer && monthAt('2027-11-15T12:00:00+08:00').calendar.month === '辛亥', '2027 亥月');
  check(early.verdict !== late.verdict, '两个亥月相同');
  check(late.verdict.includes('辛') && late.verdict.includes('禄') && late.mechanisms.sealPath === 'tangled', '辛亥透印仍受牵');
  check(!late.verdict.includes('乙'), '辛被写成与乙相牵');
  check(early.mechanisms.sealPath === 'hidden', '己亥印未透');
});

test('流日更换不改年月对象', () => {
  const base = E.atPillars('丙午', '庚子');
  const frozen = JSON.stringify({ y: base.year.verdict, m: base.month.verdict, u: base.dayun.verdict, nodes: base.month.nodes.map(n => n.gz) });
  ['甲子', '丙午', '庚申', '壬寅', '乙亥', '戊午'].forEach(day => {
    const r = E.atPillars('丙午', '庚子', day);
    check(r.year.verdict === base.year.verdict && r.month.verdict === base.month.verdict && r.dayun.verdict === base.dayun.verdict, day + ' 改了年月');
    check(r.day.parent === r.month, day + ' 父级');
    check(r.month.nodes.length === 7 && r.day.nodes.length === 8, day + ' 节点数');
    const again = JSON.stringify({ y: base.year.verdict, m: base.month.verdict, u: base.dayun.verdict, nodes: base.month.nodes.map(n => n.gz) });
    check(again === frozen, day + ' 回写了父层');
  });
  check(monthAt('2026-11-15T12:00:00+08:00').year.verdict === monthAt('2026-12-15T12:00:00+08:00').year.verdict, '同一丙午年被月改写');
  check(monthAt('2026-12-15T12:00:00+08:00').year.verdict !== monthAt('2027-02-15T12:00:00+08:00').year.verdict, '换年之后岁断仍相同');
});

test('原局与戊申运的底子不变，冲合不拔申', () => {
  const r = E.atPillars('丙午', '己亥');
  check(r.natal.dominant.includes('财旺身弱') && r.natal.dominant.includes('不从财'), '原局');
  check(r.natal.verdict.includes('巳中庚的余气') && r.natal.verdict.includes('不从财'), '原局印轻');
  check(r.dayun.gz === '戊申', '大运');
  check(r.dayun.verdict.includes('申中壬') && r.dayun.verdict.includes('不拔'), '大运根');
  check(r.dayun.graph.relations.some(rel => rel.kind === '冲' && rel.pair.includes('寅') && rel.pair.includes('申')), '寅申冲还在');
  check(r.dayun.graph.relations.some(rel => rel.kind === '合' && rel.pair.includes('巳') && rel.pair.includes('申')), '巳申合还在');
  const shen = r.dayun.graph.roots.filter(x => x.z === '申' && x.g === '壬');
  check(shen.length > 0 && shen.every(x => x.qi === '中气' && x.disturbed), '申中壬受牵但仍是根');
});

test('范围内每个节令月都能算出，相邻月令不同则断语不同', () => {
  const seen = [];
  data.terms.forEach(t => {
    const mid = t.ms + 86400000;
    const next = data.terms.find(x => x.ms > t.ms);
    if (!next || mid >= next.ms) return;
    const stamp = E.stamp(mid);
    if (stamp.slice(0, 10) < data.range[0] || stamp.slice(0, 10) > data.range[1]) return;
    const r = E.at(mid, data.terms, false);
    check(r.calendar.month === t.month && r.calendar.year === t.year, t.name + ' 月中');
    check(r.month.key.length === 2 && r.month.verdict && r.month.careerText !== r.month.wealth, t.name + ' 断语');
    check(!/偏有利|偏不利|未添亥子|印被克尽|已经失效|一部分|做不满|没有生效|财没有到手|不推定职位|事业取|财运取|杀格/.test(r.month.verdict + r.month.careerText + r.month.wealth + r.month.maxim), t.name + ' 旧断');
    const blob = r.month.verdict + r.month.careerText + r.month.wealth + r.month.maxim;
    check(r.month.reading && r.month.reading.pattern === '财格' && r.month.reading.issue && r.month.reading.prev !== undefined, t.name + ' 承接');
    check(!/透财有根/.test(blob) || r.month.reading.wealthRooted, t.name + ' 透财有根没有本气');
    const showSeal = r.month.mechanisms.sealShows.length > 0;
    const tied = r.month.mechanisms.sealPartners.length > 0 || r.month.mechanisms.pressed;
    if (r.month.reading.rescue === 'limited') {
      check(showSeal && tied && /被牵住/.test(blob), t.name + ' 写成被牵但没有合或制');
      r.month.mechanisms.sealPartners.forEach(p => check(blob.includes(p[p.length - 1]), t.name + ' 没写出合的对象'));
      if (r.month.mechanisms.pressed) r.month.mechanisms.pressShows.forEach(p => check(blob.includes(p[0]), t.name + ' 没写出制的对象'));
    } else {
      check(!/被牵住|做不满/.test(blob), t.name + ' 没有合制仍写被牵');
    }
    if (r.month.reading.rescue === 'hidden') check(/不能证实/.test(blob) && !/一部分|只做了|已经化/.test(blob), t.name + ' 藏印被写成已化');
    if (r.month.reading.rescue === 'usable') check(/变窄/.test(r.month.wealth) && !/被牵住/.test(blob), t.name + ' 印可用却没约束生财');
    seen.push({ month: t.month, flow: r.month.mechanisms.flow, verdict: r.month.verdict });
  });
  check(seen.length >= 14, '节令月数量');
  const flows = {};
  seen.forEach(s => { flows[s.flow] = (flows[s.flow] || 0) + 1; });
  ['水', '木', '火', '金', '土'].forEach(el => check(flows[el] >= 1, '缺了' + el + '令'));
  for (let i = 1; i < seen.length; i++) {
    if (seen[i].month[1] !== seen[i - 1].month[1]) check(seen[i].verdict !== seen[i - 1].verdict, seen[i].month + ' 与上月相同');
  }
});

test('同季令不同透干，结论不是季令函数', () => {
  const water = ['壬亥', '己亥', '丙子', '庚子'].map(gz => E.atPillars('丙午', gz).month);
  check(water.every(m => m.mechanisms.flow === '水'), '都是水月');
  check(new Set(water.map(m => m.verdict)).size === 4, '四个水月不能一句套完');
  check(water[0].verdict.includes('禄') && !water[0].verdict.includes('偏财') && water[2].verdict.includes('财') && water[2].verdict.includes('刃'), '壬亥论禄，丙子同时看见财和刃');
  const wood = [E.atPillars('丁未', '壬寅').month, E.atPillars('丁未', '乙卯').month];
  check(wood[0].mechanisms.flow === '木' && wood[1].mechanisms.flow === '木' && wood[0].verdict !== wood[1].verdict, '寅卯不能因同属木而同断');
  const metal = [E.atPillars('壬子', '辛酉').month, E.atPillars('丁未', '己酉').month];
  check(metal[0].mechanisms.flow === '金' && metal[1].mechanisms.flow === '金', '都是金月');
  check(metal[0].verdict.includes('印') && metal[0].careerText.includes('印') && metal[1].careerText.includes('官') && metal[0].verdict !== metal[1].verdict, '透印与透官在金月不是一句');
  const fire = [E.atPillars('丙午', '丙午').month, E.atPillars('丙午', '壬午').month];
  check(fire[0].mechanisms.flow === '火' && fire[1].mechanisms.flow === '火' && fire[0].verdict !== fire[1].verdict, '透财与比劫在午月不同');
  check(fire[0].wealth.includes('财') && !fire[1].verdict.includes(fire[0].verdict), '午月本身不单独决定断语');
});

test('同月干、不同岁运，断语会变', () => {
  const a = E.atPillars('丙午', '庚子').month;
  const b = E.atPillars('壬子', '庚子').month;
  check(a.verdict !== b.verdict && a.careerText !== b.careerText, '两个庚子被写成同一句');
  check(a.verdict.includes('丙') && !b.verdict.includes('丙偏财'), '只有丙午年的庚子提到透财来制');
  check(a.wealth.includes('刃') && b.wealth.includes('刃'), '财运都看见刃，岁运改的是印的约束');
});

test('事业与财运分开，救应不足不成格', () => {
  check(!/己亥|庚子|壬寅月|2026|2027/.test(engineSrc), '判断代码写进了展示月');
  const samples = [['甲寅','癸亥'],['壬子','甲午'],['丙午','辛酉'],['壬子','辛酉'],['丁未','己酉'],['丙午','庚子']];
  samples.forEach(p => {
    const m = E.atPillars(p[0], p[1]).month;
    check(m.careerText !== m.wealth, p.join(' ') + ' 事业财运相同');
    check(m.careerText.length > 12 && m.wealth.length > 12, p.join(' ') + ' 断语过空');
  });
  const openSeal = E.atPillars('壬子', '辛酉').month;
  const blocked = E.atPillars('丙午', '辛酉').month;
  const yun = E.atPillars('丙午', '庚子').dayun;
  check(openSeal.mechanisms.sealPath === 'open' && openSeal.reading.issue === '印化杀' && openSeal.careerText.includes('印') && /变窄/.test(openSeal.wealth), '印生身用得上时，生财被收窄');
  check(blocked.mechanisms.sealPath !== 'open' && blocked.reading.issue !== '印化杀' && /印还在/.test(blocked.verdict) && !/变窄|没有生效|已经无效/.test(blocked.wealth), '同一印生身，合制在时不收窄生财');
  check(/藏/.test(yun.verdict) && /不能证实/.test(yun.verdict) && yun.verdict.includes('七杀') && yun.reading.pattern === '财格' && !/伤官见官|没有生效|一部分/.test(yun.verdict+yun.careerText+yun.wealth) && yun.careerText!==yun.wealth, '大运是七杀配藏印，藏印不是已化的比例');
  const strike = E.atPillars('壬子', '甲午').month;
  check(strike.verdict.includes('冲') && strike.wealth.includes('根') && strike.careerText.includes('杀') && strike.reading.pattern === '财格', '冲只是牵动，事业仍按杀，不改成杀格');
});

test('同庚子：换前置年，以及去掉合制之后，不再写被牵', () => {
  const withFire = E.atPillars('丙午', '庚子').month;
  const noFire = E.atPillars('壬子', '庚子').month;
  check(withFire.gz === noFire.gz, '当层干支应相同');
  check(withFire.reading.issue === '财生杀' && withFire.reading.prev === '财生杀', '丙午年的庚子承接财生杀');
  check(noFire.reading.issue === '伤官制杀' && noFire.reading.prev === '伤官制杀', '壬子年的庚子承接伤官制杀');
  check(withFire.reading.pattern === '财格' && noFire.reading.pattern === '财格', '见杀不把财格改名');
  check(withFire.careerText !== noFire.careerText && withFire.careerText !== withFire.wealth && noFire.careerText !== noFire.wealth, '事业和财运不是同一条主导');
  check(/丙/.test(withFire.verdict) && !/丙偏财/.test(noFire.verdict + noFire.careerText + noFire.wealth), '没有丙就不写丙来制');
  check(/透财有根/.test(withFire.wealth) && withFire.reading.wealthRooted && !/透财有根/.test(noFire.verdict + noFire.careerText + noFire.wealth + noFire.maxim), '透财有根只在这一干真有本气时出现');
  const bareSrc = engineSrc.replace("['原月','乙巳'],['日主','壬寅'],['原时','乙巳']", "['原月','甲巳'],['日主','壬寅'],['原时','甲巳']");
  const bare = load(bareSrc).atPillars('壬子', '庚子').month;
  const bareBlob = bare.verdict + bare.careerText + bare.wealth + bare.maxim;
  check(bare.mechanisms.sealPartners.length === 0 && bare.mechanisms.pressed === false && bare.reading.rescue === 'visible', '控制样例没有合，也没有透财来制');
  check(!/被牵住|做不满|争合|丙偏财|化杀因此/.test(bareBlob), '没有牵制依据仍写被牵或做不满');
  check(/没有合/.test(bare.verdict), '无合时要写明没有合');
});

test('财格未改时，事业与财运的主导可以不同', () => {
  const hai = E.atPillars('丙午', '己亥').month;
  const zi = E.atPillars('丙午', '庚子').month;
  const yin = E.atPillars('丁未', '壬寅').month;
  [hai, zi, yin].forEach(m => check(m.reading.pattern === '财格' && !/杀格/.test(m.verdict + m.careerText + m.wealth), m.gz + ' 被改成杀格'));
  check(hai.reading.issue === '伤官见官' && zi.reading.issue === '财生杀' && yin.reading.issue === '伤官生财当令', '三个月主导不同');
  check(hai.careerText.includes('正官') && !hai.wealth.includes('伤官见正官') && hai.wealth.includes('禄'), '己亥事业见官，财运看禄');
  check(zi.careerText.includes('财去生杀') && zi.wealth.includes('刃') && /没有被收窄/.test(zi.wealth), '庚子事业看财生杀，财运看刃且生财未收窄');
  check(yin.careerText.includes('伤官生财当令') && yin.wealth.includes('当令') && yin.wealth.includes('没有跟着变松') && !/比不得|禄刃弱/.test(yin.wealth), '壬寅财运相对上一层，不拿禄刃等级作结论');
});

test('2026己亥、庚子与2027壬寅由新旧引擎实际执行', () => {
  const { execFileSync } = require('child_process');
  const oldHtml = execFileSync('git', ['show', 'origin/main:index.html'], { encoding: 'utf8' });
  const oldSrc = oldHtml.match(/<script>([\s\S]*?)<\/script>/)[1];
  const oldE = load(oldSrc);
  const dates = ['2026-11-15T12:00:00+08:00', '2026-12-15T12:00:00+08:00', '2027-02-15T12:00:00+08:00'];
  const rows = dates.map(iso => {
    const neu = E.at(Date.parse(iso), data.terms, false);
    const old = oldE.at(Date.parse(iso), data.terms, false);
    return { iso, month: neu.calendar.month, flow: neu.month.mechanisms.flow, before: old.month.verdict, after: neu.month.verdict, career: neu.month.careerText, wealth: neu.month.wealth, maxim: neu.month.maxim };
  });
  check(new Set(rows.map(r => r.after)).size === 3, '三个月断语相同');
  check(rows[0].flow === '水' && rows[1].flow === '水' && rows[0].after !== rows[1].after, '两个水月被季令收成一句');
  rows.forEach(r => {
    check(r.after !== r.before, r.month + ' 没有比合并前发生变化');
    check(r.after.includes(r.month[0]) || r.after.includes(r.month[1]), r.month + ' 断语没提到实际干支');
    check(!/偏有利|偏不利|印被克尽|已经失效/.test(r.after), r.month + ' 回到旧吉凶');
  });
  fs.writeFileSync(path.join(__dirname, 'before-after.json'), JSON.stringify(rows, null, 2));
});

const summary = {
  passed: true,
  cases: cases.length,
  assertions,
  caseList: cases
};
fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ passed: true, cases: cases.length, assertions, caseList: cases.map(c => c.name + ':' + c.assertions) }, null, 2));
