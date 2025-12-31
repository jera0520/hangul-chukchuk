// 사이트판에만: 문의 메일 「주소 복사」, 「고칠 점 적기」를 누를 때 설문의 「사용 환경」 칸 미리 채우기.
// 미리 채우는 것은 사이트판 버전·운영체제·브라우저·지금 단계·화면 폭·한글 엔진 상태뿐이다(문서 내용·파일 이름·오류 문구는 넣지 않는다).
// 설문은 사람이 눌러야 새 창으로 열리고, 보내기 전에 「사용 환경」 칸을 보고 고치거나 지울 수 있다.
(() => {
  const ua = navigator.userAgent;
  const os = () =>
    /iPhone|iPod/.test(ua) ? 'iPhone'
      : /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'iPad'
        : /Android/.test(ua) ? 'Android'
          : /Windows/.test(ua) ? 'Windows'
            : /Macintosh|Mac OS X/.test(ua) ? 'Mac'
              : /CrOS/.test(ua) ? 'ChromeOS'
                : /Linux/.test(ua) ? 'Linux' : '기타';
  // 카톡·인스타 등 앱 안에서 연 창은 따로 적는다(파일 받기가 막히는 경우가 많다)
  const inApp = [[/KAKAOTALK/i, '카카오톡 앱 안'], [/Instagram/, '인스타그램 앱 안'], [/Barcelona/, '스레드 앱 안'], [/NAVER\(inapp/, '네이버 앱 안'], [/FBAN|FBAV/, '페이스북 앱 안']];
  const browsers = [[/Edg(?:e|A|iOS)?\/(\d+)/, 'Edge'], [/Whale\/(\d+)/, 'Whale'], [/SamsungBrowser\/(\d+)/, 'Samsung'], [/OPR\/(\d+)/, 'Opera'], [/(?:Firefox|FxiOS)\/(\d+)/, 'Firefox'], [/(?:Chrome|CriOS)\/(\d+)/, 'Chrome'], [/Version\/(\d+)[\d.]* (?:Mobile\/\S+ )?Safari\//, 'Safari']];
  const browser = () => {
    const app = inApp.find(([re]) => re.test(ua));
    const b = browsers.find(([re]) => re.test(ua));
    const name = b ? b[1] + ' ' + ua.match(b[0])[1] : '브라우저 모름';
    return app ? app[1] + '(' + name + ')' : name;
  };
  const step = () => {
    const s = document.querySelector('section[data-step]:not([hidden])');
    return s ? s.dataset.step + '단계' : '단계 모름';
  };
  const engine = () => {
    const t = (document.getElementById('eng-status') || {}).textContent || '';
    return /준비됨/.test(t) ? '엔진 준비됨' : /못/.test(t) ? '엔진 못 불러옴' : '엔진 준비 중';
  };
  const env = ver => ['사이트판 ' + ver, os(), browser(), step(), '화면 ' + window.innerWidth + 'px', engine()].join(' · ');

  for (const a of document.querySelectorAll('a.fb-go')) {
    const fill = () => {
      const u = new URL(a.href);
      u.searchParams.set('usp', 'pp_url');
      u.searchParams.set('entry.' + a.dataset.entry, env(a.dataset.ver));
      a.href = u.href;
    };
    for (const t of ['pointerdown', 'focus', 'click']) a.addEventListener(t, fill);
  }

  const mail = document.getElementById('org-mail');
  const copy = document.getElementById('org-copy');
  if (!mail || !copy) return;
  copy.hidden = false;
  let timer;
  copy.addEventListener('click', async () => {
    let ok = false;
    try { await navigator.clipboard.writeText(mail.textContent.trim()); ok = true; } catch (e) { /* 복사가 막힌 브라우저 */ }
    if (!ok) {
      const r = document.createRange();
      r.selectNodeContents(mail);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
    }
    clearTimeout(timer);
    copy.textContent = ok ? '복사했습니다 ✓' : '주소를 골라 두었습니다. Ctrl+C(맥은 ⌘+C)로 복사하세요';
    copy.classList.toggle('done', ok);
    timer = setTimeout(() => { copy.textContent = '주소 복사'; copy.classList.remove('done'); }, ok ? 2400 : 6000);
  });
})();
