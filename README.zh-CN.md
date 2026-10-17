# ![Flint AI Panel logo](src/img/logo-title.png) Grafana Flint Panel

[English](README.md) | [简体中文](README.zh-CN.md)

Flint 是一个由 [Microsoft Flint](https://github.com/microsoft/flint-chart) 驱动的 Grafana AI 辅助可视化面板。在 AI Chat 中描述你想要的图表，基于当前 Grafana 查询数据生成提案，在实时预览中审查，然后明确应用到 Panel。Flint 随后通过 Apache ECharts、Vega-Lite、Plotly 或 Chart.js 完成渲染。

> [!WARNING]
> **项目状态：实验性的研究型概念验证（POC），尚未达到生产就绪。** 本仓库用于验证和评估 Flint、Grafana 与 AI 可视化提案的集成，不承诺稳定的兼容性或迁移路径。请将所有 AI 提案视为不可信输入：Create 模式可能重新生成图表类型、字段绑定或 Flint Spec。Refine 模式允许修改标题、副标题、字段显示名称，以及支持的多数值系列图表的系列配色。点击 Apply 前必须检查预览和 Chart Settings。详见[项目状态与成熟度](docs/project-status.md)。

**Chart Settings 无需 AI 即可使用。** 在 Chart workbench 中选择图表类型、绑定查询字段、选择多数值字段并调整支持的图表选项。AI Chat 是修改同一份 Flint 源配置的可选入口。对话式生成通过单独安装的 [Flint AI Datasource](https://github.com/IBUMBLEBEE/grafana-flintai-datasource) 插件完成，使 Provider 配置和凭据与 Panel 保持隔离。

![AI Chart Studio：实时 Panel 预览与 AI Chat](src/img/screenshots/ai-chart-studio-v0.3.1.gif)

## 核心特性

- 通过 AI Chat，结合当前 Grafana 查询上下文创建和迭代图表。
- 在实时预览中审查生成的草稿，再明确应用或放弃修改。
- 使用 Apache ECharts、Vega-Lite、Plotly 或 Chart.js 渲染已确认的图表。
- 需要更多控制时，可使用 Auto、手动设置或规范编辑器。

## 兼容性

| 组件             | 支持版本          |
| ---------------- | ----------------- |
| Grafana          | 12.3.0 或更高版本 |
| 开发环境 Node.js | 22 或更高版本     |
| 包管理器         | npm 10            |

浏览器测试覆盖最低支持的 Grafana 12.3 系列和当前 Grafana 13 系列。

## 快速开始

### 启动开发环境

```bash
npm ci
npm run build
docker compose up --build
```

打开 <http://localhost:3000>，进入 **Provisioned Flint dashboard**。默认 Compose 环境会构建并挂载当前 Panel，并使用 Grafana 内置的 TestData 数据源；不依赖相邻目录中的其他 datasource 仓库。

需要增量开发时，可在另一个终端运行：

```bash
npm run dev
```

### 安装 AI 依赖插件

AI Chat 和图表生成功能依赖配套的 [Flint AI Datasource](https://github.com/IBUMBLEBEE/grafana-flintai-datasource) 插件。该插件当前要求 **Grafana 13.1.0 或更高版本**；Panel 的自动和手动图表功能仍支持 Grafana 12.3.0 或更高版本，无需安装此依赖。

1. 按照依赖插件的[项目文档](https://github.com/IBUMBLEBEE/grafana-flintai-datasource#readme)，将 Flint AI Datasource 安装到同一个 Grafana 实例。
2. 添加 Flint AI Datasource 实例，配置 Provider、API Token 和模型，测试 AI 连接并保存数据源。
3. 打开 Flint Panel 的 Chart workbench，选择已配置的模型。

该数据源负责 AI 请求和凭据管理。Panel 查询仍连接提供图表数据的业务数据源。

### 不依赖 AI 创建可视化

1. 执行 Panel 查询，通过 Grafana transformations 准备所需数据。
2. 打开 **Chart settings → Open Chart workbench → Chart Settings**。
3. 选择图表类型；字段控件随类型变化，包括分组、饼图分类/数值和热力图颜色数值。
4. 对支持的折线、面积和柱状图选择一个或多个数值 Y 字段。Auto 显示推断结果，清空数值选择可恢复 Auto。
5. 调整当前后端支持的图表选项和 Tooltip；Default/Reset 移除单项覆盖配置。
6. 检查 **UI Preview** 后点击 **Apply to panel**，保存 Dashboard 以持久化修改。

切换图表保留兼容字段和选项；查询字段消失时需重新绑定。AI 修改基于当前预览草稿，保留响应未涉及的兼容设置。Vega-Lite 下的 **Theme preset** 提供已安装 Flint 的官方主题预设，**Default (Flint)** 可恢复默认样式。其他后端禁用主题选择并明确提示不支持，保留已保存的预设以便切回 Vega-Lite。主题修改沿用预览与 Apply 流程，暂不支持自定义主题对象。

### 使用 AI Assist 创建可视化

1. 在 Grafana Dashboard 中添加 Panel 并配置查询。
2. 选择 **Flint** 可视化。
3. 展开 **Chart settings** 并打开 **Chart workbench**。
4. 选择已配置的模型，在 **AI Chat** 中描述需要创建或修改的图表，然后发送请求。
5. 直接点击 **Generate proposal**。AI 根据整段对话和当前图表判断是局部修改还是重新设计；需求含糊时先追问。检查显示的修改范围及预览，再点击 Apply。
6. 查看实时预览；需要时继续对话，或调整 Chart Settings、Flint Spec，并查看只读的 UI Framework Spec。
7. 点击 **Apply to panel** 应用草稿，或点击 **Discard edits** 放弃修改。

如果尚未配置 AI Provider，可以保持 **Chart type** 为 **Auto**，或使用 Chart Studio 的手动配置功能。

## 渲染后端

| 后端           | 适用场景                               |
| -------------- | -------------------------------------- |
| Apache ECharts | 默认后端，适合大多数 Grafana Dashboard |
| Vega-Lite      | 声明式统计图表和可视化语法             |
| Plotly         | 交互式科学计算和统计图表               |
| Chart.js       | 常见场景下较轻量的 Canvas 图表         |

各渲染器采用按需加载，打开普通 Flint Panel 时不会一次性加载所有后端。

![Flint 可视化示例](src/img/screenshots/flint-panel.png)

## Chart Studio

Chart Studio 是位于 Grafana Panel 编辑器内的 AI 辅助图表创建和审查工作区：

- **AI Chat** 根据当前数据上下文接收自然语言图表需求和后续修改要求。
- **自动提案规划** 根据对话和当前图表判断修改范围，展示局部修改或重新设计的计划供你审核。
- **Generate proposal** 将对话转换为经过校验、尚未应用的图表草稿。
- **UI Preview** 使用真实查询帧渲染当前 Panel 或 AI 提议的草稿。
- **Chart Settings** 提供可审查的图表类型和字段映射配置。
- **Flint Spec** 展示语义层可视化规范。
- **UI Framework Spec** 展示只读的编译后端原生配置。
- **Apply to panel** 是 AI 提案与已保存 Panel 配置之间的明确边界。

草稿会绑定当前 Dashboard、Panel、查询和字段结构。如果这些上下文发生变化，过期草稿将无法直接应用。

## 工作原理

```text
Grafana 查询帧
  -> 构建脱敏的数据摘要和字段结构
  -> 与 AI Chat 请求及对话上下文组合
  -> 生成并校验 Flint 图表提案
  -> 暂存无查询数据的 Flint 源输入提案
  -> 绑定当前查询数据及宿主尺寸
  -> 为选定后端编译并预览
  -> 明确 Apply，将源输入写入 Panel options
  -> 保存 Dashboard 持久化
  -> 在查询刷新或尺寸改变时重新绑定并编译
```

AI 工作流直接使用已经绑定到 Grafana Panel 的查询帧，不会再引入第二套业务数据选择器。提案应用后，即使没有正在进行的 AI 请求，Panel 仍可继续渲染图表。

## AI Assist 配置与安全边界

Apply 后，在聊天中提出撤销或恢复请求，AI 会选择历史版本，Panel 根据保存的完整快照准备预览。审阅后点击 **Restore this version** 才会恢复。**Undo last apply** 同样先准备预览；也可以从 **Chart history** 中选择版本。当前标签页的 `sessionStorage` 最多保留 10 个无查询数据的版本，保留完整源配置、Auto 绑定模式及系列颜色；清空聊天不会删除图表历史。查询变化或历史之外的配置修改会使恢复失效，下一次 Apply 将建立匹配当前配置的新历史。Dashboard 仍需通过 Grafana 单独保存。诊断导出包含历史记录及恢复是否可用。

开发调试时，点击 AI Chat 顶部的下载图标 **Export diagnostics**，即可下载 JSON 诊断文件。文件包含保留的聊天记录、当前图表源和提案、预览状态及错误、查询字段结构，以及当前编辑器内最近 20 次 AI 调用。凭据、查询数据行和数据样例不纳入导出。调用记录仅保存在内存中，从编辑器挂载时开始采集，清空聊天时重置；不包含后端内部重试。导出不会应用或保存图表。

按照[安装 AI 依赖插件](#安装-ai-依赖插件)的说明配置 [Flint AI Datasource](https://github.com/IBUMBLEBEE/grafana-flintai-datasource)，然后在 Chart workbench 中选择其模型。服务不可用时，自动和手工创建图表的能力仍然可用。

该集成遵循以下安全边界：

- Provider 凭据归数据源管理，由 Grafana 存储在 `secureJsonData` 中。
- Flint Panel 和 Dashboard JSON 不保存 Provider API Key。
- 聊天记录有容量限制，并且仅临时保存在当前浏览器会话中。
- 发送给 Provider 的数据摘要会经过脱敏和大小限制，且不包含业务数据源身份。
- Provider 输出先统一为无查询数据的 Flint 源状态，再进行预览和 Apply；旧标量字段仅在 Provider 兼容边界处理。
- Refine 携带当前源状态，允许修改标题、副标题、字段显示名称，以及受支持多数值系列图表的系列配色；其余内容保持锁定，修复请求遵守同样的规则。
- Refine 不会降级为标量字段。Create 仅在真实旧字段选择通过校验和编译时允许兼容降级，并显示高级源被拒绝的原因。
- AI 生成的配置会根据当前查询字段进行校验。
- 保存的 Flint 源输入不能嵌入查询数据行；UI Framework Spec 是只读编译结果。
- 只有用户明确点击 Apply 后，提案才会修改 Panel。

模拟 Provider 浏览器测试无需 API Key，用于验证 Panel 守卫；它们不证明真实 LLM 或独立安装的数据源兼容性。

## Panel 配置契约

Agent 和自动化配置工具可以使用以下结构：

```json
{
  "type": "ibumblebee-flint-panel",
  "options": {
    "stateVersion": 1,
    "renderBackend": "echarts",
    "bindingMode": "auto",
    "flintInput": {
      "chart_spec": { "chartType": "Line Chart", "encodings": {} }
    },
    "ai": {
      "lastPrompt": ""
    }
  }
}
```

外部 Agent 应写入结构化、无查询数据的 `flintInput`。Chart Settings 和 Flint Spec 修改同一份源输入；后端结果在运行时编译，已移除 override 功能。完整定义请参阅 [options schema](docs/schemas/flint-panel-options.schema.json) 和 [Grafana MCP contract](docs/agent-flint-grafana.md)。

## 开发与验证

运行与 CI 相同的检查：

```bash
npm run format:check
npm run check:flint-contract
npm run typecheck
npm run lint
npm run test:ci
npm run audit:prod
npm run build
npm run e2e
```

常用命令：

| 命令              | 用途                                    |
| ----------------- | --------------------------------------- |
| `npm run dev`     | 监听并重新构建前端                      |
| `npm run test:ci` | 运行 Jest 单元测试                      |
| `npm run e2e`     | 使用 Playwright 运行 Grafana 浏览器测试 |
| `npm run build`   | 在 `dist/` 中生成生产插件               |
| `npm run sign`    | 对已经获得批准的插件构建进行签名        |

## 项目结构

```text
src/components/     Panel、Chart Studio、预览和聊天界面
src/flint/          数据转换、校验、编译和渲染器
src/ai/             Panel 上下文、提案、Provider 客户端和临时聊天
tests/              Grafana Playwright 端到端测试
provisioning/       本地 Dashboard 和数据源测试配置
docs/               需求、Schema、设计说明和 MCP 示例
```

## 文档

- [项目状态与成熟度](docs/project-status.md)
- [文档索引](docs/README.md)
- [产品路线图](docs/product-roadmap.md)
- [Agent 与 Grafana MCP 契约](docs/agent-flint-grafana.md)
- [Panel options schema](docs/schemas/flint-panel-options.schema.json)
- [安全策略](SECURITY.md)
- [贡献指南](CONTRIBUTING.md)
- [更新日志](CHANGELOG.md)

## 打包与发布

发布压缩包的顶层目录必须与插件 ID 一致：

```text
ibumblebee-flint-panel/
  plugin.json
  module.js
  README.md
  LICENSE
  ...
```

向 Grafana 提交公共插件时，还需要公开源码仓库、Release 压缩包、对应的 SHA1、测试说明，以及与插件 ID 前缀 `ibumblebee` 一致的 Grafana Cloud 组织。新的公共插件在首次审核期间通常保持未签名状态，通过审核后再进行签名。

## 参与贡献

欢迎参与贡献。提交 Issue 或 Pull Request 前，请先阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。安全漏洞请按照 [SECURITY.md](SECURITY.md) 的说明进行私密报告。

## 致谢

Flint Panel 基于 Microsoft Flint、Grafana、Apache ECharts、Vega/Vega-Lite、Plotly.js、Chart.js 和 assistant-ui 构建。生产压缩包会在 `LICENSE.txt` 中包含依赖许可证信息。

## 许可证

本项目采用 Apache-2.0 许可证，详见 [LICENSE](LICENSE)。
