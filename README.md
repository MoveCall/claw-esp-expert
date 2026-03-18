



# 🦞 Claw-ESP-Expert

> **The definitive AI Agent Skill for ESP-IDF Developers.**  
> 懂硬件、懂网络、懂工程的专业级 ESP32 开发助理。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Platform: OpenClaw](https://img.shields.io/badge/Platform-OpenClaw.ai-blue)](https://openclaw.ai)
[![Framework: ESP-IDF](https://img.shields.io/badge/Framework-ESP--IDF%20v5.x-red)](https://github.com/espressif/esp-idf)


## 🛠️ 安装

```bash
npx @movecall/claw-esp-expert
```

## 🌟 为什么选择 Claw-ESP-Expert？

在嵌入式开发中，代码只是冰山一角。环境配置、硬件冲突、Flash 分区以及网络波动往往是真正的噩梦。**Claw-ESP-Expert** 是首个为 OpenClaw 设计、具备“硬件感知”与“全链路自愈”能力的 AI 专家系统。

### 🚀 差异化核心卖点

- **国内环境极速构建**: 针对中国开发者优化，自动测速并切换 **Gitee 乐鑫镜像** 与 **dl.espressif.cn 官方 CDN**。环境搭建与工具链下载提速 10 倍以上。
- **硬件物理规则审计 (Pinmux Checker)**: 内置 ESP32 全系列芯片物理约束 JSON 库。在烧录前自动拦截引脚冲突、Strapping 引脚风险及 Flash 总线占用等致命错误。
- **语义化编译诊断**: 告别晦涩的编译日志。AI 自动对 stderr 进行切片分析，直接定位到报错代码行并提供修复建议。
- **README 优先策略**: 深度集成官方 Examples，调研陌生模块时强制优先解析其 `README.md`，精准提取硬件连线与 `sdkconfig` 配置要求。

---

## 🏗️ 核心功能模块

### 1. 🌐 环境守护与镜像引擎 (Smart Env)
自动检测 `$IDF_PATH`。若缺失，则启动智能安装：
- **仓库劫持**: `github.com` -> `gitee.com/EspressifSystems`
- **子模块重定向**: 自动调用 `esp-gitee-tools`。
- **CDN 注入**: `export IDF_GITHUB_ASSETS="dl.espressif.cn/github_assets"`。

### 2. 🛡️ 硬件审计器 (Pinmux Auditor)
对比 `src/data/soc/*.json` 规则库：
- **CRITICAL**: 拦截对 GPIO 6-11 (Flash 接口) 的操作。
- **ERROR**: 拦截对 Input-Only 引脚 (GPIO 34-39) 的输出配置。
- **WARNING**: 提醒 Strapping 引脚 (GPIO 0, 12等) 的启动风险。

### 3. 🛠️ 异步构建与监控 (Build & Monitor)
- **非阻塞编译**: 实时上报 `[12/1050]` 格式的 CMake 进度。
- **自愈逻辑**: 识别分区表溢出、头文件缺失等典型错误，并自动生成解决方案。

---

## 📁 工程目录结构

```text
esp-idf-expert-skill/
├── SKILL.md               # AI 交互逻辑与原子工具定义
├── package.json           # 项目元数据与依赖
├── src/
│   ├── index.ts           # Skill 入口与 Tool 路由
│   ├── env/               # 环境检测与极速安装引擎
│   ├── build/             # 编译诊断与引脚审计算法
│   ├── search/            # 语义化 Demo 导航 (SmartDoc)
│   └── data/
│       └── soc/           # 🌟 核心资产：芯片物理规则 JSON 库
└── README.md              # 本文档
```

## 🛠️ 安装与使用

### 1. 克隆并安装依赖
在您的 OpenClaw Skill 目录下克隆本项目并安装必要的 Node.js 环境：

```bash
git clone https://github.com/movecall/claw-esp-expert.git
cd claw-esp-expert
npm install
npm run build
```

### 2. 配置 OpenClaw 加载
确保 OpenClaw 的 `skills` 路径指向本项目目录。本项目核心逻辑由 `SKILL.md` 驱动，Agent 将自动识别以下原子工具（Tools）：
- `manage_env`: 环境巡检、Gitee 镜像切换与全自动安装。
- `explore_demo`: 语义化示例导航，支持 README 深度解析。
- `safe_build`: 具备硬件物理规则审计能力的异步构建引擎。

---

## 🗺️ 研发路线图 (Roadmap)

### Phase 1: 极速基建 (已完成)
- [x] **Smart Installer**: 实现 Gitee 镜像克隆、官方 CDN 工具链加速与 Python 源自动切换。
- [x] **Pinmux Auditor**: 基础引脚审计引擎，内置 ESP32 经典版物理约束校验。
- [x] **Async Builder**: 非阻塞编译进度反馈（实时解析 CMake 进度条）与基础错误诊断。

### Phase 2: 工程增强 (进行中)
- [ ] **Smart Partition**: 自动分析二进制体积并一键扩容 `partitions.csv`。
- [ ] **Registry Link**: 对接乐鑫官方组件注册表，实现 `idf_component.yml` 的智能维护。
- [ ] **Multi-Chip Support**: 完善 ESP32-S3, C3, C6, P4 的硬件规则 JSON 数据库。

### Phase 3: 硬件灵魂 (规划中)
- [ ] **Panic Decoder**: 自动捕获串口 Panic 堆栈，结合 `addr2line` 穿透至源码具体行号。
- [ ] **HIL Autonomous Loop**: 集成 `pytest-embedded`，实现“需求-代码-测试-自愈”的硬件在环闭环。

---

## 🤝 贡献与反馈

开发者社区的参与是本项目保持“专家级”准确度的关键。

- **提交 Issue**: 发现 Bug 或有新的功能想法？请随时开单。
- **拉取请求 (PR)**: 我们急需补充 `src/data/soc/` 下各芯片变体的物理规则。
- **加入社区**: 访问 [OpenClaw.ai](https://openclaw.ai) 探索更多 AI Agent 可能性。

---
Made with ❤️ for ESP-IDF Developers. 让嵌入式开发从此拥有“天眼视角”。

