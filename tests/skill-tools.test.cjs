const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { skillTools } = require('../dist/index.js');
const { ComponentRegistry } = require('../dist/registry/ComponentRegistry.js');
const { ComponentManifestManager } = require('../dist/registry/ComponentManifest.js');
const { PartitionAdvisor } = require('../dist/build/PartitionAdvisor.js');
const { MonitorAnalyzer } = require('../dist/monitor/MonitorAnalyzer.js');
const { PanicDecoder } = require('../dist/monitor/PanicDecoder.js');

async function withEnv(overrides, fn) {
  const snapshot = {};

  for (const [key, value] of Object.entries(overrides)) {
    snapshot[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(snapshot)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeExecutable(filePath, content) {
  fs.writeFileSync(filePath, content);
  fs.chmodSync(filePath, 0o755);
}

function createFakeIdfPy(binDir) {
  if (process.platform === 'win32') {
    const filePath = path.join(binDir, 'idf.py.cmd');
    writeExecutable(filePath, '@echo off\r\nexit /b 0\r\n');
    return filePath;
  }

  const filePath = path.join(binDir, 'idf.py');
  writeExecutable(filePath, '#!/bin/sh\nexit 0\n');
  return filePath;
}

function createScriptedIdfPy(binDir, stderrLines, exitCode = 1) {
  if (process.platform === 'win32') {
    const filePath = path.join(binDir, 'idf.py.cmd');
    writeExecutable(filePath, [
      '@echo off',
      'if "%1"=="--version" exit /b 0',
      ...stderrLines.map((line) => `echo ${line} 1>&2`),
      `exit /b ${exitCode}`
    ].join('\r\n'));
    return filePath;
  }

  const filePath = path.join(binDir, 'idf.py');
  writeExecutable(filePath, [
    '#!/bin/sh',
    'if [ "$1" = "--version" ]; then',
    '  exit 0',
    'fi',
    ...stderrLines.map((line) => `printf "%s\\n" "${line.replace(/"/g, '\\"')}" 1>&2`),
    `exit ${exitCode}`
  ].join('\n'));
  return filePath;
}

function createProjectWithSource(source) {
  return createProjectWithFiles({
    'main/main.c': source
  });
}

function createProjectWithFiles(files) {
  const projectDir = makeTempDir('claw-idf-project-');
  fs.writeFileSync(path.join(projectDir, 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.16)\n');

  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(projectDir, relativePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, content);
  }

  return projectDir;
}

function runNodeScript(scriptPath, args, options = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf8',
    ...options
  });
}

test('skillTools exports the expected MVP tools', () => {
  assert.equal(typeof skillTools.manage_env, 'function');
  assert.equal(typeof skillTools.explore_demo, 'function');
  assert.equal(typeof skillTools.resolve_component, 'function');
  assert.equal(typeof skillTools.analyze_partitions, 'function');
  assert.equal(typeof skillTools.decode_panic, 'function');
  assert.equal(typeof skillTools.analyze_monitor, 'function');
  assert.equal(typeof skillTools.flash_and_monitor, 'function');
  assert.equal(typeof skillTools.execute_project, 'function');
  assert.equal(typeof skillTools.safe_build, 'function');
});

test('monitor analyzer returns NO_PANIC for normal monitor output', async () => {
  const analyzer = new MonitorAnalyzer();
  const result = await analyzer.analyze({
    chip: 'esp32s3',
    log: [
      'I (123) app_main: boot ok',
      'I (456) wifi: connected',
      'I (789) sensor: sample=42'
    ].join('\n')
  });

  assert.equal(result.status, 'NO_PANIC');
  assert.equal(result.markers.length, 0);
});

test('monitor analyzer detects panic markers without ELF', async () => {
  const analyzer = new MonitorAnalyzer();
  const result = await analyzer.analyze({
    chip: 'esp32s3',
    log: [
      "Guru Meditation Error: Core  0 panic'ed (StoreProhibited). Exception was unhandled.",
      'Backtrace: 0x42012345:0x3fca1000'
    ].join('\n')
  });

  assert.equal(result.status, 'PANIC_DETECTED');
  assert.equal(result.markers.includes('guru_meditation'), true);
  assert.equal(result.markers.includes('backtrace'), true);
});

test('analyze_monitor can chain into panic decoding when ELF is present', async () => {
  const fakeHome = makeTempDir('claw-idf-home-');
  const fakeBin = makeTempDir('claw-idf-bin-');
  const elfPath = path.join(fakeHome, 'app.elf');
  fs.writeFileSync(elfPath, 'fake-elf');

  if (process.platform === 'win32') {
    const filePath = path.join(fakeBin, 'xtensa-esp32s3-elf-addr2line.cmd');
    writeExecutable(filePath, [
      '@echo off',
      'echo 0x42012345: app_main at /tmp/main.c:42',
      'echo /tmp/main.c:42'
    ].join('\r\n'));
  } else {
    const filePath = path.join(fakeBin, 'xtensa-esp32s3-elf-addr2line');
    writeExecutable(filePath, [
      '#!/bin/sh',
      'echo "0x42012345: app_main at /tmp/main.c:42"',
      'echo "/tmp/main.c:42"'
    ].join('\n'));
  }

  await withEnv({
    HOME: fakeHome,
    USERPROFILE: fakeHome,
    PATH: fakeBin
  }, async () => {
    const result = await skillTools.analyze_monitor({
      chip: 'esp32s3',
      elfPath,
      log: [
        'I (123) boot: starting monitor',
        "Guru Meditation Error: Core  0 panic'ed (StoreProhibited). Exception was unhandled.",
        'Backtrace: 0x42012345:0x3fca1000'
      ].join('\n')
    });

    assert.equal(result.status, 'PANIC_DECODED');
    assert.equal(result.panic.status, 'OK');
    assert.equal(result.panic.decodedFrames[0].function, 'app_main');
  });
});

test('flash_and_monitor captures logs and chains into monitor analysis', async () => {
  const fakeHome = makeTempDir('claw-idf-home-');
  const fakeBin = makeTempDir('claw-idf-bin-');
  const elfPath = path.join(fakeHome, 'app.elf');
  fs.writeFileSync(elfPath, 'fake-elf');

  if (process.platform === 'win32') {
    writeExecutable(path.join(fakeBin, 'idf.py.cmd'), [
      '@echo off',
      'if "%1"=="--version" exit /b 0',
      'echo Flashing... 1>&2',
      "echo Guru Meditation Error: Core  0 panic'ed (StoreProhibited). Exception was unhandled. 1>&2",
      'echo Backtrace: 0x42012345:0x3fca1000 1>&2',
      'exit /b 1'
    ].join('\r\n'));
    writeExecutable(path.join(fakeBin, 'xtensa-esp32s3-elf-addr2line.cmd'), [
      '@echo off',
      'echo 0x42012345: app_main at /tmp/main.c:42',
      'echo /tmp/main.c:42'
    ].join('\r\n'));
  } else {
    writeExecutable(path.join(fakeBin, 'idf.py'), [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then',
      '  exit 0',
      'fi',
      'printf "%s\\n" "Flashing..." 1>&2',
      "printf \"%s\\n\" \"Guru Meditation Error: Core  0 panic'ed (StoreProhibited). Exception was unhandled.\" 1>&2",
      'printf "%s\\n" "Backtrace: 0x42012345:0x3fca1000" 1>&2',
      'exit 1'
    ].join('\n'));
    writeExecutable(path.join(fakeBin, 'xtensa-esp32s3-elf-addr2line'), [
      '#!/bin/sh',
      'echo "0x42012345: app_main at /tmp/main.c:42"',
      'echo "/tmp/main.c:42"'
    ].join('\n'));
  }

  const projectDir = createProjectWithSource('void app_main(void) {}\n');

  await withEnv({
    HOME: fakeHome,
    USERPROFILE: fakeHome,
    PATH: fakeBin
  }, async () => {
    const result = await skillTools.flash_and_monitor({
      projectPath: projectDir,
      chip: 'esp32s3',
      elfPath,
      port: '/dev/ttyUSB0'
    });

    assert.equal(result.status, 'FAILED');
    assert.equal(result.stage, 'flash_monitor');
    assert.equal(typeof result.stageSummary, 'string');
    assert.equal(Array.isArray(result.logTail), true);
    assert.equal(result.logTail.some((line) => line.includes('Backtrace:')), true);
    assert.equal(result.durationMs >= 0, true);
    assert.equal(result.analysis.status, 'PANIC_DECODED');
    assert.equal(result.analysis.panic.status, 'OK');
  });
});

test('flash_and_monitor classifies permission failures on serial ports', async () => {
  const fakeHome = makeTempDir('claw-idf-home-');
  const fakeBin = makeTempDir('claw-idf-bin-');
  const projectDir = createProjectWithSource('void app_main(void) {}\n');

  if (process.platform === 'win32') {
    writeExecutable(path.join(fakeBin, 'idf.py.cmd'), [
      '@echo off',
      'if "%1"=="--version" exit /b 0',
      'echo failed to open port COM5: Access is denied. 1>&2',
      'exit /b 1'
    ].join('\r\n'));
  } else {
    writeExecutable(path.join(fakeBin, 'idf.py'), [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then',
      '  exit 0',
      'fi',
      'printf "%s\\n" "failed to open port /dev/ttyUSB0: Permission denied" 1>&2',
      'exit 1'
    ].join('\n'));
  }

  await withEnv({
    HOME: fakeHome,
    USERPROFILE: fakeHome,
    PATH: fakeBin
  }, async () => {
    const result = await skillTools.flash_and_monitor({
      projectPath: projectDir,
      chip: 'esp32s3',
      port: process.platform === 'win32' ? 'COM5' : '/dev/ttyUSB0'
    });

    assert.equal(result.status, 'FAILED');
    assert.equal(result.stage, 'flash_monitor');
    assert.equal(result.failureCategory, 'PORT_PERMISSION');
  });
});

test('flash_and_monitor classifies monitor timeouts', async () => {
  const fakeHome = makeTempDir('claw-idf-home-');
  const fakeBin = makeTempDir('claw-idf-bin-');
  const projectDir = createProjectWithSource('void app_main(void) {}\n');

  if (process.platform === 'win32') {
    writeExecutable(path.join(fakeBin, 'idf.py.cmd'), [
      '@echo off',
      'if "%1"=="--version" exit /b 0',
      ':loop',
      'goto loop'
    ].join('\r\n'));
  } else {
    writeExecutable(path.join(fakeBin, 'idf.py'), [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then',
      '  exit 0',
      'fi',
      'while :; do :; done'
    ].join('\n'));
  }

  await withEnv({
    HOME: fakeHome,
    USERPROFILE: fakeHome,
    PATH: fakeBin
  }, async () => {
    const result = await skillTools.flash_and_monitor({
      projectPath: projectDir,
      chip: 'esp32s3',
      timeoutMs: 200
    });

    assert.equal(result.status, 'FAILED');
    assert.equal(result.stageSummary.includes('超时'), true);
    assert.equal(result.failureCategory, 'TIMEOUT');
  });
});

test('execute_project returns REJECTED when hardware audit blocks the run', async () => {
  const fakeHome = makeTempDir('claw-idf-home-');
  const fakeBin = makeTempDir('claw-idf-bin-');
  createFakeIdfPy(fakeBin);
  const projectDir = createProjectWithSource([
    '#include "driver/gpio.h"',
    'void app_main(void) {',
    '  gpio_set_level(GPIO_NUM_6, 1);',
    '}'
  ].join('\n'));

  await withEnv({
    HOME: fakeHome,
    USERPROFILE: fakeHome,
    PATH: fakeBin
  }, async () => {
    const result = await skillTools.execute_project({
      projectPath: projectDir,
      chip: 'esp32'
    });

    assert.equal(result.status, 'REJECTED');
    assert.equal(result.summary.includes('硬件物理规则冲突'), true);
  });
});

test('execute_project returns BUILD_FAILED on partition overflow', async () => {
  const fakeHome = makeTempDir('claw-idf-home-');
  const fakeBin = makeTempDir('claw-idf-bin-');
  const errorLog = [
    'Building...',
    "Error: app partition is too small for binary app.bin size 0x135ae0: Part 'factory' 0/0 @ 0x10000 size 0x100000 (overflow 0x35ae0)"
  ].join('\n');

  if (process.platform === 'win32') {
    writeExecutable(path.join(fakeBin, 'idf.py.cmd'), [
      '@echo off',
      'if "%1"=="--version" exit /b 0',
      `echo ${errorLog.replace(/\n/g, '\r\necho ')} 1>&2`,
      'exit /b 1'
    ].join('\r\n'));
  } else {
    writeExecutable(path.join(fakeBin, 'idf.py'), [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then',
      '  exit 0',
      'fi',
      `printf '%s\\n' "${errorLog.replace(/"/g, '\\"').replace(/\n/g, '" "')}" 1>&2`,
      'exit 1'
    ].join('\n'));
  }

  const projectDir = createProjectWithFiles({
    'main/main.c': 'void app_main(void) {}\n',
    'partitions.csv': [
      '# Name, Type, SubType, Offset, Size, Flags',
      'nvs,data,nvs,0x9000,0x6000,',
      'factory,app,factory,0x10000,1M,',
      'storage,data,spiffs,0x110000,0xF0000,'
    ].join('\n')
  });

  await withEnv({
    HOME: fakeHome,
    USERPROFILE: fakeHome,
    PATH: fakeBin
  }, async () => {
    const result = await skillTools.execute_project({
      projectPath: projectDir,
      chip: 'esp32'
    });

    assert.equal(result.status, 'BUILD_FAILED');
    assert.equal(result.build.errorType, 'PARTITION_OVERFLOW');
  });
});

test('panic decoder extracts reason and backtrace addresses from Xtensa panic logs', () => {
  const decoder = new PanicDecoder();
  const log = [
    "Guru Meditation Error: Core  0 panic'ed (StoreProhibited). Exception was unhandled.",
    'PC      : 0x42012345  PS      : 0x00060030  A0      : 0x8200abcd  A1      : 0x3fca1000',
    'EXCVADDR: 0x00000000',
    'Backtrace: 0x42012345:0x3fca1000 0x4200abcd:0x3fca1020'
  ].join('\n');

  const result = decoder.decodeAddresses(log);

  assert.equal(result.reason, 'StoreProhibited');
  assert.equal(result.registers.PC, '0x42012345');
  assert.deepEqual(result.addresses.slice(0, 2), ['0x42012345', '0x4200abcd']);
});

test('panic decoder extracts RISC-V style MEPC/RA addresses', () => {
  const decoder = new PanicDecoder();
  const log = [
    "Guru Meditation Error: Core  0 panic'ed (IllegalInstruction). Exception was unhandled.",
    'MEPC    : 0x42006f12  RA      : 0x42004123  SP      : 0x3fcb2000',
    'MTVAL   : 0x00000000'
  ].join('\n');

  const result = decoder.decodeAddresses(log);

  assert.equal(result.reason, 'IllegalInstruction');
  assert.equal(result.registers.MEPC, '0x42006f12');
  assert.equal(result.addresses.includes('0x42006f12'), true);
  assert.equal(result.addresses.includes('0x42004123'), true);
});

test('decode_panic returns decoded frames with a fake addr2line binary', async () => {
  const fakeHome = makeTempDir('claw-idf-home-');
  const fakeBin = makeTempDir('claw-idf-bin-');
  const elfPath = path.join(fakeHome, 'app.elf');
  fs.writeFileSync(elfPath, 'fake-elf');

  if (process.platform === 'win32') {
    const filePath = path.join(fakeBin, 'xtensa-esp32s3-elf-addr2line.cmd');
    writeExecutable(filePath, [
      '@echo off',
      'echo 0x42012345: app_main at /tmp/main.c:42',
      'echo /tmp/main.c:42'
    ].join('\r\n'));
  } else {
    const filePath = path.join(fakeBin, 'xtensa-esp32s3-elf-addr2line');
    writeExecutable(filePath, [
      '#!/bin/sh',
      'echo "0x42012345: app_main at /tmp/main.c:42"',
      'echo "/tmp/main.c:42"'
    ].join('\n'));
  }

  await withEnv({
    HOME: fakeHome,
    USERPROFILE: fakeHome,
    PATH: fakeBin
  }, async () => {
    const result = await skillTools.decode_panic({
      chip: 'esp32s3',
      elfPath,
      log: [
        "Guru Meditation Error: Core  0 panic'ed (StoreProhibited). Exception was unhandled.",
        'Backtrace: 0x42012345:0x3fca1000'
      ].join('\n')
    });

    assert.equal(result.status, 'OK');
    assert.equal(result.architecture, 'xtensa');
    assert.equal(result.decodedFrames[0].function, 'app_main');
  });
});

test('component registry resolver ranks official matches and emits manifest snippet', async () => {
  const registry = new ComponentRegistry({
    get: async () => ({
      data: [
        {
          namespace: 'espressif',
          name: 'led_strip',
          featured: true,
          latest_version: {
            version: '3.0.3',
            description: 'LED strip driver',
            documentation: 'https://docs.example/led_strip',
            docs: { readme: 'https://docs.example/led_strip/readme' },
            url: 'https://components-file.example/led_strip.zip',
            targets: ['esp32', 'esp32s3'],
            dependencies: [{ source: 'idf', spec: '>=5.0' }]
          }
        },
        {
          namespace: 'someone',
          name: 'strip_led_helper',
          latest_version: {
            version: '1.2.0',
            description: 'helper for led strips',
            targets: ['esp32c3'],
            dependencies: []
          }
        }
      ]
    })
  });

  const result = await registry.resolveComponent('led_strip', 'esp32s3');

  assert.equal(result.status, 'OK');
  assert.equal(result.suggestion.component, 'espressif/led_strip');
  assert.equal(result.suggestion.targets.includes('esp32s3'), true);
  assert.equal(result.suggestion.manifestSnippet.includes('dependencies:'), true);
  assert.equal(result.suggestion.addDependencyCommand.includes('idf.py add-dependency'), true);
});

test('component registry resolver prefers espressif namespace for strong exact matches', async () => {
  const registry = new ComponentRegistry({
    get: async () => ({
      data: [
        {
          namespace: 'thirdparty',
          name: 'led_strip',
          latest_version: {
            version: '9.9.9',
            description: 'third-party led strip',
            targets: ['esp32s3'],
            dependencies: []
          }
        },
        {
          namespace: 'espressif',
          name: 'led_strip',
          latest_version: {
            version: '3.0.3',
            description: 'official led strip',
            targets: [],
            dependencies: [{ source: 'idf', spec: '>=5.0' }]
          }
        }
      ]
    })
  });

  const result = await registry.resolveComponent('led_strip', 'esp32s3');

  assert.equal(result.status, 'OK');
  assert.equal(result.suggestion.component, 'espressif/led_strip');
});

test('component manifest manager adds dependency to an empty manifest', () => {
  const manager = new ComponentManifestManager();
  const result = manager.mergeDependency('', {
    dependency: 'espressif/led_strip',
    version: '^3.0.3'
  });

  assert.equal(result.status, 'ADDED');
  assert.equal(result.manifest.includes('dependencies:'), true);
  assert.equal(result.manifest.includes('espressif/led_strip'), true);
  assert.equal(result.patch.kind, 'append_block');
});

test('component manifest manager keeps existing matching dependency versions', () => {
  const manager = new ComponentManifestManager();
  const manifest = [
    'targets:',
    '  - esp32s3',
    'dependencies:',
    '  espressif/led_strip:',
    '    version: "^3.0.3"'
  ].join('\n');

  const result = manager.mergeDependency(manifest, {
    dependency: 'espressif/led_strip',
    version: '^3.0.3'
  });

  assert.equal(result.status, 'ALREADY_PRESENT');
  assert.equal(result.manifest.includes('targets:'), true);
  assert.equal(result.patch, undefined);
});

test('component manifest manager updates conflicting versions and preserves comments', () => {
  const manager = new ComponentManifestManager();
  const manifest = [
    '# Existing manifest',
    'dependencies:',
    '  espressif/led_strip:',
    '    # keep this comment',
    '    version: "^2.0.0"',
    '  espressif/button:',
    '    version: "^4.1.0"'
  ].join('\n');

  const result = manager.mergeDependency(manifest, {
    dependency: 'espressif/led_strip',
    version: '^3.0.3'
  });

  assert.equal(result.status, 'VERSION_CONFLICT');
  assert.equal(result.currentVersion, '^2.0.0');
  assert.equal(result.manifest.includes('# Existing manifest'), true);
  assert.equal(result.manifest.includes('# keep this comment'), true);
  assert.equal(result.manifest.includes('version: "^3.0.3"'), true);
  assert.equal(result.patch.kind, 'replace_block');
});

test('resolve_component can return merged idf_component.yml draft', async () => {
  const tempManifest = makeTempDir('claw-manifest-');
  const manifestPath = path.join(tempManifest, 'idf_component.yml');
  fs.writeFileSync(manifestPath, [
    '# demo',
    'dependencies:',
    '  espressif/button:',
    '    version: "^4.1.0"'
  ].join('\n'));

  const originalResolve = ComponentRegistry.prototype.resolveComponent;
  ComponentRegistry.prototype.resolveComponent = async () => ({
    status: 'OK',
    query: 'led_strip',
    target: 'esp32s3',
    suggestion: {
      dependency: 'espressif/led_strip',
      version: '^3.0.3',
      component: 'espressif/led_strip',
      namespace: 'espressif',
      name: 'led_strip',
      description: 'Driver for Addressable LED Strip',
      targets: ['esp32s3'],
      score: 100,
      addDependencyCommand: 'idf.py add-dependency "espressif/led_strip^3.0.3"',
      manifestSnippet: 'dependencies:\n  espressif/led_strip:\n    version: "^3.0.3"'
    },
    candidates: []
  });

  try {
    const result = await skillTools.resolve_component({
      query: 'led_strip',
      target: 'esp32s3',
      manifestPath
    });

    assert.equal(result.status, 'OK');
    assert.equal(result.manifestUpdate.status, 'ADDED');
    assert.equal(result.manifestUpdate.manifest.includes('espressif/led_strip'), true);
    assert.equal(result.manifestUpdate.manifest.includes('espressif/button'), true);
    assert.equal(result.manifestUpdate.patch.kind, 'insert_block');
  } finally {
    ComponentRegistry.prototype.resolveComponent = originalResolve;
  }
});

test('partition advisor suggests app partition expansion from overflow log', async () => {
  const advisor = new PartitionAdvisor();
  const projectDir = createProjectWithFiles({
    'partitions.csv': [
      '# Name, Type, SubType, Offset, Size, Flags',
      'nvs,data,nvs,0x9000,0x6000,',
      'phy_init,data,phy,0xf000,0x1000,',
      'factory,app,factory,0x10000,1M,',
      'storage,data,spiffs,0x110000,0xF0000,'
    ].join('\n')
  });

  const advice = await advisor.analyzeProject(projectDir, "Error: app partition is too small for binary app.bin size 0x135ae0: Part 'factory' 0/0 @ 0x10000 size 0x100000 (overflow 0x35ae0)");

  assert.equal(advice.status, 'OK');
  assert.equal(advice.targetPartition.name, 'factory');
  assert.equal(advice.currentPartitionSizeBytes, 0x100000);
  assert.equal(advice.overflowBytes, 0x35ae0);
  assert.equal(advice.recommendedSizeBytes > advice.currentPartitionSizeBytes, true);
  assert.equal(advice.updatedManifest.includes('factory,app,factory,0x10000,'), true);
  assert.equal(advice.patch.kind, 'replace_block');
});

test('analyze_partitions tool returns updated partitions.csv draft', async () => {
  const projectDir = createProjectWithFiles({
    'partitions.csv': [
      '# Name, Type, SubType, Offset, Size, Flags',
      'nvs,data,nvs,0x9000,0x6000,',
      'factory,app,factory,0x10000,1M,',
      'storage,data,spiffs,0x110000,0xF0000,'
    ].join('\n')
  });

  const result = await skillTools.analyze_partitions({
    projectPath: projectDir,
    rawLog: "Error: app partition is too small for binary app.bin size 0x135ae0: Part 'factory' 0/0 @ 0x10000 size 0x100000 (overflow 0x35ae0)"
  });

  assert.equal(result.status, 'OK');
  assert.equal(result.updatedManifest.includes('factory,app,factory,0x10000,'), true);
  assert.equal(result.patch.kind, 'replace_block');
});

test('safe_build surfaces partition advice when build log overflows app partition', { concurrency: false }, async () => {
  const fakeHome = makeTempDir('claw-idf-home-');
  const fakeBin = makeTempDir('claw-idf-bin-');
  const errorLog = [
    'Building...',
    "Error: app partition is too small for binary app.bin size 0x135ae0: Part 'factory' 0/0 @ 0x10000 size 0x100000 (overflow 0x35ae0)"
  ].join('\n');

  if (process.platform === 'win32') {
    const filePath = path.join(fakeBin, 'idf.py.cmd');
    writeExecutable(filePath, [
      '@echo off',
      'if "%1"=="--version" exit /b 0',
      `echo ${errorLog.replace(/\n/g, '\r\necho ')} 1>&2`,
      'exit /b 1'
    ].join('\r\n'));
  } else {
    const filePath = path.join(fakeBin, 'idf.py');
    writeExecutable(filePath, [
      '#!/bin/sh',
      'if [ "$1" = "--version" ]; then',
      '  exit 0',
      'fi',
      `printf '%s\\n' "${errorLog.replace(/"/g, '\\"').replace(/\n/g, '" "')}" 1>&2`,
      'exit 1'
    ].join('\n'));
  }

  const projectDir = createProjectWithFiles({
    'main/main.c': 'void app_main(void) {}\n',
    'partitions.csv': [
      '# Name, Type, SubType, Offset, Size, Flags',
      'nvs,data,nvs,0x9000,0x6000,',
      'factory,app,factory,0x10000,1M,',
      'storage,data,spiffs,0x110000,0xF0000,'
    ].join('\n')
  });

  await withEnv({
    HOME: fakeHome,
    USERPROFILE: fakeHome,
    IDF_PATH: undefined,
    PATH: fakeBin
  }, async () => {
    const result = await skillTools.safe_build({ projectPath: projectDir, chip: 'esp32' });

    assert.equal(result.status, 'FAILED');
    assert.equal(result.build.errorType, 'PARTITION_OVERFLOW');
    assert.equal(result.build.partitionAdvice.status, 'OK');
    assert.equal(result.build.partitionAdvice.updatedManifest.includes('factory,app,factory,0x10000,'), true);
  });
});

test('safe_build classifies missing headers with component-oriented guidance', { concurrency: false }, async () => {
  const fakeHome = makeTempDir('claw-idf-home-');
  const fakeBin = makeTempDir('claw-idf-bin-');
  createScriptedIdfPy(fakeBin, [
    '/tmp/project/main/main.c:4:10: fatal error: led_strip.h: No such file or directory',
    'compilation terminated.'
  ]);
  const projectDir = createProjectWithSource('#include "led_strip.h"\nvoid app_main(void) {}\n');

  await withEnv({
    HOME: fakeHome,
    USERPROFILE: fakeHome,
    PATH: fakeBin
  }, async () => {
    const result = await skillTools.safe_build({ projectPath: projectDir, chip: 'esp32s3' });

    assert.equal(result.status, 'FAILED');
    assert.equal(result.build.errorType, 'MISSING_HEADER');
    assert.equal(result.build.cleanError.includes('led_strip.h'), true);
    assert.equal(result.build.suggestion.includes('resolve_component'), true);
  });
});

test('safe_build classifies component resolution failures', { concurrency: false }, async () => {
  const fakeHome = makeTempDir('claw-idf-home-');
  const fakeBin = makeTempDir('claw-idf-bin-');
  createScriptedIdfPy(fakeBin, [
    "ERROR: Failed to resolve component 'espressif/does_not_exist' required by component 'main'"
  ]);
  const projectDir = createProjectWithSource('void app_main(void) {}\n');

  await withEnv({
    HOME: fakeHome,
    USERPROFILE: fakeHome,
    PATH: fakeBin
  }, async () => {
    const result = await skillTools.safe_build({ projectPath: projectDir, chip: 'esp32' });

    assert.equal(result.status, 'FAILED');
    assert.equal(result.build.errorType, 'COMPONENT_ERROR');
    assert.equal(result.build.cleanError.includes('does_not_exist'), true);
  });
});

test('safe_build classifies memory overflow separately from partition overflow', { concurrency: false }, async () => {
  const fakeHome = makeTempDir('claw-idf-home-');
  const fakeBin = makeTempDir('claw-idf-bin-');
  createScriptedIdfPy(fakeBin, [
    'region `iram0_0_seg` overflowed by 176 bytes'
  ]);
  const projectDir = createProjectWithSource('void app_main(void) {}\n');

  await withEnv({
    HOME: fakeHome,
    USERPROFILE: fakeHome,
    PATH: fakeBin
  }, async () => {
    const result = await skillTools.safe_build({ projectPath: projectDir, chip: 'esp32' });

    assert.equal(result.status, 'FAILED');
    assert.equal(result.build.errorType, 'MEMORY_OVERFLOW');
  });
});

test('build output includes hardware data assets', () => {
  const assetPath = path.join(__dirname, '..', 'dist', 'data', 'soc', 'esp32.json');
  assert.equal(fs.existsSync(assetPath), true);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'dist', 'data', 'soc', 'esp32s3.json')), true);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'dist', 'data', 'soc', 'esp32c3.json')), true);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'dist', 'data', 'soc', 'esp32c6.json')), true);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'dist', 'data', 'soc', 'esp32c5.json')), true);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'dist', 'data', 'soc', 'esp32h2.json')), true);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'dist', 'data', 'soc', 'esp32p4.json')), true);
});

