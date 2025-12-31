// 사이트판에만: 쓴 횟수 세기. 세는 곳은 김진현 Cloudflare 계정의 작은 집계 프로그램(counter/, 주소는 <meta name="hc-count">)이다.
// 보내는 것은 일 이름 하나(열어 봄·휴대폰에서 열어 봄·누른 단추·양식 읽기 끝/실패·단계·붙여 넣기·결과·받기·고쳐 달라고 함 등)와,
// 열 때만 들어온 곳의 주소 이름(예: www.threads.com)뿐이다. 문서 내용·파일 이름·이름·연락처는 보내지 않고 쿠키도 쓰지 않는다.
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
  // 들어온 곳: 다른 사이트면 주소 이름만, 이 사이트의 다른 쪽(자료실 등)이면 첫 경로까지
  const from = () => {
    try {
      const u = new URL(document.referrer);
      if (!/^https?:$/.test(u.protocol)) return '';
      return u.hostname === location.hostname ? u.hostname + '/' + (u.pathname.split('/')[1] || '') : u.hostname;
    } catch (e) { return ''; }
  };
  send('open|' + from());
  // 휴대폰(손가락으로만 누르는 좁은 화면, app.js의 phone()과 같은 조건)이면 따로 하나 더
  if (matchMedia('(hover: none) and (pointer: coarse) and (max-width: 600px)').matches) send('phone');

  // 단계: 1→2(「다음」 누름), 3→4(결과 나옴). 붙여 넣기 창: 3단계에서는 문서마다 처음 한 번, 4단계에서 열리면 「고쳐 달라고 함」
  const secs = [...document.querySelectorAll('section[data-step]')];
  const now = () => { const s = secs.find(x => !x.hidden); return s ? Number(s.dataset.step) : 0; };
  let step = now(), pasted = false;
  const watch = new MutationObserver(() => {
    const n = now();
    if (n === step) return;
    if (step === 1 && n === 2) { send('step2'); pasted = false; }
    if (step === 3 && n === 4) send('step4');
    step = n;
  });
  for (const s of secs) watch.observe(s, { attributes: true, attributeFilter: ['hidden'] });
  const paste = document.getElementById('paste');
  if (paste) {
    new MutationObserver(() => {
      if (paste.hidden) return;
      if (now() === 4) send('fix');
      else if (!pasted) { pasted = true; send('paste'); }
    }).observe(paste, { attributes: true, attributeFilter: ['hidden'] });
  }

  // 1단계: 양식을 읽어 「다음」이 켜짐, 양식을 못 읽음(오류 글이 나옴), 한글 엔진을 못 불러옴(한 번만)
  const next = document.getElementById('to2');
  if (next) {
    let off = next.disabled;
    new MutationObserver(() => {
      if (off && !next.disabled) send('form_ok');
      off = next.disabled;
    }).observe(next, { attributes: true, attributeFilter: ['disabled'] });
  }
  const fmsg = document.getElementById('f-msg');
  if (fmsg) new MutationObserver(() => { if (fmsg.querySelector('p:not(.ok)')) send('form_err'); }).observe(fmsg, { childList: true });
  const eng = document.getElementById('eng-status');
  if (eng) {
    const engWatch = new MutationObserver(() => {
      if (/못했습니다/.test(eng.textContent)) { send('eng_err'); engWatch.disconnect(); }
    });
    engWatch.observe(eng, { childList: true, characterData: true, subtree: true });
  }

  // 양식 파일: 고르기 창을 열고(라벨을 눌러도 키보드로 열어도 #f-input에 click이 간다) 파일을 고르거나 그냥 닫음, 1단계에서 끌어다 놓음
  document.addEventListener('change', e => {
    if (e.target instanceof HTMLInputElement && e.target.id === 'f-input' && e.target.files && e.target.files.length) send('pick_file');
  }, true);
  document.addEventListener('cancel', e => { if (e.target instanceof Element && e.target.id === 'f-input') send('up_cancel'); }, true);
  addEventListener('drop', e => {
    if (now() === 1 && e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) send('pick_file');
  }, true);
  // 사용법 영상을 끝까지 봄(ended는 버블링하지 않아 붙잡는 단계에서 본다)
  document.addEventListener('ended', e => { if (e.target instanceof Element && e.target.closest('#howto-dlg')) send('howto_end'); }, true);

  const CLICKS = [['#f-input', 'up_tap'], ['#f-default', 'pick_default'], ['#pc-send', 'pc_send'], ['#get-hwpx', 'dl_hwpx'], ['#get-hwp', 'dl_hwp'], ['#howto-open', 'howto'], ['#org-copy', 'org'], ['#org-mail', 'org'], ['a.fb-go', 'survey']];
  document.addEventListener('click', e => {
    if (!(e.target instanceof Element)) return;
    const hit = CLICKS.find(([sel]) => e.target.closest(sel));
    if (hit) send(hit[1]);
  }, true);
})();
