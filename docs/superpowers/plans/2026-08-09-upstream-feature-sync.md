# 上游功能增量同步实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不删除 zashboardx 自有 Metrics 和部署能力的前提下，选择性同步官方通用修复和新功能。

**Architecture:** 以 `origin/master` 的 zashboardx 为主线，将官方提交按“可直接移植、手动适配、跳过”分类。所有 Metrics 数据仍由现有共享数据源提供，官方 UI 改动不得替换 Metrics API、时间桶和延迟条逻辑。

**Tech Stack:** Vue 3、TypeScript、Vite、pnpm、Vitest、Docker Compose、GitHub Actions。

## Global Constraints

- 保留 Metrics helper、SQLite 数据目录、双容器部署和中文文档。
- 保留 1h/6h/24h 图表、时间桶详情、近 30 次共享样本和一级近 10 次动画。
- 不直接合并删除 Metrics、时间桶、代理增强或 Docker 文件的官方提交。
- 预览通过后才部署 R5S。

### Task 1: 固化同步范围

**Files:**
- Create: `docs/superpowers/specs/2026-08-09-upstream-feature-sync-design.md`
- Create: `docs/superpowers/plans/2026-08-09-upstream-feature-sync.md`

- [x] **Step 1: 写入设计和实施边界**

写明保留项、可移植项、手动适配项、明确跳过项和验收标准。

- [x] **Step 2: 提交同步范围文档**

```bash
git add docs/superpowers/specs/2026-08-09-upstream-feature-sync-design.md docs/superpowers/plans/2026-08-09-upstream-feature-sync.md
git commit -m "docs: define safe upstream sync boundary"
```

### Task 2: 移植通用官方修复

**Files:**
- Modify: `src/assembly/version.ts`
- Modify: `src/assembly/connections/accessor.ts`
- Modify: `src/assembly/proxies/*.ts`
- Modify: `src/components/connections/*`
- Modify: `src/components/proxies/LatencyTag.vue`
- Modify: `src/components/proxies/ProxyGroup*.vue`
- Modify: `src/components/proxies/ProxyNode*.vue`

- [ ] **Step 1: 先加入独立逻辑测试**

验证官方修复不会改变 Metrics 样本接口、代理卡片的共享延迟记录和现有节点分类。

- [x] **Step 2: 移植 All 连接标签、版本/历史修复、LatencyTag 加载优化和可见性修复**

只复制对应函数和模板片段，不替换整个代理组件。

- [x] **Step 3: 运行针对性检查**

```bash
pnpm run type-check
pnpm metrics:test
```

### Task 3: 适配弹窗和视觉更新

**Files:**
- Modify: `src/components/common/DialogWrapper.vue`
- Modify: `src/assets/main.css`
- Modify: `src/assets/styles/**`
- Modify: `src/components/overview/**`

- [ ] **Step 1: 保留现有二级浮窗结构**

仅吸收官方视口高度、过渡和通用样式修复，不能覆盖移动端详情布局或 Metrics 图表容器。

- [x] **Step 2: 检查地球仪触摸控制和资源加载**

确保地球仪只使用浏览器 IndexedDB 缓存城市数据库，不把数据库写入 Docker 或 R5S 数据目录。

- [x] **Step 3: 运行构建**

```bash
pnpm run build
```

### Task 4: 清理依赖和保护部署边界

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `.github/workflows/*.yml`
- Modify: `Dockerfile*`
- Modify: `Caddyfile`
- Modify: `scripts/*.sh`

- [x] **Step 1: 保留 Metrics 镜像、环境变量和双容器网络**

验证 `METRICS_UPSTREAM`、Metrics 镜像、持久化挂载和 R5S 更新脚本仍存在。

- [ ] **Step 2: 收窄锁文件变更**

只保留地球仪依赖及必要的传递依赖，避免无关格式化噪音。

- [x] **Step 3: 运行部署回归测试**

```bash
pnpm metrics:test
sh scripts/__tests__/install-metrics.test.sh
sh scripts/__tests__/metrics-migration.test.sh
sh scripts/__tests__/metrics-upstream.test.sh
```

### Task 5: 预览和提交

**Files:**
- Modify: only files validated by Tasks 2-4.

- [ ] **Step 1: 启动本地预览**

```bash
pnpm run dev --host 0.0.0.0
```

- [ ] **Step 2: 检查桌面和手机代理页**

检查一级/二级延迟条、1h/6h/24h 图、时间桶、Metrics 状态、策略穿透、智能出站和地球仪。

- [ ] **Step 3: 提交同步分支**

```bash
git add .
git commit -m "feat: sync upstream features while preserving metrics"
```

- [ ] **Step 4: 只推送 GitHub，不部署 R5S**

等待用户确认预览后，再触发镜像构建和 R5S 更新。
