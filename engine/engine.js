/* 한글 엔진(사이트판): 브라우저 안 파이썬(Pyodide)에서 hwpdoc.py를 돌린다. 문서는 이 컴퓨터 밖으로 나가지 않는다.
 * 사이트판은 엔진을 뒤쪽 일꾼(worker.js)에서 돌린다. 페이지 본체에서 돌리면 처음 열 때 파이썬을 준비하는 동안
 * 화면이 통째로 멈춘다(빠른 맥 약 2초, 느린 컴퓨터·휴대폰은 5~10초 넘게). 쓰는 법(loadEngine·runEngine)은
 * claude.ai판(app/engine/engine.js)과 같다. claude.ai 페이지 안에서는 일꾼이 몹시 느려 그쪽은 본체에서 돌린다.
 */
let worker = null;
let ready = null;
let seq = 0;
const waits = new Map();
let onStage = () => {};

function stop(err) {
  for (const w of waits.values()) w.no(err);
  waits.clear();
  if (worker) worker.terminate();
  worker = null;
  ready = null;
}

function ask(msg) {
  if (!worker) {
    worker = new Worker(new URL('worker.js', import.meta.url));
    worker.onmessage = e => {
      const m = e.data;
      if (m.stage) return onStage(m.stage);
      const w = waits.get(m.id);
      if (!w) return;
      waits.delete(m.id);
      if (m.ok) w.ok(m);
      else w.no(new Error(m.error));
    };
    // 일꾼 파일을 못 받았거나 일꾼이 죽었을 때: 기다리던 일을 모두 실패로 돌리고, 다음에 부르면 새로 띄운다
    worker.onerror = e => { e.preventDefault(); stop(new Error(e.message || '엔진 일꾼을 띄우지 못했습니다')); };
  }
  const id = ++seq;
  return new Promise((ok, no) => {
    waits.set(id, { ok, no });
    worker.postMessage({ id, ...msg });
  });
}

// 엔진을 한 번만 준비한다. onStage(글)로 진행 단계를 알린다.
export function loadEngine(stage) {
  if (stage) onStage = stage;
  if (ready) return ready;
  ready = ask({ boot: true }).then(() => true);
  ready.catch(() => { ready = null; });
  return ready;
}

// 엔진 명령 하나(analyze·build·slots·fill·check·text)를 돌리고 찍힌 글과 만들어진 파일을 돌려준다.
// mod를 'extra'로 주면 도우미(photos·cover)를 돌린다.
export async function runEngine(argv, files = {}, outputs = [], mod = 'hwpdoc') {
  await loadEngine();
  const r = await ask({ argv, files, outputs, mod });
  return { code: r.code, log: r.log, files: r.files };
}
