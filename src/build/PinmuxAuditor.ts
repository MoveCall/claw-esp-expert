import fs from 'fs-extra';
import path from 'path';

// 定义物理规则的接口
interface SocRules {
    chip: string;
    physical_limits: {
        input_only_pins: { pins: number[]; warning: string };
        internal_flash_psram: { pins: number[]; warning: string };
        strapping_pins: { pins: number[]; critical_logic: Record<string, string> };
    };
    peripherals: {
        adc: { conflict: { target: string; with: string; warning: string }; adc2: number[] };
    };
}

export interface AuditResult {
    level: 'INFO' | 'WARNING' | 'CRITICAL' | 'FATAL';
    pin?: number;
    message: string;
    suggestion: string;
}

export class PinmuxAuditor {
    private rules: SocRules | null = null;

    /**
     * 加载对应芯片的物理规则库
     */
    async loadSocRules(target: string = 'esp32'): Promise<void> {
        const rulePath = path.join(__dirname, `../data/soc/${target}.json`);
        if (await fs.pathExists(rulePath)) {
            this.rules = await fs.readJson(rulePath);
        } else {
            throw new Error(`未找到芯片 ${target} 的物理规则库`);
        }
    }

    /**
     * 核心审计函数：对源码进行静态扫描
     */
    async auditSourceCode(projectPath: string): Promise<AuditResult[]> {
        if (!this.rules) throw new Error("规则库未加载");
        
        const results: AuditResult[] = [];
        const mainDir = path.join(projectPath, 'main');
        
        // 1. 获取所有 C/CPP 源码内容
        const sourceFiles = await this.getFiles(mainDir, /\.(c|cpp|h)$/);
        let combinedCode = "";
        for (const file of sourceFiles) {
            combinedCode += await fs.readFile(file, 'utf-8');
        }

        // 2. 提取代码中引用的所有 GPIO 编号
        // 匹配 GPIO_NUM_X 或直接的数字赋值
        const usedPins = this.extractGpioNumbers(combinedCode);

        // 3. 执行规则审计
        results.push(...this.checkFlashPins(usedPins));
        results.push(...this.checkInputOnlyPins(combinedCode, usedPins));
        results.push(...this.checkStrappingPins(usedPins));
        results.push(...this.checkAdc2WifiConflict(combinedCode, usedPins));

        return results;
    }

    /**
     * 规则 1：拦截对内部 Flash/PSRAM 引脚的操作 (FATAL)
     */
    private checkFlashPins(pins: Set<number>): AuditResult[] {
        const results: AuditResult[] = [];
        const flashPins = this.rules!.physical_limits.internal_flash_psram.pins;
        
        pins.forEach(pin => {
            if (flashPins.includes(pin)) {
                results.push({
                    level: 'FATAL',
                    pin,
                    message: `检测到使用了 Flash 专用引脚 GPIO ${pin}。`,
                    suggestion: "这些引脚连接内部存储，绝对禁止在代码中操作，否则系统将直接崩溃。请更换引脚。"
                });
            }
        });
        return results;
    }

    /**
     * 规则 2：检查 Input-Only 引脚是否被误设为输出 (ERROR)
     */
    private checkInputOnlyPins(code: string, pins: Set<number>): AuditResult[] {
        const results: AuditResult[] = [];
        const inputOnly = this.rules!.physical_limits.input_only_pins.pins;

        pins.forEach(pin => {
            if (inputOnly.includes(pin)) {
                // 静态扫描检查代码中是否包含针对该引脚的 OUTPUT 关键字
                const outputRegex = new RegExp(`GPIO_NUM_${pin}[\\s\\S]*?GPIO_MODE_OUTPUT`, 'g');
                if (outputRegex.test(code)) {
                    results.push({
                        level: 'CRITICAL',
                        pin,
                        message: `GPIO ${pin} 物理上仅支持输入，但代码中尝试设为输出。`,
                        suggestion: "该引脚缺少输出驱动电路，请更换为 GPIO 0-33 范围内的引脚。"
                    });
                }
            }
        });
        return results;
    }

    /**
     * 规则 3：Strapping 引脚风险评估 (WARNING)
     */
    private checkStrappingPins(pins: Set<number>): AuditResult[] {
        const results: AuditResult[] = [];
        const strapData = this.rules!.physical_limits.strapping_pins;

        pins.forEach(pin => {
            if (strapData.pins.includes(pin)) {
                results.push({
                    level: 'WARNING',
                    pin,
                    message: `GPIO ${pin} 是启动配置(Strapping)引脚。`,
                    suggestion: `注意：${strapData.critical_logic[pin.toString()]} 建议在硬件电路上避免强拉高/低。`
                });
            }
        });
        return results;
    }

    /**
     * 规则 4：ADC2 与 Wi-Fi 冲突审计 (CRITICAL)
     */
    private checkAdc2WifiConflict(code: string, pins: Set<number>): AuditResult[] {
        const results: AuditResult[] = [];
        const isWifiUsed = code.includes("esp_wifi_start") || code.includes("esp_wifi_init");
        const adc2Pins = this.rules!.peripherals.adc.adc2;

        if (isWifiUsed) {
            pins.forEach(pin => {
                if (adc2Pins.includes(pin) && code.includes(`adc2_get_raw`)) {
                    results.push({
                        level: 'CRITICAL',
                        pin,
                        message: "Wi-Fi 与 ADC2 存在硬件资源冲突。",
                        suggestion: "Wi-Fi 开启时无法使用 ADC2。请将模拟采样引脚更换至 ADC1 域 (GPIO 32-39)。"
                    });
                }
            });
        }
        return results;
    }

    /**
     * 工具函数：正则提取代码中的 GPIO 编号
     */
    private extractGpioNumbers(code: string): Set<number> {
        const pins = new Set<number>();
        const matches = code.matchAll(/GPIO_NUM_(\d+)/g);
        for (const match of matches) {
            pins.add(parseInt(match[1]));
        }
        return pins;
    }

    private async getFiles(dir: string, filter: RegExp): Promise<string[]> {
        const files = await fs.readdir(dir);
        let results: string[] = [];
        for (const file of files) {
            const fullPath = path.join(dir, file);
            if ((await fs.stat(fullPath)).isDirectory()) {
                results = results.concat(await this.getFiles(fullPath, filter));
            } else if (filter.test(file)) {
                results.push(fullPath);
            }
        }
        return results;
    }
}