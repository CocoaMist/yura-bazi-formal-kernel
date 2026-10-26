# Sources and evidence boundary

本项目把资料分为“历法技术依据”和“传统术语来源”。传统文献只能支持术语、历史用法和待审规则，不能证明预测有效性。

## 历法与时间

- 国家标准 GB/T 33661-2017《农历的编算和颁行》：农历编算的规范入口。官方页面：<https://openstd.samr.gov.cn/bzgk/std/newGbInfo?hcno=E107EA4DE9725EDF819F33C60A44B296>
- IANA Time Zone Database：民用时区历史与规则变更的版本化来源。<https://www.iana.org/time-zones>
- RFC 9636：TZif 时区数据交换格式。<https://www.rfc-editor.org/rfc/rfc9636.html>
- 香港天文台二十四节气资料：节气定义与公开天文资料入口。<https://www.hko.gov.hk/en/gts/astronomy/Solar_Term.htm>
- Dershowitz, Reingold, *Calendrical Calculations*, Chinese Calendar：历法算法参考。<https://doi.org/10.1017/9781107415058.022>
- NOAA Solar Calculator：基于 Jean Meeus 的太阳位置算法说明，可用于核对太阳时算法，但网页已注明不再维护，不能单独作为长期生产权威。<https://gml.noaa.gov/grad/solcalc/calcdetails.html>
- W3C PROV-O：时间分段与计算来源的可追溯表达。<https://www.w3.org/TR/prov-o/>

参考 provider 将运行时 ICU、CLDR 与 TZDB 版本写入每次结果。该实现只声明 `reference_candidate`：ICU 中国历用于可复现的农历日期反查，Meeus 近似式用于太阳黄经与真太阳时；它们不能替代官方颁历或高精度天文历表。

## 古籍与传统术语

### 三限研究候选的当前证据状态

本轮先把用户提供的 GPT-5.6 Pro 研究综合稿作为定位线索，再在 YuraCore 的
两份本地转录中做了逐句交叉定位：

- `source-locator:local-transcription:yuracore:wuxing-jingji:purchased:L1613-L1616` 与 `...:wikisource:L3022-L3028`：`三主论`、`定三限`、`25 + 25 + 50`；
- `source-locator:local-transcription:yuracore:wuxing-jingji:purchased:L4112-L4113` 与 `...:wikisource:L7966-L7968`：`论寿夭`所引《烛神经》的月 1—30、日 31—45、时 45—100；
- `research:gpt-5.6-pro:three-limits-synthesis:2026-09-02`：本轮结构化输入来源，不是古籍原文或独立校勘。

本地文件分别是：

- 本地研究归档 `purchased-20260831/01-bazi-four-pillars/五行精纪-宋-廖中.txt`（未随公开仓库发布）；
- 本地研究归档 `wikisource-mingli/01-bazi-four-pillars/五行精纪/03-五行精紀.wiki.txt`（未随公开仓库发布）。

GPT 稿把第二段归到《三命通会·论寿夭》，但在本地购买本与 Wikisource 系
《三命通会》转录中均未检出对应句；因此 Contract 不采用该书名归属，而按实际
命中的《五行精纪》及其文内“烛神经”署名登记。这仍不是版本学定论。

这些本地定位尚未完成底本页码、影印核对、异本对照和可信语料库承认，因此
profile 的证据状态强制为
`research_only_local_transcription_corroborated`。在精确 `SourceSpan` 被可信语料库承认
之前，不得改成已核验规则，更不得用它产生寿命、死亡、吉凶或事件结论。

当前实现只把该研究稿中可无损表达的内容编码为竞争年龄分段。v0.4.1 另增加
严格六层结构入口，但只接收调用方已经给定的大运、小运、年、月、日、时
occurrence，并计算原始关系；它不实现起运、小运算法、五年分运、应期、救应、
历史积累、死亡案例检验或任何判断。

### 六层关系入口的本地材料

- `library/book/purchased-20260831/01-bazi-four-pillars/三命通会-明-万民英.txt:L299`：
  明确分开“大运司十年”与“小运掌一岁”，后文又记录不同小运起法；这里只
  支持两层不可合并及算法必须版本化，不采纳原文吉凶判断。
