# Architecture

## 边界

本项目有七层：

1. `contracts` 捕获并验证主体命盘与显式时间窗口。
2. `relations` 生成五行生克、天干五合和地支合冲刑害破的原始代码。
3. `temporal` 与 `comparison` 分别组合这些原始代码，不产生解释或状态；严格六层入口只消费外部 occurrence，不计算大小运。
4. `calendar` 验证请求、绑定 provider 身份与来源，并验证返回窗口；`reference-provider` 是可替换的候选历法实现。
5. `life-stage-profile` 与 `life-stage` 接收外部年龄坐标，把竞争的传统分限匹配到具体出生柱 occurrence；它不计算年龄，也不产生判断。
6. `century-timeline` 把显式计划映射为 0..100 共 101 个公历本地周年坐标；
   大运、小运排程必须由外部提供，缺口逐年龄保留。2 月 29 日出生在非闰年按
   已命名 profile 映射到 2 月 28 日。该层是周年点采样，不是连续百年覆盖。
7. `luck-schedule` 只提供调用方显式点名的起运/小运候选剖面，产出可供
   `century-timeline` 与六层入口消费的排程。它不是内核默认，也不会在竞争
   小运起法中暗选一种。未知性别失败关闭。

提供方必须同时实现单时刻和范围解析，声明版本与来源，并用 `requestHash` 绑定规范化请求。参考 provider 的近似精度和运行时版本必须保留在 provenance 中，不能被当成产品权威。

`CalendarDecisionTraceV2` 先把 UTC、有效钟表时、太阳时修正和相邻节气
边界全部量化为安全整数毫秒，再据此进行边界判断、生成 ISO 字符串和
参与 Hash。浮点近似值不得与截断后的 ISO 时间同时成为身份输入。

禁止依赖或导入：

- `3006-Yura Bazi-Centric Formal State Kernel`
- `3006-YuraCore`
- `3005-Yura`

Yura、YuraCore 和现有内核只用于核对边界与资料，不是运行时依赖。

## ChartRecordV1

命盘记录由 `subjectRef`、`snapshotRef`、`validTimeRef`、四柱和来源构成。`chartContentHash` 只标识四柱内容；`chartIdentityHash` 绑定完整时间身份与来源，二者都不能替代主体身份。

同柱处理规则：

- 不同 `subjectRef`：允许比较，输出 `sameChartContent: true`。
- 同一 `subjectRef` 且同一 `snapshotRef`：拒绝无意义的自比较。
- 同一主体的不同快照：仅在显式 `mode: "variant"` 下允许。

## ResolvedTimeQueryV1

`instant` 查询含一个 `at` 与一组时间层，输出仍是单点，不伪造零长度区间。`range` 查询含 `start`、`end` 和连续分段。范围使用半开区间 `[from, until)`，分段必须无重叠、无空洞并完整覆盖查询范围。

结构层不猜节气边界，不按分钟扫描，也不把本地民用时、真太阳时、农历日期混成一个字段。历法提供方必须在 `provenance` 中说明：

- 时区及其版本；
- 公历/农历输入及换算依据；
- 是否使用真太阳时、经纬度及算法；
- 节气数据来源与边界精度；
- 采用的日界、月界和年界规则。

## 关系范围

兼容入口 `evaluateTemporal` 按 `decade`、`year`、`month`、`day`、`hour`
排列实际提供的时间层；`decade` 是可选的显式大运层。默认计算：

- 每个时间层与命盘四柱的关系；
- 实际提供序列中的相邻时间层；五层齐备时为大运—流年、流年—流月、流月—流日、流日—流时。

`includeCrossLevel: true` 才计算非相邻时间层。严格六层入口则始终计算全部
15 个时间层柱对，不使用此选项。方向保留在输出中，因此“甲生丙”和“丙被甲生”不会被压成无方向标签。

## SixLayerTemporalInputV1 与 SixLayerTemporalRelationSetV1

