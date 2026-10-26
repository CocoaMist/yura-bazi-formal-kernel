# Yura Bazi Formal Kernel

八字命盘与时间关系的确定性结构编译工具。**当前提供结构数据，不提供吉凶解读、事件预测或校准后的概率。**

This project compiles chart candidates into reproducible structural facts and
versioned relation candidates. It is research infrastructure, not a validated
fortune-prediction engine.

本仓库是 v0.7.2 的公开代码版本，采用 [MIT](LICENSE) 许可证。
包含内核、独立历法能力、测试、命令行与开发工具；公开范围和验证边界见
[PUBLIC-DISTRIBUTION.md](PUBLIC-DISTRIBUTION.md)。

## 快速开始

需要 **Node.js 24 LTS**。Node 部分没有 npm 依赖，无需安装依赖。
package.json 保留内核的 `>=20` 声明以匹配冻结的 release manifest；
完整开发流程使用 Node 24，部分工具依赖 `node:sqlite`。

```sh
git clone https://github.com/CocoaMist/yura-bazi-formal-kernel.git
cd yura-bazi-formal-kernel
npm run check
```

从固定示例生成命盘结构：

```sh
node --input-type=module -e "import fs from 'node:fs'; import {spawnSync} from 'node:child_process'; const r=spawnSync(process.execPath,['tools/compile-birth.mjs'],{input:fs.readFileSync('examples/2000-07-19-beijing-male.input.json'),stdio:['pipe','inherit','inherit']}); process.exit(r.status??1);"
```

在 PowerShell 中也可以使用：

```powershell
Get-Content examples/2000-07-19-beijing-male.input.json -Raw -Encoding utf8 |
  npm run --silent birth:compile
```

Windows PowerShell 5.1 向 Node 传入中文时，请先设置
`$OutputEncoding = [System.Text.UTF8Encoding]::new($false)`。
捕获 JSON 时保留 `--silent`，避免 npm 的命令横幅混入输出。

成功结果为一个 `bazi.natal_fixed_bundle.v1` JSON 对象，保留历法候选路径，
并共享内容相同的固定命盘结构。示例是测试用固定输入，不是经独立核验的真实人物案例。

## 已有能力

- 严格输入捕获和校验；不猜补缺失四柱，不把未知当成否定或零。
- 可无损交换的命盘编码、稳定规范化 JSON 和 SHA-256 身份。
- 十神、藏干、五行、长生阶段等可重算材料。
- 独立于判断的事实图，以及按版本化约定选择的关系候选。
- occurrence-aware 生、克、合、冲、刑、害、破和完整地支群匹配。
- 大运、小运、年、月、日、时六层结构编译，保留输入和版本来源。
- 外部出生信息适配器、参考历法 provider、命名大小运排程候选及周年采样。
- 原始双盘结构比较；不输出合盘吉凶。
- 候选状态模拟器；不构成正式规则到状态的准入链。

内核本身只接受已经排好的命盘快照。出生信息计算位于独立的
`capabilities/` 和适配器中。

## 尚未提供

正式 RuleEvaluator、规则冲突裁决、EffectTemplate 注册表、Mutation Admission
和持久账本尚未形成正式运行闭环。旺衰、格局、用神、吉凶、职业/关系解读、
事件预测、概率校准与实证因果结论均不属于当前交付。

参考历法依赖运行时 ICU/CLDR/TZDB 和近似天文算法。节气边界存在明确的拒绝窗口；
测试通过不等于官方历法精度、传统规则有效性或预测准确率得到证明。详见
[历法来源与限制](capabilities/SOURCES.md)。

## 文档与入口

| 内容 | 入口 |
| --- | --- |
| 当前实现、契约与迁移状态 | [CORE.md 第 30 节](CORE.md#30-implementation-status-and-migration) |
| 时间结构编译 | [TIME_CORE.md](TIME_CORE.md) |
| 独立历法与结构能力 | [capabilities/README.md](capabilities/README.md) |
| 开发、检索、索引工具 | [agent-tools/README.md](agent-tools/README.md) |
| 可选 Agent Room | [agent-tools/agent-room/README.md](agent-tools/agent-room/README.md) |
| 可选 Python/GPU OCR | [agent-tools/ocr/README.md](agent-tools/ocr/README.md) |
| 公开源码边界与检查范围 | [PUBLIC-DISTRIBUTION.md](PUBLIC-DISTRIBUTION.md) |

`src/index.mjs` 是内核的唯一公开导出入口。JSON Schemas 位于 `schemas/`。

## 检查

```sh
npm run check
npm run grammar:audit
npm run relations:audit
```

根检查涵盖结构、导入边界、契约审计、Node 开发工具、内核覆盖率及历法能力包。
完整语法和关系穷举审计是独立的发布检查。覆盖率门槛只适用于 `src/`，
不代表整个仓库或现实预测的覆盖程度。

OCR 需要单独配置 Python 环境；`npm run ocr:layout:test` 是可选检查，
未纳入无需 Python 的根检查。Agent Room 的真实模型调用也需要用户自行配置服务和凭据；
自动检查使用本地测试替身。

`package.json` 中的 `private: true` 用于防止误发布到 npm，不影响 GitHub 代码开源。
外部书籍、购买资料、个人命盘和研究数据未随代码发布，也不由本项目 MIT 许可证授权。
