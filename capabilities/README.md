# Yura Bazi Capabilities

独立的八字结构能力包。它不属于 Formal State Kernel，也不修改 YuraCore。

当前提供一组互不依赖的结构功能与一个可替换历法边界：

- `evaluateTemporal`：分析命盘与单一时刻或连续时间范围中年、月、日、时层的原始结构关系；兼容窗口还可携带显式 `decade` 层。
- `compileSixLayerTemporalRelations`：消费外部明确给定的大运、小运、年、月、日、时六个 occurrence，生成完整的第一阶关系闭包；不在包内起运、排小运或生成判断。
- `compareCharts`：可选的双命盘结构比较。相同四柱但不同主体不会被合并。
- `resolveTimeRequest`：把公历或农历、地点、民用时/真太阳时请求交给独立历法提供方，并验证其显式窗口结果。
- `CalendarDecisionTraceV2`：记录规范化输入、整数毫秒 UTC 时刻、时区/太阳时/节气与日界口径、相邻边界距离和未解决的不确定性；ISO 字符串只由同一整数毫秒生成。
- `buildCandidateSnapshotSet`：把多个有来源的单点历法决议保留为独立候选四柱；相同四柱也不合并其决议来源。
- `matchLifeStageCandidates`：把显式年龄坐标匹配到版本化“三限”候选，并绑定到具体出生柱 occurrence；竞争古法、年龄口径和边界歧义均不合并。
- `buildCenturyTemporalCandidatesV1`：把显式 0–100 周年计划编成六层候选；大运和小运仍须外部排程。
- `buildNamedLuckSchedulesV1`：按调用方点名的起运/小运剖面生成排程，再交给六层入口或周年生成器。不是内核默认。
- `REFERENCE_CALENDAR_PROVIDER`：自包含参考实现，支持公历、1900—2100 农历、IANA 时区、地点真太阳时，以及单时刻和连续范围。

本项目不负责吉凶、用神、事件概率、合盘结论或状态变更。所有输出都是可追溯的结构材料，`effectEligible` 恒为 `false`。

## 六层显式关系输入

`SixLayerTemporalInputV1` 恰好包含六个独立 occurrence：
`major_luck`、`minor_luck`、`year`、`month`、`day`、`hour`。每个 occurrence
必须提供唯一 ID、明确干支、`[validFrom, validUntil)`、来源引用、外部权威、
原文术语引用、计算 profile、历法基准、换界 profile、地点/时区引用、输入依赖
与决策引用。
这样可区分“小运/行年”“游行太岁/现代流年”“月建/现代流月”，而不靠字段名
偷换概念。大运与小运必须绑定命盘主体；年、月、日、时是该
时刻的日历层，`subjectRef` 为 `null`。目标时刻必须同时落在六个有效期内。

能力包不在六层入口内部选择大小运算法。`compileSixLayerTemporalRelations`
只消费已经给定的 occurrence。若调用方要生成排程，必须显式传入
`majorLuckProfileId` 与 `minorLuckProfileId`；当前实现只承认下面两个候选
剖面，拒绝未知 ID，也拒绝未知性别。尤其小运在本地材料中存在不同起法，
`competingMinorMethodsNotSelected: true` 必须保留。月、日、时的具体历法与
换界规则同样必须由外部 provider 明示，不能由古籍术语补全。编译器对一个
完整候选固定输出：

- 6 个时间 occurrence；
- 24 个“六层 × 本命四柱”柱关系；
- 15 个“六层两两组合”柱关系；
- 0..N 个 occurrence-aware 完整地支群。

这是一阶、有限闭包。天干合化元素只保留为未成立的候选字段，不能再生成为
第七个 occurrence，也不能继续递归叠加。输出明确写入
`judgmentStatus: not_evaluated`、`causalStatus: not_modeled` 和
`effectEligible: false`，供未来评判系统读取之前仍须另行规则承认。

## 时间边界

时间查询接收已经由历法权威组件解析的显式时柱窗口：

- 单时刻：一个 ISO 8601 时刻和该时刻的年、月、日、时柱。
- 时间范围：严格覆盖 `[start, end)` 的连续分段，每段携带稳定的年、月、日、时柱。

这样可以支持任意 IANA 时区、真太阳时、公历或农历输入，而不会把历法逻辑塞入关系计算。历法适配器必须独立实现 `resolveInstant` 与 `resolveRange`，并输出同一显式窗口契约；区间解析不得退化成逐分钟调用单时刻接口。

参考 provider 是可运行的候选实现，不是产品权威：农历转换依赖运行时 ICU/CLDR，节气与真太阳时采用公开近似算法，并在单时刻落入节气八分钟不确定窗口时失败关闭。输出来源会记录 ICU、CLDR 与 TZDB 版本；生产环境仍可替换为经校验的权威 provider。

