import { EnvManager } from './env';
import { ProjectNavigator } from './search/ProjectNavigator';
import { PinmuxAuditor } from './build/PinmuxAuditor';
import { AsyncBuildManager } from './build/AsyncBuildManager';

// 初始化所有专家模块
const env = new EnvManager();
const auditor = new PinmuxAuditor();
const builder = new AsyncBuildManager();

export const skillTools = {
    /**
     * 工具：环境巡检与一键安装
     */
    async manage_env(args: { action: 'check' | 'install', version?: string }) {
        if (args.action === 'check') {
            return await env.checkExistingEnv();
        }
        return await env.installIDF(`${process.env.HOME}/esp/esp-idf`, args.version);
    },

    /**
     * 工具：智能 Demo 导航
     */
    async explore_demo(args: { query: string }) {
        const idfPath = (await env.checkExistingEnv()).path;
        const nav = new ProjectNavigator(idfPath!);
        const paths = await nav.findExamples(args.query);
        if (paths.length === 0) return "未找到相关示例。";
        
        // 自动分析第一个最匹配的 Demo
        return await nav.getModuleDetails(paths[0]);
    },

    /**
     * 工具：安全构建 (核心闭环)
     */
    async safe_build(args: { projectPath: string, chip: string }) {
        // 1. 硬件审计先行
        await auditor.loadSocRules(args.chip);
        const issues = await auditor.auditSourceCode(args.projectPath);
        
        const fatalIssues = issues.filter(i => i.level === 'FATAL' || i.level === 'CRITICAL');
        if (fatalIssues.length > 0) {
            return {
                status: 'REJECTED',
                reason: '硬件物理规则冲突',
                issues: fatalIssues
            };
        }

        // 2. 异步构建
        return await builder.build(args.projectPath, (msg) => {
            console.log(`[Build Progress]: ${msg}`);
            // 这里可以通过 OpenClaw 的回调机制实时推送给用户
        });
    }
};