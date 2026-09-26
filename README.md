# qwenwork2api

把千问办公（QwenWork，gateway.qwenwork.cn）转成 **OpenAI 兼容 API**，部署在 **EdgeOne Pages 边缘函数**或 **Cloudflare Workers** 上，账号与配置存 **KV**。

## 部署到 EdgeOne Pages

### 创建项目

EdgeOne Makers 控制台导入本目录（或 `edgeone upload` 直接上传）。

### 绑定 KV

控制台「存储 - KV」开通账户 → 创建命名空间（如 `qwenwork2api`）→ 在项目中绑定，**变量名填 `QWENWORK_KV`**（`edge-functions/_shared/config.js` 的 `KV_NAMES` 里也兼容 `qwenwork_kv` / `my_kv` / `KV` 等名字）。

### 定时保活（可选）

在 WebUI「设置」复制定时任务 Token，填入 `edgeone.json` 的 `schedules[0].payload.token` 后重新部署；或直接在控制台建定时任务指向 `/cron/keepalive`。未携带有效 token 时该端点只做无害的"临近过期才刷新"。

## 部署到 Cloudflare Workers

1. 创建 KV 并填入 id：

   ```bash
   npx wrangler kv namespace create QWENWORK_KV
   ```

   把输出里的 `id` 填进 `wrangler.toml` 的 `kv_namespaces[0].id`。

2. 登录并部署：

   ```bash
   npx wrangler login
   npm run deploy:cf
   ```

3. 定时保活（可选）：`wrangler.toml` 已配置每日 UTC 22:00 触发 `scheduled`。若希望定时任务可强制刷新，执行 `npx wrangler secret put CRON_TOKEN` 并把同一 token 填到 WebUI「设置」的定时任务 Token；不设置也能跑（仅临近过期才刷新）。

## 本地测试

```bash
npm test
```

## 限制

- EdgeOne 边缘函数请求 body 上限 **1MB**（超长上下文会被拒绝）；Workers 无此限制。**内联 base64 图片会直接计入这个体积**（base64 比原图大约 1.33 倍），在 EdgeOne 上传大图请改用外链 URL，或部署到 Workers。
- EdgeOne 单次执行 CPU 时间片 **200ms**（不含 I/O 等待）；签名计算约 <5ms，SSE 转换为逐帧解析。

## 致谢

- [hostei](https://github.com/hostei33)

