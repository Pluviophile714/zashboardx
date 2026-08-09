# 上游功能增量同步设计

## 目标

在保留 zashboardx 已有 Metrics、延迟图表、时间桶、移动端交互、延迟条动画、Docker 和安装部署能力的前提下，持续吸收 Zephyruso/zashboard 的通用功能和修复，使其余部分尽量接近官方版本。

## 同步边界

- 以当前 zashboardx `origin/master` 为基础，不以官方分支直接覆盖。
- 保留 Metrics helper、Metrics API、SQLite 数据目录、双容器安装/更新脚本和相关工作流。
- 保留 1h/6h/24h 延迟图、时间桶汇总、桶内样本、近 30 次共享记录、一级近 10 次动画和移动端指针交互。
- 官方只涉及通用页面、核心兼容性、连接展示、弹窗行为和地球仪的变更，可直接移植或手动适配。
- 官方删除或重构上述自定义能力的提交不直接合并，只提取其中不冲突的独立修复。

## 分批策略

### 可优先移植

- 连接页 All 标签。
- 延迟标签加载状态、数字过渡和代理节点可见性修复。
- 核心版本检测、历史记录和 sing-box/Honk 的通用兼容性修复。
- 地球仪触摸控制、初始化位置、视觉模式和资源优化。

### 需要手动适配

- DialogWrapper 的视口高度和移动端弹窗过渡，只保留官方通用修复，不覆盖现有二级浮窗布局。
- ProxyNodeCard、ProxyGroup 和代理动画，只把官方通用动画或可见性修复接入现有 Metrics 数据源。
- 图表和 CSS 重构，只在不改变现有 Metrics DOM、数据口径和移动端布局的范围内吸收。

### 明确跳过

- 删除 `packages/metrics-helper`、`src/api/metricsHelper.ts`、`src/store/proxyMetrics.ts` 或相关测试的提交。
- 删除或覆盖 `scripts/install-metrics.sh`、`scripts/update-metrics.sh`、R5S 部署脚本、Dockerfile 和 Metrics 工作流的提交。
- 直接替换现有延迟时间线、时间桶和代理增强实现的大型重构。

## 验收标准

- `pnpm run type-check` 通过。
- `pnpm run build` 通过。
- Metrics helper 测试和安装脚本回归测试通过。
- 桌面端和移动端代理页可打开，已有 Metrics 数据和延迟条逻辑不丢失。
- 地球仪可独立加载，数据库继续存放在浏览器 IndexedDB，不写入 R5S Docker 数据目录。
- 预览通过后才提交部署；本次同步不自动更新 R5S。
