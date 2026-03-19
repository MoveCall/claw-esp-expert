import { execFileText } from '../common/process';
import { pathExists } from '../common/fs';

export interface PanicFrame {
    address: string;
    function?: string;
    location?: string;
}

export interface PanicDecodeResult {
    status: 'OK' | 'NO_PANIC' | 'MISSING_ELF' | 'ADDR2LINE_NOT_FOUND';
    chip?: string;
    resolvedChip?: string;
    architecture?: 'xtensa' | 'riscv';
    reason?: string;
    registers?: Record<string, string>;
    backtrace?: string[];
    decodedFrames?: PanicFrame[];
    addr2lineBin?: string;
    suggestion: string;
}

export class PanicDecoder {
    private readonly xtensaToolByChip: Record<string, string> = {
        esp32: 'xtensa-esp32-elf-addr2line',
        esp32s2: 'xtensa-esp32s2-elf-addr2line',
        esp32s3: 'xtensa-esp32s3-elf-addr2line'
    };

    private readonly riscvTool = 'riscv32-esp-elf-addr2line';

    decodeAddresses(log: string): { reason?: string; registers: Record<string, string>; addresses: string[] } {
        const registers = this.extractRegisters(log);
        const reason = this.extractReason(log);
        const addresses = this.extractAddresses(log, registers);

        return { reason, registers, addresses };
    }

    async decode(args: { chip: string; elfPath: string; log: string; addr2lineBin?: string }): Promise<PanicDecodeResult> {
        const resolvedChip = this.resolveChip(args.chip);
        const architecture = this.resolveArchitecture(resolvedChip);
        const { reason, registers, addresses } = this.decodeAddresses(args.log);

        if (!reason && addresses.length === 0) {
            return {
                status: 'NO_PANIC',
                chip: args.chip,
                resolvedChip,
                architecture,
                suggestion: '未在日志中识别到 panic/backtrace 关键信息，请提供更完整的设备崩溃日志。'
            };
        }

        if (!await pathExists(args.elfPath)) {
            return {
                status: 'MISSING_ELF',
                chip: args.chip,
                resolvedChip,
                architecture,
                reason,
                registers,
                backtrace: addresses,
                suggestion: '已识别到 panic 日志，但缺少 ELF 文件，无法执行 addr2line 定位。请提供 build 产物中的 ELF 路径。'
            };
        }

        const addr2lineBin = args.addr2lineBin || this.resolveAddr2lineBin(resolvedChip, architecture);
        const decodedFrames = await this.runAddr2line(addr2lineBin, args.elfPath, addresses);
        if (!decodedFrames) {
            return {
                status: 'ADDR2LINE_NOT_FOUND',
                chip: args.chip,
                resolvedChip,
                architecture,
                reason,
                registers,
                backtrace: addresses,
                addr2lineBin,
                suggestion: `已识别到 panic 日志，但未找到可执行的 ${addr2lineBin}。请先导出 ESP-IDF toolchain 环境。`
            };
        }

        return {
            status: 'OK',
            chip: args.chip,
            resolvedChip,
            architecture,
            reason,
            registers,
            backtrace: addresses,
            decodedFrames,
            addr2lineBin,
            suggestion: reason
                ? `已解码 panic：${reason}。请优先检查首个命中的源码位置。`
                : '已解码 backtrace，请优先检查首个命中的源码位置。'
        };
    }

    resolveChip(chip: string): string {
        return chip.toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    private resolveArchitecture(chip: string): 'xtensa' | 'riscv' {
        if (chip === 'esp32' || chip === 'esp32s2' || chip === 'esp32s3') {
            return 'xtensa';
        }
        return 'riscv';
    }

    private resolveAddr2lineBin(chip: string, architecture: 'xtensa' | 'riscv'): string {
        if (architecture === 'xtensa') {
            return this.xtensaToolByChip[chip] || 'xtensa-esp32-elf-addr2line';
        }
        return this.riscvTool;
    }

    private extractReason(log: string): string | undefined {
        const guruMatch = log.match(/Guru Meditation Error: Core\s+\d+ panic'ed \(([^)]+)\)/);
        if (guruMatch?.[1]) return guruMatch[1];

        const abortMatch = log.match(/abort\(\) was called at PC [^\n]+/);
        if (abortMatch) return 'abort()';

        const exceptionMatch = log.match(/Unhandled debug exception: ([^\n]+)/);
        if (exceptionMatch?.[1]) return exceptionMatch[1].trim();

        return undefined;
    }

    private extractRegisters(log: string): Record<string, string> {
        const registers: Record<string, string> = {};
        const pairs = log.matchAll(/\b([A-Z]{2,8})\s*:\s*(0x[0-9a-fA-F]+)/g);
        for (const match of pairs) {
            registers[match[1]] = match[2];
        }
        return registers;
    }

    private extractAddresses(log: string, registers: Record<string, string>): string[] {
        const addresses: string[] = [];
        const seen = new Set<string>();

        const backtraceMatch = log.match(/Backtrace:\s*([^\n]+)/);
        if (backtraceMatch?.[1]) {
            const pairs = backtraceMatch[1].match(/0x[0-9a-fA-F]+(?::0x[0-9a-fA-F]+)?/g) || [];
            for (const pair of pairs) {
                const address = pair.split(':')[0];
                if (!seen.has(address)) {
                    seen.add(address);
                    addresses.push(address);
                }
            }
        }

        for (const key of ['PC', 'MEPC', 'RA', 'EXCVADDR', 'MTVAL']) {
            const value = registers[key];
            if (value && !seen.has(value)) {
                seen.add(value);
                addresses.push(value);
            }
        }

        return addresses;
    }

    private async runAddr2line(addr2lineBin: string, elfPath: string, addresses: string[]): Promise<PanicFrame[] | null> {
        if (addresses.length === 0) {
            return [];
        }

        try {
            const stdout = await execFileText(addr2lineBin, ['-pfiaC', '-e', elfPath, ...addresses]);
            return this.parseAddr2line(stdout, addresses);
        } catch {
            return null;
        }
    }

    private parseAddr2line(stdout: string, addresses: string[]): PanicFrame[] {
        const lines = stdout.replace(/\r\n/g, '\n').split('\n').filter(Boolean);
        const frames: PanicFrame[] = [];

        for (let index = 0; index < lines.length; index += 2) {
            const symbolLine = lines[index] || '';
            const locationLine = lines[index + 1] || '';
            const address = addresses[Math.floor(index / 2)] || '';
            const cleaned = symbolLine.replace(/^0x[0-9a-fA-F]+:\s*/, '');
            const functionName = cleaned.includes(' at ') ? cleaned.split(' at ')[0].trim() : cleaned.trim();

            frames.push({
                address,
                function: functionName || undefined,
                location: locationLine || undefined
            });
        }

        return frames;
    }
}
