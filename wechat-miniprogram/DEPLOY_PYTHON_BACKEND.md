# 方案B：Python 后端上云（腾讯云托管）

## 1. 部署 Python 服务

项目目录：`C:\Users\DELL\baidu_easydl_proxy`  
已新增：

- `Dockerfile`
- `.dockerignore`

在微信开发者工具中：

1. 打开 **云开发控制台**，选择环境 `cloud1-6gy6lm4nbc776f35`
2. 进入 **云托管**
3. 新建服务（来源选「本地代码/代码仓库」，目录选择 `baidu_easydl_proxy`）
4. 端口填 `8000`
5. 启动命令使用 Dockerfile 默认命令即可（`gunicorn ... app:app`）
6. 配置环境变量（至少）：
   - `BAIDU_API_KEY`
   - `BAIDU_SECRET_KEY`
   - `USE_IMAGE_UNDERSTANDING=true`（若先不走 EasyDL 模型）
   - 或配置 `EDL_VEG_URL`、`EDL_DRY_URL`（以及可选 `EDL_RISK_URL`）
7. 部署完成后，获取访问域名（示例：`https://xxx.run.tcloudbase.com`）

## 2. 小程序接入云端后端地址

文件：`miniprogram/app.js`

- 在 `globalData.pythonBackendBaseUrl` 写入你的云托管域名，例如：

```js
pythonBackendBaseUrl: "https://xxx.run.tcloudbase.com",
```

## 3. 验证接口

部署成功后，用浏览器打开：

- `https://你的域名/healthz`

应返回：

```json
{"ok": true}
```

然后在小程序预警页测试 AI 分析，确认不再出现 `127.0.0.1:8000` 报错。

## 4. 注意事项

- 当前 `profile` 页短信验证已改为云函数 `smsAuth`，不依赖 Python 后端。
- 如果使用云托管正式域名给小程序访问，记得按平台要求完成域名相关配置（如需）。

