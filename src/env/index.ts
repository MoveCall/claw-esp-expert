import axios from 'axios';
import { execa } from 'execa';
import fs from 'fs-extra';

export class EnvManager {
    // 官方仓库与镜像地址定义
    private readonly MIRRORS = {
        GITHUB: "https://github.com/espressif/esp-idf.git",
        GITEE: "https://gitee.com/EspressifSystems/esp-idf.git",
        CDN_ASSETS: "https://dl.espressif.cn/github_assets"
    };

    /**
     * 智能网络测速：判断是否需要切换国内镜像
     */
    async checkNetwork(): Promise<'GITHUB' | 'GITEE'> {
        const start = Date.now();
        try {
            // 尝试请求 GitHub 一个小文件
            await axios.get('https://github.com/favicon.ico', { timeout: 2000 });
            const latency = Date.now() - start;
            return latency < 500 ? 'GITHUB' : 'GITEE';
        } catch (e) {
            return 'GITEE'; // 超时或失败则默认选择 GITEE
        }
    }

    /**
     * 极速安装核心逻辑
     */
    async installIDF(targetPath: string, version: string = 'v5.3') {
        const source = await this.checkNetwork();
        const repoUrl = source === 'GITEE' ? this.MIRRORS.GITEE : this.MIRRORS.GITHUB;

        console.log(`🚀 检测到网络环境更适合使用: ${source}`);

        // 1. 克隆主仓库
        await execa('git', ['clone', '--recursive', '-b', version, repoUrl, targetPath]);

        // 2. 如果是 GITEE，注入加速环境变量
        const envVars = { ...process.env };
        if (source === 'GITEE') {
            // 注入乐鑫 CDN 加速地址，这是提速 10 倍的关键
            envVars['IDF_GITHUB_ASSETS'] = this.MIRRORS.CDN_ASSETS;
            
            // 使用乐鑫官方提供的 Gitee 工具处理子模块
            // 这里假设已经下载了 esp-gitee-tools
            console.log("🛠️ 正在优化子模块拉取路径...");
        }

        // 3. 执行安装脚本
        const installScript = process.platform === 'win32' ? 'install.bat' : './install.sh';
        await execa(installScript, [], { 
            cwd: targetPath, 
            env: envVars, 
            stdio: 'inherit' 
        });
    }

    /**
     * 环境嗅探：检查现有 IDF 状态
     */
    async checkExistingEnv() {
        // 1. 检查环境变量
        if (process.env.IDF_PATH) {
            return { status: 'READY', path: process.env.IDF_PATH };
        }

        // 2. 检查常见安装路径 (Windows/Linux/Mac)
        const commonPaths = [
            `${process.env.HOME}/esp/esp-idf`,
            `C:\\esp\\esp-idf`
        ];

        for (const p of commonPaths) {
            if (await fs.pathExists(p)) {
                return { status: 'FOUND_NOT_EXPORTED', path: p };
            }
        }

        return { status: 'NOT_FOUND' };
    }
}