test('skill bundle files exist for ClawHub packaging', () => {
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'skill', 'SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'skill', '.clawhubignore')), true);
  assert.equal(fs.existsSync(path.join(__dirname, '..', 'skill', 'scripts', 'run-tool.mjs')), true);
});

test('skill bundle runner accepts stdin JSON and returns structured output', () => {
  const fakeHome = makeTempDir('claw-idf-home-');
  const scriptPath = path.join(__dirname, '..', 'skill', 'scripts', 'run-tool.mjs');
  const result = runNodeScript(scriptPath, ['manage_env', '--stdin'], {
    env: {
      ...process.env,
      HOME: fakeHome,
      USERPROFILE: fakeHome,
      IDF_PATH: '',
      PATH: ''
    },
    input: '{"action":"check"}'
  });

  assert.equal(result.status, 0);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, 'NOT_FOUND');
  assert.equal(output.idfPyAvailable, false);
});

test('manage_env check reports a clean NOT_FOUND state in an isolated shell env', { concurrency: false }, async () => {
  const fakeHome = makeTempDir('claw-idf-home-');

  await withEnv({
    HOME: fakeHome,
    USERPROFILE: fakeHome,
    IDF_PATH: undefined,
    PATH: ''
  }, async () => {
    const result = await skillTools.manage_env({ action: 'check' });

    assert.equal(result.status, 'NOT_FOUND');
    assert.equal(result.pythonAvailable, false);
    assert.equal(result.idfPyAvailable, false);
  });
});

