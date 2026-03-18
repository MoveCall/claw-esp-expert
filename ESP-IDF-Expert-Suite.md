# 🦞 OpenClaw Skill: ESP-IDF Expert Suite (项目白皮书 v1.1)

**项目代号**: `Claw-IDF-Expert`
**目标平台**: OpenClaw.ai (ClawHub) / NPM 包管理 / GitHub
**技术栈**: TypeScript + Node.js + OpenClaw Skill API
**定位**: 专为 ESP32 系列芯片与 ESP-IDF (v5.x+) 框架打造的**天花板级、软硬结合**的 AI 研发助理。

## 🌟 项目愿景 (Vision)

传统的 AI 编程助手通常只能处理纯文本层面的 C/C++ 代码，而在实际的嵌入式开发中，开发者面临的最大痛点往往是**环境配置噩梦、网络墙、底层硬件引脚冲突、内存/Flash溢出以及晦涩的编译报错**。

**Claw-IDF-Expert** 不是一个简单的脚本封装，而是一个具备**“网络环境感知”、“生态组件直连”、“硬件约束记忆”和“自主调试闭环”**的 Agentic Skill。它将彻底填平 ESP-IDF 的入门门槛，让 AI 真正懂硬件工程。

---

## 🏗️ 核心架构设计 (Architecture)

本项目采用模块化工程标准，核心分为四层：

1.  **AI 交互层 (`SKILL.md`)**：定义 Agent 的专家级 System Prompt，强制 AI 遵循“环境先行”、“诊断优先”的严谨工程逻辑。
2.  **异步控制引擎 (Async Controller)**：采用**非阻塞流式任务调度**。针对 `idf.py build` 等长达数分钟的任务，保持与 LLM 的心跳汇报，彻底杜绝 AI 等待超时。
3.  **硬件知识库引擎 (Hardware KB)**：内置结构化的芯片引脚与资源 JSON 数据库，彻底根除大模型在引脚复用上的“幻觉”。
4.  **本地生态桥接 (Ecosystem Bridge)**：直连官方组件注册表 (Component Registry) 与本地 IDE 配置。

---

## 🚀 核心功能模块 (Core Features)

### 1. 🌐 Step 0: 极速环境守护与智能镜像 (Smart Environment & Mirror Engine)
*   **VS Code 零配置继承**: 启动时静默嗅探工作区的 `.vscode/settings.json`，自动继承用户已有的 `idf.customExtraPaths` 和串口配置，做到真正的开箱即用。
*   **智能测速与全链路加速**: 针对未安装环境的用户，自动测速并启用**国内极速安装模式**：
    *   主仓库自动切换至 `Gitee 镜像`。
    *   调用 `esp-gitee-tools` 重定向所有 Git 子模块。
    *   注入 `IDF_GITHUB_ASSETS="dl.espressif.cn"` 走官方 CDN 极速下载几百兆的工具链。
    *   自动配置清华 PyPI 源，将原本数小时的部署缩短至 5 分钟。
*   **设备权限处理**: 自动识别 Linux/macOS 的 `Permission denied` 串口问题，一键注入 `dialout` 权限修复。

### 2. 📚 语义化项目导航与生态直连 (Semantic Navigator & Registry)
*   **组件库智能挂载 (Component Registry)**: 告别手写 CMake。用户提出需求（如“我要用 WS2812”），AI 自动检索 `components.espressif.com`，一键生成 `idf_component.yml` 并处理版本依赖。
*   **意图驱动检索**: 通过自然语言在本地轻量级向量库中毫秒级匹配 `$IDF_PATH/examples` 下的最佳 Demo。
*   **README 优先策略**: 调研陌生模块时，强制优先读取其 `README.md`，提取“硬件依赖”与“前置配置”，一键搬运 Demo 到当前工程。

### 3. 🛠️ 智能诊断与分区规划 (Smart Diagnostic & Partition Manager)
*   **语义化编译诊断**: 拦截 `idf.py build` 的冗长 Raw Log，提取 Error/Warning，结合项目源码给出“错误归因 + 精准修复代码”。
*   **动态分区表推演 (Smart Partition)**: 彻底解决 `app is too large` 报错。自动读取 `partitions.csv`，分析 `.bin` 体积，主动提议并一键扩容 `factory` 分区，同步修改 `sdkconfig`。
*   **配置自动化 (Menuconfig)**: 支持自然语言下达配置需求，自动改写 `sdkconfig.defaults`。

### 4. ⚡ 跨越软硬边界的杀手级审查 (Hardware-Aware Expert)
*   **智能引脚防坑 (Smart Pinmux Checker)**: 
    *   **机制**: 基于内置的芯片 JSON 数据字典（如 `esp32c3.json`、`esp32s3.json`）。
    *   **效果**: 在编译前自动扫描引脚分配。如果用户将 Strapping 启动引脚、仅输入引脚 (Input-only) 误配为输出，AI 会直接抛出“硬件专家级警告”，阻止低级硬件故障。
