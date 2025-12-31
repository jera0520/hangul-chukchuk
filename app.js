/* 한글 척척: 양식 올리기 → 부탁 적기 → 고르기 → 확인하고 받기.
 * 한글 파일은 이 컴퓨터 안(브라우저)에서 엔진(hwpdoc.py, Pyodide)으로 만들고 rhwp로 미리 본다.
 * AI에는 개인정보를 가린 글만 보내고, 받은 결과에서 가린 말을 원래대로 되돌린 뒤 사진을 넣는다.
 */
import { loadEngine, runEngine } from './engine/engine.js';
import { SITE, connectAI, refs, pasteAI, cleanPasted, flatAnswer, aiErrorText, firstPrompt, answerPrompt, fixPrompt, editPrompt, readAnswer } from './ai.js';

// HG(개인정보 가리개 기능)는 lib/masker/core.js가 전역으로 만든다(classic script의 const라 window.HG는 없음)
const $ = s => document.querySelector(s);
const ENC = new TextEncoder();
const DEC = new TextDecoder();

function el(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k in e) e[k] = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : String(c));
  return e;
}

function say(box, lines, ok) {
  $(box).replaceChildren(...[].concat(lines || []).filter(Boolean).map(t => el('p', { class: ok ? 'ok' : '', text: t })));
}

// ------------------------------------------------------------ 움직임 도우미(모양은 index.html의 「움직임」 묶음)
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
// 같은 효과를 다시 보이게 하려면 클래스를 뗐다가 다음 그림에서 붙인다.
// 움직임이 안쪽 요소에서 일어나면(ms를 주면) 그 시간 뒤에 클래스를 뗀다
const replayT = new WeakMap();
function replay(nodes, cls, ms) {
  for (const n of [].concat(nodes).filter(Boolean)) {
    n.classList.remove(cls);
    void n.offsetWidth;
    n.classList.add(cls);
    if (ms) {
      const t = replayT.get(n) || {};
      clearTimeout(t[cls]);
      t[cls] = setTimeout(() => n.classList.remove(cls), ms);
      replayT.set(n, t);
      continue;
    }
    n.addEventListener('animationend', function off(e) {
      if (e.target !== n) return;
      n.classList.remove(cls);
      n.removeEventListener('animationend', off);
    });
  }
}
// 단추 글을 잠깐 「됐다」로 바꿨다가 되돌린다(복사·받기)
const doneTimers = new WeakMap();
function doneFor(btn, text, ms = 2400) {
  if (!doneTimers.has(btn)) btn.dataset.label = btn.textContent;
  clearTimeout(doneTimers.get(btn));
  btn.textContent = text;
  btn.classList.add('done');
  doneTimers.set(btn, setTimeout(() => { btn.textContent = btn.dataset.label; btn.classList.remove('done'); doneTimers.delete(btn); }, ms));
}
// 방금 나타난 다음 단추가 화면 밖이면 보이는 곳까지만 굴려 준다
function reveal(node) {
  const r = node.getBoundingClientRect();
  if (r.top < 0 || r.bottom > innerHeight - 96) node.scrollIntoView({ block: 'nearest', behavior: calm() ? 'auto' : 'smooth' });
}
// 파일 고르기 칸(label)도 Tab으로 가서 Enter·Space로 누를 수 있게 한다
function keyable(lb) {
  lb.tabIndex = 0;
  lb.setAttribute('role', 'button');
  lb.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    document.getElementById(lb.htmlFor).click();
  });
}
// 휴대폰(손가락으로만 누르는 좁은 화면): 끌어다 놓기를 못 하므로 끌기 그림을 빼고(index.html), 양식 칸 시연 대신 「기본 보고서 틀로 시작하기」를 가리킨다
const phone = () => matchMedia('(hover: none) and (pointer: coarse) and (max-width: 600px)').matches;
// 양식 칸 시연: 한글 파일이 손에 들려 칸 안 받침으로 들어간다(처음 한 번, 한동안 가만히 있으면 한두 번 더)
function dropDemo() {
  if (calm() || phone()) return;
  replay($('#f-drop'), 'demo', 1800);
}
// 부탁 글 칸이 비어 있으면 예시 하나가 한 글자씩 써진다(2초쯤, 5초를 넘기지 않게). 칸을 누르거나 글을 쓰면 멈추고,
// 다 쓰면 잠시 뒤 원래 안내로 돌아간다. 한동안 가만히 있으면 다음 예시로 한 번 더(nudge)
const REQ_DEMO = ['2학기 취업 특강 결과 보고서 써 줘. 9월 15일부터 4번, 25명 참여.', '내년 1학기 운영 계획(안) 써 줘. 3~6월 16주, 30명 모집.', '오늘 스터디 일지 칸 채워 줘. 자기소개서 첨삭을 했어요.'];
const REQ_PH = $('#req').placeholder;
let typeT = 0, typeK = 0;
function typeDemo() {
  clearTimeout(typeT);
  const req = $('#req');
  const stop = () => { clearTimeout(typeT); req.placeholder = REQ_PH; };
  if (calm()) return stop();
  const t = REQ_DEMO[typeK++ % REQ_DEMO.length];
  let i = 0;
  const tick = () => {
    if (st.step !== 2 || req.value || document.activeElement === req) return stop();
    req.placeholder = '예) ' + t.slice(0, i);
    if (i < t.length) { i++; typeT = setTimeout(tick, 55); return; }
    typeT = setTimeout(stop, 3000);
  };
  typeT = setTimeout(tick, 700);
}

const ERR = {
  hwp: n => `「${n}」을(를) 열지 못했습니다. 한글에서 [파일] → [다른 이름으로 저장하기] → 파일 형식 'HWPX 문서'로 저장해 올려 주세요.`,
  nothwpx: n => `「${n}」은(는) 한글 파일이 아닙니다. .hwpx나 .hwp 파일을 올려 주세요.`,
  locked: n => `「${n}」은(는) 문서보안(DRM)으로 잠긴 파일로 보여 열 수 없습니다. 기관 문서보안 프로그램에서 보안을 해제한 파일로 다시 올려 주세요(방법은 전산 담당자에게).`,
  broken: n => `「${n}」은(는) 손상되어 열 수 없습니다. 한글에서 다시 저장해 보세요.`,
};
const errText = (e, name) => (e && ERR[e.code] ? ERR[e.code](name) : `「${name}」을(를) 여는 중 문제가 생겼습니다. ${(e && e.message) || ''}`.trim());

const EXAMPLES = [
  '이 양식으로 2학기 취업 특강 결과 보고서를 써 주세요. 9월 15일부터 10월 6일까지 매주 화요일 오후 3시에 본관 2층 세미나실에서 4번 했고, 재학생 25명이 참여했어요. 만족도는 5점 만점에 4.6점이었어요.',
  '이 양식으로 2027학년도 1학기 취업사관학교 운영 계획(안)을 써 주세요. 3월부터 6월까지 16주 동안 하고, 30명을 모집해요. 예산은 아직 몰라요.',
  '오늘 스터디 일지 칸을 채워 주세요. 10월 14일 오후 3시부터 5시까지 도서관 3층 세미나실에서 자기소개서 첨삭을 했어요. 다음 주에는 모의 면접을 해요.',
];

// ------------------------------------------------------------ 상태
const st = {
  step: 1,
  form: null,      // { name, bytes(hwpx), doc(HG), fromHwp, isDefault, photoSlots, pages, info }
  mats: [],        // { name, text, cut }
  photos: [],      // { file, url, caption }
  cands: [],
  manual: [],
  frozen: null,    // AI에 보내는 순간 정한 가리기: { on, map, formBytes, analysis, outline0, slots, fill, request, mats, photoCaps }
  qa: null,
  call: null,
  result: null,    // { body, built, log, final, pages, svgUrls, missing, slotCount, photoCount }
  hist: [],        // 고치기 전 결과들(앞 결과로 되돌리기): { body, built, log }
  busy: false,
};

// ------------------------------------------------------------ 오래 걸리는 일 표시줄
let busyTimer = null;
function busyOn(text, stop) {
  $('#busy-text').textContent = text;
  $('#busy').hidden = false;
  const t0 = performance.now();
  clearInterval(busyTimer);
  $('#busy-time').textContent = '';
  busyTimer = setInterval(() => { $('#busy-time').textContent = Math.round((performance.now() - t0) / 1000) + '초'; }, 1000);
  const b = $('#busy-stop');
  b.hidden = !stop;
  b.onclick = stop || null;
}
function busyText(text) { $('#busy-text').textContent = text; }
function busyOff() { clearInterval(busyTimer); $('#busy').hidden = true; }

// ------------------------------------------------------------ 엔진(한 번에 하나씩)
const T0 = performance.now();
const engineP = loadEngine(s => { $('#eng-status').textContent = '한글 엔진 준비 중: ' + s; });
engineP.then(() => {
  $('#eng-status').replaceChildren('한글 엔진 ', el('b', { text: '준비됨' }), ' · ' + ((performance.now() - T0) / 1000).toFixed(1) + '초');
}, e => {
  $('#eng-status').textContent = '한글 엔진을 불러오지 못했습니다. 페이지를 새로 열어 주세요. (' + (e && e.message) + ')';
});
let engQ = Promise.resolve();
function eng(argv, files, outs, mod) {
  const p = engQ.then(() => engineP).then(() => runEngine(argv, files, outs, mod));
  engQ = p.catch(() => {});
  return p;
}

// ------------------------------------------------------------ rhwp(미리보기·.hwp 바꾸기)
let rhP = null;
function rhwp() {
  if (!rhP) {
    rhP = (async () => {
      let ctx = null, last = '';
      globalThis.measureTextWidth = (font, text) => {
        if (!ctx) ctx = document.createElement('canvas').getContext('2d');
        if (font !== last) { ctx.font = font; last = font; }
        return ctx.measureText(text).width;
      };
      const rh = await import('./lib/rhwp/rhwp.js');
      await rh.default({ module_or_path: new URL('lib/rhwp/rhwp_bg.wasm', location.href) });
      return rh;
    })();
    rhP.catch(() => { rhP = null; });
  }
  return rhP;
}
const freeDoc = d => { try { if (d && d.free) d.free(); } catch (e) { /* 이미 풀림 */ } };
const isCfb = u8 => u8[0] === 0xD0 && u8[1] === 0xCF && u8[2] === 0x11 && u8[3] === 0xE0;

async function pagesOf(bytes, max) {
  const rh = await rhwp();
  const d = new rh.HwpDocument(bytes);
  try {
    const n = d.pageCount();
    const urls = [];
    for (let i = 0; i < Math.min(n, max || 40); i++) {
      urls.push(URL.createObjectURL(new Blob([d.renderPageSvg(i)], { type: 'image/svg+xml' })));
    }
    return { n, urls };
  } finally {
    freeDoc(d);
  }
}

