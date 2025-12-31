// 사이트판에만: 휴대폰으로 연 사람에게 1단계 표 맨 아래에 「휴대폰이면 · 컴퓨터로 주소 보내기」 줄을 더한다.
// 휴대폰에는 한글 양식이 거의 없고 보고서도 컴퓨터에서 쓰므로, 지금 주소를 내게 보내 두고 컴퓨터에서 이어 쓰게 한다.
// 누르면 휴대폰 공유 창(카톡 나와의 채팅·메일·에어드롭 등)을 열고, 공유 창이 없는 앱 안 브라우저에서는 주소를 복사한다.
// 휴대폰인지는 app.js의 phone()과 같은 조건(손가락으로만 누르는 좁은 화면)으로 본다.
(() => {
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
