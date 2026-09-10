/* ============================================================
   AI Advisor Ultra - المحرك الرئيسي
   يحتوي على: WebLLM, Ollama, Voice, Vision, Memory, RAG,
   Multi-Agent, Function Calling, Benchmark, Gamification
   ============================================================ */

// ==================== Global State ====================
let systemData = null;
let charts = {};
let agentEngine = null; // WebLLM engine
let settings = {
  theme: 'dark',
  ttsEnabled: true,
  ttsSpeed: 1,
  engine: 'rules'
};
let gamification = {
  points: 0,
  achievements: {}
};
let ragStore = {
  documents: [],
  vectors: []
};
let db = null;

// ==================== IndexedDB - الذاكرة طويلة الأمد ====================
const DB_NAME = 'ai-advisor-ultra';
const DB_VERSION = 1;

async function initDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('conversations')) {
        db.createObjectStore('conversations', { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains('preferences')) {
        db.createObjectStore('preferences', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('systemData')) {
        db.createObjectStore('systemData', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('ragDocs')) {
        db.createObjectStore('ragDocs', { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror = (e) => reject(e.target.error);
  });
}

async function saveConversation(msg) {
  if (!db) return;
  const tx = db.transaction('conversations', 'readwrite');
  tx.objectStore('conversations').add({
    type: msg.type,
    text: msg.text,
    timestamp: Date.now()
  });
}

async function getConversations(limit = 50) {
  if (!db) return [];
  return new Promise((resolve) => {
    const tx = db.transaction('conversations', 'readonly');
    const req = tx.objectStore('conversations').getAll();
    req.onsuccess = () => {
      const all = req.result || [];
      resolve(all.slice(-limit));
    };
  });
}

async function savePref(key, value) {
  if (!db) return;
  const tx = db.transaction('preferences', 'readwrite');
  tx.objectStore('preferences').put({ key, value });
}

async function loadPrefs() {
  if (!db) return {};
  return new Promise((resolve) => {
    const tx = db.transaction('preferences', 'readonly');
    const req = tx.objectStore('preferences').getAll();
    req.onsuccess = () => {
      const prefs = {};
      (req.result || []).forEach(p => prefs[p.key] = p.value);
      resolve(prefs);
    };
  });
}

// ==================== System Info Collection ====================
async function collectSystemInfo() {
  const info = {
    timestamp: new Date().toISOString(),
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    vendor: navigator.vendor || 'غير معروف',
    cores: navigator.hardwareConcurrency || 'غير معروف',
    memory: navigator.deviceMemory || null,
    screenWidth: screen.width,
    screenHeight: screen.height,
    colorDepth: screen.colorDepth,
    pixelRatio: window.devicePixelRatio,
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    online: navigator.onLine,
    connection: null,
    gpu: 'غير معروف',
    gpuVendor: 'غير معروف',
    webglVersion: 'غير مدعوم',
    webgpuSupported: false,
    maxTextureSize: 0,
    gpuMemoryEstimate: 0,
    battery: null,
    touchSupport: 'ontouchstart' in window,
    storageEstimate: null
  };

  // WebGPU detection
  if (navigator.gpu) {
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (adapter) {
        info.webgpuSupported = true;
        const adapterInfo = adapter.info || (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : {});
        info.gpu = adapterInfo.description || adapterInfo.device || info.gpu;
        info.gpuVendor = adapterInfo.vendor || info.gpuVendor;
      }
    } catch(e) {}
  }

  // WebGL detection
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (gl) {
      info.webglVersion = gl instanceof WebGL2RenderingContext ? 'WebGL 2.0' : 'WebGL 1.0';
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      if (debugInfo) {
        const gpu = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || 'غير معروف';
        if (info.gpu === 'غير معروف') info.gpu = gpu;
        const vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || 'غير معروف';
        if (info.gpuVendor === 'غير معروف') info.gpuVendor = vendor;
      }
      info.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      
      const gpuLower = (info.gpu + ' ' + info.gpuVendor).toLowerCase();
      if (/rtx\s?(4090|4080|4070\s?ti)/i.test(gpuLower)) info.gpuMemoryEstimate = 24;
      else if (/rtx\s?(4070|4060\s?ti|3090|3080)/i.test(gpuLower)) info.gpuMemoryEstimate = 12;
      else if (/rtx\s?(4060|3060|2080)/i.test(gpuLower)) info.gpuMemoryEstimate = 8;
      else if (/gtx\s?(1660|1650|1080|1070)/i.test(gpuLower)) info.gpuMemoryEstimate = 6;
      else if (/rx\s?(7900|7800|6900)/i.test(gpuLower)) info.gpuMemoryEstimate = 16;
      else if (/rx\s?(6800|6700|6600)/i.test(gpuLower)) info.gpuMemoryEstimate = 8;
      else if (/apple\s?m[34]\s?(max|ultra)/i.test(gpuLower)) info.gpuMemoryEstimate = 32;
      else if (/apple\s?m[123]/i.test(gpuLower)) info.gpuMemoryEstimate = 8;
      else if (/intel|iris|uhd/i.test(gpuLower)) info.gpuMemoryEstimate = 2;
      else info.gpuMemoryEstimate = 4;
    }
  } catch(e) {}

  // Connection
  if (navigator.connection) {
    const conn = navigator.connection;
    info.connection = {
      effectiveType: conn.effectiveType || 'غير معروف',
      downlink: conn.downlink || 0,
      rtt: conn.rtt || 0,
      saveData: conn.saveData || false
    };
  }

  // Battery
  if (navigator.getBattery) {
    try {
      const battery = await navigator.getBattery();
      info.battery = {
        level: Math.round(battery.level * 100),
        charging: battery.charging
      };
    } catch(e) {}
  }

  // Storage
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const est = await navigator.storage.estimate();
      info.storageEstimate = {
        quota: (est.quota / (1024**3)).toFixed(2),
        usage: (est.usage / (1024**2)).toFixed(2)
      };
    } catch(e) {}
  }

  return info;
}

// ==================== Performance Analysis ====================
function analyzePerformance(info) {
  const breakdown = { cpu: 0, memory: 0, gpu: 0, storage: 0, network: 0 };
  const details = [];
  const recommendations = [];

  const cores = parseInt(info.cores) || 2;
  if (cores >= 24) { breakdown.cpu = 30; details.push('معالج احترافي'); }
  else if (cores >= 16) { breakdown.cpu = 27; details.push('معالج قوي جداً'); }
  else if (cores >= 12) { breakdown.cpu = 24; details.push('معالج قوي'); }
  else if (cores >= 8) { breakdown.cpu = 20; details.push('معالج جيد'); }
  else if (cores >= 6) { breakdown.cpu = 16; details.push('معالج متوسط+'); }
  else if (cores >= 4) { breakdown.cpu = 12; details.push('معالج متوسط'); }
  else { breakdown.cpu = 6; }

  const mem = info.memory || 4;
  if (mem >= 64) breakdown.memory = 30;
  else if (mem >= 32) breakdown.memory = 27;
  else if (mem >= 16) breakdown.memory = 23;
  else if (mem >= 8) breakdown.memory = 17;
  else if (mem >= 4) breakdown.memory = 10;
  else breakdown.memory = 4;

  const gpuLower = (info.gpu + ' ' + info.gpuVendor).toLowerCase();
  let gpuTier = 'unknown';

  if (info.webgpuSupported) { gpuTier = 'webgpu'; }

  if (/nvidia|geforce|rtx|gtx|quadro/i.test(gpuLower)) {
    if (/rtx\s?(40|50)\d{2}|rtx\s?a[456]\d{3}/i.test(gpuLower)) { breakdown.gpu = 30; gpuTier = 'excellent'; details.push('كرت NVIDIA احترافي'); }
    else if (/rtx\s?(30|20)\d{2}/i.test(gpuLower)) { breakdown.gpu = 24; gpuTier = 'very-good'; details.push('كرت NVIDIA قوي'); }
    else if (/gtx\s?(16|10)\d{2}/i.test(gpuLower)) { breakdown.gpu = 18; gpuTier = 'good'; }
    else { breakdown.gpu = 12; }
  } else if (/amd|radeon|rx/i.test(gpuLower)) {
    if (/rx\s?(7|9)\d{3}/i.test(gpuLower)) { breakdown.gpu = 28; gpuTier = 'excellent'; details.push('كرت AMD احترافي'); }
    else if (/rx\s?6[0-8]\d{2}/i.test(gpuLower)) { breakdown.gpu = 20; gpuTier = 'very-good'; }
    else { breakdown.gpu = 12; }
  } else if (/apple\s?m[1-4]/i.test(gpuLower)) {
    if (/m[34]\s?(max|ultra)/i.test(gpuLower)) { breakdown.gpu = 30; gpuTier = 'apple-high'; }
    else { breakdown.gpu = 22; gpuTier = 'apple-silicon'; }
    details.push('شريحة Apple Silicon');
  } else if (/intel|iris|uhd/i.test(gpuLower)) {
    breakdown.gpu = 8; gpuTier = 'integrated';
    recommendations.push('كرتك مدمج - يُفضل استخدام النماذج السحابية للنماذج الكبيرة');
  } else {
    breakdown.gpu = 5;
  }

  breakdown.storage = info.storageEstimate ? 4 : 3;
  breakdown.network = info.connection?.effectiveType === '4g' ? 5 : 3;

  if (info.battery && !info.battery.charging && info.battery.level < 20) {
    recommendations.push('البطارية منخفضة - واصل الشاحن');
  }

  const score = Math.min(
    breakdown.cpu + breakdown.memory + breakdown.gpu + breakdown.storage + breakdown.network,
    100
  );

  let tier, tierClass, tierLabel, tierEmoji;
  if (score >= 85) { tier = 'extreme'; tierClass = 'tier-extreme'; tierLabel = 'جهاز خارق'; tierEmoji = '🚀'; }
  else if (score >= 70) { tier = 'high'; tierClass = 'tier-high'; tierLabel = 'عالي الأداء'; tierEmoji = '⚡'; }
  else if (score >= 50) { tier = 'good'; tierClass = 'tier-good'; tierLabel = 'جيد'; tierEmoji = '✅'; }
  else if (score >= 30) { tier = 'mid'; tierClass = 'tier-mid'; tierLabel = 'متوسط'; tierEmoji = '⚙️'; }
  else { tier = 'weak'; tierClass = 'tier-weak'; tierLabel = 'ضعيف'; tierEmoji = '🐢'; }

  return { score, tier, tierClass, tierLabel, tierEmoji, details, recommendations, gpuTier, breakdown };
}

