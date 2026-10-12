# 乡建前端

这是乡建 DAO 的 Web 前端。它使用 React、TanStack Start 和 Astryx；普通帖子由 PDS 保存，帖子列表由 AppView（aerox）提供，账号、社区、任务、活动和稻米由 Rice 负责。前端负责呈现和输入，不自行决定业务权限、资金结算或最终状态。

## 从哪里读代码

| 入口 | 职责 |
| --- | --- |
| [src/routes](src/routes) | 文件路由、URL 参数和进入页面前的数据加载 |
| [src/components/AppShell.tsx](src/components/AppShell.tsx) | 常驻主导航、子页面返回、全局入口 |
| [src/features/feed](src/features/feed) | 帖子读取、PDS 写入、回复与发布 |
| [src/features/tasks](src/features/tasks)、[src/features/events](src/features/events) | Rice 业务页面和接口调用 |
| [src/features/session](src/features/session) | Rice/PDS 会话恢复与失效处理 |
| [src/lib/http.ts](src/lib/http.ts)、[src/lib/pds.ts](src/lib/pds.ts) | 服务端请求、PDS 记录与媒体约束 |
| [src/styles/app.css](src/styles/app.css) | 颜色、内容宽度和页面/卡片/表单间距的统一变量 |

## 设计取舍

- **可分享的页面有 URL。** 广场、任务、活动、乡建、我的为五个主页面；乡建直接进入联盟与治理。帖子、详情、个人主页、发布和编辑为子页面。底部导航始终可返回主页面。只有确认操作和图片放大使用临时浮层。路由在需要的数据准备好后切换，避免先画出半个页面。
- **共用行为放在共用组件。** `ContentCardHeader` 限定作者链接只在头像和昵称上；`ImageGroup` 为帖子、任务和活动提供同一图库与预览；`PublishSteps`、`PublishTextInput`、`PublishTextArea` 统一分步发布、输入提示和错误显示。可复用的间距在 CSS 变量里，不在每个页面各写一套。
- **后端是业务状态的准绳。** 任务、活动的可执行操作和管理权限以 Rice 返回值为准；前端的状态文字和日期判断只是展示。稻米冻结、退款、发放由 Rice 完成，前端不模拟成功。编辑沿用发布表单，历史版本与编辑人由服务端记录。
- **PDS 与 Rice 数据分开。** 帖子写入 PDS，从 AppView 读取（列表用 `aerox.feed.listPosts`）；任务和活动读写 Rice。帖子使用 `app.bsky.embed.gallery` 保存 1–9 张图片，不为旧客户端增加另一套发布格式。任务、活动图片作为 Rice 附件，不伪装成帖子。帖子草稿按 DID 留在本机 IndexedDB，任务/活动草稿保存在 Rice，避免两套业务数据混用。
- **图片先预览，提交时上传。** 共用选择限制为最多 9 张、每张不超过 20 MB。当前 PDS 的 blob 上限为 1 MB，静态帖子图片在上传前压缩；超限 GIF 不转成静态图。上传失败保留输入，重试复用已上传成功的图片。

## 本地运行

需要 Node.js 22、pnpm 10.17.1，以及已运行的 Rice/PDS/AppView 网关。仓库不存放数据库、SMTP、PDS 或服务商密钥。

```sh
pnpm install --frozen-lockfile
XIANGJIAN_BACKEND_URL=http://localhost:19006 pnpm dev
```

浏览器打开 `http://localhost:19007`。开发代理配置在 [vite.config.ts](vite.config.ts)；使用 Semi 登录时，前端与网关使用同一主机名，回调可使用网关端口，再交接回前端。部署时将已登记的 Semi 回调地址和前端交接地址分别配置正确，不要把密钥写入前端环境变量。

## 构建与部署

```sh
pnpm test
pnpm build
XIANGJIAN_BACKEND_URL=http://gateway pnpm start
```

`pnpm build` 生成 `dist/server` 和 `dist/client`；`pnpm start` 用 srvx 在 `0.0.0.0:3000` 运行服务端渲染并提供静态资源。[Dockerfile](Dockerfile) 执行同样的安装、构建和启动流程，镜像可用 `docker build -t xiangjian-frontend:local .` 构建。部署时将 `XIANGJIAN_BACKEND_URL` 设为容器内可访问的网关地址；不要将 `localhost` 当作另一容器的地址。镜像、网关、数据库、域名、TLS 和密钥由单独的部署配置管理。

浏览器仍需通过**同一站点**访问 `/auth/semi/`、`/api/attachments`、`/img/`（rice 的帖子图片/头像缩略图）和 `/bsky/img/`；生产网关须将它们转到对应服务。其余 Rice/PDS/AppView 请求由前端服务端函数转发到 `XIANGJIAN_BACKEND_URL`。若历史图片 URL 指向内部 AppView，可用逗号分隔的 `XIANGJIAN_APPVIEW_IMAGE_ORIGINS` 指定允许改写为同源 `/bsky/img/` 的 origin；无此需求时留空。

部署前运行上面的测试和构建，并核对网关、会话恢复、帖子与任务/活动的读取和写入。测试通过只证明本仓库的代码检查通过，不代表线上业务流程已经验收。