test('manage_env install returns manual guidance instead of executing upstream scripts', { concurrency: false }, async () => {
  const fakeHome = makeTempDir('claw-idf-home-');

  await withEnv({
    HOME: fakeHome,
    USERPROFILE: fakeHome,
    IDF_PATH: undefined,
    PATH: ''
  }, async () => {
    const result = await skillTools.manage_env({ action: 'install', version: 'v5.3' });

    assert.equal(result.status, 'MANUAL_INSTALL_REQUIRED');
    assert.equal(typeof result.options.github.repository, 'string');
    assert.equal(Array.isArray(result.options.github.commands), true);
    assert.equal(result.options.github.commands[0].includes('git clone --recursive'), true);
  });
});

test('explore_demo returns ENV_NOT_READY when no local ESP-IDF path is available', { concurrency: false }, async () => {
  const fakeHome = makeTempDir('claw-idf-home-');

  await withEnv({
    HOME: fakeHome,
    USERPROFILE: fakeHome,
    IDF_PATH: undefined,
    PATH: ''
  }, async () => {
    const result = await skillTools.explore_demo({ query: 'gpio' });

    assert.equal(result.status, 'ENV_NOT_READY');
  });
});

test('safe_build reports UNSUPPORTED_CHIP before build when the rules file is missing', { concurrency: false }, async () => {
  const fakeHome = makeTempDir('claw-idf-home-');
  const fakeBin = makeTempDir('claw-idf-bin-');
  createFakeIdfPy(fakeBin);
  const projectDir = createProjectWithSource('void app_main(void) {}\n');

  await withEnv({
    HOME: fakeHome,
    USERPROFILE: fakeHome,
    IDF_PATH: undefined,
    PATH: fakeBin
  }, async () => {
    const result = await skillTools.safe_build({ projectPath: projectDir, chip: 'esp32c2' });

    assert.equal(result.status, 'UNSUPPORTED_CHIP');
    assert.equal(result.chip, 'esp32c2');
    assert.equal(result.resolvedChip, 'esp32c2');
  });
});

