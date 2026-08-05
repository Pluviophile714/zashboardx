# 可选 Metrics 版安装

普通 Docker 单容器版仍是默认选择：

```sh
docker run -d -p 80:80 ghcr.io/pluviophile714/zashboardx:latest
```

若需要持久保存节点延迟历史和可用率数据，可使用 Metrics 版。安装脚本会
启动两个内部服务：

- `zashboardx`：面向浏览器的面板，也是唯一对外开放端口的服务。
- `zashboardx-metrics`：采集器和 SQLite 历史数据存储，不开放宿主机端口。

安装脚本会创建私有 Compose 网络，并将历史数据保存到
`${XDG_DATA_HOME:-$HOME/.local/share}/zashboardx-metrics/metrics-data`。

## 环境要求

- 已安装 Docker Engine 和 Docker Compose v2 插件。
- 小后端容器可访问的 Mihomo `external-controller` 地址，例如
  `http://192.168.1.1:9090`。
- 若 Mihomo 已启用认证，还需要控制器密钥。

除非 Mihomo 运行在同一个小后端容器内，否则控制器地址不要填
`127.0.0.1`。普通 Docker bridge 网络请使用路由器或宿主机的局域网地址。
控制器应仅限局域网访问，不要直接暴露到互联网。

## 安装

在 Docker 主机终端运行：

```sh
curl -fsSL https://raw.githubusercontent.com/Pluviophile714/zashboardx/master/scripts/install-metrics.sh | sh
```

脚本会询问面板端口、Mihomo 控制器地址和可选密钥。密钥输入时不会回显，
只会保存到本机权限受限的 `.env` 文件。无需编辑 YAML，也不会为小后端
额外开放浏览器端口。

若脚本发现一个可识别的普通 ZashboardX 容器，且它使用官方 ZashboardX 或
上游镜像，会提供迁移选项。确认迁移后会保留原来的面板端口和重启策略，保存
`inspect` 备份；新面板无法启动时会恢复旧容器。带有自定义挂载、网络或未知
镜像的容器永远不会被自动接管。

启动后打开脚本打印的面板地址。Metrics 历史会从首次成功采集后开始积累，
不会补录过去的数据。即使小后端无法连接 Mihomo，面板仍可打开；健康接口会
报告该连接问题。

## 更新

```sh
curl -fsSL https://raw.githubusercontent.com/Pluviophile714/zashboardx/master/scripts/update-metrics.sh | sh
```

更新会拉取两个镜像并重建受管理服务，不会删除 `metrics-data`。

## 关闭 Metrics 版

若要切回普通面板，同时保留已采集的历史数据：

```sh
curl -fsSL https://raw.githubusercontent.com/Pluviophile714/zashboardx/master/scripts/disable-metrics.sh | sh
```

历史数据会保留，之后仍可再次启用 Metrics 版。永久删除需要明确确认：

```sh
curl -fsSL https://raw.githubusercontent.com/Pluviophile714/zashboardx/master/scripts/disable-metrics.sh | sh -s -- --purge-data
```

## 常见问题

- **端口已被占用：** 可识别的官方普通面板在确认后可以迁移。其他容器请改用
  其他端口或自行停止，脚本不会替换未识别的容器。
- **无法连接 Mihomo：** 确认临时容器也能访问控制器地址，且控制器密钥正确。
  可重新运行安装脚本更新已保存的地址或密钥，不会删除历史数据。
- **还没有历史数据：** 等待至少一个采集周期。新建数据库没有过去的样本。
