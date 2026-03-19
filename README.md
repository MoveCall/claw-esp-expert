# 🦞 Claw-ESP-Expert

> **The definitive AI Agent Skill for ESP-IDF Developers.**  
> 懂硬件、懂网络、懂工程的专业级 ESP32 开发助理。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Platform: OpenClaw](https://img.shields.io/badge/Platform-OpenClaw.ai-blue)](https://openclaw.ai)
[![Framework: ESP-IDF](https://img.shields.io/badge/Framework-ESP--IDF%20v5.x-red)](https://github.com/espressif/esp-idf)

Claw-ESP-Expert is a diagnostic-first skill for ESP32 + ESP-IDF workflows. It focuses on the highest-value pain points in embedded development: component lookup, pin safety, build failures, partition overflow, and panic decoding.

## Install

```bash
npx @movecall/claw-esp-expert
```

Default behavior:
- installs to `~/.openclaw/workspace/skills/claw-esp-expert`
- copies a self-contained `skill/` bundle
- does not silently edit `SOUL.md`
- does not silently modify project files or system permissions

## MVP highlights

- Component guidance: query the official ESP Component Registry and generate `idf_component.yml` suggestions
- Hardware-aware safety: audit risky GPIO assignments across multiple ESP32 chip families
- Build diagnostics: classify common ESP-IDF build failures such as missing headers, component issues, partition overflow, and memory overflow
- Runtime debugging: analyze monitor logs, decode panic backtraces with `addr2line`, and support a minimal `flash + monitor` loop

## Current scope

Primary tools:
- `safe_build`
- `resolve_component`
- `analyze_partitions`
- `decode_panic` / `analyze_monitor`

Supporting tools:
- `manage_env`
- `explore_demo`
- `flash_and_monitor`
- `execute_project`

Supported chip families:
- `esp32`
- `esp32s3`
- `esp32c3`
- `esp32c5`
- `esp32c6`
- `esp32h2`
- `esp32p4`

Common SKU names are normalized to family rules, for example:
- `ESP32-S3-PICO-1-N8R2` -> `esp32s3`
- `ESP32-C6FH4` -> `esp32c6`
- `ESP32-P4NRW32X` -> `esp32p4`

## Local development

```bash
git clone https://github.com/movecall/claw-esp-expert.git
cd claw-esp-expert
npm install
npm run build
npm test
```

## Repo layout

```text
claw-esp-expert/
├── bin/          # npx installer
├── skill/        # publishable skill bundle
├── src/          # runtime source
├── scripts/      # build helpers
├── tests/        # smoke tests
├── package.json
└── README.md
```

## Notes

- This is a usable MVP, not a full automation platform
- It returns suggestions, diagnostics, and patch-style drafts before attempting deeper automation
- HIL automation and full self-healing workflows are intentionally out of scope for the first release
