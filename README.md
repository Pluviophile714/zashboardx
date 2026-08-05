# zashboard

<p align="center">
  <img src="./readme/pc.png" height="300">
  <img src="./readme/mobile.png" height="300">
</p>

## **环境要求**

支持以下浏览器：

- Chrome 111（2023 年 3 月发布）
- Firefox 128（2024 年 7 月发布）
- Safari 16.4（2023 年 3 月发布）
- 不支持越狱后的 iOS 16.4。

## **在线体验**

可通过以下链接访问在线版 zashboard：

- [在线版 zashboard](http://board.zash.run.place)

## **下载**

可在此下载 zashboard 文件：

> 所有构建版本均支持 sing-box 原生 API。

正式版：

- [dist.zip (7.81 MB)](https://github.com/Zephyruso/zashboard/releases/latest/download/dist.zip) - 含完整字体，字体加载体验更好。
- [dist-no-fonts.zip (1.44 MB)](https://github.com/Zephyruso/zashboard/releases/latest/download/dist-no-fonts.zip) - 不含字体，仅使用系统字体。
- [dist-cdn-fonts.zip (1.44 MB)](https://github.com/Zephyruso/zashboard/releases/latest/download/dist-cdn-fonts.zip) - 从 unpkg.com 加载字体；若无法连接 unpkg.com，**页面加载可能变慢**。
- [dist-firasans-only.zip (1.67 MB)](https://github.com/Zephyruso/zashboard/releases/latest/download/dist-firasans-only.zip) - 仅含 FiraSans 字体。
- [dist-misans-only.zip (3.54 MB)](https://github.com/Zephyruso/zashboard/releases/latest/download/dist-misans-only.zip) - 仅含 MiSans 字体。
- [dist-pingfang-only.zip (3.25 MB)](https://github.com/Zephyruso/zashboard/releases/latest/download/dist-pingfang-only.zip) - 仅含 PingFang 字体。
- [dist-sarasa-only.zip (3.67 MB)](https://github.com/Zephyruso/zashboard/releases/latest/download/dist-sarasa-only.zip) - 仅含 Sarasa 字体。

开发版：

- [gh-pages.zip (7.81 MB)](https://github.com/Zephyruso/zashboard/archive/refs/heads/gh-pages.zip)
- [gh-pages-no-fonts.zip (1.44 MB)](https://github.com/Zephyruso/zashboard/archive/refs/heads/gh-pages-no-fonts.zip)
- [gh-pages-cdn-fonts.zip (1.44 MB)](https://github.com/Zephyruso/zashboard/archive/refs/heads/gh-pages-cdn-fonts.zip)
- [gh-pages-firasans-only.zip (1.67 MB)](https://github.com/Zephyruso/zashboard/archive/refs/heads/gh-pages-firasans-only.zip)
- [gh-pages-misans-only.zip (3.54 MB)](https://github.com/Zephyruso/zashboard/archive/refs/heads/gh-pages-misans-only.zip)
- [gh-pages-pingfang-only.zip (3.25 MB)](https://github.com/Zephyruso/zashboard/archive/refs/heads/gh-pages-pingfang-only.zip)
- [gh-pages-sarasa-only.zip (3.67 MB)](https://github.com/Zephyruso/zashboard/archive/refs/heads/gh-pages-sarasa-only.zip)

## **Docker 部署**

使用 Docker 运行普通版：

```
docker run -d -p 80:80 ghcr.io/pluviophile714/zashboardx:latest
```

## 可选 Metrics 版

上方的普通单容器版仍是推荐的轻量选择。若需要持久保存节点延迟历史和
可用率数据，可使用可选的双容器 Metrics 版：

- [Metrics 安装说明](./docs/metrics-install.md)
- [自定义部署迁移说明](./docs/metrics-migration.md)

## 提示

1. 连接表格可被鼠标左键拖动，右键可复制单元格内容。
2. 右键点击节点/节点组卡片可对节点/节点组进行测速。
3. 节点组按 GLOBAL 组中的节点顺序排序。在 Mihomo 中遵循配置文件顺序；在 sing-box 中，`route.final` 排在第一位，其余遵循配置文件顺序。可通过覆盖 GLOBAL 组指定自定义顺序。
4. 面板支持 PWA（渐进式 Web 应用），可在移动设备上通过“添加到主屏幕”获得类原生应用体验。
5. 面板的更新按钮和自动更新功能需要正确配置核心的 UI 下载路径（[mihomo](https://wiki.metacubex.one/config/general/#_9) | [sing-box](https://sing-box.sagernet.org/configuration/experimental/clash-api/#external_ui_download_url)），否则点击更新可能会更新为核心默认面板。
6. 可通过 Capacitor 打包 Android 应用，参见 [Android 应用说明](./readme/android-app.md)。

## URL 参数格式

#### 基本示例

http://host:port/#/setup?hostname=ipordomain&port=9090&secret=123456

1. **`http` / `https`**
   - 指定协议（`http` 或 `https`）。
   - 默认值：当前页面协议。

2. **`hostname`**
   - Clash API 的 IP 地址或域名。

3. **`port`**
   - Clash API 端口。

4. **`secondaryPath`**
   - 附加在基础 URL 后的可选路径。
   - 默认值：空字符串。

5. **`secret`**
   - 用于认证的密钥。

6. **`disableUpgradeCore`**
   - 设为 `1` 时隐藏升级核心按钮。

7. **`disableTunMode`**
   - 设为 `1` 时隐藏 TUN 开关。

8. **`type`**
   - 选择后端 API：`clash`（Clash REST/WS）或 `singbox`（sing-box 原生 API）。
   - 默认值：`clash`。

### 本项目出于兴趣开发，不接受捐赠。如有捐赠意愿，请考虑支持 [UNICEF](https://www.unicef.org/)。
