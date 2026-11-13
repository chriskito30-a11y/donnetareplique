import type { Project, Recording } from './types';

const DB_NAME = 'atelier-repliques-local';
const DB_VERSION = 1;
let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (!('indexedDB' in window)) return Promise.reject(new Error('Le stockage local IndexedDB est indisponible.'));
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('recordings')) {
          const store = db.createObjectStore('recordings', { keyPath: 'id' });
          store.createIndex('projectId', 'projectId');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('Ouverture du stockage impossible.'));
      req.onblocked = () => reject(new Error('Fermez les autres onglets de l’application, puis réessayez.'));
    });
  }
  return dbPromise;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Erreur de stockage.'));
  });
}

export async function allProjects(): Promise<Project[]> {
  const db = await openDb();
  const projects = await request(db.transaction('projects').objectStore('projects').getAll() as IDBRequest<Project[]>);
  return projects.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

export async function getProject(id: string): Promise<Project | undefined> {
  const db = await openDb();
  return request(db.transaction('projects').objectStore('projects').get(id) as IDBRequest<Project | undefined>);
}

export async function putProject(project: Project): Promise<void> {
  const db = await openDb();
  project.updatedAt = Date.now();
  await request(db.transaction('projects', 'readwrite').objectStore('projects').put(project));
}

export async function deleteProject(id: string): Promise<void> {
  const db = await openDb();
  const records = await recordingsForProject(id);
  const tx = db.transaction(['projects', 'recordings'], 'readwrite');
  tx.objectStore('projects').delete(id);
  for (const record of records) tx.objectStore('recordings').delete(record.id);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Suppression impossible.'));
  });
}

export async function getRecording(projectId: string, lineId: string): Promise<Recording | undefined> {
  const db = await openDb();
  return request(db.transaction('recordings').objectStore('recordings').get(`${projectId}:${lineId}`) as IDBRequest<Recording | undefined>);
}

export async function recordingsForProject(projectId: string): Promise<Recording[]> {
  const db = await openDb();
  const store = db.transaction('recordings').objectStore('recordings');
  return request(store.index('projectId').getAll(projectId) as IDBRequest<Recording[]>);
}

export async function putRecording(recording: Recording): Promise<void> {
  const db = await openDb();
  await request(db.transaction('recordings', 'readwrite').objectStore('recordings').put(recording));
}

export async function deleteRecording(projectId: string, lineId: string): Promise<void> {
  const db = await openDb();
  await request(db.transaction('recordings', 'readwrite').objectStore('recordings').delete(`${projectId}:${lineId}`));
}
