# 工程开发指南

状态：已建立第一阶段工程；实际交付与验收结果见[阶段 01](stages/01-text-import.md)，协作流程见[开发流程](DEVELOPMENT_WORKFLOW.md)。

## 技术栈与运行边界

采用 React Router Framework Mode、TypeScript、Mantine 和 SPA 模式；使用框架的 Vite 集成，不额外建立业务服务器。配置 ssr: false，产物为 build/client，发布到支持页面路由回退的静态 HTTPS 站点。

SPA 模式仍会在构建期预渲染根页面。IndexedDB、文件、麦克风和模型能力仅在浏览器阶段初始化，浏览器适配模块不能在初始渲染或模块顶层访问这些能力。使用客户端加载与操作处理本地数据。[官方 SPA 指南](https://reactrouter.com/how-to/spa)。

实测环境为 Windows x64、Node.js 24.21.0、npm 12.2.0。React Router 与框架工具 8.4.0、React 与 React DOM 19.3.0、Mantine core/hooks 9.7.1、Vite 8.3.4、TypeScript 6.0.3 已完成集成验证；依赖精确版本以 package.json 和 package-lock.json 为准。未验证其他 Node.js 版本，不将上述实测版本视为最低支持承诺。

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
  adapters/             浏览器存储及后续识别适配器
  styles/               全局与页面样式
tests/
  unit/                 核心和模块测试
  integration/          存储、事务及恢复验证
  e2e/                  关键用户流程
doc/
```

core 不依赖 React、DOM、IndexedDB 或模型运行时；语言模块不依赖路由或存储。浏览器适配层实现核心定义的接口，页面通过业务调用组织操作，不在组件中复制校验规则。ID 与时间通过宿主注入。

## 数据与页面组织

数据契约唯一维护在[核心引擎](CORE_ENGINE.md)。采用 IndexedDB 保存草稿及确认快照，分别存储并使用事务完成确认；初期使用原生 IndexedDB 的集中适配器，不在各页面分散操作数据库。数据库版本与导出 schemaVersion 分开维护。IndexedDB 保存 JavaScript 字符串，不指定文本文件编码；项目源码、文档和后续 JSON 导出使用 UTF-8。码点计数及范围索引按核心契约处理，与文件编码分开。

路由规划：/library 为课文库，/import 为导入与草稿编辑，/lessons/:lessonId 为只读详情；根路径进入课文库。课文 ID 由浏览器生成，详情通过客户端读取。缺失 ID 提示不存在，存储读取失败提示重试；两者不得混同。

本地数据限定于当前浏览器及站点来源，不承诺跨设备恢复。静态部署须让页面 URL 回退到 index.html，同时保留真实资源请求的正常失败状态；相关配置和断网能力在发布阶段独立验收。

编辑与训练状态以局部状态和必要的共享上下文管理；出现实际复杂度后再评估全局状态库。初期不加入远程遥测。

## 组件与主题

通用 UI 使用 Mantine，不自行实现按钮、输入框、选择器、弹窗、通知等基础控件。页面与业务组件通过组合库组件实现，额外 CSS 用于必要的页面布局和业务展示。

使用 @mantine/core、@mantine/hooks，按需加入 @mantine/form 和 @mantine/notifications。统一在根页面配置 MantineProvider、主题与样式入口，颜色、字体、圆角和间距集中管理。具体视觉主题尚未确定。

正文编辑使用 Textarea，直接保留用户换行并提示“每行一句”；句数与按编辑器原行号定位的错误作为业务辅助展示，不另设行号预览区域。离开确认使用 Modal，操作反馈使用 Notifications 或 Alert。表单 UI 校验复用核心校验结果，不在组件库层重新定义业务规则。

初始化时验证 Mantine 与所选 React、框架版本及 SPA 构建的兼容性，相关包版本保持匹配并写入锁文件。[Mantine 官方指南](https://mantine.dev/getting-started/)。

## 开发命令与验证

在仓库根目录执行下列实际命令。首次安装运行 npm ci；首次运行端到端测试另执行 npx playwright install chromium。开发地址默认 http://127.0.0.1:5173；生产预览默认 http://127.0.0.1:4173，须先完成构建。保持相同地址及端口测试恢复，开发与预览的本地数据分别保存。

| 命令 | 用途 |
| --- | --- |
| npm ci | 按工作区锁文件安装依赖 |
| npm run dev | 启动开发应用 |
| npm run typecheck | 生成路由类型并执行 TypeScript 检查 |
| npm run lint | 检查代码规范和依赖边界 |
| npm run test | 执行 Vitest 单元及集成测试 |
| npm run test:e2e | 执行 Playwright 关键流程测试 |
| npm run build | 验证静态生产构建 |
| npm run preview | 在本地预览 build/client 的生产产物 |

核心测试重点为范围、输入校验、确定性及语言契约；存储测试验证事务失败和恢复；端到端测试验证用户流程及刷新。实际命令、设备和结果记录在阶段文档，不将计划测试记为通过。用户体验验收步骤也只维护在阶段文档。

lint 检查 core/languages 对 UI、路由、存储及浏览器全局的依赖边界。test:e2e 自动启动独立的生产预览（4173）和开发故障验证服务（5174）；运行时这两个端口须空闲。静态部署只发布 build/client，不需要构建时生成的 server 中间产物，也不需要业务服务器；生产托管的路由回退、真实资源 404 与断网能力仍在发布阶段验收。
