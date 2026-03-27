## 百度 AI 转发服务（Python/Flask）

### 作用
给小程序提供一个 **安全** 的 HTTP 接口，后端用百度 `API Key/Secret Key` 获取 `access_token`，再调用 EasyDL 自定义模型，最终返回你小程序约定的固定结构：

- `success` boolean
- `code` 200/400/500
- `message` string
- `data.vegetation_density / dryness / risk_score`（0~1）
- `data.risk_level`（低/中/高/危）

### 目录
- `app.py`：服务端入口
- `requirements.txt`：依赖

---

## 1. 安装依赖

```bash
cd C:\Users\DELL\baidu_easydl_proxy
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

---

## 2. 配置环境变量（Windows PowerShell 示例）

### 模式 2（无需训练）：图像内容理解 + 规则计算（推荐先跑通）

必填（百度应用 AK/SK）：

```powershell
$env:BAIDU_API_KEY="你的百度API Key"
$env:BAIDU_SECRET_KEY="你的百度Secret Key"
```

启用图像内容理解模式：

```powershell
$env:USE_IMAGE_UNDERSTANDING="true"
```

说明：当前代码默认调用的是你已开通的 **“通用物体和场景识别-高级”**：
- `https://aip.baidubce.com/rest/2.0/image-classify/v2/advanced_general`

如需手动覆盖接口地址，可设置：

```powershell
$env:IMAGE_UNDERSTANDING_URL="https://aip.baidubce.com/rest/2.0/image-classify/v2/advanced_general"
```

（可选）自定义关键词规则（JSON 数组字符串）：

```powershell
$env:RULE_VEG_KEYWORDS_JSON='["树林","森林","树","草地","灌木","植被","绿色","leaf","tree","forest"]'
$env:RULE_DRY_KEYWORDS_JSON='["枯","枯黄","干燥","干旱","枯草","落叶","裸土","dry","drought","withered"]'
```

#### 干燥程度「不准」时如何调控（图像理解模式）

界面上的 **干燥程度** 在代码里一部分来自识别标签，一部分来自「高植被时补一个可燃物下限」——翠绿密闭林相容易被抬到约 **0.5**，看起来像“很湿却仍偏干”。

可通过环境变量标定（改完需重启服务）：

```powershell
# 可燃物下限：standard=原逻辑（偏保守）| soft=减弱（默认，更接近视觉干旱感）| off=关闭
$env:DRYNESS_FLOOR_MODE="soft"

# 识别到「绿/湿润/苔藓」等标签时，对干燥度再乘一个折扣（默认开启）
$env:LUSH_DAMPEN_ENABLED="true"
$env:LUSH_DAMPEN_STRENGTH="0.5"

# 全局倍率与封顶（图像理解与 EasyDL 均会应用）
$env:DRYNESS_SCALE="0.9"
$env:DRYNESS_CAP="0.45"

# 自定义「葱郁/湿润」关键词（JSON 数组字符串，可选）
$env:LUSH_KEYWORDS_JSON='["绿色","翠绿","苔藓","湿润","green","moss"]'
```

若仍偏高：先试 `DRYNESS_FLOOR_MODE=off` 或略调低 `DRYNESS_SCALE` / `DRYNESS_CAP`。

---

### 模式 1（需要训练）：EasyDL 自定义模型（方案A）

必填：

```powershell
$env:BAIDU_API_KEY="你的百度API Key"
$env:BAIDU_SECRET_KEY="你的百度Secret Key"
$env:EDL_VEG_URL="你的植被密度模型接口地址"
$env:EDL_DRY_URL="你的干燥程度模型接口地址"
```

可选（风险等级模型）：

```powershell
$env:EDL_RISK_URL="你的风险等级模型接口地址"
```

可选（label 映射，按你 EasyDL 的 label 改 key 即可）：

```powershell
$env:VEG_MAP_JSON='{"sparse":0.25,"medium":0.55,"dense":0.85}'
$env:DRY_MAP_JSON='{"wet":0.2,"normal":0.55,"dry":0.85}'
```

