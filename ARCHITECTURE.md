# 咕嘎写作架构

## 部署模型

- 源码真源：GitHub `emptyinkpot/novel-writer` 的 `main` 分支。
- 生产构建：Coolify 4.1.2 按仓库根 `Dockerfile` 构建镜像。
- 生产运行：Coolify 应用注入 `.env`，容器内同时运行 Next.js web 和 NestJS API。
- 公网入口：`writer.example.invalid` 指向 Coolify 管理的 web 端口 `19200`。
- 内部 API：浏览器只访问同域 `/api/*`，Next.js rewrite 转发到容器内 `http://127.0.0.1:19201/api/*`。
- 密钥边界：数据库、JWT、sub2api、支付和微信参数只允许由 Coolify env 注入，不写入仓库。

## 端口

| 组件 | 端口 | 可见性 |
| --- | --- | --- |
| Next.js web | `19200` | Coolify 暴露 |
| NestJS API | `19201` | 容器内本地访问 |

## 必需环境变量

API 启动必须具备：

```text
DB_HOST
DB_PORT
DB_USER
DB_PASS
DB_NAME
JWT_SECRET
SUB2API_URL
SUB2API_KEY
WECHAT_REDIRECT_URI
PAYMENT_NOTIFY_BASE_URL
```

`NEXT_PUBLIC_API_URL` 默认不设置。生产通过同域 `/api/*` 调 API，避免浏览器直连内部 API 端口。
