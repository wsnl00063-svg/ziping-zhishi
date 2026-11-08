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
  check(data.version === 'ZS-v4.1', '版本');
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
  check(v.includes('亥') && v.includes('禄') && v.includes('申中壬') && v.includes('长生'), '根的区别');
  check(v.includes('印未透') && v.includes('丙') && v.includes('不强断'), '印与岁');
  check(v.includes('巳火'), '出生月令还在');
  check(!/水当令/.test(v) || /亥水当令/.test(v), '月令');
  check(r.month.mechanisms.capacity && !r.month.mechanisms.source, '承载标志不能再代表印有效');
  check(r.month.mechanisms.sealPath === 'hidden', '印路径');
  check(r.month.mechanisms.waterBen.some(x => x.z === '亥') && r.month.mechanisms.waterZhong.some(x => x.z === '申'), '根的分类');
  check(r.month.mechanisms.waterZhong.every(x => x.qi === '中气'), '申不是本气水根');
  check(r.month.key.length === 2, '依据仍是两条');
  check(r.month.branch === 'reviewed', '不再走旧的吉凶分支');
});

test('2026-12-15 庚子：刃、长生、余气和乙庚争合都在，印未被勾销', () => {
  const r = monthAt('2026-12-15T12:00:00+08:00');
  check(r.calendar.month === '庚子', '月份');
  const v = r.month.verdict;
  check(v.includes('刃') && v.includes('申中壬') && v.includes('长生'), '刃与长生');
  check(v.includes('庚') && v.includes('乙') && v.includes('争合') && v.includes('余气'), '透印与余气');
  check(v.includes('丙') && v.includes('印还在') && v.includes('不因此作吉'), '财制印未尽');
  check(!v.includes('克尽') && !v.includes('失效') && !v.includes('偏有利'), '没有旧结论');
  check(r.month.mechanisms.sealPath === 'tangled' && r.month.mechanisms.source === false, '牵住不等于无效');
  check(r.month.graph.roots.some(x => x.g === '庚' && x.z === '巳' && x.qi === '余气'), '巳中庚是余气');
  check(r.month.graph.roots.some(x => x.g === '庚' && x.z === '申' && x.qi === '本气' && x.disturbed), '申中庚受牵仍在');
});

test('2027-02-15 壬寅：木令泄身，申中壬不算亥子，流日不改这条月断', () => {
  const r = atDay('2027-02-15T12:00:00+08:00');
  check(r.calendar.year === '丁未' && r.calendar.month === '壬寅', '立春后的年月');
  const v = r.month.verdict;
  check(v.includes('木当令') && !v.includes('水当令'), '月令是木');
  check(v.includes('申中壬') && v.includes('不是亥子') && v.includes('长生'), '只认中气长生');
  check(!v.includes('未添亥子'), '不再把申中壬说成没有根');
  check(r.month.mechanisms.waterBen.length === 0 && r.month.mechanisms.waterZhong.some(x => x.z === '申'), '分类');
  check(r.month.mechanisms.drain && !r.month.mechanisms.capacity, '泄身不是得水令');
  check(v.includes('干合') && v.includes('丁'), '岁干的合还在');
  check(r.year.verdict.includes('巳午未') && r.year.verdict.includes('不占月令'), '流年不占月令');
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
  check(b.verdict.includes('比肩') && b.verdict.includes('丁') && b.mechanisms.sealPath === 'hidden', '壬子没有透印');
  check(a.mechanisms.waterBen.some(x => x.z === '子') && b.mechanisms.waterBen.some(x => x.z === '子'), '两边都有刃');
  check(a.mechanisms.waterZhong.some(x => x.z === '申') && b.mechanisms.waterZhong.some(x => x.z === '申'), '两边都保留申中壬');
  const x = E.atPillars('丙午', '辛酉').month;
  const y = E.atPillars('壬子', '辛酉').month;
  const z = E.atPillars('丁未', '己酉').month;
  check(x.verdict !== y.verdict && y.verdict !== z.verdict, '酉月三种岁运没有分开');
  check(x.mechanisms.sealPath === 'tangled' && x.verdict.includes('丙') && x.verdict.includes('相合') && !x.verdict.includes('乙'), '辛合的是丙，不是乙');
  check(x.verdict.includes('酉中辛') && x.verdict.includes('印还在') && !/克尽|失效|偏有利/.test(x.verdict), '有根的财没有把印勾销');
  check(y.mechanisms.sealPath === 'open' && y.mechanisms.source === false, '路径清楚也不再使用旧的有效开关');
  check(y.verdict.includes('克伤官') && y.verdict.includes('不因此作吉') && y.verdict.includes('申中壬'), '见金不作吉，申与子分开');
  check(z.mechanisms.sealPath === 'hidden' && z.verdict.includes('印未透') && z.verdict.includes('酉中辛') && z.verdict.includes('金当令'), '藏在酉里的辛不等于透印');
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
    check(r.month.verdict.includes('不强断') && r.month.key.length === 2, t.name + ' 断语');
    check(!/偏有利|偏不利|克尽|失效|必吉|未添亥子/.test(r.month.verdict + r.month.wealth + r.month.maxim), t.name + ' 旧断');
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

const summary = {
  passed: true,
  cases: cases.length,
  assertions,
  caseList: cases
};
fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ passed: true, cases: cases.length, assertions, caseList: cases.map(c => c.name + ':' + c.assertions) }, null, 2));
