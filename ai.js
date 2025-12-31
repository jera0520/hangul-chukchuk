/* AI 연결과 AI에게 보내는 부탁 글.
 * claude.ai 페이지 안에서는 보는 사람 본인의 Claude를 쓰고(sample), 이 컴퓨터의 시험 서버(127.0.0.1)에서는 /ai로 보낸다.
 * 사용자가 '쓰시는 AI에 붙여 넣기'를 고르면 이 페이지는 아무 데도 보내지 않고, 글을 복사해 주고 붙여 넣은 답을 읽는다.
 * AI에는 개인정보를 [이름1]처럼 가린 글만 간다. 한글 파일과 사진은 보내지 않는다.
 * 내 사이트판(site/build.mjs가 <meta name="hc-site">를 넣음)에서는 어떤 AI에도 연결하지 않고 붙여 넣기만 쓴다.
 */

export const SITE = !!document.querySelector('meta[name="hc-site"]');

export async function connectAI() {
  if (SITE) return null;
  if (window.claude && window.claude.use) {
    const s = await window.claude.use('sample').catch(() => null);
    if (s) {
      return {
        kind: 'claude',
        ask: (prompt, o = {}) => s(prompt, { onText: o.onText, signal: o.signal, modelTier: 'default' }).then(r => r.text),
      };
    }
  }
  if (/^(127\.0\.0\.1|localhost)$/.test(location.hostname)) {
    const q = new URLSearchParams(location.search).get('ai') || 'mock';
    const mode = q === 'paste' ? 'mock' : q;
    return {
      kind: 'dev-' + mode,
      ask: async (prompt, o = {}) => {
        let r;
        try {
          r = await fetch('/ai', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, mode }), signal: o.signal });
        } catch (e) {
          throw { code: o.signal && o.signal.aborted ? 'cancelled' : 'upstream_error', message: String(e) };
        }
        if (!r.ok) throw { code: 'upstream_error', message: await r.text() };
        const { text } = await r.json();
        // claude.ai처럼 글자가 조금씩 오는 것을 흉내 낸다(시험 서버 전용)
        if (o.onText) {
          const n = 6;
          for (let i = 1; i <= n; i++) {
            if (o.signal && o.signal.aborted) throw { code: 'cancelled' };
            const part = text.slice(0, Math.ceil(text.length * i / n));
            o.onText({ text: part, delta: part });
            if (i < n) await new Promise(ok => setTimeout(ok, 120));
          }
        }
        return text;
      },
    };
  }
  return null;
}

export function aiErrorText(e) {
  const code = (e && e.code) || '';
  const T = {
    not_granted: 'Claude 사용을 허락하지 않아 AI가 쓰지 못했습니다. 이 페이지를 새로 열고, Claude 사용을 묻는 창에서 「계속」을 누른 뒤 다시 해 주세요.',
    rate_limited: '지금은 Claude 사용량이 많아 잠시 쉬어야 합니다. 몇 분 뒤 [다시 하기]를 눌러 주세요.',
    sampling_disabled: '이 계정에서는 페이지 안 Claude를 쓸 수 없습니다. 다른 Claude 계정으로 열어 주세요.',
    session_expired: 'Claude 로그인이 풀렸습니다. 다시 로그인한 뒤 이 페이지를 새로 열어 주세요.',
    prompt_too_large: '붙임 자료가 너무 깁니다. 자료를 줄이거나 몇 개를 빼고 다시 해 주세요.',
    refused: 'Claude가 이 부탁에는 답하지 않았습니다. 부탁 글을 조금 바꿔 다시 해 주세요.',
    empty_completion: 'AI가 빈 답을 보냈습니다. [다시 하기]를 눌러 주세요.',
    cancelled: '멈췄습니다.',
  };
  return T[code] || 'AI 연결이 잠시 끊겼습니다. [다시 하기]를 눌러 주세요.';
}

// 쓰시는 AI(ChatGPT·Gemini 등)에 직접 붙여 넣는 방식: 이 페이지는 아무 데도 보내지 않고, 글을 복사해 주고 붙여 넣은 답을 받는다.
// ui(prompt, o)는 화면 쪽(app.js)이 만든다.
// 채팅 화면의 답 복사 단추는 줄바꿈을 지우고 꺾쇠 앞에 \ 를 붙이기도 한다(ChatGPT, 2026-10-14 시험). 코드 블록 안 글은 그대로 복사된다.
const PASTE_TAIL = '\n\n채팅 화면에서 복사할 때 줄바꿈이 사라지지 않게, 답 전체를 ```text 로 여는 코드 블록 하나에 넣는다. 코드 블록 밖에는 아무것도 쓰지 않는다.';

