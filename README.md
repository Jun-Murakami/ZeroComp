# ZeroComp

A **zero-latency** feedforward compressor for broadcast, streaming, and live production. Built with JUCE + WebView (Vite / React 19 / MUI 7). Ships as VST3 / AU / AAX / Standalone.

## Highlights

- **0-sample latency** — no lookahead. Instant attack with smoothed release envelope. Suitable for live/broadcast where monitoring delay is unacceptable.
- **Wide dynamic range** — Threshold from 0 down to -80 dBFS, Ratio from 1:1 to 100:1 (effectively brickwall at the high end).
- **Soft knee** — 0..24 dB continuously variable knee. The displayed transfer curve stays in sync with the DSP at all times.
- **Real-time transfer curve graph** — the center panel shows the static IN→OUT curve with the current input peak (red) and output peak (yellow) overlaid.
- **Three-mode metering** — Input L/R, Gain Reduction, Output L/R with Peak / RMS / Momentary LKFS (ITU-R BS.1770-4) switchable from a single button.
- **Stereo-linked gain** — L/R share the same gain envelope (computed from `max(|L|,|R|)`) so the stereo image stays intact.
- **Formats**: VST3, AU (macOS), AAX (when the SDK is present), Standalone.

## Layout

- Left — Threshold fader (0..-80 dB) and Ratio fader (1:1..100:1, log skew).
- Center — Transfer curve graph, Input meter, Gain Reduction meter, Output meter.
- Right — Output Gain fader (-24..+24 dB).
- Bottom — Horizontal sliders for Knee, Attack, Release.

The plugin window is resizable (minimum 540 × 440, default 620 × 480).

## Requirements

- CMake 3.22+
- C++17 toolchain
  - Windows: Visual Studio 2022 with the C++ workload
  - macOS: Xcode 14+
- Node.js 18+ and npm (for the WebUI)
- JUCE (included as a submodule)
- Optional: AAX SDK for Pro Tools builds (drop at `aax-sdk/`)
- Optional: Inno Setup 6 for the Windows installer

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
```

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

## Parameters

| ID              | Type                 | Range / Values         | Default  | Notes                                                       |
| --------------- | -------------------- | ---------------------- | -------- | ----------------------------------------------------------- |
| `THRESHOLD`     | float (dB)           | -80 .. 0               | 0 dB     | Gain reduction starts at the threshold (with soft knee).    |
| `RATIO`         | float (log skew)     | 1 .. 100               | 4.0      | 1:1 = off, 100:1 ≈ brickwall.                               |
| `KNEE_DB`       | float (dB)           | 0 .. 24                | 6.0      | Soft-knee width. 0 = hard knee.                             |
| `ATTACK_MS`     | float (ms, log skew) | 0.1 .. 500             | 10.0     | Envelope attack time constant.                              |
| `RELEASE_MS`    | float (ms, log skew) | 0.1 .. 2000            | 100.0    | Envelope release time constant.                             |
| `OUTPUT_GAIN`   | float (dB)           | -24 .. +24             | 0 dB     | Post-compression trim.                                      |
| `METERING_MODE` | choice               | Peak / RMS / Momentary | Peak     | Display mode for IN / OUT meters.                           |

## DSP details

The static curve follows Giannoulis / Massberg / Reiss (2012):

```
       x                                  (x < T - K/2)
y =    x + (1 - 1/R) · (x - T + K/2)²/2K  (|x - T| ≤ K/2)
       x + (1 - 1/R) · (x - T)            (x > T + K/2)
```

where `x` is input dB, `y` is output dB, `T` is threshold, `R` is ratio, `K` is knee width. Gain reduction `GR = x - y` is always non-negative.

The envelope applies `coeff = exp(-1/(tau · fs))` on the GR signal, with `tau = attack` while the target is rising (compressor engaging) and `tau = release` while falling. The applied linear gain is `10^(-envelope/20)` and is shared across channels for stereo-linked behaviour.

## Latency verification

ZeroComp reports **0 samples** to the host. To confirm empirically in your DAW:

1. Open the plugin info / delay compensation display — e.g. in Cubase the MixConsole insert header shows `Latency: 0 samples`.
2. Null test — duplicate a clip on two tracks; insert ZeroComp on one with Threshold 0 dB (nothing triggers); invert polarity on the other; sum. The result is silence.

## Directory layout

```
ZeroComp/
├─ plugin/              # JUCE plugin (C++)
│  ├─ src/
│  │  ├─ PluginProcessor.*        # APVTS, DSP chain entry
│  │  ├─ PluginEditor.*           # WebView init, Web↔APVTS relays
│  │  ├─ ParameterIDs.h
│  │  ├─ KeyEventForwarder.*      # WebView → host DAW key forwarding
│  │  └─ dsp/
│  │     ├─ Compressor.*          # Zero-latency feedforward compressor
│  │     └─ MomentaryProcessor.*  # ITU-R BS.1770-4 Momentary LKFS
│  └─ CMakeLists.txt
├─ webui/               # Vite + React 19 + MUI 7 frontend
│  ├─ src/
│  │  ├─ App.tsx
│  │  ├─ components/{ParameterFader,HorizontalParameter,RatioGraph,VUMeter,LicenseDialog,...}.tsx
│  │  ├─ hooks/{useJuceParam,useHostShortcutForwarding,...}.ts
│  │  └─ bridge/juce.ts
│  └─ package.json
├─ cmake/               # Version.cmake, icon
├─ scripts/             # AAX signing helper, WebView2 download, etc.
├─ JUCE/                # Submodule
├─ aax-sdk/             # Optional — place the AAX SDK here to enable AAX builds
├─ installer.iss        # Inno Setup script for Windows installer
├─ build_windows.ps1    # Windows release build pipeline
├─ build_macos.zsh      # macOS release build pipeline
├─ VERSION              # Single source of truth for the version string
└─ LICENSE
```

## License

Plugin source: see `LICENSE`. Third-party SDKs (JUCE / VST3 / AAX / WebView2 etc.) are licensed separately; see the *Licenses* dialog inside the plugin UI for the runtime dependency list.

## Credits

Developed by **Jun Murakami**. Built on **JUCE** with an embedded **WebView2 / WKWebView** frontend.