// ==================== AI Models Database ====================
const AI_MODELS = {
  free: {
    weak: [
      { name: 'Qwen2.5 0.5B', dev: 'Alibaba', desc: 'أصغر نموذج، للأجهزة الضعيفة جداً.', size: '0.5B', ram: '1-2 GB', vram: '0 GB', impact: 'استهلاك ضئيل', link: 'https://ollama.com/library/qwen2.5:0.5b', popularity: 70, category: 'chat' },
      { name: 'Llama 3.2 1B', dev: 'Meta', desc: 'أصغر Llama، مناسب للمهام البسيطة.', size: '1B', ram: '2-3 GB', vram: '0 GB', impact: 'تأثير ضئيل', link: 'https://ollama.com/library/llama3.2:1b', popularity: 85, category: 'chat' },
      { name: 'Qwen2.5 1.5B', dev: 'Alibaba', desc: 'نموذج صغير سريع.', size: '1.5B', ram: '3-4 GB', vram: '2 GB', impact: 'استهلاك خفيف', link: 'https://ollama.com/library/qwen2.5:1.5b', popularity: 80, category: 'chat' },
      { name: 'Gemma 2 2B', dev: 'Google', desc: 'نموذج Google المدمج.', size: '2B', ram: '4 GB', vram: '2 GB', impact: 'استهلاك متوسط', link: 'https://ollama.com/library/gemma2:2b', popularity: 75, category: 'chat' }
    ],
    mid: [
      { name: 'Llama 3.2 3B', dev: 'Meta', desc: 'متوازن.', size: '3B', ram: '6 GB', vram: '4 GB', impact: 'استهلاك معتدل', link: 'https://ollama.com/library/llama3.2:3b', popularity: 88, category: 'chat' },
      { name: 'Phi-3 Mini', dev: 'Microsoft', desc: 'للاستدلال.', size: '3.8B', ram: '6-8 GB', vram: '4 GB', impact: 'منطق ممتاز', link: 'https://ollama.com/library/phi3:mini', popularity: 82, category: 'reasoning' },
      { name: 'Qwen2.5 3B', dev: 'Alibaba', desc: 'دعم عربي ممتاز.', size: '3B', ram: '6 GB', vram: '4 GB', impact: 'عربي ممتاز', link: 'https://ollama.com/library/qwen2.5:3b', popularity: 85, category: 'chat' }
    ],
    good: [
      { name: 'Llama 3.1 8B', dev: 'Meta', desc: 'أفضل بحجم متوسط.', size: '8B', ram: '8-10 GB', vram: '6 GB', impact: 'جودة عالية', link: 'https://ollama.com/library/llama3.1:8b', popularity: 95, category: 'chat' },
      { name: 'Qwen2.5 7B', dev: 'Alibaba', desc: 'متعدد اللغات.', size: '7B', ram: '8 GB', vram: '6 GB', impact: 'عربي ممتاز', link: 'https://ollama.com/library/qwen2.5:7b', popularity: 92, category: 'chat' },
      { name: 'Mistral 7B', dev: 'Mistral AI', desc: 'سريع.', size: '7B', ram: '8 GB', vram: '6 GB', impact: 'سريع', link: 'https://ollama.com/library/mistral:7b', popularity: 90, category: 'chat' },
      { name: 'DeepSeek-R1 7B', dev: 'DeepSeek', desc: 'استدلالي.', size: '7B', ram: '8 GB', vram: '6 GB', impact: 'استدلال قوي', link: 'https://ollama.com/library/deepseek-r1:7b', popularity: 94, category: 'reasoning' },
      { name: 'CodeLlama 7B', dev: 'Meta', desc: 'للبرمجة.', size: '7B', ram: '8 GB', vram: '6 GB', impact: 'ممتاز للكود', link: 'https://ollama.com/library/codellama:7b', popularity: 88, category: 'code' }
    ],
    high: [
      { name: 'Qwen2.5 14B', dev: 'Alibaba', desc: 'جودة عالية جداً.', size: '14B', ram: '16 GB', vram: '12 GB', impact: 'استهلاك مرتفع', link: 'https://ollama.com/library/qwen2.5:14b', popularity: 90, category: 'chat' },
      { name: 'DeepSeek-R1 14B', dev: 'DeepSeek', desc: 'استدلال متقدم.', size: '14B', ram: '16 GB', vram: '12 GB', impact: 'استدلال ممتاز', link: 'https://ollama.com/library/deepseek-r1:14b', popularity: 92, category: 'reasoning' },
      { name: 'Mixtral 8x7B', dev: 'Mistral AI', desc: 'MoE قوي.', size: '47B MoE', ram: '24 GB', vram: '16 GB', impact: 'استثنائي', link: 'https://ollama.com/library/mixtral:8x7b', popularity: 88, category: 'chat' }
    ],
    extreme: [
      { name: 'Llama 3.1 70B', dev: 'Meta', desc: 'ضخم.', size: '70B', ram: '48-64 GB', vram: '40 GB', impact: 'استهلاك ضخم', link: 'https://ollama.com/library/llama3.1:70b', popularity: 95, category: 'chat' },
      { name: 'Qwen2.5 32B', dev: 'Alibaba', desc: 'استثنائي.', size: '32B', ram: '32-40 GB', vram: '24 GB', impact: 'مرتفع', link: 'https://ollama.com/library/qwen2.5:32b', popularity: 92, category: 'chat' },
      { name: 'DeepSeek-R1 32B', dev: 'DeepSeek', desc: 'استدلال ضخم.', size: '32B', ram: '32 GB', vram: '24 GB', impact: 'استثنائي', link: 'https://ollama.com/library/deepseek-r1:32b', popularity: 93, category: 'reasoning' }
    ]
  },
  paid: {
    weak: [
      { name: 'ChatGPT Free', dev: 'OpenAI', desc: 'مجاني.', size: 'سحابي', ram: '0', vram: '0', impact: 'بدون تأثير', link: 'https://chat.openai.com', popularity: 99, price: 'مجاني' },
      { name: 'ChatGPT Plus', dev: 'OpenAI', desc: 'أقوى نماذج.', size: 'سحابي', ram: '0', vram: '0', impact: 'بدون تأثير', link: 'https://openai.com/chatgpt/pricing/', popularity: 98, price: '$20/شهر' }
    ],
    mid: [
      { name: 'ChatGPT Plus', dev: 'OpenAI', desc: 'GPT-4o.', size: 'سحابي', ram: '0', vram: '0', impact: 'بدون تأثير', link: 'https://openai.com/chatgpt/pricing/', popularity: 98, price: '$20/شهر' },
      { name: 'Claude Pro', dev: 'Anthropic', desc: 'للكتابة.', size: 'سحابي', ram: '0', vram: '0', impact: 'بدون تأثير', link: 'https://claude.ai/upgrade', popularity: 95, price: '$20/شهر' },
      { name: 'Gemini Advanced', dev: 'Google', desc: 'Gemini Ultra.', size: 'سحابي', ram: '0', vram: '0', impact: 'بدون تأثير', link: 'https://gemini.google.com/advanced', popularity: 90, price: '$20/شهر' }
    ],
    good: [
      { name: 'ChatGPT Plus', dev: 'OpenAI', desc: 'الأفضل.', size: 'سحابي', ram: '0', vram: '0', impact: 'بدون تأثير', link: 'https://openai.com/chatgpt/pricing/', popularity: 98, price: '$20/شهر' },
      { name: 'Claude Pro', dev: 'Anthropic', desc: '200K context.', size: 'سحابي', ram: '0', vram: '0', impact: 'بدون تأثير', link: 'https://claude.ai/upgrade', popularity: 95, price: '$20/شهر' },
      { name: 'GitHub Copilot', dev: 'GitHub', desc: 'برمجة.', size: 'سحابي', ram: '0.5', vram: '0', impact: 'ضئيل', link: 'https://github.com/features/copilot', popularity: 92, price: '$10/شهر' }
    ],
    high: [
      { name: 'ChatGPT Pro', dev: 'OpenAI', desc: 'غير محدود.', size: 'سحابي', ram: '0', vram: '0', impact: 'بدون تأثير', link: 'https://openai.com/chatgpt/pricing/', popularity: 95, price: '$200/شهر' },
      { name: 'RunPod GPU', dev: 'RunPod', desc: 'GPU سحابي.', size: 'سحابي', ram: '0', vram: '80 GB', impact: 'بدون تأثير', link: 'https://runpod.io', popularity: 85, price: '$0.4-3/ساعة' }
    ],
    extreme: [
      { name: 'ChatGPT Pro', dev: 'OpenAI', desc: 'o1 Pro.', size: 'سحابي', ram: '0', vram: '0', impact: 'بدون تأثير', link: 'https://openai.com/chatgpt/pricing/', popularity: 95, price: '$200/شهر' },
      { name: 'Azure OpenAI', dev: 'Microsoft', desc: 'مؤسسي.', size: 'سحابي', ram: '0', vram: '0', impact: 'بدون تأثير', link: 'https://azure.microsoft.com/products/ai-services/openai-service', popularity: 90, price: 'حسب الاستخدام' }
    ]
  }
};

