# 软考刷题 PWA

## 一键发布到 GitHub Pages

### 方式 A：推送即自动发布（推荐）
项目已内置工作流：
- 文件：`.github/workflows/deploy-pages.yml`
- 触发条件：推送到 `main` 分支，或手动触发 `workflow_dispatch`

首次使用请在仓库设置里确认：
1. `Settings -> Pages -> Source` 选择 `GitHub Actions`
2. 推送代码到 `main`
3. 等待 Actions 成功后访问 Pages 地址

### 方式 B：本地命令一键发布
```bash
npm run deploy
```
该命令会自动构建并把 `dist` 发布到 `gh-pages` 分支。

## 本地开发
```bash
npm install
npm run dev -- --host
```

## iPhone 离线使用
1. 用 Safari 打开 GitHub Pages HTTPS 地址并完整加载一次。
2. Safari 分享按钮 -> `添加到主屏幕`。
3. 从主屏幕打开，断网可继续使用缓存题库。

## 关键脚本
- `npm run build`：按 Pages 路径规则构建（`--base=./`）
- `npm run build:pages`：同上
- `npm run deploy`：本地一键发布到 `gh-pages` 分支
