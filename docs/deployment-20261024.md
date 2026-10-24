# 线上发布与正式数据核对 · 2026-10-24

## 本次结果

- 正式地址：http://tea.xense.com.cn/ 。继续使用线上原登录密码。
- 发布内容：本轮界面还原、设置固定保存反馈、自填茶名卡片常驻及推荐前后标题切换。
- 静态根目录：/var/www/tea。只发布 web/dist，保留旧哈希资源以兼容已打开页面。
- 后端源码 SHA-256 与本地相同，无需替换；仅增加 AMAP_KEY，保留原密码哈希和 APP_ENCRYPTION_KEY。
- 高德天气从 ECS 实测成功。API 仅重启已核实的 Tea 进程，现 PID 252528。

## 正式数据

本次重新由 utils/data.js 的 getDefaultData() 生成数据，并经过 parse_legacy_export 规范化核对。它与 2026-09-30 指定的正式输入一致。线上九个业务区的规范化 SHA-256 全部与输入相同，因此没有重复覆盖导入。

茶库 89 款，完整知识画像 86 份，历史、库存、临时回避和个人覆盖均为 0；这些空项来自正式源数据本身。线上 revision 保持 1，SQLite integrity_check=ok。部署前后 revision 和完整 payload 均相同。

没有迁移手机缓存、微信云端后续记录，也没有上传本地试用历史、档案或 AI Key。正式站 AI 配置仍未设置，需要在正式站填写服务商端点、模型和 Key。

## 备份与发布指纹

一致性备份目录：`/home/yang/webapp/tea-data/backups/release-20261024-1792827152`

包括 SQLite backup API 快照、图片（原目录存在时）、原 server.env、旧前端和服务端源码；目录为私有权限，环境文件 0600。未清理旧备份。回退时优先仅回退 frontend 和 server.env；数据库未变，无需覆盖正式数据库。

发布包 SHA-256：`7dc25b37276f9bae7a273b0d030fa121a4682fc0ddbae5a655cee3dab5ed2fc6`

线上 JS：`/assets/index-6yJLM0Ku.js`；CSS：`/assets/index-CRrbtXU6.css`。

本次发布构建基于 a2367b4 之后的界面修复，现随本轮代码提交归档；本地发布包与部署脚本保存在忽略目录 server/.test-runtime/release-20261024/，线上暂存目录 /home/yang/webapp/tea-release-20261024/。

## 验证

- web build、web test、根 npm run verify 和 git diff --check 均通过；子 agent 独立复核没有发现阻塞。
- ECS 首页 200，API 直连及 Nginx 代理 204；Nginx、old-spelling.service 均 active。
- 当前电脑经公网读取首页及其引用的 JS/CSS，逐字节与本地构建相同；公网 API 204。
- 浏览器自动化读取线上标签超时，未完成登录后线上可视验收，不能把 HTTP 校验等同于浏览器功能验收。
- 继续采用既有 HTTP 方案，未新增 HTTPS、自启动或自动备份。iPhone PWA 安装、离线真机验收仍未完成。

自动审批曾拒绝上传整份本地 .env；改为生成并校验仅含 AMAP_KEY 的独立配置后获准上传。没有上传本地密码哈希或加密密钥。
