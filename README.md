# NCE Fighter

NCE Fighter 是一个面向多语言课文记忆训练的响应式 Web 项目。学习者先选择内容语言，导入并校对课文，确认标准答案后进行逐句默写、全文默写或整篇背诵，通过确定性的文本差异检查记忆情况。

项目采用统一业务引擎、独立语言文本模块和浏览器适配层。训练统一忽略大小写与标点，不进行发音评分。后续 PDF、OCR 和 ASR 在浏览器本地处理，程序和模型通过静态站点提供，用户课文、图片和音频留在浏览器内。

第一阶段文本导入与只读课文已完成，用户验收和刷新离开警告回归均通过。当前提供英语文本导入、逐行校对、草稿保存与删除、确认只读，以及逐句默写、差异反馈、错句重练、历史结果和浏览器本地恢复。启动命令见[工程开发指南](doc/DEVELOPMENT.md#开发命令与验证)，第一阶段验收记录见[阶段 01](doc/stages/01-text-import.md)。

第二阶段比较与逐句训练已完成，用户验收通过；验收步骤与验证结果见[阶段 02](doc/stages/02-sentence-training.md)。全文训练、JSON、PDF、OCR 和 ASR 按后续阶段推进。

第三阶段全文训练与核心交付补齐的文档审核项已确认，已授权实现，代码尚未开始；范围与实施安排见[阶段 03](doc/stages/03-core-completion.md)。

## 项目文档

- [产品需求](doc/PRODUCT_REQUIREMENTS.md)：目标、范围、流程与训练规则。
- [核心引擎与多语言契约](doc/CORE_ENGINE.md)：比对、数据结构、接口与状态机。
- [页面与交互设计](doc/WEB_UX.md)：页面布局、操作与响应式交互。
- [验收标准与开发里程碑](doc/DELIVERY_PLAN.md)：核心验收与开发顺序。
- [Web 本地处理与技术约束](doc/WEB_LOCAL_PROCESSING.md)：PDF、OCR、ASR、模型资源与部署。
- [文档组织与开发流程](doc/DEVELOPMENT_WORKFLOW.md)：文档职责、阶段交付、审核与验收流程。
- [工程开发指南](doc/DEVELOPMENT.md)：技术栈、目录、存储与开发验证方案。
- [阶段 01：文本导入](doc/stages/01-text-import.md)：可运行交付、验收步骤与已完成的验证记录。
- [阶段 02：比较与逐句训练](doc/stages/02-sentence-training.md)：已审核范围、实现授权、实施安排及用户验收步骤。
- [阶段 03：全文训练与核心补齐](doc/stages/03-core-completion.md)：已确认范围、实施安排、JSON 契约与验收计划。
- [协作与 Git 规则](AGENTS.md)：文件编辑、提交和合并要求。

## License

本项目采用 [MIT License](LICENSE)。第三方依赖与模型遵循各自许可证，接入时另行核查。