test('safe_build rejects projects that touch flash pins before invoking idf.py build', { concurrency: false }, async () => {
  const fakeHome = makeTempDir('claw-idf-home-');
  const fakeBin = makeTempDir('claw-idf-bin-');
  createFakeIdfPy(fakeBin);
  const projectDir = createProjectWithSource([
    '#include "driver/gpio.h"',
    'void app_main(void) {',
    '  gpio_set_level(GPIO_NUM_6, 1);',
    '}'
  ].join('\n'));

  await withEnv({
    HOME: fakeHome,
    USERPROFILE: fakeHome,
    IDF_PATH: undefined,
    PATH: fakeBin
  }, async () => {
    const result = await skillTools.safe_build({ projectPath: projectDir, chip: 'esp32' });

    assert.equal(result.status, 'REJECTED');
    assert.equal(result.reason, '硬件物理规则冲突');
    assert.equal(Array.isArray(result.issues), true);
    assert.equal(result.issues.some((issue) => issue.level === 'FATAL' && issue.pin === 6), true);
  });
});

test('safe_build supports esp32s3 rules and rejects reserved flash pins', { concurrency: false }, async () => {
  const fakeHome = makeTempDir('claw-idf-home-');
  const fakeBin = makeTempDir('claw-idf-bin-');
  createFakeIdfPy(fakeBin);
  const projectDir = createProjectWithSource([
    '#include "driver/gpio.h"',
    'void app_main(void) {',
    '  gpio_set_level(GPIO_NUM_26, 1);',
    '}'
  ].join('\n'));

  await withEnv({
    HOME: fakeHome,
    USERPROFILE: fakeHome,
    IDF_PATH: undefined,
    PATH: fakeBin
  }, async () => {
    const result = await skillTools.safe_build({ projectPath: projectDir, chip: 'esp32s3' });

    assert.equal(result.status, 'REJECTED');
    assert.equal(result.issues.some((issue) => issue.level === 'FATAL' && issue.pin === 26), true);
  });
});

