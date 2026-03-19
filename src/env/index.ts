import path from 'path';
import { pathExists } from '../common/fs';

export interface EnvCheckResult {
    status: 'READY' | 'FOUND_NOT_EXPORTED' | 'NOT_FOUND';
    path?: string;
    pythonAvailable: boolean;
    idfPyAvailable: boolean;
}

export class EnvManager {
    private readonly MIRRORS = {
        GITHUB: 'https://github.com/espressif/esp-idf.git',
        GITEE: 'https://gitee.com/EspressifSystems/esp-idf.git',
        CDN_ASSETS: 'https://dl.espressif.cn/github_assets'
    };

    /**
     * 返回静态的手动安装建议，不在 skill 内主动联网测速
     */
    async installIDF(targetPath: string, version: string = 'v5.3') {
        return {
            status: 'MANUAL_INSTALL_REQUIRED' as const,
            path: targetPath,
            version,
            options: {
                github: {
                    repository: this.MIRRORS.GITHUB,
                    commands: [
                        `git clone --recursive -b ${version} ${this.MIRRORS.GITHUB} ${targetPath}`,
                        `cd ${targetPath} && ./install.sh`
                    ]
                },
                gitee: {
                    repository: this.MIRRORS.GITEE,
                    mirrorAssets: this.MIRRORS.CDN_ASSETS,
                    commands: [
                        `git clone --recursive -b ${version} ${this.MIRRORS.GITEE} ${targetPath}`,
                        `cd ${targetPath} && export IDF_GITHUB_ASSETS=${this.MIRRORS.CDN_ASSETS} && ./install.sh`
                    ]
                }
            },
            suggestion: '建议先使用 manage_env({ action: "check" }) 确认本地环境状态；若确需安装，请手动选择 GitHub 或 Gitee 路径执行官方安装脚本。'
        };
    }

    /**
     * 环境嗅探：检查现有 IDF 状态
     */
    async checkExistingEnv(): Promise<EnvCheckResult> {
        const pythonAvailable = await this.checkCommandAvailable('python3')
            || await this.checkCommandAvailable('python');
        const idfPyAvailable = await this.checkCommandAvailable('idf.py');
        const homeDir = process.env.HOME || process.env.USERPROFILE;

        if (process.env.IDF_PATH) {
            return {
                status: 'READY',
                path: process.env.IDF_PATH,
                pythonAvailable,
                idfPyAvailable
            };
        }

        const commonPaths = [
            homeDir ? path.join(homeDir, 'esp', 'esp-idf') : undefined,
            'C:\\esp\\esp-idf'
        ].filter((value): value is string => Boolean(value));

        for (const candidate of commonPaths) {
            if (await pathExists(candidate)) {
                return {
                    status: 'FOUND_NOT_EXPORTED',
                    path: candidate,
                    pythonAvailable,
                    idfPyAvailable
                };
            }
        }

        return {
            status: 'NOT_FOUND',
            pythonAvailable,
            idfPyAvailable
        };
    }

    private async checkCommandAvailable(command: string): Promise<boolean> {
        const pathValue = process.env.PATH;
        if (!pathValue) {
            return false;
        }

        const extensions = process.platform === 'win32'
            ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM')
                .split(';')
                .filter(Boolean)
            : [''];

        for (const dir of pathValue.split(path.delimiter)) {
            if (!dir) continue;
            for (const extension of extensions) {
                const candidate = process.platform === 'win32' && extension
                    ? path.join(dir, `${command}${extension}`)
                    : path.join(dir, command);
                if (await pathExists(candidate)) {
                    return true;
                }
            }
        }

        return false;
    }
}