---

## 3. 启动服务

开发模式：

```bash
python app.py
```

生产模式（推荐）：

```bash
gunicorn -w 2 -b 0.0.0.0:8000 app:app
```

健康检查：
- `GET http://127.0.0.1:8000/healthz`

---

## 4. 小程序端对接

在小程序根目录 `miniprogram/app.js` 的 `globalData.pythonBackendBaseUrl` 填入云托管公网域名（例如 `https://xxx.sh.run.tcloudbase.com`，**不要**带末尾斜杠）。

预警页会走 `wx.request` 调用：

- `POST /api/forest/risk/analyze`
- `GET /api/fire-risk/points` 等

注意：在微信公众平台配置 **request 合法域名**（你的云托管域名）。

---

## 5. 请求/响应示例

请求：

```http
POST /api/forest/risk/analyze
Content-Type: application/json

{
  "image": "<纯base64>",
  "type": "forest_fire_risk"
}
```

成功响应：

```json
{
  "success": true,
  "code": 200,
  "message": "已完成 AI 风险评估（百度 EasyDL）。",
  "data": {
    "vegetation_density": 0.78,
    "dryness": 0.64,
    "risk_score": 0.71,
    "risk_level": "高"
  }
}
```

---

## 6. 微信云托管部署（本目录 = 你的 `app.py`）

本仓库已包含：

- `Dockerfile`：生产用 `gunicorn` 启动 `app:app`，端口与云托管 **8000** 对齐
- `wxcloud.config.js`：`type: "run"`，`server.port: 8000`，供 `@wxcloud/cli` 使用

### 方式 A：控制台部署（不装 Node 也可）

1. 微信开发者工具 → 云开发 → 云开发控制台 → **云托管** → 选中你的服务 → **更新版本**
2. **构建目录** 选本仓库根目录（与 `app.py` 同级），例如：`C:\Users\DELL\SYAT`（或与 `baidu_easydl_proxy` 为同一套代码时选对应路径）
3. **使用 Dockerfile 构建**，容器端口 **8000**
4. 在服务/版本配置里设置与本地一致的环境变量（如 `BAIDU_API_KEY`、`BAIDU_SECRET_KEY`、`USE_IMAGE_UNDERSTANDING` 或 `EDL_*`）
5. 发布后浏览器访问：`https://你的域名/healthz` 应返回 `{"ok": true}`（若仍是「欢迎使用微信云托管」说明还未切到本镜像）

### 方式 B：CLI 部署（需已安装 Node.js）

文档：<https://cloud.weixin.qq.com/cli/commands/deploy.html>

```powershell
cd C:\Users\DELL\SYAT
npm install -g @wxcloud/cli
wxcloud login -a <小程序AppID> -k <CLI私钥>
wxcloud deploy -e cloud1-6gy6lm4nbc776f35 -s <云托管里的服务名称> -p 8000
```

`服务名称` 以云托管控制台列表为准（不是你的域名前缀）。

---

## 7. 推送到 GitHub（本仓库：`https://github.com/Gin-cay/SYAT.git`）

本机已整理好的目录：`C:\Users\DELL\SYAT`（已含 `.gitignore`，不含 `.venv`、不含本地 `fire_risk_points.json`）。

1. 安装 [Git for Windows](https://git-scm.com/download/win)（或完成 winget/Git 安装向导）。
2. 打开 **Git Bash** 或 PowerShell，执行：

```powershell
cd C:\Users\DELL\SYAT
git init
git branch -M main
git add .
git commit -m "feat: Flask 百度 AI 转发后端（云托管 Docker）"
git remote add origin https://github.com/Gin-cay/SYAT.git
git push -u origin main
```

3. 若 `git push` 要求登录：在 GitHub 使用 **Personal Access Token** 代替密码，或使用 **GitHub Desktop** 绑定账号后推送。

推成功后，云托管「更新版本」里也可把代码来源改为 **Git 仓库**，填 `https://github.com/Gin-cay/SYAT.git` 与分支 `main`，之后改代码 push 再重新发版即可。

