# ZeroComp

A **zero-latency** feedforward compressor for broadcast, streaming, and live production, with four analog-flavored modes (VCA / Opto / FET / Vari-Mu). Built with JUCE + WebView (Vite / React 19 / MUI 7). Ships as **VST3 / AU / AAX / Standalone** on Windows / macOS and **VST3 / LV2 / CLAP / Standalone** on Linux, plus a WebAssembly browser demo that reuses the exact same DSP.

You can find the demo site running on WebAssembly here.
https://zerocomp-demo.web.app/

<img width="1328" height="945" alt="sc_zerocomp" src="https://github.com/user-attachments/assets/62d4e2f6-3f82-4d6a-8dab-9d793afa72b3" />

## Highlights

- **0-sample latency** — no lookahead, no oversampling. Instant attack with smoothed release envelope. Suitable for live/broadcast where monitoring delay is unacceptable.
- **Four analog modes** — VCA (clean) / Opto (slow, trailing release with LDR thermal memory) / FET (asymmetric grit) / Vari-Mu (soft knee + even-order warmth). All stay zero-latency; only envelope behaviour and post-gain saturation differ.
- **Wide dynamic range** — Threshold from 0 down to -80 dBFS, Ratio from 1:1 to 100:1 (effectively brickwall at the high end).
- **Soft knee** — 0..24 dB continuously variable knee. The displayed transfer curve stays in sync with the DSP at all times.
- **Auto Makeup** — one-click half-compensation `-threshold × (1 - 1/ratio) × 0.5`. Keeps perceived loudness up without crushing peaks to the ceiling. Output Gain still works on top as a ± trim.
- **Real-time transfer curve graph** — the center panel shows the static IN→OUT curve; the current input level appears as a blue dot riding along the curve. Auto Makeup shifts the curve up live.
- **Three-mode metering** — Input L/R, Gain Reduction, Output L/R with Peak / RMS / Momentary LKFS (ITU-R BS.1770-4) switchable from a single button.
- **Waveform display mode** — Oscilloscope (~7 sec scrollback): input envelope, threshold line, and per-sample gain-reduction reflection. Switch on the fly from the Metering / Waveform toggle in the title bar.
- **Stereo-linked gain** — L/R share the same gain envelope (computed from `max(|L|,|R|)`) so the stereo image stays intact.
- **Mobile-friendly WebAssembly demo** — the same compressor DSP runs in the browser via an `AudioWorklet`; the UI collapses into a phone-friendly single-column layout on narrow viewports.

## Layout

- Left — Threshold fader (0..-80 dB) and Ratio fader (1:1..100:1, log skew, 1:1 at top).
- Center-left — Real-time transfer curve graph (threshold marker, current operating dot, Auto Makeup shift).
- Center-right — Input / GR / Output meters with a single Peak/RMS/Momentary toggle below them.
- Right — Output Gain fader (-24..+24 dB). Stays active even when Auto Makeup is on, acting as a trim.
- Bottom left — Knee slider and Mode selector (VCA / Opto / FET / Vari-Mu).
- Bottom right — Attack and Release sliders.

The plugin window is resizable (minimum 520 × 390, default 720 × 500).

## Modes

| Mode | Character | Implementation |
| --- | --- | --- |
| **VCA** | Clean, transparent | Single envelope, no colouration. The default. |
| **Opto** | Slow, trailing release | Dual envelope (`fast` + `slow = release × 5`) with `max(GR)` fed out. **LDR thermal memory**: an internal `ldrHeat` state tracks recent GR and pushes the slow envelope toward a longer `release × 15` tail after sustained compression, then cools over ~3 s. |
| **FET** | Asymmetric grit | Subtle post-gain asymmetric `tanh` clipper. |
| **Vari-Mu** | Soft knee + even-order warmth | Knee widens by +12 dB internally; post-gain `sign(x) · x²` wave-shaper adds gentle tube-like harmonics. |

## Requirements