*   **内存性能调优 (IRAM Profiling)**: 分析 `idf.py size` 数据，针对 `iram0_0_seg overflow` 问题，给出具体的任务栈缩减或组件 Flash 优化建议。

### 5. 🐞 硬件级调试与闭环 (HIL & Monitor)
*   **Panic 堆栈自动解码**: 接管 `idf.py monitor` 串口流，捕获设备崩溃日志，自动调用 `addr2line` 定位到具体的 `.c` 文件行号，并解释崩溃原因（如空指针、看门狗超时）。
*   **自主硬件在环测试 (Auto HIL TDD)**: 结合 `pytest-embedded`，实现“生成测试 -> 自动烧录 -> 读取串口断言 -> 失败自动修改代码 -> 重新烧录”的全自动开发闭环。

---

## 🗄️ 硬件数据字典设计规范 (Hardware KB Schema)

为了防止 LLM 幻觉，项目中 `src/data/soc/` 目录下将维护各芯片的真实物理规则。
*示例：`esp32s3.json` 局部*
```json
{
  "chip": "esp32s3",
  "strapping_pins": {
    "pins":[0, 3, 45, 46],
    "warning": "启动控制引脚，外部上下拉电阻可能导致无法进入下载模式。"
  },
  "reserved_pins": {
    "flash_psram":[26, 27, 28, 29, 30, 31, 32, 33],
    "warning": "连接内部 SPI Flash/PSRAM，严禁作为普通 GPIO 使用。"
  },
  "special_functions": {
    "usb_d_minus": 19,
    "usb_d_plus": 20
  }
}
```

📁 推荐工程目录结构 (Project Scaffold)

```
esp-idf-expert/
├── package.json           # NPM 管理，依赖描述
├── README.md              # 项目首页与使用说明
├── SKILL.md               # 核心：OpenClaw Agent 的 System Prompt 与工具指令
├── src/
│   ├── index.ts           # Skill 主入口与路由
│   ├── env/               # IDF 环境检测与依赖管理
│   ├── build/             # 编译捕获、CMake分析与错误诊断
│   ├── monitor/           # 串口接管与 Panic Decoder
│   ├── search/            # 向量化检索与 README 解析 (SmartDoc)
│   ├── tools/             # 提供给 AI 调用的原子化工具集合
│   └── data/
│       └── soc/           # 🌟 核心资产：各版本芯片引脚与特性 JSON 数据库
├── scripts/               # 自动化脚本 (如从 IDF 源码提取引脚数据生成 JSON)
└── tests/                 # 测试集 (集成测试与错误模拟)
```


## 🗺️ 研发路线图 (Roadmap)

### Phase 1: MVP 核心基建 (基础闭环与极速安装)
- [ ] **初始化工程结构**: 搭建 Node.js/TS 开发脚手架，确立异步非阻塞任务调度模型。
- [ ] **编写核心 `SKILL.md`**: 定义 AI 的“专家级”人设、指令优先级及原子化工具（Tools）声明。
- [ ] **实现通用环境探测 (Health Check)**:
    - 优先检测 `$IDF_PATH` 和系统 `PATH` 变量。
    - 实现对标准安装路径（~/esp/esp-idf等）的深度扫描。
- [ ] **实现智能镜像安装器 (Smart Installer) [高优先级]**: 
    - 实现 **Gitee 镜像一键拉取**。
    - 实现 **dl.espressif.cn CDN 加速工具链下载**逻辑。
    - 实现 Python 源自动切换（清华源/阿里源）。

### Phase 2: 体验升级 (生态打通与工程痛点)
- [ ] **接入 IDF Component Registry**: 实现 `idf_component.yml` 的自动生成与组件版本检索。
- [ ] **实现智能编译诊断**: 封装 `idf.py build`，实现错误日志的语义化截取与 AI 修复建议。
- [ ] **实现动态分区表推演 (Smart Partition)**: 自动分析 Flash 占用并一键生成/扩容 `partitions.csv`。
- [ ] **实现故障解码器 (Panic Decoder)**: 自动捕获串口日志，实现基于 `addr2line` 的崩溃定位。

### Phase 3: 天花板级特性 (硬件感知与自主闭环)
- [ ] **建立硬件数据库 (Hardware KB)**: 完成 `src/data/soc/` 下各芯片引脚特性的结构化数据填充。
- [ ] **实现引脚冲突审查 (Smart Pinmux Checker)**: 自动扫描源码中的引脚配置，对照硬件库输出专家级警告。
- [ ] **实现内存调优顾问 (IRAM Profiling)**: 基于 `idf.py size` 提供针对性的优化策略。
- [ ] **IDE 配置辅助 (Optional)**: 增加对 VS Code 等插件配置的读取能力，作为环境检测的补充。