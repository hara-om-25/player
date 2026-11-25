// Розпізнавання мови (аудіоплеєр, з v223): Whisper small у браузері через transformers.js 3.8.1 (Apache-2.0).
// Бібліотека й onnxruntime-wasm лежать тут же (asr/); саму модель (~250 МБ) браузер раз бере з huggingface.co
// і тримає в кеші «transformers-cache» — далі працює без інтернету.
// Повідомлення: {id, cmd:'load'} → {type:'ready', dev}; {id, cmd:'run', audio: Float32Array 16 кГц моно} → {type:'done', text};
// під час завантаження моделі — {type:'load', p} (подія progress_callback); помилка — {type:'error', msg}.
import { pipeline, env } from './transformers.min.js';

env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm.wasmPaths = new URL('./', import.meta.url).href;   // не з CDN — з папки застосунку

const MODEL = 'onnx-community/whisper-small';
let asr = null, dev = '', loading = null;

async function load() {
  if (asr) return asr;
  if (loading) return loading;
  loading = (async () => {
    let gpu = false, f16 = false;
    try { const a = navigator.gpu && await navigator.gpu.requestAdapter(); gpu = !!a; f16 = !!(a && a.features.has('shader-f16')); } catch (e) {}
    const tries = [];
    if (gpu) tries.push({ device: 'webgpu', dtype: { encoder_model: f16 ? 'fp16' : 'fp32', decoder_model_merged: 'q4' } });
    tries.push({ device: 'wasm', dtype: { encoder_model: 'q8', decoder_model_merged: 'q8' } });
    let last;
    for (const t of tries) {
      try {
        asr = await pipeline('automatic-speech-recognition', MODEL, { ...t, progress_callback: p => postMessage({ type: 'load', p }) });
        dev = t.device; return asr;
      } catch (e) { last = e; console.warn('ASR', t.device, e); }
    }
    loading = null;
    throw last || new Error('модель не завантажилась');
  })();
  return loading;
}

self.onmessage = async e => {
  const { id, cmd, audio } = e.data;
  try {
    await load();
    if (cmd === 'load') return postMessage({ id, type: 'ready', dev });
    const r = await asr(audio, { language: 'ukrainian', task: 'transcribe', chunk_length_s: 30, stride_length_s: 4 });
    postMessage({ id, type: 'done', text: (Array.isArray(r) ? r.map(x => x.text).join(' ') : r.text) || '', dev });
  } catch (err) {
    postMessage({ id, type: 'error', msg: String((err && err.message) || err) });
  }
};