当前候选策略是逐候选独立编译。`buildCandidateSnapshotSet` 输出
`CandidateSnapshotSetV2`，其中每条候选仍为 `CandidateSnapshotV1`，不会把多个
四柱坐标混入同一个快照；历法 provider 分歧、民用时/真太阳时分歧和
输入时间范围应保留为不同候选。参考 provider 仍将多 provider 一致性与
原始出生记录精度标记为 unresolved。

## 三限年龄阶段

`AgeCoordinateV1` 是外部、显式且可多候选的年龄坐标。能力包不从出生日期
暗算“虚岁”或“周岁”，也不会把现代 age 0 偷换成古籍的一岁。调用方必须给出
`lifeYearOrdinal`、计龄 profile、出生时间引用、匹配时刻与决策引用。

当前登记两个研究候选 profile：

- 《五行精纪》材料所述 `25 + 25 + 50`，并列保留“月/日/时单柱”和“年+月/月+日/日+时相邻柱”两种模型；
- 《五行精纪》“论寿夭”所引《烛神经》的 `30 + 15 + 55`，并列保留 46 岁进入末限的无重叠解释，以及原文“时管四十五岁至百岁”导致 45 岁中、末限重叠的字面解释。

两者均为 `research_only_local_transcription_corroborated`。它们只回答“该年龄坐标匹配
哪些先天柱位候选”，不回答旺衰、吉凶、疾病、死亡或事件。`evaluateTemporal`
可在单时刻查询中携带 `lifeStageRequest`，让年龄阶段与年、月、日、时层共享
同一个时刻，但不会因此产生判断或状态变更。

## 使用

将示例脚本放在 `capabilities/` 根目录时，使用以下相对导入路径：

```js
import {
  compileSixLayerTemporalRelations,
  compareCharts,
  evaluateTemporal,
  matchLifeStageCandidates,
  REFERENCE_CALENDAR_PROVIDER,
  resolveTimeRequest
} from './src/index.mjs';
```

从仓库根目录运行检查与示例：

```text
npm --prefix capabilities run check
npm --prefix capabilities run example:three-limits
```

示例会为仓库固定出生盘 `2000-07-19 16:00 Beijing male` 生成
`capabilities/examples/three-limits-sample-2026-09-02.json`。其中 2026-09-02 对应显式的
第 27 生命年候选；这只是周年计龄示例，不会覆盖其他传统计龄候选。

## 0–100 周岁周年时间候选

`buildCenturyTemporalCandidatesV1` 接收显式 `CenturyTemporalPlanV1`，把 0 到
100 周岁映射为恰好 101 个公历出生地周年坐标。它调用声明过的 calendar
provider 计算年、月、日、时；大运和小运不在这里猜算，必须分别由完整的
`majorLuckSchedule` 与 `minorLuckSchedule` 提供。排程缺口、历法拒绝或边界
错误会保留为对应年龄的 `generation_failed`。

周年批次是每岁一个精确采样点，不等于连续枚举一百年内每一天或每个时辰。
生成结果不含吉凶、事件或状态操作，并固定为 `judgmentStatus: not_evaluated`、
`causalStatus: not_modeled`、`effectEligible: false`。根目录的
`npm run century:compile` 会继续把成功候选送入正式时间结构内核，并输出一个
JSON bundle。

## 命名大运 / 小运排程

`buildNamedLuckSchedulesV1` 是 opt-in 候选算法，不是产品默认起运。当前只
承认两个剖面 ID：

- `MAJOR_LUCK_PROFILE_ID`：
`bazi.luck_schedule.major.jieqi_fold_3day_mean_year.yang_male_yin_female_from_month.v1`。
阳男阴女顺、阴男阳女逆；数相邻节；三日折一个固定 365.2425 日年；从月柱起一辰十年；
  起运前一段沿用月柱。
- `MINOR_LUCK_PROFILE_ID`：
`bazi.luck_schedule.minor.hour_step_one_mean_year.yang_male_yin_female.xingpinghuihai_quoted.v1`。
同方向从时柱一位一个固定 365.2425 日年；材料引自《命理探源》所录《星平会海》。其他小运
  起法并存，因此输出固定 `competingMinorMethodsNotSelected: true`。

未知剖面 ID 或未知性别失败关闭。排程可交给 `captureCenturyTemporalPlanV1`
或 `assembleSixLayerCandidateV1`，再由根目录 `npm run sixlayer:compile`
送入 `compileTemporalRequest`。缺层仍然拒绝；缺层不是「没有作用」，也不是
已经断出的结果。

架构约束见 `CORE.md`，证据范围见 `SOURCES.md`。
