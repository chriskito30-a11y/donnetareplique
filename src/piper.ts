import * as ort from 'onnxruntime-web/wasm';

type PhonemeResult = { phoneme_ids: number[] };
type Phonemizer = { callMain(args: string[]): number };
type PiperFactory = (options: {
  print(line: string): void;
  printErr(line: string): void;
  locateFile(name: string): string;
}) => Promise<Phonemizer>;
type ModelConfig = {
  audio: { sample_rate: number };
  espeak: { voice: string };
  inference: { noise_scale: number; length_scale: number; noise_w: number };
  num_speakers: number;
};

declare global { interface Window { createPiperPhonemize?: PiperFactory } }

const local = (file: string) => new URL(`tts/${file}`, document.baseURI).href;
type ModelId = 'siwis' | 'tom' | 'libritts';
const models: Record<ModelId, string> = { siwis: 'fr_FR-siwis-medium', tom: 'fr_FR-tom-medium', libritts: 'en_US-libritts_r-medium' };
const sessions = new Map<ModelId, Promise<{ session: ort.InferenceSession; config: ModelConfig }>>();
let phonemizerPromise: Promise<Phonemizer> | null = null;
let output: PhonemeResult[] = [];

async function loadPhonemizer(): Promise<Phonemizer> {
  if (!window.createPiperPhonemize) {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = local('piper_phonemize.js');
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Phonétiseur local indisponible.'));
      document.head.append(script);
    });
  }
  if (!window.createPiperPhonemize) throw new Error('Phonétiseur local non initialisé.');
  return window.createPiperPhonemize({
    locateFile: local,
    print: line => { try { output.push(JSON.parse(line) as PhonemeResult); } catch { /* diagnostic non JSON */ } },
    printErr: line => console.warn('Piper phonétiseur :', line),
  });
}

async function phonemizer() {
  if (!phonemizerPromise) phonemizerPromise = loadPhonemizer();
  return phonemizerPromise;
}

async function engine(model: ModelId) {
  if (!sessions.has(model)) sessions.set(model, (async () => {
    ort.env.wasm.numThreads = 1; // Compatible sans SharedArrayBuffer sur mobile.
    ort.env.wasm.wasmPaths = new URL('tts/', document.baseURI).href;
    const filename = models[model];
    const [modelResponse, configResponse] = await Promise.all([fetch(local(`${filename}.onnx`)), fetch(local(`${filename}.onnx.json`))]);
    if (!modelResponse.ok || !configResponse.ok) throw new Error('Modèle français local indisponible.');
    const config = await configResponse.json() as ModelConfig;
    const session = await ort.InferenceSession.create(await modelResponse.arrayBuffer(), { executionProviders: ['wasm'] });
    return { session, config };
  })().catch(error => { sessions.delete(model); throw error; }));
  return sessions.get(model)!;
}

function wav(pcm: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buffer);
  const ascii = (offset: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
  ascii(0, 'RIFF'); view.setUint32(4, 36 + pcm.length * 2, true);
  ascii(8, 'WAVE'); ascii(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, 'data'); view.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, pcm[i])) * 32767), true);
  return new Blob([buffer], { type: 'audio/wav' });
}

function chunks(text: string): string[] {
  const sentences = text.match(/[^.!?;]+[.!?;]?/g) ?? [text];
  const result: string[] = [];
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;
    if (trimmed.length <= 250) result.push(trimmed);
    else for (let at = 0; at < trimmed.length; at += 250) result.push(trimmed.slice(at, at + 250));
  }
  return result;
}

export async function synthesizePiper(text: string, voiceURI: string, rate: number): Promise<Blob> {
  const [, model, rawId] = voiceURI.match(/^piper:(siwis|tom|libritts):(\d+)$/) ?? [];
  if (!model || !rawId) throw new Error('Voix Piper invalide.');
  const speakerId = Number(rawId);
  const pid = model as ModelId;
  const [{ session, config }, ph] = await Promise.all([engine(pid), phonemizer()]);
  if (speakerId >= config.num_speakers) throw new Error('Locuteur absent du modèle Piper.');
  const audio: Float32Array[] = [];
  const gap = new Float32Array(Math.round(config.audio.sample_rate * 0.15));
  for (const part of chunks(text)) {
    output = [];
    const status = ph.callMain(['--espeak_data', '/espeak-ng-data', '--language', config.espeak.voice, '--input', JSON.stringify([{ text: part }])]);
    if (status !== 0 || !output.length) throw new Error('Phonétisation locale impossible.');
    for (const item of output) {
      const ids = item.phoneme_ids;
      if (!ids?.length) continue;
      const feeds = {
        input: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
        input_lengths: new ort.Tensor('int64', BigInt64Array.of(BigInt(ids.length)), [1]),
        scales: new ort.Tensor('float32', Float32Array.of(config.inference.noise_scale, config.inference.length_scale / rate, config.inference.noise_w), [3]),
        ...(config.num_speakers > 1 ? { sid: new ort.Tensor('int64', BigInt64Array.of(BigInt(speakerId)), [1]) } : {}),
      };
      const result = await session.run(feeds);
      const pcm = result.output?.data;
      if (!(pcm instanceof Float32Array)) throw new Error('Audio local invalide.');
      audio.push(pcm, gap);
    }
  }
  if (!audio.length) throw new Error('Aucun son produit.');
  const total = audio.reduce((sum, part) => sum + part.length, 0);
  const merged = new Float32Array(total);
  let offset = 0;
  for (const part of audio) { merged.set(part, offset); offset += part.length; }
  return wav(merged, config.audio.sample_rate);
}