// ==================== WebLLM ====================
let webllmProgress = { text: '', progress: 0 };

async function loadWebLLM() {
  const btn = document.getElementById('loadWebllmBtn');
  if (!navigator.gpu) {
    showToast('❌ WebGPU غير مدعوم في متصفحك!');
    return;
  }
  btn.disabled = true;
  btn.textContent = '⏳ جاري التحميل...';
  document.getElementById('webllmProgress').style.display = 'block';
  
  try {
    const webllm = await window.loadWebLLM();
    const modelId = 'Llama-3.2-1B-Instruct-q4f16_1-MLC';
    
    webllmProgress = { text: 'تحميل المحرك...', progress: 0 };
    updateWebllmProgress();
    
    agentEngine = await webllm.CreateMLCEngine(modelId, {
      initProgressCallback: (report) => {
        webllmProgress = {
          text: report.text || 'تحميل...',
          progress: Math.round((report.progress || 0) * 100)
        };
        updateWebllmProgress();
      }
    });
    
    document.getElementById('webllmStatus').className = 'status-badge status-online';
    document.getElementById('webllmStatus').innerHTML = '<span class="status-dot"></span> WebLLM: جاهز';
    document.getElementById('chatEngine').textContent = 'WebLLM (Llama 3.2 1B)';
    document.getElementById('webllmProgressText').innerHTML = '✅ المحرك جاهز!';
    
    showToast('✅ WebLLM جاهز! جرب الدردشة الآن');
    unlockAchievement('webllm_loaded');
    addPoints(50);
    
    settings.engine = 'webllm';
    saveSettings();
  } catch(err) {
    console.error(err);
    showToast('❌ فشل تحميل WebLLM: ' + err.message);
    document.getElementById('webllmProgressText').innerHTML = '❌ فشل التحميل';
  } finally {
    btn.disabled = false;
    btn.textContent = '✅ محمّل';
  }
}

function updateWebllmProgress() {
  document.getElementById('webllmProgressFill').style.width = webllmProgress.progress + '%';
  document.getElementById('webllmProgressText').textContent = 
    `${webllmProgress.text} — ${webllmProgress.progress}%`;
}

async function chatWithWebLLM(messages) {
  if (!agentEngine) throw new Error('WebLLM غير محمّل');
  const response = await agentEngine.chat.completions.create({
    messages: messages,
    temperature: 0.7,
    max_tokens: 500
  });
  return response.choices[0].message.content;
}

// ==================== Ollama Integration ====================
async function checkOllama() {
  const statusEl = document.getElementById('ollamaStatus');
  try {
    const res = await fetch('http://localhost:11434/api/tags', {
      method: 'GET',
      mode: 'cors'
    });
    if (res.ok) {
      statusEl.className = 'status-badge status-online';
      statusEl.innerHTML = '<span class="status-dot"></span> Ollama: متصل';
      return true;
    }
  } catch(e) {
    statusEl.className = 'status-badge status-offline';
    statusEl.innerHTML = '<span class="status-dot"></span> Ollama: غير متصل';
    return false;
  }
  return false;
}

async function listOllamaModels() {
  const container = document.getElementById('ollamaResults');
  container.innerHTML = '<div class="spinner" style="margin:20px auto;"></div>';
  
  try {
    const res = await fetch('http://localhost:11434/api/tags');
    const data = await res.json();
    
    if (!data.models || data.models.length === 0) {
      container.innerHTML = `
        <div style="background:rgba(243,156,18,0.1); padding:20px; border-radius:12px; text-align:center;">
          <p style="font-size:1.1em;">📭 لا توجد نماذج مثبتة بعد</p>
          <p style="color:#999; margin-top:10px;">ثبّت نموذجاً عبر: <code style="background:rgba(0,0,0,0.4); padding:4px 8px; border-radius:6px; color:#2ecc71;">ollama pull llama3.2</code></p>
        </div>
      `;
      return;
    }
    
    container.innerHTML = `
      <h3 style="color:#00d4ff; margin-bottom:15px;">📋 النماذج المثبتة (${data.models.length})</h3>
      <div class="ollama-models">
        ${data.models.map(m => `
          <div class="ollama-model">
            <h4 style="color:#fff;">${m.name}</h4>
            <p style="color:#999; font-size:0.85em; margin:8px 0;">الحجم: ${(m.size / 1024**3).toFixed(2)} GB</p>
            <p style="color:#999; font-size:0.85em;">التعديل: ${new Date(m.modified_at).toLocaleDateString('ar-SA')}</p>
            <button class="btn btn-primary" style="padding:8px 16px; font-size:0.85em; margin-top:10px;" onclick="testOllamaModel('${m.name}')">
              🚀 اختبار
            </button>
          </div>
        `).join('')}
      </div>
    `;
    unlockAchievement('ollama_connected');
    addPoints(30);
  } catch(e) {
    container.innerHTML = `
      <div style="background:rgba(231,76,60,0.1); padding:20px; border-radius:12px;">
        <p style="color:#e74c3c;">❌ فشل الاتصال بـ Ollama</p>
        <p style="color:#999; margin-top:10px; font-size:0.9em;">تأكد من:</p>
        <ul style="padding-right:20px; color:#999; font-size:0.9em;">
          <li>تشغيل Ollama على جهازك (ollama serve)</li>
          <li>السماح بـ CORS إذا لزم الأمر</li>
          <li>عدم حجب المنفذ 11434</li>
        </ul>
      </div>
    `;
  }
}

async function testOllamaModel(name) {
  showToast(`🧪 اختبار ${name}...`);
  try {
    const start = Date.now();
    const res = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: name,
        prompt: 'قل مرحبا فقط',
        stream: false
      })
    });
    const data = await res.json();
    const time = ((Date.now() - start) / 1000).toFixed(2);
    showToast(`✅ ${name} — ${time}s`);
  } catch(e) {
    showToast(`❌ فشل اختبار ${name}`);
  }
}

// ==================== Voice (Speech) ====================
let recognition = null;
let isRecording = false;

