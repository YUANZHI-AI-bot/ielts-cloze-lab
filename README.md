# IELTS Cloze Lab

一个无需账号、可离线使用的雅思词汇填空与拼写练习网页。页面本身不依赖 ChatGPT 或任何后端；将 `dist/` 目录部署到任意静态主机，即可在电脑、平板和手机浏览器中打开。

## 公开访问

本仓库通过 GitHub Pages 自动发布：每次推送到 `main`，工作流都会将 `dist/` 部署为静态网站。GitHub Pages 的默认链接适合快速公开访问；若所在网络无法稳定访问该域名，请绑定自己的域名，或采用下方的 Caddy 自托管方案。

> 学习进度、收藏和错题本可通过网页内的“云端词库”保存。首次使用时设置同步口令，系统生成同步 ID；在另一台设备输入相同的 ID 与口令，即可合并并持续同步词库。口令不会写入数据库或浏览器本地存储。

## 自托管（开源方案）

项目包含基于开源 [Caddy](https://caddyserver.com/) 的镜像配置。部署在有公网 IP 和域名的服务器后，Caddy 可以自动申请并续期 HTTPS 证书。

```bash
docker build -t ielts-cloze-lab .
docker run -d --name ielts-cloze-lab -p 80:80 ielts-cloze-lab
```

生产环境建议把 `Caddyfile` 中的 `:80` 改为你自己的域名，并开放 80/443 端口。这样站点不再依赖 `chatgpt.site` 域名。

## 目录

- `dist/`：前端文件和云端同步 Worker。
- `drizzle/`：云端词库的 D1 数据库迁移。
- `.github/workflows/deploy-pages.yml`：GitHub Pages 自动部署。
- `Caddyfile`、`Dockerfile`：开源 Caddy 的自托管配置。

本项目采用 [MIT License](LICENSE)。
