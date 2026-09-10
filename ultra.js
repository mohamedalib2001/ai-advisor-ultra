/* ============================================================
   AI Advisor Ultra 6.0 — Neural Scanner
   وحدة مستقلة تضيف:
   1) الفحص العميق للجهاز (CPU / GPU / ذاكرة / تخزين / حرارة / قدرات)
   2) اكتشاف نماذج الذكاء الاصطناعي المثبّتة على الجهاز وتفاصيلها
   3) مستشار الترقية: ماذا تحتاج لتشغيل كل نموذج بسلاسة
   لا تعتمد على app.js لكنها تتكامل معه إن وُجد.
   ============================================================ */
(function () {
'use strict';

const U = (window.Ultra = window.Ultra || {});

U.state = {
  device: null,          // نتيجة الفحص العميق
  scanning: false,
  servers: [],           // خوادم الذكاء المكتشفة
  localModels: [],       // النماذج المثبّتة
  browserModels: [],     // نماذج مخزّنة داخل المتصفح
  discovering: false,
  profile: null          // مواصفات مؤكّدة من المستخدم
};

/* ==================== أدوات مساعدة ==================== */
const $ = (id) => document.getElementById(id);
const esc = (v = '') => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const num = (n, d = 1) => (Number.isFinite(n) ? Number(n).toFixed(d).replace(/\.0+$/, '') : '—');
const bytesGB = (b) => (b || 0) / (1024 ** 3);

function fmtSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, v = bytes;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 100 || i < 2 ? 0 : 1)} ${units[i]}`;
}

function toast(msg) {
  if (typeof window.showToast === 'function') return window.showToast(msg);
  console.log('[Ultra]', msg);
}

function saveLS(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {} }
function loadLS(key, fallback = null) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
}

/* ==================== الأنماط ==================== */
const CSS = `
.u-wrap{display:flex;flex-direction:column;gap:16px}
.u-panel{background:rgba(10,14,34,.55);border:1px solid rgba(255,255,255,.09);border-radius:16px;padding:18px}
.u-panel h3{font-size:1.05em;margin-bottom:4px;letter-spacing:.2px}
.u-sub{color:#8f97b8;font-size:.86em;line-height:1.7}
.u-head{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;margin-bottom:14px}
.u-actions{display:flex;flex-wrap:wrap;gap:8px}
.u-btn{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);color:#e6e9f5;border-radius:10px;
  padding:10px 15px;font-size:.9em;font-family:inherit;cursor:pointer;transition:background .15s,border-color .15s}
