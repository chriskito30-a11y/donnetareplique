export type PiperVoice = { id: string; label: string; model: 'siwis' | 'tom' | 'libritts'; speaker: number; language: string };

export const PIPER_VOICES: PiperVoice[] = [
  { id: 'piper:siwis:0', label: 'Siwis · français · féminin', model: 'siwis', speaker: 0, language: 'fr' },
  { id: 'piper:tom:0', label: 'Tom · français · masculin', model: 'tom', speaker: 0, language: 'fr' },
  ...[[14, 307], [16, 54], [17, 805], [22, 639], [28, 26], [30, 453]].map(([name, speaker]) => ({ id: `piper:libritts:${speaker}`, label: `LibriTTS US · locuteur ${name} · accent anglais`, model: 'libritts' as const, speaker, language: 'en' })),
];

export function defaultPiperVoice(index: number): string {
  return PIPER_VOICES[index % PIPER_VOICES.length].id;
}
