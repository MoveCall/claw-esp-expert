# Changelog

## 0.0.4

- remove runtime third-party Node dependencies from the published bundle
- replace network probing and subprocess wrappers with Node built-ins
- further reduce ClawHub security scan risk by simplifying the runtime

## 0.0.3

- add `skill/package.json` so the published skill bundle declares its runtime Node dependencies
- keep ClawHub-facing metadata conservative while making the bundle more explicit about required packages

## 0.0.2

- tighten ClawHub-facing metadata and safety wording
- change install flow to return manual guidance instead of running upstream install scripts inside the skill
- keep diagnostic and execution capabilities intact while reducing distribution risk

## 0.0.1

Initial usable MVP for Claw ESP Expert.

Highlights:
- workspace-first `npx @movecall/claw-esp-expert` installer
- ClawHub-safe self-contained `skill/` bundle
- ESP-IDF environment inspection
- local example discovery with README-first summaries
- official Component Registry lookup with manifest merge draft
- multi-chip pin safety audit with family/SKU normalization
- structured build diagnostics for common ESP-IDF failure modes
- partition overflow analysis with `partitions.csv` expansion draft
- panic decoding via `addr2line`
- monitor log analysis and minimal `flash_and_monitor` workflow
- execution orchestrator for audit -> build -> flash/monitor