test('safe_build supports esp32c3 rules and warns on strapping pins', { concurrency: false }, async () => {
  const fakeHome = makeTempDir('claw-idf-home-');
  const fakeBin = makeTempDir('claw-idf-bin-');
  createFakeIdfPy(fakeBin);
  const projectDir = createProjectWithSource([
    '#include "driver/gpio.h"',
    'void app_main(void) {',
    '  gpio_set_level(GPIO_NUM_8, 1);',
    '}'
  ].join('\n'));

  await withEnv({
    HOME: fakeHome,
    USERPROFILE: fakeHome,
    IDF_PATH: undefined,
    PATH: fakeBin
  }, async () => {
    const result = await skillTools.safe_build({ projectPath: projectDir, chip: 'esp32c3' });

    assert.equal(result.status, 'SUCCESS');
    assert.equal(result.issues.some((issue) => issue.level === 'WARNING' && issue.pin === 8), true);
  });
});

test('safe_build supports esp32c6 rules and rejects SPI0/1 reserved pins', { concurrency: false }, async () => {
  const fakeHome = makeTempDir('claw-idf-home-');
  const fakeBin = makeTempDir('claw-idf-bin-');
  createFakeIdfPy(fakeBin);
  const projectDir = createProjectWithSource([
    '#include "driver/gpio.h"',
    'void app_main(void) {',
    '  gpio_set_level(GPIO_NUM_24, 1);',
    '}'
  ].join('\n'));

  await withEnv({
    HOME: fakeHome,
    USERPROFILE: fakeHome,
    IDF_PATH: undefined,
    PATH: fakeBin
  }, async () => {
    const result = await skillTools.safe_build({ projectPath: projectDir, chip: 'esp32c6' });

    assert.equal(result.status, 'REJECTED');
    assert.equal(result.issues.some((issue) => issue.level === 'FATAL' && issue.pin === 24), true);
  });
});

