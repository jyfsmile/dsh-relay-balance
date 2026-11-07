# dsh-relay-balance

一个 DeepSeek Harness（DSH）桌面版插件，在左侧边栏加一个**中转余额**入口，
实时显示你通过 DSH 使用的中转站余额：

- 剩余额度（大字，美元）
- 累计已用、今日实扣
- 请求数（今日 / 累计）
- token 数（今日；New API 不提供累计 token，所以显示 —）
- Key 名称、到期时间、可用模型、上次更新时间

余额低于 **$1** 时，边栏图标上会出现一个**红点**。

## 支持的中转站

任何 **New API** 架构的中转站。默认 base URL 是 `https://spanagent.xyz`
（Span Agent）。余额从 `GET {base}/api/user/self` 和
`GET {base}/api/usage/token/` 读取；今日消费从
`GET /api/log/self/stat` 读取（失败时依次回落到 `/api/data/self`、
`/api/log/token`）。额度按 **500000 = $1** 换算（有 `/api/status` 时以
站点的设置为准）。

## 安装

**应用内安装（推荐）：** 插件 → 添加插件 → 粘贴

```
github:jyfsmile/dsh-relay-balance
```

**或用桌面版命令行：**

```sh
dsh plugin --profile desktop add github:jyfsmile/dsh-relay-balance
```

然后**彻底退出 DSH（包括托盘图标）再重新打开**。边栏入口会出现在左侧
边栏底部，内置面板之间。

## 设置（API Key）

API Key **不是**在 DSH 界面里填的。它写在 desktop profile 的 patch 文件
里，本插件的配置行：

```
%USERPROFILE%\.dsh\profiles\desktop\cordis.patch.yml
```

在文件里加入（或替换）本插件的行，带上 `config:`：

```yaml
- insert:
    - id: dsh-relay-balance
      name: 'dsh-relay-balance'
      config:
        baseURL: 'https://spanagent.xyz'
        apiKey: 'sk-your-key-here'
        refreshSeconds: 30
```

- `baseURL` — 中转站地址（默认 `https://spanagent.xyz`）。
- `apiKey` — 你的中转站 API Key。只在 Host 进程里用，以
  `Authorization: Bearer` 请求头发送给中转站。不会记日志、不会返回给
  浏览器、除了中转站本身不会离开你的电脑。
- `refreshSeconds` — 面板自动刷新间隔，默认 30 秒，最小 10 秒。

改完后**彻底退出 DSH（托盘也要退出）再重启**。没填 Key 之前，面板会
显示"还没有填 API Key"。

## 手动剩余额度

面板里可以直接填一个**手动总额**：你总共充值的金额，和面板同一个币种
（spanagent 上是 ¥）。填好点保存，剩余额度就按「手动总额 − 累计已用」
算，累计已用涨了，剩余额度跟着变；充值后更新这个数就行。点清除回到
中转站返回的余额。

手动总额存在面板的本地存储里，不用改配置、不用重启；换电脑或清掉浏览
器数据后要重填。边栏的余额过低红点仍按中转站返回的余额判断。

## 在面板里填地址和 Key

面板里可以直接填中转站地址和 API Key，不用改配置文件、不用重启，填好
点保存，面板就读这个 Key 的数据。填了之后，面板显示该 Key 所属账号的
剩余额度与累计已用（`quota` / `used_quota`），其它 Key 用的额度也会算
进来——Key 只是用来查账的凭证，显示的始终是账号的数。两项都留空、点
清除，就用回配置里的 Key。

地址和 Key 存在面板的本地存储里，只发给本机的 Host，不会离开你的电
脑；换电脑或清掉浏览器数据后要重填。手动总额要填这个账号总共充值的金
额，这样「手动总额 − 累计已用」才是账号的剩余额度。

## 版本说明

支持 **DSH >= 0.1.7-rc.2，包括 0.2.2-rc.1**。本插件**不声明任何
`@deepseek-ai/*` 的 peer 依赖，是故意的**：这正是 `dsh-gateway-wallet`
在 0.2.2-rc.1 上报"版本不支持"的原因（它的 peer 上限是 `<0.2.0-0`）。
本插件只用 Cordis 传进来的 `ctx` 对象和 Node 全局变量，所以不会被任何
版本锁定卡住。

## 工作原理

- **Host**（`index.js`）：一个同源路由 `GET /dsh-relay-balance/balance`，
  仅限本机访问、仅限 GET。用配置好的 Key 读中转站，返回一个扁平的 JSON
  汇总。响应里永远没有 Key（只有 `sk-••••abcd` 这样的掩码提示）。
- **Client**（`client.js`）：边栏入口 + 面板。只请求同源路由——不直接
  连中转站、不碰 Key。每 30 秒自动刷新（可配置）；手动点刷新会绕开
  Host 的 30 秒缓存、直接读中转站实时数，底部会显示这次数的"更新于 x 秒
  前"，能看到数字是活的。没填 Key 时显示空状态。面板里填的地址和 Key
  通过请求头（`X-Relay-Base-URL` / `X-Relay-Key`）传给 Host，只用于当
  次请求，不写进配置文件。

## 限制

- **累计 token** 是 New API 不提供的，所以面板里显示 —。今日 token 来
  自 `/api/log/token` 的翻页统计（最多 5 页 × 100 条）；如果一天超过
  500 次请求，今日 token 会显示 —，而不是给一个错的数字。
- 改配置需要**彻底重启 DSH**（托盘也要退出）才生效。
- 本插件没有构建步骤、没有任何依赖——纯 JS，MIT 开源。
