# StreamSutra (स्ट्रीम सूत्रा)

> **Open-Source Bring-Your-Own-Content (BYOC) Media Player for Android**  
> *Lightweight • Resilient • TV Ergonomics • Zero Bloat*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Android](https://img.shields.io/badge/Android-5.0%2B%20(API%2021--34)-green.svg)](AndroidManifest.xml)
[![Version](https://img.shields.io/badge/Version-1.1.0-orange.svg)](AndroidManifest.xml)
[![Package](https://img.shields.io/badge/Package-org.streamsutra.app-purple.svg)](AndroidManifest.xml)
[![Tests](https://img.shields.io/badge/E2E%20Tests-207%2F207%20Passed-brightgreen.svg)](tests/)
[![Size](https://img.shields.io/badge/APK%20Size-~340%20KB-success.svg)](#building-from-source)

---

## 📖 Overview

**StreamSutra** (from Sanskrit *Sutra* — code, formula, or thread) is a clean, modern, and ultra-lightweight Android media player engineered strictly under the **Bring-Your-Own-Content (BYOC)** paradigm.

Unlike ad-infested commercial IPTV apps that lock features behind subscriptions or bundle dubious scrapers, StreamSutra delivers an ad-free, standalone hybrid engine designed for fluid playback of your own personal IPTV playlists, local `.m3u` files, and Xtream Codes accounts.

---

## ✨ Key Features

### 📡 1. Bring-Your-Own-Content (BYOC) Engine
- **Remote IPTV URLs:** Plug in any HTTPS or local LAN playlist URL (`.m3u` / `.m3u8`). Direct socket fetch bypasses web CORS restrictions.
- **Local Storage Ingestion:** Browse and load `.m3u` files directly from internal storage or SD card.
- **Xtream Codes API:** Native authentication (`Host:Port`, `Username`, `Password`) to ingest live categories and channels dynamically.
- **XMLTV EPG Guide:** Map electronic program guides seamlessly with live schedule progress bars.
- **Offline Resilient:** Instant startup via device IndexedDB caching—your channel guide is ready before network calls complete.

### 🎮 2. Exclusive Custom In-Player HUD
- **Zero Browser Control Bleed:** Standard browser media controls are completely eliminated in favor of an ergonomic, custom translucent HUD.
- **One-Tap Play / Pause:** Responsive single-tap play/pause in both portrait and fullscreen orientations.
- **Animated Center Ripple Badge:** Crisp, high-contrast play/pause indicators that confirm actions without obscuring the stream.
- **Touch Swipe Surfing:** Horizontal left/right swipe gestures in fullscreen for fast channel switching.
- **In-Player Translucent Channel Drawer:** Browse, filter, and switch between channels during fullscreen playback without interrupting the active stream.

### 📺 3. Dual Multi-View Split Screen
- **Simultaneous 2-Channel Playback:** Watch two live streams at once—side-by-side in landscape or stacked in portrait.
- **1-Tap Audio Focus:** Tap either screen to transfer audio focus instantly while keeping both video feeds live.

### 🛋 4. TV Ergonomics & Zapping
- **Quick-Flip Recents Tray:** Instant bottom bar displaying your last 8 watched channels with live channel logos and titles.
- **0–9 Remote Numeric Keypad Zapping:** Direct channel jumping via physical numeric keys or on-screen keypad with glowing OSD banner.
- **Android TV Remote Navigation:** Full hardware D-Pad support (Up, Down, Left, Right, Enter, Back) for leanback television setups.

### 🔊 5. Advanced Audio & Subtitles
- **HLS Multi-Audio Selector:** Switch on-the-fly between multi-language audio streams (Hindi, English, Tamil, Telugu, etc.).
- **Closed Caption & Subtitles:** Clean toggle for embedded HLS subtitle tracks.

### ⏱ 6. Sleep Timer
- Configurable countdown options: **15m, 30m, 60m, 120m**.
- Graceful 10-second volume fadeout before pausing playback to ensure peaceful sleep without abrupt audio cutoff.

### 🔍 7. Picture-in-Picture & Diagnostics
- **Native Picture-in-Picture (PiP):** Floating background playback with automatic aspect ratio matching.
- **Real-Time Diagnostics Console:** Built-in log terminal (`streamsutra_debug.log`) with live filtering, copy-to-clipboard, and log clearance.

---

## ⚖️ Legal & BYOC Compliance

> [!IMPORTANT]
> **StreamSutra does NOT host, scrape, provide, or distribute any copyrighted media streams, TV channels, or video content.**

- StreamSutra is purely an open-source media player software application (similar to VLC, Kodi, or mpv).
- The starter playlist bundled in this repository is strictly limited to verified, public-domain, Creative Commons, and official Free-to-Air (FTA) educational and public service broadcasts.
- Users are solely responsible for supplying their own legal streaming URLs and respecting their local copyright laws.

---

## 🛠 Architecture & Tech Stack

```
StreamSutra Architecture
┌────────────────────────────────────────────────────────┐
│               Android Native Shell (Java)              │
│  - MainActivity.java (~900 LOC)                        │
│  - Hardware-Accelerated Fullscreen WebView             │
│  - AndroidX Picture-in-Picture (PiP) Manager           │
│  - External Player & Intent Bridge                     │
│  - Native Log Writer (streamsutra_debug.log)           │
└──────────────────────────┬─────────────────────────────┘
                           │ @JavascriptInterface Bridge
┌──────────────────────────▼─────────────────────────────┐
│                 Web Application Core                   │
│  - index.html (Responsive Mobile & TV HUD)             │
│  - hls.min.js (HLS Live & VOD Protocol Engine)         │
│  - sources_engine.js (User-Configured BYOC Engine)     │
│  - tmdb_engine.js (Metadata & Artwork Discovery)       │
│  - playlist.m3u (Verified Starter Open Playlist)       │
└────────────────────────────────────────────────────────┘
```

- **App Package:** `org.streamsutra.app`
- **Minimum SDK:** Android 5.0 (API 21)
- **Target SDK:** Android 14 (API 34)
- **Binary Size:** **~340 KB** (Zero bloated native libraries)

---

## 🚀 Building from Source

StreamSutra can be built completely on an Android device via **Termux** or on any Linux / macOS workstation using standard Android SDK tools:

### Prerequisites (Termux / Linux)
```bash
# Install toolchain packages in Termux
pkg update
pkg install openjdk-17 aapt apksigner zipalign nodejs
```

### Build & Sign Release APK
```bash
# Clone the repository
git clone https://github.com/your-username/streamsutra.git
cd streamsutra

# Run automated compile and sign pipeline
bash build_apk.sh
```

Upon successful build:
- Output APK: `StreamSutra.apk` (and deployed to `/sdcard/Download/StreamSutra.apk`)
- Verified with **v1 (JAR)**, **v2**, and **v3** signature schemes
- 4-byte zipaligned

---

## 🧪 Automated Testing Suite

StreamSutra features a comprehensive 4-tier End-to-End (E2E) testing suite with **207 automated tests**:

```bash
# Run complete test suite
node tests/run_e2e_tests.js
```

```
======================================================================
   E2E EXECUTION SUMMARY MATRIX
======================================================================
   Tier 1: Feature Coverage (18 features x 5 tests)     :  90 /  90 PASSED
   Tier 2: Boundary & Corner Cases (18 features x 5)    :  90 /  90 PASSED
   Tier 3: Cross-Feature Combinations (18 pairs)        :  18 /  18 PASSED
   Tier 4: Real-World Application Scenarios (9 E2E)     :   9 /   9 PASSED
----------------------------------------------------------------------
   TOTAL TESTS EXECUTED : 207
   TOTAL TESTS PASSED   : 207
   OVERALL SUCCESS RATE : 100.0%
======================================================================
```

---

## 🐞 Reporting Bugs & Diagnostic Logs

If you encounter any stream playback error, unexpected crash, or interface issue, StreamSutra provides built-in tools to capture and export diagnostic logs:

### 1. In-App Live Diagnostic Terminal
- Tap the **`📋 Logs`** button located in the top navigation bar at any time.
- The real-time console shows live application lifecycle, WebView events, network requests, and HLS buffer status.
- Use the **Filter box** (e.g., `ERROR`, `HLS`, `Bridge`) to narrow down relevant log lines.
- Tap **`📋 Copy All`** to copy the full diagnostic trace to your device clipboard, ready to paste into a GitHub Issue.

### 2. Error Screen Quick-Access
- When a video stream fails or disconnects after retry attempts, the error overlay automatically displays a direct **`📋 View Diagnostic Logs`** shortcut.
- Tapping this button opens the log inspector immediately without losing your current channel selection.

### 3. Direct Log File on Device Storage
The native Android layer continuously mirrors all debug output to:
```
/sdcard/Download/streamsutra_debug.log
```
You can access this file using any standard Android file manager (or via USB/MTP) and attach it directly to your bug report or GitHub issue.

---

## 📄 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.
