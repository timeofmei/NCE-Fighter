# 工程开发指南

状态：已实现文本训练及本地 PDF／印刷 OCR；当前交付与验证结果见[阶段 04](stages/04-document-ocr.md)，协作流程见[开发流程](DEVELOPMENT_WORKFLOW.md)。

## 技术栈与运行边界

采用 React Router Framework Mode、TypeScript、Mantine 和 SPA 模式；使用框架的 Vite 集成，不额外建立业务服务器。配置 ssr: false，产物为 build/client，发布到支持页面路由回退的静态 HTTPS 站点。

SPA 模式仍会在构建期预渲染根页面。IndexedDB、文件、麦克风和模型能力仅在浏览器阶段初始化，浏览器适配模块不能在初始渲染或模块顶层访问这些能力。使用客户端加载与操作处理本地数据。[官方 SPA 指南](https://reactrouter.com/how-to/spa)。

依赖及其精确版本以 [package.json](../package.json) 和 [package-lock.json](../package-lock.json) 为准。

## 工程结构

先采用单个 npm 工程，通过目录和导入边界隔离职责，不提前引入多包工作区。

```text
app/
  root.tsx
  routes.ts
  routes/               路由页面与客户端加载逻辑
  components/           共用界面组件
  core/                 课文结构、校验与统一业务逻辑
  languages/            注册机制及各语言实现
  adapters/             浏览器存储、PDF、OCR Worker 与资源缓存
  styles/               全局与页面样式
tests/
  unit/                 核心和模块测试
  integration/          存储、事务及恢复验证
  e2e/                  关键用户流程
doc/
```

core 不依赖 React、DOM、IndexedDB 或模型运行时；语言模块不依赖路由或存储。浏览器适配层实现核心定义的接口，页面通过业务调用组织操作，不在组件中复制校验规则。ID 与时间通过宿主注入。

## 数据与页面组织

数据契约唯一维护在[核心引擎](CORE_ENGINE.md#26-逐行确认与持久化契约)。工程使用原生 IndexedDB 的集中适配器，不在各页面分散操作数据库。数据库版本与导出 schemaVersion 分开维护。IndexedDB 保存 JavaScript 字符串，不指定文本文件编码；项目源码、文档和后续 JSON 导出使用 UTF-8。

路由：/library 为课文库，/import 为导入与草稿编辑，/resources 为本地 OCR 资源与设备检测，/lessons/:lessonId 为只读详情，/training/:sessionId 共用逐句与全文键盘训练页面，/results/:sessionId 为保存的训练结果；根路径进入课文库。课文和会话 ID 由浏览器生成，详情与训练通过客户端读取。缺失 ID 提示不存在，存储读取失败提示重试；两者不得混同。

统一 JSON 结构及依赖校验位于 app/core/user-data.ts；IndexedDbStore.exportData、checkImport、importData 使用同一组对象仓库的事务。会话 generation 与 version、课文对象 storageVersion 是写入并发控制字段，恢复时递增以使旧页面的写入失效，业务内容与历史结果按文件恢复。页面更新会话时传入当前 generation 与 version；校对页保存或确认时保留加载时的 storageVersion。识别接口位于 app/core/recognition.ts，固定 OCR／ASR 适配器只存在于测试中，不注册为应用输入能力。

本地数据限定于当前浏览器及站点来源，不承诺跨设备恢复。静态部署须让页面 URL 回退到 index.html，同时保留真实资源请求的正常失败状态；相关配置和断网能力在发布阶段独立验收。

IndexedDB 当前版本为 3，升级时保留此前课文、草稿与训练数据，并创建 batches、mutations 仓库。数据库版本独立于 JSON 版本 1／2；旧导出可恢复。刷新恢复、课文只读、会话版本绑定与历史结果保护按核心契约验证，不在读取失败时自动删除数据。

编辑与训练状态以局部状态和必要的共享上下文管理；出现实际复杂度后再评估全局状态库。

访问统计使用 @vercel/analytics，在根布局挂载 React Analytics 组件。按 Vite 环境显式选择开发或生产模式，开发模式仅记录调试事件。网络与用户数据边界见[本地处理与静态部署](WEB_LOCAL_PROCESSING.md#18-本地处理与静态部署)。启用统计需在 Vercel 项目的 Analytics 页面点击 Enable，再部署包含组件的版本；部署后检查脚本加载和事件上报，仪表盘数据显示单独确认。接入步骤见 [Vercel 官方指南](https://vercel.com/docs/analytics/quickstart)。

## 组件与主题

通用 UI 使用 Mantine，不自行实现按钮、输入框、选择器、弹窗、通知等基础控件。页面与业务组件通过组合库组件实现，额外 CSS 用于必要的页面布局和业务展示。

使用 @mantine/core、@mantine/hooks，按需加入 @mantine/form 和 @mantine/notifications。统一在根页面配置 MantineProvider、主题与样式入口，颜色、字体、圆角和间距集中管理。具体视觉主题尚未确定。

正文编辑使用 Textarea，确认窗口使用 Modal，操作反馈使用 Notifications 或 Alert；布局、文案和错误定位见 [P02](WEB_UX.md#p02-导入)。表单 UI 校验复用核心校验结果，不在组件库层重新定义业务规则。

初始化时验证 Mantine 与所选 React、框架版本及 SPA 构建的兼容性，相关包版本保持匹配并写入锁文件。[Mantine 官方指南](https://mantine.dev/getting-started/)。

## 开发命令与验证

在仓库根目录执行下列实际命令。首次安装运行 npm ci；首次运行端到端测试另执行 npx playwright install chromium。访问地址以启动命令输出为准；生产预览须先完成构建。恢复测试使用同一浏览器和站点来源。

| 命令                                                            | 用途                                                                  |
| --------------------------------------------------------------- | --------------------------------------------------------------------- |
| npm ci                                                          | 按工作区锁文件安装依赖                                                |
| npm run dev                                                     | 启动开发应用                                                          |
| npm run typecheck                                               | 生成路由类型并执行 TypeScript 检查                                    |
| npm run lint                                                    | 检查代码规范和依赖边界                                                |
| npm run test                                                    | 执行 Vitest 单元及集成测试                                            |
| npm run test:e2e                                                | 执行 Playwright 关键流程测试                                          |
| npm run build                                                   | 验证静态生产构建                                                      |
| npm run preview                                                 | 在本地预览 build/client 的生产产物                                    |
| npm run prepare:resources                                       | 生成本站 PDF／WASM 资源及 OCR 大小与 SHA-256 清单；dev/build 自动执行 |
| node scripts/generate-document-fixtures.mjs                     | 重建公开材料派生的 PDF／图片测试样本                                  |
| node scripts/measure-document-runtime.mjs http://localhost:5173 | 对已启动的开发服务测量真实 OCR、PDF 和浏览器进程树内存                |

模型原文件、词表、许可证与来源说明位于 [public/models](../public/models/ppocr-tiny/NOTICE.md)。构建资源由锁定依赖生成到 public/resources，目录不入 Git；正式 OCR 下载校验清单为 [ocr-manifest.json](../app/adapters/ocr-manifest.json)。PDF.js Worker 随构建输出，CMap、字体、WASM 和 ICC 从本站资源目录按需加载。开发服务预优化文件页面依赖，避免首次打开文件输入时因依赖优化重载丢失选择。

核心测试重点为范围、输入校验、确定性及语言契约；存储测试验证事务失败和恢复；端到端测试验证用户流程及刷新。实际命令和结果记录在阶段文档，不将计划测试记为通过。用户体验验收步骤也只维护在阶段文档。

lint 检查 core/languages 对 UI、路由、存储及浏览器全局的依赖边界。test:e2e 自动启动独立的生产预览和开发故障验证服务；服务配置见 [playwright.config.ts](../playwright.config.ts)，运行时配置的端口须空闲。静态部署只发布 build/client，不需要构建时生成的 server 中间产物，也不需要业务服务器；生产托管的路由回退、真实资源 404 与断网能力仍在发布阶段验收。

比较性能可通过 `node scripts/benchmark-comparison.mjs` 测量，脚本对英语词模块和仅用于契约验证的字素簇模块分别输出两份文本分析和对齐聚合的 p95。单篇容量限制维护在[第二阶段交付记录](stages/02-sentence-training.md#交付记录)，第三阶段实测见[阶段 03](stages/03-core-completion.md#自动验证与性能记录)；用户数据总量与 JSON 不设预定容量上限。Unicode 大小写折叠表使用 Unicode 17.0 数据；许可见 [licenses/UNICODE.txt](../licenses/UNICODE.txt)。