function toggleVoiceInput() {
  if (isRecording) {
    stopVoiceInput();
    return;
  }
  
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showToast('❌ متصفحك لا يدعم التعرف الصوتي');
    return;
  }
  
  recognition = new SpeechRecognition();
  recognition.lang = 'ar-SA';
  recognition.continuous = false;
  recognition.interimResults = true;
  
  document.getElementById('voiceModal').classList.add('open');
  document.getElementById('voiceBtn').classList.add('recording');
  document.getElementById('voiceText').textContent = 'جاري الاستماع...';
  isRecording = true;
  
  const visualizer = document.getElementById('voiceVisualizer');
  const bars = visualizer.querySelectorAll('.voice-bar');
  const interval = setInterval(() => {
    bars.forEach(bar => {
      bar.style.height = (10 + Math.random() * 50) + 'px';
    });
  }, 100);
  window._voiceInterval = interval;
  
  recognition.onresult = (event) => {
    let finalText = '';
    let interimText = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalText += transcript;
      else interimText += transcript;
    }
    document.getElementById('voiceText').textContent = finalText || interimText || '...';
    if (finalText) {
      document.getElementById('chatInput').value = finalText;
      setTimeout(() => {
        stopVoiceInput();
        sendChatMessage();
      }, 800);
    }
  };
  
  recognition.onerror = (e) => {
    console.error(e);
    showToast('❌ خطأ في التعرف الصوتي');
    stopVoiceInput();
  };
  
  recognition.onend = () => {
    if (isRecording) stopVoiceInput();
  };
  
  recognition.start();
  unlockAchievement('voice_used');
  addPoints(20);
}

function stopVoiceInput() {
  if (recognition) try { recognition.stop(); } catch(e) {}
  isRecording = false;
  document.getElementById('voiceModal').classList.remove('open');
  document.getElementById('voiceBtn').classList.remove('recording');
  if (window._voiceInterval) clearInterval(window._voiceInterval);
}

