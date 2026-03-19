# Release Checklist

## MVP Boundary

This release focuses on a usable ESP-IDF expert workflow, not full automation.

Primary capabilities:
- `safe_build`
- `resolve_component`
- `analyze_partitions`
- `decode_panic` / `analyze_monitor`

Supporting capabilities:
- `manage_env`
- `explore_demo`
- `flash_and_monitor`
- `execute_project`

Out of scope for this release:
- automatic source edits
- HIL automation
- full serial-port management UX
- deep IDE integration

## Before Publish

- [ ] Confirm `README.md` matches actual MVP scope
- [ ] Confirm `skill/SKILL.md` only documents implemented capabilities
- [ ] Run `npm test`
- [ ] Run `npm pack --dry-run`
- [ ] Manually spot-check `npx @movecall/claw-esp-expert`
- [ ] Manually spot-check one registry query via `resolve_component`
- [ ] Manually spot-check one partition overflow example
- [ ] Manually spot-check one panic decode example with a real ELF
- [ ] Review `package.json` version and publish metadata

## Manual Smoke Commands

```bash
npm test
npm pack --dry-run
printf '%s' '{"query":"led_strip","target":"esp32s3"}' | node skill/scripts/run-tool.mjs resolve_component --stdin
printf '%s' '{"projectPath":"/path/to/project","chip":"esp32s3"}' | node skill/scripts/run-tool.mjs safe_build --stdin
```
