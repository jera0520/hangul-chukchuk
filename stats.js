// 사이트판에만: 쓴 횟수 세기. 세는 곳은 김진현 Cloudflare 계정의 작은 집계 프로그램(counter/, 주소는 <meta name="hc-count">)이다.
// 보내는 것은 일 이름 하나(열어 봄·휴대폰에서 열어 봄·누른 단추·양식 읽기 끝/실패·단계·부탁 글을 적기 시작함·붙여 넣기 창에서 한 일·결과·받기·고쳐 달라고 함 등)와,
// 열 때는 들어온 곳의 주소 이름(예: www.threads.com), 그 밖의 일에는 휴대폰이면 붙이는 |m 표시뿐이다. 문서 내용·파일 이름·이름·연락처는 보내지 않고 쿠키도 쓰지 않는다.
// 이 사이트 주소가 아니거나(시험판), 자동 시험 브라우저이거나, 추적 거부(GPC·Do Not Track)를 켠 브라우저에서는 보내지 않는다.
(() => {
  const meta = document.querySelector('meta[name="hc-count"]');
  if (!meta) return;
  const url = meta.content;
  // 자동 시험(dev/e2e_site.mjs의 count 장면)만 켜는 표시. 그때도 보내는 요청은 시험 도구가 가로챈다
  const test = window.__hcStatsTest === true;
  if (!test && (navigator.webdriver || location.hostname !== 'jera0520.github.io')) return;
  if (navigator.globalPrivacyControl === true || navigator.doNotTrack === '1' || window.doNotTrack === '1') return;

  const send = body => {
    try {
      fetch(url, { method: 'POST', body, mode: 'no-cors', credentials: 'omit', cache: 'no-store', keepalive: true }).catch(() => {});
    } catch (e) { /* 보내기가 막힌 브라우저 */ }
  };
  // 휴대폰(손가락으로만 누르는 좁은 화면, app.js의 phone()과 같은 조건)이면 열기 말고 다른 일에 |m을 붙인다(어디서 멈추는지 휴대폰과 컴퓨터를 나눠 보려고)
  const mobile = matchMedia('(hover: none) and (pointer: coarse) and (max-width: 600px)').matches;
  const hit = ev => send(mobile ? ev + '|m' : ev);
  // 문서 하나(1→2단계로 넘어갈 때마다 새로 셈)에 한 번만 세는 일
  const once = new Set();
  const one = ev => { if (!once.has(ev)) { once.add(ev); hit(ev); } };
  // 들어온 곳: 다른 사이트면 주소 이름만, 이 사이트의 다른 쪽(자료실 등)이면 첫 경로까지
  const from = () => {
    try {
      const u = new URL(document.referrer);
      if (!/^https?:$/.test(u.protocol)) return '';
      return u.hostname === location.hostname ? u.hostname + '/' + (u.pathname.split('/')[1] || '') : u.hostname;
    } catch (e) { return ''; }
  };
  send('open|' + from());
  if (mobile) hit('phone');

  // 단계: 1→2(「다음」 누름), 3→4(결과 나옴). 붙여 넣기 창: 3단계에서는 문서마다 처음 한 번, 4단계에서 열리면 「고쳐 달라고 함」
  const secs = [...document.querySelectorAll('section[data-step]')];
  const now = () => { const s = secs.find(x => !x.hidden); return s ? Number(s.dataset.step) : 0; };
  let step = now();
  const watch = new MutationObserver(() => {
    const n = now();
    if (n === step) return;
    if (step === 1 && n === 2) { hit('step2'); once.clear(); }
    if (step === 3 && n === 4) hit('step4');
    step = n;
  });
  for (const s of secs) watch.observe(s, { attributes: true, attributeFilter: ['hidden'] });
  const paste = document.getElementById('paste');
  const in3 = () => !!paste && !paste.hidden && now() === 3;
  if (paste) {
    new MutationObserver(() => {
      if (paste.hidden) return;
      if (now() === 4) hit('fix');
      else one('paste');
    }).observe(paste, { attributes: true, attributeFilter: ['hidden'] });
    // 3단계 붙여 넣기 창에서: AI 답을 붙여 넣음, 답에서 쓸 곳을 못 찾아 안내가 뜸, Esc로 그만둠(글 복사·AI 열기·그만두기 단추는 아래 CLICKS)
    const pin = document.getElementById('paste-in');
    if (pin) pin.addEventListener('input', () => { if (in3() && pin.value.trim()) one('paste_in'); });
    const pmsg = document.getElementById('paste-msg');
    if (pmsg) new MutationObserver(() => { if (in3() && /찾지 못했습니다|줄바꿈이 사라진/.test(pmsg.textContent)) one('paste_bad'); }).observe(pmsg, { childList: true });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && in3()) one('paste_cancel'); }, true);
  }
  // 3단계에 오류 글이 뜸(사람이 멈춘 「멈췄습니다」는 빼고)
  const s3msg = document.getElementById('s3-msg');
  if (s3msg) {
    new MutationObserver(() => {
      const p = s3msg.querySelector('p:not(.ok)');
      if (p && !/멈췄습니다/.test(p.textContent)) one('s3_err');
    }).observe(s3msg, { childList: true });
  }

  // 2단계: 부탁 글을 직접 적기 시작함(예시 넣기는 글을 대신 넣으므로 따로 셈)
  const req = document.getElementById('req');
  if (req) req.addEventListener('input', () => { if (req.value.trim()) one('req_type'); });

  // 1단계: 양식을 읽어 「다음」이 켜짐, 양식을 못 읽음(오류 글이 나옴), 한글 엔진을 못 불러옴(한 번만)
  const next = document.getElementById('to2');
  if (next) {
    let off = next.disabled;
    new MutationObserver(() => {
      if (off && !next.disabled) hit('form_ok');
      off = next.disabled;
    }).observe(next, { attributes: true, attributeFilter: ['disabled'] });
  }
  const fmsg = document.getElementById('f-msg');
  if (fmsg) new MutationObserver(() => { if (fmsg.querySelector('p:not(.ok)')) hit('form_err'); }).observe(fmsg, { childList: true });
  const eng = document.getElementById('eng-status');
  if (eng) {
    const engWatch = new MutationObserver(() => {
      if (/못했습니다/.test(eng.textContent)) { hit('eng_err'); engWatch.disconnect(); }
    });
    engWatch.observe(eng, { childList: true, characterData: true, subtree: true });
  }

  // 양식 파일: 고르기 창을 열고(라벨을 눌러도 키보드로 열어도 #f-input에 click이 간다) 파일을 고르거나 그냥 닫음, 1단계에서 끌어다 놓음
  document.addEventListener('change', e => {
    if (e.target instanceof HTMLInputElement && e.target.id === 'f-input' && e.target.files && e.target.files.length) hit('pick_file');
  }, true);
  document.addEventListener('cancel', e => { if (e.target instanceof Element && e.target.id === 'f-input') hit('up_cancel'); }, true);
  addEventListener('drop', e => {
    if (now() === 1 && e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) hit('pick_file');
  }, true);
  // 사용법 영상을 끝까지 봄(ended는 버블링하지 않아 붙잡는 단계에서 본다)
  document.addEventListener('ended', e => { if (e.target instanceof Element && e.target.closest('#howto-dlg')) hit('howto_end'); }, true);

  // 누른 곳 → 일 이름. 셋째 값 1은 문서마다 한 번만, 3은 3단계 붙여 넣기 창에서 문서마다 한 번만
  const CLICKS = [
    ['#f-input', 'up_tap'], ['#f-default', 'pick_default'], ['#pc-send', 'pc_send'], ['#get-hwpx', 'dl_hwpx'], ['#get-hwp', 'dl_hwp'],
    ['#howto-open', 'howto'], ['#org-copy', 'org'], ['#org-mail', 'org'], ['a.fb-go', 'survey'],
    ['#req', 'req_tap', 1], ['[data-ex]', 'req_ex', 1], ['#make', 'q_make', 1],
    ['#paste-copy', 'paste_copy', 3], ['.ai-open a', 'paste_ai', 3], ['#paste-cancel', 'paste_cancel', 3],
  ];
  document.addEventListener('click', e => {
    if (!(e.target instanceof Element)) return;
    const c = CLICKS.find(([sel]) => e.target.closest(sel));
    if (c && c[2] === 3) { if (in3()) one(c[1]); }
    else if (c) (c[2] ? one : hit)(c[1]);
    // 부탁 글이 빈 채로 「다음」(AI에 붙여 넣을 글 만들기)을 누름
    if (req && e.target.closest('#to3') && !req.value.trim()) one('to3_empty');
  }, true);
})();