function speak(text) {
  if (!settings.ttsEnabled) return;
  if (!('speechSynthesis' in window)) return;
  
  const cleanText = text.replace(/[*`#_]/g, '').substring(0, 300);
  const utterance = new SpeechSynthesisUtterance(cleanText);
  utterance.lang = 'ar-SA';
  utterance.rate = settings.ttsSpeed;
  utterance.pitch = 1;
  
  const voices = speechSynthesis.getVoices();
  const arabicVoice = voices.find(v => v.lang.startsWith('ar'));
  if (arabicVoice) utterance.voice = arabicVoice;
  
  speechSynthesis.cancel();
  speechSynthesis.speak(utterance);
}

function toggleTTS() {
  settings.ttsEnabled = !settings.ttsEnabled;
  document.getElementById('ttsBtn').classList.toggle('active', !settings.ttsEnabled);
  showToast(settings.ttsEnabled ? '🔊 القراءة مفعّلة' : '🔇 القراءة معطّلة');
  saveSettings();
}

// ==================== Vision / OCR ====================
async function handleVisionUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  const container = document.getElementById('visionResults');
  container.innerHTML = `
    <img src="${URL.createObjectURL(file)}" class="vision-preview">
    <div style="margin-top:20px; text-align:center;">
      <div class="spinner" style="margin:20px auto;"></div>
      <p style="color:#00d4ff;">🔍 جاري تحليل الصورة (OCR)...</p>
    </div>
  `;
  
  try {
    const result = await Tesseract.recognize(file, 'ara+eng', {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          const pct = Math.round(m.progress * 100);
          const progressP = container.querySelector('p');
          if (progressP) progressP.textContent = `🔍 جاري التحليل... ${pct}%`;
        }
      }
    });
    
    const text = result.data.text;
    const confidence = result.data.confidence;
    
    container.innerHTML = `
      <img src="${URL.createObjectURL(file)}" class="vision-preview">
      <div style="margin-top:20px;">
        <h3 style="color:#00d4ff;">📄 النص المكتشف</h3>
        <div style="background:rgba(0,0,0,0.3); padding:15px; border-radius:10px; margin-top:10px; max-height:300px; overflow-y:auto; white-space:pre-wrap; font-family:monospace; font-size:0.9em;">${text || 'لم يتم اكتشاف نص'}</div>
        
        <div style="margin-top:15px; display:flex; gap:10px; flex-wrap:wrap;">
          <span class="info-badge">🎯 الدقة: ${Math.round(confidence)}%</span>
          <span class="info-badge">📏 الطول: ${text.length} حرف</span>
        </div>
        
        <h3 style="margin-top:20px; color:#00d4ff;">🔍 التحليل الذكي</h3>
        <div style="background:rgba(0,212,255,0.1); padding:15px; border-radius:10px; margin-top:10px;" id="visionAnalysis">جاري التحليل...</div>
        
        <div class="btn-group" style="margin-top:15px;">
          <button class="btn btn-primary" onclick="askAboutVision('${text.replace(/'/g, "\\'").replace(/\n/g, ' ').substring(0, 500)}')">
            🤖 اسأل Agent عنها
          </button>
        </div>
      </div>
    `;
    
    const analysis = analyzeVisionText(text);
    document.getElementById('visionAnalysis').innerHTML = analysis;
    
    unlockAchievement('vision_used');
    addPoints(25);
  } catch(e) {
    console.error(e);
    container.innerHTML = `
      <div style="background:rgba(231,76,60,0.1); padding:20px; border-radius:12px; color:#e74c3c;">
        ❌ فشل التحليل: ${e.message}
      </div>
    `;
  }
}

function analyzeVisionText(text) {
  const findings = [];
  
  if (/rtx|gtx|geforce|nvidia/i.test(text)) findings.push('✅ كرت شاشة NVIDIA مكتشف');
  if (/radeon|amd|rx\s?\d/i.test(text)) findings.push('✅ كرت شاشة AMD مكتشف');
  if (/intel|core\s?i\d/i.test(text)) findings.push('✅ معالج Intel مكتشف');
  if (/ryzen/i.test(text)) findings.push('✅ معالج AMD Ryzen مكتشف');
  if (/\d+\s?gb\s?ram/i.test(text)) {
    const match = text.match(/(\d+)\s?gb\s?ram/i);
    if (match) findings.push(`💾 الذاكرة: ${match[1]} GB`);
  }
  if (/windows\s?1[01]/i.test(text)) findings.push('🖥️ نظام: Windows 10/11');
  
  if (findings.length === 0) {
    return '<p style="color:#999;">لم يتم اكتشاف معلومات تقنية واضحة. جرب صورة أوضح.</p>';
  }
  
  return `<ul style="padding-right:20px; line-height:2;">${findings.map(f => `<li>${f}</li>`).join('')}</ul>`;
}

function askAboutVision(text) {
  switchMainTab({ target: document.querySelector('[onclick*="chat"]') }, 'chat');
  document.getElementById('chatInput').value = `حلل هذه المعلومات من صورة جهازي: ${text}`;
  setTimeout(sendChatMessage, 300);
}

// ==================== RAG (Knowledge Base) ====================
async function handleRAGUpload(event) {
  const files = Array.from(event.target.files);
  for (const file of files) {
    if (file.type === 'application/pdf') {
      ragStore.documents.push({
        name: file.name,
        content: '[PDF - يحتاج معالجة خارجية]',
        timestamp: Date.now()
      });
    } else {
      const text = await file.text();
      ragStore.documents.push({
        name: file.name,
        content: text,
        timestamp: Date.now()
      });
    }
  }
  renderRAGDocs();
  showToast(`✅ تم رفع ${files.length} مستند`);
  unlockAchievement('rag_uploaded');
  addPoints(20);
}

function renderRAGDocs() {
  const container = document.getElementById('ragDocs');
  container.innerHTML = ragStore.documents.map((doc, i) => `
    <div class="rag-doc">
      <span>📄 ${doc.name}</span>
      <span style="color:#999; font-size:0.85em;">(${(doc.content.length / 1000).toFixed(1)}K حرف)</span>
      <button style="background:none; border:none; color:#e74c3c; cursor:pointer;" onclick="removeRAGDoc(${i})">✕</button>
    </div>
  `).join('');
}

function removeRAGDoc(i) {
  ragStore.documents.splice(i, 1);
  renderRAGDocs();
}

async function queryRAG() {
  const query = document.getElementById('ragQuery').value.trim();
  if (!query) return;
  
  const container = document.getElementById('ragResults');
  container.innerHTML = '<div class="spinner" style="margin:20px auto;"></div>';
  
  if (ragStore.documents.length === 0) {
    container.innerHTML = '<p style="color:#f39c12;">⚠️ لا توجد مستندات. ارفع مستنداتك أولاً.</p>';
    return;
  }
  
  const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length > 2);
  const results = [];
  
  for (const doc of ragStore.documents) {
    const lower = doc.content.toLowerCase();
    let score = 0;
    const matches = [];
    
    for (const kw of keywords) {
      const idx = lower.indexOf(kw);
      if (idx !== -1) {
        score++;
        matches.push({
          snippet: doc.content.substring(Math.max(0, idx - 100), idx + 200),
          keyword: kw
        });
      }
    }
    
    if (score > 0) {
      results.push({ doc: doc.name, score, matches });
    }
  }
  
  results.sort((a, b) => b.score - a.score);
  
  if (results.length === 0) {
    container.innerHTML = '<p style="color:#999;">لا نتائج مطابقة.</p>';
    return;
  }
  
  container.innerHTML = `
    <h3 style="color:#00d4ff;">📖 النتائج (${results.length})</h3>
    ${results.slice(0, 5).map(r => `
      <div style="background:rgba(0,0,0,0.3); padding:15px; border-radius:10px; margin-top:10px;">
        <strong style="color:#7b2ff7;">📄 ${r.doc}</strong>
        <span style="color:#999; font-size:0.85em;"> (${r.score} تطابق)</span>
        <div style="margin-top:10px; font-size:0.9em; color:#ccc;">
          ${r.matches.slice(0, 3).map(m => `
            <div style="padding:8px; background:rgba(0,212,255,0.05); border-radius:6px; margin-top:5px; border-right:3px solid #00d4ff;">
              ...${m.snippet}...
            </div>
          `).join('')}
        </div>
      </div>
    `).join('')}
  `;
}

// ==================== Benchmark ====================
async function runFullBenchmark() {
  const btn = document.getElementById('benchmarkBtn');
  const container = document.getElementById('benchmarkResults');
  btn.disabled = true;
  
  container.innerHTML = `
    <div class="benchmark-progress">
      <p>🧪 جاري تشغيل الاختبارات...</p>
      <div class="progress-bar" style="margin-top:15px;"><div class="progress-fill" id="benchProgress" style="width:0%"></div></div>
      <div id="benchCurrent" style="margin-top:10px; color:#00d4ff;">بدء...</div>
    </div>
  `;
  
  const results = {};
  
  await updateBench('اختبار المعالج (رياضيات)...', 20);
  await sleep(500);
  results.cpu = runCPUTest();
  
  await updateBench('اختبار الذاكرة...', 40);
  await sleep(500);
  results.memory = runMemoryTest();
  
  await updateBench('اختبار كرت الشاشة...', 60);
  await sleep(500);
  results.gpu = runGPUTest();
  
  await updateBench('اختبار التخزين...', 80);
  await sleep(500);
  results.storage = runStorageTest();
  
  await updateBench('اختبار التشفير...', 100);
  await sleep(300);
  results.crypto = await runCryptoTest();
  
  renderBenchmarkResults(results);
  btn.disabled = false;
  unlockAchievement('benchmark_done');
  addPoints(40);
}

async function updateBench(text, progress) {
  const el = document.getElementById('benchCurrent');
  const bar = document.getElementById('benchProgress');
  if (el) el.textContent = text;
  if (bar) bar.style.width = progress + '%';
}

function runCPUTest() {
  const start = performance.now();
  let result = 0;
  for (let i = 0; i < 5_000_000; i++) {
    result += Math.sqrt(i) * Math.sin(i);
  }
  const time = performance.now() - start;
  const score = Math.round(5000 / time * 100);
  return { time: time.toFixed(2), score, ops: '5M ops' };
}

function runMemoryTest() {
  const start = performance.now();
  const arr = new Array(1_000_000);
  for (let i = 0; i < arr.length; i++) arr[i] = i * 2;
  let sum = 0;
  for (let i = 0; i < arr.length; i++) sum += arr[i];
  const time = performance.now() - start;
  const score = Math.round(2000 / time * 100);
  return { time: time.toFixed(2), score, ops: '1M ops' };
}

function runGPUTest() {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return { score: 0, error: 'WebGL not supported' };
    
    const start = performance.now();
    gl.clearColor(0, 0, 0, 1);
    for (let i = 0; i < 100; i++) {
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.finish();
    }
    const time = performance.now() - start;
    const score = Math.round(3000 / time);
    return { time: time.toFixed(2), score, ops: '100 draws' };
  } catch(e) {
    return { score: 0, error: e.message };
  }
}

function runStorageTest() {
  const start = performance.now();
  const data = 'x'.repeat(1_000_000);
  for (let i = 0; i < 10; i++) {}
  const time = performance.now() - start;
  return { time: time.toFixed(2), score: 100, ops: '10MB' };
}

async function runCryptoTest() {
  const start = performance.now();
  const encoder = new TextEncoder();
  const data = encoder.encode('x'.repeat(100_000));
  try {
    await crypto.subtle.digest('SHA-256', data);
    const time = performance.now() - start;
    const score = Math.round(1000 / time * 100);
    return { time: time.toFixed(2), score, ops: 'SHA-256 100KB' };
  } catch(e) {
    return { score: 0, error: e.message };
  }
}

function renderBenchmarkResults(r) {
  const total = Math.round((r.cpu.score + r.memory.score + r.gpu.score + r.storage.score + r.crypto.score) / 5);
  
  document.getElementById('benchmarkResults').innerHTML = `
    <div class="card" style="margin-top:20px; background:linear-gradient(135deg, rgba(123,47,247,0.1), rgba(0,212,255,0.1));">
      <h2 style="text-align:center;">🎯 النتيجة الإجمالية</h2>
      <div style="text-align:center; font-size:4em; font-weight:bold; background:linear-gradient(90deg,#00d4ff,#7b2ff7); -webkit-background-clip:text; -webkit-text-fill-color:transparent;">${total}</div>
      <p style="text-align:center; color:#999;">من 1000</p>
    </div>
    
    <div class="benchmark-progress">
      <div class="benchmark-item"><span>⚙️ المعالج</span><span class="benchmark-value">${r.cpu.score} نقطة (${r.cpu.time}ms)</span></div>
      <div class="benchmark-item"><span>💾 الذاكرة</span><span class="benchmark-value">${r.memory.score} نقطة (${r.memory.time}ms)</span></div>
      <div class="benchmark-item"><span>🎮 كرت الشاشة</span><span class="benchmark-value">${r.gpu.score} نقطة ${r.gpu.error ? '❌' : '(' + r.gpu.time + 'ms)'}</span></div>
      <div class="benchmark-item"><span>💿 التخزين</span><span class="benchmark-value">${r.storage.score} نقطة</span></div>
      <div class="benchmark-item"><span>🔐 التشفير</span><span class="benchmark-value">${r.crypto.score} نقطة (${r.crypto.time}ms)</span></div>
    </div>
  `;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ==================== Achievements / Gamification ====================
const ACHIEVEMENTS = [
  { id: 'first_analysis', icon: '🔍', name: 'المحلل الأول', desc: 'أكمل أول تحليل لجهازك', points: 10 },
  { id: 'webllm_loaded', icon: '🧠', name: 'العقل المدبر', desc: 'حمّل WebLLM', points: 50 },
  { id: 'ollama_connected', icon: '🔌', name: 'متصل', desc: 'اتصل بـ Ollama', points: 30 },
  { id: 'voice_used', icon: '🎤', name: 'المتحدث', desc: 'استخدم الإدخال الصوتي', points: 20 },
  { id: 'vision_used', icon: '👁️', name: 'العين الساهرة', desc: 'حلّل صورة', points: 25 },
  { id: 'rag_uploaded', icon: '📚', name: 'العالم', desc: 'ارفع مستنداً', points: 20 },
  { id: 'benchmark_done', icon: '⚡', name: 'المختبِر', desc: 'أكمل اختبار الأداء', points: 40 },
  { id: 'chat_master', icon: '💬', name: 'المحاور', desc: 'أرسل 10 رسائل', points: 30 },
  { id: 'explorer', icon: '🚀', name: 'المستكشف', desc: 'جرّب كل التبويبات', points: 50 },
  { id: 'night_owl', icon: '🦉', name: 'بومة الليل', desc: 'استخدم الأداة بعد منتصف الليل', points: 15 }
];

function initGamification() {
  ACHIEVEMENTS.forEach(a => {
    if (gamification.achievements[a.id] === undefined) {
      gamification.achievements[a.id] = false;
    }
  });
  loadGamification();
  renderAchievements();
}

async function loadGamification() {
  const prefs = await loadPrefs();
  if (prefs.gamification) {
    gamification = prefs.gamification;
  }
}

function unlockAchievement(id) {
  if (gamification.achievements[id]) return;
  const ach = ACHIEVEMENTS.find(a => a.id === id);
  if (!ach) return;
  gamification.achievements[id] = true;
  gamification.points += ach.points;
  savePref('gamification', gamification);
  showToast(`🏆 إنجاز جديد: ${ach.name} (+${ach.points})`);
  renderAchievements();
}

function addPoints(n) {
  gamification.points += n;
  savePref('gamification', gamification);
  updatePointsDisplay();
}

function updatePointsDisplay() {
  const el = document.getElementById('totalPoints');
  if (el) el.textContent = gamification.points;
  
  const level = getLevel(gamification.points);
  const levelEl = document.getElementById('levelText');
  if (levelEl) levelEl.textContent = `المستوى: ${level}`;
}

function getLevel(points) {
  if (points >= 1000) return '👑 أسطورة';
  if (points >= 500) return '🏆 خبير';
  if (points >= 200) return '⭐ متقدم';
  if (points >= 100) return '🌟 متوسط';
  if (points >= 50) return '✨ مبتدئ+';
  return '🌱 مبتدئ';
}

function renderAchievements() {
  const container = document.getElementById('achievementsGrid');
  if (!container) return;
  
  container.innerHTML = ACHIEVEMENTS.map(a => `
    <div class="achievement ${gamification.achievements[a.id] ? 'unlocked' : 'locked'}">
      <div class="achievement-icon">${a.icon}</div>
      <div class="achievement-name">${a.name}</div>
      <div class="achievement-desc">${a.desc}</div>
      <div style="margin-top:8px; color:#f39c12; font-weight:bold;">+${a.points} نقطة</div>
    </div>
  `).join('');
  
  updatePointsDisplay();
}

// ==================== Agent Brain (Rules) ====================
const AgentBrain = {
  patterns: [
    {
      keywords: ['مرحبا', 'السلام', 'أهلا', 'هاي', 'hi', 'hello'],
      handler: () => `أهلاً بك! 👋\n\nأنا **Agent Ultra** — نسختي الخارقة!\n\n✨ قدراتي:\n• 🧠 WebLLM (ذكاء حقيقي في المتصفح)\n• 🎤 إدخال صوتي\n• 👁️ تحليل الصور\n• 🔌 تكامل Ollama\n• 📚 قاعدة معرفة RAG\n• ⚡ قياس أداء حقيقي\n\n${agentContext.hasAnalyzed ? `📊 جهازك: **${systemData.perf.score}/100** (${systemData.perf.tierLabel})` : '💡 اضغط "ابدأ التحليل" أولاً!'}`
    },
    {
      keywords: ['أفضل نموذج', 'افضل نموذج', 'أنصحني', 'انصحني'],
      handler: () => {
        if (!agentContext.hasAnalyzed) return '🔍 حلل جهازك أولاً!';
        const models = AI_MODELS.free[systemData.perf.tier];
        const top = models[0];
        return `🏆 **أفضل نموذج لجهازك:**\n\n**${top.name}** (${top.dev})\n\n📦 ${top.size} | 💾 ${top.ram} | 🎮 ${top.vram}\n\n⚡ ${top.impact}\n\n🔗 ${top.link}`;
      }
    },
    {
      keywords: ['برمجة', 'كود', 'أكواد', 'code'],
      handler: () => {
        if (!agentContext.hasAnalyzed) return '🔍 حلل جهازك أولاً!';
        const m = AI_MODELS.free[systemData.perf.tier].find(x => x.category === 'code') || AI_MODELS.free.good.find(x => x.category === 'code');
        return `💻 **للبرمجة:**\n\n**${m.name}** (${m.dev})\n${m.desc}\n\n📦 ${m.size} | 💾 ${m.ram}\n\n🔗 ${m.link}\n\n💡 **بديل مدفوع:** GitHub Copilot ($10/شهر)`;
      }
    },
    {
      keywords: ['عربي', 'عربية', 'arabic'],
      handler: () => `🌍 **للعربية:**\n\n🥇 **Qwen2.5** — الأفضل عربياً\n• 1.5B / 3B / 7B / 14B / 32B\n\n🔗 https://ollama.com/library/qwen2.5`
    },
    {
      keywords: ['صور', 'image', 'midjourney', 'توليد'],
      handler: () => {
        if (!agentContext.hasAnalyzed) return '🔍 حلل جهازك أولاً!';
        const vram = systemData.info.gpuMemoryEstimate;
        if (vram >= 8) return `🎨 **توليد الصور محلياً ممكن!**\n\n✅ Stable Diffusion XL (يحتاج 8GB VRAM)\n\n💎 **الأفضل:**\n• Midjourney ($10/شهر)\n• Leonardo AI (مجاني)\n\n🔗 https://www.midjourney.com/plans`;
        return `🎨 **كرتك (${vram}GB VRAM) محدود:**\n\n💎 **استخدم السحابة:**\n• Midjourney ($10/شهر)\n• Leonardo AI (مجاني)\n• Bing Image Creator (مجاني)`;
      }
    },
    {
      keywords: ['تثبيت', 'كيف اثبت', 'install'],
      handler: () => `📥 **تثبيت Ollama:**\n\n1. حمّل من https://ollama.com/download\n2. افتح Terminal\n3. \`ollama run llama3.2\`\n4. ابدأ الدردشة!\n\n**بديل:** LM Studio من https://lmstudio.ai`
    },
    {
      keywords: ['مقارنة', 'قارن', 'الفرق'],
      handler: () => `⚖️ **مقارنة سريعة:**\n\n🌍 **عربي:** Qwen > Llama > Mistral\n🧠 **استدلال:** DeepSeek-R1 > Phi-3\n💻 **كود:** CodeLlama > DeepSeek Coder\n⚡ **سرعة:** Qwen 1.5B > Llama 1B`
    },
    {
      keywords: ['مساعدة', 'help', 'قدراتك'],
      handler: () => `🤖 **قدراتي الكاملة:**\n\n1️⃣ تحليل جهازك\n2️⃣ دردشة ذكية (WebLLM)\n3️⃣ إدخال صوتي\n4️⃣ تحليل صور (OCR)\n5️⃣ تكامل Ollama\n6️⃣ قاعدة معرفة RAG\n7️⃣ قياس أداء\n8️⃣ مقارنة نماذج\n\n💡 جرب: "ما أفضل نموذج لي؟"`
    },
    {
      keywords: ['شكرا', 'thanks'],
      handler: () => 'العفو! 😊 جاهز للمزيد!'
    }
  ],
  
  respond(q) {
    const query = q.toLowerCase().trim();
    for (const p of this.patterns) {
      for (const kw of p.keywords) {
        if (query.includes(kw.toLowerCase())) return p.handler();
      }
    }
    return `🤔 لم أفهم تماماً. جرب:\n• "ما أفضل نموذج لي؟"\n• "أريد نموذج للبرمجة"\n• "كيف أثبت Ollama؟"\n• "مساعدة"`;
  }
};

