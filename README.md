# 同页 · Our Shared Pages

两个人的私人生活收藏。炭灰、暖白、橄榄与陶土色，中文衬线标题，自托管字体；在电脑和手机上收藏电影、书籍与发生在它们旁边的小故事。

## 已实现（v3）

- 全站深色私人影院风格；两座藏馆均有「我们／两位成员」三视角，桌面六列、平板四列、手机双列。
- 个人清单是唯一进度来源。书籍支持在读、想读、已读；电影支持想看、已看。只有自己能增改自己的记录。
- 「我们」仅查询双方状态相同的交集。状态不同或只有一人收藏时，作品仍保留在各自清单。
- 新增入口只在自己的视角。同名作品优先复用同一个 ID，服务端再次查重；同名不同作品可明确另建。
- 个人开始／完成日期可留空；不会用录入日期冒充历史日期。时光轴分为我们／两位成员，共同分支只呈现明确的共同确认和回忆。
- 挑战需主动加入、双方均完成且确认「确实一起完成」后才计数。共同确认使用独立可空日期，不更改任何人的状态。
- 站内推荐：留言、修改、撤回、重发、暂放；接受只加入接收者自己的想读／想看，已有清单记录会使推荐收起。
- 各自评分、短评、个人置顶；公共作品资料、外链、标签、封面上传与粘贴；搜索和排序条件保存在 URL。
- 移除个人记录只影响本人，回收站可恢复；对方记录、公共资料与回忆保留。状态修正实时重算交集与挑战。
- 两个私密账户、昵称头像和修改密码、关闭注册；私密图片鉴权、版本冲突对照、网络失败保留草稿。
- v3 内容与媒体 ZIP 导出、Docker Compose、Caddy、完整快照备份与恢复工具。

## 本地预览

使用 **Node.js 24 LTS**。SQLite 包含原生依赖，切换 Node 主版本后重新执行 `npm ci`。

```sh
npm ci
npm run demo
npm run dev
```

打开 <http://localhost:3000>，点击「先逛逛演示空间」。演示内容和随机账户凭据仅保存在 `.local/demo-v3` 与被忽略的 `.env.local`，重复执行不会清空演示数据。预览仅监听本机；正式生产模式不会开放演示登录。

示例人物、评价、回忆均为虚构，示例封面是原创排版插图。演示数据不会进入 Docker 镜像。正式环境默认只有空收藏和两个空挑战。

## Linux + Docker 正式部署

需要 Docker Engine、Compose 插件，以及指向服务器的域名。服务器开放 80、443；应用端口仅在容器网络中开放。单机运行一个应用实例，不横向扩容 SQLite。

1. 将代码复制到服务器，例如 `/opt/tongye`。复制 `.env.example` 为 `.env`，填写：

```dotenv
DOMAIN=your-domain.example
BETTER_AUTH_SECRET=替换成至少32字符的随机值
BETTER_AUTH_URL=https://your-domain.example
DATA_DIR=./data
ENABLE_DEMO_LOGIN=false
```

用 `openssl rand -base64 48` 生成密钥。Compose 会按 `DOMAIN` 设置认证地址。`.env.local` 只用于本地演示；本地改用真实账户时，先将演示的 `.env.local` 移走，以免优先加载演示配置。

2. 准备持久化目录并构建：

```sh
mkdir -p data backups
sudo chown 1001:1001 data backups
docker compose build
```

3. 初始化你们的两个账户（每次输入邮箱、昵称、密码，密码输入隐藏）：

```sh
docker compose run --rm --no-deps app npm run account:create
docker compose run --rm --no-deps app npm run account:create
docker compose up -d
docker compose ps
```

最多创建两位成员，不依赖邮件服务。数据库迁移会自动执行。Caddy 在 DNS 和端口就绪后自动申请证书。证书保存在 `caddy_data` 卷中。

```sh
docker compose logs --tail=100 app
docker compose logs --tail=100 caddy
docker compose exec app npm run account:reset
```

最后一条命令用于忘记密码后的重置，同时退出该账户的旧会话。已登录用户也能在空间设置中修改密码。

如需调整主机存储位置，在 `.env` 中设置绝对路径 `HOST_DATA_DIR`、`HOST_BACKUP_DIR`，并将这两个目录的所有者设为 UID/GID `1001:1001`。自定义存储目录应放在源码目录之外，避免被加入源码或 Docker 构建上下文；默认数据、备份和恢复目录都已排除。