.u-btn:hover{background:rgba(255,255,255,.12)}
.u-btn:focus-visible{outline:2px solid #00d4ff;outline-offset:2px}
.u-btn[disabled]{opacity:.45;cursor:not-allowed}
.u-btn.go{background:linear-gradient(135deg,#7b2ff7,#00b8d4);border-color:transparent;font-weight:600}
.u-btn.sm{padding:6px 11px;font-size:.8em;border-radius:8px}
.u-btn.warn{border-color:rgba(231,76,60,.5);color:#ffb3ab}
.u-grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(190px,1fr))}
.u-metric{background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:13px 14px}
.u-metric .k{color:#8b93b5;font-size:.76em;margin-bottom:6px}
.u-metric .v{font-size:1.22em;font-weight:600;font-variant-numeric:tabular-nums;line-height:1.35;word-break:break-word}
.u-metric .h{color:#6f78a0;font-size:.72em;margin-top:5px;line-height:1.5}
.u-metric.ok{border-inline-start:3px solid #27ae60}
.u-metric.mid{border-inline-start:3px solid #f39c12}
.u-metric.bad{border-inline-start:3px solid #e74c3c}
.u-gauge{display:flex;gap:18px;align-items:center;flex-wrap:wrap}
.u-dial{position:relative;width:132px;height:132px;flex:0 0 auto}
.u-dial svg{transform:rotate(-90deg)}
.u-dial .mid{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center}
.u-dial .mid b{font-size:2.1em;font-variant-numeric:tabular-nums;line-height:1}
.u-dial .mid span{font-size:.72em;color:#8b93b5;margin-top:4px}
.u-bars{flex:1;min-width:220px;display:flex;flex-direction:column;gap:10px}
.u-bar-row{display:grid;grid-template-columns:88px 1fr 42px;gap:10px;align-items:center;font-size:.83em}
.u-bar{height:7px;border-radius:99px;background:rgba(255,255,255,.08);overflow:hidden}
.u-bar i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#00d4ff,#7b2ff7)}
.u-bar-row .n{text-align:end;color:#a9b0cf;font-variant-numeric:tabular-nums}
.u-log{background:#070a18;border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:12px 14px;
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.78em;line-height:1.9;max-height:190px;overflow:auto;direction:ltr;text-align:left}
.u-log div{color:#7f88ad}
.u-log div.on{color:#5ee0a8}
.u-log div.no{color:#ff8f85}
.u-server{border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:14px;background:rgba(255,255,255,.03);margin-bottom:12px}
.u-server .top{display:flex;gap:10px;align-items:center;flex-wrap:wrap;justify-content:space-between}
.u-server .name{font-weight:700;font-size:1.02em}
.u-chip{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:99px;font-size:.72em;
  background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);color:#c3c9e4;white-space:nowrap}
.u-chip.on{background:rgba(39,174,96,.16);border-color:rgba(39,174,96,.4);color:#7ce6ac}
.u-chip.mid{background:rgba(243,156,18,.14);border-color:rgba(243,156,18,.38);color:#ffd08a}
.u-chip.no{background:rgba(231,76,60,.14);border-color:rgba(231,76,60,.38);color:#ff9d93}
.u-model{border:1px solid rgba(255,255,255,.09);border-radius:12px;margin-top:10px;overflow:hidden;background:rgba(8,11,26,.5)}
.u-model .mhead{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:12px 14px;cursor:pointer}
.u-model .mhead:hover{background:rgba(255,255,255,.04)}
.u-model .mtitle{font-weight:600;font-size:.95em;word-break:break-all}
.u-model .mmeta{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
.u-model .mbody{padding:0 14px 14px;display:none;border-top:1px solid rgba(255,255,255,.07)}
.u-model.open .mbody{display:block}
.u-kv{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:12px}
.u-kv div{background:rgba(255,255,255,.035);border-radius:9px;padding:9px 11px}
.u-kv b{display:block;color:#868eb0;font-size:.72em;font-weight:400;margin-bottom:4px}
.u-kv span{font-size:.9em;font-variant-numeric:tabular-nums;word-break:break-word}
.u-verdict{margin-top:12px;border-radius:10px;padding:11px 13px;font-size:.86em;line-height:1.8;border:1px solid}
.u-verdict.ok{background:rgba(39,174,96,.1);border-color:rgba(39,174,96,.35)}
.u-verdict.mid{background:rgba(243,156,18,.1);border-color:rgba(243,156,18,.35)}
.u-verdict.no{background:rgba(231,76,60,.1);border-color:rgba(231,76,60,.35)}
.u-table{width:100%;border-collapse:collapse;font-size:.84em;margin-top:10px}
.u-table th,.u-table td{padding:9px 8px;text-align:start;border-bottom:1px solid rgba(255,255,255,.07);vertical-align:top}
.u-table th{color:#8b93b5;font-weight:500;font-size:.85em;white-space:nowrap}
.u-table td b{font-variant-numeric:tabular-nums}
.u-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
.u-form{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));margin-top:12px}
.u-field label{display:block;color:#8b93b5;font-size:.78em;margin-bottom:6px}
.u-field input,.u-field select{width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.13);
  border-radius:9px;padding:10px 11px;color:#e6e9f5;font-family:inherit;font-size:.92em}
.u-field input:focus,.u-field select:focus{outline:none;border-color:#00d4ff}
.u-note{border-inline-start:3px solid #00d4ff;background:rgba(0,212,255,.06);padding:11px 13px;border-radius:0 10px 10px 0;font-size:.85em;line-height:1.85;color:#bcc4e0}
.u-steps{counter-reset:s;display:flex;flex-direction:column;gap:10px;margin-top:12px}
.u-steps li{list-style:none;display:flex;gap:11px;font-size:.86em;line-height:1.8;color:#c3c9e4}
.u-steps li::before{counter-increment:s;content:counter(s);flex:0 0 24px;height:24px;border-radius:8px;
  background:rgba(123,47,247,.25);border:1px solid rgba(123,47,247,.5);display:grid;place-items:center;font-size:.8em;color:#d5c4ff}
.u-code{display:block;background:#070a18;border:1px solid rgba(255,255,255,.1);border-radius:9px;padding:9px 11px;margin-top:6px;
  font-family:ui-monospace,Menlo,monospace;font-size:.8em;direction:ltr;text-align:left;overflow-x:auto;color:#7ce6ac;white-space:pre}
.u-empty{text-align:center;padding:34px 16px;color:#7f88ad}
.u-empty .em{font-size:2.4em;margin-bottom:10px;opacity:.8}
.u-plan{border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:15px;background:rgba(255,255,255,.03)}
.u-plan h4{font-size:.98em;margin-bottom:4px}
.u-plan .cost{font-size:.78em;color:#8b93b5;margin-bottom:10px}
.u-plan ul{margin:0;padding-inline-start:18px;font-size:.85em;line-height:1.9;color:#c3c9e4}
.u-plan .unlock{margin-top:10px;font-size:.82em;color:#7ce6ac;line-height:1.7}
@media (max-width:520px){
  .u-dial{width:112px;height:112px}
  .u-bar-row{grid-template-columns:72px 1fr 38px}
  .u-panel{padding:14px}
}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
`;

function injectStyles() {
  if ($('ultraStyles')) return;
  const s = document.createElement('style');
  s.id = 'ultraStyles';
  s.textContent = CSS;
  document.head.appendChild(s);
}

/* ==================== بناء الواجهة ==================== */
const TABS = [
  { id: 'scan', icon: '🩺', label: 'فحص الجهاز', init: 'Ultra.renderScanTab()' },
  { id: 'localai', icon: '🧠', label: 'نماذجي المثبتة', init: 'Ultra.renderModelsTab()' },
  { id: 'upgrade', icon: '🧩', label: 'مستشار الترقية', init: 'Ultra.renderUpgradeTab()' }
];

function buildUI() {
  const tabsBar = document.querySelector('.main-tabs');
  const container = document.querySelector('.container') || document.body;
  if (!tabsBar) return;

  const settingsBtn = [...tabsBar.querySelectorAll('.main-tab')].find(b => (b.getAttribute('onclick') || '').includes('openSettings'));

  TABS.forEach(t => {
    if ($('tab-' + t.id)) return;
    const btn = document.createElement('button');
    btn.className = 'main-tab';
    btn.setAttribute('onclick', `switchMainTab(event, '${t.id}'); ${t.init}`);
    btn.innerHTML = `${t.icon} <span>${t.label}</span>`;
    if (settingsBtn) tabsBar.insertBefore(btn, settingsBtn); else tabsBar.appendChild(btn);

    const panel = document.createElement('div');
    panel.className = 'tab-content';
    panel.id = 'tab-' + t.id;
    panel.innerHTML = '<div class="u-wrap"><div class="u-panel"><div class="u-empty">جارٍ التحضير…</div></div></div>';
    const settingsModal = document.querySelector('.modal-overlay');
    if (settingsModal && settingsModal.parentElement === container) container.insertBefore(panel, settingsModal);
    else container.appendChild(panel);
  });
}

/* صيغة العدد بالعربية: نموذج واحد / نموذجان / ٣ نماذج / ١١ نموذجاً */
U.count = function (n, one = 'نموذج', two = 'نموذجان', few = 'نماذج', many = 'نموذجاً') {
  n = Math.round(n);
  if (n === 0) return `لا ${few}`;
  if (n === 1) return `${one} واحد`;
  if (n === 2) return two;
  if (n <= 10) return `${n} ${few}`;
  return `${n} ${many}`;
};

U.added = function (n) {
  n = Math.round(n);
  if (n <= 0) return 'لا جديد';
  if (n === 1) return 'نموذج واحد إضافي';
  if (n === 2) return 'نموذجان إضافيان';
  if (n <= 10) return `${n} نماذج إضافية`;
  return `${n} نموذجاً إضافياً`;
};

U.escape = esc;
U.fmtSize = fmtSize;

/* ============================================================
   1) الفحص العميق للجهاز
   ============================================================ */

const GPU_DB = [
  { re: /rtx\s?50\s?90|rtx\s?5090/i, vram: 32, bw: 1790, tier: 'extreme' },
  { re: /rtx\s?5080/i, vram: 16, bw: 960, tier: 'extreme' },
  { re: /rtx\s?4090/i, vram: 24, bw: 1008, tier: 'extreme' },
  { re: /rtx\s?4080/i, vram: 16, bw: 717, tier: 'extreme' },
  { re: /rtx\s?4070\s?ti/i, vram: 12, bw: 504, tier: 'high' },
  { re: /rtx\s?4070/i, vram: 12, bw: 504, tier: 'high' },
  { re: /rtx\s?4060\s?ti/i, vram: 8, bw: 288, tier: 'high' },
  { re: /rtx\s?4060/i, vram: 8, bw: 272, tier: 'mid' },
  { re: /rtx\s?3090/i, vram: 24, bw: 936, tier: 'extreme' },
  { re: /rtx\s?3080/i, vram: 10, bw: 760, tier: 'high' },
  { re: /rtx\s?3070/i, vram: 8, bw: 448, tier: 'high' },
  { re: /rtx\s?3060\s?ti/i, vram: 8, bw: 448, tier: 'high' },
  { re: /rtx\s?3060/i, vram: 12, bw: 360, tier: 'mid' },
  { re: /rtx\s?3050/i, vram: 8, bw: 224, tier: 'mid' },
  { re: /rtx\s?20(80|70)/i, vram: 8, bw: 448, tier: 'mid' },
  { re: /gtx\s?16(60|50)/i, vram: 6, bw: 192, tier: 'mid' },
  { re: /gtx\s?10(80|70)/i, vram: 8, bw: 256, tier: 'mid' },
  { re: /rx\s?7900/i, vram: 20, bw: 800, tier: 'extreme' },
  { re: /rx\s?7800/i, vram: 16, bw: 624, tier: 'high' },
  { re: /rx\s?7600/i, vram: 8, bw: 288, tier: 'mid' },
  { re: /rx\s?6900|rx\s?6800/i, vram: 16, bw: 512, tier: 'high' },
  { re: /rx\s?6700/i, vram: 12, bw: 384, tier: 'high' },
  { re: /rx\s?6600/i, vram: 8, bw: 224, tier: 'mid' },
  { re: /apple\s?m[3-5]\s?(ultra)/i, vram: 96, bw: 800, tier: 'extreme', unified: true },
  { re: /apple\s?m[3-5]\s?(max)/i, vram: 36, bw: 400, tier: 'extreme', unified: true },
  { re: /apple\s?m[3-5]\s?(pro)/i, vram: 18, bw: 273, tier: 'high', unified: true },
  { re: /apple\s?m[3-5]/i, vram: 12, bw: 120, tier: 'high', unified: true },
  { re: /apple\s?m2\s?(ultra|max)/i, vram: 32, bw: 400, tier: 'extreme', unified: true },
  { re: /apple\s?m[12]\s?pro/i, vram: 16, bw: 200, tier: 'high', unified: true },
  { re: /apple\s?m[12]/i, vram: 8, bw: 100, tier: 'mid', unified: true },
  { re: /adreno\s?7[0-9]{2}/i, vram: 4, bw: 60, tier: 'mid', unified: true },
  { re: /adreno|mali|powervr|immortalis|xclipse/i, vram: 3, bw: 40, tier: 'weak', unified: true },
  { re: /iris\s?xe|arc\s?a[0-9]/i, vram: 4, bw: 70, tier: 'mid', unified: true },
  { re: /intel|uhd|hd graphics|radeon\s?graphics|vega\s?\d/i, vram: 2, bw: 45, tier: 'weak', unified: true }
];

function lookupGPU(name = '') {
  const hit = GPU_DB.find(g => g.re.test(name));
  return hit ? { vram: hit.vram, bandwidth: hit.bw, tier: hit.tier, unified: !!hit.unified, matched: true }
             : { vram: 0, bandwidth: 0, tier: 'unknown', unified: false, matched: false };
}

/* ---------- اختبارات القياس ---------- */

function cpuSingleThread(ms = 700) {
  const end = performance.now() + ms;
  let ops = 0, x = 1.0001;
  while (performance.now() < end) {
    for (let i = 0; i < 30000; i++) { x = Math.sqrt(x * 1.0000001 + i % 7) + Math.sin(i * 0.0001); }
    ops += 30000;
  }
  return Math.round(ops / ms); // ops/ms
}

const WORKER_SRC = `self.onmessage=function(e){
  var end=performance.now()+e.data.ms, ops=0, x=1.0001;
  while(performance.now()<end){ for(var i=0;i<30000;i++){ x=Math.sqrt(x*1.0000001+i%7)+Math.sin(i*0.0001);} ops+=30000; }
  self.postMessage({ops:ops,x:x});
};`;

async function cpuMultiThread(threads, ms = 700) {
  if (typeof Worker === 'undefined' || !threads || threads < 2) return null;
  let url;
  try { url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' })); } catch (e) { return null; }
  const n = clamp(threads, 2, 16);
  const workers = [];
  try {
    const jobs = [];
    for (let i = 0; i < n; i++) {
      const w = new Worker(url);
      workers.push(w);
      jobs.push(new Promise(res => { w.onmessage = ev => res(ev.data.ops); w.onerror = () => res(0); w.postMessage({ ms }); }));
    }
    const results = await Promise.all(jobs);
    const total = results.reduce((a, b) => a + b, 0);
    return { threads: n, opsPerMs: Math.round(total / ms) };
  } catch (e) { return null; }
  finally { workers.forEach(w => { try { w.terminate(); } catch (e) {} }); try { URL.revokeObjectURL(url); } catch (e) {} }
}

function memoryBandwidth() {
  try {
    const N = 4 * 1024 * 1024; // 32MB
    const a = new Float64Array(N), b = new Float64Array(N);
    for (let i = 0; i < N; i += 1024) a[i] = i;
    const t0 = performance.now();
    let rounds = 0;
    while (performance.now() - t0 < 350) { b.set(a); rounds++; }
    const dt = (performance.now() - t0) / 1000;
    const gb = (rounds * N * 8 * 2) / (1024 ** 3);
    return Math.round((gb / dt) * 10) / 10; // GB/s (نسبة JS، أقل من الفعلي)
  } catch (e) { return 0; }
}

async function gpuCompute() {
  if (!navigator.gpu) return null;
  let device;
  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return null;
    device = await adapter.requestDevice();
  } catch (e) { return null; }

  const ITER = 4096, THREADS = 64 * 512;
  const code = `
@group(0) @binding(0) var<storage, read_write> out: array<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  var acc = vec4<f32>(f32(gid.x) * 0.0001, 1.0, 2.0, 3.0);
  let k = vec4<f32>(1.000001, 0.999999, 1.000002, 0.999998);
  for (var i = 0u; i < ${ITER}u; i = i + 1u) { acc = acc * k + k; }
  out[gid.x] = acc.x + acc.y + acc.z + acc.w;
}`;
  try {
    const module = device.createShaderModule({ code });
    const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
    const buf = device.createBuffer({ size: THREADS * 4, usage: GPUBufferUsage.STORAGE });
    const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: buf } }] });

    const run = async () => {
      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(pipeline); pass.setBindGroup(0, bind);
      pass.dispatchWorkgroups(THREADS / 64);
      pass.end();
      device.queue.submit([enc.finish()]);
      await device.queue.onSubmittedWorkDone();
    };
    await run(); // إحماء
    const t0 = performance.now();
    const passes = 6;
    for (let i = 0; i < passes; i++) await run();
    const dt = (performance.now() - t0) / 1000;
    const flops = THREADS * ITER * 8 * passes; // vec4 fma = 8 flops
    device.destroy && device.destroy();
    return { gflops: Math.round((flops / dt) / 1e9), seconds: dt };
  } catch (e) {
    try { device.destroy && device.destroy(); } catch (_) {}
    return null;
  }
}

async function thermalProbe(seconds = 6) {
  const slice = 400, samples = [];
  const t0 = performance.now();
  while (performance.now() - t0 < seconds * 1000) {
    samples.push(cpuSingleThread(slice));
    await sleep(10);
  }
  if (samples.length < 4) return null;
  const head = samples.slice(0, 2).reduce((a, b) => a + b, 0) / 2;
  const tail = samples.slice(-2).reduce((a, b) => a + b, 0) / 2;
  const drop = head > 0 ? clamp(Math.round((1 - tail / head) * 100), 0, 100) : 0;
  return { samples, start: Math.round(head), end: Math.round(tail), dropPercent: drop };
}

/* ---------- قدرات المتصفح ---------- */
function wasmFeatures() {
  const test = (bytes) => { try { return WebAssembly.validate(new Uint8Array(bytes)); } catch (e) { return false; } };
  return {
    wasm: typeof WebAssembly === 'object',
    simd: test([0,97,115,109,1,0,0,0,1,5,1,96,0,1,123,3,2,1,0,10,10,1,8,0,65,0,253,15,253,98,11]),
    threads: typeof SharedArrayBuffer !== 'undefined',
    bulkMemory: test([0,97,115,109,1,0,0,0,1,4,1,96,0,0,3,2,1,0,5,3,1,0,1,10,14,1,12,0,65,0,65,0,65,0,252,10,0,0,11]),
    crossOriginIsolated: !!window.crossOriginIsolated,
    secureContext: !!window.isSecureContext
  };
}

async function highEntropyUA() {
  try {
    if (!navigator.userAgentData || !navigator.userAgentData.getHighEntropyValues) return null;
    return await navigator.userAgentData.getHighEntropyValues([
      'architecture', 'bitness', 'model', 'platformVersion', 'uaFullVersion', 'fullVersionList'
    ]);
  } catch (e) { return null; }
}

async function webgpuDetails() {
  const out = { supported: false, adapter: null, features: [], limits: null, fallback: null };
  if (!navigator.gpu) return out;
  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return out;
    out.supported = true;
    out.fallback = !!adapter.isFallbackAdapter;
    let info = adapter.info || null;
    if (!info && adapter.requestAdapterInfo) { try { info = await adapter.requestAdapterInfo(); } catch (e) {} }
    if (info) out.adapter = { vendor: info.vendor || '', architecture: info.architecture || '', device: info.device || '', description: info.description || '' };
    try { out.features = [...adapter.features].slice(0, 24); } catch (e) {}
    if (adapter.limits) {
      const L = adapter.limits;
      out.limits = {
        maxBufferSize: L.maxBufferSize,
        maxStorageBufferBindingSize: L.maxStorageBufferBindingSize,
        maxComputeWorkgroupStorageSize: L.maxComputeWorkgroupStorageSize,
        maxComputeInvocationsPerWorkgroup: L.maxComputeInvocationsPerWorkgroup,
        maxTextureDimension2D: L.maxTextureDimension2D
      };
    }
  } catch (e) {}
  return out;
}

function webglDetails() {
  const out = { version: null, renderer: '', vendor: '', maxTexture: 0 };
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    if (!gl) return out;
    out.version = (typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext) ? 'WebGL 2.0' : 'WebGL 1.0';
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    if (dbg) {
      out.renderer = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || '';
      out.vendor = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) || '';
    }
    out.maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 0;
    const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
  } catch (e) {}
  return out;
}

async function storageDetails() {
  const out = { quota: 0, usage: 0, details: null, persisted: false, opfs: null };
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const est = await navigator.storage.estimate();
      out.quota = est.quota || 0; out.usage = est.usage || 0;
      out.details = est.usageDetails || null;
    }
    if (navigator.storage && navigator.storage.persisted) out.persisted = await navigator.storage.persisted();
  } catch (e) {}
  try {
    if (navigator.storage && navigator.storage.getDirectory) {
      const root = await navigator.storage.getDirectory();
      let files = 0, bytes = 0;
      if (root.entries) {
        for await (const [, handle] of root.entries()) {
          if (handle.kind === 'file') { files++; try { const f = await handle.getFile(); bytes += f.size; } catch (e) {} }
          else files++;
          if (files > 200) break;
        }
      }
      out.opfs = { entries: files, bytes };
    }
  } catch (e) {}
  return out;
}

async function batteryDetails() {
  try {
    if (!navigator.getBattery) return null;
    const b = await navigator.getBattery();
    return {
      level: Math.round(b.level * 100),
      charging: b.charging,
      dischargingTime: Number.isFinite(b.dischargingTime) && b.dischargingTime !== Infinity ? b.dischargingTime : null,
      chargingTime: Number.isFinite(b.chargingTime) && b.chargingTime !== Infinity ? b.chargingTime : null
    };
  } catch (e) { return null; }
}

/* ---------- الفحص الكامل ---------- */
U.deepScan = async function (onStep = () => {}) {
  if (U.state.scanning) return U.state.device;
  U.state.scanning = true;
  const d = { at: new Date().toISOString() };
  const step = async (t) => { onStep(t); await sleep(40); }; // فرصة للواجهة كي ترسم قبل الحمل التالي
  try {
    await step('قراءة هوية النظام…');
    d.ua = navigator.userAgent;
    d.uaData = await highEntropyUA();
    d.platform = (d.uaData && d.uaData.platform) || navigator.platform || '';
    d.os = detectOS(d);
    d.browser = detectBrowser(d);
    d.cores = navigator.hardwareConcurrency || 0;
    d.deviceMemory = navigator.deviceMemory || 0;
    d.touch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
    d.mobile = !!(navigator.userAgentData ? navigator.userAgentData.mobile : /Android|iPhone|iPad|Mobile/i.test(d.ua));
    d.screen = { w: screen.width, h: screen.height, dpr: window.devicePixelRatio || 1, depth: screen.colorDepth };
    d.language = navigator.language;
    d.timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    await step('فحص وحدة الرسوميات…');
    d.webgpu = await webgpuDetails();
    d.webgl = webglDetails();
    d.gpuName = (d.webgpu.adapter && (d.webgpu.adapter.description || d.webgpu.adapter.device)) || d.webgl.renderer || '';
    d.gpuVendor = (d.webgpu.adapter && d.webgpu.adapter.vendor) || d.webgl.vendor || '';
    d.gpuGuess = lookupGPU(`${d.gpuName} ${d.gpuVendor} ${d.webgpu.adapter ? d.webgpu.adapter.architecture : ''} ${d.ua}`);
    if (!d.gpuGuess.matched && d.webgpu.limits && d.webgpu.limits.maxBufferSize) {
      const bufGB = bytesGB(d.webgpu.limits.maxBufferSize);
      d.gpuGuess.vram = Math.max(2, Math.round(bufGB * 4));
      d.gpuGuess.bandwidth = d.mobile ? 40 : 120;
      d.gpuGuess.note = 'تقدير من حدود WebGPU';
    }

    await step('قياس المعالج…');
    d.cpuSingle = cpuSingleThread(600);
    d.cpuMulti = await cpuMultiThread(d.cores, 600);

    await step('قياس نطاق الذاكرة…');
    d.memBandwidth = memoryBandwidth();
    d.jsHeap = (performance.memory && performance.memory.jsHeapSizeLimit) ? performance.memory.jsHeapSizeLimit : 0;

    await step('قياس حساب الرسوميات…');
    d.gpuBench = await gpuCompute();

    await step('قياس ثبات الأداء الحراري…');
    d.thermal = await thermalProbe(5);

    await step('فحص التخزين والطاقة…');
    d.storage = await storageDetails();
    d.battery = await batteryDetails();
    d.network = navigator.connection ? {
      type: navigator.connection.effectiveType || '',
      downlink: navigator.connection.downlink || 0,
      rtt: navigator.connection.rtt || 0,
      saveData: !!navigator.connection.saveData
    } : null;

    await step('تدقيق قدرات المتصفح…');
    d.wasm = wasmFeatures();
    d.apis = {
      webgpu: d.webgpu.supported,
      workers: typeof Worker !== 'undefined',
      offscreen: typeof OffscreenCanvas !== 'undefined',
      indexedDB: !!window.indexedDB,
      opfs: !!(navigator.storage && navigator.storage.getDirectory),
      serviceWorker: 'serviceWorker' in navigator,
      speech: 'speechSynthesis' in window,
      webnn: typeof navigator.ml !== 'undefined'
    };

    d.ram = estimateRAM(d);
    d.vram = d.gpuGuess.vram || 0;
    d.bandwidth = effectiveBandwidth(d);
    d.scores = scoreDevice(d);
    d.health = healthAudit(d);
    U.state.device = d;
    saveLS('ultraDevice', { at: d.at, ram: d.ram, vram: d.vram, gpuName: d.gpuName, scores: d.scores });
    onStep('اكتمل الفحص');
  } finally {
    U.state.scanning = false;
  }
  return d;
};

function detectOS(d) {
  const ua = d.ua || '';
  const pv = d.uaData && d.uaData.platformVersion ? d.uaData.platformVersion : '';
  if (/Windows/i.test(ua) || /Windows/i.test(d.platform)) {
    const major = parseInt(pv, 10);
    if (major >= 13) return 'Windows 11';
    if (major > 0) return 'Windows 10';
    return 'Windows';
  }
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS / iPadOS';
  if (/Mac/i.test(ua)) return 'macOS' + (pv ? ' ' + pv.split('.')[0] : '');
  if (/Android/i.test(ua)) return 'Android' + (pv ? ' ' + pv.split('.')[0] : '');
  if (/CrOS/i.test(ua)) return 'ChromeOS';
  if (/Linux/i.test(ua)) return 'Linux';
  return 'غير معروف';
}

function detectBrowser(d) {
  const ua = d.ua || '';
  const list = (d.uaData && d.uaData.fullVersionList) || [];
  const pick = list.find(b => !/Not.?A.?Brand|Chromium/i.test(b.brand));
  if (pick) return `${pick.brand} ${String(pick.version).split('.')[0]}`;
  const m = ua.match(/(Edg|OPR|Chrome|Firefox|Safari)\/([\d.]+)/);
  if (!m) return 'متصفح غير معروف';
  const map = { Edg: 'Edge', OPR: 'Opera' };
  return `${map[m[1]] || m[1]} ${m[2].split('.')[0]}`;
}

function estimateRAM(d) {
  const profile = U.state.profile;
  if (profile && profile.ram) return { gb: profile.ram, source: 'مُدخل يدوياً', confident: true };
  const dm = navigator.deviceMemory || 0;
  if (dm >= 8) {
    let guess = 16;
    if (d.cores >= 16) guess = 32; else if (d.cores >= 12) guess = 24; else if (d.cores >= 8) guess = 16;
    if (d.mobile) guess = Math.min(guess, 12);
    return { gb: guess, source: `المتصفح يبلّغ 8GB كحد أقصى — تقدير من ${d.cores} نواة`, confident: false };
  }
  if (dm > 0) return { gb: dm, source: 'navigator.deviceMemory', confident: true };
  const heapGB = bytesGB(d.jsHeap || 0);
  if (heapGB > 0) return { gb: Math.max(4, Math.round(heapGB * 4)), source: 'تقدير من حجم كومة JS', confident: false };
  return { gb: d.mobile ? 6 : 8, source: 'تقدير افتراضي', confident: false };
}

function effectiveBandwidth(d) {
  const profile = U.state.profile;
  const measured = d.memBandwidth || 0;              // قياس JS (يقل عن الفعلي ~2.5x)
  const cpuBW = measured > 0 ? Math.round(measured * 2.4) : (d.mobile ? 30 : 45);
  const gpuBW = d.gpuGuess.bandwidth || 0;
  if (profile && profile.gpuBandwidth) return { cpu: cpuBW, gpu: profile.gpuBandwidth, unified: !!d.gpuGuess.unified };
  return { cpu: cpuBW, gpu: gpuBW, unified: !!d.gpuGuess.unified };
}

function scoreDevice(d) {
  const cpu = clamp(Math.round(((d.cpuSingle || 0) / 12000) * 55 + ((d.cpuMulti ? d.cpuMulti.opsPerMs : 0) / 60000) * 45), 0, 100);
  const gpu = d.gpuBench ? clamp(Math.round((d.gpuBench.gflops / 2500) * 100), 0, 100)
                          : (d.webgpu.supported ? 40 : 12);
  const mem = clamp(Math.round((d.ram.gb / 32) * 70 + (d.memBandwidth / 25) * 30), 0, 100);
  const disk = clamp(Math.round((bytesGB(d.storage.quota) / 200) * 100), 0, 100);
  const stability = d.thermal ? clamp(100 - d.thermal.dropPercent * 1.6, 0, 100) : 70;
  const overall = Math.round(cpu * 0.24 + gpu * 0.3 + mem * 0.28 + disk * 0.08 + stability * 0.1);
  return { cpu, gpu, mem, disk, stability, overall };
}

function healthAudit(d) {
  const issues = [];
  const freeGB = bytesGB((d.storage.quota || 0) - (d.storage.usage || 0));
  if (d.storage.quota && freeGB < 12) {
    issues.push({ level: 'bad', title: 'مساحة التخزين المتاحة للمتصفح ضيقة',
      why: `المتاح ${num(freeGB)} GB فقط، ونماذج الويب تحتاج 2–8 GB لكل نموذج.`,
      fix: 'فرّغ مساحة على القرص، أو نزّل النماذج عبر Ollama بدل تخزينها داخل المتصفح.' });
  }
  if (d.thermal && d.thermal.dropPercent >= 25) {
    issues.push({ level: 'bad', title: `أداء المعالج ينخفض ${d.thermal.dropPercent}% تحت الحمل`,
      why: 'انخفاض بهذا الحجم خلال ثوانٍ يعني خنقاً حرارياً أو وضع توفير طاقة.',
      fix: 'شغّل وضع الأداء العالي، ووصّل الشاحن، ونظّف المراوح ومداخل الهواء. التوليد الطويل سيتباطأ تدريجياً.' });
  } else if (d.thermal && d.thermal.dropPercent >= 12) {
    issues.push({ level: 'mid', title: `انخفاض طفيف في الأداء المستمر (${d.thermal.dropPercent}%)`,
      why: 'طبيعي في الأجهزة المحمولة، لكنه يقلل سرعة التوليد في الجلسات الطويلة.',
      fix: 'استخدم قاعدة تبريد أو ارفع خطة الطاقة إلى الأداء الأقصى.' });
  }
  if (d.battery && !d.battery.charging && d.battery.level < 35) {
    issues.push({ level: 'mid', title: `البطارية ${d.battery.level}% وغير موصولة`,
      why: 'معظم الأجهزة تخفض تردد المعالج والرسوميات تحت 30–40%.',
      fix: 'وصّل الشاحن قبل تشغيل نموذج محلي كبير.' });
  }
  if (!d.webgpu.supported) {
    issues.push({ level: 'bad', title: 'WebGPU غير مفعّل',
      why: 'بدونه لا يمكن تشغيل النماذج داخل المتصفح على كرت الرسوميات.',
      fix: 'استخدم Chrome أو Edge 121+ وفعّل تسريع الأجهزة، أو شغّل النماذج عبر Ollama خارج المتصفح.' });
  } else if (d.webgpu.fallback) {
    issues.push({ level: 'mid', title: 'WebGPU يعمل بمحوّل برمجي (fallback)',
      why: 'التنفيذ يجري على المعالج بدل كرت الرسوميات، والسرعة تنخفض عدة أضعاف.',
      fix: 'فعّل تسريع الأجهزة في المتصفح وحدّث تعريف كرت الرسوميات.' });
  }
  if (!d.wasm.simd) {
    issues.push({ level: 'mid', title: 'WASM SIMD غير متاح',
      why: 'الاستدلال على المعالج داخل المتصفح يصبح أبطأ 2–4 أضعاف.',
      fix: 'حدّث المتصفح إلى أحدث إصدار.' });
  }
  if (!d.wasm.crossOriginIsolated) {
    issues.push({ level: 'mid', title: 'الصفحة غير معزولة عبر المصادر',
      why: 'بدون COOP/COEP لا تتاح خيوط WASM المتعددة ولا قياس الذاكرة الدقيق.',
      fix: 'أضف ترويستَي Cross-Origin-Opener-Policy و Cross-Origin-Embedder-Policy عند الاستضافة.' });
  }
  if (location.protocol === 'https:' ) {
    issues.push({ level: 'mid', title: 'الصفحة على HTTPS والخوادم المحلية على HTTP',
      why: 'المتصفح يحجب الطلبات المختلطة، فلا تظهر نماذج Ollama أو LM Studio.',
      fix: 'افتح التطبيق من http://localhost أو من ملف محلي، أو مرّر الخادم المحلي عبر HTTPS.' });
  }
  const good = [];
  if (d.webgpu.supported && !d.webgpu.fallback) good.push('WebGPU يعمل بتسريع عتادي');
  if (d.cores >= 8) good.push(`${d.cores} نواة متاحة للاستدلال على المعالج`);
  if (d.storage.persisted) good.push('التخزين مثبّت — لن يمسح المتصفح النماذج تلقائياً');
  if (d.wasm.simd) good.push('WASM SIMD متاح');
  return { issues, good, freeGB };
}

/* ============================================================
   2) اكتشاف نماذج الذكاء الاصطناعي المثبّتة على الجهاز
   ============================================================ */

const HOSTS = ['http://localhost', 'http://127.0.0.1'];

async function probe(url, { timeout = 1600, method = 'GET', body = null, headers = null } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      method, body,
      headers: headers || (body ? { 'Content-Type': 'application/json' } : undefined),
      mode: 'cors', cache: 'no-store', signal: ctrl.signal, credentials: 'omit'
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const text = await res.text();
    try { return JSON.parse(text); } catch (e) { return { _raw: text }; }
  } catch (e) { clearTimeout(timer); return null; }
}

/* أوصاف الخوادم المدعومة */
const PROVIDERS = [
  {
    id: 'ollama', name: 'Ollama', port: 11434, icon: '🦙', kind: 'llm',
    site: 'ollama.com',
    async detect(base) {
      const tags = await probe(`${base}/api/tags`);
      if (!tags || !Array.isArray(tags.models)) return null;
      const ver = await probe(`${base}/api/version`, { timeout: 1200 });
      const ps = await probe(`${base}/api/ps`, { timeout: 1200 });
      const running = (ps && ps.models) ? ps.models : [];
      const models = tags.models.map(m => {
        const det = m.details || {};
        const live = running.find(r => r.name === m.name || r.model === m.model);
        return {
          id: m.name || m.model,
          provider: 'ollama',
          base,
          sizeBytes: m.size || 0,
          params: det.parameter_size || '',
          quant: det.quantization_level || '',
          family: det.family || (det.families ? det.families[0] : ''),
          format: det.format || '',
          modified: m.modified_at || '',
          digest: (m.digest || '').slice(0, 12),
          loaded: !!live,
          vramBytes: live ? (live.size_vram || 0) : 0,
          totalLoadedBytes: live ? (live.size || 0) : 0,
          expires: live ? live.expires_at : null
        };
      });
      return { version: ver && ver.version ? ver.version : '', models, running: running.length, manageable: true };
    }
  },
  {
    id: 'lmstudio', name: 'LM Studio', port: 1234, icon: '🎛️', kind: 'llm', site: 'lmstudio.ai',
    async detect(base) {
      const rich = await probe(`${base}/api/v0/models`);
      if (rich && Array.isArray(rich.data)) {
        return {
          version: 'REST v0',
          models: rich.data.map(m => ({
            id: m.id, provider: 'lmstudio', base,
            params: m.arch || '', quant: m.quantization || '',
            family: m.arch || '', type: m.type || '',
            ctx: m.max_context_length || 0,
            loadedCtx: m.loaded_context_length || 0,
            loaded: m.state === 'loaded',
            publisher: m.publisher || '',
            compat: m.compatibility_type || ''
          }))
        };
      }
      const list = await probe(`${base}/v1/models`);
      if (!list || !Array.isArray(list.data)) return null;
      return { version: 'OpenAI API', models: list.data.map(m => ({ id: m.id, provider: 'lmstudio', base })) };
    }
  },
  {
    id: 'llamacpp', name: 'llama.cpp / llamafile', port: 8080, icon: '⚙️', kind: 'llm', site: 'github.com/ggml-org/llama.cpp',
    async detect(base) {
      const props = await probe(`${base}/props`);
      const list = await probe(`${base}/v1/models`);
      if (!props && !list) return null;
      const models = [];
      if (list && Array.isArray(list.data)) {
        list.data.forEach(m => models.push({
          id: (m.id || '').split(/[\\/]/).pop() || m.id, provider: 'llamacpp', base,
          ctx: (props && props.default_generation_settings && props.default_generation_settings.n_ctx) || 0,
          path: m.id || '', loaded: true
        }));
      }
      if (!models.length && props) {
        models.push({
          id: (props.model_path || 'نموذج محمّل').split(/[\\/]/).pop(),
          provider: 'llamacpp', base, loaded: true,
          ctx: (props.default_generation_settings && props.default_generation_settings.n_ctx) || 0,
          path: props.model_path || ''
        });
      }
      if (!models.length) return null;
      return {
        version: (props && props.build_info) ? String(props.build_info).slice(0, 24) : '',
        note: props ? '' : 'خادم متوافق مع واجهة OpenAI على المنفذ 8080 — قد يكون LocalAI أو llamafile بدل llama.cpp',
        models
      };
    }
  },
  {
    id: 'jan', name: 'Jan', port: 1337, icon: '🫙', kind: 'llm', site: 'jan.ai',
    async detect(base) {
      const list = await probe(`${base}/v1/models`);
      if (!list || !Array.isArray(list.data)) return null;
      return { models: list.data.map(m => ({ id: m.id, provider: 'jan', base, family: m.name || '', ctx: (m.settings && m.settings.ctx_len) || 0 })) };
    }
  },
  {
    id: 'localai', name: 'LocalAI', port: 8081, icon: '🏠', kind: 'llm', site: 'localai.io',
    async detect(base) {
      const list = await probe(`${base}/v1/models`);
      if (!list || !Array.isArray(list.data)) return null;
      return { models: list.data.map(m => ({ id: m.id, provider: 'localai', base })) };
    }
  },
  {
    id: 'vllm', name: 'vLLM', port: 8000, icon: '🚄', kind: 'llm', site: 'docs.vllm.ai',
    async detect(base) {
      const list = await probe(`${base}/v1/models`);
      if (!list || !Array.isArray(list.data)) return null;
      return { models: list.data.map(m => ({ id: m.id, provider: 'vllm', base, ctx: m.max_model_len || 0, loaded: true })) };
    }
  },
  {
    id: 'kobold', name: 'KoboldCpp', port: 5001, icon: '📜', kind: 'llm', site: 'github.com/LostRuins/koboldcpp',
    async detect(base) {
      const m = await probe(`${base}/api/v1/model`);
      if (!m || !m.result) return null;
      const ctx = await probe(`${base}/api/extra/true_max_context_length`, { timeout: 1200 });
      return { models: [{ id: String(m.result).replace(/^koboldcpp\//, ''), provider: 'kobold', base, loaded: true, ctx: ctx ? ctx.value : 0 }] };
    }
  },
  {
    id: 'textgen', name: 'Text Generation WebUI', port: 5000, icon: '🧵', kind: 'llm', site: 'github.com/oobabooga/text-generation-webui',
    async detect(base) {
      const info = await probe(`${base}/v1/internal/model/info`);
      if (!info || !info.model_name) return null;
      return { models: [{ id: info.model_name, provider: 'textgen', base, loaded: true }] };
    }
  },
  {
    id: 'gpt4all', name: 'GPT4All', port: 4891, icon: '🖥️', kind: 'llm', site: 'gpt4all.io',
    async detect(base) {
      const list = await probe(`${base}/v1/models`);
      if (!list || !Array.isArray(list.data)) return null;
      return { models: list.data.map(m => ({ id: m.id, provider: 'gpt4all', base })) };
    }
  },
  {
    id: 'dockermr', name: 'Docker Model Runner', port: 12434, icon: '🐳', kind: 'llm', site: 'docs.docker.com',
    async detect(base) {
      const list = await probe(`${base}/engines/v1/models`);
      if (!list || !Array.isArray(list.data)) return null;
      return { models: list.data.map(m => ({ id: m.id, provider: 'dockermr', base })) };
    }
  },
  {
    id: 'comfy', name: 'ComfyUI', port: 8188, icon: '🎨', kind: 'image', site: 'github.com/comfyanonymous/ComfyUI',
    async detect(base) {
      const st = await probe(`${base}/system_stats`);
      if (!st || !st.devices) return null;
      const dev = st.devices[0] || {};
      const models = [];
      const ck = await probe(`${base}/models/checkpoints`, { timeout: 1800 });
      if (Array.isArray(ck)) ck.slice(0, 40).forEach(n => models.push({ id: n, provider: 'comfy', base, type: 'checkpoint' }));
      return {
        version: st.system ? `ComfyUI ${st.system.comfyui_version || ''}` : '',
        models,
        hardware: {
          device: dev.name || '', vramTotal: dev.vram_total || 0, vramFree: dev.vram_free || 0,
          torch: st.system ? st.system.pytorch_version : ''
        }
      };
    }
  },
  {
    id: 'a1111', name: 'Stable Diffusion WebUI', port: 7860, icon: '🖼️', kind: 'image', site: 'github.com/AUTOMATIC1111',
    async detect(base) {
      const list = await probe(`${base}/sdapi/v1/sd-models`);
      if (!Array.isArray(list)) return null;
      return { models: list.slice(0, 40).map(m => ({ id: m.model_name || m.title, provider: 'a1111', base, type: 'checkpoint', path: m.filename || '' })) };
    }
  },
  {
    id: 'openwebui', name: 'Open WebUI', port: 3000, icon: '🌐', kind: 'ui', site: 'openwebui.com',
    async detect(base) {
      const health = await probe(`${base}/health`);
      if (!health) return null;
      const list = await probe(`${base}/api/models`, { timeout: 1500 });
      const arr = (list && (list.data || list.models)) || [];
      return { models: arr.slice(0, 40).map(m => ({ id: m.id || m.name, provider: 'openwebui', base })), note: 'قد تتطلب تسجيل دخول لعرض النماذج' };
    }
  },
  {
    id: 'anythingllm', name: 'AnythingLLM', port: 3001, icon: '📦', kind: 'ui', site: 'anythingllm.com',
    async detect(base) {
      const ping = await probe(`${base}/api/ping`);
      if (!ping) return null;
      return { models: [], note: 'الخادم يعمل — تفاصيل النماذج تحتاج مفتاح API' };
    }
  }
];

/* اكتشاف كل الخوادم بالتوازي */
U.discoverLocalAI = async function (onStep = () => {}) {
  if (U.state.discovering) return;
  U.state.discovering = true;
  const servers = [];
  try {
    const jobs = PROVIDERS.map(async (p) => {
      for (const host of HOSTS) {
        const base = `${host}:${p.port}`;
        let res = null;
        try { res = await p.detect(base); } catch (e) { res = null; }
        if (res) {
          onStep(`✔ ${p.name} على ${base}`, true);
          servers.push({
            id: p.id, name: p.name, icon: p.icon, kind: p.kind, site: p.site,
            base, version: res.version || '', note: res.note || '',
            hardware: res.hardware || null, manageable: !!res.manageable,
            models: res.models || []
          });
          return;
        }
      }
      onStep(`✖ ${p.name} (المنفذ ${p.port})`, false);
    });
    await Promise.all(jobs);
  } finally {
    U.state.discovering = false;
  }
  servers.sort((a, b) => (b.models.length - a.models.length) || a.name.localeCompare(b.name));
  U.state.servers = servers;
  U.state.localModels = servers.flatMap(s => s.models.map(m => Object.assign(m, { serverName: s.name, serverIcon: s.icon, kind: s.kind })));
  return servers;
};

/* تفاصيل عميقة لنموذج Ollama */
U.ollamaShow = async function (base, name) {
  const data = await probe(`${base}/api/show`, { method: 'POST', body: JSON.stringify({ model: name }), timeout: 8000 });
  if (!data) return null;
  const mi = data.model_info || {};
  const arch = mi['general.architecture'] || (data.details && data.details.family) || '';
  const g = (suffix) => mi[`${arch}.${suffix}`];
  return {
    arch,
    contextLength: g('context_length') || 0,
    embedding: g('embedding_length') || 0,
    blocks: g('block_count') || 0,
    heads: g('attention.head_count') || 0,
    kvHeads: g('attention.head_count_kv') || 0,
    paramCount: mi['general.parameter_count'] || 0,
    quantVersion: mi['general.file_type'] || '',
    capabilities: data.capabilities || [],
    license: (data.license || '').split('\n')[0].slice(0, 80),
    template: !!data.template,
    system: (data.system || '').slice(0, 200),
    modelfileParams: (data.parameters || '').slice(0, 300)
  };
};

/* نماذج مخزّنة داخل المتصفح (WebLLM / transformers.js) */
U.scanBrowserModels = async function () {
  const found = [];
  try {
    if (window.caches && caches.keys) {
      const keys = await caches.keys();
      for (const key of keys) {
        if (!/webllm|mlc|model|transformers|onnx|hf/i.test(key)) continue;
        let entries = 0, bytes = 0, names = new Set();
        try {
          const cache = await caches.open(key);
          const reqs = await cache.keys();
          entries = reqs.length;
          for (const r of reqs.slice(0, 80)) {
            const m = r.url.match(/\/([\w.-]+(?:-MLC|-q4f\d+_\d|\.onnx|\.bin|\.wasm))/i);
            if (m) names.add(m[1]);
            try {
              const resp = await cache.match(r);
              const len = resp && resp.headers.get('content-length');
              if (len) bytes += parseInt(len, 10);
            } catch (e) {}
          }
        } catch (e) {}
        if (entries > 0) found.push({ store: key, entries, bytes, names: [...names].slice(0, 6), type: 'cache' });
      }
    }
  } catch (e) {}
  try {
    if (indexedDB.databases) {
      const dbs = await indexedDB.databases();
      dbs.filter(d => /model|llm|mlc|webllm|transformers|onnx/i.test(d.name || ''))
         .forEach(d => found.push({ store: d.name, entries: 0, bytes: 0, names: [], type: 'indexeddb' }));
    }
  } catch (e) {}
  U.state.browserModels = found;
  return found;
};

/* إدارة Ollama: سحب / حذف / تفريغ من الذاكرة / اختبار سريع */
U.ollamaPull = async function (base, name, onProgress) {
  const res = await fetch(`${base}/api/pull`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: name, stream: true }), mode: 'cors'
  });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const j = JSON.parse(line);
        const pct = j.total ? Math.round((j.completed || 0) / j.total * 100) : null;
        onProgress(j.status || '', pct);
      } catch (e) {}
    }
  }
  return true;
};

U.ollamaDelete = async function (base, name) {
  const res = await fetch(`${base}/api/delete`, {
    method: 'DELETE', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: name }), mode: 'cors'
  });
  return res.ok;
};

U.ollamaUnload = async function (base, name) {
  const res = await fetch(`${base}/api/generate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: name, keep_alive: 0 }), mode: 'cors'
  });
  return res.ok;
};

U.ollamaSpeedTest = async function (base, name) {
  const t0 = performance.now();
  const res = await probe(`${base}/api/generate`, {
    method: 'POST', timeout: 90000,
    body: JSON.stringify({ model: name, prompt: 'اكتب ثلاث جمل قصيرة عن البحر.', stream: false, think: false, options: { num_predict: 60 } })
  });
  if (!res) throw new Error('لا استجابة');
  const wall = (performance.now() - t0) / 1000;
  const tokens = res.eval_count || 0;
  const evalSec = res.eval_duration ? res.eval_duration / 1e9 : wall;
  const loadSec = res.load_duration ? res.load_duration / 1e9 : 0;
  return {
    tokensPerSec: evalSec > 0 ? Math.round((tokens / evalSec) * 10) / 10 : 0,
    tokens, wall: Math.round(wall * 10) / 10, load: Math.round(loadSec * 10) / 10,
    promptTokens: res.prompt_eval_count || 0,
    text: (res.response || '').slice(0, 300)
  };
};

/* ============================================================
   3) محرّك متطلبات النماذج ومستشار الترقية
   ============================================================ */

const QUANTS = [
  { id: 'Q4_K_M', bpw: 4.8, label: 'Q4_K_M — الأكثر استخداماً', quality: 'جودة ممتازة مقابل الحجم' },
  { id: 'Q5_K_M', bpw: 5.7, label: 'Q5_K_M', quality: 'أدق قليلاً من Q4' },
  { id: 'Q6_K', bpw: 6.6, label: 'Q6_K', quality: 'قريب جداً من الأصل' },
  { id: 'Q8_0', bpw: 8.6, label: 'Q8_0', quality: 'شبه بلا خسارة' },
  { id: 'FP16', bpw: 16.4, label: 'FP16', quality: 'الدقة الكاملة' }
];
const quantBpw = (id) => (QUANTS.find(q => q.id === id) || QUANTS[0]).bpw;

/* ذاكرة KV لكل رمز (ميغابايت) — مشتقة من بنى GQA الشائعة */
function kvPerToken(paramsB) {
  if (paramsB <= 2) return 0.03;
  if (paramsB <= 5) return 0.06;
  if (paramsB <= 9) return 0.125;
  if (paramsB <= 16) return 0.19;
  if (paramsB <= 35) return 0.25;
  if (paramsB <= 80) return 0.32;
  return 0.45;
}

U.footprint = function (model, quantId = 'Q4_K_M', ctx = 4096) {
  const bpw = quantBpw(quantId);
  const weights = (model.paramsB * bpw) / 8 * 1.03;          // GB
  const kv = (kvPerToken(model.paramsB) * ctx) / 1024;       // GB
  const overhead = 0.55 + Math.min(1.2, model.paramsB * 0.02);
  const total = weights + kv + overhead;
  return {
    weights: Math.round(weights * 100) / 100,
    kv: Math.round(kv * 100) / 100,
    overhead: Math.round(overhead * 100) / 100,
    total: Math.round(total * 100) / 100,
    activeGB: Math.round(((model.activeB || model.paramsB) * bpw / 8) * 100) / 100
  };
};

/* تقدير سرعة التوليد */
U.estimateSpeed = function (model, fp, hw) {
  const active = Math.max(0.3, fp.activeGB + fp.kv * 0.35);
  const gpuFits = hw.vram > 0 && fp.total <= hw.vram * 0.92;
  if (gpuFits && hw.gpuBW > 0) {
    return { tps: Math.round((hw.gpuBW / active) * 0.75), mode: 'الرسوميات بالكامل' };
  }
  if (hw.vram >= 2 && fp.total <= hw.ram && hw.gpuBW > 0) {
    const frac = clamp(hw.vram * 0.85 / fp.total, 0, 0.95);
    const bw = frac * hw.gpuBW + (1 - frac) * hw.cpuBW;
    return { tps: Math.round((bw / active) * 0.5), mode: `تقسيم بين الرسوميات والمعالج (${Math.round(frac * 100)}% على الكرت)` };
  }
  if (fp.total <= hw.ram) {
    return { tps: Math.round((hw.cpuBW / active) * 0.55 * 10) / 10, mode: 'المعالج والذاكرة' };
  }
  return { tps: 0, mode: 'لا تتسع الذاكرة' };
};

/* الحكم النهائي على نموذج مقابل الجهاز */
U.judge = function (model, hw, quantId = 'Q4_K_M', ctx = 4096) {
  const fp = U.footprint(model, quantId, ctx);
  const speed = U.estimateSpeed(model, fp, hw);
  const usableRAM = Math.max(2, hw.ram - (hw.unified ? 3 : 2.5)); // متروك للنظام
  let level, verdict;
  if (hw.vram > 0 && fp.total <= hw.vram * 0.92) { level = 'ok'; verdict = 'يعمل بالكامل على كرت الرسوميات'; }
  else if (fp.total <= usableRAM * 0.75) { level = speed.tps >= 12 ? 'ok' : 'mid'; verdict = speed.tps >= 12 ? 'يعمل بسلاسة' : 'يعمل لكن ببطء ملحوظ'; }
  else if (fp.total <= usableRAM) { level = 'mid'; verdict = 'يعمل على الحافة — أغلق التطبيقات الأخرى'; }
  else { level = 'no'; verdict = 'لا يعمل بهذه الإعدادات'; }

  if (level === 'no') { speed.tps = 0; speed.mode = 'لا تتسع الذاكرة'; }

  const needs = [];
  if (level === 'no') {
    const missingRAM = Math.ceil(fp.total + (hw.unified ? 3 : 2.5) - hw.ram);
    if (missingRAM > 0) needs.push({ type: 'ram', gb: missingRAM, text: `+${missingRAM} GB ذاكرة عشوائية على الأقل` });
  }
  if (hw.vram > 0 && fp.total > hw.vram * 0.92) {
    const missingVRAM = Math.ceil(fp.total - hw.vram);
    needs.push({ type: 'vram', gb: Math.ceil(fp.total), text: `كرت بذاكرة ${Math.ceil(fp.total + 1)} GB لتشغيله كاملاً على الرسوميات (ينقصك ${missingVRAM} GB)` });
  }
  if (level !== 'ok') {
    const cheaper = QUANTS.slice(0, QUANTS.findIndex(q => q.id === quantId)).pop();
    if (cheaper) needs.push({ type: 'quant', text: `أو انزل إلى ${cheaper.id} (${U.footprint(model, cheaper.id, ctx).total} GB)` });
    if (ctx > 2048) needs.push({ type: 'ctx', text: `أو قلّل السياق إلى 2048 رمزاً (${U.footprint(model, quantId, 2048).total} GB)` });
  }
  return { model, fp, speed, level, verdict, needs, quantId, ctx };
};

/* كتالوج النماذج المحلية الشائعة */
const CATALOG = [
  { id: 'qwen3:0.6b', name: 'Qwen3 0.6B', paramsB: 0.6, use: 'مهام سريعة وأجهزة ضعيفة', tags: ['خفيف'], pull: 'ollama pull qwen3:0.6b' },
  { id: 'llama3.2:1b', name: 'Llama 3.2 1B', paramsB: 1.2, use: 'تلخيص وردود قصيرة على الهاتف', tags: ['خفيف'], pull: 'ollama pull llama3.2:1b' },
  { id: 'gemma3:1b', name: 'Gemma 3 1B', paramsB: 1, use: 'مساعد نصي بسيط', tags: ['خفيف'], pull: 'ollama pull gemma3:1b' },
  { id: 'llama3.2:3b', name: 'Llama 3.2 3B', paramsB: 3.2, use: 'محادثة عامة متوازنة', tags: ['متوازن'], pull: 'ollama pull llama3.2:3b' },
  { id: 'qwen3:4b', name: 'Qwen3 4B Instruct', paramsB: 4, use: 'عربية جيدة وتفكير متوسط', tags: ['متوازن', 'عربي'], pull: 'ollama pull qwen3:4b-instruct' },
  { id: 'phi4-mini', name: 'Phi-4 Mini 3.8B', paramsB: 3.8, use: 'استدلال ورياضيات بحجم صغير', tags: ['استدلال'], pull: 'ollama pull phi4-mini' },
  { id: 'gemma3:4b', name: 'Gemma 3 4B', paramsB: 4.3, use: 'نص وصور معاً', tags: ['رؤية'], pull: 'ollama pull gemma3:4b' },
  { id: 'llama3.1:8b', name: 'Llama 3.1 8B', paramsB: 8, use: 'الخيار العام الأشهر', tags: ['متوازن'], pull: 'ollama pull llama3.1:8b' },
  { id: 'qwen3:8b', name: 'Qwen3 8B', paramsB: 8.2, use: 'محادثة وبرمجة وعربية', tags: ['متوازن', 'عربي'], pull: 'ollama pull qwen3:8b' },
  { id: 'deepseek-r1:8b', name: 'DeepSeek-R1 8B', paramsB: 8, use: 'سلاسل تفكير طويلة', tags: ['استدلال'], pull: 'ollama pull deepseek-r1:8b' },
  { id: 'qwen2.5-coder:7b', name: 'Qwen2.5 Coder 7B', paramsB: 7.6, use: 'إكمال وشرح الكود', tags: ['برمجة'], pull: 'ollama pull qwen2.5-coder:7b' },
  { id: 'qwen2.5vl:7b', name: 'Qwen2.5-VL 7B', paramsB: 8.3, use: 'قراءة الصور والمستندات', tags: ['رؤية'], pull: 'ollama pull qwen2.5vl:7b' },
  { id: 'gemma3:12b', name: 'Gemma 3 12B', paramsB: 12.2, use: 'جودة أعلى مع دعم الصور', tags: ['رؤية'], pull: 'ollama pull gemma3:12b' },
  { id: 'phi4:14b', name: 'Phi-4 14B', paramsB: 14.7, use: 'استدلال قوي بحجم متوسط', tags: ['استدلال'], pull: 'ollama pull phi4' },
  { id: 'qwen3:14b', name: 'Qwen3 14B', paramsB: 14.8, use: 'مهام معقدة على جهاز قوي', tags: ['متقدم'], pull: 'ollama pull qwen3:14b' },
  { id: 'qwen2.5-coder:14b', name: 'Qwen2.5 Coder 14B', paramsB: 14.8, use: 'مساعد برمجة جاد', tags: ['برمجة'], pull: 'ollama pull qwen2.5-coder:14b' },
  { id: 'gpt-oss:20b', name: 'GPT-OSS 20B', paramsB: 20.9, activeB: 3.6, use: 'خبراء متفرقة — سريع رغم حجمه', tags: ['MoE', 'استدلال'], pull: 'ollama pull gpt-oss:20b' },
  { id: 'mistral-small:24b', name: 'Mistral Small 3 24B', paramsB: 23.6, use: 'بديل مفتوح للنماذج المتوسطة', tags: ['متقدم'], pull: 'ollama pull mistral-small' },
  { id: 'qwen3:30b-a3b', name: 'Qwen3 30B-A3B', paramsB: 30.5, activeB: 3.3, use: 'جودة 30B بسرعة 3B', tags: ['MoE'], pull: 'ollama pull qwen3:30b-a3b' },
  { id: 'gemma3:27b', name: 'Gemma 3 27B', paramsB: 27.4, use: 'أقوى نموذج Gemma للأجهزة القوية', tags: ['متقدم', 'رؤية'], pull: 'ollama pull gemma3:27b' },
  { id: 'qwen3:32b', name: 'Qwen3 32B', paramsB: 32.8, use: 'قريب من النماذج السحابية', tags: ['متقدم'], pull: 'ollama pull qwen3:32b' },
  { id: 'deepseek-r1:32b', name: 'DeepSeek-R1 32B', paramsB: 32.8, use: 'استدلال عميق محلي', tags: ['استدلال'], pull: 'ollama pull deepseek-r1:32b' },
  { id: 'llama3.3:70b', name: 'Llama 3.3 70B', paramsB: 70.6, use: 'أعلى جودة لمحطة عمل', tags: ['محطة عمل'], pull: 'ollama pull llama3.3:70b' },
  { id: 'gpt-oss:120b', name: 'GPT-OSS 120B', paramsB: 116.8, activeB: 5.1, use: 'أقصى جودة مفتوحة', tags: ['MoE', 'محطة عمل'], pull: 'ollama pull gpt-oss:120b' },
  { id: 'nomic-embed-text', name: 'Nomic Embed Text', paramsB: 0.14, use: 'تمثيلات للبحث و RAG', tags: ['تضمين'], pull: 'ollama pull nomic-embed-text' }
];
U.catalog = CATALOG;

/* استخراج حجم المعاملات من اسم نموذج مثبّت */
function paramsFromName(m) {
  const src = `${m.params || ''} ${m.id || ''}`;
  const b = src.match(/(\d+(?:\.\d+)?)\s*[bB]\b/);
  if (b) return parseFloat(b[1]);
  const mm = src.match(/(\d+(?:\.\d+)?)\s*[mM]\b/);
  if (mm) return parseFloat(mm[1]) / 1000;
  if (m.sizeBytes) return Math.round(bytesGB(m.sizeBytes) / 0.6 * 10) / 10; // عكس Q4 تقريباً
  return 0;
}
function quantFromName(m) {
  const src = `${m.quant || ''} ${m.id || ''}`.toUpperCase();
  const hit = QUANTS.find(q => src.includes(q.id));
  if (hit) return hit.id;
  if (/Q4/.test(src)) return 'Q4_K_M';
  if (/Q5/.test(src)) return 'Q5_K_M';
  if (/Q6/.test(src)) return 'Q6_K';
  if (/Q8/.test(src)) return 'Q8_0';
  if (/F16|FP16|BF16/.test(src)) return 'FP16';
  return 'Q4_K_M';
}
U.paramsFromName = paramsFromName;
U.quantFromName = quantFromName;

/* مواصفات العتاد المستخدمة في الحسابات */
U.hardware = function () {
  const p = U.state.profile || {};
  const d = U.state.device;
  const ram = p.ram || (d ? d.ram.gb : 8);
  const gpuGuess = d ? d.gpuGuess : { vram: 0, bandwidth: 0, unified: false };
  const unified = p.unified != null ? p.unified : gpuGuess.unified;
  let vram = p.vram != null ? p.vram : gpuGuess.vram;
  if (unified) vram = Math.max(0, Math.round((ram - 3) * 0.7)); // ذاكرة موحّدة: الرسوميات تستعير من RAM
  const gpuBW = p.gpuBandwidth || gpuGuess.bandwidth || 0;
  const cpuBW = d ? d.bandwidth.cpu : 45;
  return { ram, vram, gpuBW, cpuBW, unified, gpuName: (d && d.gpuName) || 'غير معروف' };
};

/* خطط الترقية */
U.upgradePlans = function () {
  const hw = U.hardware();
  const d = U.state.device;
  const plans = [];
  const runnable = (h) => CATALOG.filter(m => {
    const fp = U.footprint(m, 'Q4_K_M', 4096);
    const sp = U.estimateSpeed(m, fp, h);
    return sp.tps >= 6 && (fp.total <= Math.max(h.vram, h.ram - 3));
  }).length;
  const now = runnable(hw);

  if (hw.ram < 32) {
    const target = hw.ram < 16 ? 16 : 32;
    const after = { ...hw, ram: target, cpuBW: Math.max(hw.cpuBW, 60),
                    vram: hw.unified ? Math.round((target - 3) * 0.7) : hw.vram };
    plans.push({
      tier: 'اقتصادي', title: `ارفع الذاكرة إلى ${target} GB`,
      cost: 'التكلفة الأقل مقابل أكبر فرق — 60‏–150 دولاراً عادةً',
      items: [
        `أضف وحدات ذاكرة حتى ${target} GB (تأكد من العمل بوضع ثنائي القناة)`,
        'شغّل الوحدتين بنفس التردد والتوقيت لرفع النطاق الفعلي',
        hw.unified ? 'الذاكرة الموحّدة غير قابلة للترقية على أجهزة Apple — الترقية تعني تبديل الجهاز' : 'تحقق من أقصى ذاكرة تدعمها اللوحة قبل الشراء'
      ],
      unlock: `${U.added(runnable(after) - now)} بسرعة مقبولة، وسياق أطول للنماذج التي تشغّلها اليوم`,
      blocked: hw.unified
    });
  }
  if (hw.vram < 16) {
    const after = { ...hw, vram: 16, gpuBW: 600 };
    plans.push({
      tier: 'متوازن', title: 'كرت رسوميات بذاكرة 16 GB',
      cost: 'الفئة الأوسع انتشاراً لتشغيل نماذج 14B–24B بالكامل على الكرت',
      items: [
        'ابحث عن 16 GB VRAM بنطاق ذاكرة ≥ 500 GB/s',
        'أمثلة شائعة: RTX 4060 Ti 16GB أو RTX 4080 أو RX 7800 XT',
        'تأكد من كفاية مزوّد الطاقة ومساحة الصندوق قبل الشراء'
      ],
      unlock: `${U.added(runnable(after) - now)}، وسرعة تقارب ${Math.round(600 / 5)} رمزاً/ثانية على نماذج 7–8B`,
      blocked: !!d && d.mobile
    });
  }
  const proAfter = { ...hw, vram: 32, ram: Math.max(hw.ram, 64), gpuBW: 1000 };
  plans.push({
    tier: 'احترافي', title: 'محطة عمل: 24–32 GB VRAM + 64 GB RAM',
    cost: 'للعمل الجاد: نماذج 70B مكمّمة وسياق طويل جداً',
    items: [
      'كرت واحد بذاكرة 24–32 GB أفضل من كرتين صغيرين للاستدلال',
      'قرص NVMe سريع ≥ 2 TB — تحميل النموذج يقرأ عشرات الغيغابايت',
      'تبريد جيد: الخنق الحراري يلتهم ثلث السرعة في الجلسات الطويلة'
    ],
    unlock: `${U.added(runnable(proAfter) - now)} بما فيها فئة 70B`,
    blocked: !!d && d.mobile
  });
  return { now, total: CATALOG.length, plans };
};

/* ============================================================
   4) الواجهات
   ============================================================ */

function metric(k, v, hint = '', cls = '') {
  return `<div class="u-metric ${cls}"><div class="k">${esc(k)}</div><div class="v">${v}</div>${hint ? `<div class="h">${hint}</div>` : ''}</div>`;
}
function chip(text, cls = '') { return `<span class="u-chip ${cls}">${esc(text)}</span>`; }
function bar(label, value) {
  return `<div class="u-bar-row"><span>${esc(label)}</span><span class="u-bar"><i style="width:${clamp(value, 0, 100)}%"></i></span><span class="n">${value}</span></div>`;
}
function dial(score) {
  const r = 54, c = 2 * Math.PI * r, off = c * (1 - clamp(score, 0, 100) / 100);
  const color = score >= 70 ? '#27ae60' : score >= 45 ? '#f39c12' : '#e74c3c';
  return `<div class="u-dial">
    <svg viewBox="0 0 132 132" width="100%" height="100%">
      <circle cx="66" cy="66" r="${r}" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="11"/>
      <circle cx="66" cy="66" r="${r}" fill="none" stroke="${color}" stroke-width="11" stroke-linecap="round"
        stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"/>
    </svg>
    <div class="mid"><b>${score}</b><span>من 100</span></div>
  </div>`;
}
function logLine(target, text, state) {
  const el = $(target); if (!el) return;
  const d = document.createElement('div');
  d.className = state === true ? 'on' : state === false ? 'no' : '';
  d.textContent = text;
  el.appendChild(d); el.scrollTop = el.scrollHeight;
}

/* ---------- تبويب فحص الجهاز ---------- */
U.renderScanTab = function () {
  const el = $('tab-scan'); if (!el) return;
  const d = U.state.device;
  el.innerHTML = `<div class="u-wrap">
    <div class="u-panel">
      <div class="u-head">
        <div>
          <h3>فحص عميق للجهاز</h3>
          <p class="u-sub">يقيس المعالج والرسوميات والذاكرة والثبات الحراري فعلياً، لا يقرأ الأرقام المعلنة فقط. يستغرق نحو ١٥ ثانية.</p>
        </div>
        <div class="u-actions">
          <button class="u-btn go" id="uScanBtn" onclick="Ultra.startScan()">${d ? 'أعد الفحص' : 'ابدأ الفحص'}</button>
          ${d ? '<button class="u-btn" onclick="Ultra.exportScan()">حفظ التقرير</button>' : ''}
        </div>
      </div>
      <div class="u-log" id="uScanLog"></div>
    </div>
    <div id="uScanResults">${d ? '' : `<div class="u-panel"><div class="u-empty"><div class="em">🩺</div>
      <p>لم يُفحص الجهاز بعد. الفحص يحدد ما يمكن لجهازك تشغيله محلياً وأين الاختناق.</p></div></div>`}</div>
  </div>`;
  if (d) renderScanResults(d);
};

U.startScan = async function () {
  const btn = $('uScanBtn'); if (btn) { btn.disabled = true; btn.textContent = 'جارٍ الفحص…'; }
  const log = $('uScanLog'); if (log) log.innerHTML = '';
  try {
    const d = await U.deepScan((step) => logLine('uScanLog', step));
    renderScanResults(d);
    toast('اكتمل فحص الجهاز');
    if (typeof window.unlockAchievement === 'function') window.unlockAchievement('analyzer');
  } catch (e) {
    logLine('uScanLog', 'تعذّر إكمال الفحص: ' + e.message, false);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'أعد الفحص'; }
  }
};

function renderScanResults(d) {
  const box = $('uScanResults'); if (!box) return;
  const s = d.scores;
  const gpuCls = s.gpu >= 60 ? 'ok' : s.gpu >= 30 ? 'mid' : 'bad';
  const ramCls = d.ram.gb >= 16 ? 'ok' : d.ram.gb >= 8 ? 'mid' : 'bad';
  const freeGB = d.health.freeGB;
  const th = d.thermal;

  const cap = (label, ok) => chip(label + (ok ? ' ✓' : ' ✗'), ok ? 'on' : 'no');

  box.innerHTML = `
  <div class="u-panel">
    <div class="u-gauge">
      ${dial(s.overall)}
      <div class="u-bars">
        <div style="font-size:.9em;color:#c3c9e4;margin-bottom:4px">جاهزية تشغيل الذكاء الاصطناعي محلياً على ${esc(d.os)} · ${esc(d.browser)}</div>
        ${bar('المعالج', s.cpu)}${bar('الرسوميات', s.gpu)}${bar('الذاكرة', s.mem)}${bar('التخزين', s.disk)}${bar('ثبات الأداء', s.stability)}
      </div>
    </div>
  </div>

  <div class="u-panel">
    <h3>المعالج</h3>
    <div class="u-grid" style="margin-top:12px">
      ${metric('الأنوية المنطقية', d.cores || '—', d.uaData && d.uaData.architecture ? `معمارية ${esc(d.uaData.architecture)} ${esc(d.uaData.bitness || '')} بت` : '')}
      ${metric('أداء نواة واحدة', num(d.cpuSingle / 1000, 1) + 'K', 'عملية/ملي ثانية — يحدد سرعة الاستجابة')}
      ${metric('أداء متعدد الخيوط', d.cpuMulti ? num(d.cpuMulti.opsPerMs / 1000, 1) + 'K' : 'غير متاح', d.cpuMulti ? `${d.cpuMulti.threads} خيوط متوازية` : 'العمال غير متاحين')}
      ${metric('كفاءة التوازي', d.cpuMulti && d.cpuSingle ? num(d.cpuMulti.opsPerMs / d.cpuSingle, 1) + '×' : '—', 'كم تضاعف الأداء عند استخدام كل الأنوية')}
      ${metric('طراز الجهاز', esc((d.uaData && d.uaData.model) || (d.mobile ? 'جهاز محمول' : 'حاسب')), esc(d.platform))}
    </div>
  </div>

  <div class="u-panel">
    <h3>الرسوميات</h3>
    <div class="u-grid" style="margin-top:12px">
      ${metric('الكرت', esc(d.gpuName || 'غير معلن'), d.gpuVendor ? esc(d.gpuVendor) : '', gpuCls)}
      ${metric('ذاكرة الرسوميات', d.vram ? d.vram + ' GB' : 'غير معروفة', d.gpuGuess.matched ? 'من قاعدة بيانات الكروت' : (d.gpuGuess.note || 'قدّرها يدوياً في تبويب الترقية'))}
      ${metric('نطاق الذاكرة', d.gpuGuess.bandwidth ? d.gpuGuess.bandwidth + ' GB/s' : '—', 'العامل الأول في سرعة توليد الرموز')}
      ${metric('حساب WebGPU', d.gpuBench ? d.gpuBench.gflops + ' GFLOPS' : (d.webgpu.supported ? 'فشل القياس' : 'WebGPU غير مدعوم'), 'قياس فعلي بتنفيذ شادر حسابي', d.gpuBench ? '' : 'bad')}
      ${metric('نوع المحوّل', d.webgpu.supported ? (d.webgpu.fallback ? 'برمجي (بطيء)' : 'عتادي') : '—', d.webgpu.adapter ? esc(`${d.webgpu.adapter.vendor} ${d.webgpu.adapter.architecture}`) : '', d.webgpu.fallback ? 'bad' : '')}
      ${metric('أقصى مخزن WebGPU', d.webgpu.limits ? fmtSize(d.webgpu.limits.maxBufferSize) : '—', 'يحد أكبر جزء من النموذج يمكن رفعه دفعة واحدة')}
      ${metric('WebGL', esc(d.webgl.version || 'غير مدعوم'), d.webgl.maxTexture ? `أقصى نسيج ${d.webgl.maxTexture}` : '')}
      ${metric('ميزات WebGPU', d.webgpu.features.length || '—', d.webgpu.features.slice(0, 3).map(esc).join('، '))}
    </div>
  </div>

  <div class="u-panel">
    <h3>الذاكرة والتخزين</h3>
    <div class="u-grid" style="margin-top:12px">
      ${metric('الذاكرة العشوائية', d.ram.gb + ' GB', esc(d.ram.source), ramCls)}
      ${metric('نطاق الذاكرة المقاس', d.memBandwidth ? d.memBandwidth + ' GB/s' : '—', `الفعلي التقريبي ${d.bandwidth.cpu} GB/s بعد التصحيح`)}
      ${metric('حد كومة JavaScript', d.jsHeap ? fmtSize(d.jsHeap) : 'غير معلن', 'سقف ما يستطيع المتصفح تخصيصه')}
      ${metric('حصة المتصفح من القرص', d.storage.quota ? fmtSize(d.storage.quota) : '—', `المستخدم ${fmtSize(d.storage.usage)}`)}
      ${metric('المتاح للنماذج', num(freeGB) + ' GB', freeGB > 20 ? 'يكفي عدة نماذج داخل المتصفح' : 'ضيق — فضّل Ollama', freeGB > 20 ? 'ok' : freeGB > 8 ? 'mid' : 'bad')}
      ${metric('تثبيت التخزين', d.storage.persisted ? 'مفعّل' : 'غير مفعّل', d.storage.persisted ? 'لن تُحذف النماذج تلقائياً' : 'قد يمسح المتصفح النماذج عند ضيق المساحة')}
    </div>
  </div>

  <div class="u-panel">
    <h3>الطاقة والثبات الحراري</h3>
    <p class="u-sub">شغّلنا حملاً متواصلاً لخمس ثوانٍ وقسنا انحدار الأداء — هذا ما سيحدث فعلياً أثناء توليد نص طويل.</p>
    <div class="u-grid" style="margin-top:12px">
      ${metric('انخفاض الأداء تحت الحمل', th ? th.dropPercent + '%' : '—', th ? `من ${num(th.start / 1000)}K إلى ${num(th.end / 1000)}K عملية/ms` : '', th ? (th.dropPercent < 12 ? 'ok' : th.dropPercent < 25 ? 'mid' : 'bad') : '')}
      ${metric('البطارية', d.battery ? d.battery.level + '%' : 'لا تنطبق', d.battery ? (d.battery.charging ? 'قيد الشحن' : 'تعمل على البطارية') : 'جهاز موصول بالكهرباء', d.battery && !d.battery.charging && d.battery.level < 35 ? 'mid' : '')}
      ${metric('الشبكة', d.network ? esc(d.network.type) : '—', d.network ? `${d.network.downlink} ميغابت/ث · زمن ${d.network.rtt}ms` : 'لا تؤثر على النماذج المحلية')}
      ${metric('الشاشة', `${d.screen.w}×${d.screen.h}`, `كثافة ${d.screen.dpr}× · ${d.screen.depth} بت`)}
    </div>
  </div>

  <div class="u-panel">
    <h3>قدرات المتصفح للاستدلال المحلي</h3>
    <div style="display:flex;flex-wrap:wrap;gap:7px;margin-top:12px">
      ${cap('WebGPU', d.apis.webgpu)}${cap('WASM SIMD', d.wasm.simd)}${cap('خيوط WASM', d.wasm.threads)}
      ${cap('عزل عبر المصادر', d.wasm.crossOriginIsolated)}${cap('سياق آمن', d.wasm.secureContext)}${cap('العمال', d.apis.workers)}
      ${cap('OffscreenCanvas', d.apis.offscreen)}${cap('نظام ملفات خاص', d.apis.opfs)}${cap('IndexedDB', d.apis.indexedDB)}
      ${cap('عامل الخدمة', d.apis.serviceWorker)}${cap('WebNN', d.apis.webnn)}${cap('نطق', d.apis.speech)}
    </div>
  </div>

  <div class="u-panel">
    <h3>حالة الجهاز وما يجب إصلاحه</h3>
    ${d.health.issues.length ? d.health.issues.map(i => `
      <div class="u-verdict ${i.level === 'bad' ? 'no' : 'mid'}" style="margin-top:10px">
        <b>${esc(i.title)}</b><br>${esc(i.why)}<br><span style="color:#9fe8c4">الحل: ${esc(i.fix)}</span>
      </div>`).join('') : '<div class="u-verdict ok" style="margin-top:10px">لا توجد مشاكل تعيق تشغيل النماذج المحلية.</div>'}
    ${d.health.good.length ? `<div style="display:flex;flex-wrap:wrap;gap:7px;margin-top:12px">${d.health.good.map(g => chip(g, 'on')).join('')}</div>` : ''}
    <div class="u-actions" style="margin-top:14px">
      <button class="u-btn" onclick="switchMainTab(null,'upgrade'); Ultra.renderUpgradeTab()">ماذا أستطيع تشغيله؟</button>
      <button class="u-btn" onclick="switchMainTab(null,'localai'); Ultra.renderModelsTab()">ابحث عن نماذجي المثبتة</button>
    </div>
  </div>`;
}

U.exportScan = function () {
  const d = U.state.device; if (!d) return;
  const payload = { device: d, servers: U.state.servers, models: U.state.localModels, profile: U.state.profile, generatedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `device-ai-report-${Date.now()}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('حُفظ التقرير');
};

/* ---------- تبويب النماذج المثبّتة ---------- */
U.renderModelsTab = function () {
  const el = $('tab-localai'); if (!el) return;
  const found = U.state.servers.length > 0;
  el.innerHTML = `<div class="u-wrap">
    <div class="u-panel">
      <div class="u-head">
        <div>
          <h3>النماذج المثبّتة على هذا الجهاز</h3>
          <p class="u-sub">نفحص منافذ ١٤ برنامجاً محلياً معروفاً — Ollama و LM Studio و llama.cpp و Jan وغيرها — ونقرأ تفاصيل كل نموذج مثبّت.</p>
        </div>
        <div class="u-actions">
          <button class="u-btn go" id="uFindBtn" onclick="Ultra.startDiscovery()">${found ? 'أعد البحث' : 'ابحث عن النماذج'}</button>
          <button class="u-btn" onclick="Ultra.scanBrowserAndRender()">افحص نماذج المتصفح</button>
        </div>
      </div>
      <div class="u-log" id="uFindLog"></div>
    </div>
    <div id="uModelsResults">${found ? '' : `<div class="u-panel"><div class="u-empty"><div class="em">🧠</div>
      <p>اضغط «ابحث عن النماذج» لفحص الخوادم المحلية العاملة الآن.</p></div></div>`}</div>
  </div>`;
  if (found) renderModelsResults();
};

U.startDiscovery = async function () {
  const btn = $('uFindBtn'); if (btn) { btn.disabled = true; btn.textContent = 'جارٍ البحث…'; }
  const log = $('uFindLog'); if (log) log.innerHTML = '';
  logLine('uFindLog', `probing ${HOSTS.join(' , ')}`);
  try {
    await U.discoverLocalAI((t, ok) => logLine('uFindLog', t, ok));
    await U.scanBrowserModels();
    renderModelsResults();
    const n = U.state.localModels.length;
    toast(n ? `عُثر على ${U.count(n)}` : 'لم يُعثر على خوادم محلية');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'أعد البحث'; }
  }
};

U.scanBrowserAndRender = async function () {
  await U.scanBrowserModels();
  renderModelsResults();
  toast(`نماذج المتصفح: ${U.state.browserModels.length} مخزن`);
};

function modelCard(m, idx) {
  const hw = U.hardware();
  const paramsB = paramsFromName(m);
  const quantId = quantFromName(m);
  const judged = paramsB > 0 ? U.judge({ name: m.id, paramsB, activeB: m.activeB }, hw, quantId, m.ctx && m.ctx < 16384 ? m.ctx : 4096) : null;
  const chips = [];
  if (m.loaded) chips.push(chip('محمّل في الذاكرة الآن', 'on'));
  if (m.params) chips.push(chip(m.params));
  else if (paramsB) chips.push(chip(num(paramsB) + 'B'));
  if (m.quant) chips.push(chip(m.quant));
  if (m.sizeBytes) chips.push(chip(fmtSize(m.sizeBytes)));
  if (m.family) chips.push(chip(m.family));
  if (m.ctx) chips.push(chip('سياق ' + m.ctx.toLocaleString('en-US')));
  if (m.type) chips.push(chip(m.type));
  if (judged) chips.push(chip(judged.level === 'ok' ? 'يعمل بسلاسة' : judged.level === 'mid' ? 'يعمل بحدود' : 'أثقل من الجهاز', judged.level));

  return `<div class="u-model" id="umodel-${idx}">
    <div class="mhead" onclick="Ultra.toggleModel(${idx})">
      <div style="min-width:0">
        <div class="mtitle">${esc(m.id)}</div>
        <div class="mmeta">${chips.join('')}</div>
      </div>
      <span style="color:#7f88ad;font-size:1.2em">⌄</span>
    </div>
    <div class="mbody">
      <div class="u-kv">
        <div><b>الخادم</b><span>${esc(m.serverName || m.provider)}</span></div>
        <div><b>الحجم على القرص</b><span>${m.sizeBytes ? fmtSize(m.sizeBytes) : '—'}</span></div>
        <div><b>التكميم</b><span>${esc(m.quant || quantId + ' (مُستنتج)')}</span></div>
        <div><b>آخر تحديث</b><span>${m.modified ? new Date(m.modified).toLocaleDateString('ar-EG') : '—'}</span></div>
        ${m.vramBytes ? `<div><b>على كرت الرسوميات</b><span>${fmtSize(m.vramBytes)} من ${fmtSize(m.totalLoadedBytes)}</span></div>` : ''}
        ${m.digest ? `<div><b>البصمة</b><span style="font-family:monospace;font-size:.8em">${esc(m.digest)}</span></div>` : ''}
        ${m.publisher ? `<div><b>الناشر</b><span>${esc(m.publisher)}</span></div>` : ''}
        ${m.path ? `<div><b>المسار</b><span style="font-size:.78em;word-break:break-all">${esc(m.path)}</span></div>` : ''}
      </div>
      ${judged ? `<div class="u-verdict ${judged.level}">
        <b>${esc(judged.verdict)}</b> — يحتاج ${judged.fp.total} GB (أوزان ${judged.fp.weights} + ذاكرة سياق ${judged.fp.kv} + تشغيل ${judged.fp.overhead}).<br>
        السرعة المتوقعة ${judged.speed.tps ? '≈ ' + judged.speed.tps + ' رمز/ثانية' : 'غير قابلة للتشغيل'} عبر ${esc(judged.speed.mode)}.
        ${judged.needs.length ? '<br>' + judged.needs.map(n => esc(n.text)).join(' · ') : ''}
      </div>` : ''}
      <div class="u-actions" style="margin-top:12px">
        ${m.provider === 'ollama' ? `
          <button class="u-btn sm" onclick="Ultra.loadDetails(${idx})">تفاصيل المعمارية</button>
          <button class="u-btn sm" onclick="Ultra.speedTest(${idx})">قياس السرعة الحقيقية</button>
          <button class="u-btn sm" onclick="Ultra.useInChat(${idx})">استخدمه في الدردشة</button>
          ${m.loaded ? `<button class="u-btn sm" onclick="Ultra.unload(${idx})">أخرجه من الذاكرة</button>` : ''}
          <button class="u-btn sm warn" onclick="Ultra.removeModel(${idx})">احذف النموذج</button>` : ''}
        <button class="u-btn sm" onclick="Ultra.copyText(Ultra.state.localModels[${idx}].id)">انسخ المعرّف</button>
      </div>
      <div id="udet-${idx}"></div>
    </div>
  </div>`;
}

function renderModelsResults() {
  const box = $('uModelsResults'); if (!box) return;
  const servers = U.state.servers;
  // نعيد بناء الفهرس من نفس كائنات الخوادم حتى تتطابق أرقام البطاقات مع القائمة
  let counter = 0;
  U.state.localModels = [];
  servers.forEach(s => s.models.forEach(m => {
    m._idx = counter++;
    m.serverName = m.serverName || s.name;
    m.serverIcon = m.serverIcon || s.icon;
    m.kind = m.kind || s.kind;
    U.state.localModels.push(m);
  }));
  let html = '';

  if (servers.length) {
    const total = U.state.localModels.length;
    const totalBytes = U.state.localModels.reduce((a, m) => a + (m.sizeBytes || 0), 0);
    const loaded = U.state.localModels.filter(m => m.loaded).length;
    html += `<div class="u-panel"><div class="u-grid">
      ${metric('خوادم عاملة', servers.length, servers.map(s => s.name).join('، '))}
      ${metric('نماذج مثبّتة', total, loaded ? `${loaded} منها محمّل في الذاكرة الآن` : 'لا شيء محمّل حالياً')}
      ${metric('المساحة المشغولة', totalBytes ? fmtSize(totalBytes) : '—', 'مجموع أوزان النماذج المعروفة الحجم')}
      ${metric('الأثقل', U.state.localModels.filter(m => m.sizeBytes).sort((a, b) => b.sizeBytes - a.sizeBytes).map(m => esc(m.id))[0] || '—', 'أكبر نموذج لديك')}
    </div></div>`;

    servers.forEach(s => {
      const models = s.models.map(m => modelCard(m, m._idx)).join('');
      html += `<div class="u-server">
        <div class="top">
          <div>
            <div class="name">${s.icon} ${esc(s.name)}</div>
            <div class="u-sub" style="margin-top:3px;direction:ltr;text-align:start">${esc(s.base)}${s.version ? ' · ' + esc(s.version) : ''}</div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${chip(`${s.models.length} نموذج`, s.models.length ? 'on' : 'mid')}
            ${s.kind === 'image' ? chip('توليد صور') : s.kind === 'ui' ? chip('واجهة') : chip('نماذج لغوية')}
          </div>
        </div>
        ${s.hardware ? `<div class="u-kv">
          <div><b>الكرت المكتشف من الخادم</b><span>${esc(s.hardware.device)}</span></div>
          <div><b>ذاكرة الرسوميات الفعلية</b><span>${fmtSize(s.hardware.vramTotal)} (متاح ${fmtSize(s.hardware.vramFree)})</span></div>
          ${s.hardware.torch ? `<div><b>PyTorch</b><span>${esc(s.hardware.torch)}</span></div>` : ''}
        </div>
        <div class="u-actions" style="margin-top:10px"><button class="u-btn sm" onclick="Ultra.adoptHardware(${s.hardware.vramTotal})">اعتمد هذه القيمة في الحسابات</button></div>` : ''}
        ${s.note ? `<div class="u-note" style="margin-top:10px">${esc(s.note)}</div>` : ''}
        ${models || '<p class="u-sub" style="margin-top:10px">الخادم يعمل لكن لا توجد نماذج مثبّتة بعد.</p>'}
      </div>`;
    });

    const ollama = servers.find(s => s.id === 'ollama');
    if (ollama) {
      html += `<div class="u-panel">
        <h3>نزّل نموذجاً جديداً</h3>
        <p class="u-sub">اكتب اسم النموذج كما هو في سجل Ollama، وسنعرض تقدم التنزيل هنا.</p>
        <div class="u-form">
          <div class="u-field" style="grid-column:1/-1">
            <label for="uPullName">اسم النموذج</label>
            <input id="uPullName" placeholder="qwen3:4b-instruct" dir="ltr">
          </div>
        </div>
        <div class="u-actions" style="margin-top:12px">
          <button class="u-btn go" onclick="Ultra.pull('${esc(ollama.base)}')">نزّل الآن</button>
          ${U.recommendFor(4).slice(0, 3).map(m => `<button class="u-btn sm" onclick="document.getElementById('uPullName').value='${esc(m.id)}'">${esc(m.name)}</button>`).join('')}
        </div>
        <div id="uPullStatus" class="u-sub" style="margin-top:10px"></div>
        <div class="u-bar" style="margin-top:8px"><i id="uPullBar" style="width:0%"></i></div>
      </div>`;
    }
  } else {
    html += setupGuideHTML();
  }

  const bm = U.state.browserModels;
  html += `<div class="u-panel">
    <h3>نماذج مخزّنة داخل هذا المتصفح</h3>
    <p class="u-sub">نماذج WebLLM أو transformers.js التي سبق تنزيلها تبقى في مخازن المتصفح وتشغل مساحة.</p>
    ${bm.length ? `<div class="u-scroll"><table class="u-table">
      <tr><th>المخزن</th><th>النوع</th><th>العناصر</th><th>الحجم</th><th>ملفات معروفة</th></tr>
      ${bm.map(b => `<tr><td style="word-break:break-all">${esc(b.store)}</td><td>${b.type === 'cache' ? 'ذاكرة تخزين' : 'قاعدة بيانات'}</td>
        <td><b>${b.entries || '—'}</b></td><td><b>${b.bytes ? fmtSize(b.bytes) : '—'}</b></td>
        <td style="font-size:.85em">${b.names.map(esc).join('، ') || '—'}</td></tr>`).join('')}
    </table></div>` : '<p class="u-sub" style="margin-top:10px">لا توجد نماذج مخزّنة في المتصفح حتى الآن.</p>'}
  </div>`;

  box.innerHTML = html;
}

function setupGuideHTML() {
  const https = location.protocol === 'https:';
  return `<div class="u-panel">
    <h3>لم يُعثر على خادم ذكاء محلي</h3>
    <p class="u-sub">إما أن أياً منها لا يعمل الآن، أو أن المتصفح يمنع الاتصال بالمنافذ المحلية. جرّب الخطوات التالية بالترتيب.</p>
    ${https ? `<div class="u-note" style="margin-top:12px">الصفحة مفتوحة عبر HTTPS، والمتصفح يحجب طلبات HTTP المحلية. افتح التطبيق من <span dir="ltr">http://localhost</span> أو من ملف على الجهاز.</div>` : ''}
    <ol class="u-steps">
      <li><div>شغّل الخادم أولاً — مثلاً Ollama:<code class="u-code">ollama serve</code></div></li>
      <li><div>اسمح لهذه الصفحة بالوصول (السبب الأشهر لعدم الظهور). أغلق Ollama ثم شغّله بهذه القيمة:
        <code class="u-code">Windows:  setx OLLAMA_ORIGINS "*"
macOS:    launchctl setenv OLLAMA_ORIGINS "*"
Linux:    OLLAMA_ORIGINS=* ollama serve</code></div></li>
      <li><div>تحقق من أن الخادم يستجيب:<code class="u-code">curl http://localhost:11434/api/tags</code></div></li>
      <li><div>في LM Studio: بويب Developer فعّل الخادم المحلي و Enable CORS، ثم أعد البحث هنا.</div></li>
      <li><div>نزّل نموذجاً واحداً على الأقل ثم أعد البحث:<code class="u-code">ollama pull qwen3:4b-instruct</code></div></li>
    </ol>
    <div class="u-sub" style="margin-top:14px">المنافذ التي نفحصها: ${PROVIDERS.map(p => `${p.name} (${p.port})`).join('، ')}</div>
  </div>`;
}

U.toggleModel = function (idx) {
  const el = $('umodel-' + idx); if (el) el.classList.toggle('open');
};

U.loadDetails = async function (idx) {
  const m = U.state.localModels[idx]; if (!m) return;
  const box = $('udet-' + idx); if (!box) return;
  box.innerHTML = '<p class="u-sub" style="margin-top:12px">جارٍ قراءة بطاقة النموذج…</p>';
  const info = await U.ollamaShow(m.base, m.id);
  if (!info) { box.innerHTML = '<p class="u-sub" style="margin-top:12px">تعذّرت قراءة التفاصيل من الخادم.</p>'; return; }
  const ctxK = info.contextLength ? Math.round(info.contextLength / 1024) + 'K' : '—';
  const kvAt32k = info.blocks && info.kvHeads ? ((2 * info.blocks * info.kvHeads * (info.embedding / Math.max(1, info.heads)) * 32768 * 2) / (1024 ** 3)) : 0;
  box.innerHTML = `<div class="u-kv" style="margin-top:14px">
    <div><b>المعمارية</b><span>${esc(info.arch || '—')}</span></div>
    <div><b>عدد المعاملات</b><span>${info.paramCount ? (info.paramCount / 1e9).toFixed(2) + 'B' : '—'}</span></div>
    <div><b>أقصى سياق</b><span>${ctxK} رمز</span></div>
    <div><b>الطبقات</b><span>${info.blocks || '—'}</span></div>
    <div><b>رؤوس الانتباه</b><span>${info.heads || '—'}${info.kvHeads ? ` (KV: ${info.kvHeads})` : ''}</span></div>
    <div><b>بعد التضمين</b><span>${info.embedding || '—'}</span></div>
    <div><b>القدرات</b><span>${info.capabilities.length ? info.capabilities.map(esc).join('، ') : '—'}</span></div>
    <div><b>الرخصة</b><span>${esc(info.license || '—')}</span></div>
  </div>
  ${kvAt32k ? `<div class="u-note" style="margin-top:12px">تشغيله بأقصى سياق 32K يحتاج ${num(kvAt32k)} GB إضافية لذاكرة السياق وحدها، فوق حجم الأوزان.</div>` : ''}
  ${info.modelfileParams ? `<code class="u-code" style="margin-top:10px">${esc(info.modelfileParams)}</code>` : ''}`;
};

U.speedTest = async function (idx) {
  const m = U.state.localModels[idx]; if (!m) return;
  const box = $('udet-' + idx); if (!box) return;
  box.innerHTML = '<p class="u-sub" style="margin-top:12px">جارٍ توليد ٦٠ رمزاً لقياس السرعة الفعلية… قد يستغرق التحميل الأول دقيقة.</p>';
  try {
    const r = await U.ollamaSpeedTest(m.base, m.id);
    const est = (() => {
      const p = paramsFromName(m); if (!p) return null;
      return U.judge({ name: m.id, paramsB: p }, U.hardware(), quantFromName(m), 4096).speed.tps;
    })();
    box.innerHTML = `<div class="u-kv" style="margin-top:14px">
      <div><b>السرعة الفعلية</b><span>${r.tokensPerSec} رمز/ثانية</span></div>
      <div><b>التقدير قبل القياس</b><span>${est ? est + ' رمز/ثانية' : '—'}</span></div>
      <div><b>زمن التحميل</b><span>${r.load} ثانية</span></div>
      <div><b>الرموز المولّدة</b><span>${r.tokens}</span></div>
    </div>
    <div class="u-verdict ${r.tokensPerSec >= 15 ? 'ok' : r.tokensPerSec >= 6 ? 'mid' : 'no'}" >
      ${r.tokensPerSec >= 15 ? 'سرعة مريحة للمحادثة الحية.' : r.tokensPerSec >= 6 ? 'صالح للمهام غير التفاعلية، وبطيء قليلاً للمحادثة.' : 'أبطأ من القراءة البشرية — جرّب نموذجاً أصغر أو تكميماً أخف.'}
    </div>`;
    U.state.measured = U.state.measured || {};
    U.state.measured[m.id] = r.tokensPerSec;
  } catch (e) {
    box.innerHTML = `<p class="u-sub" style="margin-top:12px">تعذّر القياس: ${esc(e.message)}</p>`;
  }
};

U.unload = async function (idx) {
  const m = U.state.localModels[idx]; if (!m) return;
  const ok = await U.ollamaUnload(m.base, m.id);
  toast(ok ? 'أُخرج النموذج من الذاكرة' : 'تعذّر التنفيذ');
  if (ok) U.startDiscovery();
};

U.removeModel = async function (idx) {
  const m = U.state.localModels[idx]; if (!m) return;
  if (!confirm(`سيُحذف ${m.id} من القرص نهائياً. متابعة؟`)) return;
  const ok = await U.ollamaDelete(m.base, m.id);
  toast(ok ? 'حُذف النموذج' : 'تعذّر الحذف');
  if (ok) U.startDiscovery();
};

U.useInChat = function (idx) {
  const m = U.state.localModels[idx]; if (!m) return;
  try { localStorage.setItem('ollamaSelectedModel', m.id); } catch (e) {}
  if (typeof window.selectOllamaModel === 'function') window.selectOllamaModel(m.id);
  toast(`${m.id} صار النموذج المستخدم في الدردشة`);
  if (typeof window.switchMainTab === 'function') window.switchMainTab(null, 'chat');
};

U.copyText = function (t) {
  navigator.clipboard && navigator.clipboard.writeText(t).then(() => toast('نُسخ')).catch(() => toast('تعذّر النسخ'));
};

U.adoptHardware = function (vramBytes) {
  const gb = Math.round(bytesGB(vramBytes));
  U.state.profile = { ...(U.state.profile || {}), vram: gb };
  saveLS('ultraProfile', U.state.profile);
  toast(`اعتُمدت ذاكرة رسوميات ${gb} GB في كل الحسابات`);
  U.renderUpgradeTab();
};

U.pull = async function (base) {
  const input = $('uPullName'); if (!input || !input.value.trim()) { toast('اكتب اسم النموذج أولاً'); return; }
  const name = input.value.trim();
  const status = $('uPullStatus'), bar2 = $('uPullBar');
  try {
    await U.ollamaPull(base, name, (s, pct) => {
      if (status) status.textContent = `${s}${pct != null ? ` — ${pct}%` : ''}`;
      if (bar2 && pct != null) bar2.style.width = pct + '%';
    });
    if (status) status.textContent = 'اكتمل التنزيل';
    toast('نزّل النموذج بنجاح');
    U.startDiscovery();
  } catch (e) {
    if (status) status.textContent = 'فشل التنزيل: ' + e.message;
  }
};

/* ---------- توصيات ---------- */
U.recommendFor = function (count = 4) {
  const hw = U.hardware();
  const scored = CATALOG.map(m => {
    const j = U.judge(m, hw, 'Q4_K_M', 4096);
    return { ...m, j, fit: j.level === 'ok' ? 2 : j.level === 'mid' ? 1 : 0 };
  }).filter(x => x.fit > 0 && x.j.speed.tps >= 8)
    .sort((a, b) => (b.fit - a.fit) || (b.paramsB - a.paramsB));
  return scored.slice(0, count);
};

/* ---------- تبويب مستشار الترقية ---------- */
U.renderUpgradeTab = function () {
  const el = $('tab-upgrade'); if (!el) return;
  const hw = U.hardware();
  const p = U.state.profile || {};
  const q = (U.state.ui && U.state.ui.quant) || 'Q4_K_M';
  const ctx = (U.state.ui && U.state.ui.ctx) || 4096;

  el.innerHTML = `<div class="u-wrap">
    <div class="u-panel">
      <div class="u-head">
        <div>
          <h3>مستشار الترقية</h3>
          <p class="u-sub">يحسب لكل نموذج ما يحتاجه فعلياً من ذاكرة، ويقارنه بجهازك، ويقول لك بالضبط ما الذي يجب ترقيته لتشغيله.</p>
        </div>
        <div class="u-actions"><button class="u-btn" onclick="switchMainTab(null,'scan'); Ultra.renderScanTab()">${U.state.device ? 'أعد فحص الجهاز' : 'افحص الجهاز أولاً'}</button></div>
      </div>
      <div class="u-note">المتصفح لا يكشف حجم الذاكرة الحقيقي (يبلّغ ٨ غيغابايت كحد أقصى) ولا ذاكرة كرت الرسوميات. اكتب القيم الحقيقية هنا لتصبح كل الحسابات دقيقة.</div>
      <div class="u-form">
        <div class="u-field"><label for="uRam">الذاكرة العشوائية (GB)</label>
          <input id="uRam" type="number" min="1" max="512" value="${p.ram || hw.ram}"></div>
        <div class="u-field"><label for="uVram">ذاكرة كرت الرسوميات (GB)</label>
          <input id="uVram" type="number" min="0" max="192" value="${p.vram != null ? p.vram : hw.vram}"></div>
        <div class="u-field"><label for="uBw">نطاق ذاكرة الكرت (GB/s)</label>
          <input id="uBw" type="number" min="0" max="4000" value="${p.gpuBandwidth || hw.gpuBW || 0}"></div>
        <div class="u-field"><label for="uUnified">نوع الذاكرة</label>
          <select id="uUnified">
            <option value="0" ${!hw.unified ? 'selected' : ''}>منفصلة (كرت مستقل)</option>
            <option value="1" ${hw.unified ? 'selected' : ''}>موحّدة (Apple / مدمجة)</option>
          </select></div>
        <div class="u-field"><label for="uQuant">التكميم المستهدف</label>
          <select id="uQuant">${QUANTS.map(x => `<option value="${x.id}" ${x.id === q ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select></div>
        <div class="u-field"><label for="uCtx">طول السياق (رمز)</label>
          <select id="uCtx">${[2048, 4096, 8192, 16384, 32768, 65536].map(c => `<option value="${c}" ${c === ctx ? 'selected' : ''}>${c.toLocaleString('en-US')}</option>`).join('')}</select></div>
      </div>
      <div class="u-actions" style="margin-top:14px">
        <button class="u-btn go" onclick="Ultra.applyProfile()">طبّق واحسب</button>
        <button class="u-btn" onclick="Ultra.resetProfile()">ارجع للقيم المكتشفة</button>
      </div>
    </div>
    <div id="uUpgradeBody"></div>
  </div>`;
  renderUpgradeBody();
};

U.applyProfile = function () {
  const ram = parseFloat($('uRam').value) || 8;
  const vram = parseFloat($('uVram').value) || 0;
  const bw = parseFloat($('uBw').value) || 0;
  const unified = $('uUnified').value === '1';
  U.state.profile = { ram, vram, gpuBandwidth: bw, unified };
  U.state.ui = { quant: $('uQuant').value, ctx: parseInt($('uCtx').value, 10) };
  saveLS('ultraProfile', U.state.profile);
  saveLS('ultraUI', U.state.ui);
  renderUpgradeBody();
  toast('حُدّثت الحسابات بمواصفاتك');
};

U.resetProfile = function () {
  U.state.profile = null;
  saveLS('ultraProfile', null);
  U.renderUpgradeTab();
};

function verdictRow(j) {
  const need = j.needs.length ? j.needs.map(n => esc(n.text)).join('<br>') : '—';
  return `<tr>
    <td><b>${esc(j.model.name || j.model.id)}</b><div class="u-sub" style="font-size:.85em">${esc(j.model.use || '')}</div></td>
    <td><b>${j.fp.total}</b> GB<div class="u-sub" style="font-size:.8em">أوزان ${j.fp.weights} + سياق ${j.fp.kv}</div></td>
    <td>${chip(j.verdict, j.level)}</td>
    <td><b>${j.speed.tps || '—'}</b><div class="u-sub" style="font-size:.8em">${esc(j.speed.mode)}</div></td>
    <td style="font-size:.85em;line-height:1.7">${need}</td>
  </tr>`;
}

function renderUpgradeBody() {
  const box = $('uUpgradeBody'); if (!box) return;
  const hw = U.hardware();
  const q = (U.state.ui && U.state.ui.quant) || 'Q4_K_M';
  const ctx = (U.state.ui && U.state.ui.ctx) || 4096;
  const judged = CATALOG.map(m => U.judge(m, hw, q, ctx));
  const ok = judged.filter(j => j.level === 'ok');
  const best = ok.slice().sort((a, b) => b.model.paramsB - a.model.paramsB)[0];
  const plans = U.upgradePlans();
  const installed = U.state.localModels.filter(m => paramsFromName(m) > 0);

  let html = `<div class="u-panel">
    <div class="u-grid">
      ${metric('الحد الأقصى الذي يتسع', best ? esc(best.model.name) : 'لا شيء بهذه الإعدادات', best ? `${best.fp.total} GB · ≈ ${best.speed.tps} رمز/ثانية` : 'قلّل التكميم أو السياق', best ? 'ok' : 'bad')}
      ${metric('نماذج تعمل بسلاسة', `${ok.length} من ${CATALOG.length}`, `عند ${q} وسياق ${ctx.toLocaleString('en-US')}`)}
      ${metric('الذاكرة المعتمدة', `${hw.ram} GB RAM · ${hw.vram} GB VRAM`, hw.unified ? 'ذاكرة موحّدة — الرسوميات تستعير من النظام' : esc(hw.gpuName))}
      ${metric('نطاق الذاكرة الفعّال', `${hw.gpuBW || hw.cpuBW} GB/s`, 'العامل الحاسم في سرعة التوليد')}
    </div>
  </div>`;

  if (installed.length) {
    html += `<div class="u-panel">
      <h3>نماذجك المثبّتة على هذا الجهاز</h3>
      <div class="u-scroll"><table class="u-table">
        <tr><th>النموذج</th><th>الذاكرة المطلوبة</th><th>الحكم</th><th>رمز/ثانية</th><th>ما ينقصك</th></tr>
        ${installed.map(m => verdictRow(U.judge({ name: m.id, paramsB: paramsFromName(m) }, hw, quantFromName(m), ctx))).join('')}
      </table></div>
    </div>`;
  }

  html += `<div class="u-panel">
    <h3>كل نموذج ومتطلباته على جهازك</h3>
    <p class="u-sub">الأرقام محسوبة لإعداداتك الحالية: ${esc(q)} وسياق ${ctx.toLocaleString('en-US')} رمز.</p>
    <div class="u-scroll"><table class="u-table">
      <tr><th>النموذج</th><th>الذاكرة المطلوبة</th><th>الحكم</th><th>رمز/ثانية</th><th>ما ينقصك لتشغيله</th></tr>
      ${judged.map(verdictRow).join('')}
    </table></div>
  </div>`;

  html += `<div class="u-panel">
    <h3>ماذا لو رقّيت؟</h3>
    <p class="u-sub">حرّك القيم لترى كم نموذجاً إضافياً سيصبح قابلاً للتشغيل قبل أن تشتري أي شيء.</p>
    <div class="u-form">
      <div class="u-field"><label for="uSimRam">ذاكرة عشوائية: <b id="uSimRamV">${hw.ram}</b> GB</label>
        <input id="uSimRam" type="range" min="4" max="128" step="4" value="${clamp(hw.ram, 4, 128)}" oninput="Ultra.simulate()"></div>
      <div class="u-field"><label for="uSimVram">ذاكرة الكرت: <b id="uSimVramV">${hw.vram}</b> GB</label>
        <input id="uSimVram" type="range" min="0" max="48" step="2" value="${clamp(hw.vram, 0, 48)}" oninput="Ultra.simulate()"></div>
    </div>
    <div id="uSimOut" class="u-verdict ok" style="margin-top:12px"></div>
  </div>`;

  html += `<div class="u-panel">
    <h3>مسارات الترقية المقترحة</h3>
    <p class="u-sub">مرتّبة من الأقل تكلفة إلى الأكبر أثراً، بناءً على ما قاسه الفحص فعلياً.</p>
    <div class="u-grid" style="margin-top:14px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr))">
      ${plans.plans.map(pl => `<div class="u-plan">
        <h4>${esc(pl.title)}</h4>
        <div class="cost">${esc(pl.tier)} · ${esc(pl.cost)}</div>
        <ul>${pl.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>
        <div class="unlock">${esc(pl.unlock)}</div>
        ${pl.blocked ? `<div class="u-sub" style="margin-top:8px;color:#ffb27a">غير قابل للتنفيذ على هذا الجهاز — الترقية تعني تبديل الجهاز نفسه.</div>` : ''}
      </div>`).join('')}
    </div>
  </div>`;

  const recs = U.recommendFor(3);
  if (recs.length) {
    html += `<div class="u-panel">
      <h3>ابدأ بهذه النماذج الآن</h3>
      ${recs.map(r => `<div class="u-verdict ${r.j.level}" style="margin-top:10px">
        <b>${esc(r.name)}</b> — ${esc(r.use)} · ${r.j.fp.total} GB · ≈ ${r.j.speed.tps} رمز/ثانية
        <code class="u-code">${esc(r.pull)}</code>
      </div>`).join('')}
    </div>`;
  }

  box.innerHTML = html;
  U.simulate();
}

U.simulate = function () {
  const ramEl = $('uSimRam'), vramEl = $('uSimVram'), out = $('uSimOut');
  if (!ramEl || !vramEl || !out) return;
  const hw = U.hardware();
  const ram = parseFloat(ramEl.value), vram = parseFloat(vramEl.value);
  $('uSimRamV').textContent = ram; $('uSimVramV').textContent = vram;
  const q = (U.state.ui && U.state.ui.quant) || 'Q4_K_M';
  const ctx = (U.state.ui && U.state.ui.ctx) || 4096;
  const simHW = { ...hw, ram, vram, gpuBW: vram > hw.vram ? Math.max(hw.gpuBW, 500) : hw.gpuBW };
  const before = CATALOG.filter(m => U.judge(m, hw, q, ctx).level === 'ok');
  const after = CATALOG.filter(m => U.judge(m, simHW, q, ctx).level === 'ok');
  const added = after.filter(m => !before.includes(m));
  const bestAfter = after.slice().sort((a, b) => b.paramsB - a.paramsB)[0];
  out.className = 'u-verdict ' + (added.length ? 'ok' : 'mid');
  out.innerHTML = added.length
    ? `تصبح ${U.count(after.length)} قابلة للتشغيل بدل ${before.length}. الجديد: ${added.map(m => esc(m.name)).join('، ')}.
       أكبر ما ستشغّله: <b>${esc(bestAfter.name)}</b> بسرعة ≈ ${U.judge(bestAfter, simHW, q, ctx).speed.tps} رمز/ثانية.`
    : `لا فرق عند هذه القيم — العدد يبقى ${U.count(after.length)}. جرّب رفع ذاكرة الكرت، فهي عنق الزجاجة هنا.`;
};

/* ============================================================
   التهيئة
   ============================================================ */
function boot() {
  injectStyles();
  buildUI();
  U.state.profile = loadLS('ultraProfile', null);
  U.state.ui = loadLS('ultraUI', { quant: 'Q4_K_M', ctx: 4096 });
  U.renderScanTab();
  U.renderModelsTab();
  U.renderUpgradeTab();
  console.log('🩺 AI Advisor Ultra 6.0 — Neural Scanner جاهز');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

})();
