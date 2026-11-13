import { synthesizePiper } from './piper';
import { PIPER_VOICES } from './voices';

export function localVoices(): SpeechSynthesisVoice[] {
  if (!('speechSynthesis' in window)) return [];
  return speechSynthesis.getVoices().filter(voice => voice.localService === true);
}

export class AudioEngine {
  private audio: HTMLAudioElement | null = null;
  private url: string | null = null;
  private finish: (() => void) | null = null;
  private generation = 0;

  stop(): void {
    this.generation++;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    this.audio?.pause();
    this.audio = null;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    this.finish?.();
    this.finish = null;
  }

  async playBlob(blob: Blob): Promise<boolean> {
    this.stop();
    const token = this.generation;
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    this.url = url;
    this.audio = audio;
    return new Promise(resolve => {
      const end = (success: boolean) => {
        if (token !== this.generation) return resolve(false);
        this.finish = null;
        this.audio = null;
        URL.revokeObjectURL(url);
        this.url = null;
        resolve(success);
      };
      this.finish = () => resolve(false);
      audio.onended = () => end(true);
      audio.onerror = () => end(false);
      audio.play().catch(() => end(false));
    });
  }

  async speak(text: string, voiceURI: string, language: string, rate: number): Promise<boolean> {
    this.stop();
    if (voiceURI.startsWith('piper:')) {
      const token = this.generation;
      try {
        const selected = PIPER_VOICES.find(voice => voice.id === voiceURI) ?? PIPER_VOICES[Number(voiceURI.slice(6)) % PIPER_VOICES.length];
        const blob = await synthesizePiper(text, selected.id, rate);
        if (token !== this.generation) return false;
        return this.playBlob(blob);
      } catch (error) {
        console.warn('Voix Piper locale indisponible :', error);
        return false;
      }
    }
    const voices = localVoices();
    if (!voices.length) return false;
    const voice = voices.find(v => v.voiceURI === voiceURI) ?? voices.find(v => v.lang.toLowerCase().startsWith(language.slice(0, 2).toLowerCase())) ?? voices[0];
    const token = this.generation;
    return new Promise(resolve => {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = voice;
      utterance.lang = voice.lang;
      utterance.rate = rate;
      let done = false;
      const finish = (success: boolean) => {
        if (done) return;
        done = true;
        clearTimeout(watchdog);
        if (token === this.generation) this.finish = null;
        resolve(success && token === this.generation);
      };
      const watchdog = setTimeout(() => { speechSynthesis.cancel(); finish(false); }, Math.max(15_000, text.length * 500));
      this.finish = () => finish(false);
      utterance.onend = () => finish(true);
      utterance.onerror = () => finish(false);
      try { speechSynthesis.speak(utterance); } catch { finish(false); }
    });
  }
}

export interface RecorderHandle {
  mimeType: string;
  stop(): Promise<Blob>;
  cancel(): void;
}

export async function startRecording(): Promise<RecorderHandle> {
  if (!navigator.mediaDevices?.getUserMedia || !('MediaRecorder' in window)) {
    throw new Error('Enregistrement indisponible dans ce navigateur. Importez un fichier audio.');
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const formats = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'];
  const mimeType = formats.find(type => MediaRecorder.isTypeSupported(type));
  let recorder: MediaRecorder;
  try { recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined); }
  catch (error) { stream.getTracks().forEach(t => t.stop()); throw error; }
  const chunks: BlobPart[] = [];
  recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
  recorder.start();
  return {
    mimeType: recorder.mimeType || mimeType || 'audio/webm',
    stop: () => new Promise((resolve, reject) => {
      if (recorder.state === 'inactive') return reject(new Error('Enregistrement déjà terminé.'));
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' });
        blob.size ? resolve(blob) : reject(new Error('Aucun son enregistré.'));
      };
      recorder.onerror = () => { stream.getTracks().forEach(t => t.stop()); reject(new Error('Erreur du microphone.')); };
      recorder.stop();
    }),
    cancel: () => { if (recorder.state !== 'inactive') recorder.stop(); stream.getTracks().forEach(t => t.stop()); },
  };
}
