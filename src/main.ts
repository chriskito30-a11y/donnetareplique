import './styles.css';
import { AudioEngine, localVoices, startRecording, type RecorderHandle } from './audio';
import { PIPER_VOICES, defaultPiperVoice } from './voices';
import { downloadBlob, exportProject, importProject } from './backup';
import { allProjects, deleteProject, deleteRecording, getProject, getRecording, putProject, putRecording, recordingsForProject } from './db';
import { exportText, parseScript, textFromFile } from './parser';
import { speechText, textParts } from './text';
import { cloneProject, id, newProject, type Character, type DisplayMode, type Project, type ScriptLine } from './types';

type Screen = 'library' | 'import' | 'editor' | 'rehearse' | 'settings';
const app = document.querySelector<HTMLDivElement>('#app')!;
const audio = new AudioEngine();
let screen: Screen = 'library';
let projects: Project[] = [];
let project: Project | null = null;
let draft: Project | null = null;
let editorPage = 0;
let librarySearch = '';
let message = '';
let messageKind: 'info' | 'error' = 'info';
let playing = false;
let run = 0;
let waitingResolve: (() => void) | null = null;
let waitingReason: 'mine' | 'no-voice' | null = null;
let waitingTimer: ReturnType<typeof setTimeout> | null = null;
let reveal = false;
let revealCount = 0;
let recorder: RecorderHandle | null = null;
let recordingLineId: string | null = null;
let busy = false;
let offlineReady = false;
let showRehearsalOptions = false;

