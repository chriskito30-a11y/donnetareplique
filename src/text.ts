import type { ScriptLine } from './types';

export interface TextPart { value: string; direction: boolean }

export function textParts(text: string): TextPart[] {
  const marker = /(\([^()]*\)|\[[^\[\]]*\]|\*[^*]+\*|_[^_]+_)/g;
  const result: TextPart[] = [];
  let start = 0;
  for (const match of text.matchAll(marker)) {
    const at = match.index;
    if (at > start) result.push({ value: text.slice(start, at), direction: false });
    result.push({ value: match[0].slice(1, -1), direction: true });
    start = at + match[0].length;
  }
  if (start < text.length) result.push({ value: text.slice(start), direction: false });
  return result;
}

export function speechText(line: ScriptLine, readDirections: boolean): string {
  if (line.kind === 'scene') return '';
  if (line.kind === 'direction' && !readDirections) return '';
  const parts = textParts(line.text);
  return parts.filter(part => readDirections || !part.direction)
    .map(part => part.value).join(' ').replace(/\s+/g, ' ').trim();
}
