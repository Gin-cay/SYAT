"""
百度 AI 转发服务 - Flask 版

支持两种模式：
1) EasyDL 自定义模型（方案A）：需要你发布模型并提供 EDL_*_URL
2) 现成接口（图像内容理解）+ 规则计算：无需训练模型（推荐先跑通）

提供接口：
POST /api/forest/risk/analyze
Content-Type: application/json
Body:
  {
    "image": "<纯 base64（不带 data:image/... 前缀）>",
    "type": "forest_fire_risk"
  }

返回结构（严格一致）：
  {
    "success": boolean,
    "code": 200/400/500,
    "message": string,
    "data": {
      "vegetation_density": number(0~1),
      "dryness": number(0~1),
      "risk_score": number(0~1),
      "risk_level": "低"|"中"|"高"|"危"
    }
  }

运行：
  pip install -r requirements.txt
  set BAIDU_API_KEY=xxx
  set BAIDU_SECRET_KEY=yyy
  # 模式2（推荐先跑通）
  set USE_IMAGE_UNDERSTANDING=true
  # （可选）自定义关键词规则（JSON 数组字符串）
  # set RULE_VEG_KEYWORDS_JSON=["树林","森林","草地","植被","绿色","tree","forest"]
  # set RULE_DRY_KEYWORDS_JSON=["枯黄","干燥","干旱","裸土","dry","drought"]
  #
  # 模式1（EasyDL）
  # set EDL_VEG_URL=https://...  (模型发布后的【接口地址】不带 access_token)
  # set EDL_DRY_URL=https://...
  # set EDL_RISK_URL=https://... (可选)
  # 干燥度标定（可选）：DRYNESS_FLOOR_MODE / DRYNESS_SCALE / DRYNESS_CAP / LUSH_DAMPEN_* 等，见 README
  python app.py

注意：不要把 BAIDU_API_KEY/BAIDU_SECRET_KEY 放到小程序前端。
"""

from __future__ import annotations

import json
import math
import os
import threading
import time
import base64
from dataclasses import dataclass
from typing import Any, Dict, Iterable, Optional, Tuple

import requests
from flask import Flask, jsonify, request
import pymysql

app = Flask(__name__)

# 报警联动状态：1 表示触发，供硬件轮询后自动复位为 0
_alarm_status = 0
_alarm_lock = threading.Lock()

# 火险热力图落点持久化（JSON 文件，便于无数据库部署）
_FIRE_POINTS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fire_risk_points.json")
_fire_points_lock = threading.Lock()
# 最多保留条数（防无限增长）
_FIRE_POINTS_MAX = int(os.getenv("FIRE_POINTS_MAX", "8000").strip() or 8000)
_FIRE_POINT_KEY_DECIMALS = int(os.getenv("FIRE_POINT_KEY_DECIMALS", "4").strip() or 4)

# 火情上报 MySQL 配置（云托管环境变量）
MYSQL_HOST = os.getenv("MYSQL_HOST", "").strip()
MYSQL_PORT = int(os.getenv("MYSQL_PORT", "3306").strip() or 3306)
MYSQL_USER = os.getenv("MYSQL_USER", "").strip()
MYSQL_PASSWORD = os.getenv("MYSQL_PASSWORD", "").strip()
MYSQL_DB = os.getenv("MYSQL_DB", "").strip()


def _read_fire_points_unlocked() -> list[dict[str, Any]]:
    if not os.path.isfile(_FIRE_POINTS_PATH):
        return []
    try:
        with open(_FIRE_POINTS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _write_fire_points_unlocked(rows: list[dict[str, Any]]) -> None:
    os.makedirs(os.path.dirname(_FIRE_POINTS_PATH), exist_ok=True)
    with open(_FIRE_POINTS_PATH, "w", encoding="utf-8") as f:
        json.dump(rows, f, ensure_ascii=False)


def get_mysql_conn():
    if not (MYSQL_HOST and MYSQL_USER and MYSQL_DB):
        raise RuntimeError("缺少 MySQL 环境变量：MYSQL_HOST/MYSQL_USER/MYSQL_DB")
    return pymysql.connect(
        host=MYSQL_HOST,
        port=MYSQL_PORT,
        user=MYSQL_USER,
        password=MYSQL_PASSWORD,
        database=MYSQL_DB,
        charset="utf8mb4",
        cursorclass=pymysql.cursors.Cursor,
        autocommit=True,
    )


def ensure_fire_report_table():
    sql = """
    CREATE TABLE IF NOT EXISTS fire_reports (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      location VARCHAR(512) NOT NULL,
      images LONGTEXT NOT NULL,
      report_time VARCHAR(32) NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'submitted'
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    """
    conn = get_mysql_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(sql)
    finally:
        conn.close()


def insert_fire_report(location: str, images: list[str], report_time: str, status: str) -> int:
    ensure_fire_report_table()
    conn = get_mysql_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "INSERT INTO fire_reports(location, images, report_time, status) VALUES(%s,%s,%s,%s)",
                (location, json.dumps(images, ensure_ascii=False), report_time, status),
            )
            return int(cur.lastrowid or 0)
    finally:
        conn.close()


