/* ============================================================
   AI Advisor Ultra 6.5 — Smart Tools
   حزمة أدوات تعمل فوق ultra.js:
   حلبة مقارنة النماذج · مولّد الأوامر المثلى · حاسبة السياق ·
   كفاءة الترميز العربي · اختبار التحمل · مخطط المساحة ·
   مستشار المهمة · حاسبة التكلفة · المراقب المباشر · التقرير الشامل
   ============================================================ */
(function () {
'use strict';

const U = window.Ultra;
if (!U) { console.warn('ultra-tools: ultra.js غير محمّل'); return; }

const T = (U.tools = {});
const $ = (id) => document.getElementById(id);
const esc = U.escape;
const fmtSize = U.fmtSize;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const num = (n, d = 1) => (Number.isFinite(n) ? String(Number(n).toFixed(d)).replace(/\.0+$/, '') : '—');
const toast = (m) => (typeof window.showToast === 'function' ? window.showToast(m) : console.log(m));

T.state = {
  active: null,
  arena: { running: false, results: [] },
  stress: { running: false, series: [] },
  monitor: { timer: null, series: [] },
  tokenizer: { rows: [] }
};

/* ---------- اتصال ---------- */
async function callJSON(url, { method = 'GET', body = null, timeout = 120000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : null,
      mode: 'cors', cache: 'no-store', credentials: 'omit', signal: ctrl.signal
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } catch (e) { clearTimeout(timer); throw e; }
}

const ollamaServer = () => (U.state.servers || []).find(s => s.id === 'ollama') || null;
const ollamaModels = () => (U.state.localModels || []).filter(m => m.provider === 'ollama');
const generate = (base, model, prompt, opts = {}) =>
  callJSON(base + '/api/generate', { method: 'POST', body: { model, prompt, stream: false, think: false, options: opts } });

/* ---------- عناصر عرض ---------- */
function metric(k, v, hint = '', cls = '') {
  return `<div class="u-metric ${cls}"><div class="k">${esc(k)}</div><div class="v">${v}</div>${hint ? `<div class="h">${hint}</div>` : ''}</div>`;
}
function chip(t, cls = '') { return `<span class="u-chip ${cls}">${esc(t)}</span>`; }

function sparkline(values, { height = 46, color = '#00d4ff' } = {}) {
  if (!values.length) return '';
  const max = Math.max(...values) || 1, min = Math.min(...values, 0);
  const span = Math.max(0.0001, max - min);
  const w = 100, pts = values.map((v, i) => {
    const x = values.length === 1 ? 0 : (i / (values.length - 1)) * w;
    const y = height - ((v - min) / span) * (height - 6) - 3;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
  return `<svg class="u-spark" viewBox="0 0 ${w} ${height}" preserveAspectRatio="none" style="height:${height}px">
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="1.6" vector-effect="non-scaling-stroke"/>
  </svg>`;
}

function needDiscovery(msg = 'هذه الأداة تحتاج خادم Ollama عاملاً.') {
  return `<div class="u-empty"><div class="em">🔌</div><p>${esc(msg)}</p>
    <div class="u-actions" style="justify-content:center;margin-top:12px">
      <button class="u-btn go" onclick="Ultra.startDiscovery().then(()=>Ultra.tools.open(Ultra.tools.state.active))">ابحث عن الخوادم المحلية</button>
      <button class="u-btn" onclick="switchMainTab(null,'localai'); Ultra.renderModelsTab()">افتح تبويب النماذج</button>
    </div></div>`;
}

function modelPicker(id, { multi = false, limit = 8 } = {}) {
  const models = ollamaModels();
  if (!models.length) return '';
  if (!multi) {
    return `<div class="u-field"><label for="${id}">النموذج</label>
      <select id="${id}">${models.map(m => `<option value="${esc(m.id)}">${esc(m.id)}</option>`).join('')}</select></div>`;
  }
  return `<div class="u-field" style="grid-column:1/-1"><label>النماذج المشاركة (اختر حتى ${limit})</label>
    <div class="u-picks">${models.map((m, i) => `<label class="u-pick">
      <input type="checkbox" name="${id}" value="${esc(m.id)}" ${i < 2 ? 'checked' : ''}>
      <span>${esc(m.id)}</span></label>`).join('')}</div></div>`;
}
const picked = (name) => [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(i => i.value);

/* ---------- أنماط إضافية ---------- */
const CSS = `
.u-tools{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(215px,1fr))}
.u-tool{text-align:start;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.09);border-radius:14px;
  padding:15px;cursor:pointer;color:inherit;font-family:inherit;transition:border-color .15s,background .15s}
.u-tool:hover{background:rgba(255,255,255,.07);border-color:rgba(0,212,255,.45)}
.u-tool:focus-visible{outline:2px solid #00d4ff;outline-offset:2px}
.u-tool.on{border-color:#00d4ff;background:rgba(0,212,255,.08)}
.u-tool .ti{font-size:1.5em;line-height:1}
.u-tool .tn{font-weight:600;margin:8px 0 5px;font-size:.96em}
.u-tool .td{color:#8b93b5;font-size:.8em;line-height:1.65}
.u-picks{display:flex;flex-wrap:wrap;gap:8px}
.u-pick{display:flex;align-items:center;gap:7px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);
  border-radius:9px;padding:8px 11px;font-size:.85em;cursor:pointer}
.u-pick input{accent-color:#7b2ff7;width:15px;height:15px}
.u-spark{width:100%;display:block}
.u-out{background:#070a18;border:1px solid rgba(255,255,255,.09);border-radius:11px;padding:12px 13px;
  font-size:.86em;line-height:1.9;max-height:270px;overflow:auto;white-space:pre-wrap}
.u-cols{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));margin-top:12px}
.u-col h5{font-size:.88em;margin-bottom:8px;word-break:break-all}
textarea.u-ta{width:100%;min-height:88px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.13);
  border-radius:9px;padding:11px;color:#e6e9f5;font-family:inherit;font-size:.92em;line-height:1.8;resize:vertical}
textarea.u-ta:focus{outline:none;border-color:#00d4ff}
.u-live{display:flex;align-items:center;gap:7px;font-size:.82em;color:#7ce6ac}
.u-live i{width:8px;height:8px;border-radius:99px;background:#27ae60;display:inline-block;animation:upulse 1.6s infinite}
@keyframes upulse{50%{opacity:.25}}
@media (prefers-reduced-motion:reduce){.u-live i{animation:none}}
`;

function injectCSS() {
  if ($('ultraToolsStyles')) return;
  const s = document.createElement('style');
  s.id = 'ultraToolsStyles'; s.textContent = CSS;
  document.head.appendChild(s);
}

/* ============================================================
   سجل الأدوات
   ============================================================ */
const TOOLS = [];
const reg = (t) => TOOLS.push(t);

T.open = function (id) {
  const tool = TOOLS.find(t => t.id === id) || TOOLS[0];
  T.state.active = tool.id;
  document.querySelectorAll('.u-tool').forEach(b => b.classList.toggle('on', b.dataset.tool === tool.id));
  const box = $('uToolBody');
  if (!box) return;
  box.innerHTML = `<div class="u-panel">
    <div class="u-head">
      <div><h3>${tool.icon} ${esc(tool.name)}</h3><p class="u-sub">${esc(tool.desc)}</p></div>
    </div>
    <div id="uToolInner">${tool.render()}</div>
  </div>`;
  if (tool.after) tool.after();
};

T.renderTab = function () {
  const el = $('tab-tools'); if (!el) return;
  el.innerHTML = `<div class="u-wrap">
    <div class="u-panel">
      <div class="u-head">
        <div><h3>الأدوات الذكية</h3>
        <p class="u-sub">عشر أدوات تشتغل على نماذجك المثبّتة وعلى قياسات جهازك الفعلية — اختر واحدة للبدء.</p></div>
        <div class="u-actions"><button class="u-btn" onclick="Ultra.startDiscovery()">حدّث قائمة النماذج</button></div>
      </div>
      <div class="u-tools">
        ${TOOLS.map(t => `<button class="u-tool" data-tool="${t.id}" onclick="Ultra.tools.open('${t.id}')">
          <div class="ti">${t.icon}</div><div class="tn">${esc(t.name)}</div><div class="td">${esc(t.desc)}</div>
        </button>`).join('')}
      </div>
    </div>
    <div id="uToolBody"></div>
  </div>`;
  T.open(T.state.active || TOOLS[0].id);
};

/* ============================================================
   ١) حلبة النماذج
   ============================================================ */
reg({
  id: 'arena', icon: '⚔️', name: 'حلبة النماذج',
  desc: 'شغّل نفس السؤال على عدة نماذج وقارن الإجابة والسرعة جنباً إلى جنب.',
  render() {
    if (!ollamaServer()) return needDiscovery();
    return `<div class="u-form">
        ${modelPicker('arenaModels', { multi: true })}
        <div class="u-field" style="grid-column:1/-1"><label for="arenaPrompt">السؤال</label>
          <textarea class="u-ta" id="arenaPrompt">اشرح الفرق بين الذاكرة العشوائية وذاكرة كرت الرسوميات في ثلاث جمل.</textarea></div>
        <div class="u-field"><label for="arenaTokens">حد الرموز لكل إجابة</label>
          <input id="arenaTokens" type="number" min="32" max="512" value="140"></div>
        <div class="u-field"><label for="arenaTemp">درجة الإبداع</label>
          <input id="arenaTemp" type="number" min="0" max="2" step="0.1" value="0.7"></div>
      </div>
      <div class="u-actions" style="margin-top:14px">
        <button class="u-btn go" id="arenaRun" onclick="Ultra.tools.runArena()">ابدأ المقارنة</button>
      </div>
      <div id="arenaStatus" class="u-sub" style="margin-top:10px"></div>
      <div id="arenaOut"></div>`;
  }
});

T.runArena = async function () {
  const s = ollamaServer(); if (!s) return;
  const models = picked('arenaModels').slice(0, 8);
  const prompt = $('arenaPrompt').value.trim();
  if (!models.length) { toast('اختر نموذجاً واحداً على الأقل'); return; }
  if (!prompt) { toast('اكتب السؤال أولاً'); return; }
  const numPredict = clamp(parseInt($('arenaTokens').value, 10) || 140, 32, 512);
  const temperature = clamp(parseFloat($('arenaTemp').value) || 0.7, 0, 2);
  const btn = $('arenaRun'); btn.disabled = true; btn.textContent = 'جارٍ التشغيل…';
  const results = [];
  try {
    for (let i = 0; i < models.length; i++) {
      $('arenaStatus').textContent = `(${i + 1}/${models.length}) ${models[i]} — التحميل ثم التوليد…`;
      const t0 = performance.now();
      try {
        const r = await generate(s.base, models[i], prompt, { num_predict: numPredict, temperature });
        const evalSec = r.eval_duration ? r.eval_duration / 1e9 : null;
        results.push({
          model: models[i],
          text: (r.response || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim(),
          tps: evalSec ? Math.round((r.eval_count / evalSec) * 10) / 10 : 0,
          tokens: r.eval_count || 0,
          promptTokens: r.prompt_eval_count || 0,
          load: r.load_duration ? Math.round(r.load_duration / 1e8) / 10 : 0,
          wall: Math.round((performance.now() - t0) / 100) / 10
        });
      } catch (e) {
        results.push({ model: models[i], error: e.message });
      }
      renderArena(results);
    }
    $('arenaStatus').textContent = 'اكتملت المقارنة';
  } finally {
    btn.disabled = false; btn.textContent = 'أعد المقارنة';
  }
  T.state.arena.results = results;
};

function renderArena(results) {
  const box = $('arenaOut'); if (!box) return;
  const done = results.filter(r => !r.error);
  const fastest = done.slice().sort((a, b) => b.tps - a.tps)[0];
  const shortest = done.slice().sort((a, b) => a.wall - b.wall)[0];
  box.innerHTML = `
  ${done.length ? `<div class="u-grid" style="margin-top:14px">
    ${metric('الأسرع توليداً', fastest ? esc(fastest.model) : '—', fastest ? fastest.tps + ' رمز/ثانية' : '', 'ok')}
    ${metric('الأسرع إجمالاً', shortest ? esc(shortest.model) : '—', shortest ? shortest.wall + ' ثانية شاملة التحميل' : '')}
    ${metric('متوسط السرعة', num(done.reduce((a, r) => a + r.tps, 0) / done.length) + ' رمز/ث', U.count(done.length))}
  </div>` : ''}
  <div class="u-scroll"><table class="u-table">
    <tr><th>النموذج</th><th>رمز/ثانية</th><th>الرموز</th><th>رموز السؤال</th><th>زمن التحميل</th><th>الزمن الكلي</th></tr>
    ${results.map(r => r.error
      ? `<tr><td>${esc(r.model)}</td><td colspan="5" style="color:#ff9d93">${esc(r.error)}</td></tr>`
      : `<tr><td>${esc(r.model)}</td><td><b>${r.tps}</b></td><td><b>${r.tokens}</b></td><td><b>${r.promptTokens}</b></td>
         <td><b>${r.load}</b> ث</td><td><b>${r.wall}</b> ث</td></tr>`).join('')}
  </table></div>
  <div class="u-cols">
    ${results.filter(r => !r.error).map(r => `<div class="u-col">
      <h5>${esc(r.model)} ${chip(r.tps + ' رمز/ث', r.tps >= 15 ? 'on' : 'mid')}</h5>
      <div class="u-out">${esc(r.text || '—')}</div></div>`).join('')}
  </div>`;
}

/* ============================================================
   ٢) مولّد الأوامر المثلى
   ============================================================ */
reg({
  id: 'cmd', icon: '🛠️', name: 'مولّد الأوامر المثلى',
  desc: 'يحسب كم طبقة تتسع في كرتك ويكتب لك أمر التشغيل وModelfile وإعدادات llama.cpp.',
  render() {
    if (!ollamaServer()) return needDiscovery('يحتاج بطاقة النموذج من Ollama لقراءة عدد الطبقات.');
    return `<div class="u-form">
        ${modelPicker('cmdModel')}
        <div class="u-field"><label for="cmdCtx">السياق المطلوب</label>
          <select id="cmdCtx">${[2048, 4096, 8192, 16384, 32768, 65536].map(c => `<option ${c === 8192 ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
      </div>
      <div class="u-actions" style="margin-top:14px">
        <button class="u-btn go" onclick="Ultra.tools.buildCommand()">احسب الإعدادات</button>
      </div>
      <div id="cmdOut" style="margin-top:14px"></div>`;
  }
});

T.buildCommand = async function () {
  const s = ollamaServer(); if (!s) return;
  const model = $('cmdModel').value;
  const ctx = parseInt($('cmdCtx').value, 10);
  const out = $('cmdOut');
  out.innerHTML = '<p class="u-sub">جارٍ قراءة بنية النموذج…</p>';
  const hw = U.hardware();
  const info = await U.ollamaShow(s.base, model);
  const entry = ollamaModels().find(m => m.id === model) || {};
  const paramsB = (info && info.paramCount ? info.paramCount / 1e9 : 0) || U.paramsFromName(entry);
  const quant = U.quantFromName(entry);
  const fp = U.footprint({ paramsB }, quant, ctx);
  const layers = (info && info.blocks) || 0;
  const perLayer = layers ? fp.weights / layers : 0;
  const budget = hw.vram * 0.9 - fp.kv - 0.5;
  const ngl = layers ? clamp(Math.floor(budget / Math.max(perLayer, 0.001)), 0, layers) : 0;
  const threads = Math.max(2, Math.floor(((U.state.device && U.state.device.cores) || 8) * 0.75));
  const full = layers && ngl >= layers;
  const maxCtx = info && info.contextLength ? info.contextLength : 0;

  const modelfile = `FROM ${model}
PARAMETER num_ctx ${ctx}
PARAMETER num_gpu ${ngl}
PARAMETER num_thread ${threads}
PARAMETER num_batch ${hw.vram >= 8 ? 512 : 256}
PARAMETER temperature 0.7
PARAMETER repeat_penalty 1.1`;

  const env = `OLLAMA_FLASH_ATTENTION=1        # يقلّص ذاكرة السياق بوضوح
OLLAMA_KV_CACHE_TYPE=${hw.vram >= 12 ? 'f16' : 'q8_0'}        # ${hw.vram >= 12 ? 'دقة كاملة لذاكرة السياق' : 'يوفّر نحو نصف ذاكرة السياق'}
OLLAMA_NUM_PARALLEL=1            # طلب واحد في كل مرة يعطي أعلى سرعة
OLLAMA_KEEP_ALIVE=10m            # أبقِ النموذج محمّلاً بين الأسئلة
OLLAMA_MAX_LOADED_MODELS=1`;

  const llamacpp = `llama-server -m model.gguf \\
  -ngl ${ngl || 0} \\
  -c ${ctx} \\
  -t ${threads} \\
  -b ${hw.vram >= 8 ? 512 : 256} \\
  --flash-attn${hw.vram >= 12 ? '' : ' --cache-type-k q8_0 --cache-type-v q8_0'}`;

  out.innerHTML = `
    <div class="u-grid">
      ${metric('طبقات النموذج', layers || '—', info && info.arch ? esc(info.arch) : '')}
      ${metric('طبقات على الكرت', layers ? `${ngl} / ${layers}` : 'غير معروف', full ? 'كل النموذج على الرسوميات' : ngl ? 'الباقي على المعالج' : 'كل النموذج على المعالج', full ? 'ok' : ngl ? 'mid' : 'bad')}
      ${metric('الذاكرة المطلوبة', fp.total + ' GB', `أوزان ${fp.weights} + سياق ${fp.kv}`)}
      ${metric('الخيوط المقترحة', threads, 'ثلاثة أرباع الأنوية — ترك نواة للنظام يمنع التقطيع')}
      ${maxCtx ? metric('أقصى سياق يدعمه النموذج', maxCtx.toLocaleString('en-US'), ctx > maxCtx ? 'طلبك يتجاوز الحد!' : 'ضمن الحد', ctx > maxCtx ? 'bad' : '') : ''}
    </div>
    <div class="u-verdict ${full ? 'ok' : ngl ? 'mid' : 'no'}" style="margin-top:14px">
      ${full ? 'يمكن رفع النموذج كاملاً على كرت الرسوميات بهذا السياق — أفضل سرعة ممكنة.'
        : ngl ? `تتسع ${ngl} طبقة فقط على الكرت. كل طبقة تنزل للمعالج تخفض السرعة، فإما تقلّل السياق أو تختار تكميماً أخف.`
        : 'لا تتسع أي طبقة على كرتك بهذه الإعدادات — سيعمل على المعالج والذاكرة.'}
    </div>
    <h4 style="margin-top:16px;font-size:.95em">إعدادات بيئة Ollama</h4>
    <code class="u-code">${esc(env)}</code>
    <h4 style="margin-top:14px;font-size:.95em">Modelfile مخصّص لجهازك</h4>
    <code class="u-code">${esc(modelfile)}</code>
    <div class="u-actions" style="margin-top:8px">
      <button class="u-btn sm" onclick="Ultra.copyText(${esc(JSON.stringify(modelfile))})">انسخ Modelfile</button>
      <button class="u-btn sm" onclick="Ultra.copyText(${esc(JSON.stringify(`ollama create my-${model.split(':')[0]} -f Modelfile && ollama run my-${model.split(':')[0]}`))})">انسخ أمر الإنشاء</button>
    </div>
    <h4 style="margin-top:14px;font-size:.95em">llama.cpp مباشرة</h4>
    <code class="u-code">${esc(llamacpp)}</code>
    <div class="u-actions" style="margin-top:8px">
      <button class="u-btn sm" onclick="Ultra.copyText(${esc(JSON.stringify(llamacpp))})">انسخ الأمر</button>
    </div>`;
};

/* ============================================================
   ٣) حاسبة السياق
   ============================================================ */
reg({
  id: 'ctx', icon: '📏', name: 'حاسبة السياق',
  desc: 'أطول سياق يتحمّله جهازك لكل نموذج، وكم يكلّفك كل تضعيف للسياق.',
  render() {
    const cat = U.catalog.map(m => `<option value="${esc(m.id)}">${esc(m.name)}</option>`).join('');
    const mine = ollamaModels().map(m => `<option value="local:${esc(m.id)}">${esc(m.id)} (مثبّت)</option>`).join('');
    return `<div class="u-form">
        <div class="u-field"><label for="ctxModel">النموذج</label>
          <select id="ctxModel" onchange="Ultra.tools.calcContext()">${mine}${cat}</select></div>
        <div class="u-field"><label for="ctxQuant">التكميم</label>
          <select id="ctxQuant" onchange="Ultra.tools.calcContext()">
            ${['Q4_K_M', 'Q5_K_M', 'Q6_K', 'Q8_0', 'FP16'].map(q => `<option>${q}</option>`).join('')}</select></div>
        <div class="u-field"><label for="ctxKV">ضغط ذاكرة السياق</label>
          <select id="ctxKV" onchange="Ultra.tools.calcContext()">
            <option value="1">f16 — دقة كاملة</option>
            <option value="0.5">q8_0 — يوفّر النصف</option>
            <option value="0.25">q4_0 — يوفّر ثلاثة أرباع</option>
          </select></div>
      </div>
      <div id="ctxOut" style="margin-top:14px"></div>`;
  },
  after() { T.calcContext(); }
});

T.calcContext = function () {
  const sel = $('ctxModel'); if (!sel) return;
  const hw = U.hardware();
  const val = sel.value;
  let model;
  if (val.startsWith('local:')) {
    const m = ollamaModels().find(x => x.id === val.slice(6));
    model = { name: m.id, paramsB: U.paramsFromName(m) };
  } else {
    model = U.catalog.find(m => m.id === val);
  }
  if (!model || !model.paramsB) { $('ctxOut').innerHTML = '<p class="u-sub">تعذّر تحديد حجم النموذج.</p>'; return; }
  const quant = $('ctxQuant').value;
  const kvFactor = parseFloat($('ctxKV').value);

  const a = U.footprint(model, quant, 1024), b = U.footprint(model, quant, 9216);
  const kvPerToken = (b.kv - a.kv) / 8192; // GB لكل رمز
  const weights = a.weights + a.overhead;
  const budgets = [
    { name: 'كرت الرسوميات', gb: hw.vram },
    { name: 'الذاكرة العشوائية', gb: Math.max(0, hw.ram - 3) }
  ];
  const maxCtxFor = (gb) => Math.max(0, Math.floor(((gb * 0.92 - weights) / (kvPerToken * kvFactor)) / 512) * 512);

  const rows = [2048, 4096, 8192, 16384, 32768, 65536, 131072].map(c => {
    const total = weights + kvPerToken * kvFactor * c;
    const fitsGPU = hw.vram > 0 && total <= hw.vram * 0.92;
    const fitsRAM = total <= (hw.ram - 3) * 0.92;
    return `<tr><td><b>${c.toLocaleString('en-US')}</b><div class="u-sub" style="font-size:.8em">≈ ${Math.round(c * 0.55).toLocaleString('en-US')} كلمة عربية</div></td>
      <td><b>${num(kvPerToken * kvFactor * c, 2)}</b> GB</td>
      <td><b>${num(total, 2)}</b> GB</td>
      <td>${fitsGPU ? chip('على الكرت', 'on') : fitsRAM ? chip('على الذاكرة فقط', 'mid') : chip('لا يتسع', 'no')}</td></tr>`;
  }).join('');

  $('ctxOut').innerHTML = `
    <div class="u-grid">
      ${metric('أقصى سياق على الكرت', hw.vram ? maxCtxFor(hw.vram).toLocaleString('en-US') : '—', `${hw.vram} GB VRAM`, hw.vram ? 'ok' : '')}
      ${metric('أقصى سياق على الذاكرة', maxCtxFor(hw.ram - 3).toLocaleString('en-US'), `${hw.ram} GB RAM ناقص حصة النظام`)}
      ${metric('تكلفة كل ١٠٢٤ رمز', num(kvPerToken * kvFactor * 1024, 3) + ' GB', 'كل تضعيف للسياق يضاعف هذا الرقم')}
      ${metric('حجم الأوزان الثابت', num(weights, 2) + ' GB', esc(quant))}
    </div>
    <div class="u-scroll"><table class="u-table" style="margin-top:12px">
      <tr><th>السياق</th><th>ذاكرة السياق</th><th>المجموع</th><th>أين يعمل</th></tr>${rows}
    </table></div>
    <div class="u-note" style="margin-top:12px">ضغط ذاكرة السياق إلى q8_0 يوفّر نصف ذاكرة السياق مقابل أثر ضئيل على الجودة — الخيار الأفضل عادةً حين تريد سياقاً أطول على كرت صغير.</div>`;
};

/* ============================================================
   ٤) كفاءة الترميز العربي
   ============================================================ */
const AR_SAMPLE = 'تعتمد سرعة توليد النص في النماذج المحلية على نطاق الذاكرة أكثر من اعتمادها على قوة المعالج، ولهذا نجد أن كرت رسوميات متوسط بذاكرة سريعة قد يتفوق على معالج قوي بذاكرة بطيئة في هذه المهمة تحديداً.';
const EN_SAMPLE = 'The speed of text generation in local models depends on memory bandwidth far more than on raw processor power, which is why a mid range graphics card with fast memory often beats a strong processor with slow memory at this particular task.';

reg({
  id: 'tokenizer', icon: '🔤', name: 'كفاءة الترميز العربي',
  desc: 'يقيس كم رمزاً يستهلكه كل نموذج للنص العربي مقابل الإنجليزي — الفارق يعني سرعة وذاكرة.',
  render() {
    if (!ollamaServer()) return needDiscovery();
    return `<div class="u-form">${modelPicker('tokModels', { multi: true })}</div>
      <div class="u-note" style="margin-top:12px">نرسل نفس الفقرة بالعربية والإنجليزية ونقرأ عدد رموز الإدخال من الخادم. كلما زاد عدد الأحرف لكل رمز كان النموذج أكفأ في العربية: سياق أطول، ذاكرة أقل، وسرعة أعلى للجملة نفسها.</div>
      <div class="u-actions" style="margin-top:14px"><button class="u-btn go" id="tokRun" onclick="Ultra.tools.runTokenizer()">قِس النماذج المختارة</button></div>
      <div id="tokStatus" class="u-sub" style="margin-top:10px"></div>
      <div id="tokOut"></div>`;
  }
});

T.runTokenizer = async function () {
  const s = ollamaServer(); if (!s) return;
  const models = picked('tokModels').slice(0, 8);
  if (!models.length) { toast('اختر نموذجاً على الأقل'); return; }
  const btn = $('tokRun'); btn.disabled = true; btn.textContent = 'جارٍ القياس…';
  const rows = [];
  try {
    for (let i = 0; i < models.length; i++) {
      $('tokStatus').textContent = `(${i + 1}/${models.length}) ${models[i]}`;
      try {
        const ar = await generate(s.base, models[i], AR_SAMPLE, { num_predict: 1 });
        const en = await generate(s.base, models[i], EN_SAMPLE, { num_predict: 1 });
        const arTok = ar.prompt_eval_count || 0, enTok = en.prompt_eval_count || 0;
        rows.push({
          model: models[i], arTok, enTok,
          arPerChar: arTok ? AR_SAMPLE.length / arTok : 0,
          enPerChar: enTok ? EN_SAMPLE.length / enTok : 0,
          ratio: enTok ? arTok / enTok : 0
        });
      } catch (e) { rows.push({ model: models[i], error: e.message }); }
      renderTokenizer(rows);
    }
    $('tokStatus').textContent = 'اكتمل القياس';
  } finally { btn.disabled = false; btn.textContent = 'أعد القياس'; }
  T.state.tokenizer.rows = rows;
};

function renderTokenizer(rows) {
  const box = $('tokOut'); if (!box) return;
  const ok = rows.filter(r => !r.error && r.arTok);
  const best = ok.slice().sort((a, b) => b.arPerChar - a.arPerChar)[0];
  box.innerHTML = `
  ${best ? `<div class="u-grid" style="margin-top:14px">
    ${metric('الأكفأ في العربية', esc(best.model), num(best.arPerChar, 2) + ' حرف لكل رمز', 'ok')}
    ${metric('تضخّم العربية مقابل الإنجليزية', num(best.ratio, 2) + '×', best.ratio <= 1.4 ? 'ترميز عربي ممتاز' : best.ratio <= 2 ? 'تضخّم مقبول' : 'تضخّم كبير — سياق أقصر فعلياً')}
  </div>` : ''}
  <div class="u-scroll"><table class="u-table">
    <tr><th>النموذج</th><th>رموز العربية</th><th>رموز الإنجليزية</th><th>حرف/رمز عربي</th><th>التضخّم</th><th>الأثر</th></tr>
    ${rows.map(r => r.error
      ? `<tr><td>${esc(r.model)}</td><td colspan="5" style="color:#ff9d93">${esc(r.error)}</td></tr>`
      : `<tr><td>${esc(r.model)}</td><td><b>${r.arTok}</b></td><td><b>${r.enTok}</b></td>
         <td><b>${num(r.arPerChar, 2)}</b></td><td><b>${num(r.ratio, 2)}</b>×</td>
         <td>${r.ratio <= 1.4 ? chip('ممتاز', 'on') : r.ratio <= 2 ? chip('مقبول', 'mid') : chip('مكلف', 'no')}</td></tr>`).join('')}
  </table></div>
  ${ok.length ? `<div class="u-verdict ${best.ratio <= 1.6 ? 'ok' : 'mid'}" style="margin-top:12px">
    النموذج الذي يستهلك رموزاً أقل للنص العربي نفسه يعطيك سياقاً أطول بذات الذاكرة، ويولّد الجملة العربية أسرع لأن عدد الرموز المطلوب أقل.
    الفرق بين أفضل وأسوأ نموذج هنا ${ok.length > 1 ? num(Math.max(...ok.map(r => r.arTok)) / Math.min(...ok.map(r => r.arTok)), 2) + '×' : '—'} في تكلفة النص العربي.
  </div>` : ''}`;
}

/* ============================================================
   ٥) اختبار التحمل
   ============================================================ */
reg({
  id: 'stress', icon: '🔥', name: 'اختبار التحمل',
  desc: 'يكرّر التوليد عدة مرات ليكشف هبوط السرعة بسبب الحرارة أو ضغط الذاكرة.',
  render() {
    if (!ollamaServer()) return needDiscovery();
    return `<div class="u-form">
        ${modelPicker('stressModel')}
        <div class="u-field"><label for="stressRuns">عدد الجولات</label>
          <input id="stressRuns" type="number" min="3" max="20" value="6"></div>
        <div class="u-field"><label for="stressTokens">رموز كل جولة</label>
          <input id="stressTokens" type="number" min="64" max="512" value="160"></div>
      </div>
      <div class="u-actions" style="margin-top:14px">
        <button class="u-btn go" id="stressRun" onclick="Ultra.tools.runStress()">ابدأ الاختبار</button>
      </div>
      <div id="stressStatus" class="u-sub" style="margin-top:10px"></div>
      <div id="stressOut"></div>`;
  }
});

T.runStress = async function () {
  const s = ollamaServer(); if (!s) return;
  const model = $('stressModel').value;
  const runs = clamp(parseInt($('stressRuns').value, 10) || 6, 3, 20);
  const tokens = clamp(parseInt($('stressTokens').value, 10) || 160, 64, 512);
  const btn = $('stressRun'); btn.disabled = true; btn.textContent = 'جارٍ الاختبار…';
  const series = [];
  const prompts = ['اكتب فقرة عن أهمية الماء.', 'اشرح كيف يعمل المحرك الكهربائي.', 'لخّص فوائد المشي اليومي.',
                   'اكتب وصفاً قصيراً لمدينة ساحلية.', 'اشرح مفهوم الجاذبية ببساطة.', 'اكتب نصائح لتنظيم الوقت.'];
  try {
    for (let i = 0; i < runs; i++) {
      $('stressStatus').textContent = `الجولة ${i + 1} من ${runs}…`;
      try {
        const r = await generate(s.base, model, prompts[i % prompts.length], { num_predict: tokens, temperature: 0.8 });
        const evalSec = r.eval_duration ? r.eval_duration / 1e9 : 1;
        series.push(Math.round((r.eval_count / evalSec) * 10) / 10);
      } catch (e) { series.push(0); }
      renderStress(series, model);
      await sleep(200);
    }
    $('stressStatus').textContent = 'انتهى الاختبار';
  } finally { btn.disabled = false; btn.textContent = 'أعد الاختبار'; }
  T.state.stress.series = series;
};

function renderStress(series, model) {
  const box = $('stressOut'); if (!box) return;
  const valid = series.filter(v => v > 0);
  if (!valid.length) { box.innerHTML = '<p class="u-sub">لا نتائج بعد.</p>'; return; }
  const first = valid[0], last = valid[valid.length - 1];
  const drop = first ? Math.round((1 - last / first) * 100) : 0;
  const avg = valid.reduce((a, b) => a + b, 0) / valid.length;
  const best = Math.max(...valid), worst = Math.min(...valid);
  box.innerHTML = `
    <div class="u-grid" style="margin-top:14px">
      ${metric('الجولة الأولى', first + ' رمز/ث', esc(model))}
      ${metric('الجولة الأخيرة', last + ' رمز/ث', drop > 0 ? `انخفاض ${drop}%` : 'ثابت أو أفضل', drop >= 20 ? 'bad' : drop >= 8 ? 'mid' : 'ok')}
      ${metric('المتوسط', num(avg) + ' رمز/ث', `أفضل ${best} · أسوأ ${worst}`)}
      ${metric('تذبذب الأداء', num(((best - worst) / best) * 100, 0) + '%', 'الفرق بين أفضل وأسوأ جولة')}
    </div>
    <div class="u-panel" style="margin-top:12px;background:rgba(0,0,0,.25)">
      ${sparkline(valid, { height: 60, color: drop >= 20 ? '#e74c3c' : '#00d4ff' })}
      <div class="u-sub" style="margin-top:6px">تسلسل السرعة عبر ${valid.length} جولات</div>
    </div>
    <div class="u-verdict ${drop >= 20 ? 'no' : drop >= 8 ? 'mid' : 'ok'}" style="margin-top:12px">
      ${drop >= 20 ? 'هبوط كبير مع استمرار الحمل: خنق حراري أو نفاد ذاكرة الكرت. حسّن التبريد، أو قلّل السياق، أو انزل لنموذج أصغر للجلسات الطويلة.'
        : drop >= 8 ? 'هبوط طفيف متوقّع في الأجهزة المحمولة. وصّل الشاحن وارفع خطة الطاقة إن أردت ثباتاً أعلى.'
        : 'الأداء ثابت تحت الحمل المتواصل — جهازك يتحمّل الجلسات الطويلة.'}
    </div>`;
}

/* ============================================================
   ٦) مخطط المساحة
   ============================================================ */
reg({
  id: 'space', icon: '🗂️', name: 'مخطط المساحة',
  desc: 'يرتّب نماذجك حسب الحجم والفائدة، ويقترح ما تحذفه أولاً لتفريغ مساحة.',
  render() {
    const models = ollamaModels().filter(m => m.sizeBytes);
    if (!models.length) return needDiscovery('لا توجد نماذج مثبّتة معروفة الحجم بعد.');
    const hw = U.hardware();
    const rows = models.slice().sort((a, b) => b.sizeBytes - a.sizeBytes).map(m => {
      const p = U.paramsFromName(m);
      const j = p ? U.judge({ name: m.id, paramsB: p }, hw, U.quantFromName(m), 4096) : null;
      const stale = m.modified ? (Date.now() - new Date(m.modified).getTime()) / 86400000 : 0;
      const reason = !j ? '' : j.level === 'no' ? 'أثقل من جهازك — لن تشغّله' : stale > 180 ? 'قديم — مرّت أشهر على تحديثه' : '';
      return { m, j, size: m.sizeBytes, reason, stale };
    });
    const total = rows.reduce((a, r) => a + r.size, 0);
    const wasted = rows.filter(r => r.j && r.j.level === 'no').reduce((a, r) => a + r.size, 0);
    return `<div class="u-grid">
        ${metric('إجمالي المساحة', fmtSize(total), U.count(rows.length))}
        ${metric('مساحة مرشّحة للتفريغ', fmtSize(wasted), wasted ? 'نماذج لا يشغّلها جهازك أو قديمة' : 'لا شيء مهدور', wasted ? 'mid' : 'ok')}
        ${metric('متوسط حجم النموذج', fmtSize(total / rows.length), '')}
        ${metric('حصة القرص للمتصفح', U.state.device ? fmtSize(U.state.device.storage.quota) : '—', 'افحص الجهاز لتحديثها')}
      </div>
      <div class="u-scroll"><table class="u-table" style="margin-top:12px">
        <tr><th>احذف</th><th>النموذج</th><th>الحجم</th><th>الحكم على جهازك</th><th>ملاحظة</th></tr>
        ${rows.map((r, i) => `<tr>
          <td><input type="checkbox" name="spacePick" value="${esc(r.m.id)}" data-size="${r.size}" onchange="Ultra.tools.spaceSum()" ${r.j && r.j.level === 'no' ? 'checked' : ''}></td>
          <td>${esc(r.m.id)}</td>
          <td><b>${fmtSize(r.size)}</b></td>
          <td>${r.j ? chip(r.j.verdict, r.j.level) : '—'}</td>
          <td style="font-size:.85em">${esc(r.reason || (r.m.loaded ? 'محمّل الآن' : ''))}</td>
        </tr>`).join('')}
      </table></div>
      <div id="spaceSum" class="u-verdict mid" style="margin-top:12px"></div>
      <div class="u-actions" style="margin-top:12px">
        <button class="u-btn warn" onclick="Ultra.tools.deleteSelected()">احذف المحدد من الجهاز</button>
      </div>`;
  },
  after() { T.spaceSum(); }
});

T.spaceSum = function () {
  const box = $('spaceSum'); if (!box) return;
  const picks = [...document.querySelectorAll('input[name="spacePick"]:checked')];
  const freed = picks.reduce((a, i) => a + Number(i.dataset.size || 0), 0);
  box.className = 'u-verdict ' + (freed ? 'mid' : 'ok');
  box.textContent = picks.length
    ? `سيُفرَّغ ${fmtSize(freed)} بحذف ${U.count(picks.length)}. يمكنك إعادة تنزيل أي منها لاحقاً بأمر واحد.`
    : 'لم تحدد شيئاً للحذف.';
};

T.deleteSelected = async function () {
  const s = ollamaServer(); if (!s) return;
  const picks = [...document.querySelectorAll('input[name="spacePick"]:checked')].map(i => i.value);
  if (!picks.length) { toast('حدد نموذجاً واحداً على الأقل'); return; }
  if (!confirm(`سيُحذف ${U.count(picks.length)} نهائياً من القرص. متابعة؟`)) return;
  let done = 0;
  for (const name of picks) { if (await U.ollamaDelete(s.base, name)) done++; }
  toast(`حُذف ${done} من ${picks.length}`);
  await U.startDiscovery();
  T.open('space');
};

/* ============================================================
   ٧) مستشار المهمة
   ============================================================ */
const TASKS = [
  { id: 'code', icon: '💻', name: 'البرمجة', re: /coder|code|devstral|codestral|starcoder|deepseek-coder/i, fallbackTag: 'برمجة' },
  { id: 'arabic', icon: '🕌', name: 'العربية', re: /qwen|aya|jais|command-r|gemma3/i, fallbackTag: 'عربي' },
  { id: 'reason', icon: '🧮', name: 'الاستدلال والرياضيات', re: /r1|qwq|phi|reason|thinking|gpt-oss/i, fallbackTag: 'استدلال' },
  { id: 'vision', icon: '👁️', name: 'قراءة الصور', re: /vl|vision|llava|moondream|gemma3|minicpm/i, fallbackTag: 'رؤية' },
  { id: 'fast', icon: '⚡', name: 'ردود فورية', re: /.*/, small: true, fallbackTag: 'خفيف' },
  { id: 'embed', icon: '🔗', name: 'البحث والتضمين', re: /embed|bge|nomic|e5|gte/i, fallbackTag: 'تضمين' }
];

reg({
  id: 'router', icon: '🧭', name: 'مستشار المهمة',
  desc: 'يختار من نماذجك المثبّتة الأنسب لكل نوع عمل، ويقترح ما ينقصك.',
  render() {
    const hw = U.hardware();
    const mine = ollamaModels().map(m => {
      const p = U.paramsFromName(m);
      const j = p ? U.judge({ name: m.id, paramsB: p }, hw, U.quantFromName(m), 4096) : null;
      return { m, p, j };
    }).filter(x => x.j && x.j.level !== 'no');

    const cards = TASKS.map(task => {
      let pool = mine.filter(x => task.re.test(x.m.id));
      if (task.id === 'fast') pool = mine.filter(x => x.p && x.p <= 5);
      if (task.id === 'embed') pool = mine.filter(x => /embed|bge|nomic|e5|gte/i.test(x.m.id));
      const winner = pool.slice().sort((a, b) =>
        (task.id === 'fast' ? b.j.speed.tps - a.j.speed.tps : b.p - a.p))[0];
      const suggestion = U.catalog.filter(c => (c.tags || []).includes(task.fallbackTag))
        .map(c => ({ c, j: U.judge(c, hw, 'Q4_K_M', 4096) }))
        .filter(x => x.j.level !== 'no')
        .sort((a, b) => b.c.paramsB - a.c.paramsB)[0];
      return `<div class="u-plan">
        <h4>${task.icon} ${esc(task.name)}</h4>
        ${winner ? `<div class="cost">من نماذجك المثبّتة</div>
          <div style="font-weight:600;word-break:break-all">${esc(winner.m.id)}</div>
          <div class="u-sub" style="margin-top:6px">${num(winner.p)}B · ${winner.j.fp.total} GB · ≈ ${winner.j.speed.tps} رمز/ثانية</div>`
        : `<div class="cost">لا يوجد نموذج مناسب مثبّت</div>`}
        ${suggestion ? `<div class="unlock">${winner ? 'ترقية مقترحة: ' : 'ابدأ بـ '}${esc(suggestion.c.name)} — ${esc(suggestion.c.use)}
          <code class="u-code">${esc(suggestion.c.pull)}</code></div>` : ''}
      </div>`;
    }).join('');

    return `<p class="u-sub">الترتيب يعتمد على ما يتسع في جهازك فعلياً: نموذج لا يعمل لا يُرشَّح مهما كان قوياً.</p>
      <div class="u-grid" style="margin-top:14px;grid-template-columns:repeat(auto-fit,minmax(230px,1fr))">${cards}</div>
      ${mine.length ? '' : '<div class="u-note" style="margin-top:14px">لم نجد نماذج مثبّتة تعمل على جهازك — شغّل البحث في تبويب «نماذجي المثبتة» أولاً.</div>'}`;
  }
});

/* ============================================================
   ٨) حاسبة التكلفة
   ============================================================ */
function estimatedWatts() {
  const d = U.state.device;
  const hw = U.hardware();
  if (!d) return 150;
  if (d.mobile) return 12;
  if (hw.unified) return 45;
  if (hw.vram >= 16) return 320;
  if (hw.vram >= 8) return 220;
  if (hw.vram >= 4) return 140;
  return 90;
}

reg({
  id: 'cost', icon: '💡', name: 'حاسبة التكلفة',
  desc: 'يقارن كلفة تشغيل النماذج على جهازك بكلفة واجهة سحابية لنفس عدد الرموز.',
  render() {
    const hw = U.hardware();
    const best = U.recommendFor(1)[0];
    return `<div class="u-form">
        <div class="u-field"><label for="costTokens">رموز شهرية (بالآلاف)</label>
          <input id="costTokens" type="number" min="1" value="2000" oninput="Ultra.tools.calcCost()"></div>
        <div class="u-field"><label for="costTps">سرعة التوليد (رمز/ثانية)</label>
          <input id="costTps" type="number" min="1" value="${best ? best.j.speed.tps : 20}" oninput="Ultra.tools.calcCost()"></div>
        <div class="u-field"><label for="costWatts">استهلاك الجهاز تحت الحمل (واط)</label>
          <input id="costWatts" type="number" min="5" value="${estimatedWatts()}" oninput="Ultra.tools.calcCost()"></div>
        <div class="u-field"><label for="costKwh">سعر الكيلوواط/ساعة</label>
          <input id="costKwh" type="number" min="0" step="0.01" value="0.18" oninput="Ultra.tools.calcCost()"></div>
        <div class="u-field"><label for="costApi">سعر السحابة لكل مليون رمز</label>
          <input id="costApi" type="number" min="0" step="0.5" value="55" oninput="Ultra.tools.calcCost()"></div>
        <div class="u-field"><label for="costHw">تكلفة ترقية مخطط لها (اختياري)</label>
          <input id="costHw" type="number" min="0" value="0" oninput="Ultra.tools.calcCost()"></div>
      </div>
      <p class="u-sub" style="margin-top:10px">القيم بعملتك المحلية — غيّر الأسعار كما تشاء. الحساب يفترض ${hw.vram ? 'تشغيلاً على كرت الرسوميات' : 'تشغيلاً على المعالج'}.</p>
      <div id="costOut" style="margin-top:14px"></div>`;
  },
  after() { T.calcCost(); }
});

T.calcCost = function () {
  const box = $('costOut'); if (!box) return;
  const tokens = (parseFloat($('costTokens').value) || 0) * 1000;
  const tps = Math.max(1, parseFloat($('costTps').value) || 20);
  const watts = Math.max(1, parseFloat($('costWatts').value) || 150);
  const kwhPrice = Math.max(0, parseFloat($('costKwh').value) || 0);
  const apiPrice = Math.max(0, parseFloat($('costApi').value) || 0);
  const upgrade = Math.max(0, parseFloat($('costHw').value) || 0);

  const hours = tokens / tps / 3600;
  const kwh = (hours * watts) / 1000;
  const localCost = kwh * kwhPrice;
  const cloudCost = (tokens / 1e6) * apiPrice;
  const saving = cloudCost - localCost;
  const payback = saving > 0 && upgrade > 0 ? upgrade / saving : null;

  box.innerHTML = `
    <div class="u-grid">
      ${metric('زمن التوليد الشهري', num(hours, 1) + ' ساعة', `${(tokens / 1000).toLocaleString('en-US')} ألف رمز عند ${tps} رمز/ثانية`)}
      ${metric('الكهرباء المستهلكة', num(kwh, 2) + ' ك.و.س', `${watts} واط تحت الحمل`)}
      ${metric('كلفة التشغيل محلياً', num(localCost, 2), 'شهرياً', 'ok')}
      ${metric('كلفة السحابة لنفس الرموز', num(cloudCost, 2), 'شهرياً', 'mid')}
    </div>
    <div class="u-verdict ${saving > 0 ? 'ok' : 'mid'}" style="margin-top:14px">
      ${saving > 0
        ? `التشغيل المحلي يوفّر ${num(saving, 2)} شهرياً، أي ${num(saving * 12, 0)} سنوياً${payback ? `. الترقية التي أدخلتها تسترد كلفتها خلال ${num(payback, 1)} شهراً.` : '.'}`
        : `عند هذا الاستخدام المنخفض تبقى السحابة أرخص بفارق ${num(-saving, 2)} شهرياً. الميزة الحقيقية للمحلي هنا ليست المال بل الخصوصية والعمل بلا إنترنت.`}
    </div>
    <div class="u-note" style="margin-top:12px">الحساب يغفل عمداً شيئين: عمر العتاد، وقيمة وقتك. إن كان جهازك مشغولاً بالتوليد ${num(hours, 1)} ساعة شهرياً فهذه ساعات لا تستطيع فيها استخدامه بكامل طاقته لشيء آخر.</div>`;
};

/* ============================================================
   ٩) المراقب المباشر
   ============================================================ */
reg({
  id: 'monitor', icon: '📡', name: 'المراقب المباشر',
  desc: 'يتابع ما هو محمّل في الذاكرة الآن، وكم يشغل من كرت الرسوميات، لحظة بلحظة.',
  render() {
    if (!ollamaServer()) return needDiscovery();
    return `<div class="u-actions">
        <button class="u-btn go" id="monBtn" onclick="Ultra.tools.toggleMonitor()">${T.state.monitor.timer ? 'أوقف المتابعة' : 'ابدأ المتابعة'}</button>
        <span id="monLive" class="u-live" style="display:${T.state.monitor.timer ? 'flex' : 'none'}"><i></i> يتابع كل ثلاث ثوانٍ</span>
      </div>
      <div id="monOut" style="margin-top:14px"><p class="u-sub">اضغط ابدأ لعرض الحالة الحية.</p></div>`;
  }
});

T.toggleMonitor = function () {
  if (T.state.monitor.timer) {
    clearInterval(T.state.monitor.timer);
    T.state.monitor.timer = null;
    $('monBtn').textContent = 'ابدأ المتابعة';
    const live = $('monLive'); if (live) live.style.display = 'none';
    return;
  }
  T.state.monitor.series = [];
  T.state.monitor.timer = setInterval(pollMonitor, 3000);
  $('monBtn').textContent = 'أوقف المتابعة';
  const live = $('monLive'); if (live) live.style.display = 'flex';
  pollMonitor();
};

async function pollMonitor() {
  const s = ollamaServer();
  const box = $('monOut');
  if (!box) { if (T.state.monitor.timer) { clearInterval(T.state.monitor.timer); T.state.monitor.timer = null; } return; }
  let ps = null;
  try { ps = await callJSON(s.base + '/api/ps', { timeout: 4000 }); } catch (e) {}
  const loaded = (ps && ps.models) || [];
  const vram = loaded.reduce((a, m) => a + (m.size_vram || 0), 0);
  const total = loaded.reduce((a, m) => a + (m.size || 0), 0);
  T.state.monitor.series.push(vram / (1024 ** 3));
  if (T.state.monitor.series.length > 40) T.state.monitor.series.shift();
  const heap = performance.memory ? performance.memory.usedJSHeapSize : 0;
  const hw = U.hardware();

  box.innerHTML = `
    <div class="u-grid">
      ${metric('نماذج محمّلة الآن', loaded.length, loaded.length ? 'جاهزة للرد فوراً' : 'لا شيء محمّل — أول سؤال سيستغرق وقت التحميل', loaded.length ? 'ok' : '')}
      ${metric('مشغول من كرت الرسوميات', vram ? fmtSize(vram) : '—', hw.vram ? `من ${hw.vram} GB · ${Math.round(vram / (hw.vram * 1024 ** 3) * 100) || 0}%` : '')}
      ${metric('الحجم الكلي المحمّل', total ? fmtSize(total) : '—', total && vram ? `${Math.round(vram / total * 100)}% منه على الكرت والباقي على المعالج` : '')}
      ${metric('ذاكرة هذه الصفحة', heap ? fmtSize(heap) : 'غير معلنة', 'استهلاك المتصفح نفسه')}
    </div>
    ${T.state.monitor.series.length > 1 ? `<div class="u-panel" style="margin-top:12px;background:rgba(0,0,0,.25)">
      ${sparkline(T.state.monitor.series, { height: 54, color: '#7ce6ac' })}
      <div class="u-sub" style="margin-top:6px">ذاكرة الرسوميات المشغولة خلال آخر ${T.state.monitor.series.length * 3} ثانية</div>
    </div>` : ''}
    <div class="u-scroll"><table class="u-table" style="margin-top:12px">
      <tr><th>النموذج</th><th>على الكرت</th><th>الحجم</th><th>يُفرَّغ في</th><th></th></tr>
      ${loaded.length ? loaded.map(m => `<tr>
        <td>${esc(m.name || m.model)}</td>
        <td><b>${fmtSize(m.size_vram || 0)}</b></td>
        <td><b>${fmtSize(m.size || 0)}</b></td>
        <td>${m.expires_at ? esc(new Date(m.expires_at).toLocaleTimeString('ar-EG')) : '—'}</td>
        <td><button class="u-btn sm" onclick="Ultra.tools.unloadNow('${esc(m.name || m.model)}')">فرّغ الآن</button></td>
      </tr>`).join('') : '<tr><td colspan="5" class="u-sub">لا نماذج محمّلة حالياً.</td></tr>'}
    </table></div>`;
}

T.unloadNow = async function (name) {
  const s = ollamaServer(); if (!s) return;
  await U.ollamaUnload(s.base, name);
  toast('أُخرج النموذج من الذاكرة');
  pollMonitor();
};

/* ============================================================
   ١٠) التقرير الشامل
   ============================================================ */
reg({
  id: 'report', icon: '📄', name: 'التقرير الشامل',
  desc: 'يجمع الفحص والنماذج والأحكام في ملف Markdown واحد جاهز للمشاركة.',
  render() {
    const d = U.state.device;
    return `<div class="u-grid">
        ${metric('فحص الجهاز', d ? 'جاهز' : 'ناقص', d ? new Date(d.at).toLocaleString('ar-EG') : 'شغّل الفحص العميق أولاً', d ? 'ok' : 'bad')}
        ${metric('النماذج المكتشفة', (U.state.localModels || []).length, (U.state.servers || []).length + ' خوادم')}
        ${metric('نتائج المقارنة', T.state.arena.results.length || '—', 'من حلبة النماذج')}
        ${metric('نتائج التحمل', T.state.stress.series.length || '—', 'من اختبار التحمل')}
      </div>
      <div class="u-actions" style="margin-top:14px">
        <button class="u-btn go" onclick="Ultra.tools.exportReport()">حمّل التقرير Markdown</button>
        <button class="u-btn" onclick="Ultra.tools.previewReport()">اعرضه هنا</button>
        <button class="u-btn" onclick="Ultra.exportScan()">صدّر البيانات JSON</button>
      </div>
      <div id="reportOut" style="margin-top:14px"></div>`;
  }
});

function buildReport() {
  const d = U.state.device;
  const hw = U.hardware();
  const L = [];
  L.push('# تقرير جاهزية الذكاء الاصطناعي المحلي');
  L.push(`التاريخ: ${new Date().toLocaleString('ar-EG')}`);
  L.push('');
  if (d) {
    L.push('## الجهاز');
    L.push(`- النظام: ${d.os} · ${d.browser}`);
    L.push(`- المعالج: ${d.cores} نواة · أداء نواة واحدة ${d.cpuSingle} عملية/ms`);
    L.push(`- الرسوميات: ${d.gpuName || 'غير معلن'} · ${hw.vram} GB VRAM · ${hw.gpuBW || '—'} GB/s`);
    L.push(`- الذاكرة: ${hw.ram} GB · نطاق فعّال ${d.bandwidth.cpu} GB/s`);
    L.push(`- حساب WebGPU: ${d.gpuBench ? d.gpuBench.gflops + ' GFLOPS' : 'غير متاح'}`);
    L.push(`- ثبات الأداء: ${d.thermal ? 'انخفاض ' + d.thermal.dropPercent + '% تحت الحمل' : 'لم يُقس'}`);
    L.push(`- التخزين المتاح: ${num(d.health.freeGB)} GB`);
    L.push(`- الدرجة الكلية: ${d.scores.overall}/100 (معالج ${d.scores.cpu} · رسوميات ${d.scores.gpu} · ذاكرة ${d.scores.mem})`);
    L.push('');
    if (d.health.issues.length) {
      L.push('### ما يجب إصلاحه');
      d.health.issues.forEach(i => L.push(`- **${i.title}** — ${i.fix}`));
      L.push('');
    }
  } else {
    L.push('> لم يُنفَّذ الفحص العميق بعد.');
    L.push('');
  }
  const models = U.state.localModels || [];
  if (models.length) {
    L.push('## النماذج المثبّتة');
    L.push('| النموذج | الخادم | الحجم | التكميم | الحكم | رمز/ثانية |');
    L.push('| --- | --- | --- | --- | --- | --- |');
    models.forEach(m => {
      const p = U.paramsFromName(m);
      const j = p ? U.judge({ name: m.id, paramsB: p }, hw, U.quantFromName(m), 4096) : null;
      L.push(`| ${m.id} | ${m.serverName || m.provider} | ${m.sizeBytes ? fmtSize(m.sizeBytes) : '—'} | ${m.quant || '—'} | ${j ? j.verdict : '—'} | ${j ? j.speed.tps : '—'} |`);
    });
    L.push('');
  }
  const arena = T.state.arena.results.filter(r => !r.error);
  if (arena.length) {
    L.push('## نتائج حلبة النماذج');
    L.push('| النموذج | رمز/ثانية | الرموز | الزمن الكلي |');
    L.push('| --- | --- | --- | --- |');
    arena.forEach(r => L.push(`| ${r.model} | ${r.tps} | ${r.tokens} | ${r.wall} ث |`));
    L.push('');
  }
  if (T.state.stress.series.length) {
    const v = T.state.stress.series.filter(x => x > 0);
    L.push('## اختبار التحمل');
    L.push(`- الجولات: ${v.join(' → ')} رمز/ثانية`);
    L.push(`- الانخفاض من الأولى إلى الأخيرة: ${v.length ? Math.round((1 - v[v.length - 1] / v[0]) * 100) : 0}%`);
    L.push('');
  }
  if (T.state.tokenizer.rows.length) {
    L.push('## كفاءة الترميز العربي');
    L.push('| النموذج | رموز العربية | رموز الإنجليزية | التضخّم |');
    L.push('| --- | --- | --- | --- |');
    T.state.tokenizer.rows.filter(r => !r.error).forEach(r => L.push(`| ${r.model} | ${r.arTok} | ${r.enTok} | ${num(r.ratio, 2)}× |`));
    L.push('');
  }
  L.push('## توصيات التشغيل');
  U.recommendFor(4).forEach(r => L.push(`- **${r.name}** — ${r.use} · ${r.j.fp.total} GB · ≈ ${r.j.speed.tps} رمز/ثانية · \`${r.pull}\``));
  const plans = U.upgradePlans();
  L.push('');
  L.push('## مسارات الترقية');
  plans.plans.forEach(p => L.push(`- **${p.title}** (${p.tier}) — ${p.unlock}`));
  L.push('');
  L.push('_وُلِّد بواسطة AI Advisor Ultra — كل القياسات جرت على هذا الجهاز._');
  return L.join('\n');
}

T.previewReport = function () {
  const box = $('reportOut'); if (!box) return;
  box.innerHTML = `<div class="u-out" style="max-height:420px;direction:ltr;text-align:start">${esc(buildReport())}</div>`;
};

T.exportReport = function () {
  const blob = new Blob([buildReport()], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `ai-readiness-${new Date().toISOString().slice(0, 10)}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('حُمّل التقرير');
};

/* ============================================================
   التهيئة
   ============================================================ */
function boot() {
  injectCSS();
  const tabsBar = document.querySelector('.main-tabs');
  const container = document.querySelector('.container') || document.body;
  if (tabsBar && !$('tab-tools')) {
    const settingsBtn = [...tabsBar.querySelectorAll('.main-tab')].find(b => (b.getAttribute('onclick') || '').includes('openSettings'));
    const btn = document.createElement('button');
    btn.className = 'main-tab';
    btn.setAttribute('onclick', "switchMainTab(event, 'tools'); Ultra.tools.renderTab()");
    btn.innerHTML = '🧰 <span>الأدوات الذكية</span>';
    if (settingsBtn) tabsBar.insertBefore(btn, settingsBtn); else tabsBar.appendChild(btn);

    const panel = document.createElement('div');
    panel.className = 'tab-content';
    panel.id = 'tab-tools';
    const modal = document.querySelector('.modal-overlay');
    if (modal && modal.parentElement === container) container.insertBefore(panel, modal);
    else container.appendChild(panel);
  }
  T.renderTab();
  console.log('🧰 Smart Tools — ' + TOOLS.length + ' أدوات جاهزة');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

})();