export function pasteAI(ui) {
  return { kind: 'paste', ask: (prompt, o = {}) => ui(prompt + PASTE_TAIL, o) };
}

// 줄 머리(@제목:, [소제목], ◦ …)는 여럿인데 줄바꿈이 거의 없으면 복사하다 줄바꿈이 사라진 답이다
export function flatAnswer(t, fill) {
  if (fill) return false;
  const b = grab(t, 'outline');
  const s = (b ? b.body : t).trim();
  const heads = (s.match(/@제목:|@쪽수:|@바꾸기:|\[소제목\]|\[\/?표[\] ]|[◦※□]/g) || []).length;
  return heads >= 4 && s.split('\n').length < heads / 2;
}

// 채팅 화면에서 복사한 답 다듬기: 줄바꿈, 보이지 않는 글자, 이스케이프된 꺾쇠, 굵은 글씨 표시(**)
export function cleanPasted(t) {
  let s = String(t || '').replace(/\r\n?/g, '\n').replace(/[\u200b-\u200d\ufeff]/g, '').replace(/\u00a0/g, ' ');
  s = s.replace(/\\([<>])/g, '$1');
  if (!/<(questions|outline|values)>/.test(s) && /&lt;(questions|outline|values)&gt;/.test(s)) {
    s = s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  }
  return s.replace(/\*\*/g, '');
}

// ------------------------------------------------------------ 부탁 글 재료
let refP = null;
// 시작할 때 미리 받아 둔다. 페이지가 다 열린 뒤 인터넷이 끊겨도 부탁 글을 만들 수 있다.
export function refs() {
  if (!refP) {
    refP = Promise.all(['outline', 'style', 'types'].map(n =>
      fetch(new URL('./engine/ref/' + n + '.txt', import.meta.url)).then(r => (r.ok ? r.text() : ''))))
      .then(([outline, style, types]) => ({ outline, style, types }));
    refP.catch(() => { refP = null; });
  }
  return refP;
}

function today() {
  const d = new Date();
  return d.getFullYear() + '. ' + (d.getMonth() + 1) + '. ' + d.getDate() + '.(' + '일월화수목금토'[d.getDay()] + ')';
}

const ROLE = `너는 대학·공공기관 직원이 쓰던 한글(HWPX) 양식에 맞춰 보고서·계획서·공문·일지를 쓰는 도우미다.
네가 쓴 개요(또는 칸 값)는 '한글 엔진'에 들어가 양식 디자인(글꼴·제목 상자·표 모양) 그대로 새 한글 문서가 된다.`;

const RULES = `꼭 지킬 것
- [이름1] [학번2] [전화3] [메일1] [주소1] [계좌1] [주민번호1] [생일1] [기타1] 같은 대괄호 표시는 개인정보를 가린 자리다. 필요한 곳에 그대로 옮겨 쓰고, 바꾸거나 풀어 쓰거나 번호를 바꾸거나 새로 만들지 않는다. 가려진 사람을 짐작하지 않는다.
- 지어내지 않는다. 사람 이름·날짜·장소·인원·금액·실적·만족도는 부탁·자료·답에 있는 것만 쓰고, 모르면 ○○로 비운다. ○○로 비워도 양식 표기 모양은 남긴다(예: 2026. ○○. ○○.(○), ○○명, 금○○원).
- 받은 자료의 수치·사례·고유 이름은 빠짐없이 쓴다(요약하며 버리지 않는다).
- 줄 머리 기호는 [양식 분석]의 '문단 종류(견본)'에 있는 것만 쓴다. 단계는 기호로 정해지므로 들여쓰기는 쓰지 않는다.
- 문체는 양식을 따른다. 보고서·계획서·결과 보고는 개조식(…함, …임, …예정), 공문·안내문은 서술식(…합니다).
- 날짜·시각·금액 표기는 양식에 쓰인 방식이 먼저이고, 없으면 [표기 기준]을 따른다.
- 틀 안 글자(표지·머리의 날짜·부서)는 @바꾸기로만 바뀐다. 틀에 새 문서 시점과 다른 옛 날짜·연도·학기가 있으면 @바꾸기로 고친다. 바꿀 글자는 [양식 분석]의 '틀 안 글자'를 띄어쓰기까지 그대로 복사한다. 모르는 값은 ○○.
- 같은 양식으로 새 문서를 만들 때는 [양식 개요]를 바탕으로 바뀐 줄만 고치고 줄 순서는 되도록 지킨다. 양식 안 개인정보(분석의 '주의')나 지난 문서의 실적 문장은 그대로 옮기지 않는다. 시점이 다른 실적은 날짜·숫자만 ○○로 비운다.
- 분량: 개요 맨 위에 @쪽수: N을 쓴다(양식에 표지가 있으면 표지를 뺀 본문 쪽 수). 정해진 게 없으면 양식 쪽 수. 늘릴 때는 소제목을 나누고 근거 줄을 더하며, 같은 말을 되풀이하지 않는다.
- 사진: 사용자가 올린 사진이 있으면 그 장수만큼 [사진] 칸을 만든다. 양식 개요에 [사진] 칸이 있는 표가 있으면 그 [표 N]을 사진이 다 들어갈 만큼 되풀이하고, 없으면 [표] 안에 "[사진] | [사진]" 줄과 설명 줄을 번갈아 쓴다. 설명은 [사진]에 적힌 설명을 차례대로 쓰고 없으면 ○○. 사진은 앱이 [사진1]부터 차례로 넣는다.
- 제목이 22자를 넘으면 뜻이 끊기는 곳에 \\n을 넣는다.
- 기관 이름·로고가 틀에 남아 있으면 그대로 둔다(사용자가 다른 기관 양식이라고 말했을 때만 이름을 @바꾸기로 고친다).`;

