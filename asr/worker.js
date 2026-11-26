// Розпізнавання мови (аудіоплеєр, з v223): Whisper small у браузері через transformers.js 3.8.1 (Apache-2.0).
// Бібліотека й onnxruntime-wasm лежать тут же (asr/); саму модель (~250 МБ) браузер раз бере з huggingface.co
// і тримає в кеші «transformers-cache» — далі працює без інтернету.
// Повідомлення: {id, cmd:'load'} → {type:'ready', dev}; {id, cmd:'run', audio: Float32Array 16 кГц моно} → {type:'done', text};
// під час завантаження моделі — {type:'load', p} (подія progress_callback); помилка — {type:'error', msg}.
import { pipeline, env, WhisperTextStreamer, Tensor, AutoModelForCTC } from './transformers.min.js';

env.allowLocalModels = false;
env.useBrowserCache = true;
env.backends.onnx.wasm.wasmPaths = new URL('./', import.meta.url).href;   // не з CDN — з папки застосунку

// v224: дві моделі (вибір у ⚙): turbo — Whisper large-v3-turbo, стиснена (q4f16 ≈ 540 МБ; без shader-f16 — q4 ≈ 720 МБ);
// small — Whisper small (енкодер fp16 / fp32 + декодер q4 ≈ 390 МБ; без відеокарти — q8 ≈ 240 МБ)
const MODELS = {
  turbo: { id: 'onnx-community/whisper-large-v3-turbo',
    gpu: f16 => ({ encoder_model: f16 ? 'q4f16' : 'q4', decoder_model_merged: f16 ? 'q4f16' : 'q4' }),
    cpu: { encoder_model: 'q4', decoder_model_merged: 'q4' } },
  // v225: найбільша — Whisper large-v3 (32 шари декодера), стиснена: q4f16 ≈ 930 МБ, без shader-f16 / без відеокарти — q4 ≈ 1,2 ГБ
  large: { id: 'onnx-community/whisper-large-v3-ONNX',
    gpu: f16 => ({ encoder_model: f16 ? 'q4f16' : 'q4', decoder_model_merged: f16 ? 'q4f16' : 'q4' }),
    cpu: { encoder_model: 'q4', decoder_model_merged: 'q4' } },
  small: { id: 'onnx-community/whisper-small',
    gpu: f16 => ({ encoder_model: f16 ? 'fp16' : 'fp32', decoder_model_merged: 'q4' }),
    cpu: { encoder_model: 'q8', decoder_model_merged: 'q8' }, cpuOk: true },
  // v231: «як чути» — wav2vec2-xlsr-53 для української (anton-l, Apache-2.0; ONNX — XDcobra), CTC: пише літерами почуте,
  // не знає мов і не перекладає; без розділових знаків і великих літер. fp16 ≈ 600 МБ (відеокарта), int8 ≈ 340 МБ (процесор).
  // tokenizer.json у пакеті немає — тому не pipeline: модель сама, а літери — зі словника vocab.json (жадібний CTC).
  ctc: { id: 'XDcobra/wav2vec2-large-xlsr-53-ukrainian-ONNX', ctc: true,
    gpu: f16 => (f16 ? 'fp16' : null), cpu: 'int8', cpuOk: true },
};
// vocab.json — через той самий кеш «transformers-cache», щоб працювало й без інтернету
async function hubJSON(id, file) {
  const url = env.allowLocalModels && !env.allowRemoteModels ? env.localModelPath + id + '/' + file : env.remoteHost.replace(/\/$/, '') + '/' + env.remotePathTemplate.replace('{model}', id).replace('{revision}', 'main') + file;
  let c = null; try { c = await caches.open('transformers-cache'); } catch (e) {}
  let r = c && await c.match(url);
  if (!r) { r = await fetch(url); if (!r.ok) throw new Error(file + ': ' + r.status); if (c) await c.put(url, r.clone()); }
  return r.json();
}
async function loadCtc(M, t) {
  const model = await AutoModelForCTC.from_pretrained(M.id, { device: t.device, dtype: t.dtype, progress_callback: p => postMessage({ type: 'load', p }) });
  const vocab = await hubJSON(M.id, 'vocab.json'), chars = [];
  for (const [k, v] of Object.entries(vocab)) chars[v] = k;
  return { ctc: true, model, chars, pad: vocab['[PAD]'], dispose: () => model.dispose() };
}
// звук (16 кГц) → літери: нормалізація як у Wav2Vec2FeatureExtractor, найімовірніша літера на кадр, повтори й [PAD] — геть, «|» — пробіл
async function runCtc(audio) {
  let m = 0; for (const v of audio) m += v; m /= audio.length || 1;
  let s = 0; for (const v of audio) s += (v - m) * (v - m); s = Math.sqrt(s / (audio.length || 1) + 1e-7);
  const x = new Float32Array(audio.length); for (let i = 0; i < x.length; i++) x[i] = (audio[i] - m) / s;
  const n = x.length;
  const o = await asr.model({ input_values: new Tensor('float32', x, [1, n]), attention_mask: new Tensor('int64', new BigInt64Array(n).fill(1n), [1, n]) });
  const lg = o.logits, [, T, V] = lg.dims, d = lg.data;
  let out = '', prev = -1;
  for (let t = 0; t < T; t++) {
    let b = 0, bv = -Infinity; for (let v = 0; v < V; v++) { const z = d[t * V + v]; if (z > bv) { bv = z; b = v; } }
    if (b !== prev && b !== asr.pad) { const ch = asr.chars[b] || ''; if (!/^\[|^<\/?s>$/.test(ch)) out += ch === '|' ? ' ' : ch; }
    prev = b;
  }
  try { lg.dispose && lg.dispose(); } catch (e) {}
  return out.replace(/\s+/g, ' ').trim();
}
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
    if (gpu && M.gpu(f16)) tries.push({ device: 'webgpu', dtype: M.gpu(f16) });
    // v228: великі моделі на процесорі працюють годинами (виглядало як вічні «0%») — для них лише відеокарта
    if (!gpu || M.cpuOk) tries.push({ device: 'wasm', dtype: M.cpu });
    if (!tries.length) throw new Error('потрібна відеокарта (WebGPU), а браузер її не дає — оберіть у ⚙ Whisper small');
    let last;
    for (const t of tries) {
      try {
        asr = M.ctc ? await loadCtc(M, t) : await pipeline('automatic-speech-recognition', M.id, { ...t, progress_callback: p => postMessage({ type: 'load', p }) });
        dev = t.device; return asr;
      } catch (e) { last = e; console.warn('ASR', t.device, e); }
    }
    loading = null;
    const m = String((last && last.message) || last || '');
    throw new Error(/memory|alloc|OOM|buffer/i.test(m) ? 'планшету забракло пам\'яті для цієї моделі — оберіть у ⚙ меншу (' + m.slice(0, 80) + ')' : (m || 'модель не завантажилась'));
  })();
  return loading;
}

