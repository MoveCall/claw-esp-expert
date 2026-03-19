#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const SKILL_ID = 'claw-esp-expert';

function usage() {
  console.log(`claw-esp-expert commands:
  install [--workspace <dir>] [--managed]

Defaults:
  install -> ${SKILL_ID} into OpenClaw Workspace Skills
  install --managed -> ${SKILL_ID} into OpenClaw Installed Skills`);
}

function resolveOpenClawHome() {
  const configuredHome = process.env.OPENCLAW_HOME?.trim();
  return configuredHome ? resolve(configuredHome) : resolve(homedir(), '.openclaw');
}

function resolveWorkspaceRoot(inputWorkspace) {
  if (inputWorkspace) return resolve(inputWorkspace);
  const openClawHome = resolveOpenClawHome();
  return resolve(openClawHome, 'workspace');
}

function resolveInstallPaths(options = {}) {
  const openClawHome = resolveOpenClawHome();
  const workspaceRoot = resolveWorkspaceRoot(options.workspaceDir);

  if (options.managed) {
    return {
      modeLabel: 'Installed Skills',
      skillsDir: resolve(openClawHome, 'skills'),
      skillDestDir: resolve(openClawHome, 'skills', SKILL_ID)
    };
  }

  return {
    modeLabel: 'Workspace Skills',
    skillsDir: resolve(workspaceRoot, 'skills'),
    skillDestDir: resolve(workspaceRoot, 'skills', SKILL_ID)
  };
}

function parseInstallArgs(argv) {
  const options = {
    managed: false,
    workspaceDir: ''
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--managed' || arg === '--global') {
      options.managed = true;
      continue;
    }

    if (arg === '--workspace') {
      options.workspaceDir = argv[index + 1] || '';
      index += 1;
      continue;
    }

    throw new Error(`Unknown install option: ${arg}`);
  }

  if (!options.managed && options.workspaceDir && basename(options.workspaceDir) === 'skills') {
    options.workspaceDir = resolve(options.workspaceDir, '..');
  }

  return options;
}

function ensureRuntimeExists() {
  const runtimeEntry = resolve(root, 'skill', 'dist', 'index.js');
  const skillEntry = resolve(root, 'skill', 'SKILL.md');

  if (!existsSync(runtimeEntry)) {
    throw new Error('Missing skill/dist/index.js. Run `npm run build` before using the local installer.');
  }

  if (!existsSync(skillEntry)) {
    throw new Error('Missing skill/SKILL.md in package bundle.');
  }
}

function logStep(step, message) {
  console.log(`[${step}] ${message}`);
}

function runInstaller(options = {}) {
  ensureRuntimeExists();

  const paths = resolveInstallPaths(options);
  const skillSourceDir = resolve(root, 'skill');

  logStep('1/2', `Preparing ${paths.modeLabel} under ${paths.skillsDir}`);
  mkdirSync(paths.skillsDir, { recursive: true });

  logStep('2/2', `Installing skill bundle to ${paths.skillDestDir}`);
  cpSync(skillSourceDir, paths.skillDestDir, { recursive: true, force: true });

  console.log('');
  console.log(`Mode: ${paths.modeLabel}`);
  console.log(`Installed ${SKILL_ID} to ${paths.skillDestDir}`);
  console.log('Next:');
  console.log('1. Open OpenClaw');
  console.log('2. Go to Skills');
  console.log(`3. Enable ${SKILL_ID}`);
  console.log('4. Run the bundled scripts via stdin-safe JSON when you need environment checks or builds');
}

const [cmd, ...args] = process.argv.slice(2);

if (cmd === '--help' || cmd === '-h' || cmd === 'help') {
  usage();
  process.exit(0);
}

if (!cmd || cmd === 'install') {
  try {
    runInstaller(parseInstallArgs(args));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    usage();
    process.exit(1);
  }
  process.exit(0);
}

usage();
process.exit(1);