const QUESTION_RULES = `고르는 질문 정하기
- 문서를 만들기 전에 사용자가 고를 질문을 0~4개 정한다. 부탁·자료에 이미 있는 것은 묻지 않는다. 필요한 게 다 있으면 질문은 빈 배열이다.
- 보통 묻는 것(필요한 것만, 이 순서로 중요): 문서에 꼭 필요한데 모르는 사실(기간·장소·인원 등, "직접 적기" 보기) > 분량(보기에 쪽 수를 적는다: 원래 양식과 비슷하게(약 N쪽)·1쪽으로 짧게·더 자세히(약 N+2쪽)) > 사진 자리(결과·활동 보고인데 올린 사진이 없을 때만: 넣지 않음·4장(추천)·6장) > 시점(연도·학기·회차, 오늘 날짜와 양식 날짜로 짐작한 값을 추천) > 중점(2쪽 이상 보고서: 고르게(추천)·성과와 실적·개선점과 향후 계획).
- 질문마다 보기 2~4개, 가장 무난한 보기 하나에만 "recommended": true. 마지막 보기는 "알아서"(모르는 것은 ○○로 비움)로 한다. 사진 질문만 예외.
- 고를 수 없는 사실은 {"text": "직접 적기", "input": true, "hint": "예: 9. 15.~10. 6., 25명"}처럼 보기를 둔다.
- label은 짧은 이름(예: "시점", "분량", "운영 기간·인원"), 보기 text는 25자 안쪽.
- 이름·연락처·학번 같은 개인정보는 묻지 않는다.`;

const FILL_RULES = `칸 채우기(서식형 양식)
- 이 양식은 칸에 적는 서식(신청서·일지·청구서)이다. 문서를 새로 짜지 않고 [칸 목록]의 칸에 값을 넣는다.
- 값은 {"칸 이름": "넣을 글자"} JSON 하나다. 칸 이름은 [칸 목록] 맨 앞의 이름(T2.3.1, P3 등)만 쓴다. "(빈칸)"은 빈 칸이고 ← 뒤는 이웃 칸 글자(무슨 칸인지 힌트)다.
- 글자가 이미 있는 칸도 새 문서에 맞게 바꿔야 하면 값을 넣는다(예: 머리의 날짜). 그대로 둘 칸은 넣지 않는다.
- 칸 안에서 줄을 바꾸려면 \\n을 쓴다. 사진 칸은 값을 "[사진]"으로 한다.
- [제출 문구·서명란 N줄]이라고 적힌 칸(…제출합니다·날짜·(서명 또는 인)·○○장 귀하)은 보통 넣지 않는다(날짜·서명은 낼 때 직접 씀). 날짜나 이름을 꼭 바꿔야 하면 보이는 N줄을 같은 차례로 모두 쓰고(빈 줄 없이) 바꿀 줄만 고친다. 줄 수가 다르면 앱이 그 칸을 원래대로 둔다.
- 모르는 값은 그 칸을 넣지 않는다(빈칸으로 남김). 개인정보 칸은 가림 표시가 있을 때만 그 표시를 쓴다.`;