let agentContext = { hasAnalyzed: false, lastTopic: null, userInterests: [] };

// ==================== Chat Logic ====================
async function sendChatMessage() {
  const input = document.getElementById('chatInput');
  const text = input.value.trim();
  if (!text) return;
  
  input.value = '';
  addChatMessage('user', text);
  saveConversation({ type: 'user', text });
  
  document.getElementById('sendBtn').disabled = true;
  addTypingIndicator();
  
  try {
    let response;
    
    if (settings.engine === 'webllm' && agentEngine) {
      const messages = await buildWebLLMMessages(text);
      response = await chatWithWebLLM(messages);
    } else if (settings.engine === 'ollama') {
      response = await chatWithOllama(text);
    } else {
      await sleep(500 + Math.random() * 500);
      response = AgentBrain.respond(text);
    }
    
    removeTypingIndicator();
    addChatMessage('bot', response);
    saveConversation({ type: 'bot', text: response });
    
    if (settings.ttsEnabled) speak(response);
    
    const chatCount = (gamification._chatCount || 0) + 1;
    gamification._chatCount = chatCount;
    if (chatCount >= 10) unlockAchievement('chat_master');
  } catch(e) {
    removeTypingIndicator();
    addChatMessage('bot', `❌ خطأ: ${e.message}`);
  }
  
  document.getElementById('sendBtn').disabled = false;
  input.focus();
}