// v230: писати як чути, без перекладу. Якщо мову не задати, transformers.js ставить англійську, а з «ukrainian»
// Whisper перекладав російську мову на українську. Тому на кожен шматок (≤ 30 с): енкодер — один раз, далі модель
// одним токеном каже мову (після <|startoftranscript|>), і текст пишеться тією мовою (російська — російською,
// українська й суржик — як українська; інші — як українська). Не вийшло — далі як раніше, лише українська.
let plainOnly = false;
async function asIs(audio, streamer) {
  const M = asr.model, gc = M.generation_config;
  const { input_features } = await asr.processor(audio);
  const mi = await M._prepare_encoder_decoder_kwargs_for_generation({ inputs_tensor: input_features, model_inputs: { input_features }, model_input_name: 'input_features', generation_config: gc });
  const enc = mi.encoder_outputs;
  // мова — з виходу декодера одразу після <|startoftranscript|>: що ймовірніше, <|ru|> чи <|uk|>
  // (generate тут не годиться — його фільтри замість мови дають службовий токен)
  const o = await M({ input_features, encoder_outputs: enc, decoder_input_ids: new Tensor('int64', BigInt64Array.from([BigInt(gc.decoder_start_token_id)]), [1, 1]) });
  const lg = o.logits.data, V = o.logits.dims.at(-1), base = lg.length - V;
  const lang = lg[base + gc.lang_to_id['<|ru|>']] > lg[base + gc.lang_to_id['<|uk|>']] ? 'russian' : 'ukrainian';
  try { for (const k in o) if (k !== 'logits' && o[k] && o[k].dispose) o[k].dispose(); if (o.past_key_values) for (const t of Object.values(o.past_key_values)) t && t.dispose && t.dispose(); } catch (e) {}
  const out = await M.generate({ inputs: input_features, encoder_outputs: enc, language: lang, task: 'transcribe', streamer });
  const text = asr.tokenizer.batch_decode(out.sequences || out, { skip_special_tokens: true })[0] || '';
  return { text, lang };
}

// v229: завдання — строго по черзі (раніше нове розпізнавання йшло паралельно з незакінченим і вішало відеокарту)
let chain = Promise.resolve();
self.onmessage = e => { chain = chain.then(() => handle(e.data)); };
async function handle({ id, cmd, audio, model, mode }) {
  try {
    await load(model);
    if (cmd === 'load') return postMessage({ id, type: 'ready', dev });
    if (asr.ctc) { const text = await runCtc(audio); postMessage({ id, type: 'tok', t: text }); return postMessage({ id, type: 'done', text, lang: '', dev }); }
    // v228: слова — одразу, як модель їх видає (видно, що робота йде)
    const streamer = new WhisperTextStreamer(asr.tokenizer, { skip_prompt: true, callback_function: t => postMessage({ id, type: 'tok', t }) });
    let text = null, lang = 'ukrainian';
    if (!plainOnly && mode !== 'uk') {   // mode 'uk' (⚙ «завжди українською») — як раніше
      try { ({ text, lang } = await asIs(audio, streamer)); }
      catch (err) { console.warn('ASR: визначення мови не вдалося, далі — лише українська', err); plainOnly = true; }
    }
    if (text == null) {
      const r = await asr(audio, { language: 'ukrainian', task: 'transcribe', chunk_length_s: 30, stride_length_s: 4, streamer });
      text = (Array.isArray(r) ? r.map(x => x.text).join(' ') : r.text) || '';
    }
    postMessage({ id, type: 'done', text, lang, dev });
  } catch (err) {
    postMessage({ id, type: 'error', msg: String((err && err.message) || err) });
  }
}
