import { readFile } from 'node:fs/promises';
import path from 'path';
import { buildPatchSuggestion, type PatchSuggestion } from '../common/PatchSuggestion';
import { pathExists } from '../common/fs';

export interface PartitionEntry {
    name: string;
    type: string;
    subtype: string;
    offset?: number;
    size?: number;
    flags?: string;
    lineIndex: number;
    rawLine: string;
}

export interface PartitionAdvice {
    status: 'OK' | 'NO_PARTITION_TABLE' | 'NO_APP_PARTITION' | 'INSUFFICIENT_DATA';
    partitionFile?: string;
    targetPartition?: PartitionEntry;
    appBinarySizeBytes?: number;
    currentPartitionSizeBytes?: number;
    overflowBytes?: number;
    recommendedSizeBytes?: number;
    recommendedSizeHex?: string;
    availableSizeBytes?: number;
    availableSizeHex?: string;
    warning?: string;
    suggestion: string;
    updatedManifest?: string;
    patch?: PatchSuggestion;
}

export class PartitionAdvisor {
    private readonly appPartitionAlignment = 0x10000;
    private readonly minimumExtraHeadroom = 0x20000;

    async analyzeProject(projectPath: string, rawLog: string = ''): Promise<PartitionAdvice> {
        const partitionInfo = await this.loadPartitionTable(projectPath);
        if (!partitionInfo) {
            return {
                status: 'NO_PARTITION_TABLE',
                suggestion: '未发现自定义 partitions.csv。请先确认工程是否使用了自定义分区表，或提供当前分区文件后再分析。'
            };
        }

        const namedPartition = this.extractPartitionName(rawLog);
        const targetPartition = this.pickTargetPartition(partitionInfo.entries, namedPartition);
        if (!targetPartition || targetPartition.size === undefined) {
            return {
                status: 'NO_APP_PARTITION',
                partitionFile: partitionInfo.partitionFile,
                suggestion: '已找到分区表，但没有识别到可分析的 app 分区。请检查 factory / ota_x 分区配置。'
            };
        }

        const overflowBytes = this.extractNumber(rawLog, [/overflow\s+(0x[0-9a-fA-F]+|\d+)/i]);
        const appBinarySizeBytes = this.extractNumber(rawLog, [
            /binary\s+[^\s]+\s+size\s+(0x[0-9a-fA-F]+|\d+)/i,
            /app\s+binary\s+size\s+(0x[0-9a-fA-F]+|\d+)/i,
            /size\s+(0x[0-9a-fA-F]+|\d+):/i
        ]) ?? (overflowBytes !== undefined ? targetPartition.size + overflowBytes : undefined);

        if (appBinarySizeBytes === undefined) {
            return {
                status: 'INSUFFICIENT_DATA',
                partitionFile: partitionInfo.partitionFile,
                targetPartition,
                currentPartitionSizeBytes: targetPartition.size,
                suggestion: `已定位到 app 分区 ${targetPartition.name}，但没有从日志中提取到二进制体积。请提供完整的 size/overflow 日志后再分析。`
            };
        }

        const recommendedSizeBytes = this.alignToAppBoundary(
            appBinarySizeBytes + Math.max(this.minimumExtraHeadroom, Math.ceil(appBinarySizeBytes * 0.1))
        );
        const availableSizeBytes = this.findAvailableSize(partitionInfo.entries, targetPartition);
        const updatedManifest = this.buildUpdatedManifest(partitionInfo.lines, targetPartition, recommendedSizeBytes);
        const warning = availableSizeBytes !== undefined && recommendedSizeBytes > availableSizeBytes
            ? `推荐大小 ${this.formatHex(recommendedSizeBytes)} 已超过当前分区到下一个分区之间的可用空间 ${this.formatHex(availableSizeBytes)}，需要同步调整后续分区布局。`
            : undefined;

        return {
            status: 'OK',
            partitionFile: partitionInfo.partitionFile,
            targetPartition,
            appBinarySizeBytes,
            currentPartitionSizeBytes: targetPartition.size,
            overflowBytes,
            recommendedSizeBytes,
            recommendedSizeHex: this.formatHex(recommendedSizeBytes),
            availableSizeBytes,
            availableSizeHex: availableSizeBytes !== undefined ? this.formatHex(availableSizeBytes) : undefined,
            warning,
            suggestion: warning
                ? `建议将 ${targetPartition.name} 分区从 ${this.formatHex(targetPartition.size)} 扩容到至少 ${this.formatHex(recommendedSizeBytes)}。${warning}`
                : `建议将 ${targetPartition.name} 分区从 ${this.formatHex(targetPartition.size)} 扩容到至少 ${this.formatHex(recommendedSizeBytes)}，并保留约 10%~20% 的后续增长空间。`,
            updatedManifest,
            patch: buildPatchSuggestion({
                path: partitionInfo.partitionFile,
                kind: 'replace_block',
                summary: `将 ${targetPartition.name} 分区大小从 ${this.formatHex(targetPartition.size)} 更新为 ${this.formatHex(recommendedSizeBytes)}。`,
                before: partitionInfo.lines.join('\n'),
                after: updatedManifest
            })
        };
    }