- `library/book/purchased-20260831/01-bazi-four-pillars/五行精纪-宋-廖中.txt:L4253`：
  “一辰十岁”的大运时距材料；不能单独决定具体起运点。
- 同文件 `L4333`：另一种小运起法以及小运、大运、太岁并见的材料；与其他
  起法并存，因此实现不得暗选一种。
- 同文件 `L4426-L4428`：大小运、太岁以及月、日、时相配而推的材料；本轮只
  提取“层可同时出现”的拓扑，不摄取灾福语义。
- `library/book/wikisource-mingli/01-bazi-four-pillars/三命通会/02-卷二.wiki.txt:L579`：
  “小运又名行年”的转录旁证；不据此把所有“行年”用法无条件等同。
- `library/book/wikisource-mingli/_research-notes/流年流月流日/体系对照-流月流日.md`：
  本地精确检索未在所列子平古籍中找到现代固定词“流月/流日”；因此代码用
  year/month/day/hour 作为运输层 ID，而不声称现代名称就是古籍原词。

这些均为本地转录和研究定位，不是底本校勘完成的 `SourceSpan`。Agent Room
只能对它们做研究性对抗核验，报告永远 `promotion.eligible: false`。
六层 profile 因而明确标为
`interface_container_not_classical_six_layer_algorithm_claim`：大运、小运和年度
太岁有本地术语材料；month/day/hour 是等待独立历法或现代来源提供的输入槽，
不是“古籍已经证明六层算法”的声明。

当前 capabilities 另提供两个**显式点名**的排程候选，供六层入口消费，不是
内核默认，也不是对竞争起法的裁决：

- `bazi.luck_schedule.major.jieqi_fold_3day_mean_year.yang_male_yin_female_from_month.v1`
  对齐《三命通会》论大运的节气折除口径，以及《命理探源》“三日为一岁”、
  从月柱一辰十年的材料。起运点仍是该剖面的算术约定，不能单独决定“正确起运”。
- `bazi.luck_schedule.minor.hour_step_one_mean_year.yang_male_yin_female.xingpinghuihai_quoted.v1`
  对齐《命理探源》所引《星平会海》“小运之法本由时，一位一岁”。《五行精纪》
  另有其他小运起法，因此该剖面必须携带
  `competingMinorMethodsNotSelected: true`。

- 《三命通会》卷七，同生八字与双生讨论。Wikisource：<https://zh.wikisource.org/zh-hans/三命通會/卷七>
- YuraCore 本地归档：`data/sources/wikisource-mingli/01-bazi-four-pillars/三命通会_四库全书本/07-卷7.wiki.txt`。
- YuraCore 本地归档：《五行精纪》卷十九，双生条目：`data/sources/wikisource-mingli/01-bazi-four-pillars/五行精纪/019-第十九卷.txt`。
- YuraCore 研究资料：`data/sources/_research-notes/流年流月流日/体系对照-流月流日.md`，用于区分古籍中的月建、日辰与现代“流月、流日”术语。
- YuraCore 研究资料：`data/sources/_research-notes/三命通会全书/检索结果/全书关键词报告.md`，用于定位月令、太岁、岁运与节气相关原文。
- YuraCore 已归档的关系来源标识：`source-span:ctext:524726:0157199eb1cc80c1976aa2dbb403bcd8c64badef44099c1d377a59a9457d8240` 与 `source-span:ctext:17583:d96fad0672f06f9aff0fbf15fb0efb56723df78e838267b00a14706bbc568f1f`。本项目沿用其来源指针，但明确标为传统常用表而非客观定律。

## 采用原则

- 双生或同柱古例说明“相同四柱不等于同一主体”，所以主体身份与四柱内容分别建模。
- 流年、流月、流日、流时只是时间层索引；关系计算与解释规则分离。
- 合盘和时间叠加分别使用内容哈希化的作用域配置；完整地支群必须满足对应配置要求，不能仅凭“出现过时间层”或“出现过两方”隐式放行。
- 生、克、合、冲、刑、害、破只输出原始关系，不自动产生有利、不利、成化或事件结论。
- 目前没有找到足以支持八字事件预测准确率的稳健同行评审证据，因此本项目不输出概率或实证因果声称。