## 备份、恢复和升级

### 每日备份

```sh
docker compose exec -T app npm run backup
```

备份使用 SQLite 在线快照，随后打包该快照引用的所有原图和缩略图。文件附 SHA-256 清单，成功后才替换最终 ZIP；最多保留最近 **7 份**。备份包含账户和会话，按私人资料保管，另存一份到服务器之外。

将 `deploy/backup.cron` 的项目路径换成实际路径，用 `crontab -e` 安装。计划每天 03:15 执行，采用服务器时区；希望使用北京时间时将服务器时区设置为 `Asia/Shanghai`。备份日志写入 `backups/backup.log`。

### 恢复到新目录

以下例子从现有备份恢复到 `./restore-staging/recovered`，原数据目录保留。将 ZIP 文件名替换为真实备份文件名。

```sh
mkdir -p restore-staging
sudo chown 1001:1001 restore-staging
docker compose stop app
docker compose run --rm --no-deps \
  -v "$PWD/restore-staging:/restore" app \
  npm run restore -- \
  --file /app/backups/tongye-实际日期.zip \
  --to /restore/recovered
```

恢复会检查清单、每个文件的哈希、数据库完整性、外键和图片引用；目标目录已经存在时拒绝覆盖。成功后把 `.env` 中的 `HOST_DATA_DIR` 设为该恢复目录的**绝对路径**，再运行：

```sh
docker compose up -d app
```

登录后检查电影、书籍、短评和回忆图片。离线环境也可以使用 Node.js 24 执行 `npm run restore -- --file ./backups/备份.zip --to ./data-restored`。

设置页的「导出我们的收藏」生成适合阅读和迁移的 JSON + 媒体包，**不含密码和会话**；它与服务器完整备份不同，恢复命令只接受服务器备份格式。

内容导出格式为 `version: 3`。`personalRecords` 包含状态、个人开始／完成日期、置顶、修订和移除时间；`togetherConfirmations` 保存独立共同确认及撤销状态。`entries[].sharedStatus` 仅是交集的计算结果。导出同时包含作品、推荐历史、短评、回忆及挑战关系，日期空值表示未记。

### 升级和回退

升级前先备份，并记下当前源码版本和镜像 ID：`docker compose images`。可将当前镜像另加一个标签，例如 `docker tag 当前镜像ID tongye:before-upgrade`。保留当前密钥和 `.env`。

更新源码后执行 `docker compose build`、`docker compose up -d`。迁移只会执行一次，已应用的 SQL 文件不得改写。

v3 追加 `0004_personal_lists.sql`，不修改旧迁移。旧共同表仅为备份兼容保留，不再参与新版本读写。

可选的内容重置工具用于需要重新建立收藏的场景，正常升级不要执行。先停写并备份，再运行以下工具准备**全新目录**。它保留源数据库的当前密码、成员 ID、昵称、头像和网站设置；清空书影音、短评、推荐、回忆和挑战参与，挑战进度归零，会话失效。源目录不会被改写，目标目录已存在时拒绝操作。

```sh
node --import tsx scripts/reset-space.ts --from /path/to/old-data --to /path/to/new-data --confirm reset-content-keep-accounts
npm run test:upgrade -- --file ./backups/备份.zip --to ./.local/upgrade-check
```

不要将本机演示数据库用于正式账户。完整备份和旧数据目录必须与旧镜像一起保留。

需要回退时，停止应用，恢复升级前的备份到新目录，切换 `HOST_DATA_DIR`，再使用对应旧源码重建，或在 Compose override 中为 `app` 指定保存的旧镜像并使用 `docker compose up -d --no-build app`。数据库和应用版本必须一起回退。

## 开发与验收

```sh
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
docker build -t tongye:local .
npm run test:container
```

