# 围棋 · Moon GameHub

上游为 [Krab-Lab/MokuMoku](https://github.com/Krab-Lab/MokuMoku/tree/70784e7894103634a243cc5a2fdc8792951e9b5c)，Apache-2.0 授权。原版说明和许可见 [UPSTREAM.md](UPSTREAM.md) 与 [LICENSE](LICENSE)。

GameHub 版直接进入 19 路围棋，提供好友房、分享邀请链接和浏览器 AI。用八位房号也可入座。沿用上游每手 60 秒、简单劫及双方连续停一手后以当前棋盘自动数子、白贴 7.5 目。终局数子前应在棋盘上处理死子，页面没有死子标记阶段。

前端的请求使用相对地址，含中文入口和普通 HTTP 下的手动复制提示。Node.js 24 直接调用上游游戏处理器，使用 SQLite 替换 EdgeOne Blob，应用层的房间操作在事务内串行提交。房间七天无更新后清理。运行 `npm test` 执行上游规则测试，或运行 `npm start` 启动独立测试服务。

Windows 的公网网关监听 GameHub 端口，并将 `/gamehub/weiqi/` 转交给端口 `18892`。Moon 使用 [gamehub-weiqi.service](gamehub-weiqi.service)，反代至回环端口 `18891`，保留请求路径。Moon 部署需要 `public/`、`cloud-functions/`、`package.json`、`server.js`、`store.js` 和 `LICENSE`，服务数据由 systemd 保存在 `/var/lib/gamehub-weiqi/rooms.sqlite`。

## 本地运行

需要 Node.js 24（使用内置的 `node:sqlite`），没有 npm 依赖：

```sh
npm test     # 上游规则测试（使用内存 SQLite）
npm start    # http://127.0.0.1:18891/，数据写入本目录的 rooms.sqlite
```

可用 `PORT`、`DB_PATH`、`BASE_PATH`、`PUBLIC_ORIGIN`、`TRUST_PROXY` 调整端口、数据库位置和反代设置。

`gamehub-weiqi.service` 写死了 moon 的环境：Node 运行时路径（借用 `/opt/pokemon-showdown/runtime/current/bin/node`）、
发布目录 `/opt/weiqi/current` 和公网来源 `https://release.moonl.cloud`。在别处部署时按实际环境修改。

GitHub Actions 在每次推送和 PR 时运行 `npm test`，并做密钥与依赖漏洞扫描。

## 许可证

本仓库整体以 [Apache License 2.0](LICENSE) 发布，与上游 MokuMoku 相同。HinaKalo 所做的修改与新增文件见 [NOTICE](NOTICE)。
