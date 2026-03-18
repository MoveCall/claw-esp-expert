import { execa } from 'execa';
import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';

export interface BuildResult {
    success: boolean;
    errorType?: 'COMPILATION_ERROR' | 'LINK_ERROR' | 'PARTITION_OVERFLOW' | 'ENV_ERROR';
    rawError?: string;
    cleanError?: string;
    suggestion?: string;
}

export class AsyncBuildManager {
    /**
     * 执行异步编译，并实时反馈进度
     */
    async build(projectPath: string, onProgress?: (msg: string) => void): Promise<BuildResult> {
        onProgress?.("🔍 正在初始化构建环境...");
        
        try {
            // 1. 检查 CMakeLists.txt 是否存在
            if (!await fs.pathExists(path.join(projectPath, 'CMakeLists.txt'))) {
                return { success: false, errorType: 'ENV_ERROR', cleanError: "未找到 CMakeLists.txt，请确认当前目录是标准的 ESP-IDF 工程。" };
            }

            // 2. 启动构建进程 (使用 execa 捕获实时输出)
            onProgress?.("🚀 启动 idf.py build (此过程可能需要 1-3 分钟)...");
            
            const subprocess = execa('idf.py', ['build'], {
                cwd: projectPath,
                all: true, // 合并 stdout 和 stderr
                env: { ...process.env, FORCE_COLOR: '1' }
            });

            // 监听实时日志，提取进度百分比 (例如 [12/1050])
            subprocess.all?.on('data', (chunk) => {
                const data = chunk.toString();
                const progressMatch = data.match(/\[(\d+)\/(\d+)\]/);
                if (progressMatch) {
                    const current = parseInt(progressMatch[1]);
                    const total = parseInt(progressMatch[2]);
                    const percent = Math.round((current / total) * 100);
                    if (percent % 10 === 0) onProgress?.(`⚡ 编译进度: ${percent}% (${current}/${total})`);
                }
            });

            await subprocess;
            return { success: true };

        } catch (error: any) {
            // 3. 进入“编译现场分析”模式
            return this.diagnoseError(error.all || error.message);
        }
    }

    /**
     * 核心诊断算法：语义化提取错误
     */
    private diagnoseError(rawLog: string): BuildResult {
        // 模式 A: 分区表溢出 (最常见的初学者错误)
        if (rawLog.includes("is too large") || rawLog.includes("section `.flash.app' will not fit in region `iram0_0_seg'")) {
            return {
                success: false,
                errorType: 'PARTITION_OVERFLOW',
                cleanError: "程序体积超过了分区表设定的 factory 限制。",
                suggestion: "建议调用 Smart Partition 工具扩容 partitions.csv，或通过 menuconfig 开启代码优化等级 (-Os)。"
            };
        }

        // 模式 B: 标准 C 语法错误 (提取文件名和行号)
        const cErrorMatch = rawLog.match(/(.+\.[ch]):(\d+):(\d+): (error: .+)($|\n)/);
        if (cErrorMatch) {
            return {
                success: false,
                errorType: 'COMPILATION_ERROR',
                rawError: rawLog.slice(-500), // 保留末尾日志供 AI 参考
                cleanError: `代码错误: 在 ${path.basename(cErrorMatch[1])} 的第 ${cErrorMatch[2]} 行发生 [${cErrorMatch[4]}]`,
                suggestion: "请 AI 检查该行代码逻辑，通常是缺少分号、头文件未包含或变量名拼写错误。"
            };
        }

        // 模式 C: 链接错误 (组件依赖丢失)
        if (rawLog.includes("undefined reference to")) {
            return {
                success: false,
                errorType: 'LINK_ERROR',
                cleanError: "符号引用未定义（链接失败）。",
                suggestion: "这通常是因为在 CMakeLists.txt 的 PRIV_REQUIRES 中漏掉了必要的组件库。请检查是否引入了对应的驱动组件。"
            };
        }

        return {
            success: false,
            errorType: 'COMPILATION_ERROR',
            rawError: rawLog.slice(-1000),
            cleanError: "未识别的编译错误，请参考原始日志末尾。"
        };
    }
}