- Vitest 验证双方全部状态组合、严格交集、挑战计数、回收恢复、推荐生命周期、权限、版本冲突、旧数据库迁移和新旧备份恢复。
- Playwright 使用两个真实登录会话验证清单复用、推荐处理、共同确认、私人图片、导出、URL 条件、键盘操作、上传失败、断网重试和并发编辑；检查 390 / 768 / 1440px 的长姓名、长标题、便笺与双列封面。
- 容器测试使用端口 3012、3013 和自己创建的临时卷，验证生产登录、双账户上限、上传、容器重启，以及将备份恢复到新目录后通过另一个容器读取；结束时清理测试容器和卷。
- 测试使用 `.local/e2e` 与独立 `.next-e2e`，不使用演示或正式数据库。

## 目录与扩展

| 目录 / 文件 | 职责 |
| --- | --- |
| `src/app` | App Router 页面、受保护的图片/导出/认证接口 |
| `src/components` | 深色布局、卡片、表单、弹层、移动导航 |
| `src/lib/domain.ts` | 阅读状态、挑战计算、日期显示等纯函数 |
| `src/lib/actions.ts` | 认证后的写入、校验、事务、版本检查 |
| `src/lib/data.ts` | 共用的服务端读取模型 |
| `src/lib/assets.ts` | 原图、缩略图与图片元数据 |
| `src/lib/backup.ts` | 在线快照、归档、完整性校验与恢复 |
| `src/db`、`migrations` | Drizzle 模型与版本化 SQLite 迁移 |
| `scripts`、`deploy` | 账户、演示、部署和备份工具 |

图片文件不放在 `public`，每次访问都验证会话和空间成员资格。读取接口不接受任意磁盘路径，个人短评从当前会话决定作者。共同数据使用修订版本检查，后台刷新不会给旧草稿偷偷换上新版本号。

首版的数据量面向两人的私人收藏，页面一次读取空间记录。添加旅行、展览、美食时，需要为 `Entry.kind` 和类型表添加迁移，扩展表单、卡片和状态模块；可以直接复用 `Memory`、`Review`、`Asset`、标签和时间线。后续规模变大时，再将列表读取改为服务器端分页。公开分享、多人空间和离线编辑不在本版范围。

## 作品搜索与自动填充

在自己的电影馆／书房点击添加，输入片名、书名或 ISBN，选择对应作品后填写个人状态、评分、感受和日期。空间里已有的作品优先复用；仍可通过“没有找到？手动填写”录入。资料选定后可展开“查看或修正作品资料”，个人草稿不会因重新搜索而清空。