// ------------------------------------------------------------ 단계 이동
let moved = false;
function go(n) {
  const dir = n < st.step ? 'back' : 'next';
  st.step = n;
  for (const s of document.querySelectorAll('section[data-step]')) {
    s.hidden = Number(s.dataset.step) !== n;
    if (moved) s.dataset.dir = dir;
  }
  moved = true;
  for (const li of document.querySelectorAll('#steps li')) {
    const k = Number(li.dataset.n);
    li.className = k === n ? 'now' : (k < n ? 'done' : '');
    li.querySelector('button').disabled = !(k < n);
    if (k === n) li.querySelector('button').setAttribute('aria-current', 'step'); else li.querySelector('button').removeAttribute('aria-current');
  }
  placeInk();
  window.scrollTo({ top: 0 });
}
// 지금 단계 밑줄(.steps::after)의 자리와 너비. 글꼴이 늦게 와서 글자 폭이 바뀌어도 다시 잰다
function placeInk() {
  const ol = $('#steps'), b = ol.querySelector('li.now button');
  if (!b) return;
  ol.style.setProperty('--ink-x', b.offsetLeft + 'px');
  ol.style.setProperty('--ink-y', (b.offsetTop + b.offsetHeight - 3) + 'px');
  ol.style.setProperty('--ink-w', b.offsetWidth + 'px');
  if (!ol.classList.contains('ink')) {
    ol.classList.add('ink');
    requestAnimationFrame(() => requestAnimationFrame(() => ol.classList.add('ink-go')));
  }
}
if (window.ResizeObserver) {
  const ro = new ResizeObserver(() => placeInk());
  ro.observe($('#steps'));
  for (const b of document.querySelectorAll('#steps button')) ro.observe(b);
}
if (document.fonts) document.fonts.ready.then(placeInk);
for (const li of document.querySelectorAll('#steps li')) {
  li.querySelector('button').addEventListener('click', () => {
    const k = Number(li.dataset.n);
    if (k >= st.step || st.busy) return;
    if (k <= 2) unfreeze();
    go(k);
  });
}

// 1·2단계로 돌아가면 AI가 쓴 것은 버리고 다음에 새로 쓴다
function unfreeze() {
  if (st.call && !st.call.done) { st.call.superseded = true; st.call.ctl.abort(); }
  st.call = null;
  st.frozen = null;
  st.qa = null;
  st.result = null;
  st.hist = [];
  $('#undo-row').hidden = true;
  busyOff();
}

// ------------------------------------------------------------ 1단계: 양식
function setupDrop(input, onFiles) {
  input.addEventListener('change', () => { const fs = [...input.files]; input.value = ''; if (fs.length) onFiles(fs); });
  return onFiles;
}

const onForm = setupDrop($('#f-input'), async fs => {
  const f = fs[0];
  await useForm(f.name, new Uint8Array(await f.arrayBuffer()), false);
});

// 파일을 끌어오면 창 어디에 놓아도 받는다: 1단계는 양식, 2단계는 사진·자료. 칸을 빗나가도 브라우저가 파일을 열어 버리지 않는다
const DROP_SMALL = $('#f-drop .drop-small').innerHTML;
let dragN = 0;
const hasFiles = e => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files');
function dropTo() {
  if (st.busy || !$('#paste').hidden) return null;
  if (st.step === 1) return fs => onForm(fs);
  if (st.step === 2) return async fs => {
    const imgs = fs.filter(isImage), mats = fs.filter(f => !isImage(f) && MAT_EXT.test(f.name));
    const other = fs.filter(f => !isImage(f) && !MAT_EXT.test(f.name));
    if (mats.length) await onMats(mats);
    if (imgs.length) await onPhotos(imgs);
    if (other.length) say('#m-msg', other.map(f => `「${f.name}」은(는) 넣을 수 없는 파일입니다. 자료는 .hwpx, .hwp, .txt, .csv 파일만, 사진은 JPG·PNG만 넣을 수 있습니다.`));
  };
  return null;
}
function dragging(on) {
  document.body.classList.toggle('dragging', on);
  const small = $('#f-drop .drop-small');
  if (on) small.textContent = '여기에 놓으세요';
  else small.innerHTML = DROP_SMALL;
}
addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); if (dragN++ === 0 && dropTo()) dragging(true); });
addEventListener('dragleave', e => { if (!hasFiles(e)) return; if (--dragN <= 0) { dragN = 0; dragging(false); } });
addEventListener('dragover', e => { if (!hasFiles(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = dropTo() ? 'copy' : 'none'; });
addEventListener('drop', e => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragN = 0;
  dragging(false);
  const fs = [...(e.dataTransfer.files || [])], to = dropTo();
  if (fs.length && to) to(fs);
});

function b64bytes(t) {
  const bin = atob(t.replace(/\s+/g, ''));
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}
let stdP = null;
const standard = () => (stdP = stdP || fetch('samples/standard_report.hwpx.b64.txt').then(r => r.text()).then(b64bytes));

$('#f-default').addEventListener('click', async () => {
  await useForm('기본 보고서 틀.hwpx', await standard(), true);
});
// 파일 고르기 창을 그냥 닫으면(올릴 양식이 없으면) 「기본 보고서 틀로 시작하기」를 한 번 가리킨다
$('#f-input').addEventListener('cancel', () => { if (!calm() && !st.form && !st.busy) replay($('#f-default'), 'ring'); });

// 양식을 올리면 붙임 자리의 예시 비교 대신 올린 양식의 첫 쪽을 보여 준다
async function showSheet(bytes, cap) {
  const sheet = $('#f-sheet');
  $('#cmp-box').hidden = true;
  $('#cmp-note').hidden = true;
  sheet.hidden = false;
  try {
    const { n, urls } = await pagesOf(bytes, 1);
    sheet.replaceChildren(el('img', { src: urls[0], alt: '양식 첫 쪽 미리보기' }));
    $('#f-cap').textContent = cap + (n > 1 ? ` · 모두 ${n}쪽` : '');
    return n;
  } catch (e) {
    sheet.replaceChildren(el('span', { class: 'wait', text: '미리보기를 만들지 못했습니다' }));
    return 0;
  }
}

async function useForm(name, bytes, isDefault) {
  if (st.busy) return;
  st.busy = true;
  unfreeze();
  say('#f-msg', []);
  $('#f-facts').hidden = true;
  $('#to2').disabled = true;
  busyOn('양식을 읽는 중');
  try {
    let hwpx = bytes, fromHwp = false;
    if (isCfb(bytes)) {
      busyText('옛 한글 파일(.hwp)을 바꾸는 중');
      const rh = await rhwp();
      let d;
      try { d = new rh.HwpDocument(bytes); } catch (e) { throw { code: 'hwp' }; }
      try { hwpx = d.exportHwpx(); } catch (e) { throw { code: 'hwp' }; } finally { freeDoc(d); }
      fromHwp = true;
    }
    const docName = name.replace(/\.hwp$/i, '.hwpx');
    const doc = await HG.openHwpx(docName, hwpx);
    const slots = await HG.photoSlots(doc);
    st.form = {
      name: docName, bytes: hwpx, doc, fromHwp, isDefault, photoSlots: slots.length,
      // 2단계 사진 칸을 양식 그대로 그리려고: 칸마다 설명(양식에 적힌 글)과 가로세로 비
      slotHints: slots.map(x => (x.hint || '').replace(/\s+/g, ' ').trim().slice(0, 30)),
      slotRatios: slots.map(x => (x.w > 0 && x.h > 0 ? Math.min(2, Math.max(.5, x.w / x.h)) : 4 / 3)),
    };
    redetect();
    const pages = await showSheet(hwpx, isDefault ? '고른 양식 · 기본 보고서 틀' : '올린 양식 · ' + name);
    busyText('양식 구조를 살피는 중');
    const { on } = HG.assignTokens(st.cands);
    const masked = on.length ? (await HG.maskFile(doc, on)).bytes : hwpx;
    const an = await analyze(masked);
    st.form.info = an;
    st.form.mode = an.fill ? 'fill' : 'build';
    st.form.pages = pages;
    renderFacts();
    $('#to2').disabled = false;
    requestAnimationFrame(() => reveal($('#to2')));
  } catch (e) {
    st.form = null;
    say('#f-msg', errText(e, name));
  } finally {
    st.busy = false;
    busyOff();
  }
}

// wantSlots: 칸 목록도 뽑을지(없으면 엔진이 칸 채우는 양식으로 볼 때만)
async function analyze(maskedBytes, wantSlots) {
  const r = await eng(['analyze', '/w/f.hwpx', '-o', '/w/o.txt'], { 'f.hwpx': maskedBytes }, ['o.txt']);
  if (r.code !== 0 || !r.files['o.txt']) throw new Error(cleanLog(r.log) || '양식을 분석하지 못했습니다.');
  const analysis = r.log.split(/\n- 개요 파일:/)[0].trim();
  const fill = /서식형 문서입니다/.test(analysis);
  let slots = '';
  const cover = {}, room = {};
  if (wantSlots === undefined ? fill : wantSlots) {
    slots = (await eng(['slots', '/w/f.hwpx'], { 'f.hwpx': maskedBytes }, [])).log;
    // 제출 문구·날짜·서명란 칸(…제출합니다 / 년 월 일 / (서명 또는 인) / ○○장 귀하)은 칸 목록에 줄 전체를 보여 주고 줄 수를 적는다.
    // 목록은 칸 글자를 60자에서 자르므로 AI가 뒤쪽 줄(첨부 서류·귀하)을 모르고 칸을 통째로 다시 써서 줄이 사라졌다
    const cv = await eng(['cover', '/w/f.hwpx'], { 'f.hwpx': maskedBytes }, [], 'extra');
    if (cv.code === 0) {
      for (const line of cv.log.split('\n')) {
        const [k, n, text] = line.split('\t');
        if (!text || !/^T\d+\.\d+\.\d+$/.test(k)) continue;
        cover[k] = +n;
        slots = slots.replace(new RegExp('^' + k.replace(/\./g, '\\.') + ' .*$', 'm'), (k + ' ').padEnd(11) + `[제출 문구·서명란 ${n}줄] ` + text);
      }
    }
    // 쪽 크기 표(법정 서식처럼 쪽마다 글자처럼 취급한 표) 칸에 들어가는 분량. 한글은 칸을 글에 맞춰 늘리는데
    // 이 표는 다음 쪽으로 못 넘어가 쪽 아래가 잘리므로 AI에게 칸마다 분량을 알려 준다(칸 목록 자체는 그대로 둔다)
    const rm = await eng(['room', '/w/f.hwpx'], { 'f.hwpx': maskedBytes }, [], 'extra');
    if (rm.code === 0) {
      for (const line of rm.log.split('\n')) {
        const [k, n, w] = line.split('\t');
        if (/^T\d+\.\d+\.\d+$/.test(k) && +n > 0 && +w > 0) room[k] = [+n, +w];
      }
    }
  }
  return { analysis, outline0: DEC.decode(r.files['o.txt']), fill, slots, cover, room };
}

function cleanLog(log) {
  const m = (log || '').match(/\[안내\]\s*(.+)/);
  return m ? m[1] : '';
}

function renderFacts() {
  const f = st.form, a = f.info.analysis;
  const pick = re => { const m = a.match(re); return m ? m[1] : ''; };
  const title = pick(/- 제목: "([^"]*)"/);
  const amount = pick(/- 분량: ([^\n]+)/).replace(/\(어림\)/, '').trim();
  const tables = pick(/표 (\d+)개/);
  const rows = [];
  if (title) rows.push(['제목', HG.restoreText(title, HG.assignTokens(st.cands).map).text]);
  rows.push(['분량', [amount, tables && tables !== '0' ? `표 ${tables}개` : '', f.photoSlots ? `사진 칸 ${f.photoSlots}곳` : ''].filter(Boolean).join(' · ')]);
  const fillMode = f.mode === 'fill';
  rows.push(['종류', [fillMode ? '칸을 채우는 양식(신청서·일지 같은 것)' : '내용을 새로 쓰는 양식(보고서·계획서 같은 것)', ' ',
    el('button', { type: 'button', class: 'link', id: 'mode-flip', text: fillMode ? '내용을 새로 쓰게 바꾸기' : '칸만 채우게 바꾸기',
      onclick: () => { f.mode = fillMode ? 'build' : 'fill'; renderFacts(); } })]]);
  if (f.fromHwp) rows.push(['파일', '옛 형식(.hwp)을 새 형식으로 바꿔서 씁니다']);
  const n = piCount();
  rows.push(['개인정보', n.kinds ? `${n.total}곳 → AI에 보내기 전에 [이름1]처럼 가립니다` : '찾지 못했습니다(다음 단계에서 더 가릴 수 있습니다)']);
  $('#f-facts').replaceChildren(...rows.flatMap(([k, v]) => [el('dt', { text: k }), el('dd', null, v)]));
  $('#f-facts').hidden = false;
}