def record_fire_risk_map_point(
    latitude: float,
    longitude: float,
    *,
    risk_score: float,
    vegetation_density: Optional[float] = None,
    dryness: Optional[float] = None,
    risk_level: Optional[str] = None,
) -> None:
    """分析成功后写入热力图点位（小程序 map 使用）。"""
    if not (-90.0 <= latitude <= 90.0 and -180.0 <= longitude <= 180.0):
        return

    # 同一经纬度只保留最新一条：按固定精度归一化后做 upsert
    # 说明：移动端定位会有微小抖动，前端若要“原地覆盖”建议也同样 round 到该精度再上传
    lat_key = round(float(latitude), _FIRE_POINT_KEY_DECIMALS)
    lng_key = round(float(longitude), _FIRE_POINT_KEY_DECIMALS)
    key = f"{lat_key:.{_FIRE_POINT_KEY_DECIMALS}f},{lng_key:.{_FIRE_POINT_KEY_DECIMALS}f}"

    entry: dict[str, Any] = {
        "latitude": float(lat_key),
        "longitude": float(lng_key),
        "risk_score": float(clamp01(risk_score)),
        "ts": int(time.time() * 1000),
        "key": key,
    }
    if vegetation_density is not None:
        entry["vegetation_density"] = float(clamp01(vegetation_density))
    if dryness is not None:
        entry["dryness"] = float(clamp01(dryness))
    if risk_level is not None:
        entry["risk_level"] = str(risk_level)

    with _fire_points_lock:
        rows = _read_fire_points_unlocked()
        # 覆盖同位置旧点
        kept: list[dict[str, Any]] = []
        for r in rows:
            try:
                k = r.get("key")
                if not k:
                    la0 = round(float(r.get("latitude") if "latitude" in r else r.get("lat", 0)), _FIRE_POINT_KEY_DECIMALS)
                    lo0 = round(float(r.get("longitude") if "longitude" in r else r.get("lng", 0)), _FIRE_POINT_KEY_DECIMALS)
                    k = f"{la0:.{_FIRE_POINT_KEY_DECIMALS}f},{lo0:.{_FIRE_POINT_KEY_DECIMALS}f}"
                if k == key:
                    continue
            except Exception:
                # 异常行直接保留，避免误删
                pass
            kept.append(r)

        kept.append(entry)
        if len(kept) > _FIRE_POINTS_MAX:
            kept = kept[-_FIRE_POINTS_MAX :]
        _write_fire_points_unlocked(kept)


# ====== 配置：从环境变量读取（生产环境建议使用密钥管理） ======
BAIDU_API_KEY = os.getenv("BAIDU_API_KEY", "").strip()
BAIDU_SECRET_KEY = os.getenv("BAIDU_SECRET_KEY", "").strip()

# 现成接口模式：通用物体和场景识别-高级（无需训练模型）
USE_IMAGE_UNDERSTANDING = os.getenv("USE_IMAGE_UNDERSTANDING", "").strip().lower() == "true"
IMAGE_UNDERSTANDING_URL = os.getenv(
    "IMAGE_UNDERSTANDING_URL",
    "https://aip.baidubce.com/rest/2.0/image-classify/v2/advanced_general",
).strip()

