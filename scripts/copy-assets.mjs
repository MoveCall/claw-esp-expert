import { cp, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const sourceDir = path.join(projectRoot, 'src', 'data');
const targetDir = path.join(projectRoot, 'dist', 'data');
const distDir = path.join(projectRoot, 'dist');
const bundledRuntimeDir = path.join(projectRoot, 'skill', 'dist');

async function main() {
  try {
    await stat(sourceDir);
  } catch {
    return;
  }

  await mkdir(targetDir, { recursive: true });
  await cp(sourceDir, targetDir, { recursive: true });

  try {
    await stat(path.join(projectRoot, 'skill'));
  } catch {
    return;
  }

  await rm(bundledRuntimeDir, { recursive: true, force: true });
  await mkdir(path.dirname(bundledRuntimeDir), { recursive: true });
  await cp(distDir, bundledRuntimeDir, { recursive: true });
}

main().catch((error) => {
  console.error('Failed to copy data assets:', error);
  process.exitCode = 1;
});