test('safe_build supports esp32c5 rules and rejects SPI0/1 reserved pins', { concurrency: false }, async () => {
  const fakeHome = makeTempDir('claw-idf-home-');
  const fakeBin = makeTempDir('claw-idf-bin-');
  createFakeIdfPy(fakeBin);
  const projectDir = createProjectWithSource([
    '#include "driver/gpio.h"',
    'void app_main(void) {',
    '  gpio_set_level(GPIO_NUM_23, 1);',
    '}'
  ].join('\n'));

  await withEnv({
    HOME: fakeHome,
    USERPROFILE: fakeHome,
    IDF_PATH: undefined,
    PATH: fakeBin
  }, async () => {
    const result = await skillTools.safe_build({ projectPath: projectDir, chip: 'esp32c5' });

    assert.equal(result.status, 'REJECTED');
    assert.equal(result.issues.some((issue) => issue.level === 'FATAL' && issue.pin === 23), true);
  });
});

test('safe_build supports esp32h2 rules and warns on strap pins', { concurrency: false }, async () => {
  const fakeHome = makeTempDir('claw-idf-home-');
  const fakeBin = makeTempDir('claw-idf-bin-');
  createFakeIdfPy(fakeBin);
  const projectDir = createProjectWithSource([
    '#include "driver/gpio.h"',
    'void app_main(void) {',
    '  gpio_set_level(GPIO_NUM_9, 1);',
    '}'
  ].join('\n'));

  await withEnv({
    HOME: fakeHome,
    USERPROFILE: fakeHome,
    IDF_PATH: undefined,
    PATH: fakeBin
  }, async () => {
    const result = await skillTools.safe_build({ projectPath: projectDir, chip: 'esp32h2' });

    assert.equal(result.status, 'SUCCESS');
    assert.equal(result.issues.some((issue) => issue.level === 'WARNING' && issue.pin === 9), true);
  });
});

