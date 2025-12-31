// 사이트판에만: 휴대폰으로 연 사람에게 1단계 표 맨 아래에 「휴대폰이면 · 컴퓨터로 주소 보내기」 줄을 더한다.
// 휴대폰에는 한글 양식이 거의 없고 보고서도 컴퓨터에서 쓰므로, 지금 주소를 내게 보내 두고 컴퓨터에서 이어 쓰게 한다.
// 누르면 휴대폰 공유 창(카톡 나와의 채팅·메일·에어드롭 등)을 열고, 공유 창이 없는 앱 안 브라우저에서는 주소를 복사한다.
// 휴대폰인지는 app.js의 phone()과 같은 조건(손가락으로만 누르는 좁은 화면)으로 본다.
// 스레드·인스타·카톡 등 앱 안 화면이면 <html data-inapp="threads"> 등을 단다(index.html 붙여 넣기 창 안내, org.js 설문 사용 환경, stats.js 세기가 함께 본다).
// 앱 안 화면은 링크로 연 다른 사이트가 이 화면 자리에 열리거나 파일 받기가 막히기도 해서, 휴대폰이면 표에 「브라우저로 열기」 줄도 더한다.
(() => {
  // [이름표, 열쇠, 이름, 돌아올 곳(…로), 브라우저로 여는 메뉴 자리]. 메타 앱(스레드·인스타·페이스북)은 오른쪽 위에 ⋯가 있다
  const INAPP = [
    [/Barcelona/, 'threads', '스레드', '스레드로', '오른쪽 위 ⋯'],
    [/Instagram/, 'instagram', '인스타그램', '인스타그램으로', '오른쪽 위 ⋯'],
    [/FBAN|FBAV|FB_IAB/, 'facebook', '페이스북', '페이스북으로', '오른쪽 위 ⋯'],
    [/KAKAOTALK/i, 'kakaotalk', '카카오톡', '카카오톡으로', '⋯ 메뉴'],
    [/NAVER\(inapp/, 'naver', '네이버', '네이버 앱으로', '⋯ 메뉴'],
  ];
  const app = INAPP.find(([re]) => re.test(navigator.userAgent));
  if (app) {
    document.documentElement.dataset.inapp = app[1];
    document.documentElement.dataset.inappName = app[2];
    for (const e of document.querySelectorAll('.app-back')) e.textContent = app[3];
  }

  // 안드로이드 브라우저에서는 붙여 넣기 창 ②의 ChatGPT 링크를 앱으로 여는 intent 링크로 바꾼다(앱 안 화면은 AI 링크를 숨기므로 빼고).
  // 웹 링크는 깔린 앱으로 넘어가지 않고 로그아웃된 웹으로 열린다. 주소는 /open-app: 첫 주소(/)를 받으면 앱이 크롬으로 되돌려 보낸다.
  // 앱이 있으면 로그인된 앱의 새 대화가 열리고, 없으면 크롬이 원래 웹 주소를 새 탭으로 연다
  if (!app && /Android/i.test(navigator.userAgent)) {
    const gpt = [...document.querySelectorAll('.ai-open a')].find(a => a.hostname === 'chatgpt.com');
    if (gpt) gpt.href = 'intent://chatgpt.com/open-app#Intent;scheme=https;package=com.openai.chatgpt;S.browser_fallback_url=' + encodeURIComponent(gpt.href) + ';end';
  }

  const tbl = document.querySelector('#s1 .tbl');
  if (!tbl || !matchMedia('(hover: none) and (pointer: coarse) and (max-width: 600px)').matches) return;
  const url = location.origin + location.pathname;
  const mk = (tag, props) => Object.assign(document.createElement(tag), props);
  const btn = mk('button', { type: 'button', className: 'btn quiet sm', id: 'pc-send', textContent: '컴퓨터로 주소 보내기' });
  const msg = mk('div', { className: 'msg', id: 'pc-msg', hidden: true });
  msg.setAttribute('role', 'status');
  const td = mk('div', { className: 'td' });
  td.append(btn, msg);
  tbl.append(mk('div', { className: 'th', textContent: '휴대폰이면' }), td);
  if (app) {
    const tip = mk('div', { className: 'td inapp-tip', id: 'inapp-tip' });
    tip.append(mk('p', { textContent: app[4] + ' → 브라우저로 열기' }), mk('p', { className: 'why', textContent: '앱 안 화면은 파일 받기가 막힐 수 있어요' }));
    tbl.append(mk('div', { className: 'th', textContent: app[2] + '에서 열었으면' }), tip);
  }

  const say = (...lines) => {
    msg.replaceChildren(...lines.map(t => mk('p', { className: 'ok', textContent: t })));
    msg.hidden = false;
  };
  // 옛 방식 복사: 클립보드 API가 막힌 앱 안 브라우저에서도 되는 경우가 많다
  const oldCopy = () => {
    const ta = mk('textarea', { value: url, readOnly: true });
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { /* 복사가 막힌 브라우저 */ }
    ta.remove();
    return ok;
  };
  btn.addEventListener('click', async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: '한글 척척', text: '한글 척척 · 컴퓨터에서 열어 쓰세요', url });
        say('보냈습니다. 컴퓨터에서 열어 쓰세요.');
        return;
      } catch (e) {
        if (e && e.name === 'AbortError') return; // 공유 창을 그냥 닫음
      }
    }
    let ok = false;
    try { await navigator.clipboard.writeText(url); ok = true; } catch (e) { ok = oldCopy(); }
    if (ok) say('주소를 복사했습니다.', '카톡 나와의 채팅에 붙여 두고 컴퓨터에서 여세요.');
    else say('컴퓨터에서 아래 주소를 여세요.', url);
  });
})();
