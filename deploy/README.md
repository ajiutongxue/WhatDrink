# Tea PWA ECS HTTP 在线试用部署

更新日期：2026-09-30。本文件记录用户确认后的实际部署方案，与 `docs/pwa-implementation-plan.md` 对应：复用现有 Nginx、纯 HTTP 在线试用、API 暂由 `yang` 的后台进程运行、用户手动备份。

## 当前路径与运行方式

| 项目 | 当前值 |
| --- | --- |
| ECS 实例 | `i-2zecp7npm2h4097lvmng` |
| 执行用户 | `yang`，管理员操作在命令内加 `sudo` |
| 访问地址 | `http://tea.xense.com.cn`，未配置 HTTPS 证书或跳转 |
| 项目根目录 | `/home/yang/webapp/tea` |
| 静态目录 | `/var/www/tea` |
| API | 单进程 Uvicorn，监听 `127.0.0.1:8000`，由 `nohup` 启动 |
| 数据库 | `/home/yang/webapp/tea-data/tea.sqlite3` |
| 图片目录 | `/home/yang/webapp/tea-data/tea.uploads/` |
| 私有配置 | `/home/yang/webapp/tea/server/.env` |
| 当前 API 日志 | `/tmp/tea-pwa-api.log` |

已有 Nginx 提供静态页面，并把同源 `/api/` 代理到 Uvicorn。Nginx worker 无法穿过私有 `/home/yang`，因此公开构建文件单独放到 `/var/www/tea`；数据目录保持 0700、`.env` 保持 0600，属主为 `yang`。不使用 Caddy，不增加 Docker、数据库服务或备份服务。

远程命令使用 Workbench 默认文本输出：

```powershell
workbench exec -i i-2zecp7npm2h4097lvmng -u yang -c "这里写具体命令"
```

保持现有服务运行；涉及删除文件、修改系统配置、安装软件、重启服务的操作，先展示完整命令并取得用户确认。以下部署命令是参考，不应重复创建已存在的站点链接或重复启动 API。

## HTTP 应用配置

服务器已有 Python venv 和依赖，使用 `/home/yang/webapp/tea/server/.venv/bin/python`。安装依赖时曾经用户确认，仅该次 pip 命令使用阿里云镜像，没有修改全局 pip 配置。Certbot 相关软件曾在准备阶段安装，但本次未申请证书、未执行 Certbot 的站点配置或 HTTPS 跳转。

`server/.env` 中当前部署相关值：

```dotenv
APP_ENV=development
COOKIE_SECURE=false
ALLOWED_ORIGIN=http://tea.xense.com.cn
DATA_DIR=/home/yang/webapp/tea-data
```

同时保留私有的 `APP_PASSWORD_HASH`、`APP_ENCRYPTION_KEY`，天气需要时配置 `AMAP_KEY`。密码仅通过隐藏输入生成 scrypt 哈希；AI Key 按现有方式加密存入数据库，浏览器读取不到 Key 明文。修改配置前先保存私有副本；本次保存为 `server/.env.bak.http-trial-20260929-01`，不输出密钥、不提交 `.env` 到 Git。

当前代码只允许在 `APP_ENV=development` 时关闭 Cookie 的 `Secure` 属性，因此 HTTP 试用使用以上配置。HTTP 链路不加密登录密码和会话；`HttpOnly`、`SameSite`、服务端密码哈希和 AI Key 加密仍保留。这些配置不代表已经启用 HTTPS 生产部署。

## 静态文件与 Nginx

在本地 `web/` 执行 `npm run build`，将 `web/dist/` 的内容打成 ZIP，然后以 `yang` 上传、解压并复制到公开目录。本次部署使用的 ZIP 名为 `tea-pwa-dist-20260929.zip`，上传命令如下；本地文件路径以实际构建包为准：

```powershell
workbench upload "C:\Users\yang_\AppData\Local\Temp\tea-pwa-dist-20260929.zip" /tmp/ --instance-id i-2zecp7npm2h4097lvmng --user-name yang
```

首次部署时，经用户确认执行以下命令；后续发布应先检查目标文件和已有链接，保留所需的旧版本副本：

```powershell
workbench exec -i i-2zecp7npm2h4097lvmng -u yang -c "sudo /usr/bin/install -d -o yang -g www-data -m 0755 /var/www/tea && mkdir -p /tmp/tea-pwa-dist-20260929 && python3 -m zipfile -e /tmp/tea-pwa-dist-20260929.zip /tmp/tea-pwa-dist-20260929 && cp -a /tmp/tea-pwa-dist-20260929/. /var/www/tea/ && sudo /usr/bin/install -o root -g root -m 0644 /home/yang/webapp/tea/deploy/tea-pwa.nginx.conf /etc/nginx/sites-available/tea.xense.com.cn && sudo /usr/bin/ln -s /etc/nginx/sites-available/tea.xense.com.cn /etc/nginx/sites-enabled/tea.xense.com.cn && sudo /usr/sbin/nginx -t && sudo /usr/bin/systemctl reload nginx"
```

Tea 站点只监听 80 端口，没有 HTTPS 跳转。Nginx 配置检查通过后平滑 reload，现有拼写站点和服务保持运行。

## API 启动与状态检查

`tea-pwa.service`、`tea-pwa-backup.service` 和 `tea-pwa-backup.timer` 已安装到 systemd 目录，但当前 API 单元未启用，备份 timer 未启用、未启动。既有免密 sudo 规则只允许 API 和 backup timer 一起启用；用户选择暂不做自动备份，所以本次另行确认以 `nohup` 启动 API。

启动前先检查端口；8000 已监听时核对现有进程，不再启动第二个实例：