test('safe_build supports esp32p4 rules and warns on JTAG/boot pins', { concurrency: false }, async () => {
  const fakeHome = makeTempDir('claw-idf-home-');
  const fakeBin = makeTempDir('claw-idf-bin-');
  createFakeIdfPy(fakeBin);
  const projectDir = createProjectWithSource([
    '#include "driver/gpio.h"',
    'void app_main(void) {',
    '  gpio_set_level(GPIO_NUM_2, 1);',
    '}'
  ].join('\n'));

  await withEnv({
    HOME: fakeHome,
    USERPROFILE: fakeHome,
    IDF_PATH: undefined,
    PATH: fakeBin
  }, async () => {
    const result = await skillTools.safe_build({ projectPath: projectDir, chip: 'esp32p4' });

    assert.equal(result.status, 'SUCCESS');
    assert.equal(result.issues.some((issue) => issue.level === 'WARNING' && issue.pin === 2), true);
  });
});

test('safe_build normalizes chip variants to family rules', { concurrency: false }, async () => {
  const fakeHome = makeTempDir('claw-idf-home-');
  const fakeBin = makeTempDir('claw-idf-bin-');
  createFakeIdfPy(fakeBin);
  const projectDir = createProjectWithSource([
    '#include "driver/gpio.h"',
    'void app_main(void) {',
    '  gpio_set_level(GPIO_NUM_26, 1);',
    '}'
  ].join('\n'));

  await withEnv({
    HOME: fakeHome,
    USERPROFILE: fakeHome,
    IDF_PATH: undefined,
    PATH: fakeBin
  }, async () => {
    const result = await skillTools.safe_build({
      projectPath: projectDir,
      chip: 'ESP32-S3-PICO-1-N8R2'
    });

    assert.equal(result.status, 'REJECTED');
    assert.equal(result.resolvedChip, 'esp32s3');
    assert.equal(result.issues.some((issue) => issue.level === 'FATAL' && issue.pin === 26), true);
  });
});

test('pin audit finds numeric pin masks and reports file and line context', { concurrency: false }, async () => {
  const fakeHome = makeTempDir('claw-idf-home-');
  const fakeBin = makeTempDir('claw-idf-bin-');
  createFakeIdfPy(fakeBin);
  const projectDir = createProjectWithFiles({
    'main/main.c': [
      '#include "driver/gpio.h"',
      'void app_main(void) {',
      '  gpio_config_t io_conf = {',
      '    .pin_bit_mask = 1ULL << 34,',
      '    .mode = GPIO_MODE_OUTPUT,',
      '  };',
      '  gpio_config(&io_conf);',
      '}'
    ].join('\n'),
    'components/sensor/sensor.c': [
      '#include "driver/gpio.h"',
      'void sensor_init(void) {',
      '  gpio_config_t sensor_conf = {',
      '    .pin_bit_mask = 1ULL << 6,',
      '    .mode = GPIO_MODE_OUTPUT,',
      '  };',
      '  gpio_config(&sensor_conf);',
      '}'
    ].join('\n')
  });

  await withEnv({
    HOME: fakeHome,
    USERPROFILE: fakeHome,
    IDF_PATH: undefined,
    PATH: fakeBin
  }, async () => {
    const result = await skillTools.safe_build({ projectPath: projectDir, chip: 'esp32' });

    assert.equal(result.status, 'REJECTED');
    assert.equal(result.issues.some((issue) => issue.pin === 34 && issue.line === 4 && issue.file === 'main/main.c'), true);
    assert.equal(result.issues.some((issue) => issue.pin === 6 && issue.line === 4 && issue.file === 'components/sensor/sensor.c'), true);
  });
});

test('pin audit resolves #define aliases used in GPIO calls', { concurrency: false }, async () => {
  const fakeHome = makeTempDir('claw-idf-home-');
  const fakeBin = makeTempDir('claw-idf-bin-');
  createFakeIdfPy(fakeBin);
  const projectDir = createProjectWithSource([
    '#include "driver/gpio.h"',
    '#define FLASH_ALIAS GPIO_NUM_6',
    'void app_main(void) {',
    '  gpio_set_level(FLASH_ALIAS, 1);',
    '}'
  ].join('\n'));

  await withEnv({
    HOME: fakeHome,
    USERPROFILE: fakeHome,
    IDF_PATH: undefined,
    PATH: fakeBin
  }, async () => {
    const result = await skillTools.safe_build({ projectPath: projectDir, chip: 'esp32' });

    assert.equal(result.status, 'REJECTED');
    assert.equal(result.issues.some((issue) => issue.pin === 6 && issue.line === 4), true);
  });
});

