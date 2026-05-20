# PULSE — Pixelblaze Unified Live Sync Engine

Real-time LED lighting control system that syncs Pixelblaze LED controllers to Pioneer DJ equipment via beat detection.

---

## Architecture

```
Pioneer CDJs/XDJs
       │  Pro DJ Link network
       ▼
Beat Link Trigger (BLT)
       │  OSC UDP :9000
       ▼
┌─────────────────────────────────────────────────────┐
│              PULSE Conductor (Node.js :8080)         │
│                                                     │
│  OSC receiver · Scene manager · Beat state machine  │
│  Pixelblaze WS pool · Firestorm HTTP client         │
│  REST API · PULSEDECK WebSocket server              │
└──────┬──────────────────────────────────────────────┘
       │  WebSocket (Firestorm sync)
       ▼
Pixelblaze controllers  ←→  Firestorm (clock sync)
```

### Components

| Component | URL | Description |
|---|---|---|
| **PULSEDECK** | `/` | Live control surface — scenes, zones, kill switch, BPM, mode lock |
| **PULSEFORGE** | `/forge/` | AI pattern composer — generate Pixelblaze patterns via Claude |
| **PULSEMAP** | `/map/` | Spatial LED mapper — place controllers on a stage canvas, define zones |

---

## Requirements

- **Node.js** 20+
- **Anthropic API key** (for PULSEFORGE AI generation)
- **Java 17+** (for Beat Link Trigger — only needed when using real Pioneer hardware)
- Pioneer CDJs/XDJs on the same network (optional — dev mode works without hardware)

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/AlieGG/PULSE.git
cd PULSE
npm install
```

### 2. Set your API key

```bash
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env
```

### 3. Run in dev mode (no hardware needed)

```bash
node conductor/index.js --dev
```

Open [http://localhost:8080](http://localhost:8080)

Dev mode starts a fake beat generator at 128 BPM so PULSEDECK and PULSEFORGE work without any Pioneer gear or Pixelblaze controllers.

---

## Using with Real Hardware

### Pixelblaze controllers

1. Open **PULSEMAP** (`/map/`) and import each Pixelblaze by IP address
2. Arrange controllers on the stage canvas to match your physical rig
3. Draw zones and assign controllers to them
4. Click **Save Topology**

The conductor will connect to Pixelblaze units listed in `conductor/config/topology.json` on startup.

### Pioneer DJ decks (Beat Link Trigger)

Install Java if not already present:
```bash
brew install --cask temurin
```

Launch BLT:
```bash
bash blt/launch.sh
```

Configure BLT by pasting the blocks from `blt/pulse-triggers.clj` into BLT's expression editors:

| BLT expression | Code block |
|---|---|
| File → Edit Global Setup Expression | `Global Setup` block |
| Trigger Beat Expression | `Beat Expression` block |
| Trigger Tracked Update Expression | `Tracked Update Expression` block |
| Trigger Activation Expression | `Activation Expression` block |
| File → Edit Global Shutdown Expression | `Global Shutdown` block |

Set the trigger to watch **Master Player**, enabled **Always**.

Start the conductor without `--dev`:
```bash
node conductor/index.js
```

### OSC messages received (port 9000)

| Address | Args | Description |
|---|---|---|
| `/beat` | `float bpm` | Beat event from master player |
| `/bar` | `int bar` | Bar position 1–4 |
| `/bpm` | `float bpm` | Smooth BPM tracking update |
| `/track/changed` | `str title, str artist, int player` | Track metadata |
| `/energy` | `float 0-1` | Optional energy level |

---

## PULSEFORGE — Pattern Generation

PULSEFORGE generates [Pixelblaze](https://electromage.com/pixelblaze) patterns using Claude. Patterns must conform to the PULSE contract:

- `export var bpm, beatAnchorMs, bar, masterBrightness, hueOffset, killActive`
- `render(index)` — per-pixel colour output (checks `killActive` first)
- `beforeRender(delta)` — per-frame animation update

The validator (P001–P012) checks patterns before they're pushed to hardware. The browser simulator runs them at 60fps so you can preview without hardware.

---

## Modes

| Mode | Trigger | Behaviour |
|---|---|---|
| `live` | Beat received from BLT | Full beat-sync from real BPM |
| `sensor` | BLT silent > 5s | Continues at last known BPM |
| `freerun` | No BLT ever connected | Runs at set BPM (default 128) |
| `panic` | Kill switch | All controllers → black |

Use **Mode Lock** in PULSEDECK to pin a mode and prevent automatic transitions.

---

## Bug Reports

Each page has a **⚠** button in the top bar. Clicking it captures a screenshot, recent logs, and conductor state, then saves the report to `logs/bugreports.jsonl` for offline review.

---

## Project Structure

```
PULSE/
├── conductor/
│   ├── index.js          # Main server — HTTP + WebSocket
│   ├── state.js          # Shared state object
│   ├── osc.js            # OSC receiver (BLT → Conductor)
│   ├── pixelblaze.js     # Pixelblaze WebSocket client pool
│   ├── firestorm.js      # Firestorm HTTP client
│   ├── forge.js          # PULSEFORGE Claude API proxy
│   ├── pulsemap.js       # PULSEMAP Pixelblaze proxy routes
│   ├── logger.js         # Circular log buffer
│   └── config/
│       ├── scenes.json   # Scene definitions (Q1–Q8)
│       └── topology.json # Controller/zone layout
├── public/
│   ├── index.html        # PULSEDECK
│   ├── forge/index.html  # PULSEFORGE
│   ├── map/index.html    # PULSEMAP
│   └── js/
│       ├── validator.js          # Pattern validator (P001–P012)
│       ├── bugreport.js          # Bug reporter modal
│       └── simulator/
│           ├── shim.js           # Pixelblaze runtime shim
│           ├── transpile.js      # PB source → safe JS transpiler
│           └── runtime.js        # PulseSimulator canvas renderer
├── blt/
│   ├── launch.sh          # BLT launcher script
│   └── pulse-triggers.clj # BLT OSC trigger expressions
├── catalog/               # Saved pattern JSON files
├── logs/                  # bugreports.jsonl written here
└── pulse-spec.html        # Original system specification
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | HTTP server port |
| `OSC_PORT` | `9000` | UDP port for BLT OSC messages |
| `ANTHROPIC_API_KEY` | — | Required for PULSEFORGE |
