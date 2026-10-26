# 公开研究数据库

下载：[2026-10-26 数据发布](https://github.com/CocoaMist/yura-bazi-formal-kernel/releases/tag/data-2026-10-26)。

此版本包含 1,580 份古籍文本、80 个书级来源条目、22,516 条逐字匹配摘录、
25,446 条历史判断候选及对应复核标签和重新计算的偏移。书级条目不表示完整古籍。
SQLite、全文索引、对应 TXT 和 JSONL 一并装入一个 ZIP，具体大小及 SHA-256 见
[dataset-manifest.json](dataset-manifest.json)。数据库通过新建方式生成，原混合库没有上传。

## 下载与校验

在 Release 下载 `yura-public-research-data-2026-10-26.zip` 和 `SHA256SUMS`。
PowerShell 可用 `Get-FileHash <下载的ZIP> -Algorithm SHA256` 校验压缩包，
Linux/macOS 可用 `sha256sum -c SHA256SUMS`。
解压包内的 `FILES.sha256` 是全部文件的校验清单。

解压后可直接用支持 SQLite FTS5 的工具打开 `public-research.sqlite`。
从解压目录调用代码仓库工具（替换成实际代码路径）：

```sh
node /path/to/yura-bazi-formal-kernel/agent-tools/agent-kit.mjs book-status --db public-research.sqlite
node /path/to/yura-bazi-formal-kernel/agent-tools/agent-kit.mjs book-search 三命通會 --db public-research.sqlite
node /path/to/yura-bazi-formal-kernel/agent-tools/agent-kit.mjs book-verify --db public-research.sqlite
```

完整验证需要保留数据包内 `sources/` 与数据库的相对位置。
全文检索、分块与文档位于 `documents`、`chunks`、`chunks_fts`；研究表为
`public_sources`、`public_excerpts`、`public_assertion_records`、`public_review_labels`、
`public_source_offsets`。包内 README 给出字段语义和查询示例。

## 来源、许可与筛选

[sources.jsonl](sources.jsonl) 保留逐文件来源链接、历史页、许可、导出声明、字节大小及哈希。
古籍转录采用逐项 CC BY-SA 3.0/4.0，新编排和研究投影采用 CC BY-SA 4.0；
第一方结构笔记采用 MIT。详见 [DATA-LICENSE.md](DATA-LICENSE.md)。代码 MIT 不覆盖古籍转录。

筛选以文件的来源和许可为准，不依据目录名判断是否可公开。已排除：

- 购买全文、购买命例切图、个人出生资料与私人命盘。
- 未确认再分发权利的现代书籍、ctext 副本及未能确认来源的单个文件。
- 不在公开来源清单内、或不能逐字匹配当前归档文本的历史研究记录。
- 模型响应、执行日志、账户与服务配置；没有重复打包 EPUB 二进制副本。

## 验证与局限

发布前检查了 SQLite 完整性和外键、来源/分块哈希、全部摘录位置、研究记录来源身份、
全文搜索，以及 ZIP 内文件字节一致性。结果见
[dataset-summary.json](dataset-summary.json) 和 [validation.json](validation.json)。
这些是本次数据发布检查，独立于内核的 `release-manifest.json`。

古籍可能缺卷、重复、只有目录或提要，版本标签也可能有差异。
归档未记录精确 Wikisource 修订号；书级链接不能证明当前网页与归档完全相同。
“逐字匹配”只说明摘录存在于本包源文件，不代表古籍、作者判断或现实事件已验证。

历史判断是研究候选，没有盲验证或正式准入资格。偏移以去除 UTF-8 BOM 后的 UTF-16
码元表示，取首次精确匹配，右端点不包含在摘录中。`legacy*` 字段只用于追溯旧记录。
`trainingEligible: false` 表示未获本项目的数据准入，不是额外的版权使用限制。
数据不会被内核导入，也不提供经验概率、因果结论或个人预测。
