# WebVR Mölkky - Projet WebXR (ST2AWD)

Bienvenue dans le projet **WebVR Mölkky**, une expérience de réalité virtuelle 100% web développée avec **A-Frame** et **Cannon.js**, optimisée spécifiquement pour **Meta Quest 3** et conforme au cahier des charges officiel **ST2AWD – WebXR**.

---

## 🎮 Commandes Meta Quest 3

| Action | Contrôleur Meta Quest 3 | Description |
| :--- | :--- | :--- |
| **Déplacement (Locomotion)** | **Joystick gauche** (pousser avant/arrière/côtés) | Permet de marcher librement sur le terrain dans la direction du regard (axe inversable via le totem) |
| **Pivoter (Smooth Turn)** | **Joystick droit** (pousser gauche/droite) | Rotation fluide continue de la vue |
| **Cliquer sur les boutons 3D** | **Bouton A** (droite) / **Bouton X** (gauche) | Visez avec le laser et appuyez sur **A** ou **X** pour activer les boutons du totem ou de victoire/défaite |
| **Attraper le bâton (Grab)** | **Gâchettes d'index** ou **Grips latéraux** (les 4 gâchettes) | Attrape instantanément le vrai bâton en bois dans la main |
| **Lancer le bâton (Throw)** | **Relâcher la gâchette / le grip** en faisant le geste du lancer | Projette le bâton avec élan réaliste, lift parabolique et roulement fluide sur la pelouse |

---

## 🥽 Lancement dans le Meta Quest 3

1. Connectez votre PC et votre Meta Quest 3 au même réseau Wi-Fi.
2. Lancez le serveur local (par exemple avec l'extension VS Code **Live Server** sur le port 5500, ou via `python -m http.server 8080`).
3. Dans le Meta Quest 3, ouvrez le **Meta Quest Browser**.
4. Tapez l'adresse IP locale de votre PC (ex: `http://192.168.1.XX:5500/`).
5. Cliquez sur le bouton bleu **« 🥽 Entrer en VR »** (en haut à droite) ou sur l'icône de masque VR en bas à droite de l'écran pour basculer en mode immersif 6DOF.

---

## 🎯 Conformité aux Règles du Cahier des Charges

### 1. Terrain et Interaction
- **12 quilles numérotées de 1 à 12** disposées selon la configuration initiale officielle du Mölkky (formation compacte triangulaire).
- **Zone de lancer matérialisée** par un « Mölkkaari » en bois situé à environ 3–4 mètres des quilles (ajustable selon la difficulté).
- **Support de lancer (pupitre en bois)** maintenant le bâton de Mölkky à hauteur de main.
- **Contrôleurs WebXR 6DOF** : Suivi spatial complet, haptique sur les manettes, physique des collisions, rebonds bois/herbe et inertie de rotation.

### 2. Gestion des Quilles & Dispersion Réaliste
- **Détection automatique des quilles tombées** : Une quille est comptabilisée uniquement si elle est effectivement tombée (angle d'inclinaison $> 44^\circ$ ou centre de gravité abaissé).
- **Règle officielle de dispersion** : Après le calcul du score, **chaque quille tombée est remise debout à l'endroit exact où elle est tombée** ! Les quilles s'écartent donc progressivement sur le terrain au fil des lancers.
- **Réinitialisation en nouvelle partie** : Toutes les quilles sont replacées dans leur configuration compacte initiale.

### 3. Calcul du Score
- **1 seule quille tombée** : Le joueur marque le numéro indiqué sur la quille (ex: quille 11 = 11 pts).
- **Plusieurs quilles tombées** : Le joueur marque le nombre de quilles tombées (ex: 4 quilles = 4 pts).
- **Aucune quille tombée (0 point)** : Incrémente le compteur d'échecs consécutifs.
- **Objectif** : Atteindre exactement **50 points**.
- **Pénalité de dépassement** : Si le score dépasse 50, il est immédiatement ramené à **25 points**.
- **Élimination** : Après **3 lancers consécutifs sans marquer**, la partie est perdue.
- **Victoire** : La partie est gagnée dès que le joueur atteint exactement 50 points.

### 4. Niveaux de Difficulté
- **Facile** : Distance réduite (~2,5 m) et **assistance visuelle au lancer** (trajectoire parabolique prédictive calculée en temps réel).
- **Normal** : Distance standard (~3,5 m) et physique standard sans assistance.
- **Difficile** : Distance augmentée (~4,8 m) et aucune assistance.

### 5. Effets Sonores 3D Spatialisés
- Moteur audio spatialisé basé sur la **Web Audio API** avec nœuds `PannerNode` HRTF 3D (impacts bois résonants, bruit de pelouse étouffé, whoosh d'air au lancer, fanfare de victoire, sonnerie d'élimination et pénalité).
