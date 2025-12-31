// 사이트판에만: 「사용법 영상 보기」를 누르면 영상 창을 열고 처음부터 틀고, 닫으면 멈춘다.
// 창(dialog)을 못 여는 옛 브라우저에서는 단추를 감춘 그대로 둔다.
(() => {
  const open = document.getElementById('howto-open');
  const dlg = document.getElementById('howto-dlg');
  if (!open || !dlg || typeof dlg.showModal !== 'function') return;
  const v = dlg.querySelector('video');
  open.hidden = false;
  open.addEventListener('click', () => {
    dlg.showModal();
    try { v.currentTime = 0; } catch (e) { /* 아직 안 받은 영상 */ }
    const p = v.play();
    if (p && p.catch) p.catch(() => {});
  });
  dlg.querySelector('.howto-x').addEventListener('click', () => dlg.close());
  // 영상 바깥(어두운 곳)을 눌러도 닫힌다
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => { v.pause(); open.focus(); });
})();