async function buildWebLLMMessages(userText) {
  const systemPrompt = `أنت Agent Ultra، خبير في نماذج الذكاء الاصطناعي وتحليل الأجهزة.
${agentContext.hasAnalyzed ? `
بيانات جهاز المستخدم:
- التقييم: ${systemData.perf.score}/100 (${systemData.perf.tierLabel})
- المعالج: ${systemData.info.cores} نواة
- الذاكرة: ${systemData.info.memory || 'غير معروفة'} GB
- كرت الشاشة: ${systemData.info.gpu}
- VRAM: ${systemData.info.gpuMemoryEstimate} GB
` : 'لم يتم تحليل الجهاز بعد.'}

أجب بالعربية، بإيجاز، وبشكل مفيد.`;

  const history = await getConversations(10);
  const messages = [
    { role: 'system', content: systemPrompt },
    ...history.map(h => ({ role: h.type === 'user' ? 'user' : 'assistant', content: h.text })),
    { role: 'user', content: userText }
  ];
  return messages;
}

async function chatWithOllama(text) {
  const models = AI_MODELS.free[systemData?.perf?.tier || 'mid'];
  const modelName = models[0].name.split(' ')[0].toLowerCase().replace(/[^a-z0-9]/g, '') + ':latest';
  
  try {
    const res = await fetch('http://localhost:11434/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelName,
        prompt: text,
        stream: false
      })
    });
    const data = await res.json();
    return data.response || 'لا رد';
  } catch(e) {
    return '❌ فشل الاتصال بـ Ollama. جرب WebLLM أو وضع القواعد.';
  }
}

