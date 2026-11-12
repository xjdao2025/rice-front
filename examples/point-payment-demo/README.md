# 第三方积分支付 Demo

需要 Node.js 22+、已部署 Point 接口的 Rice 和已注册的测试商户。商户返回地址登记为 `https://<你的测试域名>/return`。将该地址通过 HTTPS 反向代理到本地 Demo 的 19500 端口。测试商户的凭证只配置在 Demo 服务端。

```sh
cd examples/point-payment-demo
export RICE_URL=https://xjdao.net
# 在终端安全设置 RICE_PAYMENT_KEY
node server.mjs
```

1. 打开 Demo 站点，点击购买 10 积分纪念卡。
2. Demo 服务端调用 `POST /v1/payment-intents`，并把浏览器跳转到 Rice 的确认页。
3. 在 Rice 登录后核对应用、收款方和金额，确认付款，再点击返回应用。
4. Demo 服务端调用 `GET /v1/payment-intents/{id}`。只有 Rice 返回成功和交易 ID 后才显示发放结果。刷新返回页复用同一交付记录。

这是本地演示。订单和交付保存在进程内存中，重启会清空。实际应用应持久化外部订单号、Rice 订单 ID 和交付状态，并用数据库唯一约束保证交付幂等。商店发放仅为页面演示。

## 开发者与 Agent 集成

完整支付流程、请求示例、幂等与交付规则维护在 Rice 仓库的 `developer/point-integration/README.md`。Agent 可同时读取该目录中的 `openapi.json`，按指南中的执行步骤和验收清单接入。

[公开集成指南](https://github.com/xjdao2025/rice/tree/codex/rice-point-migration/developer/point-integration)包含商户注册、接口定义和 Agent 接入步骤。