function context(c, refsText) {
  const L = [ROLE, '', '오늘 날짜: ' + today()];
  L.push('', '[양식 분석]', c.analysis.trim());
  if (c.fill) L.push('', '[칸 목록]', c.slots.trim());
  else L.push('', '[양식 개요] 지금 양식 내용을 개요 문법으로 꺼낸 것', c.outline0.trim());
  if (c.isDefault) L.push('', '(사용자가 양식을 올리지 않아 기본 보고서 틀을 쓴다. 문서 종류에 맞게 구성은 [문서 종류별 구성]을 참고한다.)');
  L.push('', '[사용자 부탁]', c.request.trim() || '(적지 않음)');
  for (const m of c.mats) L.push('', '[붙임 자료: ' + m.name + ']', m.text.trim());
  if (c.photos.length && c.fill && !/사진/.test(c.slots)) {
    // 사진 칸이 없는 서식: 아무 칸에나 [사진]을 쓰면 그 작은 칸에 사진이 들어가므로 쓰지 않게 하고, 앱이 끝에 사진 쪽을 붙인다
    L.push('', '[사진] 사용자가 사진 ' + c.photos.length + '장을 올렸다. 이 양식에는 사진 칸이 없어 앱이 문서 끝에 「붙임 사진」 쪽을 붙여 사진을 넣는다. 칸 값에 [사진]을 쓰지 않는다. 사진 설명(차례대로):');
    c.photos.forEach((p, i) => L.push((i + 1) + '. ' + (p || '(설명 없음)')));
  } else if (c.photos.length) {
    L.push('', '[사진] 사용자가 사진 ' + c.photos.length + '장을 올렸다. [사진] 칸을 ' + c.photos.length + '개 만든다. 사진 설명(차례대로):');
    c.photos.forEach((p, i) => L.push((i + 1) + '. ' + (p || '(설명 없음)')));
  } else {
    L.push('', '[사진] 올린 사진 없음');
  }
  if (!c.fill) L.push('', '[개요 문법]', refsText.outline.trim());
  L.push('', '[표기 기준]', refsText.style.trim());
  if (!c.fill) L.push('', '[문서 종류별 구성] 양식과 자료가 우선, 막막할 때만 참고', refsText.types.trim());
  L.push('', c.fill ? FILL_RULES : RULES);
  return L.join('\n');
}

const FORMAT_FIRST_BUILD = `답 형식(이 순서로, 다른 말 없이)
<questions>
{"doc_kind": "결과 보고", "summary": "2026학년도 2학기 취업 특강 결과 보고를 약 2쪽으로 씁니다", "questions": [{"id": "q1", "label": "시점", "options": [{"text": "2026학년도 2학기", "recommended": true}, {"text": "직접 적기", "input": true, "hint": "예: 2026학년도 1학기"}, {"text": "알아서"}]}]}
</questions>
<outline>
모든 질문에서 recommended 보기를 골랐다고 보고 쓴 개요 전체(개요 문법 그대로, 설명 없이)
</outline>`;

const FORMAT_FIRST_FILL = `답 형식(이 순서로, 다른 말 없이)
<questions>
{"doc_kind": "스터디 일지", "summary": "10월 14일 스터디 일지 칸을 채웁니다", "questions": []}
</questions>
<values>
모든 질문에서 recommended 보기를 골랐다고 보고 정한 칸 값 JSON 하나
</values>`;

export async function firstPrompt(c) {
  const r = await refs();
  return [context(c, r), '', QUESTION_RULES, '', '할 일: 질문을 정하고, 추천 보기 기준으로 ' + (c.fill ? '칸 값을' : '개요를') + ' 쓴다.', '',
    c.fill ? FORMAT_FIRST_FILL : FORMAT_FIRST_BUILD].join('\n');
}

function resultFormat(c) {
  return c.fill
    ? '답 형식(다른 말 없이)\n<values>\n칸 값 JSON 하나\n</values>'
    : '답 형식(다른 말 없이)\n<outline>\n개요 전체(개요 문법 그대로, 설명 없이)\n</outline>';
}

