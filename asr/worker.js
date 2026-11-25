// Розпізнавання мови (аудіоплеєр, з v223): Whisper small у браузері через transformers.js 3.8.1 (Apache-2.0).
// Бібліотека й onnxruntime-wasm лежать тут же (asr/); саму модель (~250 МБ) браузер раз бере з huggingface.co
// і тримає в кеші «transformers-cache» — далі працює без інтернету.
// Повідомлення: {id, cmd:'load'} → {type:'ready', dev}; {id, cmd:'run', audio: Float32Array 16 кГц моно} → {type:'done', text};
// під час завантаження моделі — {type:'load', p} (подія progress_callback); помилка — {type:'error', msg}.
import { pipeline, env } from './transformers.min.js';

env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm.wasmPaths = new URL('./', import.meta.url).href;   // не з CDN — з папки застосунку

// v224: дві моделі (вибір у ⚙): turbo — Whisper large-v3-turbo, стиснена (q4f16 ≈ 540 МБ; без shader-f16 — q4 ≈ 720 МБ);
// small — Whisper small (енкодер fp16 / fp32 + декодер q4 ≈ 390 МБ; без відеокарти — q8 ≈ 240 МБ)
const MODELS = {
  turbo: { id: 'onnx-community/whisper-large-v3-turbo',
    gpu: f16 => ({ encoder_model: f16 ? 'q4f16' : 'q4', decoder_model_merged: f16 ? 'q4f16' : 'q4' }),
    cpu: { encoder_model: 'q4', decoder_model_merged: 'q4' } },
  small: { id: 'onnx-community/whisper-small',
    gpu: f16 => ({ encoder_model: f16 ? 'fp16' : 'fp32', decoder_model_merged: 'q4' }),
    cpu: { encoder_model: 'q8', decoder_model_merged: 'q8' } },
};
let asr = null, dev = '', loading = null, cur = '';

async function load(name) {
  const M = MODELS[name] || MODELS.turbo;
  if (cur !== M.id) {                       // інша модель — стару звільнити
    if (loading) { try { await loading; } catch (e) {} }
    if (asr) { try { await asr.dispose(); } catch (e) {} }
    asr = null; loading = null; cur = M.id;
  }
  if (asr) return asr;
  if (loading) return loading;
  loading = (async () => {
    let gpu = false, f16 = false;
    try { const a = navigator.gpu && await navigator.gpu.requestAdapter(); gpu = !!a; f16 = !!(a && a.features.has('shader-f16')); } catch (e) {}
    const tries = [];
    if (gpu) tries.push({ device: 'webgpu', dtype: M.gpu(f16) });
    tries.push({ device: 'wasm', dtype: M.cpu });
    let last;
    for (const t of tries) {
      try {
        asr = await pipeline('automatic-speech-recognition', M.id, { ...t, progress_callback: p => postMessage({ type: 'load', p }) });
        dev = t.device; return asr;
      } catch (e) { last = e; console.warn('ASR', t.device, e); }
    }
    loading = null;
    throw last || new Error('модель не завантажилась');
  })();
  return loading;
}

self.onmessage = async e => {
  const { id, cmd, audio, model } = e.data;
  try {
    await load(model);
    if (cmd === 'load') return postMessage({ id, type: 'ready', dev });
    const r = await asr(audio, { language: 'ukrainian', task: 'transcribe', chunk_length_s: 30, stride_length_s: 4 });
    postMessage({ id, type: 'done', text: (Array.isArray(r) ? r.map(x => x.text).join(' ') : r.text) || '', dev });
  } catch (err) {
    postMessage({ id, type: 'error', msg: String((err && err.message) || err) });
  }
};
