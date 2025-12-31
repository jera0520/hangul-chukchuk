// 사이트판에만: 「사용법 영상 보기」를 누르면 영상 창을 열고 처음부터 틀고, 닫으면 멈춘다.
// 단추 속 미리보기(howto_peek.mp4, 소리 없음)는 페이지가 다 열린 뒤, 1단계에서 단추가 화면에 보일 때만 받아 반복한다.
// 동작 줄이기나 데이터 절약을 켠 사람에게는 첫 그림만 보여 준다.
// 문서 캐릭터(척척이)는 처음에 미리보기 뒤에서 나와 손을 흔들고, 1단계에서 가만히 있으면 가끔 뛰거나 숨었다 나온다(네 번까지).
// 창(dialog)을 못 여는 옛 브라우저에서는 단추를 감춘 그대로 둔다.
(() => {
  const open = document.getElementById('howto-open');
  const dlg = document.getElementById('howto-dlg');
  if (!open || !dlg || typeof dlg.showModal !== 'function') return;
  const v = dlg.querySelector('video');
  const peek = open.querySelector('.howto-peek');
  const pal = open.querySelector('.howto-pal');
  const calm = matchMedia('(prefers-reduced-motion: reduce)');
  const saveData = () => !!(navigator.connection && navigator.connection.saveData);
  let seen = true;     // 단추가 화면에 보이는지
  let loaded = false;  // 페이지가 다 열렸는지
  let opened = false;  // 영상을 한 번이라도 열었는지
  let timers = [];
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));
  const stopAll = () => { timers.forEach(clearTimeout); timers = []; if (pal) pal.setAttribute('class', 'howto-pal'); };
  // 캐릭터 동작 하나를 처음부터 다시 튼다
  const act = (cls, ms) => {
    if (!pal || calm.matches) return;
    pal.classList.remove(cls);
    void pal.getBoundingClientRect();
    pal.classList.add(cls);
    later(() => pal.classList.remove(cls), ms);
  };
  const busy = () => {
    const s = document.querySelector('section[data-step]:not([hidden])');
    return !!s && s.dataset.step !== '1';
  };

  const peekOn = () => {
    if (!peek) return;
    if (calm.matches || saveData() || !loaded || !seen || busy() || dlg.open || document.hidden) { peek.pause(); return; }
    if (!peek.getAttribute('src')) peek.src = 'howto_peek.mp4';
    const p = peek.play();
    if (p && p.catch) p.catch(() => {});
  };

  let nudges = 0;
  const nudge = () => {
    if (calm.matches || opened || nudges >= 4) return;
    if (seen && !busy() && !dlg.open && !document.hidden) {
      nudges++;
      if (nudges % 2) { act('hop', 900); act('wave', 1100); } else act('back', 1500);
    }
    later(nudge, 9000);
  };
  const blink = () => {
    if (calm.matches) return;
    if (seen && !document.hidden) act('blink', 240);
    later(blink, 3200 + Math.random() * 2600);
  };
  const start = () => {
    if (!pal || calm.matches) return;
    pal.classList.remove('hide');
    if (seen) { act('out', 650); later(() => act('wave', 1100), 520); }
    later(blink, 2400);
    later(nudge, 9000);
  };

  if (pal && !calm.matches) pal.classList.add('hide');
  open.hidden = false;
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(es => { seen = es[es.length - 1].isIntersecting; peekOn(); }).observe(open);
  }
  const onLoad = () => { loaded = true; peekOn(); later(start, 700); };
  if (document.readyState === 'complete') onLoad(); else addEventListener('load', onLoad, { once: true });
  document.addEventListener('visibilitychange', peekOn);
  // 단계가 바뀌면(2~4단계는 멈춤, 1단계로 돌아오면 다시) 미리보기를 맞춘다
  const mo = new MutationObserver(peekOn);
  for (const s of document.querySelectorAll('section[data-step]')) mo.observe(s, { attributes: true, attributeFilter: ['hidden'] });
  calm.addEventListener('change', () => {
    stopAll();
    peekOn();
    if (!calm.matches) later(blink, 1500);
  });
  open.addEventListener('pointerenter', () => { if (!pal || !pal.classList.contains('hop')) act('hop', 900); });

  open.addEventListener('click', () => {
    opened = true;
    dlg.showModal();
    peekOn();
    try { v.currentTime = 0; } catch (e) { /* 아직 안 받은 영상 */ }
    const p = v.play();
    if (p && p.catch) p.catch(() => {});
  });
  dlg.querySelector('.howto-x').addEventListener('click', () => dlg.close());
  // 영상 바깥(어두운 곳)을 눌러도 닫힌다
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => {
    v.pause();
    open.focus();
    peekOn();
    later(() => { act('hop', 900); act('wave', 1100); }, 250);
  });
})();