$('#to2').addEventListener('click', () => { if (st.form) { go(2); say('#s2-msg', []); paintTo3(false); renderPhotos(); renderSend(); waveWhenSeen(); typeDemo(); } });
$('#back1').addEventListener('click', () => go(1));

// ------------------------------------------------------------ 2단계: 부탁·자료·사진
// 부탁 글이 비어 있으면 「다음」은 테두리만, 글이 생기면 주황으로 바뀌어 한 번 번진다(주황은 지금 누를 곳 하나)
let reqHad = false;
function paintTo3(ring = true) {
  const has = !!$('#req').value.trim();
  $('#to3').classList.toggle('quiet', !has);
  if (has) say('#s2-msg', []);
  if (ring && has && !reqHad) replay($('#to3'), 'ring');
  reqHad = has;
}
for (const b of document.querySelectorAll('[data-ex]')) {
  b.addEventListener('click', () => {
    $('#req').value = EXAMPLES[Number(b.dataset.ex)];
    redetect();
    renderSend();
    paintTo3();
    // 휴대폰에서는 칸을 누르지 않는다(자판이 올라와 예시와 「다음」을 가리므로)
    if (!phone()) $('#req').focus();
  });
}
// 글을 고치면 잠깐 뒤에 가릴 말을 다시 찾는다(부탁 글·사진 설명)
let reqTimer = null;
function redetectSoon() { clearTimeout(reqTimer); reqTimer = setTimeout(() => { redetect(); renderSend(); }, 400); }
$('#req').addEventListener('input', redetectSoon);
$('#req').addEventListener('input', () => paintTo3());
// 휴대폰 자판이 올라와 보이는 화면이 4분의 1 넘게 줄면 html에 .kb를 붙인다(「다음」 줄이 글 칸을 가리지 않게 제자리로, index.html .s2-next).
// 손가락으로 누르는 화면만 보고, 확대해 볼 때는 따지지 않고, 화면을 돌리면 다시 잰다
if (window.visualViewport && matchMedia('(pointer: coarse)').matches) {
  const vv = window.visualViewport;
  let w = innerWidth, full = vv.height;
  vv.addEventListener('resize', () => {
    if (innerWidth !== w) { w = innerWidth; full = vv.height; }
    const zoom = vv.scale > 1.1;
    if (!zoom) full = Math.max(full, vv.height);
    document.documentElement.classList.toggle('kb', !zoom && vv.height < full * 0.75);
  });
}

const MAT_MAX = 30000, MAT_TOTAL = 60000;
const MAT_EXT = /\.(hwpx|hwp|txt|md|csv)$/i;
function decodeText(u8) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(u8).replace(/^﻿/, ''); } catch (e) { /* 한국어 옛 인코딩일 수 있음 */ }
  try { return new TextDecoder('euc-kr').decode(u8); } catch (e) { return DEC.decode(u8); }
}

const onMats = setupDrop($('#m-input'), async fs => {
  const errs = [];
  const n0 = st.mats.length;
  busyOn('자료를 읽는 중');
  try {
    for (const f of fs) {
      if (st.mats.some(m => m.name === f.name)) continue;
      const u8 = new Uint8Array(await f.arrayBuffer());
      let text = '';
      if (/\.(hwpx|hwp)$/i.test(f.name)) {
        const ext = /\.hwp$/i.test(f.name) ? '.hwp' : '.hwpx';
        const r = await eng(['text', '/w/m' + ext], { ['m' + ext]: u8 }, []);
        if (r.code !== 0) { errs.push(`「${f.name}」에서 글자를 꺼내지 못했습니다. ${cleanLog(r.log)}`); continue; }
        text = r.log;
      } else {
        text = decodeText(u8);
      }
      text = text.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      if (!text) { errs.push(`「${f.name}」에는 읽을 글자가 없습니다.`); continue; }
      const used = st.mats.reduce((a, m) => a + m.text.length, 0);
      const room = Math.max(0, Math.min(MAT_MAX, MAT_TOTAL - used));
      if (!room) { errs.push(`자료가 너무 많아 「${f.name}」은(는) 넣지 않았습니다.`); continue; }
      st.mats.push({ name: f.name, text: text.slice(0, room), cut: text.length > room });
    }
  } finally {
    busyOff();
  }
  say('#m-msg', errs);
  renderMats();
  replay([...$('#m-list').children].slice(n0), 'fresh');
  redetect();
  renderSend();
});

function renderMats() {
  $('#m-list').replaceChildren(...st.mats.map(m => el('li', null,
    el('span', { class: 'name', text: m.name }),
    el('span', { class: 'meta' },
      el('span', { text: m.text.length.toLocaleString() + '자' + (m.cut ? ' (길어서 앞부분만)' : '') }),
      el('button', { type: 'button', class: 'link', text: '빼기', onclick: () => { st.mats = st.mats.filter(x => x !== m); renderMats(); redetect(); renderSend(); } })))));
}

// 사진
const IMG_EXT = /\.(jpe?g|png|gif|bmp|webp|avif|heic|heif|tiff?)$/i;
const isImage = f => /^image\//.test(f.type || '') || IMG_EXT.test(f.name);
const COVER_TOP = 0.25;
async function decodeImage(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) { return await createImageBitmap(file); }
}
function photoErr(f) {
  if (/\.(heic|heif)$/i.test(f.name) || /hei[cf]/i.test(f.type || '')) {
    return `「${f.name}」은(는) 아이폰 사진 형식(HEIC)이라 열 수 없습니다. JPG로 바꿔서 넣어 주세요. 아이폰 [설정] → [카메라] → [포맷]에서 '높은 호환성'을 고르면 앞으로 JPG로 찍힙니다.`;
  }
  return `「${f.name}」은(는) 열 수 없는 사진입니다. JPG나 PNG 사진을 넣어 주세요.`;
}
async function readPhotos(fs) {
  const list = [], errs = [];
  const sorted = [...fs].filter(isImage).sort((a, b) => a.name.localeCompare(b.name, 'ko', { numeric: true }));
  for (const f of sorted) {
    try { const b = await decodeImage(f); if (b.close) b.close(); } catch (e) { errs.push(photoErr(f)); continue; }
    list.push({ file: f, url: URL.createObjectURL(f), caption: '' });
  }
  if (fs.length && !sorted.length) errs.push('사진 파일이 아닙니다. JPG나 PNG 사진을 넣어 주세요.');
  return { list, errs };
}
const onPhotos = setupDrop($('#p-input'), async fs => {
  const { list, errs } = await readPhotos(fs);
  const n0 = st.photos.length;
  st.photos.push(...list);
  say('#p-msg', errs);
  renderPhotos();
  [...$('#p-list').children].slice(n0).forEach((li, k) => { li.style.setProperty('--i', k); li.classList.add('new'); });
  renderSend();
});

const slotHint = i => (st.form && st.form.slotHints && st.form.slotHints[i]) || '';
const slotRatio = i => {
  const r = st.form && st.form.slotRatios;
  return r && r.length ? r[Math.min(i, r.length - 1)] : 4 / 3;
};
function renderPhotos() {
  $('#p-list').replaceChildren(...st.photos.map((p, i) => {
    const cap = el('input', { type: 'text', value: p.caption, placeholder: slotHint(i) ? '설명(선택) 예: ' + slotHint(i) : '설명(선택) 예: 1회 특강', 'aria-label': (i + 1) + '번 사진 설명' });
    cap.addEventListener('input', () => { p.caption = cap.value; redetectSoon(); });
    cap.addEventListener('change', renderSend);
    const move = d => { const j = i + d; if (j < 0 || j >= st.photos.length) return; [st.photos[i], st.photos[j]] = [st.photos[j], st.photos[i]]; renderPhotos(); };
    return el('li', null,
      el('div', { class: 'ph', style: '--ar:' + slotRatio(i) }, el('img', { src: p.url, alt: (i + 1) + '번 사진', loading: 'lazy' }), el('span', { class: 'num', text: String(i + 1) })),
      cap,
      el('div', { class: 'ctl' },
        i > 0 ? el('button', { type: 'button', class: 'link', text: '앞으로', onclick: () => move(-1) }) : null,
        i < st.photos.length - 1 ? el('button', { type: 'button', class: 'link', text: '뒤로', onclick: () => move(1) }) : null,
        el('button', { type: 'button', class: 'link', text: '빼기', onclick: () => { URL.revokeObjectURL(p.url); st.photos.splice(i, 1); renderPhotos(); renderSend(); } })));
  }));
  renderSlots();
}
// 아직 비어 있는 사진 칸: 양식의 사진 칸을 차례·모양·설명 그대로 보여 주고, 누르면 사진을 고른다. 칸이 다 차면 「사진 더하기」 칸 하나
function renderSlots() {
  const total = st.form ? st.form.photoSlots || 0 : 0;
  const PIC = '<svg aria-hidden="true" focusable="false"><use href="#ic-photo-add"/></svg>';
  const slot = (i, cap, add) => {
    const lb = el('label', { class: 'slot', for: 'p-input', style: '--ar:' + slotRatio(i), 'aria-label': add ? '사진 더하기' : (i + 1) + '번 사진 칸' + (cap ? ' (' + cap + ')' : '') + '에 사진 넣기' });
    lb.innerHTML = PIC;
    if (!add) lb.prepend(el('span', { class: 'num', text: String(i + 1) }));
    keyable(lb);
    return el('li', { class: add ? 'add' : null }, lb, el('span', { class: 'slot-cap', text: add ? '사진 더하기' : cap }));
  };
  const list = [];
  for (let i = st.photos.length; i < total; i++) list.push(slot(i, slotHint(i), false));
  if (st.photos.length >= total) list.push(slot(st.photos.length, '', true));
  $('#p-empty').replaceChildren(...list);
  $('#p-hint').textContent = total
    ? `이 양식의 사진 칸 ${total}곳에 번호 차례로 들어갑니다. 사진은 AI에 보내지 않습니다.`
    : '넣은 사진 장수만큼 사진 칸을 만들어 넣습니다. 사진은 AI에 보내지 않습니다.';
}
// 빈 사진 칸이 처음 화면에 보이면 차례로 한 번 비친다(여기에 사진이 들어간다는 표시). 2단계에 들어올 때마다 한 번
function waveSlots() {
  if (calm()) return;
  [...$('#p-empty').children].forEach((li, k) => { li.style.setProperty('--i', k); replay(li, 'wave', k * 90 + 1400); });
}
let waveObs = null;
function waveWhenSeen() {
  if (waveObs) waveObs.disconnect();
  if (calm() || !window.IntersectionObserver) return;
  waveObs = new IntersectionObserver(es => {
    if (!es.some(e => e.isIntersecting)) return;
    waveObs.disconnect();
    waveObs = null;
    if (st.step === 2) waveSlots();
  }, { threshold: 0.5 });
  waveObs.observe($('#p-block .photo-grid'));
}