```powershell
workbench exec -i i-2zecp7npm2h4097lvmng -u yang -c "ss -ltn '( sport = :8000 )'"
```

确认端口空闲且需要启动时：

```powershell
workbench exec -i i-2zecp7npm2h4097lvmng -u yang -c "nohup /home/yang/webapp/tea/server/.venv/bin/python -m uvicorn server.app:app --app-dir /home/yang/webapp/tea --host 127.0.0.1 --port 8000 --workers 1 >/tmp/tea-pwa-api.log 2>&1 </dev/null &"
```

该进程没有开机自启或退出后自动重启，ECS 重启或进程退出后需手动启动。后续若改由 systemd 托管，需另行确认 API 单独启动的 sudo 授权及进程切换，不能为此启用备份 timer。

部署后的只读检查：

```powershell
workbench exec -i i-2zecp7npm2h4097lvmng -u yang -c "curl -i http://127.0.0.1:8000/api/healthz && curl -i -H 'Host: tea.xense.com.cn' http://127.0.0.1/api/healthz && curl -I http://tea.xense.com.cn/"
workbench exec -i i-2zecp7npm2h4097lvmng -u yang -c "systemctl is-active nginx old-spelling.service; systemctl is-active tea-pwa-backup.timer"
```

部署时 ECS 侧检查：域名首页 200，API 直连及 Nginx 代理健康接口均 204；Nginx 和原拼写服务 active；backup timer inactive。健康接口的 204 没有响应正文，属于正常结果。真实登录、天气/AI 凭据调用、图片和其他业务路径仍需用户在线试用核对。

普通公网 HTTP 无法注册 Service Worker，本次不能验收离线冷启动或把 iPhone 主屏添加入口当作完整 PWA 安装验收。浏览器定位也可能受安全上下文限制，推荐页可使用档案城市。离线代码保留，安全上下文下的安装/离线实机验收暂缓。

## 手动备份与恢复

用户定期手动把数据库副本复制到其他位置，自行决定周期和保留数量。当前不安排每日备份，不启用 systemd backup timer，不设置自动 30 天保留任务。

复制数据库前应使用 SQLite backup API 生成一致性快照，或在停止 API 写入并关闭数据库连接后复制；不要把正在写入的数据库文件直接复制当作可靠快照。仅保存数据库可以恢复结构化状态，完整恢复还需要 `tea.uploads/` 和对应的服务端 `.env`；缺少原 `APP_ENCRYPTION_KEY` 就无法恢复已加密的 AI Key。私有环境文件应安全保管。

已有 `server.backup` 工具仍可按需手动使用，单次生成 SQLite 一致性快照、图片和私有环境文件，并输出备份目录：

```powershell
workbench exec -i i-2zecp7npm2h4097lvmng -u yang -c "cd /home/yang/webapp/tea && server/.venv/bin/python -m server.backup create"
workbench exec -i i-2zecp7npm2h4097lvmng -u yang -c "cd /home/yang/webapp/tea && server/.venv/bin/python -m server.backup restore-drill /这里填实际备份目录"
```

工具现有默认目录为 `tea-data/backups/daily/`，备份名带 `tea-pwa-daily-`，每次手动 `create` 仍会清理其中超过 30 天的匹配备份；这个命名和清理行为不代表每日自动执行。`restore-drill` 会在临时目录核对数据库、图片、环境及 API 启动，结束后删除临时副本。上述工具存在清理/删除行为，执行前遵守完整命令确认要求；本次文档调整未运行它们。

正式旧数据导入、PWA JSON 导入和重置之前的 SQLite 安全快照继续保留，与日常自动备份停用无关。旧小程序导入始终使用独立 `server.legacy_import` 工具：dry-run 不写数据库；`--apply` 先备份，再在单事务内导入，失败全部回滚；旧 `imageFileIDs` 只报告并忽略，原始 JSON 不修改。

## 在线试用与正式切换

本次完成的是 HTTP 在线试用部署，以及按用户指定导入原小程序随代码发布的正式数据（见下方记录）。手机缓存或微信云端中的后续个人记录没有作为本次输入；停止小程序写入仍需用户执行。原计划的真实 iPhone 主屏 PWA 安装及离线验收仍待完成；本次首页和健康接口通过不能替代这些验收。

### 线上数据核对（2026-09-30）

导入前通过 Workbench 以 `yang` 只读检查实际数据库：`app_state.revision=0`，茶叶 89 款，历史、库存、临时回避与知识覆盖均为 0，持久化 `knowledgeBase` 为空，没有旧库迁移标记，也未配置 AI Key。知识目录同时随代码内置，不能仅凭历史和库存为空推断原小程序的正式源数据缺失。

用户随后指定原小程序使用的源码数据就是本次正式数据。已直接调用原 `utils/data.js` 的 `getDefaultData()` 生成迁移输入，使用独立 `server.legacy_import` 完成两端 dry-run、导入前 SQLite 快照和单事务导入。导入后 `revision=1`，89 款茶与 86 份完整知识画像持久化；九个数据区全部与源数据一致。源数据本身的历史、库存、临时回避、个人覆盖为空，没有 AI Key；没有将包装观察材料生成库存，也没有读取手机缓存或云端个人数据。

导入前快照：`/home/yang/webapp/tea-data/backups/tea-before-change-1790759163-94c091aa.sqlite3`。当前库与快照的 SQLite 完整性均为 `ok`，Tea 直连和 Nginx 代理健康接口均返回 204，Nginx 与原拼写服务保持 active；此次无需重启服务。详细证据见 `docs/production-data-import-20260930.md`。