test('pin audit resolves const gpio_num_t aliases in struct assignments', { concurrency: false }, async () => {
  const fakeHome = makeTempDir('claw-idf-home-');
  const fakeBin = makeTempDir('claw-idf-bin-');
  createFakeIdfPy(fakeBin);
  const projectDir = createProjectWithSource([
    '#include "driver/gpio.h"',
    'static const gpio_num_t INPUT_ONLY_ALIAS = GPIO_NUM_34;',
    'void app_main(void) {',
    '  gpio_config_t io_conf = {',
    '    .pin_bit_mask = 1ULL << INPUT_ONLY_ALIAS,',
    '    .mode = GPIO_MODE_OUTPUT,',
    '  };',
    '  gpio_config(&io_conf);',
    '}'
  ].join('\n'));

  await withEnv({
    HOME: fakeHome,
    USERPROFILE: fakeHome,
    IDF_PATH: undefined,
    PATH: fakeBin
  }, async () => {
    const result = await skillTools.safe_build({ projectPath: projectDir, chip: 'esp32' });

    assert.equal(result.status, 'REJECTED');
    assert.equal(result.issues.some((issue) => issue.level === 'CRITICAL' && issue.pin === 34), true);
  });
});

test('pin audit resolves macro chains used in pin_bit_mask expressions', { concurrency: false }, async () => {
  const fakeHome = makeTempDir('claw-idf-home-');
  const fakeBin = makeTempDir('claw-idf-bin-');
  createFakeIdfPy(fakeBin);
  const projectDir = createProjectWithSource([
    '#include "driver/gpio.h"',
    '#define INPUT_ONLY_ALIAS GPIO_NUM_34',
    '#define GPIO_OUTPUT_PIN_SEL (1ULL << INPUT_ONLY_ALIAS)',
    'void app_main(void) {',
    '  gpio_config_t io_conf = {',
    '    .pin_bit_mask = GPIO_OUTPUT_PIN_SEL,',
    '    .mode = GPIO_MODE_OUTPUT,',
    '  };',
    '  gpio_config(&io_conf);',
    '}'
  ].join('\n'));

  await withEnv({
    HOME: fakeHome,
    USERPROFILE: fakeHome,
    IDF_PATH: undefined,
    PATH: fakeBin
  }, async () => {
    const result = await skillTools.safe_build({ projectPath: projectDir, chip: 'esp32' });

    assert.equal(result.status, 'REJECTED');
    assert.equal(result.issues.some((issue) => issue.level === 'CRITICAL' && issue.pin === 34), true);
  });
});

test('pin audit resolves simple assignment aliases before GPIO use', { concurrency: false }, async () => {
  const fakeHome = makeTempDir('claw-idf-home-');
  const fakeBin = makeTempDir('claw-idf-bin-');
  createFakeIdfPy(fakeBin);
  const projectDir = createProjectWithSource([
    '#include "driver/gpio.h"',
    'gpio_num_t led_gpio;',
    'void app_main(void) {',
    '  led_gpio = GPIO_NUM_6;',
    '  gpio_set_level(led_gpio, 1);',
    '}'
  ].join('\n'));

  await withEnv({
    HOME: fakeHome,
    USERPROFILE: fakeHome,
    IDF_PATH: undefined,
    PATH: fakeBin
  }, async () => {
    const result = await skillTools.safe_build({ projectPath: projectDir, chip: 'esp32' });

    assert.equal(result.status, 'REJECTED');
    assert.equal(result.issues.some((issue) => issue.level === 'FATAL' && issue.pin === 6), true);
  });
});

test('safe_build normalizes additional SKU variants to family rules', { concurrency: false }, async () => {
  const fakeHome = makeTempDir('claw-idf-home-');
  const fakeBin = makeTempDir('claw-idf-bin-');
  createFakeIdfPy(fakeBin);
  const projectDir = createProjectWithSource([
    '#include "driver/gpio.h"',
    'void app_main(void) {',
    '  gpio_set_level(GPIO_NUM_24, 1);',
    '}'
  ].join('\n'));

  await withEnv({
    HOME: fakeHome,
    USERPROFILE: fakeHome,
    IDF_PATH: undefined,
    PATH: fakeBin
  }, async () => {
    const c6 = await skillTools.safe_build({ projectPath: projectDir, chip: 'ESP32-C6FH8' });
    assert.equal(c6.resolvedChip, 'esp32c6');
    assert.equal(c6.status, 'REJECTED');

    const p4 = await skillTools.safe_build({ projectPath: projectDir, chip: 'ESP32-P4NRW32X' });
    assert.equal(p4.resolvedChip, 'esp32p4');
  });
});

test('installer defaults to workspace-first skill installation', () => {
  const openClawHome = makeTempDir('openclaw-home-');
  const cliPath = path.join(__dirname, '..', 'bin', 'claw-esp-expert.mjs');
  const result = runNodeScript(cliPath, [], {
    env: {
      ...process.env,
      OPENCLAW_HOME: openClawHome
    }
  });

  assert.equal(result.status, 0);
  assert.equal(fs.existsSync(path.join(openClawHome, 'workspace', 'skills', 'claw-esp-expert', 'SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(openClawHome, 'workspace', 'skills', 'claw-esp-expert', 'dist', 'index.js')), true);
  assert.equal(fs.existsSync(path.join(openClawHome, 'skills', 'claw-esp-expert')), false);
});

test('installer supports managed mode explicitly', () => {
  const openClawHome = makeTempDir('openclaw-home-');
  const cliPath = path.join(__dirname, '..', 'bin', 'claw-esp-expert.mjs');
  const result = runNodeScript(cliPath, ['install', '--managed'], {
    env: {
      ...process.env,
      OPENCLAW_HOME: openClawHome
    }
  });

  assert.equal(result.status, 0);
  assert.equal(fs.existsSync(path.join(openClawHome, 'skills', 'claw-esp-expert', 'SKILL.md')), true);
  assert.equal(fs.existsSync(path.join(openClawHome, 'skills', 'claw-esp-expert', 'dist', 'data', 'soc', 'esp32.json')), true);
});