// 개인정보 가리기
function allTexts() {
  return [$('#req').value, ...st.mats.map(m => m.text), ...st.mats.map(m => m.name), ...st.photos.map(p => p.caption)].filter(t => t && t.trim());
}
function redetect() {
  const files = st.form ? [st.form.doc] : [];
  const texts = allTexts();
  const prev = new Map(st.cands.map(c => [c.value, c.on]));
  let list = HG.detect(files, texts);
  for (const m of st.manual) list = HG.addManual(list, files, texts, [m], 'auto');
  for (const c of list) if (prev.has(c.value)) c.on = prev.get(c.value);
  st.cands = list;
  renderPI();
}
function piCount() {
  const on = st.cands.filter(c => c.on && c.count > 0);
  return { kinds: on.length, total: on.reduce((a, c) => a + c.count, 0) };
}
function renderPI() {
  const shown = st.cands.filter(c => c.count > 0).sort((a, b) => a.first - b.first);
  const n = piCount();
  $('#pi-n').textContent = n.kinds ? `${n.kinds}가지 · ${n.total}곳` : '없음';
  $('#pi-list').replaceChildren(...shown.map(c => {
    const box = el('input', { type: 'checkbox', checked: c.on });
    box.addEventListener('change', () => { c.on = box.checked; renderPI(); renderSend(); });
    return el('li', { class: c.on ? '' : 'off' }, el('label', null, box,
      el('span', { class: 'kind', text: (HG.KIND[c.kind] || {}).label || '기타' }),
      el('mark', { text: c.value }),
      el('span', { class: 'cnt', text: c.count + '곳' })));
  }));
}
// 쉼표나 줄바꿈으로 여러 개를 한 번에 넣을 수 있다(엑셀·한글 표의 이름 칸을 통째로 붙여 넣어도 한 명씩 나뉜다)
function addManual(raw) {
  const words = String(raw ?? $('#pi-add').value).split(/[,，、\n\r\t]+/).map(w => w.trim()).filter(w => w.length >= 2);
  if (!words.length) return;
  for (const w of words) if (!st.manual.includes(w)) st.manual.push(w);
  $('#pi-add').value = '';
  redetect();
  renderSend();
  replay([...$('#pi-list').children].filter(li => words.includes(li.querySelector('mark').textContent)), 'fresh');
  const found = new Set(st.cands.filter(c => c.count > 0).map(c => c.value));
  const none = words.filter(w => !found.has(w));
  say('#pi-msg', none.length ? `「${none.join('」, 「')}」은(는) 지금 적은 글과 양식에 없어 가릴 곳이 없습니다. 적으시면 그때 가립니다.` : [], true);
}
$('#pi-add-btn').addEventListener('click', () => addManual());
$('#pi-add').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addManual(); } });
$('#pi-add').addEventListener('paste', e => {
  const t = e.clipboardData && e.clipboardData.getData('text');
  if (t && /[\n\r\t]/.test(t.trim())) { e.preventDefault(); addManual(t); }
});

function renderSend() {
  if (!st.form) return;
  const { on } = HG.assignTokens(st.cands);
  const mask = t => HG.maskText(t || '', on);
  const L = ['[부탁 글]', mask($('#req').value).trim() || '(아직 없음)'];
  for (const m of st.mats) L.push('', '[붙임 자료: ' + mask(m.name) + ']', mask(m.text).slice(0, 600) + (m.text.length > 600 ? ' …' : ''));
  if (st.photos.length) L.push('', `[사진] ${st.photos.length}장 (사진은 보내지 않고 장수와 설명만)`, ...st.photos.map((p, i) => `${i + 1}. ${mask(p.caption) || '(설명 없음)'}`));
  L.push('', '[양식 내용 앞부분] 양식 안 개인정보도 가린 채로 보냅니다', ...HG.previewMasked(st.form.doc, on, 12));
  $('#send-pre').textContent = L.join('\n');
  renderFacts();
}

// ------------------------------------------------------------ 3단계: AI
// 글은 두 길로 쓴다: 이 페이지의 Claude(claude.ai에서 열었을 때) / 쓰시는 AI에 붙여 넣기(ChatGPT 등, 이 페이지는 아무 데도 안 보냄)
const aiP = connectAI();
refs().catch(() => {});
const pasted = pasteAI(pasteAsk);
// claude.ai 화면에서는 계정에 따라 받기 기능이 없다(초대받은 무료 계정, 2026-10-14 시험). 그때는 링크로 받는 것도 막히므로 처음부터 알린다.
const inViewer = !!(window.claude && window.claude.use);
const dlP = inViewer ? window.claude.use('downloads').catch(() => null) : Promise.resolve(null);
dlP.then(dl => { if (inViewer && !dl) $('#dl-warn').hidden = false; });
const permP = inViewer ? window.claude.use('permissions').catch(() => null) : Promise.resolve(null);
async function asksConsent() {
  const p = await permP;
  if (!p) return false;
  try { return (await p.state('sample')) === 'prompt'; } catch (e) { return false; }
}
// 허락 창에서 「계속」을 누르면 바로 '읽는 중'으로 바꾼다. AI가 생각하는 동안에는 글자가 오지 않아 그것만으로는 알 수 없다.
async function waitConsent(call, text) {
  const p = await permP;
  for (let i = 0; p && i < 600; i++) {
    await new Promise(ok => setTimeout(ok, 1000));
    if (st.call !== call || call.text || call.failed) return;
    let s;
    try { s = await p.state('sample'); } catch (e) { return; }
    if (s === 'prompt') continue;
    if (s === 'granted' && st.call === call && !call.text && !call.failed) busyText(text);
    return;
  }
}
const AIMODE_KEY = 'hc-aimode';
st.aimode = 'auto';
const isPaste = () => st.aimode === 'paste';

function pickAI(mode, remember) {
  st.aimode = mode;
  $('#ai-' + mode).checked = true;
  $('#to3').textContent = mode === 'paste' ? 'AI에 붙여 넣을 글 만들기' : 'AI에게 쓰게 하기';
  if (remember) { try { localStorage.setItem(AIMODE_KEY, mode); } catch (e) { /* 기억 못 해도 쓸 수 있다 */ } }
  aiP.then(ai => {
    $('#ai-status').textContent = isPaste() || !ai ? 'AI: 쓰시는 AI에 직접 붙여 넣습니다. 이 페이지는 AI에 아무것도 보내지 않습니다.'
      : ai.kind === 'claude' ? 'AI: 지금 로그인한 Claude 계정으로 씁니다. 처음 한 번은 Claude 사용을 묻는 창이 뜹니다. 「계속」을 눌러 주세요.'
        : 'AI: 이 컴퓨터의 시험 연결(' + ai.kind + ')';
  });
}
async function currentAI() {
  const ai = await aiP;
  return isPaste() || !ai ? pasted : ai;
}
document.querySelectorAll('input[name="aimode"]').forEach(r => r.addEventListener('change', () => { if (r.checked) pickAI(r.value, true); }));
{
  // 사이트판은 붙여 넣기 하나뿐이라 고르는 줄을 처음부터 두지 않는다
  if (SITE) $('.aipick').hidden = true;
  let m = SITE || new URLSearchParams(location.search).get('ai') === 'paste' ? 'paste' : null;
  if (!m) { try { m = localStorage.getItem(AIMODE_KEY); } catch (e) { /* 없으면 기본 */ } }
  pickAI(m === 'paste' ? 'paste' : 'auto');
  aiP.then(ai => {
    if (ai && ai.kind !== 'claude') $('#ai-auto-label').textContent = '이 컴퓨터의 시험 연결';
    if (ai || SITE) return;
    $('#ai-auto').disabled = true;
    $('#ai-auto-label').textContent = '이 페이지의 Claude (claude.ai에서 열 때만)';
    $('#ai-auto-rec').hidden = true;
    pickAI('paste');
  });
}