严格六层入口与兼容的 `ResolvedTimeQueryV1/V2` 分开。它要求调用方一次给出
`major_luck`、`minor_luck`、`year`、`month`、`day`、`hour` 六个 occurrence，
不接受缺层、隐含层、从命盘推测的层或把“小运”折叠为“流年”。每层都携带
独立有效期、`sourceRefs`、`authorityRef`、`calculationProfileRef` 与
`decisionRefs`，并显式记录 `termRef`、`calendarBasisRef`、
`boundaryProfileRef` 与 `inputDependencyRefs`。这些字段用于保留“小运/行年”、
“游行太岁/现代流年”、“月建/现代流月”等术语与算法边界。大小运 occurrence
还与其他层一样必须带 `locationTimeRef`，以免时区、地点或真太阳时口径被
埋入干支结果。大小运 occurrence 必须与命盘 `subjectRef`、`snapshotRef`
一致；四个日历层不携带主体身份。

一个已验证的六层候选产生 24 个本命—时间柱对与 15 个时间层柱对。每个柱对
内部仍分别保留天干 occurrence 与地支 occurrence，完整地支群继续保留具体
参与者。关系闭包只覆盖声明的十个柱 occurrence（本命四柱加六层），深度固定
为 1；关系结果、候选合化元素、mask 或群组都不得回灌为新 occurrence。

Hash 前像：

- 每层 `occurrenceHash`：该层的 `layerId`、`occurrenceId`、`subjectRef`、干支、
  规范化有效期、术语、来源、权威、计算/历法/换界/地点时间 profile、输入依赖
  与决策引用；
- `inputHash`：`SixLayerTemporalInputV1` 的 version、主体、快照、规范化时刻及
  整数毫秒、按固定六层顺序排列的完整 occurrence 与总 provenance；
- `relationSetHash`：`SixLayerTemporalRelationSetV1` 除自身 Hash 外的完整 body，
  包括两类关系、完整群、三种 profile identity、闭包策略与禁止评判状态。

Hash 只标识内容，不能替代来源链、算法承认或因果证明。

## AgeCoordinateV1 与 LifeStageMatchSetV1

年龄坐标是历法时刻之上的另一条显式决策链，不从命盘、系统当前日期或传统
性别类别推导。每个坐标必须绑定 `birthValidTimeRef` 与 `at`，携带独立
`coordinateId`、`reckoningProfileId`、`decisionRefs` 和内容 Hash。多个周岁、
虚岁或来源口径必须作为多个坐标候选输入，不能预先压成一个整数。

分限 profile 的每个结果必须绑定 `natal.year|month|day|hour` occurrence ref。
单柱模型与相邻双柱模型、不同古籍、以及同一文字的边界解释均是独立候选。
`retain_all_matching_segments` 允许把有争议的重叠显式留下；`disjoint_partition`
则要求 1—100 每个生命年恰好落入一段。超过 profile 上限的坐标进入
`outsideProfileRange`，不得静默丢弃。

当前条文已在两份本地转录中交叉定位，但尚未进入可信语料库的正式
`SourceSpan` 承认流程，因此所有 profile 固定为
`research_only_local_transcription_corroborated`、`utility: indeterminate`、
`effectEligible: false`。它们不能进入 Formal State、Mutation Admission、寿夭
判断或事件预测。

## 非目标

- 在关系层或 Formal State Kernel 内实现历法；
- 吉凶、婚配等级、应期或事件预测；
- 把三限当作旺衰、寿命、死亡概率或“生命能量”评分；
- 把合、冲、生、克自动解释为好坏；
- 把区间各段串成状态或因果轨迹；
- 从历史人物死亡记录反推“抽象能量”、事件概率或因果系数；此类材料只能先进入独立 ObservationLedger 与校准研究，不能污染关系编译器；
- 向 Formal State Kernel 写入 Effect、StateDelta 或 FormalState。
