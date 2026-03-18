import fs from 'fs-extra';
import path from 'path';
import { execa } from 'execa';

export interface ModuleBrief {
    name: string;
    path: string;
    description: string;
    hardwareRequirements: string[];
    treeStructure: string;
}

export class ProjectNavigator {
    private idfPath: string;

    constructor(idfPath: string) {
        this.idfPath = idfPath;
    }

    /**
     * 语义化搜索：根据关键词在 examples 目录中寻找匹配项
     */
    async findExamples(query: string): Promise<string[]> {
        const examplesDir = path.join(this.idfPath, 'examples');
        
        // 高规格做法：使用 find 或 grep 命令快速定位包含关键词的目录
        // 也可以遍历目录层级，这里展示逻辑核心
        const results: string[] = [];
        
        try {
            // 简单的递归搜索包含 query 的文件夹名
            const walk = async (dir: string) => {
                const files = await fs.readdir(dir);
                for (const file of files) {
                    const fullPath = path.join(dir, file);
                    const stat = await fs.stat(fullPath);
                    
                    if (stat.isDirectory()) {
                        // 如果文件夹名字匹配，或者包含 CMakeLists.txt (说明是工程)
                        if (file.toLowerCase().includes(query.toLowerCase())) {
                            if (await fs.pathExists(path.join(fullPath, 'CMakeLists.txt'))) {
                                results.push(fullPath);
                            }
                        }
                        // 限制搜索深度，防止递归过深
                        if (results.length < 5) await walk(fullPath);
                    }
                }
            };
            
            await walk(examplesDir);
            return results;
        } catch (e) {
            console.error("搜索示例失败:", e);
            return [];
        }
    }

    /**
     * 核心逻辑：获取模块深度信息 (README 优先)
     */
    async getModuleDetails(modulePath: string): Promise<ModuleBrief> {
        const readmePath = await this.findReadme(modulePath);
        let description = "未找到 README 说明。";
        let hardware: string[] = [];

        if (readmePath) {
            const content = await fs.readFile(readmePath, 'utf-8');
            description = this.extractSummary(content);
            hardware = this.extractHardwareInfo(content);
        }

        const tree = await this.generateConciseTree(modulePath);

        return {
            name: path.basename(modulePath),
            path: modulePath,
            description,
            hardwareRequirements: hardware,
            treeStructure: tree
        };
    }

    /**
     * 寻找 README，支持中英文优先级
     */
    private async findReadme(dir: string): Promise<string | null> {
        const files = ['README_CN.md', 'README_cn.md', 'README.md'];
        for (const f of files) {
            const p = path.join(dir, f);
            if (await fs.pathExists(p)) return p;
        }
        return null;
    }

    /**
     * 提取 README 中的功能摘要 (通常是第一段)
     */
    private extractSummary(content: string): string {
        // 简单逻辑：取第一个非标题段落
        const lines = content.split('\n').filter(l => l.trim().length > 0 && !l.startsWith('#'));
        return lines[0] ? lines[0].slice(0, 200) + '...' : "暂无摘要";
    }

    /**
     * 提取硬件依赖 (寻找 "Hardware Required" 或 "硬件需求" 关键字)
     */
    private extractHardwareInfo(content: string): string[] {
        const regex = /(?:Hardware Required|硬件需求|所需硬件)[\s\S]*?(?=\n#|$)/i;
        const match = content.match(regex);
        if (match) {
            return match[0].split('\n').slice(1, 5).map(l => l.replace(/[*->]/g, '').trim());
        }
        return ["通用 ESP32 开发板"];
    }

    /**
     * 生成精简目录树 (深度为2)
     */
    private async generateConciseTree(dir: string): Promise<string> {
        let tree = `${path.basename(dir)}/\n`;
        const files = await fs.readdir(dir);
        
        for (const file of files) {
            if (file.startsWith('.')) continue; // 跳过隐藏文件
            const fullPath = path.join(dir, file);
            const stat = await fs.stat(fullPath);
            
            if (stat.isDirectory()) {
                tree += `├── ${file}/\n`;
                // 只看 main 目录里面
                if (file === 'main') {
                    const subFiles = await fs.readdir(fullPath);
                    subFiles.forEach(sf => tree += `│   ├── ${sf}\n`);
                }
            } else {
                // 只列出核心构建文件
                if (['CMakeLists.txt', 'Makefile', 'Kconfig'].includes(file)) {
                    tree += `├── ${file}\n`;
                }
            }
        }
        return tree;
    }
}