采用 [NeoDB 的公开目录 API](https://neodb.net/api/)，目前查询 `film.upstairs.cn` 和 `eggplant.place`，无需 API 密钥。这两个目录是独立运营的服务，覆盖和可用性没有保证；遇到失败不绕过验证页，显示可用结果或保留手动入口。检索和详情保留短时、有上限的内存缓存；不会自动抓取豆瓣网页或发送个人评分、感受给第三方。

仅名称等检索词发往目录。下载封面只接受固定信源媒体地址，禁止任意 URL 和跳转，限制超时、大小与图片像素；导入后保存在私密图片库。所有搜索、预览、导入接口均验证成员身份，导入额外校验请求来源。信源提供的评分不会写成个人评分；未知日期保持为空。

追加迁移 `0005_catalog_metadata.sql` 保存资料来源、电影原名／片长、书籍 ISBN／出版社等可用信息，不修改既有记录。按稳定来源 ID 与 ISBN 区分作品及版本，事务内再次查重。内容导出 v3 新增可选的 `entries[].metadata` 字段，完整备份与恢复继续包含所有资料和封面。

## 批量导入与主题电影馆

自己的电影馆和书房提供“批量导入”：粘贴清单或上传 CSV → 匹配资料 → 核对例外 → 导入已选。CSV 模板支持名称、年份、导演／作者、ISBN、状态、开始与完成日期。电影只支持想看／已看；书籍支持想读／在读／已读，未知日期留空。

每批最多 500 条，任务和逐项结果保存在服务器，只能由发起人读取和操作。页面每次处理两项，关闭或切走页面后暂停；最近的导入可重新打开继续。已导入条目不会重复写入。同名、不同年份、不同书籍版本和未展开的“全系列”需要人工确认；书籍推荐提供 ISBN。已有封面、简介、评分、感受和日期保留；回收站内容不会自动恢复。封面失败可单独重试，目录限流会按 Retry-After 暂停对应信源。

电影达到 12 部后默认“主题展映”，按类型优先级归入唯一章节，每章最多五部。“查看全部”打开该章全部影片；完整网格每页 48 部。视角、状态、展示方式、筛选和页码保存在 URL。未评分时不显示评分占位。

追加迁移 `0006_bulk_import.sql`，不重置任何现有内容。内容导出仍为 v3，额外包含当前成员的导入结果 CSV；完整备份包含任务进度。升级前运行备份和恢复验证，使用同一正式数据目录；**不要执行旧 v3 内容清空流程**。

管理员可将核对后的 `{ input, ref }` 数组交给与网页共用业务层的工具。首次不传 `--execute` 只准备任务；报告记录任务 ID，再次运行会继续该任务。程序同时核对未改动另一人的个人清单、评价、回忆、共同确认及挑战参与：

```sh
node --import tsx scripts/import-list.ts --file /private/reviewed.json --owner-email member@example.com --report /private/import-result
node --import tsx scripts/import-list.ts --file /private/reviewed.json --owner-email member@example.com --report /private/import-result --execute
```

若老手动条目需要明确复用，可额外传 `--reuse-map /private/map.json`（片名到已有作品 ID）。未确定的条目留在任务里，不会自动恢复或合并。报告和完整备份均应保存在受保护目录。

## 素材

中文标题使用自托管 **Noto Serif SC**（SIL Open Font License，许可证随字体包分发）。示例作品封面为程序生成的原创排版插图，不是官方海报。演示首页的山湖摄影由 [Jason Mavrommatis / Unsplash](https://unsplash.com/photos/river-surrounded-by-trees-near-mountain-elMz_DEwavA) 提供，仅用作视觉示例，不代表电影剧照或用户真实照片。

本项目已提供可以本地运行的版本与自建服务器配置；公网 DNS、真实服务器和证书签发需要在部署环境中完成。

## 照片墙与地球足迹（v4）

- 照片墙和地球共用照片、参与者、评论与回收站。点击照片可补充资料或评论，评论仅作者可修改。
- 单次最多 50 张，每张最多 25 MB、8000 万像素；支持静态 JPG、PNG、WebP、HEIC。原图、2560px 预览和 720px 缩略图均经会话鉴权读取。解码使用独立进程与单实例队列。
- 自动读取 EXIF 拍摄日期、时区偏移和 GPS；未知日期保持空白。可以按照片或批量修改日期、位置、参与者及旅行，原始元数据独立保留。
- 旅行可设置名称、简介、封面；日期范围按照片计算。解散只取消分组，照片和评论保留。
- 地球使用本地 NASA 影像，无地图账户即可旋转、缩放、点击聚合点及圈选半径。无 WebGL 的设备可以使用下方地点列表。地图显示 WGS84 坐标。
- 地点名称搜索使用高德 Web 服务 POI API。只在服务器环境设置 `AMAP_WEB_KEY`，不要加 `NEXT_PUBLIC_` 前缀。未配置时可使用照片 GPS、手动坐标或地球选点。密钥不要提交 Git。
- 时光轴提供全部／电影／书籍／照片／旅行筛选，并保留我们／各成员分支。照片按拍摄日与旅行合并，带位置或旅行分组的照片可单独查看足迹，不重复生成事件。
- 追加迁移 `0007_photos_travel.sql`；不清空任何旧数据。旧封面、头像及作品回忆照片不会自动进入照片墙。导出 v4 保留原有字段并增加照片、评论、参与者、旅行；完整备份 v2 包含私密预览，恢复兼容 v1。

升级前备份并运行 `npm run test:upgrade`。优先使用项目 Dockerfile 构建 Linux 镜像；断网重用已有运行环境时，可将该镜像的原始 lock 文件传入 `BASE_LOCK_FILE`，用 `scripts/package-release.mjs` 打包。此路径只允许新增无需安装脚本的跨平台 JS/WASM 依赖，既有依赖变化或原生依赖变化必须完整构建 Linux 镜像。

## 仓库隐私

`.env`、本地数据、数据库、上传文件、备份、浏览器测试结果和含服务器信息的部署文件均排除在 Git 外。安装提交检查：`git config core.hooksPath .githooks`。检查脚本扫描暂存内容；可在被忽略的 `.local/privacy-denylist.json` 中维护需要拦截的私人字符串数组。不要把真实账号或样例个人照片添加到测试素材。
