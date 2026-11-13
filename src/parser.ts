import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import mammothUrl from 'mammoth/mammoth.browser.js?url';
import { id, newProject, type Character, type Project, type ScriptLine } from './types';
import { defaultPiperVoice } from './voices';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const COLORS = ['#396d78', '#8f5c7b', '#8c6840', '#657647', '#745f9d', '#a1534d'];
type MammothApi = {
  extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string }>;
  convertToHtml(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string }>;
};
let mammothPromise: Promise<MammothApi> | null = null;

function mammothBrowser() {
  if (!mammothPromise) mammothPromise = new Promise((resolve, reject) => {
    const existing = (window as Window & { mammoth?: MammothApi }).mammoth;
    if (existing) return resolve(existing);
    const script = document.createElement('script');
    script.src = mammothUrl;
    script.onload = () => {
      const api = (window as Window & { mammoth?: MammothApi }).mammoth;
      api ? resolve(api) : reject(new Error('Le lecteur DOCX n’a pas démarré.'));
    };
    script.onerror = () => reject(new Error('Le lecteur DOCX n’a pas pu être chargé depuis le cache local.'));
    document.head.append(script);
  });
  return mammothPromise;
}

export async function textFromFile(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (file.size > 30 * 1024 * 1024) throw new Error('Fichier trop volumineux (limite : 30 Mo).');
  if (name.endsWith('.txt') || file.type.startsWith('text/')) {
    return (await file.text()).replace(/^\uFEFF/, '');
  }
  if (name.endsWith('.docx')) {
    const mammoth = await mammothBrowser();
    const buffer = await file.arrayBuffer();
    const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
    const documentHtml = new DOMParser().parseFromString(result.value, 'text/html');
    const inlineText = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
      if (!(node instanceof Element)) return '';
      if (node.tagName === 'BR') return '\n';
      const content = [...node.childNodes].map(inlineText).join('');
      return node.matches('em,i') ? `*${content}*` : content;
    };
    const paragraphs = [...documentHtml.body.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li')]
      .map(node => inlineText(node).trim()).filter(Boolean);
    return paragraphs.length ? paragraphs.join('\n') : (await mammoth.extractRawText({ arrayBuffer: buffer })).value;
  }
  if (name.endsWith('.pdf')) {
    const data = new Uint8Array(await file.arrayBuffer());
    const task = getDocument({ data });
    const pdf = await task.promise;
    const pages: string[] = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      let previousY: number | undefined;
      let previousItalic = false;
      const parts: string[] = [];
      for (const item of content.items) {
        if (!('str' in item)) continue;
        const y = item.transform[5];
        const font = `${item.fontName} ${content.styles[item.fontName]?.fontFamily ?? ''}`;
        const italic = /italic|oblique/i.test(font);
        if (previousY !== undefined && Math.abs(y - previousY) > 3) {
          if (previousItalic) parts.push('*');
          parts.push('\n');
          previousItalic = false;
        } else if (parts.length && !parts[parts.length - 1].endsWith('\n')) parts.push(' ');
        if (italic !== previousItalic) parts.push('*');
        parts.push(item.str);
        previousItalic = italic;
        previousY = y;
      }
      if (previousItalic) parts.push('*');
      pages.push(parts.join(''));
      page.cleanup();
    }
    await task.destroy();
    const text = pages.join('\n\n');
    if (!text.trim()) throw new Error('Ce PDF ne contient pas de texte sélectionnable. Un scan demande un OCR.');
    return text;
  }
  throw new Error('Format non pris en charge. Choisissez TXT, PDF textuel ou DOCX.');
}

function isScene(value: string): boolean {
  return /^(?:acte|scène|scene|act)\b[\s.:\dIVX-]*/i.test(value) || /^(?:int\.|ext\.)\s/i.test(value);
}

function isUppercaseName(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 35 || /\d/.test(trimmed) || isScene(trimmed)) return false;
  if (/[.!?;:()\[\]]/.test(trimmed)) return false;
  return /[A-ZÀ-ÖØ-Þ]/.test(trimmed) && trimmed === trimmed.toLocaleUpperCase();
}

export function parseScript(text: string, title: string): Project {
  const project = newProject(title || 'Texte sans titre');
  const byName = new Map<string, Character>();
  const addCharacter = (name: string): Character => {
    const normalized = name.trim().replace(/\s+/g, ' ');
    const key = normalized.toLocaleLowerCase();
    let character = byName.get(key);
    if (!character) {
      character = { id: id(), name: normalized, color: COLORS[byName.size % COLORS.length], voiceURI: defaultPiperVoice(byName.size) };
      byName.set(key, character);
      project.characters.push(character);
    }
    return character;
  };
  const addLine = (kind: ScriptLine['kind'], value: string, characterId: string | null = null): ScriptLine | null => {
    const line = value.trim();
    if (!line) return null;
    const added = { id: id(), kind, characterId, text: line };
    project.lines.push(added);
    return added;
  };

  const rows = text.replace(/\r\n?/g, '\n').split('\n');
  let current: Character | null = null;
  let lastDialogue: ScriptLine | null = null;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i].trim();
    if (!row) { current = null; lastDialogue = null; continue; }
    if (isScene(row)) { addLine('scene', row); current = null; lastDialogue = null; continue; }
    if (/^(?:personnages|distribution|dramatis personae)\s*:/i.test(row)) {
      addLine('direction', row); current = null; lastDialogue = null; continue;
    }
    const colon = row.match(/^([\p{L}][\p{L}\p{M}'’ .-]{0,34})\s*:\s*(.+)$/u);
    if (colon && !isScene(colon[1])) {
      current = addCharacter(colon[1]);
      lastDialogue = addLine('dialogue', colon[2], current.id);
      continue;
    }
    if (isUppercaseName(row) && rows.slice(i + 1).find(next => next.trim()) !== undefined) {
      current = addCharacter(row);
      lastDialogue = null;
      continue;
    }
    if (/^\([^()]+\)$|^\[[^\[\]]+\]$|^\*[^*]+\*$|^_[^_]+_$/.test(row)) {
      addLine('direction', row); lastDialogue = null; continue;
    }
    if (lastDialogue && lastDialogue.characterId === (current?.id ?? null)) {
      lastDialogue.text += ` ${row}`;
    } else {
      lastDialogue = addLine('dialogue', row, current?.id ?? null);
    }
  }
  project.currentLineId = project.lines[0]?.id ?? null;
  return project;
}

export function exportText(project: Project): string {
  const names = new Map(project.characters.map(c => [c.id, c.name]));
  return project.lines.map(line => {
    if (line.kind === 'scene') return `\n${line.text}\n`;
    if (line.kind === 'direction') return `(${line.text.replace(/^\(|\)$/g, '')})`;
    const name = line.characterId ? names.get(line.characterId) : null;
    return name ? `${name} : ${line.text}` : line.text;
  }).join('\n');
}