    private async loadPartitionTable(projectPath: string): Promise<{ partitionFile: string; entries: PartitionEntry[]; lines: string[] } | null> {
        const partitionFile = await this.resolvePartitionFile(projectPath);
        if (!partitionFile) {
            return null;
        }

        const content = await readFile(partitionFile, 'utf-8');
        const lines = content.replace(/\r\n/g, '\n').split('\n');
        const entries: PartitionEntry[] = [];

        lines.forEach((line, index) => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) {
                return;
            }

            const columns = line.split(',').map((item) => item.trim());
            if (columns.length < 5) {
                return;
            }

            const [name, type, subtype, offset, size, flags] = columns;
            entries.push({
                name,
                type,
                subtype,
                offset: this.parseSize(offset),
                size: this.parseSize(size),
                flags,
                lineIndex: index,
                rawLine: line
            });
        });

        return { partitionFile, entries, lines };
    }

    private async resolvePartitionFile(projectPath: string): Promise<string | null> {
        const configCandidates = [
            path.join(projectPath, 'sdkconfig'),
            path.join(projectPath, 'sdkconfig.defaults')
        ];

        for (const configPath of configCandidates) {
            if (!await pathExists(configPath)) {
                continue;
            }

            const content = await readFile(configPath, 'utf-8');
            const customMatch = content.match(/CONFIG_PARTITION_TABLE_CUSTOM_FILENAME="([^"]+)"/);
            if (customMatch) {
                const candidate = path.resolve(projectPath, customMatch[1]);
                if (await pathExists(candidate)) {
                    return candidate;
                }
            }
        }

        const fallback = path.join(projectPath, 'partitions.csv');
        if (await pathExists(fallback)) {
            return fallback;
        }

        return null;
    }

    private pickTargetPartition(entries: PartitionEntry[], preferredName?: string): PartitionEntry | undefined {
        const appEntries = entries.filter((entry) => entry.type === 'app');
        if (preferredName) {
            const exact = appEntries.find((entry) => entry.name === preferredName);
            if (exact) return exact;
        }

        return appEntries.find((entry) => entry.subtype === 'factory')
            || appEntries.find((entry) => entry.subtype === 'ota_0')
            || appEntries[0];
    }

    private extractPartitionName(rawLog: string): string | undefined {
        const match = rawLog.match(/Part '([^']+)'/);
        return match?.[1];
    }

    private extractNumber(rawLog: string, patterns: RegExp[]): number | undefined {
        for (const pattern of patterns) {
            const match = rawLog.match(pattern);
            if (match?.[1]) {
                return this.parseSize(match[1]);
            }
        }

        return undefined;
    }

    private findAvailableSize(entries: PartitionEntry[], targetPartition: PartitionEntry): number | undefined {
        if (targetPartition.offset === undefined || targetPartition.size === undefined) {
            return undefined;
        }

        const nextOffset = entries
            .filter((entry) => entry.offset !== undefined && entry.offset > targetPartition.offset)
            .map((entry) => entry.offset as number)
            .sort((left, right) => left - right)[0];

        if (nextOffset === undefined) {
            return undefined;
        }

        return nextOffset - targetPartition.offset;
    }

    private buildUpdatedManifest(lines: string[], targetPartition: PartitionEntry, recommendedSizeBytes: number): string {
        const nextLines = [...lines];
        const columns = nextLines[targetPartition.lineIndex].split(',');
        while (columns.length < 6) {
            columns.push('');
        }
        columns[4] = this.formatHex(recommendedSizeBytes);
        nextLines[targetPartition.lineIndex] = columns.join(',');
        return `${nextLines.join('\n').replace(/\n*$/, '\n')}`;
    }

    private parseSize(value?: string): number | undefined {
        if (!value) return undefined;
        const trimmed = value.trim();
        if (!trimmed) return undefined;
        if (/^0x/i.test(trimmed)) {
            return Number.parseInt(trimmed, 16);
        }
        if (/^[0-9]+[KkMm]$/.test(trimmed)) {
            const multiplier = trimmed.toLowerCase().endsWith('m') ? 1024 * 1024 : 1024;
            return Number.parseInt(trimmed.slice(0, -1), 10) * multiplier;
        }
        if (/^[0-9]+$/.test(trimmed)) {
            return Number.parseInt(trimmed, 10);
        }
        return undefined;
    }

    private alignToAppBoundary(value: number): number {
        return Math.ceil(value / this.appPartitionAlignment) * this.appPartitionAlignment;
    }

    private formatHex(value: number): string {
        return `0x${value.toString(16)}`;
    }
}