function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}
function fmtDate(value: number): string { return new Date(value).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }); }
function active(): Project | null { return screen === 'import' ? draft : project; }
function characterName(p: Project, line: ScriptLine): string {
  return line.kind === 'scene' ? 'Scène' : line.kind === 'direction' ? 'Didascalie' : p.characters.find(c => c.id === line.characterId)?.name ?? 'Sans personnage';
}
function lineIndex(p: Project): number { return Math.max(0, p.lines.findIndex(line => line.id === p.currentLineId)); }
function notify(text: string, kind: 'info' | 'error' = 'info'): void { message = text; messageKind = kind; render(); }
function busyAction<T>(task: () => Promise<T>): Promise<T | undefined> {
  if (busy) return Promise.resolve(undefined);
  busy = true;
  render();
  return task().catch(error => { notify(error instanceof Error ? error.message : String(error), 'error'); return undefined; })
    .finally(() => { busy = false; render(); });
}
async function refreshProjects(): Promise<void> { projects = await allProjects(); }
async function save(p: Project): Promise<void> {
  if (p === draft) return;
  await putProject(p);
  await refreshProjects();
}
function stopPlayback(): void {
  run++;
  playing = false;
  audio.stop();
  waitingResolve?.();
  waitingResolve = null;
  waitingReason = null;
  if (waitingTimer) clearTimeout(waitingTimer);
  waitingTimer = null;
}
function setScreen(next: Screen): void {
  if (next !== 'rehearse') stopPlayback();
  if (next !== 'editor' && recorder) { recorder.cancel(); recorder = null; recordingLineId = null; }
  screen = next;
  message = '';
  render();
}
function nav(name: Screen, label: string, disabled = false): string {
  return `<button class="nav-item ${screen === name ? 'active' : ''}" data-action="nav" data-screen="${name}" ${disabled ? 'disabled' : ''}>${label}</button>`;
}
function render(): void {
  const oldList = document.querySelector<HTMLElement>('.cue-list');
  const oldScroll = oldList?.scrollTop ?? 0;
  const oldActive = oldList?.querySelector<HTMLElement>('.cue-card.current')?.dataset.id;
  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand"><span class="brand-mark">AR</span><span><strong>Atelier de répliques</strong><small>Votre scène, sur cet appareil</small></span></div>
        <nav aria-label="Navigation principale">
          ${nav('library', 'Bibliothèque')}
          ${nav('import', 'Importer un texte')}
          ${nav('editor', 'Préparer', !project)}
          ${nav('rehearse', 'Répéter', !project)}
          ${nav('settings', 'Réglages et données')}
        </nav>
        <div class="side-bottom"><span class="connection-dot ${navigator.onLine ? '' : 'off'}"></span>${!navigator.onLine ? 'Hors ligne' : offlineReady ? 'Disponible hors ligne' : import.meta.env.DEV ? 'Mode développement' : 'Préparation du cache'}<small>Textes et sons conservés localement</small></div>
      </aside>
      <main class="main">
        <header class="topbar"><div><span class="eyebrow">ESPACE DE TRAVAIL LOCAL</span><h1>${title()}</h1></div><div class="top-actions">${project ? `<span class="current-title">${esc(project.title)}</span>` : ''}<button class="menu-button" data-action="toggle-menu" aria-label="Ouvrir le menu">☰</button></div></header>
        ${message ? `<div role="status" class="notice ${messageKind}">${esc(message)}<button data-action="clear-message" aria-label="Fermer">×</button></div>` : ''}
        <div class="page">${screen === 'library' ? renderLibrary() : screen === 'import' ? renderImport() : screen === 'editor' ? renderEditor() : screen === 'rehearse' ? renderRehearse() : renderSettings()}</div>
      </main>
    </div>`;
  if (screen === 'rehearse' && project) {
    const list = document.querySelector<HTMLElement>('.cue-list');
    if (list) {
      if (oldActive === project.currentLineId) list.scrollTop = oldScroll;
      else requestAnimationFrame(() => list.querySelector<HTMLElement>('.cue-card.current')?.scrollIntoView({ block: 'center' }));
    }
  }
  if (screen === 'settings' && navigator.storage?.estimate) {
    navigator.storage.estimate().then(({ usage, quota }) => {
      const label = document.querySelector('#storage-estimate');
      if (label) label.textContent = `Stockage de ce navigateur : ${Math.round((usage ?? 0) / 1024 / 1024)} Mo utilisés sur environ ${Math.round((quota ?? 0) / 1024 / 1024)} Mo disponibles.`;
    }).catch(() => {});
  }
}
function title(): string {
  return ({ library: 'Bibliothèque', import: 'Importer et préparer', editor: 'Préparer le texte', rehearse: 'Répétition', settings: 'Réglages et données' })[screen];
}
function renderLibrary(): string {
  const shown = projects.filter(p => p.title.toLocaleLowerCase().includes(librarySearch.toLocaleLowerCase()));
  return `<section class="hero"><div><span class="eyebrow">RÉPÉTEZ À VOTRE RYTHME</span><h2>Vos textes restent avec vous.</h2><p>Créez un projet, attribuez les rôles, puis répétez avec les voix locales ou vos propres enregistrements.</p></div><div class="hero-actions"><button class="button primary" data-action="new-project">Nouveau texte</button><button class="button light" data-action="nav" data-screen="import">Importer TXT, PDF ou DOCX</button></div></section>
    <div class="section-heading"><div><h2>Mes projets <span class="count">${projects.length}</span></h2><p>Enregistrés dans ce navigateur, sur cet appareil.</p></div><label class="search"><span>Rechercher</span><input id="library-search" type="search" value="${esc(librarySearch)}" placeholder="Titre du texte" /></label></div>
    <div class="project-grid">${shown.length ? shown.map(p => `<article class="project-card"><div class="card-top"><span class="project-monogram">${esc(p.title.slice(0, 1).toLocaleUpperCase())}</span><span class="muted">${fmtDate(p.lastOpenedAt)}</span></div><h3>${esc(p.title)}</h3><p>${p.lines.length} répliques et repères · ${p.characters.length} personnages</p><div class="card-actions"><button class="button small primary" data-action="open-project" data-id="${esc(p.id)}">Ouvrir</button><button class="button small" data-action="duplicate-project" data-id="${esc(p.id)}">Dupliquer</button><button class="button small danger-text" data-action="delete-project" data-id="${esc(p.id)}">Supprimer</button></div></article>`).join('') : `<div class="empty"><span class="empty-icon">✦</span><h3>${librarySearch ? 'Aucun résultat' : 'Votre bibliothèque est prête'}</h3><p>${librarySearch ? 'Essayez un autre titre.' : 'Ajoutez votre premier texte pour commencer.'}</p></div>`}</div>`;
}
function renderImport(): string {
  return `<div class="two-column"><section class="panel"><span class="eyebrow">ÉTAPE 1</span><h2>Ajouter un texte</h2><p>Le fichier est lu ici, sans envoi à un serveur. Les PDF doivent contenir du texte sélectionnable.</p><label class="field"><span>Titre du projet</span><input id="import-title" value="${esc(draft?.title ?? '')}" placeholder="Titre de votre pièce" /></label><label class="field"><span>Fichier TXT, PDF ou DOCX</span><input id="script-file" type="file" accept=".txt,.pdf,.docx,text/plain,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" /></label><div class="divider">ou collez le texte</div><label class="field"><span>Texte à préparer</span><textarea id="paste-text" rows="10" placeholder="PERSONNAGE : Première réplique…"></textarea></label><button class="button primary" data-action="parse-paste">Préparer le texte collé</button></section>
  <section class="panel preview-panel"><span class="eyebrow">ÉTAPE 2</span><h2>Vérifier et corriger</h2>${draft ? draft.characters.length ? `<p>${draft.lines.length} lignes proposées, ${draft.characters.length} personnages. Actes, scènes et didascalies restent des repères ; vérifiez les noms et les répliques avant enregistrement.</p><div class="preview-list">${draft.lines.slice(0, 12).map(line => `<div class="preview-line"><strong>${esc(characterName(draft!, line))}</strong><span>${esc(line.text)}</span></div>`).join('')}${draft.lines.length > 12 ? `<p>… et ${draft.lines.length - 12} autres lignes</p>` : ''}</div><button class="button primary wide" data-action="save-draft">Créer le projet</button>` : `<div class="empty compact"><span class="empty-icon">⌁</span><h3>Aucun personnage reconnu</h3><p>Aucune réplique ne sera créée sans nom de personnage. Vérifiez que les noms apparaissent en gras ou sous la forme « PERSONNAGE : ».</p></div>` : `<div class="empty compact"><span class="empty-icon">⌁</span><h3>Aucun texte préparé</h3><p>Choisissez un fichier ou collez votre texte pour voir l'aperçu.</p></div>`}</section></div>`;
}
function renderEditor(): string {
  if (!project) return `<div class="empty"><p>Ouvrez un projet depuis la bibliothèque.</p></div>`;
  const p = project;
  const start = editorPage * 80;
  const pageLines = p.lines.slice(start, start + 80);
  const pages = Math.max(1, Math.ceil(p.lines.length / 80));
  return `<div class="editor-layout"><section class="panel"><div class="section-heading tight"><div><span class="eyebrow">PROJET</span><h2>Personnages</h2></div><button class="button small" data-action="add-character">+ Ajouter</button></div>
    <label class="field"><span>Titre</span><input data-project-field="title" value="${esc(p.title)}" /></label>
    <label class="field"><span>Langue du texte</span><input data-project-field="language" value="${esc(p.language)}" placeholder="fr-FR" /></label>
    <label class="field"><span>Mon rôle</span><select data-project-field="selectedRoleId"><option value="">À choisir</option>${p.characters.map(c => `<option value="${esc(c.id)}" ${p.selectedRoleId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
    <div class="character-list">${p.characters.map(c => `<div class="character-row"><span class="color-dot" style="background:${esc(c.color)}"></span><input aria-label="Nom du personnage" data-character-name="${esc(c.id)}" value="${esc(c.name)}" /><button class="icon-button" title="Supprimer" data-action="delete-character" data-id="${esc(c.id)}">×</button></div>`).join('') || `<p class="muted">Ajoutez ou importez des personnages.</p>`}</div>
    <button class="button wide" data-action="nav" data-screen="rehearse">Passer à la répétition →</button>
  </section><section class="panel lines-panel"><div class="section-heading tight"><div><span class="eyebrow">TEXTE</span><h2>Répliques <span class="count">${p.lines.length}</span></h2></div><button class="button small" data-action="add-line">+ Ligne</button></div><p class="muted">Chaque ligne peut être modifiée, déplacée ou enregistrée. Une scène et une didascalie n'ont pas de personnage.</p>
    <div class="line-list">${pageLines.map((line, localIndex) => renderEditLine(p, line, start + localIndex)).join('') || `<div class="empty compact"><p>Ajoutez une première ligne.</p></div>`}</div>
    <div class="pager"><button class="button small" data-action="editor-prev" ${editorPage === 0 ? 'disabled' : ''}>← Précédent</button><span>Page ${editorPage + 1} / ${pages}</span><button class="button small" data-action="editor-next" ${editorPage >= pages - 1 ? 'disabled' : ''}>Suivant →</button></div>
  </section></div>`;
}
function renderEditLine(p: Project, line: ScriptLine, index: number): string {
  const isRecording = recordingLineId === line.id;
  return `<article class="line-row"><div class="line-number">${index + 1}</div><div class="line-fields"><div class="line-meta"><select aria-label="Type de ligne" data-line-kind="${esc(line.id)}"><option value="dialogue" ${line.kind === 'dialogue' ? 'selected' : ''}>Réplique</option><option value="direction" ${line.kind === 'direction' ? 'selected' : ''}>Didascalie</option><option value="scene" ${line.kind === 'scene' ? 'selected' : ''}>Scène</option></select><select aria-label="Personnage" data-line-character="${esc(line.id)}" ${line.kind !== 'dialogue' ? 'disabled' : ''}><option value="">Sans personnage</option>${p.characters.map(c => `<option value="${esc(c.id)}" ${line.characterId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div><textarea aria-label="Texte de la ligne ${index + 1}" data-line-text="${esc(line.id)}" rows="2">${esc(line.text)}</textarea><div class="line-tools"><button data-action="move-line-up" data-id="${esc(line.id)}" title="Monter">↑</button><button data-action="move-line-down" data-id="${esc(line.id)}" title="Descendre">↓</button><button data-action="split-line" data-id="${esc(line.id)}">Scinder</button><button data-action="record-line" data-id="${esc(line.id)}" class="${isRecording ? 'recording' : ''}">${isRecording ? '■ Terminer' : '● Enregistrer'}</button><label class="file-label">Importer un son<input type="file" accept="audio/*" data-audio-file="${esc(line.id)}" /></label><button data-action="listen-line" data-id="${esc(line.id)}">Écouter</button><button data-action="delete-recording" data-id="${esc(line.id)}">Effacer son</button><button data-action="delete-line" data-id="${esc(line.id)}" class="danger-text">Supprimer</button></div></div></article>`;
}
function lineDisplay(p: Project, line: ScriptLine): string {
  const own = line.kind === 'dialogue' && line.characterId === p.selectedRoleId && p.selectedRoleId !== null;
  const isCurrent = line.id === p.currentLineId;
  const mode = own && !(isCurrent && reveal) ? p.settings.displayMode : 'full';
  if (line.kind === 'direction') return `<em class="direction-text">${esc(line.text.replace(/^[(*_\[]|[)*_\]]$/g, ''))}</em>`;
  let shownHidden = false;
  let wordsSeen = 0;
  return textParts(line.text).map(part => {
    if (part.direction) return `<em class="direction-text">${esc(part.value)}</em>`;
    if (mode === 'full') return esc(part.value);
    if (mode === 'hidden') {
      if (shownHidden || !part.value.trim()) return '';
      shownHidden = true;
      return '<span class="hidden-text">Réplique masquée · Indice pour la voir</span>';
    }
    if (mode === 'initials') return esc(part.value.replace(/\p{L}[\p{L}\p{M}'’]*/gu, word => word[0] + '·'.repeat(Math.min(7, [...word].length - 1))));
    return part.value.split(/(\s+)/).map(word => {
      if (!/\p{L}/u.test(word)) return esc(word);
      wordsSeen++;
      return isCurrent && wordsSeen <= revealCount ? esc(word) : '▰'.repeat(Math.max(1, Math.min(8, Math.ceil(word.length / 2))));
    }).join('');
  }).join('');
}
function renderRehearse(): string {
  return renderTranscript();
}
function renderTranscript(): string {
  if (!project?.lines.length) return '<div class="empty"><p>Ajoutez des répliques dans la préparation du texte.</p></div>';
  const p = project;
  const index = lineIndex(p);
  const status = waitingReason === 'mine'
    ? p.settings.waitMode === 'manual' ? 'À vous de jouer · appuyez sur Continuer' : `À vous de jouer · ${p.settings.waitMs / 1000} s`
    : waitingReason === 'no-voice' ? 'Aucun son disponible · appuyez sur Continuer'
      : playing ? 'Lecture en cours' : 'En pause';
  return `<div class="transcript-view">
    <div class="transcript-head"><div><span class="eyebrow">${esc(p.title)}</span><h2>Le texte en liste</h2><p>${p.lines.length} éléments · ligne ${index + 1}</p></div><div class="transcript-head-actions"><button class="button small" data-action="nav" data-screen="editor">Modifier</button><button class="button small" data-action="toggle-rehearsal-options" aria-expanded="${showRehearsalOptions}">Réglages ${showRehearsalOptions ? '▴' : '▾'}</button></div></div>
    ${showRehearsalOptions ? `<section class="transcript-options" aria-label="Réglages de répétition"><div class="options-grid">
      <label class="field"><span>Mon rôle</span><select data-project-field="selectedRoleId"><option value="">À choisir</option>${p.characters.map(c => `<option value="${esc(c.id)}" ${p.selectedRoleId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
      <label class="field"><span>Afficher ma réplique</span><select data-setting="displayMode"><option value="full" ${p.settings.displayMode === 'full' ? 'selected' : ''}>Texte complet</option><option value="hidden" ${p.settings.displayMode === 'hidden' ? 'selected' : ''}>Texte caché</option><option value="initials" ${p.settings.displayMode === 'initials' ? 'selected' : ''}>Initiales</option><option value="progressive" ${p.settings.displayMode === 'progressive' ? 'selected' : ''}>Mots à révéler</option></select></label>
      <label class="field"><span>Attente sur mes répliques</span><select data-setting="waitMode"><option value="manual" ${p.settings.waitMode === 'manual' ? 'selected' : ''}>J'appuie sur Continuer</option><option value="delay" ${p.settings.waitMode === 'delay' ? 'selected' : ''}>Délai automatique</option><option value="none" ${p.settings.waitMode === 'none' ? 'selected' : ''}>Sans attente</option></select></label>
      <label class="field"><span>Délai en secondes</span><input type="number" min="0" max="20" step="0.5" data-setting="waitMs" value="${p.settings.waitMs / 1000}" ${p.settings.waitMode !== 'delay' ? 'disabled' : ''} /></label>
      <label class="field"><span>Vitesse des voix</span><input type="range" min="0.5" max="2" step="0.1" data-setting="rate" value="${p.settings.rate}" /><small>${p.settings.rate.toFixed(1)}×</small></label>
    </div><div class="options-checks"><label class="check"><input type="checkbox" data-setting="loop" ${p.settings.loop ? 'checked' : ''} /> Boucler la plage</label><label class="check"><input type="checkbox" data-setting="useRecordings" ${p.settings.useRecordings ? 'checked' : ''} /> Utiliser les prises</label><label class="check"><input type="checkbox" data-setting="speakMine" ${p.settings.speakMine ? 'checked' : ''} /> Lire mes répliques</label><label class="check"><input type="checkbox" data-setting="speakDirections" ${p.settings.speakDirections ? 'checked' : ''} /> Lire les didascalies</label><label class="check"><input type="checkbox" data-setting="autoSkipToCue" ${p.settings.autoSkipToCue ? 'checked' : ''} /> Passer à mon prochain signal</label></div>
    <div class="voice-assignments"><h3>Voix des personnages</h3><p>Voix Piper chargées depuis l’application : Siwis et Tom en français, plus six locuteurs LibriTTS anglophones à essayer sur votre texte.</p>${p.characters.map((c, i) => `<div class="voice-assignment"><span>${esc(c.name)}</span><select aria-label="Voix de ${esc(c.name)}" data-voice="${esc(c.id)}"><option value="">Voix automatique</option><optgroup label="Piper · français">${PIPER_VOICES.filter(v => v.language === 'fr').map(v => `<option value="${v.id}" ${(c.voiceURI || defaultPiperVoice(i)) === v.id ? 'selected' : ''}>${v.label}</option>`).join('')}</optgroup><optgroup label="Piper · accent anglais">${PIPER_VOICES.filter(v => v.language === 'en').map(v => `<option value="${v.id}" ${(c.voiceURI || defaultPiperVoice(i)) === v.id ? 'selected' : ''}>${v.label}</option>`).join('')}</optgroup><optgroup label="Voix locales du système">${localVoices().map(v => `<option value="${esc(v.voiceURI)}" ${c.voiceURI === v.voiceURI ? 'selected' : ''}>${esc(v.name)} (${esc(v.lang)})</option>`).join('')}</optgroup></select><button class="button small" data-action="preview-voice" data-id="${esc(c.id)}">Écouter</button></div>`).join('')}</div>
    <div class="range-tools"><span>Plage : ${p.rangeStartId ? p.lines.findIndex(l => l.id === p.rangeStartId) + 1 : 1} → ${p.rangeEndId ? p.lines.findIndex(l => l.id === p.rangeEndId) + 1 : p.lines.length}</span><button data-action="range-start">Début ici</button><button data-action="range-end">Fin ici</button><button data-action="range-clear">Effacer</button><button data-action="add-marker">+ Repère</button></div>
    ${p.markers.length ? `<div class="marker-strip">${p.markers.map(m => `<button data-action="jump-marker" data-id="${esc(m.lineId)}">${esc(m.label)}</button>`).join('')}</div>` : ''}</section>` : ''}
    <div class="cue-list" role="list" aria-label="Répliques du texte">${p.lines.map((line, i) => {
      const current = i === index;
      const mine = line.kind === 'dialogue' && line.characterId === p.selectedRoleId && p.selectedRoleId !== null;
      const color = p.characters.find(c => c.id === line.characterId)?.color ?? '#8b969e';
      return `<article class="cue-card ${line.kind} ${current ? 'current' : ''} ${mine ? 'mine' : ''}" data-id="${esc(line.id)}" style="--cue-color:${esc(color)}" role="listitem"><button class="cue-jump" data-action="jump-line" data-id="${esc(line.id)}" aria-label="Aller à la ligne ${i + 1}, ${esc(characterName(p, line))}"><span class="cue-meta"><span class="cue-number">${i + 1}</span><strong>${esc(characterName(p, line))}${mine ? ' · mon rôle' : ''}</strong>${current ? '<span class="current-badge">En cours</span>' : ''}</span><span class="cue-text ${current ? 'stage-text' : ''}">${lineDisplay(p, line)}</span></button></article>`;
    }).join('')}</div>
    <div class="transport"><span class="transport-status" role="status">${status}</span><div class="transport-buttons"><button data-action="prev-line" aria-label="Réplique précédente">⏮</button><button data-action="play-toggle" aria-label="${playing ? 'Pause' : 'Lire'}">${playing ? 'Ⅱ' : '▶'}</button><button data-action="continue" class="continue" aria-label="Continuer">${waitingReason ? 'Continuer' : '⏭'}</button><button data-action="prompt" class="prompt-button">Indice</button></div></div>
  </div>`;
}
function renderSettings(): string {
  return renderDataSettings();
}
function renderDataSettings(): string {
  const voices = localVoices();
  return `<div class="two-column"><section class="panel"><span class="eyebrow">VOIX LOCALES</span><h2>Voix Piper Siwis, Tom et LibriTTS</h2><p>Siwis et Tom parlent français. Six locuteurs du modèle LibriTTS anglais sont proposés pour tester leur prononciation française avec accent.</p>${project ? '<button class="button primary" data-action="nav" data-screen="rehearse">Attribuer les voix dans la répétition</button>' : '<p>Ouvrez un projet pour attribuer les voix.</p>'}<h3>Voix locales du système</h3><p>${voices.length} voix supplémentaires signalées comme locales par ce navigateur.</p><div class="voice-list">${voices.map(v => `<div class="voice-row"><span>${esc(v.name)}</span><small>${esc(v.lang)}</small></div>`).join('') || '<p class="muted">Aucune voix système locale supplémentaire.</p>'}</div><p class="hint">Modèles téléchargés avec l’application ; synthèse exécutée sur l’appareil. Attendez « Disponible hors ligne » avant de couper le réseau.</p></section>
  <section class="panel"><span class="eyebrow">VOS DONNÉES</span><h2>Sauvegarde et transfert</h2><p>Vos textes et sons restent dans ce navigateur. Exportez une sauvegarde pour les transférer ou les conserver.</p>${project ? `<div class="stack"><button class="button primary" data-action="export-backup">Exporter ce projet avec ses sons</button><button class="button" data-action="export-text">Exporter le texte TXT</button></div>` : '<p>Ouvrez un projet pour l’exporter.</p>'}<label class="field"><span>Restaurer une archive locale</span><input id="backup-file" type="file" accept=".zip,application/zip" /></label><p class="hint">La restauration crée un nouveau projet.</p><div class="privacy-note"><strong>Fonctionnement local</strong><p>Aucun texte ni son n’est envoyé à un service distant.</p></div><p id="storage-estimate" class="muted">Stockage : estimation en cours…</p></section></div>`;
}
function updateLine(p: Project, lineId: string, update: (line: ScriptLine) => void): void {
  const line = p.lines.find(item => item.id === lineId);
  if (!line) return;
  update(line);
  void save(p).catch(error => notify(String(error), 'error'));
  render();
}
function updateProject(p: Project, update: () => void): void {
  update();
  void save(p).catch(error => notify(String(error), 'error'));
  render();
}
async function openProject(projectId: string): Promise<void> {
  const found = await getProject(projectId);
  if (!found) return notify('Projet introuvable.', 'error');
  project = found;
  project.lastOpenedAt = Date.now();
  await save(project);
  editorPage = 0;
  localStorage.setItem('lastProjectId', project.id);
  setScreen('editor');
}
function getBounds(p: Project): [number, number] {
  const start = p.rangeStartId ? p.lines.findIndex(line => line.id === p.rangeStartId) : 0;
  const end = p.rangeEndId ? p.lines.findIndex(line => line.id === p.rangeEndId) : p.lines.length - 1;
  return [Math.max(0, start), Math.max(0, end)];
}
function jumpTo(index: number, resume = false): void {
  if (!project?.lines.length) return;
  stopPlayback();
  const [start, end] = getBounds(project);
  const bounded = Math.max(start, Math.min(end, index));
  project.currentLineId = project.lines[bounded].id;
  reveal = false;
  revealCount = 0;
  void save(project).catch(error => notify(String(error), 'error'));
  render();
  if (resume) void startPlayback();
}
function waitForContinue(reason: 'mine' | 'no-voice', timeout?: number): Promise<void> {
  return new Promise(resolve => {
    waitingReason = reason;
    waitingResolve = () => {
      if (waitingTimer) clearTimeout(waitingTimer);
      waitingTimer = null;
      waitingReason = null;
      waitingResolve = null;
      resolve();
    };
    if (timeout !== undefined) waitingTimer = setTimeout(() => waitingResolve?.(), timeout);
    render();
  });
}
function waitForMyLine(p: Project): Promise<void> {
  if (p.settings.waitMode === 'none') return Promise.resolve();
  return waitForContinue('mine', p.settings.waitMode === 'delay' ? p.settings.waitMs : undefined);
}
function updateActiveWait(p: Project): void {
  if (waitingReason !== 'mine' || !waitingResolve) return;
  if (waitingTimer) clearTimeout(waitingTimer);
  waitingTimer = null;
  if (p.settings.waitMode === 'none') waitingResolve();
  else if (p.settings.waitMode === 'delay') waitingTimer = setTimeout(() => waitingResolve?.(), p.settings.waitMs);
  render();
}
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
function nextPlaybackIndex(p: Project, current: number): number {
  const [start, end] = getBounds(p);
  let next = current + 1;
  if (p.settings.autoSkipToCue && p.selectedRoleId && p.lines[current]?.characterId === p.selectedRoleId) {
    const nextMine = p.lines.findIndex((line, i) => i > current + 1 && i <= end && line.characterId === p.selectedRoleId);
    if (nextMine > current + 1) next = Math.max(current + 1, nextMine - 1);
  }
  if (next > end) return p.settings.loop ? start : -1;
  return next;
}
async function playCurrentLine(p: Project, line: ScriptLine, token: number): Promise<void> {
  const mine = line.kind === 'dialogue' && line.characterId === p.selectedRoleId && p.selectedRoleId !== null;
  if (line.kind === 'scene') { await delay(700); return; }
  const spoken = speechText(line, p.settings.speakDirections);
  if (!spoken) { await delay(350); return; }
  if (mine && !p.settings.speakMine) {
    await waitForMyLine(p);
    return;
  }
  let used = false;
  if (p.settings.useRecordings) {
    const record = await getRecording(p.id, line.id);
    if (record && token === run) used = await audio.playBlob(record.blob);
  }
  if (!used && token === run) {
    const character = p.characters.find(c => c.id === line.characterId);
    const voice = character?.voiceURI || (character && p.language.toLowerCase().startsWith('fr') ? defaultPiperVoice(p.characters.indexOf(character)) : '');
    used = await audio.speak(spoken, voice ?? '', p.language, p.settings.rate);
  }
  if (!used && token === run) {
    message = 'Aucune voix locale pour cette ligne : appuyez sur Continuer.';
    render();
    await waitForContinue('no-voice');
    return;
  }
  if (mine && token === run) await waitForMyLine(p);
}
async function startPlayback(): Promise<void> {
  if (!project?.lines.length) return;
  stopPlayback();
  const p = project;
  const token = run;
  playing = true;
  render();
  while (playing && token === run) {
    const [start, end] = getBounds(p);
    let index = lineIndex(p);
    if (index < start || index > end) index = start;
    const line = p.lines[index];
    if (!line) break;
    p.currentLineId = line.id;
    reveal = false;
    revealCount = 0;
    render();
    await save(p);
    if (token !== run) break;
    try { await playCurrentLine(p, line, token); }
    catch (error) { if (token === run) { message = error instanceof Error ? error.message : String(error); messageKind = 'error'; render(); await waitForContinue('no-voice'); } }
    if (token !== run) break;
    const next = nextPlaybackIndex(p, index);
    if (next < 0) break;
    if (next === index) await delay(500);
    if (token !== run) break;
    p.currentLineId = p.lines[next].id;
  }
  if (token === run) { playing = false; render(); }
}

async function toggleRecording(lineId: string): Promise<void> {
  if (!project) return;
  if (recorder) {
    if (recordingLineId !== lineId) return notify('Terminez la prise en cours avant de changer de ligne.', 'error');
    const handle = recorder;
    recorder = null;
    recordingLineId = null;
    const blob = await handle.stop();
    await putRecording({ id: `${project.id}:${lineId}`, projectId: project.id, lineId, mimeType: blob.type, blob, createdAt: Date.now() });
    notify('Prise enregistrée sur cet appareil.');
    return;
  }
  recorder = await startRecording();
  recordingLineId = lineId;
  notify('Enregistrement en cours. Appuyez sur « Terminer » pour conserver la prise.');
}
async function duplicateProject(projectId: string): Promise<void> {
  const original = await getProject(projectId);
  if (!original) throw new Error('Projet introuvable.');
  const copy = cloneProject(original);
  copy.id = id();
  copy.title = `${original.title} (copie)`;
  copy.createdAt = copy.updatedAt = copy.lastOpenedAt = Date.now();
  await putProject(copy);
  for (const r of await recordingsForProject(original.id)) {
    await putRecording({ ...r, id: `${copy.id}:${r.lineId}`, projectId: copy.id });
  }
  await refreshProjects();
  notify('Projet dupliqué.');
}
async function handleAction(button: HTMLElement): Promise<void> {
  const action = button.dataset.action;
  const p = project;
  const itemId = button.dataset.id ?? '';
  switch (action) {
    case 'toggle-rehearsal-options': showRehearsalOptions = !showRehearsalOptions; render(); return;
    case 'jump-line': if (p) jumpTo(p.lines.findIndex(l => l.id === itemId)); return;
    case 'preview-voice': {
      if (!p) return;
      const c = p.characters.find(c => c.id === itemId);
      if (!c) return;
      const voice = c.voiceURI || defaultPiperVoice(p.characters.indexOf(c));
      notify(`Préparation de la voix de ${c.name}…`);
      const ok = await audio.speak('Bonjour, voici ma voix pour cette répétition.', voice, p.language, p.settings.rate);
      if (!ok) notify('Cette voix n’a pas pu être lue sur cet appareil.', 'error');
      return;
    }
    case 'toggle-menu': document.body.classList.toggle('menu-open'); return;
    case 'clear-message': message = ''; render(); return;
    case 'nav': document.body.classList.remove('menu-open'); setScreen(button.dataset.screen as Screen); return;
    case 'new-project': {
      const created = newProject();
      await putProject(created); await refreshProjects(); await openProject(created.id); return;
    }
    case 'open-project': await openProject(itemId); return;
    case 'duplicate-project': await busyAction(() => duplicateProject(itemId)); return;
    case 'delete-project': {
      const target = projects.find(item => item.id === itemId);
      if (!target || !confirm(`Supprimer « ${target.title} » et tous ses enregistrements de cet appareil ?`)) return;
      await deleteProject(itemId); if (project?.id === itemId) project = null; await refreshProjects(); notify('Projet supprimé.'); return;
    }
    case 'parse-paste': {
      const text = (document.querySelector<HTMLTextAreaElement>('#paste-text')?.value ?? '').trim();
      if (!text) return notify('Collez un texte avant de le préparer.', 'error');
      draft = parseScript(text, document.querySelector<HTMLInputElement>('#import-title')?.value.trim() || 'Texte importé');
      render(); return;
    }
    case 'save-draft': {
      if (!draft) return;
      project = draft; draft = null;
      await putProject(project); await refreshProjects(); setScreen('editor'); return;
    }
    case 'add-character': {
      if (!p) return;
      const name = prompt('Nom du personnage :')?.trim();
      if (!name) return;
      if (p.characters.some(c => c.name.toLocaleLowerCase() === name.toLocaleLowerCase())) return notify('Ce personnage existe déjà.', 'error');
      updateProject(p, () => p.characters.push({ id: id(), name: name.slice(0, 100), color: '#396d78', voiceURI: defaultPiperVoice(p.characters.length) })); return;
    }
    case 'delete-character': {
      if (!p) return;
      if (p.lines.some(line => line.characterId === itemId)) return notify('Réattribuez d’abord ses répliques.', 'error');
      const character = p.characters.find(c => c.id === itemId);
      if (!character || !confirm(`Supprimer le personnage « ${character.name} » ?`)) return;
      updateProject(p, () => { p.characters = p.characters.filter(c => c.id !== itemId); if (p.selectedRoleId === itemId) p.selectedRoleId = null; }); return;
    }
    case 'add-line': {
      if (!p) return;
      const line = { id: id(), kind: 'dialogue' as const, characterId: null, text: '' };
      updateProject(p, () => { p.lines.push(line); p.currentLineId ||= line.id; editorPage = Math.floor((p.lines.length - 1) / 80); }); return;
    }
    case 'delete-line': {
      if (!p || !confirm('Supprimer cette ligne et sa prise audio ?')) return;
      updateProject(p, () => { p.lines = p.lines.filter(l => l.id !== itemId); p.markers = p.markers.filter(m => m.lineId !== itemId); if (p.currentLineId === itemId) p.currentLineId = p.lines[0]?.id ?? null; });
      await deleteRecording(p.id, itemId); return;
    }
    case 'move-line-up': case 'move-line-down': {
      if (!p) return;
      const i = p.lines.findIndex(l => l.id === itemId);
      const j = i + (action === 'move-line-up' ? -1 : 1);
      if (i < 0 || j < 0 || j >= p.lines.length) return;
      updateProject(p, () => { [p.lines[i], p.lines[j]] = [p.lines[j], p.lines[i]]; editorPage = Math.floor(j / 80); }); return;
    }
    case 'split-line': {
      if (!p) return;
      const line = p.lines.find(l => l.id === itemId);
      if (!line) return;
      const at = Number(prompt(`Après combien de caractères scinder la ligne ? (1 à ${line.text.length - 1})`, String(Math.floor(line.text.length / 2))));
      if (!Number.isInteger(at) || at <= 0 || at >= line.text.length) return;
      updateProject(p, () => { const pos = p.lines.indexOf(line); const second = { ...line, id: id(), text: line.text.slice(at).trim() }; line.text = line.text.slice(0, at).trim(); p.lines.splice(pos + 1, 0, second); }); return;
    }
    case 'editor-prev': editorPage = Math.max(0, editorPage - 1); render(); return;
    case 'editor-next': if (p) editorPage = Math.min(Math.ceil(p.lines.length / 80) - 1, editorPage + 1); render(); return;
    case 'record-line': await toggleRecording(itemId); return;
    case 'listen-line': {
      if (!p) return;
      const record = await getRecording(p.id, itemId);
      if (!record) return notify('Aucune prise audio pour cette ligne.', 'error');
      await audio.playBlob(record.blob); return;
    }
    case 'delete-recording': {
      if (!p) return;
      const record = await getRecording(p.id, itemId);
      if (!record) return notify('Aucune prise à supprimer.');
      if (!confirm('Effacer cette prise audio ?')) return;
      await deleteRecording(p.id, itemId); notify('Prise effacée.'); return;
    }
    case 'play-toggle': if (playing) { stopPlayback(); render(); } else void startPlayback(); return;
    case 'prev-line': if (p) jumpTo(lineIndex(p) - 1, playing); return;
    case 'next-line': if (p) jumpTo(lineIndex(p) + 1, playing); return;
    case 'continue': if (waitingResolve) { const done = waitingResolve; waitingResolve = null; done(); } else if (p) jumpTo(lineIndex(p) + 1, playing); return;
    case 'prompt': {
      if (!p) return;
      if (p.settings.displayMode === 'progressive') revealCount += 3;
      else reveal = true;
      render(); return;
    }
    case 'range-start': if (p) updateProject(p, () => { p.rangeStartId = p.currentLineId; if (getBounds(p)[0] > getBounds(p)[1]) p.rangeEndId = null; }); return;
    case 'range-end': if (p) updateProject(p, () => { p.rangeEndId = p.currentLineId; if (getBounds(p)[0] > getBounds(p)[1]) p.rangeStartId = null; }); return;
    case 'range-clear': if (p) updateProject(p, () => { p.rangeStartId = p.rangeEndId = null; }); return;
    case 'add-marker': {
      if (!p?.currentLineId) return;
      const label = prompt('Nom du repère :', `Repère ${p.markers.length + 1}`)?.trim();
      if (!label) return;
      updateProject(p, () => p.markers.push({ id: id(), lineId: p.currentLineId!, label: label.slice(0, 100) })); return;
    }
    case 'jump-marker': if (p) jumpTo(p.lines.findIndex(l => l.id === itemId)); return;
    case 'edit-marker': {
      if (!p) return;
      const marker = p.markers.find(m => m.id === itemId);
      if (!marker) return;
      const label = prompt('Nouveau nom du repère :', marker.label)?.trim();
      if (!label) return;
      updateProject(p, () => { marker.label = label.slice(0, 100); }); return;
    }
    case 'delete-marker': if (p) updateProject(p, () => { p.markers = p.markers.filter(m => m.id !== itemId); }); return;
    case 'export-backup': if (p) await busyAction(async () => downloadBlob(await exportProject(p), `${p.title.replace(/[\\/:*?"<>|]/g, '_')}.repliques.zip`)); return;
    case 'export-text': if (p) downloadBlob(new Blob([exportText(p)], { type: 'text/plain;charset=utf-8' }), `${p.title.replace(/[\\/:*?"<>|]/g, '_')}.txt`); return;
  }
}

app.addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
  if (button) void handleAction(button).catch(error => notify(error instanceof Error ? error.message : String(error), 'error'));
});
app.addEventListener('change', event => {
  const target = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  void handleChange(target).catch(error => notify(error instanceof Error ? error.message : String(error), 'error'));
});
app.addEventListener('input', event => {
  const target = event.target as HTMLInputElement;
  if (target.id === 'library-search') { librarySearch = target.value; const pos = target.selectionStart; render(); const next = document.querySelector<HTMLInputElement>('#library-search'); next?.focus(); if (pos !== null) next?.setSelectionRange(pos, pos); }
});

async function handleChange(target: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): Promise<void> {
  const p = project;
  if (target.id === 'script-file' && target instanceof HTMLInputElement && target.files?.[0]) {
    const file = target.files[0];
    const requestedTitle = document.querySelector<HTMLInputElement>('#import-title')?.value.trim() || file.name.replace(/\.[^.]+$/, '');
    await busyAction(async () => {
      const text = await textFromFile(file);
      draft = parseScript(text, requestedTitle);
      if (!draft.lines.length) throw new Error('Aucune ligne lisible dans ce fichier.');
      notify('Fichier préparé localement. Vérifiez l’aperçu.');
    });
    return;
  }
  if (target.id === 'backup-file' && target instanceof HTMLInputElement && target.files?.[0]) {
    await busyAction(async () => { const restored = await importProject(target.files![0]); await refreshProjects(); project = restored; setScreen('editor'); notify('Projet restauré comme nouveau projet.'); });
    return;
  }
  const audioLineId = target.dataset.audioFile;
  if (audioLineId && p && target instanceof HTMLInputElement && target.files?.[0]) {
    const file = target.files[0];
    if (file.size > 100 * 1024 * 1024) throw new Error('Fichier audio trop volumineux (limite : 100 Mo).');
    if (!file.type.startsWith('audio/') && !/\.(mp3|m4a|wav|ogg|opus|webm|aac)$/i.test(file.name)) throw new Error('Choisissez un fichier audio.');
    await putRecording({ id: `${p.id}:${audioLineId}`, projectId: p.id, lineId: audioLineId, mimeType: file.type || 'application/octet-stream', blob: file, createdAt: Date.now() });
    notify('Son importé sur cet appareil.'); return;
  }
  if (!p) return;
  if (target.dataset.projectField === 'title') { updateProject(p, () => { p.title = target.value.trim().slice(0, 200) || 'Sans titre'; }); return; }
  if (target.dataset.projectField === 'language') { updateProject(p, () => { p.language = target.value.trim().slice(0, 35) || 'fr-FR'; }); return; }
  if (target.dataset.projectField === 'selectedRoleId') { stopPlayback(); updateProject(p, () => { p.selectedRoleId = target.value || null; }); return; }
  if (target.dataset.characterName) {
    const c = p.characters.find(c => c.id === target.dataset.characterName);
    if (c) updateProject(p, () => { c.name = target.value.trim().slice(0, 100) || c.name; }); return;
  }
  if (target.dataset.lineText) { updateLine(p, target.dataset.lineText, line => { line.text = target.value; }); return; }
  if (target.dataset.lineKind) { updateLine(p, target.dataset.lineKind, line => { line.kind = target.value as ScriptLine['kind']; if (line.kind !== 'dialogue') line.characterId = null; }); return; }
  if (target.dataset.lineCharacter) { updateLine(p, target.dataset.lineCharacter, line => { line.characterId = target.value || null; }); return; }
  if (target.dataset.voice) { const c = p.characters.find(c => c.id === target.dataset.voice); if (c) updateProject(p, () => { c.voiceURI = target.value; }); return; }
  if (target.dataset.setting) {
    const key = target.dataset.setting;
    updateProject(p, () => {
      if (key === 'displayMode') p.settings.displayMode = target.value as DisplayMode;
      else if (key === 'waitMode') p.settings.waitMode = target.value as Project['settings']['waitMode'];
      else if (key === 'waitMs') p.settings.waitMs = Math.min(20_000, Math.max(0, Number(target.value) * 1000));
      else if (key === 'rate') p.settings.rate = Math.min(2, Math.max(0.5, Number(target.value)));
      else if (['loop', 'useRecordings', 'speakMine', 'speakDirections', 'autoSkipToCue'].includes(key)) (p.settings as unknown as Record<string, boolean>)[key] = (target as HTMLInputElement).checked;
    });
    if (key === 'waitMode' || key === 'waitMs') updateActiveWait(p);
  }
}

window.addEventListener('online', render);
window.addEventListener('offline', render);
if ('speechSynthesis' in window) speechSynthesis.addEventListener('voiceschanged', () => { if (screen === 'settings') render(); });
window.addEventListener('keydown', event => {
  if (screen !== 'rehearse' || !project || ['INPUT', 'SELECT', 'TEXTAREA'].includes((event.target as HTMLElement).tagName)) return;
  if (event.code === 'Space') { event.preventDefault(); if (playing) { stopPlayback(); render(); } else void startPlayback(); }
  if (event.code === 'ArrowRight') { event.preventDefault(); jumpTo(lineIndex(project) + 1, playing); }
  if (event.code === 'ArrowLeft') { event.preventDefault(); jumpTo(lineIndex(project) - 1, playing); }
});

async function init(): Promise<void> {
  try {
    projects = await allProjects();
    const last = localStorage.getItem('lastProjectId');
    if (last) project = await getProject(last) ?? null;
    render();
    if (import.meta.env.PROD && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').then(() => navigator.serviceWorker.ready).then(() => { offlineReady = true; render(); })
        .catch(() => notify('Installation hors ligne indisponible dans ce navigateur.', 'error'));
    }
  } catch (error) {
    app.innerHTML = `<main class="fatal"><h1>Stockage local indisponible</h1><p>${esc(error instanceof Error ? error.message : String(error))}</p><p>Ouvrez l'application dans un navigateur avec IndexedDB activé.</p></main>`;
  }
}
void init();
