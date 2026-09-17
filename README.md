# IELTS Cloze Lab

一个无需账号的雅思词汇主动拼写网页。课程包含《雅思词汇真经》22 章、3,672 个真实词条和 194 个学习组。将 `dist/` 部署到任意静态主机，即可在电脑、平板和手机浏览器中打开。

主要功能：

- 22 章课程目录、章节进度和每组最多 20 词的固定练习队列。
- 中文释义提示、音标提示、系统英文朗读、机械键盘音。
- 第一次拼错不显示答案；第二次才揭示，必须亲手纠正后进入下一题。
- 错题、收藏、到期复习、连续答对效果与学习组结算。
- TXT、CSV、TSV 和 Excel 两列词表导入。

## 公开访问

本仓库通过 GitHub Pages 自动发布：每次推送到 `main`，工作流都会将 `dist/` 部署为静态网站。GitHub Pages 的默认链接适合快速公开访问；若所在网络无法稳定访问该域名，请绑定自己的域名，或采用下方的 Caddy 自托管方案。

> 公开课程内容对所有设备一致。无账号时无法安全区分不同使用者，因此个人进度、错题、收藏和自定义词表明确保存在当前浏览器，避免陌生访客互相覆盖。

## 自托管（开源方案）

项目包含基于开源 [Caddy](https://caddyserver.com/) 的镜像配置。部署在有公网 IP 和域名的服务器后，Caddy 可以自动申请并续期 HTTPS 证书。

```bash
docker build -t ielts-cloze-lab .
docker run -d --name ielts-cloze-lab -p 80:80 ielts-cloze-lab
```

生产环境建议把 `Caddyfile` 中的 `:80` 改为你自己的域名，并开放 80/443 端口。这样站点不再依赖 `chatgpt.site` 域名。

## 目录

- `dist/`：可直接部署的前端文件和课程 JSON。
- `dist/data/catalog.json`：发布用的 22 章词汇目录。
- `dist/data/catalog-qa.json`：数据数量、编号、空值与异常字符校验结果。
- `tools/`：从用户提供 PDF 提取并校验课程数据的可重复脚本。
- `drizzle/`：云端词库的 D1 数据库迁移。
- `.github/workflows/deploy-pages.yml`：GitHub Pages 自动部署。
- `Caddyfile`、`Dockerfile`：开源 Caddy 的自托管配置。

本项目采用 [MIT License](LICENSE)。
