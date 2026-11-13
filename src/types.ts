export type LineKind = 'dialogue' | 'direction' | 'scene';
export type DisplayMode = 'full' | 'hidden' | 'initials' | 'progressive';
export type WaitMode = 'manual' | 'delay' | 'none';

export interface Character {
  id: string;
  name: string;
  color: string;
  voiceURI: string;
}

export interface ScriptLine {
  id: string;
  kind: LineKind;
  characterId: string | null;
  text: string;
}

export interface Marker {
  id: string;
  lineId: string;
  label: string;
}

export interface ProjectSettings {
  displayMode: DisplayMode;
  waitMode: WaitMode;
  waitMs: number;
  rate: number;
  loop: boolean;
  speakMine: boolean;
  speakDirections: boolean;
  useRecordings: boolean;
  autoSkipToCue: boolean;
}

export interface Project {
  id: string;
  title: string;
  language: string;
  createdAt: number;
  updatedAt: number;
  lastOpenedAt: number;
  selectedRoleId: string | null;
  characters: Character[];
  lines: ScriptLine[];
  markers: Marker[];
  currentLineId: string | null;
  rangeStartId: string | null;
  rangeEndId: string | null;
  settings: ProjectSettings;
}

export interface Recording {
  id: string;
  projectId: string;
  lineId: string;
  mimeType: string;
  blob: Blob;
  createdAt: number;
}

export const DEFAULT_SETTINGS: ProjectSettings = {
  displayMode: 'full',
  waitMode: 'manual',
  waitMs: 1500,
  rate: 1,
  loop: false,
  speakMine: false,
  speakDirections: false,
  useRecordings: true,
  autoSkipToCue: false,
};

export function id(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  const data = crypto.getRandomValues(new Uint8Array(16));
  return [...data].map(x => x.toString(16).padStart(2, '0')).join('');
}

export function newProject(title = 'Nouveau texte'): Project {
  const now = Date.now();
  return {
    id: id(), title, language: 'fr-FR', createdAt: now, updatedAt: now,
    lastOpenedAt: now, selectedRoleId: null, characters: [], lines: [], markers: [],
    currentLineId: null, rangeStartId: null, rangeEndId: null,
    settings: { ...DEFAULT_SETTINGS },
  };
}

export function cloneProject(project: Project): Project {
  return structuredClone(project);
}

export function normalizeProject(raw: unknown): Project {
  if (!raw || typeof raw !== 'object') throw new Error('Projet invalide.');
  const p = raw as Partial<Project>;
  if (typeof p.title !== 'string' || !Array.isArray(p.lines) || !Array.isArray(p.characters)) {
    throw new Error('Structure du projet invalide.');
  }
  if (p.lines.length > 100_000 || p.characters.length > 2_000) throw new Error('Projet trop volumineux.');
  if (!p.lines.every(line => line && typeof line === 'object') || !p.characters.every(character => character && typeof character === 'object')) {
    throw new Error('Répliques ou personnages invalides.');
  }
  const result = newProject(p.title.slice(0, 200));
  result.language = typeof p.language === 'string' ? p.language.slice(0, 35) : 'fr-FR';
  result.characters = p.characters.map(c => ({
    id: typeof c.id === 'string' ? c.id : id(),
    name: String(c.name ?? '').slice(0, 100),
    color: /^#[0-9a-fA-F]{6}$/.test(c.color ?? '') ? c.color : '#506b7b',
    voiceURI: typeof c.voiceURI === 'string' ? c.voiceURI.slice(0, 300) : '',
  }));
  const characterIds = new Set(result.characters.map(c => c.id));
  result.lines = p.lines.map(line => ({
    id: typeof line.id === 'string' ? line.id : id(),
    kind: line.kind === 'direction' || line.kind === 'scene' ? line.kind : 'dialogue',
    characterId: typeof line.characterId === 'string' && characterIds.has(line.characterId) ? line.characterId : null,
    text: String(line.text ?? '').slice(0, 50_000),
  }));
  const lineIds = new Set(result.lines.map(line => line.id));
  result.markers = Array.isArray(p.markers) ? p.markers.filter(m => m && typeof m === 'object' && lineIds.has(m.lineId)).map(m => ({
    id: typeof m.id === 'string' ? m.id : id(), lineId: m.lineId, label: String(m.label ?? '').slice(0, 100),
  })) : [];
  result.selectedRoleId = typeof p.selectedRoleId === 'string' && characterIds.has(p.selectedRoleId) ? p.selectedRoleId : null;
  result.currentLineId = typeof p.currentLineId === 'string' && lineIds.has(p.currentLineId) ? p.currentLineId : result.lines[0]?.id ?? null;
  result.rangeStartId = typeof p.rangeStartId === 'string' && lineIds.has(p.rangeStartId) ? p.rangeStartId : null;
  result.rangeEndId = typeof p.rangeEndId === 'string' && lineIds.has(p.rangeEndId) ? p.rangeEndId : null;
  const s = p.settings;
  if (s && typeof s === 'object') {
    result.settings = {
      ...DEFAULT_SETTINGS,
      displayMode: ['full', 'hidden', 'initials', 'progressive'].includes(s.displayMode) ? s.displayMode : 'full',
      waitMode: ['manual', 'delay', 'none'].includes(s.waitMode) ? s.waitMode : 'manual',
      waitMs: Math.min(20_000, Math.max(0, Number(s.waitMs) || 0)),
      rate: Math.min(2, Math.max(0.5, Number(s.rate) || 1)),
      loop: Boolean(s.loop), speakMine: Boolean(s.speakMine),
      speakDirections: Boolean(s.speakDirections), useRecordings: s.useRecordings !== false,
      autoSkipToCue: Boolean(s.autoSkipToCue),
    };
  }
  return result;
}
