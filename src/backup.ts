import JSZip from 'jszip';
import { allProjects, deleteProject, getProject, putProject, putRecording, recordingsForProject } from './db';
import { id, normalizeProject, type Project, type Recording } from './types';

const MAX_ARCHIVE = 250 * 1024 * 1024;

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function exportProject(project: Project): Promise<Blob> {
  const zip = new JSZip();
  const recordings = await recordingsForProject(project.id);
  const metadata = recordings.map(r => ({ lineId: r.lineId, mimeType: r.mimeType, createdAt: r.createdAt }));
  zip.file('project.json', JSON.stringify({ format: 'atelier-repliques', version: 1, project, recordings: metadata }));
  for (const recording of recordings) zip.file(`audio/${recording.lineId}.bin`, recording.blob);
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 4 } });
}

export async function importProject(file: File, replace = false): Promise<Project> {
  if (file.size > MAX_ARCHIVE) throw new Error('Archive trop volumineuse (limite : 250 Mo).');
  const zip = await JSZip.loadAsync(file, { checkCRC32: true });
  const entry = zip.file('project.json');
  if (!entry) throw new Error('Archive sans project.json.');
  const rawText = await entry.async('string');
  if (rawText.length > 15 * 1024 * 1024) throw new Error('Métadonnées trop volumineuses.');
  const raw = JSON.parse(rawText) as { format?: string; version?: number; project?: unknown; recordings?: unknown };
  if (raw.format !== 'atelier-repliques' || raw.version !== 1) throw new Error('Format de sauvegarde inconnu.');
  const project = normalizeProject(raw.project);
  if (!Array.isArray(raw.recordings) || raw.recordings.length > 100_000) throw new Error('Liste audio invalide.');
  const lineIds = new Set(project.lines.map(line => line.id));
  const newId = replace ? (raw.project as Project).id : id();
  if (typeof newId !== 'string') throw new Error('Identifiant de projet invalide.');
  project.id = newId;
  const records: Recording[] = [];
  let total = 0;
  for (const r of raw.recordings) {
    if (!r || typeof r !== 'object') throw new Error('Métadonnée audio invalide.');
    const meta = r as { lineId?: string; mimeType?: string; createdAt?: number };
    if (!meta.lineId || !lineIds.has(meta.lineId)) throw new Error('Audio lié à une réplique inconnue.');
    const audio = zip.file(`audio/${meta.lineId}.bin`);
    if (!audio) throw new Error('Audio manquant dans la sauvegarde.');
    const blob = await audio.async('blob');
    total += blob.size;
    if (total > MAX_ARCHIVE) throw new Error('Taille audio décompressée trop élevée.');
    records.push({ id: `${project.id}:${meta.lineId}`, projectId: project.id, lineId: meta.lineId,
      mimeType: typeof meta.mimeType === 'string' ? meta.mimeType : 'application/octet-stream',
      blob: new Blob([blob], { type: meta.mimeType || 'application/octet-stream' }),
      createdAt: Number(meta.createdAt) || Date.now() });
  }
  const existing = await getProject(project.id);
  if (existing && !replace) project.id = id();
  if (existing && replace) await deleteProject(project.id);
  for (const recording of records) { recording.id = `${project.id}:${recording.lineId}`; recording.projectId = project.id; }
  await putProject(project);
  for (const recording of records) await putRecording(recording);
  return project;
}

export async function exportAll(): Promise<Blob> {
  const projects = await allProjects();
  const zip = new JSZip();
  zip.file('index.json', JSON.stringify({ format: 'atelier-repliques-collection', version: 1, projects: projects.map(p => p.id) }));
  for (const project of projects) zip.file(`projects/${project.id}.zip`, await exportProject(project));
  return zip.generateAsync({ type: 'blob', compression: 'STORE' });
}
