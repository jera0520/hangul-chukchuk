/* 한글 엔진 일꾼(사이트판): 브라우저 안 파이썬(Pyodide)에서 hwpdoc.py·extra.py를 돌린다. 문서는 이 컴퓨터 밖으로 나가지 않는다.
 * 페이지 쪽은 engine.js. 하는 일은 claude.ai판 app/engine/engine.js와 같고, 화면을 멈추지 않으려고 여기서 돌린다.
 */
const LXML = 'lxml-6.0.2-cp313-cp313-pyemscripten_2025_0_wasm32.whl';
const LIB = new URL('../lib/', self.location.href).href;
const T0 = performance.now();
const stage = t => self.postMessage({ stage: t + ' ' + ((performance.now() - T0) / 1000).toFixed(1) + '초' });
let ready = null;

function b64ToBytes(text) {
  const bin = atob(text.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function boot() {
  if (ready) return ready;
  ready = (async () => {
    // 압축 파일(.zip·.whl)은 글자(base64)로 올려 두었다(claude.ai판과 같은 lib/). 파이썬이 그 파일을 달라고 하면 풀어서 건넨다.
    const realFetch = self.fetch.bind(self);
    self.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input.href || input.url || String(input));
      if (/(python_stdlib\.zip|\.whl)$/.test(url)) {
        const text = await (await realFetch(url + '.b64.txt')).text();
        return new Response(b64ToBytes(text), { headers: { 'content-type': 'application/zip' } });
      }
      return realFetch(input, init);
    };
    try {
      stage('파이썬 불러오는 중');
      importScripts(LIB + 'pyodide/pyodide.js');
      const py = await loadPyodide({ indexURL: LIB + 'pyodide/' });
      stage('lxml 불러오는 중');
      await py.loadPackage(LIB + 'wheels/' + LXML);
      stage('엔진 불러오는 중');
      py.FS.writeFile('/hwpdoc.py', await (await realFetch(new URL('hwpdoc.py', self.location.href))).text());
      // 엔진 도우미(붙임 사진 쪽·서명란 칸 찾기). 인터넷이 끊겨도 쓰게 처음에 같이 받는다
      py.FS.writeFile('/extra.py', await (await realFetch(new URL('extra.py', self.location.href))).text());
      py.runPython("import sys\nsys.path.insert(0, '/')\nimport hwpdoc");
      try { py.FS.mkdir('/w'); } catch (e) { /* 이미 있음 */ }
      stage('준비 끝');
      return py;
    } finally {
      self.fetch = realFetch;
    }
  })();
  ready.catch(() => { ready = null; });
  return ready;
}

function run(py, argv, files, outputs, mod) {
  for (const [name, bytes] of Object.entries(files)) py.FS.writeFile('/w/' + name, bytes);
  py.globals.set('ARGV', py.toPy(argv));
  py.globals.set('MOD', mod);
  const res = py.runPython(`
import io, contextlib, importlib
_buf = io.StringIO()
with contextlib.redirect_stdout(_buf), contextlib.redirect_stderr(_buf):
    try:
        _code = importlib.import_module(MOD).main(list(ARGV))
    except SystemExit as _e:
        _code = _e.code if isinstance(_e.code, int) else 1
(_code, _buf.getvalue())
`).toJs();
  const out = {};
  for (const name of outputs) {
    try { out[name] = py.FS.readFile('/w/' + name); } catch (e) { out[name] = null; }
  }
  for (const name of [...Object.keys(files), ...outputs]) {
    try { py.FS.unlink('/w/' + name); } catch (e) { /* 없음 */ }
  }
  return { code: res[0], log: res[1], files: out };
}

self.onmessage = async e => {
  const { id, boot: only, argv, files = {}, outputs = [], mod = 'hwpdoc' } = e.data;
  try {
    const py = await boot();
    if (only) return self.postMessage({ id, ok: true });
    const r = run(py, argv, files, outputs, mod);
    self.postMessage({ id, ok: true, ...r }, Object.values(r.files).filter(Boolean).map(b => b.buffer));
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};
