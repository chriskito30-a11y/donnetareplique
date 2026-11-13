# Voix locale française

La PWA embarque le modèle [`fr_FR-mls-medium`](https://huggingface.co/rhasspy/piper-voices/tree/main/fr/fr_FR/mls/medium) publié par Rhasspy : 125 locuteurs, français, 22 050 Hz. Son fichier ONNX a été téléchargé depuis ce dépôt et vérifié par SHA-256 : `0ed223f78466917f2bae05ee90096ce69ab1fdeb251f55590d0e7422d234e162`. La fiche `public/tts/MODEL_CARD.txt` indique un entraînement sur MLS (licence des données CC BY 4.0). Le dépôt des modèles est indiqué MIT.

La phonétisation utilise [`@diffusionstudio/piper-wasm` 1.0.0](https://github.com/diffusionstudio/piper-wasm), dont les binaires incluent eSpeak NG (GPL-3.0-or-later). L'inférence utilise [`onnxruntime-web` 1.23.2](https://github.com/microsoft/onnxruntime) (MIT). Les paquets ont été installés avec `--ignore-scripts`. Le modèle, les composants WASM et les données eSpeak sont servis par la PWA elle-même ; aucune requête vers Hugging Face, un CDN ou un service de synthèse n'est effectuée pendant l'utilisation.

Whisper, présent dans le paquet Android étudié, est un moteur de **transcription**. Il n'est pas réutilisé ici et ne produit pas de voix. Aucune ressource de Script Rehearser n'a été intégrée.
