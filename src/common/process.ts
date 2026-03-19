import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function execFileText(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): Promise<string> {
  const { stdout } = await execFileAsync(command, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 8
  });
  return stdout;
}

export async function spawnCombined(command: string, args: string[], options: {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  onData?: (chunk: string) => void;
} = {}): Promise<{ output: string; code: number; timedOut: boolean }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let output = '';
    let settled = false;
    let timedOut = false;
    let timeout: NodeJS.Timeout | undefined;

    const onChunk = (chunk: Buffer) => {
      const text = chunk.toString();
      output += text;
      options.onData?.(text);
    };

    child.stdout?.on('data', onChunk);
    child.stderr?.on('data', onChunk);

    if (options.timeoutMs) {
      timeout = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, options.timeoutMs);
    }

    child.on('error', (error) => {
      if (timeout) clearTimeout(timeout);
      if (settled) return;
      settled = true;
      reject(Object.assign(error, { output, timedOut }));
    });

    child.on('close', (code) => {
      if (timeout) clearTimeout(timeout);
      if (settled) return;
      settled = true;
      if (timedOut) {
        const error = new Error('Process timed out');
        reject(Object.assign(error, { output, timedOut: true, code: code ?? -1 }));
        return;
      }
      if ((code ?? 1) !== 0) {
        const error = new Error(`Process exited with code ${code ?? 1}`);
        reject(Object.assign(error, { output, timedOut: false, code: code ?? 1 }));
        return;
      }
      resolve({ output, code: code ?? 0, timedOut: false });
    });
  });
}
