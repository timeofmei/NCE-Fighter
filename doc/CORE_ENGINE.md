# NCE Fighter 核心引擎与多语言契约

版本：0.4　日期：2026 年 10 月 11 日

本文涵盖文本比对、语言模块、数据对象与训练状态。业务需求见[产品需求](PRODUCT_REQUIREMENTS.md)，验证要求见[验收与里程碑](DELIVERY_PLAN.md)。返回[项目文档导航](../README.md#项目文档)。

## 1 多语言文本比对规范

### 1.1 统一规则与语言规则

统一要求：仅确认正文参与比较，标题、课号和页眉不参与；显示确认正文保留文字、大小写、标点及用户确定的句子顺序；正文按第 2.6 节由非空行构成；所有训练忽略大小写与标点差异；比对是确定性的文本检查，不用模型判断语义是否相近。忽略大小写只适用于有大小写的语言；忽略标点不意味着删除附加符号、声调、变音、假名或其他具有文字意义的信息。

具体归一化顺序、大小写折叠、词边界、Unicode 规范化策略及单位划分由语言模块分别实现。统一层不能给所有语言强制应用英语正则、NFKC、按空格分词或逐词首字母提示。特殊大小写映射、全角半角、重音、简繁、假名、数字与空白是否等价，都必须由对应模块明确规定并版本化；未明确规定时不自动判等。

语言模块返回有序 ComparisonUnit 列表。每个单位包含用于比较的 key、可显示的原文、原始文本范围和句子归属。单位可以是词、字素簇或模块定义的其他粒度；单位类型和 UI 名称由模块声明。中文和日文等不以空格分词的文本不套用英文词单位，也不能直接按字符串代码单元切割。单位类型是开发者的实现选择，不自动替用户选择语言。

| 语言模块示例 | 可选比较单位         | 需单独开发的规则                             |
| ------------ | -------------------- | -------------------------------------------- |
| 英语         | 词                   | 缩写、撇号、连字符、大小写、首字母提示       |
| 中文         | 字素簇或分词后的词   | 中文句尾符号、引号、空白、简繁策略、提示     |
| 日语         | 字素簇或语言分词单位 | 句尾与引用边界、假名和汉字、长音与促音、提示 |
| 其他语言     | 模块自行声明         | 对应语言的大小写、文字规范化、分句与提示     |

此表是模块设计示例，不代表中文、日语或其他语言已实现；不预先强制指定它们的比较粒度。

### 1.2 英语模块规则

状态：已审核；英语比较与提示能力已实现，应用验收见[第二阶段](stages/02-sentence-training.md#用户验收)。

英语模块采用：Unicode NFKC 规范化 → 大小写折叠 → 分词及标点处理 → 删除空单位。多余空格和换行不产生错误。词内英文直撇号与弯撇号删除；其他标点作为边界，标点本身不计为错误。连字符作为边界，小数点首版按边界处理，不做数字语义解析。

| 标准原文                | 用户输入                  | 英语模块预期               |
| ----------------------- | ------------------------- | -------------------------- |
| I had a very good seat. | i HAD a very good seat!!! | 完全正确                   |
| Hello,world!            | hello world               | 完全正确                   |
| Don't stop.             | dont stop                 | 完全正确                   |
| Don't stop.             | do not stop               | 不做缩写展开，存在差异     |
| well-known              | well known                | 完全正确                   |
| theatre                 | theater                   | 替换，不自动忽略英美拼写   |
| I had a good seat.      | I have a good seat.       | 替换，不接受近义或语义等价 |

这些是英语模块规则，不能当作全体语言的基础规则。其他模块有自己的规范化用例；通用契约只要求标点与大小写差异本身不被计错、原文映射有效，以及结果可复现。

### 1.3 通用对齐与语言扩展

逐句使用当前句的参考单位；全文默写与整篇背诵先对完整正文进行单位序列对齐，再按参考单位所属句子展示。不能按相同句序号硬配对。多余单位归属相邻的对齐位置，开头归首句，结尾归末句；复杂对齐的归属由模块明确给出，不能遗漏。

统一层提供可复用的序列对齐工具，默认匹配成本为 0，替换、删除、插入成本为 1。令 D(i,j) 为参考前 i 个单位和输入前 j 个单位的最小编辑成本，则 D(i,j)=min(D(i−1,j)+1,D(i,j−1)+1,D(i−1,j−1)+[aᵢ≠bⱼ])；D(i,0)=i，D(0,j)=j。相同总成本路径按匹配、替换、遗漏、多余固定回溯。

各语言模块可直接调用此工具，也可实现自己的对齐策略。新增策略必须返回同一 DiffResult 契约，并通过遗漏整句、重复内容和位置映射测试；不得复制训练状态、存储和结果页面。模块存在多种比较粒度时，单次会话固定一个 comparisonProfile；不同粒度的指标分别标识，不能在一次比对中临时切换。

统一结果操作为 match、delete、insert、substitute，带参考和输入单位范围、原文范围与句子归属。每种语言可增加解释信息，但不得更改这些共同字段的含义。原文范围在规范化、分词和自定义对齐后仍需可定位；被规范化为多个单位的原文片段可由模块给出共享范围，映射不得越界。

### 1.4 指标与跨语言口径

N 为参考比较单位数，S 为替换单位数，D 为遗漏单位数，I 为多余单位数。统一单位错误率 E=(S+D+I)/N，可大于 1；显示准确度 A=max(0,1−E)×100%。N=0 禁止训练。操作计数按单位数量计算，不按 UI 中合并的错误块数量计算；自定义对齐使用加权成本时，权重不得改变这些原始计数。

只有比较单位为词时可标为 WER；其他粒度使用单位错误率，不把它们统称词错误率。页面标题随模块设置为“词序列准确度”“字符准确度”或“文本准确度”，结果保留语言、模块、比较配置和单位类型。不跨语言或跨粒度混排准确度，不将其视为共同难度的学习成绩。

整篇完全正确当且仅当 S=D=I=0。逐句完全正确按相同条件判断。首次独立正确比例 U/L 的业务含义统一，其中 U 为首次无提示、未看答案且完全正确的句数，L 为句数；分句不同也会影响此指标，不据此宣称跨语言掌握程度等价。局部会话显示已完成 k/L，不输出整篇通过结论。

## 2 统一业务引擎与语言模块契约

### 2.1 三层职责

| 层次               | 负责内容                                                                       | 不负责内容                              |
| ------------------ | ------------------------------------------------------------------------------ | --------------------------------------- |
| 统一业务引擎       | 来源顺序、草稿确认、课文版本、训练状态、提示使用记录、统一结果、保存与导出契约 | 某语言的分词、分句、文字等价规则        |
| 语言文本模块       | 标题与课号识别、分句、归一化、比较单位、提示、必要时自定义对齐                 | 录音、网络、设备权限、训练流程、存储 UI |
| 浏览器与识别适配层 | 本地文件解码、OCR、ASR、录音、权限、持久化、方向和输入法适配                   | 决定用户内容语言或复制训练业务          |

共享工具包含范围校验、序列对齐、错误计数、结果聚合、版本与任务管理。可共享的规则实现可放在公共工具中，由模块显式选用，不让一份默认英语规则自动影响所有语言。各语言模块由开发者分别实现、注册和维护；新增语言通常只增加模块、语言名称及契约测试数据，不新增一套训练页面。

用户课文语言与界面语言分别保存，中文界面也能训练英语、日语等课文。文本方向由模块描述给出，例如 ltr 或 rtl；页面组件依据内容方向渲染正文、输入和提示，不把整个界面语言随课文切换。不同语言模块使用同一文档格式与接口，不要求实现代码完全相同。Web 是唯一客户端，核心仍不依赖 DOM、浏览器存储或模型运行时，便于独立测试和复用。

### 2.2 语言模块注册与能力

每个模块声明 languageId、moduleId、moduleVersion、profileVersion、comparisonProfileId、unitKind、unitLabel、hintLabel 和 textDirection。languageId 是用户选择的内容语言，moduleId 标识具体实现；同语言更换模块时必须显式切换与版本绑定。

语言选择列表从已注册且可用的模块生成。模块声明支持的语言标识和显式别名；缺失、未完成或版本不可用时返回明确错误，不自动切换到英语，也不自动下载或检测其他语言。继续旧会话需使用固定模块与规则版本；无法加载时保留历史结果，但阻止以新规则悄悄继续或重算。

宿主按 languageId 查询文件提取、印刷 OCR、手写 OCR、ASR 与持久化能力；某项识别能力缺失不影响已可用的键盘训练。能力状态与原因由宿主返回，入口及反馈按[页面通用规则](WEB_UX.md#12-通用交互规则)呈现。提示能力未完成的模块可供开发测试，但不能标为完整支持逐句两种模式。

### 2.3 主要数据对象

| 对象             | 必要字段                                                                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| ImportBatch      | id、languageId、sources、status                                                                                                             |
| Source           | id、batchId、languageId、kind、name、order、locator、extractionStatus                                                                       |
| LessonDraft      | id、languageId、moduleRef、title、body、sourceRefs、boundaryWarnings、sentences                                                             |
| LessonRevision   | lessonId、revisionId、languageId、moduleRef、title、body、sentences、confirmedAt                                                            |
| Sentence         | id、order、start、end，正文范围为半开区间 [start,end)                                                                                       |
| ComparisonUnit   | key、displayText、sourceRange、sentenceId                                                                                                   |
| Session          | id、lessonRevisionId、languageId、moduleRef、comparisonProfileId、mode、status、时间与进度                                                  |
| Attempt          | id、requestId、sentenceId 可空、rawText、confirmedText、hintUsed、answerSeenBeforeAttempt、status、inputKind                                |
| Recognition      | languageId、sourceRef、rawTranscript、editedTranscript、wasEdited、warnings、providerMetadata 可空                                          |
| DiffResult       | languageId、moduleRef、comparisonProfileId、unitKind、unitLabel、operations、N/S/D/I、accuracy、sentenceResults                             |
| ModuleRef        | moduleId、moduleVersion、profileVersion，含规范化、分句、提示和比较规则版本                                                                 |
| WebModelManifest | resourceId、taskKind、supportedLanguages、支持印刷或手写的标记、modelVersion、runtimeVersion、dtype、backend、files、总字节数、缓存校验标识 |
| DeviceCapability | languageId、taskKind、status、reason、modelRef、backend、基准测试结果与日期                                                                 |
| OcrRegion        | sourceRef、pageIndex、区域或行坐标、原图尺寸、order、rotation、preparedBy                                                                   |
| AudioJob         | recordingRef、languageId、duration、内部批次范围、窗口参数、modelRef、status                                                                |

文本范围统一使用 Unicode 码点索引，平台 UTF-16 索引在适配层转换。位置索引与比较单位是不同概念：字素簇可跨多个码点，不能将码点索引直接当成字符比较粒度。历史保存原文、所用语言和所有规则版本，使记录可解释。schemaVersion 用于导出与迁移，未知版本明确拒绝或交由迁移器处理。

Session 模式统一为 sentence_dictation、full_dictation、recitation。全文的 inputKind 区分 keyboard 与 handwriting；背诵为 speech，内容语言不会改变三种模式的业务含义。

### 2.4 能力接口示意

以下契约不预设具体编程语言。模块接口与共享工具独立，宿主在导入前绑定语言。

```text
Registry.listReadyLanguages() -> LanguageDescriptor[]
Registry.resolve(languageId, moduleRef?) -> LanguageModule
Host.capabilities(languageId) -> InputCapabilities
WebHost.probeCapability(languageId, taskKind, modelRef) -> DeviceCapability
WebHost.prepareResources(resourceManifest, cancelToken) -> ResourceStatus

Core.beginImport(languageId) -> ImportBatch
Core.proposeLessons(batch, textBlocks) -> LessonDraft[]  // 文件提取或识别流程的多篇提议
Core.confirmLesson(draft) -> LessonRevision
Core.compare(lessonRevision, actual, pinnedProfile) -> DiffResult
Core.reduceSession(state, event) -> { nextState, effects }
Core.serialize(data, schemaVersion) -> JSON

LanguageModule.describe() -> LanguageDescriptor
LanguageModule.proposeBoundaries(textBlocks) -> LessonProposal[]
LanguageModule.segment(body) -> SentenceProposal[]
LanguageModule.prepare(text, sentences, profile) -> PreparedText
LanguageModule.buildHint(sentence, profile) -> StructuredHint
LanguageModule.comparePrepared(reference, actual, profile) -> DiffResult

Shared.alignUnits(referenceUnits, actualUnits, options) -> Alignment
Shared.validateRanges(text, ranges) -> ValidationResult
Shared.aggregateResult(alignment, metadata) -> DiffResult

Adapter.extractFile(source, languageId, cancelToken) -> TextBlock[]
Adapter.prepareOcrRegions(source, userRegions, languageId) -> OcrRegion[]
Adapter.recognizeRegions(regions, languageId, modelRef, cancelToken) -> TextBlock[]
Adapter.recognizeHandwriting(images, languageId, cancelToken) -> Recognition
Adapter.transcribe(recording, languageId, cancelToken) -> Recognition
Adapter.load/save(key, payload) -> Result
```

LanguageModule.prepare 合并处理归一化与单位划分，返回原文映射、比较单位和方向等元数据，避免强制所有语言采用相同处理顺序。comparePrepared 可以直接复用 Shared.alignUnits 与 Shared.aggregateResult，也可以实现语言特定策略，但其输出始终满足统一契约。

StructuredHint 包含 label、kind、textDirection 和有序提示片段，不要求单一英文字符串。客户端用统一组件显示，不执行模块返回的任意 UI 代码。

统一错误包含 LANGUAGE_REQUIRED、UNSUPPORTED_LANGUAGE、MODULE_VERSION_UNAVAILABLE、LANGUAGE_CONFLICT、UNSUPPORTED_INPUT、EMPTY_TEXT、RECOGNITION_FAILED、INVALID_BOUNDARY、STORAGE_FAILED、CANCELLED。任务带 taskId 和语言上下文；取消或改选语言后返回的旧结果不能覆盖新输入。ID、时间和任务结果由宿主注入，状态更新可复现；引擎不读取 API Key。

### 2.5 会话状态

逐句：ready → answering → checked → 下一句 answering；最后一句 checked 后进入 completed。跳过记录 skipped 后进入下一句；重试新增 Attempt，不擦除旧结果。

键盘全文：answering → comparing → completed。手写全文：collecting → recognizing → confirming → comparing → completed。整篇背诵：ready → recording → recognizing → confirming → comparing → completed。失败回到可重试阶段并保留输入，取消识别不等于完成训练。

以上状态机对所有语言复用。语言选择属于导入前置条件；进入训练后不临时改语言，已确认课文不支持变更正文或语言；其他内容通过独立导入建立课文及新会话。

### 2.6 逐行确认与持久化契约

草稿编辑文本与确认后的正文区分处理。语言模块 segment 用于图片或 PDF 提取、识别后的自动分句；粘贴文本不调用 segment，直接使用用户换行。确认调用使用用户最终行边界，不自动分句。

确认时将 CRLF/CR 统一为 LF，忽略空白行，保留非空行内的文字、大小写、标点和空白，以一个 LF 连接为 body。段落空行不进入训练正文，此为逐行校对格式的明确取舍。Sentence.start/end 使用 body 的码点索引，不包含行间 LF；顺序按非空行递增。每行包含有效比较单位才可确认，错误定位回编辑器原行号。

课文 ID、revisionId、句子 ID 和时间由宿主注入；在同一次确认重试中复用标识。确认成功后句子 ID 固定。LessonRevision 为不可变快照，保留模块及规则引用，不提供更新已有快照的接口。

存储适配层须在同一事务中写入确认快照并移除对应草稿；事务提交成功才通知 UI 完成。失败不丢草稿，双击与重试不生成重复课文。恢复时验证 schemaVersion、语言和范围，损坏数据不静默修复或覆盖。草稿可以单独保存并恢复；保存失败明确显示，未成功写入的数据不承诺刷新恢复。

草稿删除接口只操作对应草稿记录，事务提交成功才通知 UI 完成；失败或中止不丢草稿。重复删除同一 ID 视为成功，不影响确认快照。

### 2.7 训练持久化

本节对应产品需求 S07、F03 和 R06，不改变已确认课文的只读与版本绑定规则。

将 Session、Attempt 和 DiffResult 保存到独立训练记录中。逐句未提交输入只存在于当前页面，提交或跳过时随事件传入，在同一事务中与作答、结果和进度一起保存，不提前写入输入草稿。提示使用和答案查看标记只能累积，不能因较早写入任务晚完成而回退。显式操作等待保存完成后推进状态；逐句返回课文直接丢弃未提交输入。

全文键盘默写仅在显式保存草稿时持久化输入与当前阶段，不生成作答或结果；恢复以最后一次成功保存为准。草稿保存不触发比较、不推进完成状态，不能覆盖已提交作答。背诵确认后原始转写、确认文本和比较结果一并保存；真实语音接入前使用测试适配器验证，不提供模拟输入页面。

一次提交在同一事务内保存作答、结果和会话进度，事务完成后才展示已提交状态。requestId 在重复提交与失败重试中复用；已成功请求返回原结果，不生成重复 Attempt。重写或新会话生成新标识；已完成作答不可被输入草稿覆盖。恢复时核验课文版本、句子归属、模块版本和记录结构，损坏或缺失依赖时保留记录并明确报错，不重算或自动补齐。

逐句结果统计以每句首次作答及后续重试记录分别计算；跳过也保留为首次记录。错句重练固定原始句子 ID 和顺序，并绑定新的会话 ID，不修改来源会话。历史模块不可用时允许读取已保存的结果，但禁止继续比较。

删除训练记录在同一事务中移除选中的 Session 及其作答、结果，并清除直接关联重练会话的 sourceSessionId、递增其写入版本；重练的课文绑定、句子顺序、输入、作答、结果和训练时间保持不变。事务完成后才通知 UI 删除成功，失败回滚全部操作；重复删除视为成功。删除不操作课文快照，迟到更新发现会话缺失或写入版本变化时明确拒绝，不重新创建记录。

### 2.8 JSON 导入导出契约

状态：统一文件范围、外层字段、系统信息缺失表示、保留原状态、按 UUID 覆盖合并、原子导入与一致快照导出均已确定；不设置用户数据总量与 JSON 容量上限。业务规则见产品需求 I09。

已确定应用标识字段为 app，值为 nce-fighter；另设 system 对象，以 name、version 记录导出时用户的操作系统名称与版本。system 始终保留，name、version 分别为字符串或 null；无法获取的字段填 JSON 的 null，不猜测、不使用字符串 "null"。两个字段均无法获取时均填 null，不影响导出或导入。system 属于文件来源信息，不用于决定课文语言、比较规则或覆盖优先级；导入不因来源系统与当前系统不同而拒绝。系统信息由浏览器适配层提供。

其余外层字段为 schemaVersion、drafts、lessons、sessions，文件使用 UTF-8 JSON。无文件批次的数据使用 schemaVersion 1；含文件来源的数据使用 schemaVersion 2，并包含 batches。两个版本均可恢复，版本 1 不接受文件批次字段。drafts 保存课文草稿，lessons 保存已确认课文，sessions 保存训练会话及其已保存输入、作答、识别文本和 DiffResult。batches 保存来源定位和批次归属，不包含原始文件。同一文件包含全部已保存用户内容，可包含多种语言；各对象保留自身 languageId。关联课文版本、来源训练和文件批次必须在文件内或目标库中存在。

JSON 使用恢复事务，保持原标识和草稿／已确认状态，不重新校对、分句、归一化或计算历史结果。草稿按草稿结构校验，不要求通过课文确认门槛；已确认课文保持只读。结构校验不要求安装历史模块，模块不可用时可读取已有结果，但继续训练仍按第 2.2 节阻止。按各对象实际状态核验模块引用、码点范围、单位计数、句子归属和依赖关系；不因文件携带结果就信任其结构。文件内重复 ID、未知 schemaVersion、无效状态、缺失语言、关联对象语言不一致和引用损坏均明确拒绝。

按 UUID 合并，同 UUID 的对象完整替换为文件中的对象，不按内容或时间判断是否覆盖；文件新增对象写入，本机独有对象保留。课文草稿与已确认课文需按共同的课文标识处理状态替换，不能因存储集合不同而同时留下同一课文的两种状态。训练会话连同其输入、作答和结果整体替换，不拼接两份记录；JSON 恢复属于显式数据导入，不受普通作答不可改写历史结果的操作限制。

导出通过同一个只读事务取得一致快照，恢复在同一个写事务内核验合并后的依赖并写入，失败整体回滚。导出期间由页面阻止当前页面的其他操作，不能以界面阻挡代替存储快照，因为其他页面仍可能写入。导入后使受覆盖记录的旧写入失效，防止打开的训练页面用导入前状态覆盖恢复数据。导出包含手动保存的全文输入草稿；逐句未提交输入不持久化，因此不在文件中。未完成会话恢复其已保存输入、进度和操作标记。

不设置课文和训练记录总数、JSON 文件大小、对象数量或嵌套深度的容量上限，不因预设容量阈值拒绝导入或导出。结构、状态与引用校验仍须执行；实际解析或存储失败时明确反馈，导入写入失败整体回滚，不截断数据。

### 2.9 文件批次与草稿拆合契约

本节定义第 2.3／2.4 节的文件输入契约。核心结构见 [document.ts](../app/core/document.ts)，浏览器事务见 [storage.ts](../app/adapters/storage.ts)；粘贴文本仍一次一篇。

- 文件批次绑定用户选择的 languageId，每批为一个 PDF 或有序图片集合。来源文件、页面、区域和文本块保留稳定标识及顺序；图片跨文件组成连续材料，PDF 按页序汇总。失败部分全部成功或明确跳过后，语言模块基于整批可用内容提出标题、课号与句子边界，统一引擎生成多篇草稿；不能把页数或图片数直接当作课文数。
- 批次、来源和草稿的宿主标识、时间、任务代次由适配层注入。取消、改选语言、重新识别或调整来源区域后，旧任务不得写回新状态。成功识别内容与失败部分分别记录，重试只处理失败部分，不重复已有结果；完成前不提前生成可校对草稿。
- 重新识别丢弃未保存草稿，保留已保存草稿及其来源关联；保留项按原顺序位于队列最前，新结果排在后面，不覆盖旧草稿。取消或网页关闭不持久化本轮未保存的中间结果。
- 拆合仅用于草稿；合并要求同一批次、同语言，正文顺序由用户确认，不开放跨批次合并。拆分保留原草稿标识用于前半篇，后半篇生成新标识；合并保留第一篇标识，移除其他参与草稿。同步重建正文范围、来源关联和写入版本，已确认课文及训练记录不参与拆合。
- 涉及未保存修改先处理保存／放弃／取消。已保存草稿的拆合在同一事务内保存全部结果并移除被替代草稿，成功后才更新界面；失败保留原草稿和当前编辑内容。重复请求复用操作标识，旧页面不能重新写回已经被合并的草稿。
- 显式保存草稿时持久化正文、来源定位及恢复批次归属所需的数据，不保存原始 PDF／图片。正文确认使用用户最终行边界，课文确认事务保留来源关联；删除草稿或清理来源不得留下悬空依赖。重选原文件须核对匹配，未匹配时仍可编辑正文，不假装来源预览或重新识别可用。
- 来源文件记录稳定标识、名称、字节数、类型和 SHA-256；来源区域记录文件标识、页号、顺序、旋转及旋转后页面上的归一化矩形。草稿与课文关联 batchId、sourceRefs，句子保存对应来源；人工改写正文后采用原来源集合，避免伪造精确对应。
- 批次、来源及关联字段纳入第 2.8 节的 JSON 版本 2、依赖校验和完整恢复；兼容版本 1。拆合通过 storageVersion、操作标识和已移除标识记录防止重放及迟到写入；原始文件不进入 JSON，未保存中间结果不导出。