- CMake 3.22+
- C++17 toolchain
  - Windows: Visual Studio 2022 with the C++ workload
  - macOS: Xcode 14+
  - Linux: gcc 13+ / clang + the apt packages listed under [Building on Linux](#building-on-linux)
- Node.js 18+ and npm (for the WebUI)
- JUCE (included as a submodule)
- `clap-juce-extensions` (also a git submodule, used only for the Linux CLAP target)
- Optional: AAX SDK for Pro Tools builds (drop at `aax-sdk/`)
- Optional: Inno Setup 6 for the Windows installer
- Optional: [Emscripten](https://emscripten.org) for the WebAssembly demo

## Getting started

```bash
# 1. Clone with submodules
git clone <this-repo>
cd ZeroComp
git submodule update --init --recursive

# 2. WebUI dependencies
cd webui && npm install && cd ..

# 3. Build (Windows, Release distribution)
powershell -ExecutionPolicy Bypass -File build_windows.ps1 -Configuration Release
# → produces releases/<VERSION>/ZeroComp_<VERSION>_Windows_VST3_AAX_Standalone.zip
#   and (if Inno Setup 6 is installed) ZeroComp_<VERSION>_Windows_Setup.exe

# 4. Build (macOS)
./build_macos.zsh

# 5. Build (Linux — see "Building on Linux" below)
bash build_linux.sh
```

### Building on Linux

Tested on **WSL2 Ubuntu 24.04**, but should work on any modern glibc-based distro with `webkit2gtk-4.1` available.

```bash
sudo apt update
sudo apt install -y \
  build-essential pkg-config cmake ninja-build git \
  libasound2-dev libjack-jackd2-dev libcurl4-openssl-dev \
  libfreetype-dev libfontconfig1-dev \
  libx11-dev libxcomposite-dev libxcursor-dev libxext-dev \
  libxinerama-dev libxrandr-dev libxrender-dev \
  libwebkit2gtk-4.1-dev libglu1-mesa-dev mesa-common-dev libgtk-3-dev

git submodule update --init --recursive   # JUCE + clap-juce-extensions
bash build_linux.sh                        # Release VST3 / LV2 / CLAP / Standalone + zip
```

Output:

- Build artefacts: `build-linux/plugin/ZeroComp_artefacts/Release/{VST3,LV2,CLAP,Standalone}/`
- Auto-installed: `~/.vst3/ZeroComp.vst3`, `~/.lv2/ZeroComp.lv2`, `~/.clap/ZeroComp.clap`
- Distribution zip: `releases/<VERSION>/ZeroComp_<VERSION>_Linux_VST3_LV2_CLAP_Standalone.zip`

LV2 and CLAP are gated behind `if(UNIX AND NOT APPLE)` in CMake, so existing Windows / macOS release flows are unaffected. AU and AAX are skipped on Linux as expected.

### Manual CMake build (for development)

```bash
# Windows (Debug)
cmake -B build -G "Visual Studio 17 2022" -A x64
cmake --build build --config Debug --target ZeroComp_VST3

# macOS (Debug)
cmake -B build -G Xcode
cmake --build build --config Debug --target ZeroComp_VST3
```

### Development mode (hot-reload WebUI)

```bash
# Terminal A: Vite dev server
cd webui && npm run dev

# Terminal B: Debug build of the plugin
cmake --build build --config Debug --target ZeroComp_Standalone
```

Debug builds load the WebUI from `http://127.0.0.1:5173`. Release builds embed the bundled assets via `juce_add_binary_data`.

### Web demo (WebAssembly)

The same C++ compressor DSP is compiled to WebAssembly and driven by an `AudioWorklet` in the browser. The React UI is reused verbatim; a Vite alias swaps `juce-framework-frontend-mirror` for a local shim that owns parameter state and forwards changes to the AudioWorklet.

```bash
# Build the WASM module (requires emsdk activated in the shell)
cd wasm
bash build.sh        # emits webui/public-web/wasm/zerocomp_dsp.wasm

# Start the web-demo dev server
cd ../webui
npm run dev:web      # http://127.0.0.1:5174

# Production bundle
npm run build:web    # dist/ ready for static hosting

# Firebase Hosting deploy
npm run deploy:web   # requires firebase CLI + zerocomp-demo project
```

At 640 px or narrower, the web UI rearranges itself: graph + meters on top, the three vertical faders on the second row, and the horizontal Knee / Mode / Attack / Release sliders stacked below.

## Parameters

| ID              | Type                 | Range / Values                 | Default  | Notes                                                                                     |
| --------------- | -------------------- | ------------------------------ | -------- | ----------------------------------------------------------------------------------------- |
| `THRESHOLD`     | float (dB)           | -80 .. 0                       | 0 dB     | Gain reduction starts at the threshold (with soft knee).                                  |
| `RATIO`         | float (log skew)     | 1 .. 100                       | 1.0      | 1:1 = off, 100:1 ≈ brickwall.                                                             |
| `KNEE_DB`       | float (dB)           | 0 .. 24                        | 6.0      | Soft-knee width. 0 = hard knee.                                                           |
| `ATTACK_MS`     | float (ms, log skew) | 0.1 .. 500                     | 10.0     | Envelope attack time constant.                                                            |
| `RELEASE_MS`    | float (ms, log skew) | 0.1 .. 2000                    | 100.0    | Envelope release time constant.                                                           |
| `OUTPUT_GAIN`   | float (dB)           | -24 .. +24                     | 0 dB     | Post-compression trim. Stays active when Auto Makeup is on (adds on top as ± trim).       |
| `AUTO_MAKEUP`   | bool                 | off / on                       | off      | Half-compensation makeup: `-threshold × (1 - 1/ratio) × 0.5`. Displayed on the curve too. |
| `MODE`          | choice               | VCA / Opto / FET / Vari-Mu     | VCA      | Envelope behaviour + post-gain saturation character.                                      |
| `METERING_MODE` | choice               | Peak / RMS / Momentary         | Peak     | Display mode for IN / OUT meters. Forced to Peak in Waveform view.                         |
| `DISPLAY_MODE`  | choice               | Metering / Waveform            | Metering | Center-panel visual: transfer curve + meters vs. oscilloscope waveform.                    |

## DSP details

### Static curve

Giannoulis / Massberg / Reiss (2012):

```
       x                                  (x < T - K/2)
y =    x + (1 - 1/R) · (x - T + K/2)²/2K  (|x - T| ≤ K/2)
       x + (1 - 1/R) · (x - T)            (x > T + K/2)
```

where `x` is input dB, `y` is output dB, `T` is threshold, `R` is ratio, `K` is knee width. Gain reduction `GR = x - y` is always non-negative.

### Envelope

`coeff = exp(-1 / (tau × fs))` is applied on the GR signal, with `tau = attack` while the target is rising (compressor engaging) and `tau = release` while falling. The applied linear gain is `10^(-envelope/20)` and is shared across channels for stereo-linked behaviour.

### Opto LDR memory

For the Opto mode, a second parallel envelope runs with `tau_slow = release × 5`, and the operating gain reduction is taken as `max(fast, slow)` — so long-tail reductions linger. On top of that, a slow heat state `ldrHeat ∈ [0, 1]` tracks recent GR with a 1 s heat-up / 3 s cool-down time constant, and when it is hot the slow-envelope release coefficient is interpolated toward a "sticky" value equivalent to `release × 15`. The net effect mirrors the thermal behaviour of the T4B photocell in an LA-2A: sustained loud material leaves the compressor hanging on noticeably longer.

### Auto Makeup

```
makeup_dB = -threshold × (1 - 1/ratio) × 0.5
```

Half of the full compensation that would bring a 0 dBFS peak exactly back to 0 dBFS. Keeps perceived loudness up while leaving a few dB of headroom. `OUTPUT_GAIN` is summed on top, so users can still trim ±24 dB around the makeup.

## Waveform display mode

The center panel can be toggled between the transfer-curve / meter layout and oscilloscope view via the `Metering / Waveform` switch at the top of the plugin window.

- **Waveform envelope (cyan)** — pre-compressor input peaks, merged L/R absolute value, downsampled to 200 Hz slices (~5 ms/slice) and scrolled right-to-left over a 7-second window.
- **Threshold line (white, dashed)** — horizontal indicator that tracks the current Threshold parameter (clamped to the visible -60..0 dB range).
- **Above-threshold region (light gray)** — the portion of the virtual input envelope that would cross threshold. Rendered as a muted overlay.
- **Gain-reduction reflection (red)** — mirrored below the threshold line in real-time. Depth at each slice is the *actual* per-sample gain the compressor applied, so the envelope faithfully reflects attack/release behaviour — including Opto LDR memory.
- **Right-side strip** — a thin GR bar and a single merged-L/R OUT meter remain visible so level and reduction can still be read at a glance. Metering mode is pinned to Peak here.
- **Performance** — canvas drawing is paused during window resize to keep drag interactions smooth; it resumes automatically once the ResizeObserver settles.

Internally the compressor writes per-sample gain to a scratch buffer that is then aggregated into slices, so the visualization resolution is decoupled from the DAW's block size.

## Latency verification

ZeroComp reports **0 samples** to the host. To confirm empirically in your DAW:

1. Open the plugin info / delay compensation display — e.g. in Cubase the MixConsole insert header shows `Latency: 0 samples`.
2. Null test — duplicate a clip on two tracks; insert ZeroComp on one with Threshold 0 dB (nothing triggers); invert polarity on the other; sum. The result is silence.

## Host compatibility notes

- **Pro Tools (AAX) on Windows**: the editor injects `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--force-device-scale-factor=1` before constructing WebView2 so the UI renders at 1× inside Pro Tools' DPI-virtualised window. It also defers a `setSize()` enforcement on the next message-loop iteration to overcome hosts that open the plugin below the declared minimum size.
- **All hosts**: a per-monitor DPI poll runs on a 30 Hz timer and forces a re-layout when the DPI scale factor changes (useful when dragging the plugin window between monitors).

## Directory layout

```
ZeroComp/
├─ plugin/              # JUCE plugin (C++)
│  ├─ src/
│  │  ├─ PluginProcessor.*        # APVTS, DSP chain entry
│  │  ├─ PluginEditor.*           # WebView init, Web↔APVTS relays, DPI polling
│  │  ├─ ParameterIDs.h
│  │  ├─ KeyEventForwarder.*      # WebView → host DAW key forwarding
│  │  └─ dsp/
│  │     ├─ Compressor.*          # Zero-latency feedforward compressor (4 modes + LDR memory)
│  │     └─ MomentaryProcessor.*  # ITU-R BS.1770-4 Momentary LKFS
│  └─ CMakeLists.txt
├─ wasm/                # C++ DSP ported to pure-standard-library for Emscripten
│  ├─ src/
│  │  ├─ wasm_exports.cpp         # C ABI consumed by the AudioWorklet
│  │  ├─ dsp_engine.h             # Orchestrator (source, transport, meters)
│  │  ├─ compressor.h             # Pure-C++ port of Compressor (identical behaviour)
│  │  └─ momentary_processor.h    # Pure-C++ port of MomentaryProcessor
│  ├─ CMakeLists.txt
│  └─ build.sh                    # emcmake + emmake, copies to webui/public-web/wasm/
├─ webui/               # Vite + React 19 + MUI 7 frontend (plugin + web demo)
│  ├─ src/
│  │  ├─ App.tsx                  # Layout, meter event routing, responsive breakpoints
│  │  ├─ components/
│  │  │  ├─ ParameterFader.tsx    # Vertical fader (linear / log skew, inverted option)
│  │  │  ├─ HorizontalParameter.tsx
│  │  │  ├─ ModeSelector.tsx      # Tab-style toggle for VCA / Opto / FET / Vari-Mu
│  │  │  ├─ RatioGraph.tsx        # Real-time transfer curve with operating-point dot
│  │  │  ├─ VUMeter.tsx           # Peak / RMS / Momentary meters
│  │  │  ├─ WebTransportBar.tsx   # Web-demo only: play / pause / seek / loop / bypass / file upload
│  │  │  └─ ...
│  │  ├─ bridge/juce.ts           # Plugin: juce-framework-frontend-mirror wrapper
│  │  ├─ bridge/web/              # Web demo: Vite alias targets
│  │  │  ├─ WebAudioEngine.ts     # AudioContext + worklet bridge
│  │  │  ├─ juce-shim.ts          # Parameter-state drop-in for the frontend-mirror API
│  │  │  └─ ...
│  │  └─ hooks/useJuceParam.ts    # Reactive APVTS subscription (useSyncExternalStore)
│  ├─ public-web/                 # Web-demo static assets (WASM, worklet, sample.mp3)
│  ├─ vite.config.ts              # Plugin build (embedded into the native binary)
│  ├─ vite.config.web.ts          # Web-demo SPA build
│  ├─ firebase.json / .firebaserc # Firebase Hosting config (project: zerocomp-demo)
│  └─ package.json
├─ cmake/               # Version.cmake, icon
├─ scripts/             # AAX signing helper, WebView2 download, etc.
├─ JUCE/                # Submodule
├─ aax-sdk/             # Optional — place the AAX SDK here to enable AAX builds
├─ installer.iss        # Inno Setup script for Windows installer
├─ build_windows.ps1    # Windows release build pipeline (WebUI + VST3 / AAX / Standalone + signing + installer)
├─ build_macos.zsh      # macOS release build pipeline
├─ VERSION              # Single source of truth for the version string
└─ LICENSE
```

## License

Plugin source: see `LICENSE`. Third-party SDKs (JUCE / VST3 / AAX / WebView2 etc.) are licensed separately; see the *Licenses* dialog inside the plugin UI for the runtime dependency list.

## Credits

Developed by **Jun Murakami**. Built on **JUCE** with an embedded **WebView2 / WKWebView** frontend, and a WebAssembly build of the same DSP for the browser demo.