// 쓰시는 AI에 붙여 넣기: 글을 복사해 드리고, AI가 쓴 답을 붙여 넣으면 그 답을 돌려준다
function pasteAsk(prompt, o = {}) {
  return new Promise((resolve, reject) => {
    const box = $('#paste'), pre = $('#paste-pre'), inp = $('#paste-in');
    const back = document.activeElement;
    pre.textContent = prompt;
    $('#paste-count').textContent = '글 ' + prompt.length.toLocaleString('ko-KR') + '자';
    $('#paste-show').open = false;
    inp.value = '';
    say('#paste-msg', []);
    // 지금 할 칸만 주황 테두리와 움직이는 그림으로 보여 준다: 열면 ①, 복사하면 ②, AI 창에서 돌아오거나 답을 붙이면 ③
    // 주황 단추도 지금 누를 것 하나만: ① 칸에서는 「글 복사」, 답을 붙이면 「AI 답 넣기」
    const steps = [...box.querySelectorAll('.paste-steps > li')];
    let now = 0, copied = false;
    const paint = () => { $('#paste-copy').classList.toggle('quiet', now !== 1); $('#paste-ok').classList.toggle('quiet', !inp.value.trim()); };
    const psSet = n => {
      if (n === now) return;
      now = n;
      steps.forEach((li, i) => { li.classList.toggle('done', i < n - 1); li.classList.toggle('now', i === n - 1); });
      paint();
    };
    psSet(1);
    box.hidden = false;
    $('#paste-copy').focus();
    const copy = async () => {
      try {
        await navigator.clipboard.writeText(prompt);
        say('#paste-msg', '복사했습니다. 쓰시는 AI의 새 대화에 붙여 넣고 보내 주세요.', true);
        doneFor($('#paste-copy'), '복사했습니다 ✓');
        copied = true;
        psSet(2);
      } catch (e) {
        $('#paste-show').open = true;
        const r = document.createRange();
        r.selectNodeContents(pre);
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
        say('#paste-msg', '글을 골라 두었습니다. Ctrl+C(맥은 ⌘+C)를 눌러 복사해 주세요.', true);
      }
    };
    const okay = () => {
      const t = cleanPasted(inp.value);
      if (!t.trim()) { say('#paste-msg', 'AI 답을 붙여 넣어 주세요.'); inp.focus(); return; }
      const fill = !!(st.frozen && st.frozen.fill);
      if (flatAnswer(t, fill)) {
        say('#paste-msg', ['줄바꿈이 사라진 채로 복사됐습니다. 이대로는 문서 모양을 알 수 없습니다.',
          'AI 답이 든 코드 상자 오른쪽 위의 복사 단추(네모 두 개가 겹친 모양)로 복사해 주세요. 코드 상자가 없으면 AI에게 "답 전체를 코드 블록 하나에 넣어 다시 보여 줘"라고 한 뒤 복사해 주세요.']);
        return;
      }
      const r = readAnswer(t, fill, true);
      const body = fill ? r.body && typeof r.body === 'object' : r.body && String(r.body).trim();
      if (!body && !(r.questions && r.questions.questions.length)) {
        say('#paste-msg', ['AI 답에서 쓸 부분을 찾지 못했습니다. AI 답을 처음부터 끝까지 복사했는지 봐 주세요.',
          '그래도 안 되면 AI에게 "위 답 형식 그대로 다시 써 줘"라고 한 뒤 새 답을 붙여 넣어 주세요.']);
        return;
      }
      end(resolve, t);
    };
    const stop = () => end(reject, { code: 'cancelled' });
    const key = e => { if (e.key === 'Escape') stop(); };
    let empty = true;
    // 답을 붙이면 「AI 답 넣기」가 주황으로 바뀌어 한 번 번진다(작은 화면에서 단추가 밖에 있으면 보이는 데까지 굴린다)
    const typed = () => { const none = !inp.value.trim(); if (!none) psSet(3); paint(); if (empty && !none) { reveal($('#paste-ok')); replay($('#paste-ok'), 'ring'); } empty = none; };
    // 글 칸을 골라 Ctrl+C로 복사해도 ②로 넘어간다
    const copiedByKey = () => { if (now === 1 && !getSelection().isCollapsed && pre.contains(getSelection().anchorNode)) { copied = true; psSet(2); } };
    // AI 창에 갔다 돌아오면 ③으로 넘어가 답 칸에 바로 붙여 넣을 수 있게 한다
    const back3 = () => {
      if (document.visibilityState !== 'visible' || !copied || inp.value.trim()) return;
      psSet(3);
      inp.focus({ preventScroll: true });
      reveal(inp);
    };
    function end(fn, v) {
      $('#paste-copy').removeEventListener('click', copy);
      $('#paste-ok').removeEventListener('click', okay);
      $('#paste-cancel').removeEventListener('click', stop);
      inp.removeEventListener('input', typed);
      box.removeEventListener('keydown', key);
      document.removeEventListener('copy', copiedByKey);
      removeEventListener('focus', back3);
      document.removeEventListener('visibilitychange', back3);
      if (o.signal) o.signal.removeEventListener('abort', stop);
      steps.forEach(li => li.classList.remove('now', 'done'));
      $('#paste-copy').classList.remove('quiet');
      $('#paste-ok').classList.remove('quiet');
      box.hidden = true;
      if (back && back.focus) back.focus();
      fn(v);
    }
    $('#paste-copy').addEventListener('click', copy);
    $('#paste-ok').addEventListener('click', okay);
    $('#paste-cancel').addEventListener('click', stop);
    inp.addEventListener('input', typed);
    box.addEventListener('keydown', key);
    document.addEventListener('copy', copiedByKey);
    addEventListener('focus', back3);
    document.addEventListener('visibilitychange', back3);
    if (o.signal) o.signal.addEventListener('abort', stop);
  });
}

async function freeze() {
  const { on, map } = HG.assignTokens(st.cands);
  const formBytes = on.length ? (await HG.maskFile(st.form.doc, on)).bytes : st.form.bytes;
  const fill = st.form.mode === 'fill';
  const an = await analyze(formBytes, fill);
  // 사용자가 종류를 바꿨으면 엔진의 '서식형' 안내 줄은 빼고 보낸다
  const analysis = fill ? an.analysis : an.analysis.split('\n').filter(l => !/서식형 문서입니다/.test(l)).join('\n');
  const mask = t => HG.maskText(t || '', on);
  st.frozen = {
    on: on.slice(), map: Object.assign({}, map), formBytes, analysis, outline0: an.outline0, slots: an.slots, cover: an.cover || {}, room: an.room || {}, fill,
    request: mask($('#req').value),
    mats: st.mats.map(m => ({ name: mask(m.name), text: mask(m.text) })),
    photoCaps: st.photos.map(p => mask(p.caption.trim())),
  };
}

// 나중에 새로 들어온 글(직접 적은 답, 고칠 점)에 새 개인정보가 있으면 표시를 이어서 붙인다
function maskMore(texts) {
  const f = st.frozen;
  const known = new Set(Object.values(f.map));
  const fresh = HG.detect([], texts.filter(t => t && t.trim())).filter(c => c.on && c.count > 0 && !known.has(c.value));
  if (fresh.length) {
    const used = {};
    for (const t of Object.keys(f.map)) { const m = t.match(/^\[(\D+?)(\d+)\]$/); if (m) used[m[1]] = Math.max(used[m[1]] || 0, Number(m[2])); }
    for (const c of fresh) {
      const tok = HG.KIND[c.kind].tok;
      used[tok] = (used[tok] || 0) + 1;
      c.token = '[' + tok + used[tok] + ']';
      f.map[c.token] = c.value;
      f.on.push(c);
    }
  }
  return t => HG.maskText(t || '', f.on);
}

function aiCtx() {
  const f = st.frozen;
  return { analysis: f.analysis, outline0: f.outline0, slots: f.slots, room: f.room || {}, fill: f.fill, isDefault: st.form.isDefault, request: f.request, mats: f.mats, photos: f.photoCaps };
}

