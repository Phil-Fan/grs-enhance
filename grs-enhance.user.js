// ==UserScript==
// @name         GRS Enhance — 浙大研究生选课助手
// @namespace    grs-enhance
// @version      2.0
// @description  浙大研究生选课页面:排队位次内联显示在课程表格旁,悬停徽章可对比同课程各教学班排队情况并一键换班;课表悬浮窗完整显示、可折叠缩放
// @author       philfan
// @match        https://yjsy.zju.edu.cn/*
// @run-at       document-idle
// @grant        none
// @noframes
// @license     MIT
// ==/UserScript==
/*
 * Copyright (c) 2026 philfan
 * Released under the MIT License — see LICENSE file.
 */

(function () {
  "use strict";

  /* ==================== 配置 ==================== */
  var BASE = "/dataapi";
  var AUTO_REFRESH_MS = 60000; // 排队位次自动刷新间隔

  // 只在选课页面(dm=py_xsxk)注入
  if (!/[?&]dm=py_xsxk(&|$)/.test(location.search)) return;

  /* ==================== MD5 (RFC 1321, 标准实现) ==================== */
  var MD5_K = new Uint32Array(64);
  (function () {
    for (var i = 0; i < 64; i++) MD5_K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296);
  })();
  var MD5_S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
  function md5(str) {
    // UTF-8 编码为字节
    var s = unescape(encodeURIComponent(str));
    var bytes = [];
    for (var i = 0; i < s.length; i++) bytes.push(s.charCodeAt(i) & 0xff);
    var bitLenLo = bytes.length * 8; // 消息 < 512MB 时高位恒为 0
    // 填充
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (var i = 0; i < 4; i++) bytes.push((bitLenLo >>> (8 * i)) & 0xff);
    bytes.push(0, 0, 0, 0);
    // 主循环
    var a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    var M = new Uint32Array(16);
    for (var chunk = 0; chunk < bytes.length; chunk += 64) {
      for (var j = 0; j < 16; j++) {
        var o = chunk + j * 4;
        M[j] = (bytes[o]) | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24);
      }
      var A = a0, B = b0, C = c0, D = d0;
      for (var i2 = 0; i2 < 64; i2++) {
        var F, g;
        if (i2 < 16) { F = (B & C) | (~B & D); g = i2; }
        else if (i2 < 32) { F = (D & B) | (~D & C); g = (5 * i2 + 1) % 16; }
        else if (i2 < 48) { F = B ^ C ^ D; g = (3 * i2 + 5) % 16; }
        else { F = C ^ (B | ~D); g = (7 * i2) % 16; }
        F = (F + A + MD5_K[i2] + M[g]) | 0;
        A = D; D = C; C = B;
        B = (B + ((F << MD5_S[i2]) | (F >>> (32 - MD5_S[i2])))) | 0;
      }
      a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
    }
    function le(n) {
      var out = "";
      for (var i = 0; i < 4; i++) {
        var b = (n >>> (8 * i)) & 0xff;
        out += (b < 16 ? "0" : "") + b.toString(16);
      }
      return out;
    }
    return le(a0) + le(b0) + le(c0) + le(d0);
  }

  /* ==================== API 封装 ==================== */
  // 签名盐不硬编码在脚本里: 运行时从站点主程序资源(app.*.js)提取。
  // 特征: var X="33位[0-9a-v]字符串" 在整个 bundle 中唯一命中(已实测验证)
  var secretCache = null;
  function loadSecret() {
    if (secretCache) return Promise.resolve(secretCache);
    var src = null;
    Array.prototype.forEach.call(document.scripts, function (s) {
      if (!src && s.src && /\/app\.[\w.-]+\.js(\?|$)/.test(s.src)) src = s.src;
    });
    if (!src) {
      performance.getEntriesByType("resource").some(function (e) {
        if (/\/app\.[\w.-]+\.js(\?|$)/.test(e.name)) { src = e.name; return true; }
        return false;
      });
    }
    if (!src) return Promise.reject(new Error("未找到站点主程序资源"));
    return fetch(src).then(function (r) { return r.text(); }).then(function (t) {
      var m = t.match(/var [a-zA-Z_$]{1,3}="[0-9a-v]{33}"/);
      if (!m) throw new Error("提取签名盐失败(站点资源结构可能已更新)");
      secretCache = m[0].split('"')[1];
      return secretCache;
    });
  }
  function getToken() {
    try { return JSON.parse(localStorage.getItem("pro__Access-Token")).value; }
    catch (e) { return null; }
  }
  function timestamp() {
    var d = new Date(), p = function (n) { return (n < 10 ? "0" : "") + n; };
    return "" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }
  // path: "/py/pyXsxk/xxx"; params: 查询参数对象(仅参与签名); method: "GET"|"POST"; body: POST 的 JSON body(不参与签名)
  function callApi(path, params, method, retries, body) {
    retries = retries == null ? 2 : retries;
    var token = getToken();
    if (!token) return Promise.reject(new Error("未读取到登录 Token,请确认已登录"));

    return loadSecret().then(function (SECRET) {
    var sorted = {};
    Object.keys(params).sort().forEach(function (k) { sorted[k] = params[k]; });
    var sign = md5(JSON.stringify(sorted) + SECRET).toUpperCase();
    var qs = new URLSearchParams(params).toString();

    function attempt(left) {
      return fetch(BASE + path + (qs ? "?" + qs : ""), {
        method: method || "GET",
        headers: {
          "X-Access-Token": token,
          "X-Sign": sign,
          "X-TIMESTAMP": timestamp(),
          "tenant-id": "0",
          "Content-Type": "application/json"
        },
        body: body ? JSON.stringify(body) : undefined
      }).then(function (r) { return r.text(); }).then(function (txt) {
        var data;
        try { data = JSON.parse(txt); } catch (e) { throw new Error("响应解析失败: " + txt.slice(0, 120)); }
        if (data && data.success) return data;
        if ((data && (data.code === 401 || /token/i.test(data.message || ""))) || !data) throw new Error((data && data.message) || "请求失败");
        // success=false 但非鉴权问题:返回数据由调用方判断
        return data;
      }).catch(function (err) {
        if (left > 0) return new Promise(function (r) { setTimeout(r, 1000); }).then(function () { return attempt(left - 1); });
        throw err;
      });
    }
    return attempt(retries);
    });
  }

  /* ==================== 数据加载 ==================== */
  // 我的课程(计划内 + 计划外 + 补修)
  function loadMyCourses() {
    return callApi("/py/pyXsxk/queryXsxkByXnxqXs", {}, "POST").then(function (d) {
      var r = (d && d.result) || {};
      var all = [].concat(r.xxjhnList || [], r.xxjhwList || [], r.pyBkkcXsxkList || []);
      var any = all.find(function (x) { return x.xn && x.xq; }) || {};
      return {
        xn: any.xn || String(new Date().getFullYear()), // 兜底:9月及以后按当年
        selected: all.filter(function (x) { return x.xkzt === "14"; }),
        pending: all.filter(function (x) { return x.xkzt === "12"; })
      };
    });
  }
  // 某班级候选(待处理)队列: 同时展示服务器返回顺序与 createTime 升序, 供交叉参考
  function loadQueue(kcbjId) {
    return callApi("/py/pyXsxk/queryDclXsListByKcbjId", { kcbjId: kcbjId }, "POST").then(function (d) {
      return (d && d.result) || [];
    });
  }
  // 课表: pkxq 13=秋 14=冬, 合并即完整秋冬学期; 返回 {cells, xn}
  function loadKb(xn) {
    var mkCell = function (c) {
      return {
        kcmc: c.kcmc, teacher: c.xm, room: c.cdmc, campus: c.xqmc,
        xqj: c.xqj, ksjc: c.ksjc, jsjc: c.jsjc,
        zc: (c.zc || "").split(",").filter(Boolean),
        dszMc: c.dszMc || "", pkxqMc: c.pkxqMc || "",
        xkzt: c.xkzt, bjbh: c.bjbh, xf: c.xf
      };
    };
    return Promise.all([
      callApi("/py/pyKcbj/queryXskbByLoginUser", { xn: xn, pkxq: "13" }),
      callApi("/py/pyKcbj/queryXskbByLoginUser", { xn: xn, pkxq: "14" })
    ]).then(function (rs) {
      var cells = [];
      rs.forEach(function (d) {
        var kcbMap = (d && d.result && d.result.kcbMap) || {};
        Object.keys(kcbMap).forEach(function (xqj) {
          Object.keys(kcbMap[xqj]).forEach(function (jc) {
            var list = kcbMap[xqj][jc].pyKcbjSjddVOList || [];
            list.forEach(function (c) { cells.push(mkCell(c)); });
          });
        });
      });
      return cells;
    });
  }

  /* ==================== UI(Shadow DOM 隔离) ==================== */
  var host = document.createElement("div");
  host.id = "zju-xsxk-helper-host";
  host.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:2147483646;";
  document.body.appendChild(host);
  var root = host.attachShadow({ mode: "closed" });

  var CSS = [
    "*{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;}",
    ".panel{width:auto;min-width:300px;max-width:calc(100vw - 40px);min-height:110px;max-height:calc(100vh - 40px);display:flex;flex-direction:column;resize:both;overflow:hidden;background:#fff;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.18);border:1px solid #e5e7eb;}",
    ".panel.min .body,.panel.min .foot{display:none;}",
    ".panel.min .head #btnRefresh{display:none;}",
    ".panel.min{resize:none;min-width:0;min-height:0;width:auto;height:auto;}",
    ".head{flex:0 0 auto;}",
    ".foot{flex:0 0 auto;}",
    ".head{display:flex;align-items:center;gap:8px;padding:10px 12px;background:linear-gradient(135deg,#1e3a8a,#2563eb);color:#fff;cursor:move;user-select:none;}",
    ".head .title{font-size:13px;font-weight:600;flex:1;}",
    ".head button{background:none;border:none;color:#fff;cursor:pointer;width:26px;height:26px;padding:0;display:inline-flex;align-items:center;justify-content:center;border-radius:4px;font-size:14px;line-height:1;font-family:inherit;}",
    ".head button:hover{background:rgba(255,255,255,.2);}",
    ".body{flex:1 1 auto;overflow:auto;padding:10px 12px;}",
    ".sec{margin-bottom:10px;}",
    ".sec h4{font-size:12px;color:#475569;margin-bottom:6px;display:flex;align-items:center;gap:6px;}",
    ".dot{width:8px;height:8px;border-radius:50%;display:inline-block;}",
    ".dot.p{background:#f59e0b;}.dot.s{background:#3b82f6;}",
    ".card{border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px;margin-bottom:6px;background:#fff;}",
    ".card .name{font-size:13px;font-weight:600;color:#0f172a;line-height:1.4;}",
    ".card .meta{font-size:11.5px;color:#64748b;margin-top:3px;line-height:1.5;}",
    ".pos{font-size:15px;font-weight:700;color:#d97706;margin-top:4px;}",
    ".pos.ok{color:#059669;}",
    ".card.q{border-left:3px solid #f59e0b;}",
    ".card.s{border-left:3px solid #3b82f6;}",
    ".foot{display:flex;align-items:center;justify-content:space-between;padding:6px 12px;border-top:1px solid #e5e7eb;font-size:11px;color:#94a3b8;background:#f8fafc;}",
    ".foot button{border:1px solid #cbd5e1;background:#fff;border-radius:6px;padding:2px 10px;font-size:11px;color:#475569;cursor:pointer;}",
    ".foot button:hover{border-color:#2563eb;color:#2563eb;}",
    ".spin{color:#94a3b8;font-size:12px;text-align:center;padding:24px 0;}",
    ".err{color:#dc2626;font-size:12px;padding:12px;text-align:center;}",
    ".badge{display:inline-block;font-size:10px;padding:1px 6px;border-radius:10px;background:#fef3c7;color:#b45309;margin-left:6px;vertical-align:1px;}",
    /* 课表: 窗口宽度自适应课表, 无横向滚动条(小屏兜底才滚动) */
    ".kbwrap{overflow-x:auto;}",
    "table.kb{border-collapse:collapse;width:auto;table-layout:fixed;}",
    ".kb th:not(:first-child){width:86px;}",
    ".kb th,.kb td{border:1px solid #e2e8f0;font-size:10px;text-align:center;vertical-align:middle;padding:2px;}",
    ".kb th{background:#f1f5f9;color:#475569;font-weight:600;height:24px;}",
    ".kb td.jc{width:34px;color:#94a3b8;background:#f8fafc;font-size:10px;}",
    ".kb .cell{border-radius:4px;padding:3px 2px;line-height:1.35;overflow:hidden;height:100%;color:#fff;text-align:left;}",
    ".kb .cell.q{background:#f59e0b;}",
    ".kb .cell.s{background:#3b82f6;}",
    ".kb .cell .cn{font-weight:600;font-size:10.5px;display:block;}",
    ".kb .cell .ci{font-size:9.5px;opacity:.92;display:block;}",
    ".legend{display:flex;gap:10px;font-size:10.5px;color:#64748b;margin:8px 0 6px;align-items:center;}",
    ".lg-dot{width:10px;height:10px;border-radius:3px;display:inline-block;margin-right:3px;vertical-align:-1px;}"
  ].join("");

  root.innerHTML =
    '<style>' + CSS + "</style>" +
    '<div class="panel" id="panel">' +
    '  <div class="head" id="head">' +
    '    <span class="title">课程表</span>' +
    '    <button id="btnRefresh" title="刷新课表">↻</button>' +
    '    <button id="btnMin" title="折叠成小卡片">—</button>' +
    "  </div>" +
    '  <div class="body" id="body"><div class="spin">课表加载中…</div></div>' +
    '  <div class="foot"><span id="stamp">—</span></div>' +
    "</div>";

  var el = function (id) { return root.getElementById(id); };
  // attachShadow({mode:"closed"}) 的 getElementById 可用(shadow root 实现 Document 接口)
  var panelEl = root.getElementById("panel");
  var bodyEl = root.getElementById("body");
  var stampEl = root.getElementById("stamp");

  root.getElementById("btnRefresh").addEventListener("click", function () {
    bodyEl.innerHTML = '<div class="spin">课表加载中…</div>';
    renderKb();
  });
  var btnMinEl = root.getElementById("btnMin");
  function setMin(min) {
    panelEl.classList.toggle("min", min);
    btnMinEl.textContent = min ? "⤢" : "—";
    btnMinEl.title = min ? "展开" : "折叠成小卡片";
  }
  btnMinEl.addEventListener("click", function () {
    setMin(!panelEl.classList.contains("min"));
  });

  /* ---------- 拖动 + 点小卡片展开 ---------- */
  (function () {
    var headEl = root.getElementById("head"), dragging = false, sx = 0, sy = 0, ox = 0, oy = 0;
    headEl.addEventListener("mousedown", function (e) {
      if (e.target.tagName === "BUTTON") return;
      dragging = true;
      var r = host.getBoundingClientRect();
      sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
      e.preventDefault();
    });
    document.addEventListener("mousemove", function (e) {
      if (!dragging) return;
      var x = ox + e.clientX - sx, y = oy + e.clientY - sy;
      host.style.left = Math.max(0, Math.min(window.innerWidth - 80, x)) + "px";
      host.style.top = Math.max(0, Math.min(window.innerHeight - 40, y)) + "px";
      host.style.right = "auto"; host.style.bottom = "auto";
    });
    document.addEventListener("mouseup", function (e) {
      // 折叠态下点击(位移很小) → 展开回默认大小
      if (dragging && panelEl.classList.contains("min") &&
        Math.abs(e.clientX - sx) + Math.abs(e.clientY - sy) < 4) {
        setMin(false);
      }
      dragging = false;
    });
  })();

  /* ---------- 位次渲染 ---------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  var lastPos = {}; // kcbjId -> 上次位次, 用于变化提示
  var posByKcbh = {}; // kcbh -> 位次数据, 用于内联注入主表格

  /* ---------- 位次内联注入("个人学习计划"课程表格的选课状态旁) ---------- */
  var BADGE_ATTR = "data-xsxk-pos";
  function makeBadge(d) {
    var b = document.createElement("span");
    b.setAttribute(BADGE_ATTR, "1");
    b.setAttribute("data-k", d.kcbh || "");
    if (d.selected) {
      // 已选课(正在修读): 蓝色徽章, hover 对比各教学班, 可一键换班
      b.style.cssText = "display:inline-block;margin-left:6px;padding:1px 8px;border-radius:10px;" +
        "background:#dbeafe;color:#1d4ed8;font-size:12px;font-weight:600;white-space:nowrap;vertical-align:1px;" +
        "cursor:help;";
      b.textContent = "⇄ 班级对比";
      b.title = "悬停对比各教学班, 可一键换班";
      return b;
    }
    var dir = d.changed === "up" ? " ↑前进" : d.changed === "down" ? " ↓后移" : "";
    var timeText = d.timePos != null ? " · 时间 " + d.timePos + "/" + d.total : "";
    b.style.cssText = "display:inline-block;margin-left:6px;padding:1px 8px;border-radius:10px;" +
      "background:#fef3c7;color:#b45309;font-size:12px;font-weight:600;white-space:nowrap;vertical-align:1px;" +
      "cursor:help;";
    b.textContent = "排队 接口 " + d.pos + "/" + d.total + timeText + dir + " ";
    var q = document.createElement("span");
    q.setAttribute("data-xsxk-rank-help", "1");
    q.style.cssText = "display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;" +
      "border-radius:50%;background:#fde68a;color:#92400e;font-size:10px;font-weight:700;vertical-align:1px;";
    q.textContent = "?";
    q.title = "接口顺序: queryDclXsListByKcbjId 返回数组的原始顺序。时间顺序: 按 createTime 从早到晚排序。学校未公开最终处理排序,两者仅供参考。";
    b.appendChild(q);
    return b;
  }
  function injectInlineBadges() {
    // 表格存在 rowSpan 合并(如"必修"列纵向合并), 被覆盖行会少渲染 td,
    // 按表头索引取列会错位; 故改用整行文本匹配课程编号, 徽章挂到含"待处理"的状态单元格
    Array.prototype.forEach.call(document.querySelectorAll(".ant-table-tbody tr"), function (tr) {
      var rowText = tr.textContent || "";
      var kcbhHit = null;
      Object.keys(posByKcbh).forEach(function (k) { if (rowText.indexOf(k) >= 0) kcbhHit = k; });
      var ztTd = null, old = tr.querySelector("span[" + BADGE_ATTR + "]");
      if (kcbhHit) {
        var want = posByKcbh[kcbhHit].selected ? "正在修读" : "待处理";
        Array.prototype.forEach.call(tr.querySelectorAll("td"), function (td) {
          if (!ztTd && td.textContent.indexOf(want) >= 0) ztTd = td;
        });
        // 兜底: 状态列文案变化时挂到任一状态单元格
        if (!ztTd) Array.prototype.forEach.call(tr.querySelectorAll("td"), function (td) {
          if (!ztTd && (td.textContent.indexOf("正在修读") >= 0 || td.textContent.indexOf("待处理") >= 0)) ztTd = td;
        });
      }
      if (!ztTd) { if (old) old.remove(); return; }
      var badge = makeBadge(posByKcbh[kcbhHit]);
      // 幂等: 内容未变(且是本版本徽章, 带 data-k)则不动, 避免 MutationObserver 自激励;
      // 旧版本(Tampermonkey ≤1.2)创建的无 data-k 徽章会被这里替换接管
      if (old && old.textContent === badge.textContent && old.hasAttribute("data-k")) return;
      if (old) old.replaceWith(badge); else ztTd.appendChild(badge);
    });
  }
  // 表格重渲染(Vue/antd 刷新)后自动重新注入
  var injectTimer = null;
  var tableObserver = new MutationObserver(function (muts) {
    var allOurs = muts.every(function (m) {
      return m.removedNodes.length === 0 && Array.prototype.every.call(m.addedNodes, function (n) {
        return n.nodeType === 1 && n.hasAttribute && n.hasAttribute(BADGE_ATTR);
      });
    });
    if (allOurs) return;
    clearTimeout(injectTimer);
    injectTimer = setTimeout(injectInlineBadges, 400);
  });

  /* ---------- hover 徽章: 同课程各教学班排队对比 ---------- */
  var TIP_ID = "zju-xsxk-tip";
  var kcbjCache = {}; // kcbh -> { t: 毫秒, items: [班级] }
  var tipEl = null, tipHideTimer = null, tipFor = null;

  function getTipEl() {
    if (tipEl && document.getElementById(TIP_ID)) return tipEl;
    tipEl = document.createElement("div");
    tipEl.id = TIP_ID;
    tipEl.style.cssText = "position:fixed;z-index:2147483647;display:none;background:#fff;" +
      "border:1px solid #cbd5e1;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,.18);" +
      "padding:10px 12px;font-size:12px;color:#0f172a;max-height:340px;overflow-y:auto;" +
      "min-width:330px;max-width:430px;line-height:1.5;";
    document.body.appendChild(tipEl);
    tipEl.addEventListener("mouseenter", function () { clearTimeout(tipHideTimer); });
    tipEl.addEventListener("mouseleave", hideTip);
    tipEl.addEventListener("click", function (e) {
      var t = e.target;
      var btn = t && t.closest ? t.closest("button[data-bj]") : null;
      if (!btn) return;
      var id = btn.getAttribute("data-bj");
      var item = null;
      tipItems.forEach(function (x) { if (x.id === id) item = x; });
      var d = posByKcbh[tipKcbh];
      if (item && d) switchClass(d, item);
    });
    return tipEl;
  }
  function hideTip() {
    if (tipEl) tipEl.style.display = "none";
    tipFor = null;
  }
  function placeTip(anchor) {
    var tip = getTipEl();
    var r = anchor.getBoundingClientRect();
    var tw = tip.offsetWidth, th = tip.offsetHeight;
    var x = Math.max(8, Math.min(r.left, window.innerWidth - tw - 12));
    var y = r.bottom + 8;
    if (y + th > window.innerHeight - 8) y = Math.max(8, r.top - th - 8);
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  }
  // 拉取同课程(按 kckId)全部可选教学班; 全年课在 pkxq=16, 秋/冬班在 13/14, 合并去重
  function loadKcbjCompare(d) {
    var c = kcbjCache[d.kcbh];
    if (c && Date.now() - c.t < 60000) return Promise.resolve(c.items);
    var tries = [];
    if (d.pkxq != null && d.pkxq !== "") tries.push(String(d.pkxq));
    ["13", "14", "16"].forEach(function (p) { if (tries.indexOf(p) < 0) tries.push(p); });
    return Promise.all(tries.map(function (pkxq) {
      return callApi("/py/pyKcbj/selectXsKxbjByKckId", { kckId: d.kckId, sfkzy: "1", pkxq: pkxq })
        .then(function (res) { return (res && res.result) || []; })
        .catch(function () { return []; });
    })).then(function (rs) {
      var map = {}, XQ = { "13": "秋", "14": "冬", "16": "秋冬" };
      rs.forEach(function (arr, ai) {
        var xqMc = XQ[tries[ai]] || "";
        (arr || []).forEach(function (item) {
          var b = item && item.pyKcbj;
          if (!b || !b.id || map[b.id]) return;
          if (!b.bjrl) return; // 容量为 0 的班级不显示
          map[b.id] = {
            id: b.id, bjbh: b.bjbh || "", teacher: b.zjjsXm || "", xq: xqMc,
            campus: b.skxq || "",
            bjrl: b.bjrl, yxrs: b.yxrs, hxrs: b.hxrs || 0,
            mine: b.id === d.kcbjId
          };
        });
      });
      var items = Object.keys(map).map(function (k) { return map[k]; })
        .sort(function (a, b) { return a.hxrs - b.hxrs; });
      kcbjCache[d.kcbh] = { t: Date.now(), items: items };
      return items;
    });
  }
  var tipItems = [], tipKcbh = null;
  function renderTip(d, items) {
    tipItems = items; tipKcbh = d.kcbh;
    var h = '<div style="font-weight:700;margin-bottom:2px">' + esc(d.kcmc) +
      (d.selected ? ' <span style="font-size:11px;font-weight:600;color:#1d4ed8;background:#dbeafe;border-radius:4px;padding:0 4px;vertical-align:1px">已选</span>' : "") +
      ' <span style="font-weight:400;color:#94a3b8">' + esc(d.kcbh) + "</span></div>" +
      '<div style="color:#94a3b8;font-size:11px;margin-bottom:6px">各教学班排队对比(按排队人数升序),可点击换班</div>' +
      '<table style="border-collapse:collapse;width:100%;font-size:12px">';
    h += "<tr>" + ["教师", "校区", "已选/容量", "排队", ""].map(function (t) {
      return '<th style="text-align:left;padding:2px 8px 2px 0;color:#64748b;font-weight:600;border-bottom:1px solid #e2e8f0;white-space:nowrap">' + t + "</th>";
    }).join("") + "</tr>";
    items.forEach(function (it, i) {
      var sel = (it.yxrs != null && it.hxrs != null) ? Math.max(0, it.yxrs - it.hxrs) : null;
      var hasRoom = sel != null && sel < it.bjrl;
      var bg = it.mine ? "background:#eff6ff;" : i === 0 && it.hxrs === 0 && hasRoom ? "background:#f0fdf4;" : "";
      h += '<tr style="' + bg + (it.mine ? "font-weight:700;" : "") + '">' +
        '<td style="padding:3px 8px 3px 0;white-space:nowrap">' + esc(it.teacher) + (it.mine ? ' <span style="color:#2563eb">← 我在此班' + (d.selected ? "(已选)" : "") + "</span>" : "") + "</td>" +
        '<td style="padding:3px 8px 3px 0;color:#64748b;white-space:nowrap">' + esc(it.campus || "—") + "</td>" +
        '<td style="padding:3px 8px 3px 0;white-space:nowrap;color:#475569">' + (sel != null ? sel + "/" + it.bjrl : "—") + "</td>" +
        '<td style="padding:3px 8px 3px 0;white-space:nowrap;color:' + (it.hxrs === 0 ? "#059669" : it.hxrs <= 10 ? "#b45309" : "#0f172a") + ';font-weight:600">' +
        esc(String(it.hxrs)) + " 人" + (it.mine && d.pos != null ? "(接口第" + d.pos + "位" + (d.timePos != null ? "/时间第" + d.timePos + "位" : "") + ")" : "") + "</td>" +
        "<td>" + (it.mine ? "" :
          '<button data-bj="' + esc(it.id) + '" style="border:1px solid #cbd5e1;background:#fff;border-radius:5px;padding:2px 8px;font-size:11px;cursor:pointer;color:#475569;white-space:nowrap">' +
          (hasRoom ? "换到此班" : "换·排队") + "</button>") + "</td></tr>";
    });
    h += "</table>";
    if (!items.length) h = '<div style="color:#94a3b8">未查到可选教学班</div>';
    return h;
  }
  // 换班 = 退当前班 + 选目标班(已验证: removeClassByXs + chooseClassByXs)
  function switchClass(d, it) {
    var sel = (it.yxrs != null && it.hxrs != null) ? Math.max(0, it.yxrs - it.hxrs) : null;
    var willQueue = sel == null || sel >= it.bjrl;
    var msg = "换班确认\n\n课 程:" + d.kcmc +
      "\n当前班:" + (d.teacher || "?") + (d.pos != null ? "(接口第 " + d.pos + " 位" + (d.timePos != null ? ", 时间第 " + d.timePos + " 位" : "") + ")" : "(已选)");
    msg += "\n目标班:" + it.teacher + (it.campus ? " · " + it.campus : "") + " (已选 " + (sel != null ? sel : "?") + "/" + it.bjrl + ", 排队 " + it.hxrs + " 人)";
    if (willQueue) msg += "\n\n注意: 目标班已满, 换班后你将排在其队列末尾!";
    msg += "\n\n确认换班?";
    if (!window.confirm(msg)) return;
    var xkzt = willQueue ? "12" : "14";
    tipEl && (tipEl.innerHTML = '<div style="color:#2563eb">换班中(退当前班 → 选目标班)…</div>');
    callApi("/py/pyXsxk/removeClassByXs", {}, "POST", 2, { id: d.recId, kcbjId: d.kcbjId })
      .then(function (r) {
        if (!r || !r.success) throw new Error((r && r.message) || "退当前班失败");
        return callApi("/py/pyXsxk/chooseClassByXs", {}, "POST", 2, { kcbjId: it.id, xsId: d.xsId, xkzt: xkzt });
      })
      .then(function (r) {
        if (!r || !r.success) throw new Error((r && r.message) || "选目标班失败(当前班已退, 请到页面手动补选!)");
        delete kcbjCache[d.kcbh];
        lastPos = {}; // 位次重新计算
        tipEl && (tipEl.innerHTML = '<div style="color:#059669;font-weight:600">✓ 换班成功: ' + esc(it.teacher) + (willQueue ? "(已加入排队)" : "(已选上)") + "</div>");
        return refreshPos();
      })
      .catch(function (e) {
        tipEl && (tipEl.innerHTML = '<div style="color:#dc2626">✗ 换班失败: ' + esc(e.message || "未知错误") + "</div>");
      });
  }
  function showTip(badge) {
    if (badge && badge.closest && badge.closest("span[data-xsxk-rank-help]")) return;
    var kcbh = badge.getAttribute("data-k") || "";
    var d = posByKcbh[kcbh];
    if (!d || !d.kckId) return;
    clearTimeout(tipHideTimer);
    if (tipFor === badge && tipEl && tipEl.style.display !== "none") return;
    tipFor = badge;
    var tip = getTipEl();
    tip.innerHTML = '<div style="color:#94a3b8">' + esc(d.kcmc) + ":各教学班排队数据加载中…</div>";
    tip.style.display = "block";
    placeTip(badge);
    loadKcbjCompare(d).then(function (items) {
      if (tipFor !== badge) return;
      tip.innerHTML = renderTip(d, items);
      placeTip(badge);
    }).catch(function () {
      if (tipFor !== badge) return;
      tip.innerHTML = '<div style="color:#dc2626">各教学班数据加载失败,稍后再试</div>';
    });
  }
  // 事件委托: 徽章由 MutationObserver 反复重建, 委托到 body 上最稳
  document.body.addEventListener("mouseover", function (e) {
    var t = e.target;
    if (!(t && t.closest)) return;
    if (t.closest("span[data-xsxk-rank-help]")) return;
    var badge = t.closest("span[" + BADGE_ATTR + "]");
    if (badge) showTip(badge);
  });
  document.body.addEventListener("mouseout", function (e) {
    var t = e.target;
    if (!(t && t.closest)) return;
    if (t.closest("span[" + BADGE_ATTR + "]")) {
      clearTimeout(tipHideTimer);
      tipHideTimer = setTimeout(hideTip, 250);
    }
  });

  /* ---------- 排队位次: 仅同步到主表格内联徽章(面板只显示课表) ---------- */
  function refreshPos() {
    return loadMyCourses().then(function (mine) {
      // 已选课(正在修读): 无位次, 注入"班级对比"徽章, hover 可对比各教学班并一键换班
      mine.selected.forEach(function (r) {
        posByKcbh[r.kcbh] = {
          kcmc: r.kcmc, kcbh: r.kcbh, kcbjId: r.kcbjId, kckId: r.kckId, pkxq: r.pkxq,
          recId: r.id, xsId: r.xsId, teacher: r.zjjsXm || "",
          pos: null, total: null, selected: true, changed: null
        };
      });
      var queueJobs = mine.pending.map(function (r) {
        return loadQueue(r.kcbjId).then(function (list) {
          var idx = -1;
          for (var i = 0; i < list.length; i++) {
            if (list[i].id === r.id || list[i].xsId === r.xsId) { idx = i; break; }
          }
          var pos = idx >= 0 ? idx + 1 : null;
          var sortedByTime = list.slice().sort(function (a, b) {
            var ta = Date.parse(String(a.createTime || "").replace(" ", "T")) || Number.MAX_SAFE_INTEGER;
            var tb = Date.parse(String(b.createTime || "").replace(" ", "T")) || Number.MAX_SAFE_INTEGER;
            return ta - tb;
          });
          var timeIdx = -1;
          for (var ti = 0; ti < sortedByTime.length; ti++) {
            if (sortedByTime[ti].id === r.id || sortedByTime[ti].xsId === r.xsId) { timeIdx = ti; break; }
          }
          var timePos = timeIdx >= 0 ? timeIdx + 1 : null;
          var prev = lastPos[r.kcbjId];
          lastPos[r.kcbjId] = pos;
          posByKcbh[r.kcbh] = {
            kcmc: r.kcmc, kcbh: r.kcbh, kcbjId: r.kcbjId, kckId: r.kckId, pkxq: r.pkxq,
            recId: r.id, xsId: r.xsId, teacher: r.zjjsXm || "",
            pos: pos, timePos: timePos, total: list.length,
            changed: prev != null && pos != null && prev !== pos ? (pos < prev ? "up" : "down") : null
          };
        });
      });
      return Promise.all(queueJobs);
    }).then(function () {
      var fresh = {};
      Object.keys(posByKcbh).forEach(function (k) {
        var d = posByKcbh[k];
        if (d.pos != null || d.selected) fresh[k] = d;
      });
      posByKcbh = fresh; // 已退课/退出排队的课程不再显示徽章
      injectInlineBadges();
    }).catch(function (e) {
      console.warn("[选课助手] 位次刷新失败:", e && e.message);
    });
  }

  /* ---------- 课表渲染 ---------- */
  var lastXn = null;
  function renderKb() {
    var xn;
    var go = function (xnUsed, allowFallback) {
      loadKb(xnUsed).then(function (cells) {
        if (!cells.length && allowFallback) { go(String(Number(xnUsed) - 1), false); return; } // 空则回退上一年
        lastXn = xnUsed;
        var WEEK = ["", "周一", "周二", "周三", "周四", "周五", "周六", "周日"];
        var MAXJ = 13;
        // 建立 (xqj, ksjc) -> cell 映射(同格多条取第一条)
        var grid = {};
        var maxJ = 4;
        cells.forEach(function (c) {
          if (!c.xqj || !c.ksjc) return;
          maxJ = Math.max(maxJ, c.jsjc || c.ksjc);
          if (!grid[c.xqj + "-" + c.ksjc]) grid[c.xqj + "-" + c.ksjc] = c;
        });
        MAXJ = Math.min(Math.max(maxJ, 6), 13);

        var zcRange = function (z) {
          if (!z.length) return "";
          var nums = z.map(Number).sort(function (a, b) { return a - b; });
          var parts = [], s = nums[0], p = nums[0];
          for (var i = 1; i <= nums.length; i++) {
            if (nums[i] === p + 1) { p = nums[i]; continue; }
            parts.push(s === p ? s + "" : s + "-" + p + "周");
            s = p = nums[i];
          }
          return parts.join(",");
        };

        var h = '<div class="legend"><span><span class="lg-dot" style="background:#3b82f6"></span>已选</span><span><span class="lg-dot" style="background:#f59e0b"></span>排队中</span><span style="margin-left:auto">' + esc(xnUsed) + "-秋冬</span></div>";
        h += '<div class="kbwrap"><table class="kb"><tr><th></th>';
        for (var d = 1; d <= 7; d++) h += "<th>" + WEEK[d] + "</th>";
        h += "</tr>";
        for (var j = 1; j <= MAXJ; j++) {
          h += '<tr><td class="jc">' + j + "</td>";
          for (var d2 = 1; d2 <= 7; d2++) {
            var c = grid[d2 + "-" + j];
            if (c) {
              var span = Math.max(1, (c.jsjc || c.ksjc) - c.ksjc + 1);
              h += '<td rowspan="' + span + '"><div class="cell ' + (c.xkzt === "12" ? "q" : "s") + '">' +
                '<span class="cn">' + esc(c.kcmc) + "</span>" +
                '<span class="ci">' + esc(c.teacher || "") + (c.room ? " · " + esc(c.room) : "") + "</span>" +
                '<span class="ci">' + esc(c.dszMc || "") + " " + zcRange(c.zc) + "</span>" +
                "</div></td>";
              // 后续行同列的占位由下方 covered 检查跳过
            } else {
              // 检查此格是否被上方 rowspan 覆盖
              var covered = false;
              for (var jj = 1; jj < j && !covered; jj++) {
                var cc = grid[d2 + "-" + jj];
                if (cc && jj + (cc.jsjc || cc.ksjc) - cc.ksjc + 1 - 1 >= j) covered = true;
              }
              if (!covered) h += "<td></td>";
            }
          }
          h += "</tr>";
        }
        h += "</table></div>";
        if (!cells.length) h = '<div class="spin">本学期暂无课程数据</div>';
        bodyEl.innerHTML = h;
        stampEl.textContent = "更新于 " + new Date().toLocaleTimeString("zh-CN", { hour12: false });
      }).catch(function (e) {
        bodyEl.innerHTML = '<div class="err">' + esc(e.message || "课表加载失败") + "</div>";
      });
    };

    if (lastXn) { go(lastXn, true); return; }
    // 学年无现成接口(我的课程记录里 xn 为 null), 按日期推算: 9 月起为新学年; 课表为空自动回退上一年
    var now = new Date();
    go(String(now.getMonth() + 1 >= 9 ? now.getFullYear() : now.getFullYear() - 1), true);
  }

  /* ---------- 启动 ---------- */
  renderKb();   // 面板直接显示课表
  refreshPos(); // 主表格内联排队位次徽章
  tableObserver.observe(document.body, { childList: true, subtree: true });
  setInterval(function () {
    // 位次徽章独立于悬浮面板存活(面板关闭后仍自动刷新)
    if (document.visibilityState === "visible") refreshPos();
  }, AUTO_REFRESH_MS);
})();
