# Modèles et bibliothèques tiers

La PWA embarque trois modèles Piper officiels issus de [`rhasspy/piper-voices`](https://huggingface.co/rhasspy/piper-voices):

- [`fr_FR-siwis-medium`](https://huggingface.co/rhasspy/piper-voices/tree/main/fr/fr_FR/siwis/medium) : français, une voix, qualité annoncée moyenne. Licence du corpus : CC BY 4.0. Attribution à SIWIS/EPFL requise.
- [`fr_FR-tom-medium`](https://huggingface.co/rhasspy/piper-voices/tree/main/fr/fr_FR/tom/medium) : français, une voix, qualité annoncée moyenne. La fiche du modèle indique AGPLv3.
- [`en_US-libritts_r-medium`](https://huggingface.co/rhasspy/piper-voices/tree/main/en/en_US/libritts_r/medium) : anglais américain, 904 locuteurs. Six identifiants sont proposés ; la lecture du français peut avoir un accent et doit être écoutée avant usage. Corpus CC BY 4.0.

Les qualités indiquées sont celles des fiches officielles, pas des garanties d'intelligibilité sur chaque téléphone. Les modèles sont fournis localement avec le site, sans téléchargement d'IA à l'utilisation.

La phonétisation utilise [`@diffusionstudio/piper-wasm` 1.0.0](https://github.com/diffusionstudio/piper-wasm), qui embarque eSpeak NG (GPL-3.0-or-later). L'inférence utilise [`onnxruntime-web` 1.23.2](https://github.com/microsoft/onnxruntime) (MIT). Aucun code ou média de Script Rehearser n'est réutilisé.
