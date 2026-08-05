# 迁移现有部署

## 官方普通版部署

当普通容器来自 `ghcr.io/pluviophile714/zashboardx:latest` 或
`ghcr.io/zephyruso/zashboard:latest`、使用默认 bridge 网络、没有自定义 bind
挂载且公开面板 `80/tcp` 端口时，Metrics 安装脚本可以迁移该容器。运行
[Metrics 安装命令](./metrics-install.md)，在提示时确认，并验证脚本打印的
面板地址。脚本会在受管理数据目录保留 `inspect` 备份；新面板未就绪时会恢复
旧容器。

## 自定义部署

Metrics 安装脚本会自动保护未识别的容器。这是刻意的安全限制：自定义的
`docker run` 或 Compose 部署可能包含挂载、网络设置、证书或其他服务，脚本
无法安全地重建这些配置。

## 查看现有容器

```sh
docker ps --format '{{.Names}} {{.Image}} {{.Ports}}'
docker inspect <your-container-name>
```

修改前请记录自定义端口、卷、网络和重启策略。

## 手动迁移

1. 自行停止自定义面板容器。
2. 运行 [Metrics 安装命令](./metrics-install.md)，并选择相同的面板端口。
3. 删除任何内容前，先验证面板地址和 `/api/metrics/health`。
4. 仅在新面板正常工作后再删除旧容器。

新的 Metrics 栈使用自己的受管理数据目录，不会复用任意旧容器的文件系统。
若旧面板使用自定义配置或 TLS 反向代理，请保留该配置并将其转发到新面板端口。

## 网络说明

Mihomo 地址是控制器 API 地址，不是 Mihomo 二进制文件路径。例如，监听在路由器
局域网地址上的控制器可填写 `http://192.168.1.1:9090`。它必须能被 Docker
bridge 网络中的容器访问。仅绑定在宿主机 `127.0.0.1` 上的控制器通常无法被
小后端访问。

不要将控制器密钥粘贴到公开 Issue、截图或提交到仓库的 Compose 文件中。