let aiNow = null;
async function askAI(prompt, label, onText) {
  const ai = await currentAI();
  const ctl = new AbortController();
  aiNow = ctl;
  busyOn(label, () => ctl.abort());
  try {
    return await ai.ask(prompt, { signal: ctl.signal, onText });
  } finally {
    if (aiNow === ctl) aiNow = null;
  }
}
// AI가 지금까지 쓴 줄 수(쓰는 동안 표시줄에 보여 준다)
function linesSoFar(text) {
  const t = String(text || '');
  const k = Math.max(t.lastIndexOf('<outline>'), t.lastIndexOf('<values>'));
  if (k < 0) return 0;
  return t.slice(k).split('\n').slice(1).filter(l => l.trim() && !/^<\//.test(l.trim())).length;
}
const progress = label => ({ text }) => { const n = linesSoFar(text); if (n) busyText(label + ' · ' + n + '줄 씀'); };
const aiFail = e => (e && e.code === 'no_ai' ? 'AI에 연결되어 있지 않습니다. claude.ai에서 이 페이지를 열어 주세요.' : aiErrorText(e));

$('#to3').addEventListener('click', start3);
$('#retry').addEventListener('click', start3);

async function start3() {
  if (st.busy) return;
  // 방금 적은 글(사진 설명 포함)의 이름·연락처까지 찾은 뒤에 보낸다
  clearTimeout(reqTimer);
  redetect();
  renderSend();
  if (!$('#req').value.trim()) {
    // 빈칸이면 예시 줄을 노랗게 비추고 그 아래에 안내한다. 휴대폰은 자판이 예시를 가리므로 칸을 누르지 않고 보이게만 굴린다
    say('#s2-msg', '무엇을 쓸지 한두 줄 적거나, 위 예시 하나를 눌러 보세요.');
    replay($('#s2 .examples'), 'fresh');
    reveal($('#s2 .col'));
    if (!phone()) $('#req').focus({ preventScroll: true });
    return;
  }
  say('#s2-msg', []);
  const ai = await currentAI();
  st.busy = true;
  unfreeze();
  go(3);
  $('#q-form').replaceChildren();
  $('#q-summary').textContent = '';
  $('#q-actions').hidden = true;
  $('#retry-row').hidden = true;
  say('#s3-msg', []);
  try {
    busyOn('보내기 전에 개인정보를 가리는 중');
    await freeze();
    const ctx = aiCtx();
    const prompt = await firstPrompt(ctx);
    const call = { ctl: null, text: '', done: false, superseded: false, promise: null, shown: false };
    st.call = call;
    call.ctl = new AbortController();
    const READ = 'AI가 양식과 부탁을 읽는 중 (보통 20초~1분)';
    const ask1 = ai.kind === 'claude' && await asksConsent();
    busyOn(ai.kind === 'paste' ? '쓰시는 AI의 답을 기다리는 중' : ask1 ? 'Claude 사용을 묻는 창이 뜨면 「계속」을 눌러 주세요' : READ, () => call.ctl.abort());
    if (ask1) waitConsent(call, READ);
    call.promise = ai.ask(prompt, { signal: call.ctl.signal, onText: ({ text }) => {
      if (ask1 && !call.text && !call.shown) busyText(READ);
      call.text = text;
      onFirst(call);
    } })
      .then(text => { call.text = text; call.done = true; onFirst(call); return text; });
    call.promise.catch(e => {
      call.failed = true;
      if (call.superseded || st.call !== call || st.making) return;
      busyOff();
      st.busy = false;
      say('#s3-msg', aiFail(e));
      $('#retry-row').hidden = false;
    });
  } catch (e) {
    busyOff();
    st.busy = false;
    say('#s3-msg', e && e.code ? aiFail(e) : String((e && e.message) || e));
    $('#retry-row').hidden = false;
  }
}

function onFirst(call) {
  if (st.call !== call) return;
  const fill = st.frozen.fill;
  const r = readAnswer(call.text, fill, call.done);
  if (!call.shown && (r.questionsDone || call.done)) {
    call.shown = true;
    st.qa = r.questions || { summary: '', questions: [] };
    if (st.qa.questions.length) {
      renderQuestions(st.qa);
      $('#q-actions').hidden = false;
      st.busy = false;
      call.label = 'AI가 추천대로 미리 쓰는 중. 골라 주시는 동안 계속 씁니다';
      if (!call.done) busyOn(call.label + '.', () => call.ctl.abort());
    } else {
      $('#q-summary').textContent = st.qa.summary || '';
      call.label = '물어볼 것이 없어 바로 쓰는 중';
      busyOn(call.label, () => call.ctl.abort());
    }
  }
  if (call.label && !call.done && !call.superseded && st.call === call) {
    const n = linesSoFar(call.text);
    if (n) busyText(call.label + ' · ' + n + '줄 씀');
  }
  if (call.done) {
    if (!st.qa.questions.length) {
      st.busy = false;
      make();
    } else if (!st.making) {
      busyOff();
    }
  }
}

function renderQuestions(q) {
  $('#q-summary').textContent = q.summary || '';
  $('#q-form').replaceChildren(...q.questions.map((x, i) => {
    const fs = el('fieldset', { class: 'q' }, el('legend', { text: (i + 1) + '. ' + x.label }));
    x.options.forEach((o, j) => {
      const id = `q${i}o${j}`;
      const radio = el('input', { type: 'radio', name: 'q' + i, id, value: String(j), checked: o.recommended });
      fs.append(el('label', { class: 'opt-row', for: id }, radio, el('span', { text: o.text }), o.recommended ? el('span', { class: 'rec', text: '(추천)' }) : null));
      if (o.input) {
        const inp = el('input', { type: 'text', class: 'opt-in', id: id + 'in', placeholder: o.hint || '직접 적어 주세요', 'aria-label': x.label + ' 직접 적기' });
        inp.addEventListener('input', () => { if (inp.value.trim()) radio.checked = true; });
        fs.append(inp);
      }
    });
    return fs;
  }));
}

function collectAnswers() {
  return st.qa.questions.map((x, i) => {
    const sel = document.querySelector(`input[name="q${i}"]:checked`);
    const j = sel ? Number(sel.value) : Math.max(0, x.options.findIndex(o => o.recommended));
    const o = x.options[j];
    let choice = o.text, typed = '';
    if (o.input) {
      typed = ((document.getElementById(`q${i}o${j}in`) || {}).value || '').trim();
      choice = typed || '알아서';
    }
    return { label: x.label, choice, isRec: o.recommended && !typed };
  });
}

$('#make').addEventListener('click', () => make());

async function make() {
  if (st.making) return;
  const call = st.call;
  if (!call) return;
  st.making = true;
  st.busy = true;
  $('#make').disabled = true;
  say('#s3-msg', []);
  $('#retry-row').hidden = true;
  const fill = st.frozen.fill;
  try {
    const answers = st.qa.questions.length ? collectAnswers() : [];
    let body = null;
    // 추천만 골랐으면 미리 쓰던 답을 쓴다(그 답이 이미 멈췄거나 실패했으면 아래에서 새로 부탁)
    if (answers.every(a => a.isRec) && !call.superseded && !call.failed && !call.ctl.signal.aborted) {
      if (!call.done) {
        call.label = 'AI가 마저 쓰는 중';
        busyOn(call.label, () => call.ctl.abort());
        await call.promise;
      }
      body = readAnswer(call.text, fill, true).body;
    }
    if (!body) {
      if (!call.done) { call.superseded = true; call.ctl.abort(); }
      const mask = maskMore(answers.map(a => a.choice));
      const prompt = await answerPrompt(aiCtx(), answers.map(a => ({ label: a.label, choice: mask(a.choice) })));
      const L = isPaste() ? '고르신 대로 쓴 AI 답을 기다리는 중' : '고르신 대로 AI가 쓰는 중 (보통 20초~1분)';
      const text = await askAI(prompt, L, progress(L));
      body = readAnswer(text, fill, true).body;
    }
    if (!body || (!fill && !String(body).trim())) throw { code: 'unreadable' };
    await buildAndShow(body, true);
  } catch (e) {
    busyOff();
    say('#s3-msg', e && e.code === 'unreadable' ? 'AI 답을 읽지 못했습니다. [다시 하기]를 눌러 주세요.' : (e && e.code ? aiFail(e) : String((e && e.message) || e)));
    $('#retry-row').hidden = false;
  } finally {
    st.making = false;
    st.busy = false;
    $('#make').disabled = false;
  }
}

// ------------------------------------------------------------ 만들기
const bodyText = body => (st.frozen.fill ? JSON.stringify(body, null, 1) : String(body));

// 칸 채우기 값에서 양식을 망가뜨리는 것을 뺀다.
// - AI가 사진과 상관없는 칸(사업명 칸 등)에 [사진]을 쓰면 그 작은 칸에 사진이 들어간다. 칸 목록 줄(칸 글자·이웃 칸 힌트)에
//   '사진'이 없는 칸의 [사진]은 뺀다. 사진 칸이 없으면 사진은 끝 '붙임 사진' 쪽으로 간다(finalize).
// - 사진 칸이 아닌 칸의 글 속 [사진] 글자(예: '- [사진] 헌책 장터')는 지운다. 그대로 두면 문서에 '[사진]'이 글자로 찍힌다.
//   [사진]만 있던 줄은 줄째 뺀다.
// - 제출 문구·서명란 칸은 줄 수가 원래와 같을 때만 넣는다(줄을 빼고 다시 쓰면 첨부 서류·서명란·귀하 줄이 사라진다).
const PHOTO_VAL = /^\s*\[\s*사진\s*\d*\s*\]\s*$/;
const PHOTO_TOKEN = /\[\s*사진\s*\d*\s*\]\s*/g;
const dropPhotoTokens = v => String(v).split('\n')
  .filter(l => !(/\[\s*사진\s*\d*\s*\]/.test(l) && /^[\s\-–·•○◦▪*]*$/.test(l.replace(PHOTO_TOKEN, ''))))
  .map(l => l.replace(PHOTO_TOKEN, '')).join('\n');
function safeBody(body) {
  const f = st.frozen;
  if (!f.fill || !body || typeof body !== 'object') return body;
  const ok = new Set();
  for (const line of f.slots.split('\n')) {
    const m = line.match(/^(T\d+\.\d+\.\d+|P\d+)\s+(.*)$/);
    if (m && /사진/.test(m[2])) ok.add(m[1]);
  }
  const cover = f.cover || {};
  const lines = v => String(v ?? '').split('\n').filter(x => x.trim()).length;
  const out = {};
  for (let [k, v] of Object.entries(body)) {
    if (!ok.has(k) && PHOTO_VAL.test(String(v ?? ''))) continue;
    if (cover[k] && lines(v) !== cover[k]) continue;
    if (!ok.has(k) && typeof v === 'string' && /\[\s*사진\s*\d*\s*\]/.test(v)) v = dropPhotoTokens(v);
    out[k] = v;
  }
  return out;
}

async function buildOnce(body) {
  const f = st.frozen;
  body = safeBody(body);
  const r = f.fill
    ? await eng(['fill', '/w/f.hwpx', '/w/v.json', '-o', '/w/r.hwpx'], { 'f.hwpx': f.formBytes, 'v.json': ENC.encode(JSON.stringify(body)) }, ['r.hwpx'])
    : await eng(['build', '/w/f.hwpx', '/w/o.txt', '-o', '/w/r.hwpx'], { 'f.hwpx': f.formBytes, 'o.txt': ENC.encode(String(body)) }, ['r.hwpx']);
  return { code: r.code, log: r.log, bytes: r.code === 0 ? r.files['r.hwpx'] : null, body };
}

const needsFix = log => /찾지 못했습니다|옛 연도가 그대로 남아|자리표시/.test(log || '');

async function buildAndShow(body, allowFix, keep) {
  busyOn('한글 파일을 만드는 중');
  let r = await buildOnce(body);
  body = r.body;
  if (!r.bytes) throw new Error('한글 파일을 만들지 못했습니다. ' + (cleanLog(r.log) || '[다시 하기]를 눌러 주세요.'));
  // 붙여 넣기로 쓸 때는 창을 또 띄우지 않는다(점검 결과는 아래 '참고'와 채울 곳에 보인다)
  if (allowFix && needsFix(r.log) && !isPaste()) {
    try {
      const L = '점검에서 나온 것을 AI가 고치는 중';
      const text = await askAI(await fixPrompt(aiCtx(), bodyText(body), r.log), L, progress(L));
      const b2 = readAnswer(text, st.frozen.fill, true).body;
      if (b2) {
        busyOn('한글 파일을 다시 만드는 중');
        const r2 = await buildOnce(b2);
        if (r2.bytes) { r = r2; body = r2.body; }
      }
    } catch (e) { /* 고치기에 실패하면 처음 만든 것을 그대로 보여 준다 */ }
  }
  if (keep) keepPrev();
  st.result = { body, built: r.bytes, log: r.log };
  await finalize();
  busyOff();
  go(4);
}

// 고치기 전 결과를 기억해 두었다가 [앞 결과로 되돌리기]로 돌아간다(최근 5개)
function keepPrev() {
  if (!st.result) return;
  st.hist.push({ body: st.result.body, built: st.result.built, log: st.result.log });
  if (st.hist.length > 5) st.hist.shift();
  $('#undo-row').hidden = false;
}

// 사진 한 장을 칸에 맞는 JPG로: 칸 비율로 자르고(세로로 남으면 위를 덜 자름) 인쇄에 충분한 크기(약 300dpi)로 줄인다
async function photoBytes(p, s) {
  const bmp = await decodeImage(p.file);
  try {
    let sx = 0, sy = 0, sw = bmp.width, sh = bmp.height;
    const a = s.w / s.h;
    if (sw / sh > a) { const w = Math.round(sh * a); sx = Math.round((sw - w) / 2); sw = w; } else { const h = Math.round(sw / a); sy = Math.round((sh - h) * COVER_TOP); sh = h; }
    const k = Math.min(1, s.w / 24 / sw, s.h / 24 / sh);
    const ow = Math.max(1, Math.round(sw * k)), oh = Math.max(1, Math.round(sh * k));
    const cv = document.createElement('canvas');
    cv.width = ow;
    cv.height = oh;
    const cx = cv.getContext('2d');
    cx.fillStyle = '#ffffff';
    cx.fillRect(0, 0, ow, oh);
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(bmp, sx, sy, sw, sh, 0, 0, ow, oh);
    const blob = await new Promise((ok, no) => cv.toBlob(b => (b ? ok(b) : no(new Error('사진을 바꾸지 못했습니다.'))), 'image/jpeg', 0.86));
    return { bytes: new Uint8Array(await blob.arrayBuffer()), pxW: ow, pxH: oh, type: 'image/jpeg', mode: 'cover' };
  } finally {
    if (bmp.close) bmp.close();
  }
}

// 가린 말을 되돌리고 사진을 넣은 최종 파일을 만든다(AI 없이)
async function finalize() {
  const f = st.frozen, res = st.result;
  busyOn('가린 말을 되돌리는 중');
  const rs = await HG.restoreFile(await HG.openHwpx('r.hwpx', res.built), f.map);
  let bytes = rs.bytes;
  res.missing = rs.missing;
  // AI가 채운 칸이 넘치면: 쪽 크기 표 칸은 줄 간격을 조금 줄여 맞추고, 그래도 넘치면 한글처럼 칸을 늘린다(미리보기도 한글과 같게).
  // 쪽 크기 표가 쪽보다 커지면 한글에서 쪽 아래가 잘리므로 알린다(res.over)
  res.fitLog = '';
  res.over = [];
  const keys = f.fill && res.body && typeof res.body === 'object' ? Object.keys(res.body).filter(k => /^T\d+\.\d+\.\d+$/.test(k)) : [];
  if (keys.length) {
    busyText('칸 크기를 맞추는 중');
    const r = await eng(['fit', '/w/a.hwpx', '/w/k.json', '-o', '/w/b.hwpx'], { 'a.hwpx': bytes, 'k.json': ENC.encode(JSON.stringify(keys)) }, ['b.hwpx'], 'extra');
    if (r.code === 0 && r.files['b.hwpx']) {
      bytes = r.files['b.hwpx'];
      res.fitLog = r.log;
      for (const line of r.log.split('\n')) {
        const [tag, page, what] = line.split('\t');
        if (tag === '넘침' && what) res.over.push({ page: +page, what });
      }
    }
  }
  let doc = await HG.openHwpx('r.hwpx', bytes);
  let slots = await HG.photoSlots(doc);
  res.slotCount = slots.length;
  res.photoCount = 0;
  res.photoNote = '';
  let page = false;
  // 사진 칸이 없는 양식(법정 서식 등)이면 문서 끝에 '붙임 사진' 쪽(사진 2장씩, 설명이 있으면 아래 줄에)을 붙여 거기에 넣는다
  if (st.photos.length && !slots.length) {
    busyText('붙임 사진 쪽을 만드는 중');
    const caps = ENC.encode(JSON.stringify(st.photos.map(p => p.caption.trim())));
    const r = await eng(['photos', '/w/a.hwpx', '/w/c.json', '-o', '/w/b.hwpx'], { 'a.hwpx': bytes, 'c.json': caps }, ['b.hwpx'], 'extra');
    if (r.code === 0 && r.files['b.hwpx']) {
      bytes = r.files['b.hwpx'];
      doc = await HG.openHwpx('r.hwpx', bytes);
      slots = await HG.photoSlots(doc);
      page = slots.length > 0;
    }
  }
  if (st.photos.length && slots.length) {
    if (slots.length !== st.photos.length) {
      const fit = await HG.fitPhotoSlots(doc, st.photos.length);
      if (fit.bytes) { doc = await HG.openHwpx('r.hwpx', fit.bytes); slots = await HG.photoSlots(doc); }
    }
    const list = [];
    for (let k = 0; k < slots.length; k++) {
      busyText(`사진 넣는 중 (${Math.min(k + 1, st.photos.length)}/${st.photos.length})`);
      list.push(st.photos[k] ? await photoBytes(st.photos[k], slots[k]) : null);
    }
    const ins = await HG.insertPhotos(doc, list);
    if (ins.bytes) bytes = ins.bytes;
    res.photoCount = ins.count;
    res.slotCount = slots.length;
    if (page) res.photoNote = '양식에 사진 칸이 없어 사진은 마지막 쪽 「붙임 사진」에 넣었습니다.';
    else if (st.photos.length > slots.length) res.photoNote = `사진 칸이 ${slots.length}곳뿐이라 사진 ${st.photos.length - slots.length}장은 넣지 못했습니다.`;
    else if (slots.length > st.photos.length) res.photoNote = `사진 칸 ${slots.length - st.photos.length}곳은 비어 있습니다. 한글에서 지우거나 사진을 넣어 주세요.`;
  } else if (st.photos.length) {
    res.photoNote = '문서에 사진 칸이 없어 사진을 넣지 못했습니다. 아래 "AI에게 고쳐 달라고 하기"에 "사진 표를 넣어 줘"라고 적어 보세요.';
  }
  res.final = bytes;
  busyText('미리보기를 그리는 중');
  (st.pvUrls || []).forEach(u => URL.revokeObjectURL(u));
  st.pvUrls = [];
  try {
    const pv = await pagesOf(bytes, 40);
    res.pages = pv.n;
    res.urls = pv.urls;
    st.pvUrls = pv.urls;
  } catch (e) {
    res.pages = 0;
    res.urls = [];
  }
  renderResult();
}

// ------------------------------------------------------------ 4단계
function docTitle() {
  const f = st.frozen, res = st.result;
  let t = '';
  if (!f.fill) {
    const m = String(res.body).match(/^@제목:\s*(.+)$/m);
    if (m) t = HG.restoreText(m[1], f.map).text.replace(/\\n/g, ' ');
  } else if (!st.form.isDefault) {
    t = st.form.name.replace(/\.hwpx?$/i, '') + ' 작성';
  }
  t = t.replace(/[\\/:*?"<>|\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return t || '한글척척 문서';
}

// ○○로 비운 곳(개요 줄 또는 칸)을 사람이 고칠 수 있게 꺼낸다
function holes() {
  const f = st.frozen, res = st.result, back = t => HG.restoreText(t, f.map).text;
  if (f.fill) {
    // 칸 목록을 줄(표 번호.행)마다 묶는다. T2.5.1 → 줄 T2.5, 문단 칸(P3)은 혼자 한 줄
    const rows = new Map();
    for (const line of f.slots.split('\n')) {
      const m = line.match(/^(T(\d+)\.(\d+)\.(\d+)|P\d+)\s+(.*)$/);
      if (!m) continue;
      const blank = /^\(빈칸\)/.test(m[5]);
      const rk = m[2] ? 'T' + m[2] + '.' + m[3] : m[1];
      if (!rows.has(rk)) rows.set(rk, []);
      rows.get(rk).push({ key: m[1], col: m[4] ? +m[4] : 0, blank, hint: blank ? ((m[5].match(/←\s*(.+)$/) || [])[1] || '') : '', text: blank ? '' : m[5] });
    }
    // 칸 이름은 사람이 읽는 말로: '사 업 명' → '사업명', 'A / B' → 'A B', 긴 글은 앞만
    const tidy = t => {
      const o = [];
      let run = false;
      for (const x of String(t).replace(/\s*\/\s*/g, ' ').trim().split(/\s+/)) {
        const one = /^[가-힣]$/.test(x);
        if (one && run) o[o.length - 1] += x; else o.push(x);
        run = one;
      }
      const s = o.join(' ');
      return s.length > 18 ? s.slice(0, 17) + '…' : s;
    };
    const val = k => res.body[k] != null ? back(String(res.body[k])) : '';
    const NA = /^(해당\s*(사항\s*)?없음|없음|[-–—])$/;
    const out = [], seen = new Set();
    for (const row of rows.values()) {
      const blanks = row.filter(c => c.blank);
      const filledBlank = blanks.some(c => val(c.key).trim());
      const rowNA = row.some(c => NA.test(val(c.key).trim()));
      // 이름표 칸 옆에 빈칸이 한두 개인 줄(교부 결정일 | 빈칸 같은 것)
      const labelRow = blanks.length <= 2 && row.some(c => !c.blank);
      for (const c of row) {
        seen.add(c.key);
        const v = val(c.key);
        const left = row.filter(x => !x.blank && x.col < c.col).pop();
        const label = /^\[제출 문구·서명란/.test(c.text) ? '제출 문구·서명란' : tidy(c.blank ? (c.hint.split(' / ')[0] || '') : left ? left.text : c.text);
        if (/○○/.test(v)) out.push({ key: c.key, label, value: v });
        // 비어 남은 칸은 이름표 옆 빈칸이거나 AI가 같은 줄을 일부 채운 줄만 묻는다.
        // 통째로 빈 줄(남는 줄)이나 '해당 없음'이라고 쓴 줄은 쓰지 않는 줄로 본다.
        else if (c.blank && !v.trim() && !rowNA && (labelRow || filledBlank || c.key[0] === 'P')) out.push({ key: c.key, label, value: v });
      }
    }
    for (const [k, v] of Object.entries(res.body)) {
      if (!seen.has(k) && /○○/.test(String(v))) out.push({ key: k, label: '', value: back(String(v)) });
    }
    return out;
  }
  const lines = String(res.body).split('\n');
  const out = [];
  let inTable = false;
  lines.forEach((line, i) => {
    if (/^\[표( \d+)?\]/.test(line)) inTable = true;
    if (/^\[\/표\]/.test(line)) inTable = false;
    if (!/○○/.test(line) || /^\s*\/\//.test(line)) return;
    let m;
    if ((m = line.match(/^@제목:\s*(.*)$/))) out.push({ i, kind: 'title', label: '제목', value: back(m[1]).replace(/\\n/g, ' / ') });
    else if ((m = line.match(/^@바꾸기:\s*(.*?)\s*=>\s*(.*)$/))) out.push({ i, kind: 'swap', from: m[1], label: '머리 글자', value: back(m[2]) });
    else out.push({ i, kind: 'line', label: inTable ? '표 한 줄 (칸은 | 로 나눔)' : '', value: back(line) });
  });
  return out;
}

function renderResult() {
  const f = st.frozen, res = st.result;
  $('#r-title').textContent = docTitle();
  const facts = [res.pages ? `약 ${res.pages}쪽` : '', res.photoCount ? `사진 ${res.photoCount}장` : '', st.form.isDefault ? '기본 보고서 틀' : '올린 양식 모양'];
  $('#r-facts').textContent = facts.filter(Boolean).join(' · ');
  $('#pages').replaceChildren(...(res.urls || []).map((u, i) => {
    const fig = el('figure', { class: 'page' },
      el('div', { class: 'sheet' }, el('img', { src: u, alt: (i + 1) + '쪽 미리보기' })), el('figcaption', { text: (i + 1) + '쪽' }));
    fig.style.setProperty('--i', Math.min(i, 5));
    return fig;
  }));
  if (!res.urls || !res.urls.length) $('#pages').replaceChildren(el('p', { class: 'hint', text: '미리보기를 그리지 못했습니다. 받은 파일을 한글에서 열어 확인해 주세요.' }));
  if (res.pages > (res.urls || []).length) $('#pages').append(el('p', { class: 'hint', text: `앞 ${res.urls.length}쪽만 보여 드립니다.` }));

  const hs = holes();
  $('#fill-box').hidden = !hs.length;
  $('#fill-n').textContent = hs.length ? hs.length + '곳' : '';
  $('#fill-list').replaceChildren(...hs.map((h, k) => {
    const inp = el('input', { type: 'text', id: 'hole' + k, value: h.value });
    inp.dataset.k = String(k);
    return el('label', { class: 'fill-row', for: 'hole' + k }, h.label ? el('span', { text: h.label }) : null, inp);
  }));
  st.holes = hs;

  $('#photo-box').hidden = !res.slotCount && !st.photos.length;
  $('#photo-n').textContent = res.slotCount ? `사진 칸 ${res.slotCount}곳 · 넣은 사진 ${res.photoCount}장` : '';
  $('#photo-thumbs').replaceChildren(...st.photos.slice(0, res.slotCount || st.photos.length).map((p, i) => el('img', { src: p.url, alt: (i + 1) + '번 사진' })));

  const notes = [];
  if (res.photoNote) notes.push(res.photoNote);
  if (res.missing && res.missing.length) notes.push(`${res.missing.join(', ')} 표시는 원래 말을 몰라 그대로 남았습니다. 한글에서 고쳐 주세요.`);
  // 엔진의 '칸이 늘어날 수 있습니다'(글자 수 어림)는 칸 맞춤(fitLog)이 실제로 잰 결과로 대신한다
  for (const l of ((res.fitLog || '') + '\n' + (res.log || '')).split('\n')) {
    if (/^- (쪽 수|참고|확인|주의)/.test(l) && !/가리개|사진 자리/.test(l) && !(res.fitLog && /칸이 늘어날 수 있습니다/.test(l))) notes.push(l.replace(/^- /, ''));
  }
  notes.push('.hwp로 내야 하면 한글에서 [다른 이름으로 저장하기] → 파일 형식 \'한글 문서(*.hwp)\'로 저장하는 것이 가장 정확합니다.');
  $('#notes').replaceChildren(...notes.map(t => el('li', { text: t })));
  // 쪽 크기 표가 넘치면(한글에서 쪽 아래가 잘림) 받기 단추 아래에 바로 알리고, 고칠 점을 채워 둔다
  say('#get-msg', overWarn() || []);
  if (res.over && res.over.length && !$('#wish').value.trim()) $('#wish').value = res.over.map(o => `${o.page}쪽 칸에 맞게 줄여 줘(넘친 칸: ${o.what})`).join('\n');
}

function overWarn() {
  const o = st.result && st.result.over;
  if (!o || !o.length) return '';
  return `${o.map(x => x.page + '쪽').join('·')}은 칸보다 글이 많아 한글에서 쪽 아래가 잘립니다. 아래 「AI에게 고쳐 달라고 하기」에 적어 둔 대로 고쳐 달라고 해 주세요.`;
}

// 다시 만든 뒤 알림. 쪽이 넘치면 그 알림을 함께 둔다
function sayDone(text) {
  const w = overWarn();
  $('#get-msg').replaceChildren(el('p', { class: 'ok', text }), ...(w ? [el('p', { text: w })] : []));
}

$('#refill').addEventListener('click', async () => {
  if (st.busy || !st.result) return;
  const f = st.frozen, res = st.result;
  const vals = [...document.querySelectorAll('#fill-list input')].map(i => i.value.trim());
  const mask = maskMore(vals);
  let body;
  if (f.fill) {
    body = Object.assign({}, res.body);
    st.holes.forEach((h, k) => { if (vals[k]) body[h.key] = mask(vals[k]); else delete body[h.key]; });
  } else {
    const lines = String(res.body).split('\n');
    st.holes.forEach((h, k) => {
      const v = mask(vals[k] || '');
      if (h.kind === 'title') lines[h.i] = '@제목: ' + v.replace(/\s*\/\s*/g, '\\n');
      else if (h.kind === 'swap') lines[h.i] = '@바꾸기: ' + h.from + ' => ' + v;
      else lines[h.i] = v;
    });
    body = lines.join('\n');
  }
  st.busy = true;
  try {
    busyOn('한글 파일을 다시 만드는 중');
    const r = await buildOnce(body);
    if (!r.bytes) throw new Error(cleanLog(r.log) || '다시 만들지 못했습니다.');
    keepPrev();
    st.result = { body: r.body, built: r.bytes, log: r.log };
    await finalize();
    sayDone('고친 내용으로 다시 만들었습니다.');
  } catch (e) {
    say('#get-msg', String((e && e.message) || e));
  } finally {
    busyOff();
    st.busy = false;
  }
});

setupDrop($('#p2-input'), async fs => {
  if (st.busy || !st.result) return;
  const { list, errs } = await readPhotos(fs);
  if (!list.length) { say('#get-msg', errs); return; }
  st.photos.forEach(p => URL.revokeObjectURL(p.url));
  st.photos = list;
  renderPhotos();
  st.busy = true;
  try {
    await finalize();
    sayDone([`사진 ${st.result.photoCount}장을 넣었습니다.`, ...errs].join(' '));
  } catch (e) {
    say('#get-msg', String((e && e.message) || e));
  } finally {
    busyOff();
    st.busy = false;
  }
});

$('#undo').addEventListener('click', async () => {
  if (st.busy || !st.hist.length) return;
  st.busy = true;
  try {
    st.result = st.hist.pop();
    await finalize();
    sayDone('앞 결과로 되돌렸습니다.');
  } catch (e) {
    say('#get-msg', String((e && e.message) || e));
  } finally {
    busyOff();
    st.busy = false;
    $('#undo-row').hidden = !st.hist.length;
  }
});

$('#ask-fix').addEventListener('click', async () => {
  const wish = $('#wish').value.trim();
  if (st.busy || !st.result) return;
  if (!wish) { say('#get-msg', '무엇을 고칠지 적어 주세요.'); $('#wish').focus(); return; }
  st.busy = true;
  try {
    const mask = maskMore([wish]);
    const L = isPaste() ? '고친 AI 답을 기다리는 중' : 'AI가 고치는 중 (보통 20초~1분)';
    const text = await askAI(await editPrompt(aiCtx(), bodyText(st.result.body), mask(wish)), L, progress(L));
    const body = readAnswer(text, st.frozen.fill, true).body;
    if (!body) throw { code: 'unreadable' };
    $('#wish').value = '';
    await buildAndShow(body, true, true);
    sayDone('고쳤습니다. 미리보기를 확인해 주세요.');
  } catch (e) {
    if (!$('#wish').value.trim()) $('#wish').value = wish;
    busyOff();
    say('#get-msg', e && e.code === 'unreadable' ? 'AI 답을 읽지 못했습니다. 다시 눌러 주세요.' : (e && e.code ? aiFail(e) : String((e && e.message) || e)));
  } finally {
    st.busy = false;
  }
});

// ------------------------------------------------------------ 받기
function dosStamp() {
  const d = new Date();
  return { date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(), time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1) };
}

async function save(kind) {
  if (!st.result || st.busy) return;
  say('#get-msg', []);
  const dl = await dlP;
  if (!dl && inViewer) {
    say('#get-msg', ['지금 열린 claude.ai 화면에서는 파일 받기가 막혀 있어 한글 파일을 받을 수 없습니다.', '화면 맨 위 제목 「한글 척척」을 눌러 「복제」(Duplicate)를 고르면 내 복사본이 열리고, 거기서는 받을 수 있습니다. 복사본에서는 처음부터 다시 만들어야 합니다.']);
    return;
  }
  let bytes = st.result.final, name = docTitle() + '.hwpx';
  if (kind === 'hwp') {
    try {
      const rh = await rhwp();
      const d = new rh.HwpDocument(bytes);
      try { bytes = d.exportHwp(); } finally { freeDoc(d); }
      name = name.replace(/\.hwpx$/, '.hwp');
    } catch (e) {
      say('#get-msg', '.hwp로 바꾸지 못했습니다. .hwpx 파일을 받아 한글에서 .hwp로 저장해 주세요.');
      return;
    }
  }
  if (dl) {
    // 클로드 페이지에서는 한글 파일을 바로 내려받을 수 없어 압축 파일(zip)에 담아 준다
    const s = dosStamp();
    const zip = await HG._test.writeZip([{ name, changed: bytes, method: 0, time: s.time, date: s.date }]);
    try {
      await dl.save({ filename: name.replace(/\.hwpx?$/i, '') + '.zip', data: new Blob([zip]) });
      say('#get-msg', ['받았습니다. 압축 파일(.zip)을 열면 한글 파일이 들어 있습니다.', kind === 'hwp' ? HWP_NOTE : ''], true);
      doneFor(kind === 'hwp' ? $('#get-hwp') : $('#get-hwpx'), '받았습니다 ✓');
      if (st.result) st.result.got = true;
    } catch (e) {
      say('#get-msg', e && e.code === 'declined' ? '받기를 취소했습니다.' : e && e.code === 'rate_limited' ? '잠시 뒤 다시 눌러 주세요.' : '이 화면에서는 파일을 받을 수 없습니다.');
    }
    return;
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: kind === 'hwp' ? 'application/x-hwp' : 'application/hwp+zip' }));
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  say('#get-msg', ['받았습니다: ' + name, kind === 'hwp' ? HWP_NOTE : ''], true);
  doneFor(kind === 'hwp' ? $('#get-hwp') : $('#get-hwpx'), '받았습니다 ✓');
  if (st.result) st.result.got = true;
}
const HWP_NOTE = '.hwp는 바꾸면서 표 합계 계산식 같은 일부가 빠질 수 있습니다. 내기 전에 한글에서 열어 확인해 주세요.';
$('#get-hwpx').addEventListener('click', () => save('hwpx'));
$('#get-hwp').addEventListener('click', () => save('hwp'));

$('#restart').addEventListener('click', () => {
  if (st.busy) return;
  unfreeze();
  st.mats = [];
  st.photos.forEach(p => URL.revokeObjectURL(p.url));
  st.photos = [];
  st.manual = [];
  $('#req').value = '';
  renderMats();
  renderPhotos();
  redetect();
  go(st.form ? 2 : 1);
});

// ------------------------------------------------------------ 1단계 붙임: 빈 양식 ↔ 채운 문서를 손잡이로 밀어 비교
(function compare() {
  const box = $('#cmp'), range = $('#cmp-r');
  const set = v => {
    v = Math.max(0, Math.min(100, v));
    box.style.setProperty('--x', v + '%');
    range.value = String(Math.round(v));
  };
  const at = e => { const r = box.getBoundingClientRect(); return (e.clientX - r.left) / r.width * 100; };
  let drag = false;
  box.addEventListener('pointerdown', e => {
    if (e.button) return;
    drag = true;
    box.classList.remove('hint');
    box.classList.add('drag');
    box.setPointerCapture(e.pointerId);
    set(at(e));
  });
  box.addEventListener('pointermove', e => { if (drag) set(at(e)); });
  for (const t of ['pointerup', 'pointercancel']) box.addEventListener(t, () => { drag = false; box.classList.remove('drag'); });
  range.addEventListener('input', () => { box.classList.remove('hint'); set(Number(range.value)); });
})();

// ------------------------------------------------------------ 다음에 할 곳 가리키기
// 한동안(8초) 아무것도 누르거나 적지 않으면 지금 할 곳을 한 번 보여 준다: 양식 칸은 파일이 들어가는 시연, 부탁 글은 예시 쓰기,
// 단추는 둥글게 번지기. 같은 곳은 많아야 두 번, 「동작 줄이기」를 켠 분께는 하지 않는다.
const nudged = new Map();
let idleT = 0;
function idleTarget() {
  if (!$('#paste').hidden) return $('#paste .paste-steps > li.now');
  if (st.busy) return null;
  if (st.step === 1) return st.form ? $('#to2') : phone() ? $('#f-default') : $('#f-drop');
  if (st.step === 2) return $('#req').value.trim() ? $('#to3') : $('#req');
  if (st.step === 3) return $('#q-actions').hidden ? null : $('#make');
  if (st.step === 4) return st.result && !st.result.got ? $('#get-hwpx') : null;
  return null;
}
function nudge() {
  const t = idleTarget();
  if (t && t.offsetParent !== null && !t.disabled && !calm()) {
    const n = nudged.get(t) || 0;
    if (n < 2) {
      nudged.set(t, n + 1);
      if (t.matches('.paste-steps > li')) { t.classList.remove('now'); void t.offsetWidth; t.classList.add('now'); }
      else if (t.id === 'f-drop') dropDemo();
      else if (t.id === 'req') { if (document.activeElement !== t && t.placeholder === REQ_PH) typeDemo(); }
      else { const r = t.getBoundingClientRect(); if (r.bottom > 0 && r.top < innerHeight) replay(t, 'ring'); }
    }
  }
  idleT = setTimeout(nudge, 8000);
}
function poke() { clearTimeout(idleT); idleT = setTimeout(nudge, 8000); }
for (const t of ['pointerdown', 'keydown', 'input', 'wheel']) addEventListener(t, poke, { passive: true, capture: true });

// ------------------------------------------------------------ 시작
for (const lb of document.querySelectorAll('label.drop, label.pick')) keyable(lb);
if (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) for (const k of document.querySelectorAll('kbd.k-mod')) k.textContent = '⌘';
go(1);
renderPhotos();
poke();
// 처음 화면: 형광펜(0.3초) 뒤에 양식 칸 시연, 그 뒤에 붙임 손잡이 시연(2.5초, CSS)
setTimeout(dropDemo, 900);
// 미리보기 엔진(rhwp)과 기본 틀은 미리 받아 둔다(양식을 올리면 바로 보이게)
rhwp().then(() => { document.body.dataset.rhwp = '1'; }).catch(() => {});
standard().catch(() => {});
document.body.dataset.ready = '1';