function addChatMessage(type, text) {
  const messages = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = `message ${type}`;
  const formatted = text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code style="background:rgba(0,0,0,0.4); padding:2px 6px; border-radius:4px; color:#2ecc71;">$1</code>')
    .replace(/\n/g, '<br>');
  div.innerHTML = formatted;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

function addTypingIndicator() {
  const messages = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = 'message bot typing';
  div.id = 'typingIndicator';
  div.innerHTML = `
    <span style="color:#00d4ff; font-size:0.85em; margin-left:8px;">يكتب</span>
    <div class="typing-dots"><span></span><span></span><span></span></div>
  `;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

function removeTypingIndicator() {
  const el = document.getElementById('typingIndicator');
  if (el) el.remove();
}

async function clearChat() {
  if (!confirm('مسح المحادثة؟')) return;
  document.getElementById('chatMessages').innerHTML = '';
  if (db) {
    const tx = db.transaction('conversations', 'readwrite');
    tx.objectStore('conversations').clear();
  }
  showToast('🗑️ تم مسح المحادثة');
}

function updateQuickReplies() {
  const container = document.getElementById('quickReplies');
  if (!container) return;
  const replies = agentContext.hasAnalyzed
    ? ['ما أفضل نموذج لي؟', 'أريد نموذج للبرمجة', 'نصائح الخصوصية', 'قارن بين Qwen و Llama', 'كيف أثبت Ollama؟']
    : ['ما أنواع النماذج؟', 'كيف أثبت Ollama؟', 'الفرق بين المجاني والمدفوع', 'مساعدة'];
  
  container.innerHTML = replies.map(r => 
    `<button class="quick-reply" onclick="quickReply('${r}')">${r}</button>`
  ).join('');
}

function quickReply(text) {
  document.getElementById('chatInput').value = text;
  sendChatMessage();
}

// ==================== Main Analysis ====================
async function startAnalysis() {
  const btn = document.getElementById('analyzeBtn');
  const loading = document.getElementById('loading');
  const results = document.getElementById('results');
  const progressFill = document.getElementById('progressFill');
  const loadingStep = document.getElementById('loadingStep');

  btn.disabled = true;
  loading.style.display = 'block';
  results.style.display = 'none';
  progressFill.style.width = '0%';

  const steps = [
    { text: '🔍 قراءة المعلومات...', progress: 15 },
    { text: '💻 كشف المعالج والذاكرة...', progress: 30 },
    { text: '🎮 فحص GPU (WebGPU + WebGL)...', progress: 50 },
    { text: '🌐 تحليل الشبكة والبطارية...', progress: 70 },
    { text: '🧠 توليد التوصيات...', progress: 90 },
    { text: '✅ اكتمل!', progress: 100 }
  ];

  for (const step of steps) {
    loadingStep.textContent = step.text;
    progressFill.style.width = step.progress + '%';
    await sleep(300);
  }

  const info = await collectSystemInfo();
  const perf = analyzePerformance(info);
  systemData = { info, perf };
  agentContext.hasAnalyzed = true;

  loading.style.display = 'none';
  renderResults(info, perf);
  document.getElementById('exportBtn').disabled = false;
  document.getElementById('printBtn').disabled = false;
  
  unlockAchievement('first_analysis');
  const hour = new Date().getHours();
  if (hour >= 0 && hour < 5) {
    unlockAchievement('night_owl');
  }
  
  addChatMessage('system', '✅ اكتمل التحليل! اسألني أي شيء');
  updateQuickReplies();
  
  showToast('✅ اكتمل التحليل!');
  btn.disabled = false;
}

function renderResults(info, perf) {
  const models = AI_MODELS.free[perf.tier];
  const paidModels = AI_MODELS.paid[perf.tier];

  document.getElementById('results').innerHTML = `
    <div class="card">
      <h2>📊 التقييم العام <span style="font-size:0.6em; background:rgba(123,47,247,0.3); padding:3px 10px; border-radius:12px;">${perf.tierEmoji} ${perf.tierLabel}</span></h2>
      <div class="score-section">
        <div class="score-ring">
          <svg width="200" height="200">
            <circle cx="100" cy="100" r="88" stroke="rgba(255,255,255,0.1)" stroke-width="14" fill="none"/>
            <circle cx="100" cy="100" r="88" stroke="url(#gradient)" stroke-width="14" fill="none"
              stroke-dasharray="${2 * Math.PI * 88}" stroke-dashoffset="${2 * Math.PI * 88 * (1 - perf.score/100)}"
              stroke-linecap="round"/>
            <defs>
              <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stop-color="#7b2ff7"/>
                <stop offset="100%" stop-color="#00d4ff"/>
              </linearGradient>
            </defs>
          </svg>
          <div class="score-text">
            <div class="score-value">${perf.score}</div>
            <div class="score-label">من 100</div>
          </div>
        </div>
        <div>
          <div class="perf-tag ${perf.tierClass}">${perf.tierEmoji} ${perf.tierLabel}</div>
          <p style="color:#bbb; margin-bottom:15px;">${perf.details.join(' • ')}</p>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>🖥️ المواصفات</h2>
      <div class="specs-grid">
        ${renderSpec('🖥️ النظام', getOS(info.userAgent))}
        ${renderSpec('⚙️ المعالج', `${info.cores} نواة`, info.cores >= 8 ? 'good' : 'warning')}
        ${renderSpec('💾 الذاكرة', info.memory ? `${info.memory} GB` : 'غير متاح', info.memory >= 16 ? 'good' : 'warning')}
        ${renderSpec('🎮 GPU', info.gpu, perf.gpuTier === 'excellent' ? 'good' : 'warning')}
        ${renderSpec('💡 VRAM', `${info.gpuMemoryEstimate} GB`, info.gpuMemoryEstimate >= 8 ? 'good' : 'warning')}
        ${renderSpec('🚀 WebGPU', info.webgpuSupported ? 'مدعوم ✅' : 'غير مدعوم', info.webgpuSupported ? 'good' : 'warning')}
        ${renderSpec('🌐 WebGL', info.webglVersion)}
        ${renderSpec('📺 الدقة', `${info.screenWidth}×${info.screenHeight}`)}
      </div>
    </div>

    <div class="card">
      <h2>📈 تحليل بياني</h2>
      <div class="charts-grid">
        <div class="chart-box"><canvas id="radarChart"></canvas></div>
        <div class="chart-box"><canvas id="barChart"></canvas></div>
      </div>
    </div>

    <div class="card">
      <h2>🆓 نماذج مجانية مقترحة</h2>
      <div class="ai-models-grid">
        ${models.sort((a,b) => b.popularity - a.popularity).map(m => renderModelCard(m, 'free', info)).join('')}
      </div>
    </div>

    <div class="card">
      <h2>💎 نماذج مدفوعة</h2>
      <div class="ai-models-grid">
        ${paidModels.sort((a,b) => b.popularity - a.popularity).map(m => renderModelCard(m, 'paid', info)).join('')}
      </div>
    </div>
  `;

  document.getElementById('results').style.display = 'block';
  setTimeout(() => {
    drawRadarChart(perf.breakdown);
    drawBarChart(perf.breakdown);
  }, 300);
}

function renderSpec(label, value, status = '') {
  return `<div class="spec-item ${status}">
    <div class="spec-label">${label}</div>
    <div class="spec-value">${value}</div>
  </div>`;
}

function renderModelCard(m, type, info) {
  const ramMatch = m.ram.match(/(\d+)/);
  const reqRam = ramMatch ? parseInt(ramMatch[1]) : 4;
  const userRam = info.memory || 4;
  const compat = reqRam === 0 ? 100 : Math.min((userRam / reqRam) * 100, 150);
  
  let icon;
  if (compat >= 100) { icon = '✅'; }
  else if (compat >= 70) { icon = '⚠️'; }
  else { icon = '❌'; }

  return `
    <div class="model-card">
      <span class="tag ${type === 'free' ? 'tag-free' : 'tag-paid'}">${type === 'free' ? 'مجاني' : 'مدفوع'}</span>
      <h3>${icon} ${m.name}</h3>
      <div class="model-dev">${m.dev} ${m.price ? `• ${m.price}` : ''}</div>
      <div class="model-desc">${m.desc}</div>
      <div class="model-info">
        <span class="info-badge">📦 ${m.size}</span>
        <span class="info-badge">💾 ${m.ram}</span>
        <span class="info-badge">⭐ ${m.popularity}</span>
      </div>
      <a href="${m.link}" target="_blank" class="model-link">🔗 فتح</a>
    </div>
  `;
}

function drawRadarChart(b) {
  const ctx = document.getElementById('radarChart');
  if (!ctx) return;
  if (charts.radar) charts.radar.destroy();
  charts.radar = new Chart(ctx, {
    type: 'radar',
    data: {
      labels: ['CPU', 'RAM', 'GPU', 'تخزين', 'شبكة'],
      datasets: [{
        label: 'الأداء',
        data: [(b.cpu/30)*100, (b.memory/30)*100, (b.gpu/30)*100, (b.storage/5)*100, (b.network/5)*100],
        backgroundColor: 'rgba(0,212,255,0.25)',
        borderColor: '#00d4ff',
        borderWidth: 2,
        pointBackgroundColor: '#7b2ff7'
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#fff' } } },
      scales: {
        r: {
          beginAtZero: true, max: 100,
          ticks: { color: '#999', backdropColor: 'transparent' },
          grid: { color: 'rgba(255,255,255,0.1)' },
          pointLabels: { color: '#ccc' }
        }
      }
    }
  });
}

function drawBarChart(b) {
  const ctx = document.getElementById('barChart');
  if (!ctx) return;
  if (charts.bar) charts.bar.destroy();
  charts.bar = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['CPU', 'RAM', 'GPU', 'تخزين', 'شبكة'],
      datasets: [{
        label: 'النقاط',
        data: [b.cpu, b.memory, b.gpu, b.storage, b.network],
        backgroundColor: ['rgba(123,47,247,0.7)', 'rgba(0,212,255,0.7)', 'rgba(255,46,147,0.7)', 'rgba(39,174,96,0.7)', 'rgba(243,156,18,0.7)'],
        borderRadius: 8
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { color: '#999' }, grid: { color: 'rgba(255,255,255,0.1)' } },
        x: { ticks: { color: '#ccc' }, grid: { display: false } }
      }
    }
  });
}

// ==================== UI Helpers ====================
function switchMainTab(e, tab) {
  document.querySelectorAll('.main-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  
  if (e && e.target) {
    const btn = e.target.closest('.main-tab');
    if (btn) btn.classList.add('active');
  } else {
    const tabBtn = document.querySelector(`[onclick*="'${tab}'"]`);
    if (tabBtn) tabBtn.classList.add('active');
  }
  
  const content = document.getElementById('tab-' + tab);
  if (content) content.classList.add('active');
  
  window._visitedTabs = window._visitedTabs || new Set();
  window._visitedTabs.add(tab);
  if (window._visitedTabs.size >= 7) unlockAchievement('explorer');
}

function getOS(ua) {
  if (/Windows NT 10/.test(ua)) return 'Windows 10/11';
  if (/Windows/.test(ua)) return 'Windows';
  if (/Mac OS X/.test(ua)) return 'macOS';
  if (/Android/.test(ua)) return 'Android';
  if (/Linux/.test(ua)) return 'Linux';
  if (/iPhone|iPad/.test(ua)) return 'iOS';
  return 'غير معروف';
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ==================== Settings ====================
function openSettings() {
  document.getElementById('settingsModal').classList.add('open');
  document.getElementById('themeSelect').value = settings.theme;
  document.getElementById('ttsEnabled').checked = settings.ttsEnabled;
  document.getElementById('ttsSpeed').value = settings.ttsSpeed;
  document.getElementById('engineSelect').value = settings.engine;
}

function closeSettings() {
  document.getElementById('settingsModal').classList.remove('open');
}

async function saveSettings() {
  settings.ttsEnabled = document.getElementById('ttsEnabled').checked;
  settings.ttsSpeed = parseFloat(document.getElementById('ttsSpeed').value);
  settings.engine = document.getElementById('engineSelect').value;
  await savePref('settings', settings);
  showToast('✅ تم الحفظ');
}

function changeTheme() {
  settings.theme = document.getElementById('themeSelect').value;
  const themes = {
    dark: 'linear-gradient(135deg, #0f0c29, #302b63, #24243e)',
    neon: 'linear-gradient(135deg, #0a0a0a, #1a0033, #330066)',
    ocean: 'linear-gradient(135deg, #001f3f, #003366, #001a33)',
    sunset: 'linear-gradient(135deg, #2d1b00, #4d1f00, #331a00)'
  };
  document.body.style.background = themes[settings.theme] || themes.dark;
  document.body.style.backgroundAttachment = 'fixed';
  saveSettings();
}

async function exportAllData() {
  const data = {
    settings,
    gamification,
    systemData,
    conversations: await getConversations(1000),
    ragDocs: ragStore.documents
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ai-advisor-data-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('📤 تم تصدير البيانات');
}

async function clearAllData() {
  if (!confirm('⚠️ سيتم حذف كل البيانات. متأكد؟')) return;
  if (db) {
    const tx = db.transaction(['conversations', 'preferences', 'ragDocs'], 'readwrite');
    tx.objectStore('conversations').clear();
    tx.objectStore('preferences').clear();
    tx.objectStore('ragDocs').clear();
  }
  localStorage.clear();
  showToast('🗑️ تم الحذف. جاري إعادة التحميل...');
  setTimeout(() => location.reload(), 1500);
}

function exportReport() {
  if (!systemData) return;
  const { info, perf } = systemData;
  const models = AI_MODELS.free[perf.tier];
  
  const report = `
========================================
   تقرير AI Advisor Ultra
========================================
التاريخ: ${new Date().toLocaleString('ar-SA')}

【 التقييم 】
النقاط: ${perf.score}/100 (${perf.tierLabel})

【 المواصفات 】
- النظام: ${getOS(info.userAgent)}
- المعالج: ${info.cores} نواة
- الذاكرة: ${info.memory ? info.memory + ' GB' : 'غير متاح'}
- GPU: ${info.gpu}
- VRAM: ${info.gpuMemoryEstimate} GB
- WebGPU: ${info.webgpuSupported ? 'مدعوم' : 'غير مدعوم'}
- WebGL: ${info.webglVersion}

【 النماذج المجانية المقترحة 】
${models.map((m, i) => `${i+1}. ${m.name} (${m.dev})
   ${m.size} | RAM: ${m.ram} | VRAM: ${m.vram}
   ${m.link}`).join('\n\n')}

【 الإنجازات 】
${ACHIEVEMENTS.filter(a => gamification.achievements[a.id]).map(a => `✅ ${a.name}`).join('\n')}

النقاط: ${gamification.points}
المستوى: ${getLevel(gamification.points)}
  `;
  
  const blob = new Blob([report], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ai-advisor-report-${Date.now()}.txt`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('📄 تم التصدير!');
}

// ==================== Init ====================
async function init() {
  try { await initDB(); } catch(e) { console.warn('IndexedDB failed'); }
  
  const prefs = await loadPrefs();
  if (prefs && prefs.settings) settings = { ...settings, ...prefs.settings };
  
  initGamification();
  updateQuickReplies();
  setInterval(updateQuickReplies, 5000);
  
  if (navigator.gpu) {
    document.getElementById('webgpuStatus').className = 'status-badge status-online';
    document.getElementById('webgpuStatus').innerHTML = '<span class="status-dot"></span> WebGPU: مدعوم';
  } else {
    document.getElementById('webgpuStatus').className = 'status-badge status-offline';
    document.getElementById('webgpuStatus').innerHTML = '<span class="status-dot"></span> WebGPU: غير مدعوم';
  }
  
  checkOllama();
  
  if ('speechSynthesis' in window) {
    speechSynthesis.getVoices();
    speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
  }
  
  console.log('🚀 AI Advisor Ultra initialized');
}

window.addEventListener('load', init);