# 规则关键词（可选 JSON 数组字符串）
RULE_VEG_KEYWORDS_JSON = os.getenv("RULE_VEG_KEYWORDS_JSON", "").strip()
RULE_DRY_KEYWORDS_JSON = os.getenv("RULE_DRY_KEYWORDS_JSON", "").strip()
LUSH_KEYWORDS_JSON = os.getenv("LUSH_KEYWORDS_JSON", "").strip()

# EasyDL 模型发布后的【接口地址】（不带 access_token 参数）
EDL_VEG_URL = os.getenv("EDL_VEG_URL", "").strip()
EDL_DRY_URL = os.getenv("EDL_DRY_URL", "").strip()
EDL_RISK_URL = os.getenv("EDL_RISK_URL", "").strip()  # 可选

# 可选：label -> 值映射（JSON 字符串）
VEG_MAP_JSON = os.getenv("VEG_MAP_JSON", "").strip()
DRY_MAP_JSON = os.getenv("DRY_MAP_JSON", "").strip()

# HTTP 超时（秒）
HTTP_TIMEOUT = float(os.getenv("HTTP_TIMEOUT", "15").strip() or 15)


def _env_float(key: str, default: float) -> float:
    raw = os.getenv(key, "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except Exception:
        return default


# —— 干燥程度调控（图像理解模式下的规则值；EasyDL 模式仅应用 scale/cap）——
# DRYNESS_FLOOR_MODE:
#   standard — 原「可燃物负荷」下限：dense 时干燥度易被抬到 ~0.5（偏保守火险）
#   soft     — 减弱下限，翠绿/高郁闭林相更接近「视觉干旱度」（默认）
#   off      — 关闭下限，干燥度完全来自干燥关键词命中
DRYNESS_FLOOR_MODE = os.getenv("DRYNESS_FLOOR_MODE", "soft").strip().lower()
# 干燥度整体倍率与上限（两种模式均生效，便于标定 EasyDL）
DRYNESS_SCALE = _env_float("DRYNESS_SCALE", 1.0)
DRYNESS_CAP = os.getenv("DRYNESS_CAP", "").strip()
# 识别到湿润/葱郁语义时压低干燥度（缓解「很绿但仍显示 0.5 干燥」）
_LDE = os.getenv("LUSH_DAMPEN_ENABLED", "true").strip().lower()
LUSH_DAMPEN_ENABLED = _LDE not in ("0", "false", "no", "off")
LUSH_DAMPEN_STRENGTH = _env_float("LUSH_DAMPEN_STRENGTH", 0.5)


def clamp01(x: Any) -> float:
    try:
        v = float(x)
    except Exception:
        return 0.0
    if v != v:  # NaN
        return 0.0
    return max(0.0, min(1.0, v))


# 综合风险线性加权：植被 0.5、干燥 0.5（等权；可按需改常量）
WEIGHT_VEGETATION_DENSITY = 0.5
WEIGHT_DRYNESS_LEVEL = 0.5


def calculate_comprehensive_risk(vegetation_density: float, dryness_level: float) -> float:
    """计算综合风险系数的线性加权和（不对入参做 clamp，由调用方统一 clamp01）。

    默认权重：植被 0.5、干燥 0.5。
    """
    return (
        WEIGHT_VEGETATION_DENSITY * float(vegetation_density)
        + WEIGHT_DRYNESS_LEVEL * float(dryness_level)
    )


def validate_risk_correlation(
    vegetation_density: float,
    dryness_sequence: Iterable[float] | None = None,
    *,
    strict_increasing: bool = True,
) -> bool:
    """
    校验：植被密度固定时，综合风险是否随干燥程度单调递增（正相关）。

    dryness_sequence 默认为 0.1, 0.2, …, 0.9。
    strict_increasing 为 False 时允许相邻点相等（非严格单调非降）。
    """
    if dryness_sequence is None:
        dryness_list: tuple[float, ...] = tuple(i / 10.0 for i in range(1, 10))
    else:
        dryness_list = tuple(float(x) for x in dryness_sequence)
    if len(dryness_list) < 2:
        return True
    risks = [calculate_comprehensive_risk(vegetation_density, d) for d in dryness_list]
    for prev, curr in zip(risks, risks[1:]):
        if strict_increasing:
            if not (prev < curr):
                return False
        else:
            if not (prev <= curr):
                return False
    return True


def risk_level_from_score(score: float) -> str:
    s = clamp01(score)
    if s < 0.25:
        return "低"
    if s < 0.5:
        return "中"
    if s < 0.75:
        return "高"
    return "危"


def parse_json_env(raw: str, fallback: Dict[str, float]) -> Dict[str, float]:
    if not raw:
        return fallback
    try:
        obj = json.loads(raw)
        if isinstance(obj, dict):
            out: Dict[str, float] = {}
            for k, v in obj.items():
                out[str(k)] = float(v)
            return out
    except Exception:
        pass
    return fallback


VEG_MAP = parse_json_env(VEG_MAP_JSON, {"sparse": 0.25, "medium": 0.55, "dense": 0.85})
DRY_MAP = parse_json_env(DRY_MAP_JSON, {"wet": 0.2, "normal": 0.55, "dry": 0.85})


def parse_list_env(raw: str, fallback: list[str]) -> list[str]:
    if not raw:
        return fallback
    try:
        obj = json.loads(raw)
        if isinstance(obj, list):
            return [str(x) for x in obj if str(x).strip()]
    except Exception:
        pass
    return fallback


DEFAULT_VEG_KEYS = [
    "forest",
    "tree",
    "trees",
    "vegetation",
    "grass",
    "bush",
    "woodland",
    "pine",
    "leaf",
    "leaves",
    "green",
    "树林",
    "森林",
    "树",
    "草地",
    "灌木",
    "植被",
    "叶子",
    "绿色",
]
DEFAULT_DRY_KEYS = [
    "dry",
    "drought",
    "withered",
    "dead grass",
    "straw",
    "yellow",
    "brown",
    "soil",
    "dust",
    "sunny",
    "autumn",
    "fall",
    "bare",
    "dead tree",
    "shrubland",
    "brush",
    "枯",
    "枯黄",
    "干燥",
    "干旱",
    "黄",
    "褐",
    "枯草",
    "落叶",
    "尘土",
    "裸土",
    "秋天",
    "冬季",
    "旱季",
    "荒山",
    "荒坡",
    "野地",
    "郊野",
    "枯枝",
    "枝干",
    "山坡",
    "旱",
    "沙地",
    "石砾",
]

# 湿润/葱郁/常绿视觉（用于压低「仅靠可燃物启发式抬上去的干燥度」）
DEFAULT_LUSH_KEYS = [
    "green",
    "lush",
    "moss",
    "grass",
    "meadow",
    "wet",
    "绿",
    "绿色",
    "翠绿",
    "青绿",
    "葱郁",
    "青翠",
    "湿润",
    "潮湿",
    "苔藓",
    "青苔",
    "绿草",
    "草坪",
]

RULE_VEG_KEYS = parse_list_env(RULE_VEG_KEYWORDS_JSON, DEFAULT_VEG_KEYS)
RULE_DRY_KEYS = parse_list_env(RULE_DRY_KEYWORDS_JSON, DEFAULT_DRY_KEYS)
RULE_LUSH_KEYS = parse_list_env(LUSH_KEYWORDS_JSON, DEFAULT_LUSH_KEYS)


@dataclass
class TokenCache:
    token: str = ""
    exp_ts: float = 0.0  # unix seconds

    def valid(self) -> bool:
        # 留 60 秒安全窗
        return bool(self.token) and (self.exp_ts - time.time() > 60)


TOKEN_CACHE = TokenCache()


def fail(message: str, code: int = 500) -> Tuple[Dict[str, Any], int]:
    body = {
        "success": False,
        "code": int(code),
        "message": message or "服务异常",
        "data": {
            "vegetation_density": 0.0,
            "dryness": 0.0,
            "risk_score": 0.0,
            "risk_level": "低",
        },
    }
    return body, 200


def ok(message: str, data: Dict[str, Any]) -> Tuple[Dict[str, Any], int]:
    body = {
        "success": True,
        "code": 200,
        "message": message or "分析成功",
        "data": data,
    }
    return body, 200


def get_access_token() -> str:
    if TOKEN_CACHE.valid():
        return TOKEN_CACHE.token

    if not BAIDU_API_KEY or not BAIDU_SECRET_KEY:
        raise RuntimeError("缺少 BAIDU_API_KEY / BAIDU_SECRET_KEY 环境变量")

    url = "https://aip.baidubce.com/oauth/2.0/token"
    params = {
        "grant_type": "client_credentials",
        "client_id": BAIDU_API_KEY,
        "client_secret": BAIDU_SECRET_KEY,
    }

    r = requests.get(url, params=params, timeout=HTTP_TIMEOUT)
    r.raise_for_status()
    js = r.json()
    token = js.get("access_token", "")
    expires_in = float(js.get("expires_in", 0) or 0)  # seconds
    if not token:
        raise RuntimeError("获取 access_token 失败")

    TOKEN_CACHE.token = token
    TOKEN_CACHE.exp_ts = time.time() + max(300.0, expires_in)
    return token


def easydl_url_with_token(model_url: str, token: str) -> str:
    if "?" in model_url:
        return f"{model_url}&access_token={token}"
    return f"{model_url}?access_token={token}"


def parse_easydl_top1(js: Dict[str, Any]) -> Tuple[str, float]:
    # 常见结构：{"results":[{"name":...,"score":...}, ...]}
    arr = js.get("results") or js.get("result") or (js.get("data") or {}).get("results") or []
    if not isinstance(arr, list) or not arr:
        return "", 0.0
    top = arr[0] or {}
    label = str(top.get("name") or top.get("label") or top.get("class_name") or "").strip()
    score = clamp01(top.get("score") or top.get("probability") or top.get("confidence") or 0)
    return label, score


def call_easydl(model_url: str, image_b64: str) -> Dict[str, Any]:
    token = get_access_token()
    url = easydl_url_with_token(model_url, token)
    r = requests.post(url, json={"image": image_b64, "top_num": 1}, timeout=HTTP_TIMEOUT)
    r.raise_for_status()
    js = r.json()
    if js.get("error_code"):
        raise RuntimeError(f"Baidu error {js.get('error_code')}: {js.get('error_msg') or 'unknown'}")
    return js


def map_label_to_value(label: str, score: float, mapping: Dict[str, float], default_value: float) -> float:
    base = float(mapping.get(label, default_value))
    v = clamp01(base)
    s = clamp01(score)
    # 用置信度轻微拉近（避免输出完全离散）
    return clamp01(v * (0.75 + 0.25 * s))


def call_image_understanding(image_b64: str) -> Dict[str, Any]:
    token = get_access_token()
    url = easydl_url_with_token(IMAGE_UNDERSTANDING_URL, token)
    # 通用物体和场景识别-高级：application/x-www-form-urlencoded
    r = requests.post(
        url,
        data={"image": image_b64},
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=HTTP_TIMEOUT,
    )
    r.raise_for_status()
    js = r.json()
    if js.get("error_code"):
        raise RuntimeError(f"Baidu error {js.get('error_code')}: {js.get('error_msg') or 'unknown'}")
    return js


def pick_text_from_understanding(js: Dict[str, Any]) -> str:
    """
    兼容“通用物体和场景识别-高级”返回：
      {
        "result":[{"keyword":"森林","score":0.7,"root":"自然风景"}, ...]
      }
    """
    parts: list[str] = []
    arr = js.get("result")
    if isinstance(arr, list):
        for it in arr[:12]:
            if not isinstance(it, dict):
                continue
            kw = it.get("keyword")
            root = it.get("root")
            if isinstance(root, str) and root.strip():
                parts.append(root.strip())
            if isinstance(kw, str) and kw.strip():
                parts.append(kw.strip())
    # 兜底：有些接口字段名可能为 results
    arr2 = js.get("results")
    if isinstance(arr2, list):
        for it in arr2[:12]:
            if not isinstance(it, dict):
                continue
            kw = it.get("keyword") or it.get("name")
            root = it.get("root")
            if isinstance(root, str) and root.strip():
                parts.append(root.strip())
            if isinstance(kw, str) and kw.strip():
                parts.append(kw.strip())
    return " ".join(parts).strip()


def score_from_labels(js: Dict[str, Any], keys: list[str]) -> float:
    """
    从 advanced_general 的标签结果中按 score 加权累计。
    js.result: [{ "keyword": "...", "root": "...", "score": 0~1 }, ...]
    """
    items = js.get("result")
    if not isinstance(items, list) or not items:
        # 兜底：某些情况下字段名可能为 results
        items = js.get("results")
    if not isinstance(items, list) or not items:
        return 0.0

    keyset = {str(k).lower().strip() for k in keys if str(k).strip()}
    if not keyset:
        return 0.0

    total = 0.0
    for it in items[:30]:
        if not isinstance(it, dict):
            continue
        kw = str(it.get("keyword") or it.get("name") or "").lower().strip()
        root = str(it.get("root") or "").lower().strip()
        s = clamp01(it.get("score") or it.get("probability") or it.get("confidence") or 0)
        if not kw and not root:
            continue

        # 关键词命中：keyword 或 root 命中都算
        hit = (kw in keyset) or (root in keyset)
        if not hit:
            # 允许子串命中（例如 "枯草地" 包含 "枯草"）
            for k in keyset:
                if (k and k in kw) or (k and k in root):
                    hit = True
                    break
        if hit:
            # 部分返回里没有 score 字段，给默认权重避免总和恒为 0
            if s < 1e-6:
                s = 0.35
            total += s

    # 饱和函数：score 累加后用 1-exp(-x) 映射到 0~1，更平滑
    return clamp01(1.0 - math.exp(-total))


def apply_dryness_post_processing(
    dryness: float,
    vegetation_density: float,
    *,
    understanding_js: Optional[Dict[str, Any]] = None,
) -> float:
    """
    干燥程度标定：图像理解模式可启用「可燃物下限 + 葱郁降干燥」；EasyDL 仅做倍率/封顶。

    understanding_js 为 None 时（EasyDL 分支）跳过关键词类启发式，只应用 DRYNESS_SCALE / DRYNESS_CAP。
    """
    d = clamp01(dryness)

    if understanding_js is not None and DRYNESS_FLOOR_MODE != "off":
        if vegetation_density >= 0.06 and d < 0.12:
            if DRYNESS_FLOOR_MODE == "standard":
                dryness_floor = clamp01(0.14 + 0.55 * vegetation_density)
            elif DRYNESS_FLOOR_MODE == "soft":
                dryness_floor = clamp01(0.06 + 0.28 * vegetation_density)
            else:
                dryness_floor = 0.0
            d = max(d, dryness_floor)

    if (
        understanding_js is not None
        and LUSH_DAMPEN_ENABLED
        and vegetation_density >= 0.35
    ):
        lush = score_from_labels(understanding_js, RULE_LUSH_KEYS)
        if lush > 1e-6:
            d = clamp01(d * (1.0 - LUSH_DAMPEN_STRENGTH * lush))

    d = clamp01(d * DRYNESS_SCALE)
    if DRYNESS_CAP:
        d = min(d, clamp01(float(DRYNESS_CAP)))
    return clamp01(d)


def compute_risk_from_understanding(js: Dict[str, Any]) -> tuple[Dict[str, Any], str]:
    """
    规则计算：
    - vegetation_density：植被相关标签 score 加权
    - dryness：干燥/枯黄/落叶/裸土相关标签 score 加权
    - risk_score：calculate_comprehensive_risk（植被 0.5 + 干燥 0.5）再 clamp 到 0~1
    """
    text = pick_text_from_understanding(js)

    vegetation_density = score_from_labels(js, RULE_VEG_KEYS)
    dryness = score_from_labels(js, RULE_DRY_KEYS)

    t = (text or "").lower()
    art_like = any(
        x in t
        for x in ["非自然图像", "艺术", "插画", "绘画", "卡通", "素材", "模糊图片", "art", "chinese painting"]
    )
    has_real_veg = any(
        x in t
        for x in ["植物", "树", "林", "forest", "tree", "vegetation", "灌木", "草地"]
    )

    # 误识别为「艺术画」但仍有明显植被标签时：只做轻度降权（真实林相照片常被误判）
    if art_like and has_real_veg:
        vegetation_density = clamp01(vegetation_density * 0.75)
        dryness = clamp01(dryness * 0.85)
    elif art_like:
        vegetation_density = clamp01(vegetation_density * 0.4)
        dryness = clamp01(dryness * 0.4)

    dryness = apply_dryness_post_processing(
        dryness, vegetation_density, understanding_js=js
    )

    risk_score = clamp01(calculate_comprehensive_risk(vegetation_density, dryness))
    risk_level = risk_level_from_score(risk_score)

    message = f"识别摘要：{text}" if text else "已完成通用识别分析。"
    return (
        {
            "vegetation_density": float(vegetation_density),
            "dryness": float(dryness),
            "risk_score": float(risk_score),
            "risk_level": risk_level,
        },
        message,
    )


@app.post("/api/forest/risk/analyze")
def analyze():
    try:
        body = request.get_json(silent=True) or {}
        img = str(body.get("image") or "").strip()
        typ = str(body.get("type") or "").strip()

        if typ != "forest_fire_risk":
            resp, _ = fail("type 必须为 forest_fire_risk", 400)
            return jsonify(resp)
        if not img:
            resp, _ = fail("image 不能为空", 400)
            return jsonify(resp)
        # 简单防呆：如果用户传了 data 前缀，帮他去掉
        if img.startswith("data:image"):
            # data:image/jpeg;base64,xxxx
            parts = img.split(",", 1)
            img = parts[1] if len(parts) == 2 else ""
        if not img:
            resp, _ = fail("image 格式不正确", 400)
            return jsonify(resp)

        if USE_IMAGE_UNDERSTANDING:
            ujs = call_image_understanding(img)
            data, msg = compute_risk_from_understanding(ujs)
            resp, _ = ok(msg, data)
            return jsonify(resp)

        if not EDL_VEG_URL or not EDL_DRY_URL:
            resp, _ = fail("服务未配置：请设置 EDL_VEG_URL 与 EDL_DRY_URL，或设置 USE_IMAGE_UNDERSTANDING=true 使用现成接口", 500)
            return jsonify(resp)

        veg_js = call_easydl(EDL_VEG_URL, img)
        dry_js = call_easydl(EDL_DRY_URL, img)
        veg_label, veg_score = parse_easydl_top1(veg_js)
        dry_label, dry_score = parse_easydl_top1(dry_js)

        vegetation_density = map_label_to_value(veg_label, veg_score, VEG_MAP, 0.55)
        dryness = map_label_to_value(dry_label, dry_score, DRY_MAP, 0.55)
        dryness = apply_dryness_post_processing(
            dryness, vegetation_density, understanding_js=None
        )

        risk_score = clamp01(calculate_comprehensive_risk(vegetation_density, dryness))
        risk_level = risk_level_from_score(risk_score)

        # 可选风险模型：有则用其结果微调
        if EDL_RISK_URL:
            risk_js = call_easydl(EDL_RISK_URL, img)
            r_label, r_score = parse_easydl_top1(risk_js)
            if r_label in ("低", "中", "高", "危"):
                risk_level = r_label
                risk_score = clamp01(risk_score * 0.6 + clamp01(r_score) * 0.4)
            else:
                risk_score = clamp01(risk_score * 0.7 + clamp01(r_score) * 0.3)
                risk_level = risk_level_from_score(risk_score)

        data = {
            "vegetation_density": float(vegetation_density),
            "dryness": float(dryness),
            "risk_score": float(risk_score),
            "risk_level": risk_level,
        }
        resp, _ = ok("已完成 AI 风险评估（百度 EasyDL）。", data)
        return jsonify(resp)
    except requests.HTTPError as e:
        resp, _ = fail(f"百度接口请求失败：{str(e)}", 500)
        return jsonify(resp)
    except Exception as e:
        resp, _ = fail(str(e) or "服务异常", 500)
        return jsonify(resp)


@app.get("/api/forest/risk/points")
def list_fire_risk_points():
    """小程序热力图（旧）：{ success, data: { points } }"""
    with _fire_points_lock:
        pts = list(_read_fire_points_unlocked())
    resp, _ = ok("ok", {"points": pts})
    return jsonify(resp)


@app.post("/api/fire-risk/point")
def post_fire_risk_point():
    """
    小程序火险落点：经纬度 + 风险系数。
    兼容字段：lat/lng/risk 或 latitude/longitude/risk_score
    """
    body = request.get_json(silent=True) or {}
    lat_raw = body.get("latitude", body.get("lat"))
    lng_raw = body.get("longitude", body.get("lng"))
    risk_raw = body.get("risk_score", body.get("risk"))
    try:
        la = float(lat_raw)
        lo = float(lng_raw)
        rk = float(risk_raw if risk_raw is not None else 0.0)
    except (TypeError, ValueError):
        return jsonify({"code": 400, "message": "latitude/longitude/risk_score 无效", "data": None})
    if not (-90.0 <= la <= 90.0 and -180.0 <= lo <= 180.0):
        return jsonify({"code": 400, "message": "经纬度超出范围", "data": None})
    rl = body.get("risk_level")
    record_fire_risk_map_point(
        la,
        lo,
        risk_score=rk,
        vegetation_density=body.get("vegetation_density"),
        dryness=body.get("dryness"),
        risk_level=(str(rl) if rl is not None else None),
    )
    return jsonify({"code": 200, "message": "ok", "data": True})


@app.get("/api/fire-risk/points")
def get_fire_risk_points():
    """
    热力图全量点位（新约定）：
    { "code": 200, "data": [ { "lat", "lng", "risk" }, ... ] }
    """
    with _fire_points_lock:
        rows = list(_read_fire_points_unlocked())
    out: list[dict[str, float]] = []
    for p in rows:
        try:
            la = float(p.get("latitude") if "latitude" in p else p.get("lat", 0))
            lo = float(p.get("longitude") if "longitude" in p else p.get("lng", 0))
            rk = float(p.get("risk_score") if "risk_score" in p else p.get("risk", 0))
            out.append({"lat": la, "lng": lo, "risk": clamp01(rk)})
        except (TypeError, ValueError):
            continue
    return jsonify({"code": 200, "data": out})


@app.get("/healthz")
def healthz():
    return jsonify({"ok": True})


@app.post("/fire_report")
def fire_report():
    """
    火情上报接口：
    - JSON: images 为 base64 数组
    - multipart/form-data: images 文件列表
    """
    try:
        location = ""
        report_time = ""
        status = "submitted"
        images: list[str] = []

        if request.is_json:
            body = request.get_json(silent=True) or {}
            location = str(body.get("location") or "").strip()
            report_time = str(body.get("report_time") or body.get("reportTime") or "").strip()
            status = str(body.get("status") or "submitted").strip() or "submitted"
            raw_images = body.get("images") or []
            if isinstance(raw_images, list):
                images = [str(x) for x in raw_images if str(x).strip()]
        else:
            location = str(request.form.get("location") or "").strip()
            report_time = str(request.form.get("report_time") or request.form.get("reportTime") or "").strip()
            status = str(request.form.get("status") or "submitted").strip() or "submitted"
            file_list = request.files.getlist("images")
            if not file_list and request.files.get("image"):
                file_list = [request.files.get("image")]
            for f in file_list:
                if not f:
                    continue
                b = f.read() or b""
                if b:
                    images.append(base64.b64encode(b).decode("utf-8"))

        if not location:
            return jsonify({"code": 400, "message": "location 不能为空", "data": None})
        if not report_time:
            report_time = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())
        if not images:
            return jsonify({"code": 400, "message": "images 不能为空", "data": None})

        rid = insert_fire_report(location, images[:3], report_time, status)
        return jsonify({"code": 200, "message": "ok", "data": {"id": rid}})
    except Exception as e:
        return jsonify({"code": 500, "message": str(e) or "服务异常", "data": None})


@app.post("/emergency_trigger")
def emergency_trigger():
    """
    紧急上报成功后由小程序调用：
    - 将全局报警状态置为 1
    """
    global _alarm_status
    _ = request.get_json(silent=True) or {}
    with _alarm_lock:
        _alarm_status = 1
    return jsonify({"code": 200, "message": "alarm triggered", "alarm_status": 1})


@app.get("/alarm")
def alarm_poll():
    """
    供 ESP32 轮询：
    - 返回当前 alarm_status（0/1）
    - 若读取到 1，返回后自动复位为 0
    """
    global _alarm_status
    with _alarm_lock:
        current = int(_alarm_status)
        if _alarm_status == 1:
            _alarm_status = 0
    return jsonify({"code": 200, "alarm": current})


if __name__ == "__main__":
    # 开发环境启动：python app.py
    # 生产建议：gunicorn -w 2 -b 0.0.0.0:8000 app:app
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "8000")), debug=True)