// answers: [{label, choice}] 사용자가 고른 답
export async function answerPrompt(c, answers) {
  const r = await refs();
  const lines = answers.map(a => '- ' + a.label + ': ' + a.choice);
  return [context(c, r), '', '[사용자가 고른 답] "알아서"는 네가 정하되 모르는 사실은 ○○로 비운다는 뜻이다.', ...lines, '',
    '할 일: 위 답을 반영해 ' + (c.fill ? '칸 값을' : '개요를') + ' 쓴다. 더 묻지 않는다.', '', resultFormat(c)].join('\n');
}

export async function fixPrompt(c, current, notes) {
  const r = await refs();
  return [context(c, r), '', c.fill ? '[지금 칸 값]' : '[지금 개요]', current.trim(), '', '[엔진 점검]', notes.trim(), '',
    '할 일: 점검에 나온 문제("찾지 못했습니다"인 @바꾸기, 틀에 남은 옛 연도·날짜, 양식의 안내 글자(자리표시))를 고친 ' + (c.fill ? '칸 값 전체를' : '개요 전체를') + ' 쓴다. 나머지 내용은 그대로 둔다.', '', resultFormat(c)].join('\n');
}

export async function editPrompt(c, current, wish) {
  const r = await refs();
  return [context(c, r), '', c.fill ? '[지금 칸 값]' : '[지금 개요]', current.trim(), '', '[고칠 점] 사용자가 이렇게 고쳐 달라고 했다', wish.trim(), '',
    '할 일: 고칠 점만 반영한 ' + (c.fill ? '칸 값 전체를' : '개요 전체를') + ' 쓴다. 말하지 않은 부분은 그대로 둔다.', '', resultFormat(c)].join('\n');
}

// ------------------------------------------------------------ 답 읽기
function grab(text, tag) {
  const m = text.match(new RegExp('<' + tag + '>([\\s\\S]*?)(</' + tag + '>|$)'));
  return m ? { body: m[1], closed: !!m[2] } : null;
}

function stripFence(s) {
  return s.replace(/^\s*```[a-zA-Z]*[ \t]*\n?/, '').replace(/\n?```\s*$/, '').trim();
}

function parseJson(s) {
  const t = stripFence(s);
  try { return JSON.parse(t); } catch (e) { /* 아래에서 한 번 더 */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { /* 못 읽음 */ } }
  return null;
}

// 질문 JSON을 화면에 쓰기 좋게 다듬는다(질문 4개, 보기 4개까지, 추천 하나)
function cleanQuestions(q) {
  if (!q || typeof q !== 'object') return null;
  const qs = Array.isArray(q.questions) ? q.questions : [];
  const out = [];
  for (const [i, x] of qs.entries()) {
    if (!x || !Array.isArray(x.options) || !x.options.length) continue;
    const options = x.options.slice(0, 4).map(o => (typeof o === 'string' ? { text: o } : o))
      .filter(o => o && typeof o.text === 'string' && o.text.trim())
      .map(o => ({ text: o.text.trim(), recommended: !!o.recommended, input: !!o.input, hint: typeof o.hint === 'string' ? o.hint : '' }));
    if (!options.length) continue;
    if (!options.some(o => o.recommended)) options[0].recommended = true;
    let seen = false;
    for (const o of options) { if (o.recommended && seen) o.recommended = false; if (o.recommended) seen = true; }
    out.push({ id: String(x.id || 'q' + (i + 1)), label: String(x.label || '질문 ' + (i + 1)).trim(), options });
    if (out.length === 4) break;
  }
  return { kind: typeof q.doc_kind === 'string' ? q.doc_kind : '', summary: typeof q.summary === 'string' ? q.summary : '', questions: out };
}

// 스트리밍 중에도 부를 수 있다. questions가 아직 안 끝났으면 null.
export function readAnswer(text, fill, final = false) {
  const q = grab(text, 'questions');
  const body = grab(text, fill ? 'values' : 'outline');
  const res = { questions: null, questionsDone: !!(q && q.closed), body: null, bodyDone: !!(body && body.closed) };
  if (q && q.closed) res.questions = cleanQuestions(parseJson(q.body));
  if (body) {
    if (fill) res.body = body.closed || final ? parseJson(body.body) : null;
    else res.body = stripFence(body.body);
  }
  // 태그 없이 개요만 보낸 답도 받아 준다
  if (!q && !body && !fill && /^\s*@제목:/m.test(text)) { res.body = stripFence(text); res.bodyDone = true; }
  return res;
}
