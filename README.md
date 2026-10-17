# dsh-workbuddy-credits

[DeepSeek Harness](https://www.deepseek.com/harness/) 的 Web 侧栏面板：随时查看 **WorkBuddy / CodeBuddy 账号积分**——余额、到期分布、免费模型与倍率，带手动刷新。

> A resident Web sidebar panel for DeepSeek Harness that shows your WorkBuddy account credits: balance, expiry spread, free models, and per-model rates, with manual refresh.

```
┌─ WorkBuddy 积分 ───────────────────────── 更新于 18:42:07 ── [刷新] ┐
│  国内版 │ 国际版                                                    │
│                                                                     │
│  ┌─合计余额───┐ ┌─7 天内过期─┐ ┌─免费模型─┐ ┌─套餐数─┐           │
│  │ 5,006 积分 │ │   40 积分  │ │    2     │ │   15   │           │
│  └────────────┘ └────────────┘ └──────────┘ └────────┘           │
│                                                                     │
│  ⚠ 7 天内有 40 积分过期（1 个包），最早 2026-10-19 12:13            │
│                                                                     │
│  到期时间            剩余      总量     剩余时长   套餐             │
│  2026-10-19 12:13       40      100     0.5 天   …运营裂变包        │
│  2026-10-26 09:33    2,000    2,000     7.4 天   Buddy AI个人标准版 │
│  2026-10-26 09:33    2,000    2,000     7.4 天   Codebuddy版本赠送包│
└─────────────────────────────────────────────────────────────────────┘
```

## 为什么需要它

积分读取**每次都会真实调用上游计费接口**（实测 200–500 ms）。直接查既慢又费额度，而定时轮询会持续消耗你想监控的那个额度。

这个面板把读取放进**宿主侧缓存**：开关面板、切换会话、重开页面都只读内存，只有按下「刷新」才真正打上游。

| | 实测 |
|---|---|
| 冷读（真实上游） | ~210–370 ms |
| 热读（缓存） | **2–3 ms** |
| 自动轮询 | **没有** |

## 安装

```bash
dsh plugin add dsh-workbuddy-credits
```

**前置条件**：需要先装好并登录 [`dsh-workbuddy-connect`](https://github.com/corrinehu/dsh-workbuddy-connect)——积分属于 WorkBuddy 桌面端账号，本插件复用它的登录态，自己不做认证。

安装后侧栏会出现「WorkBuddy 积分」图标。国内版（`workbuddy.cn`）与国际版（WorkBuddy AI）的账号与积分互不相通，用面板顶部的分段按钮切换。

## 设计要点

- **不自己读账号。** 只读 `dsh-workbuddy-connect` 的状态路由并加缓存；认证与计费协议都由上游插件负责，它升级时本插件不必跟着改。
- **stale-while-revalidate。** 缓存过期时立刻返回旧数据、后台再刷新，永远不让人等计费接口。
- **失败保留数据。** 刷新失败时保留上一次成功的数字，并标注「刷新失败」及原因，而不是把面板变成一片空白。未登录 / 令牌过期是**数据状态**而不是报错。
- **不缓存未登录。** 只有可用的积分数据才进缓存，否则登录后会被缓存挡住一整个周期。
- **并发合并。** 同一时刻的多个刷新请求合并成一次上游调用。
- **只读 + loopback 防护。** 路由只接受 `GET`，且要求 `Host` 与 `Origin` 都是回环地址（防 DNS rebinding）。它不写任何账号状态。
- **无构建步骤。** `client.js` 是手写的浏览器模块工厂，仓库里就是运行时真正加载的代码。

### 缓存与数据流

```
面板 (client.js)
   │  fetch /plugins/dsh-workbuddy-credits/status?provider=…&refresh=0|1
   ▼
本插件宿主半侧 (index.js)   ←── 60s 缓存，并发合并，投影 + 排序
   │  GET /plugins/dsh-workbuddy-connect/status
   ▼
dsh-workbuddy-connect        ←── 复用桌面端登录态
   │  HTTPS
   ▼
WorkBuddy 上游计费接口        ←── 真实计费查询
```

## 配置

缓存时长在 profile 的 `cordis.patch.yml` 里调整：

```yaml
- id: workbuddy-credits
  name: dsh-workbuddy-credits
  config:
    cacheTtlMs: 60000   # 默认 60 秒，上限 3600000（1 小时）
```

调大更省额度、数据更旧；调小更实时。无论多大，手动刷新都会绕开它。

## HTTP 接口

面板走的那条路由也可以直接调用，适合脚本化：

```bash
# 缓存读取
curl 'http://127.0.0.1:19387/plugins/dsh-workbuddy-credits/status'

# 强制真实读取上游
curl 'http://127.0.0.1:19387/plugins/dsh-workbuddy-credits/status?refresh=1'

# 国际版
curl 'http://127.0.0.1:19387/plugins/dsh-workbuddy-credits/status?provider=workbuddy-ai'
```

响应字段：

| 字段 | 含义 |
|---|---|
| `state` | `ready` / `signed-out` / `unavailable` |
| `total` | 合计余额 |
| `accounts[]` | 积分包，**按到期时间升序**；`endTimeMs: null` 表示无到期时间 |
| `expiry.within{24h,3d,7d}` | 各窗口内即将过期的合计与包数 |
| `models[]` | 模型，**按倍率升序**（越低越省） |
| `freeModels[]` | 免费模型 |
| `cached` / `stale` / `ageMs` | 是否来自缓存、是否为过期数据、缓存年龄 |
| `refreshError` | 刷新失败时的原因（此时数据仍是上次成功的） |

上游返回 `signed-in` 以外、或无法识别的状态时，一律按 `unavailable` 处理，不会误报成「未登录」把你引去重新登录。

## 开发

无构建步骤：改完 `client.js` 就是改完运行时代码。

```bash
npm test          # 三组自包含测试（无需 DSH、无需网络）
npm run test:live # 追加在运行中的 Harness 上的实测
```

| 测试 | 覆盖 |
|---|---|
| `test/client.contract.mjs` | manifest、模块加载契约、槽位注册形状（含 `sidebar.id === main.key`） |
| `test/client.render.mjs` | 面板数据流与渲染树、刷新 / 切版 / 失败状态 |
| `test/host.smoke.mjs` | 真实路由：缓存、并发合并、投影、loopback 防护、各类失败降级 |
| `test/live.integration.mjs` | 装进运行中的 DSH 后的真实行为（需要 `--live`） |

**验证边界**：自动化覆盖组件树、props、数据流，以及「CSS 是否只引用主题 token」；**布局观感与明暗主题呈现需要人眼在 GUI 里确认**。

## 已知限制

- **只读。** 不做充值、扣减或任何账号写操作。
- **依赖 `dsh-workbuddy-connect`。** 没装或没登录时，面板会明确显示「未登录」并给出提示。
- **数值仅供参考。** 倍率与实际价格的关系由上游决定，折算只能给量级估算。
- **企业账号**走周期重置额度，没有普通包的到期语义。
- **缓存是进程内的。** 重启 DSH 后第一次打开面板会真实读一次上游。

## 作者

Fancy Lee（[@fancylear](https://github.com/fancylear)）

## License

[MIT](LICENSE)
