import path from 'path';
import { readFile } from 'node:fs/promises';
import { EnvManager } from './env';
import { ProjectNavigator } from './search/ProjectNavigator';
import { PinmuxAuditor } from './build/PinmuxAuditor';
import { AsyncBuildManager } from './build/AsyncBuildManager';
import { PartitionAdvisor } from './build/PartitionAdvisor';
import { MonitorAnalyzer } from './monitor/MonitorAnalyzer';
import { PanicDecoder } from './monitor/PanicDecoder';
import { FlashMonitorManager } from './monitor/FlashMonitorManager';
import { ComponentRegistry } from './registry/ComponentRegistry';
import { ComponentManifestManager } from './registry/ComponentManifest';
import { ExecutionOrchestrator } from './workflow/ExecutionOrchestrator';

// 初始化所有专家模块
const env = new EnvManager();
const auditor = new PinmuxAuditor();
const builder = new AsyncBuildManager();
const partitionAdvisor = new PartitionAdvisor();
const monitorAnalyzer = new MonitorAnalyzer();
const panicDecoder = new PanicDecoder();
const flashMonitorManager = new FlashMonitorManager();
const registry = new ComponentRegistry();
const manifestManager = new ComponentManifestManager();
const orchestrator = new ExecutionOrchestrator(auditor, builder, flashMonitorManager);

export const skillTools = {
    /**
     * 工具：环境巡检与一键安装
     */
    async manage_env(args: { action: 'check' | 'install', version?: string }) {
        if (args.action === 'check') {
            return await env.checkExistingEnv();
        }

        const homeDir = process.env.HOME || process.env.USERPROFILE || process.cwd();
        const installPath = path.join(homeDir, 'esp', 'esp-idf');
        return await env.installIDF(installPath, args.version);
    },

    /**
     * 工具：智能 Demo 导航
     */
    async explore_demo(args: { query: string }) {
        const envState = await env.checkExistingEnv();
        if (!envState.path) {
            return {
                status: 'ENV_NOT_READY',
                reason: '未检测到本地 ESP-IDF 路径，请先执行 manage_env({ action: "check" })。',
                env: envState
            };
        }

        const nav = new ProjectNavigator(envState.path);
        const paths = await nav.findExamples(args.query);
        if (paths.length === 0) {
            return {
                status: 'NOT_FOUND',
                query: args.query,
                reason: '未找到相关示例。'
            };
        }
        
        // 自动分析第一个最匹配的 Demo
        return {
            status: 'OK',
            query: args.query,
            matches: paths,
            module: await nav.getModuleDetails(paths[0])
        };
    },

    /**
     * 工具：官方 Component Registry 组件建议
     */
    async resolve_component(args: { query: string, target?: string, manifest?: string, manifestPath?: string }) {
        try {
            const result = await registry.resolveComponent(args.query, args.target);
            if (result.status !== 'OK' || !result.suggestion) {
                return result;
            }

            let manifestSource = args.manifest;
            if (!manifestSource && args.manifestPath) {
                manifestSource = await readFile(args.manifestPath, 'utf-8');
            }

            if (!manifestSource) {
                return result;
            }

            return {
                ...result,
                manifestUpdate: manifestManager.mergeDependency(manifestSource, result.suggestion)
            };
        } catch (error: any) {
            return {
                status: 'REGISTRY_ERROR',
                query: args.query,
                target: args.target,
                reason: error.message || '访问官方 Component Registry 失败。'
            };
        }
    },

    /**
     * 工具：分析分区表与 app 体积溢出建议
     */
    async analyze_partitions(args: { projectPath: string, rawLog?: string }) {
        return await partitionAdvisor.analyzeProject(args.projectPath, args.rawLog || '');
    },

    /**
     * 工具：Panic 日志解码
     */
    async decode_panic(args: { chip: string, elfPath: string, log: string, addr2lineBin?: string }) {
        return await panicDecoder.decode(args);
    },

    /**
     * 工具：分析 monitor 日志并在检测到 panic 时串联解码
     */
    async analyze_monitor(args: { chip: string, log: string, elfPath?: string, addr2lineBin?: string }) {
        return await monitorAnalyzer.analyze(args);
    },

    /**
     * 工具：执行 flash + monitor，并在 panic 时自动分析
     */
    async flash_and_monitor(args: { projectPath: string, chip: string, port?: string, baud?: number, elfPath?: string, addr2lineBin?: string, timeoutMs?: number }) {
        return await flashMonitorManager.run(args);
    },

    /**
     * 工具：最小执行闭环，串联 build -> flash_and_monitor
     */
    async execute_project(args: { projectPath: string, chip: string, port?: string, baud?: number, elfPath?: string, addr2lineBin?: string }) {
        return await orchestrator.execute(args);
    },

    /**
     * 工具：安全构建 (核心闭环)
     */
    async safe_build(args: { projectPath: string, chip?: string }) {
        const chip = args.chip || 'esp32';
        const resolvedChip = auditor.resolveChipTarget(chip);
        const envState = await env.checkExistingEnv();
        if (!envState.idfPyAvailable) {
            return {
                status: 'ENV_NOT_READY',
                reason: '未检测到可执行的 idf.py，请先加载或安装 ESP-IDF 环境。',
                env: envState
            };
        }

        // 1. 硬件审计先行
        try {
            await auditor.loadSocRules(chip);
        } catch (error: any) {
            return {
                status: 'UNSUPPORTED_CHIP',
                chip,
                resolvedChip,
                reason: error.message
            };
        }

        const issues = await auditor.auditSourceCode(args.projectPath);
        
        const fatalIssues = issues.filter(i => i.level === 'FATAL' || i.level === 'CRITICAL');
        if (fatalIssues.length > 0) {
            return {
                status: 'REJECTED',
                reason: '硬件物理规则冲突',
                chip,
                resolvedChip,
                issues: fatalIssues
            };
        }

        // 2. 异步构建
        const build = await builder.build(args.projectPath, (msg) => {
            console.log(`[Build Progress]: ${msg}`);
            // 这里可以通过 OpenClaw 的回调机制实时推送给用户
        });

        return {
            status: build.success ? 'SUCCESS' : 'FAILED',
            chip,
            resolvedChip,
            issues,
            build
        };
    }
};
