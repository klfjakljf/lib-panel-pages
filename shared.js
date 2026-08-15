/* ============================================================
 * 广大图书馆助手 - iframe 面板共享 JS 库 v2
 * URL 参数解析 + 超星官方 CXBOT 跨页通信协议 + API 客户端
 * 协议来源：https://robot-docs.chaoxing.com/docs/channel/
 * ============================================================ */

(function (global) {
  'use strict';

  // ---------- URL 参数解析 ----------
  const params = new URLSearchParams(global.location.search);
  const UID = params.get('uid') || params.get('robotId') || 'test_user';
  const BOT_SIGNATURE = params.get('bot_signature') || '';
  const ROBOT_TIME = params.get('robotTime') || '';
  const ROBOT_ID = params.get('robotId') || '';
  // 超星自动注入的消息 ID（用于 setContext / resizeMessage）
  const BOT_MSG = params.get('bot_msg') || '';
  const BOT_CONVERSATION = params.get('bot_conversation') || '';

  // 超星官方白名单域名（必须在 CONFIG 之前定义，因为 getCxOrigin 会用到）
  const CX_DOMAINS = [
    'https://robot.chaoxing.com',
    'https://robot1.chaoxing.com',
    'https://robot2.chaoxing.com',
    'https://robot-dev.chaoxing.com',
    'https://robot-lc.chaoxing.com',
    'https://robot-lc1.chaoxing.com',
    'https://robot-lc2.chaoxing.com',
  ];

  // ---------- 配置 ----------
  const CONFIG = {
    API_BASE: getApiBase(),
    // 超星平台 origin：优先用 bot_referer（超星自动注入），其次硬编码白名单
    CX_ORIGIN: getCxOrigin(),
    // 是否跳过签名（开发环境）
    DEV_SKIP_SIGN: params.get('skip_sign') === '1' || !BOT_SIGNATURE,
    // 是否本地开发环境
    IS_DEV: isDevEnv(),
  };

  function getApiBase() {
    const base = params.get('api_base');
    if (base) return base;
    // 生产环境兜底：硬编码 FC 地址（部署前必须替换为你的真实 FC URL）
    // 留空表示同源（仅本地测试用）
    if (isDevEnv()) return '';
    return 'https://lib-fc-ppakrehgau.cn-hangzhou.fcapp.run';  // 你的 FC HTTP 触发器地址
  }

  /**
   * 获取超星 targetOrigin
   * 优先级：bot_referer URL 参数 > document.referrer 推断 > 开发环境通配符
   * 生产环境必须命中超星白名单，否则消息会被浏览器丢弃
   */
  function getCxOrigin() {
    // 1. 超星会自动在 iframe URL 后追加 bot_referer 参数（最可靠）
    const fromUrl = params.get('bot_referer');
    if (fromUrl) return fromUrl;

    // 2. 从 document.referrer 推断（超星 iframe 嵌入时 referrer 是超星域名）
    if (global.document && global.document.referrer) {
      try {
        const refOrigin = new URL(global.document.referrer).origin;
        if (CX_DOMAINS.includes(refOrigin)) return refOrigin;
      } catch (e) { /* referrer 解析失败，忽略 */ }
    }

    // 3. 开发环境：通配符 + 警告
    if (isDevEnv()) {
      console.warn('[LibPanel] 开发环境使用 targetOrigin=*，生产环境必须由超星注入 bot_referer');
      return '*';
    }

    // 4. 生产环境兜底：尝试所有超星域名（最不靠谱，但比硬编码单一域名好）
    // 注意：postMessage 的 targetOrigin 不支持数组，只能猜一个
    // 官方文档说会注入 bot_referer，正常情况不会走到这里
    console.error('[LibPanel] 无法确定超星 origin，bot_referer 未注入且 referrer 不可用');
    return CX_DOMAINS[0];  // 兜底用主域名
  }

  function isDevEnv() {
    const host = global.location.hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '0.0.0.0';
  }

  // ============================================================
  // 超星官方 CXBOT 跨页通信协议
  // 文档：https://robot-docs.chaoxing.com/docs/channel/
  // ============================================================

  // iframe → 父窗口（超星）的消息类型
  const CXBOT = {
    SEND: 'CXBOT:send',                    // 发送消息到对话区
    SET_EXTRA: 'CXBOT:setWsExtraData',     // 设置任务流初始参数
    INPUT_TEXT: 'CXBOT:inputText',         // 写入输入框（不自动发送）
    ALERT: 'CXBOT:alert',                  // 弹窗提示
    REDIRECT: 'CXBOT:redirect',            // 页面重定向
    GET_TABS: 'CXBOT:getTabs',             // 获取页签列表
    SWITCH_TAB: 'CXBOT:switchTab',         // 切换页签
    CLEAR_SCREEN: 'CXBOT:clearScreen',     // 清屏
    RESIZE: 'CXBOT:resizeMessage',         // 重设 iframe 尺寸
    FULLSCREEN: 'CXBOT:requestFullscreen', // iframe 全屏
    CANCEL_FULLSCREEN: 'CXBOT:cancelFullscreen', // 退出全屏
    SET_LANG: 'CXBOT:setLang',             // 多语言切换
    SET_CONTEXT: 'CXBOT:setContext',       // 设置消息摘要
  };

  // 父窗口（超星）→ iframe 的消息类型前缀
  const CXBOT_PAGE_PREFIX = 'CXBOT_PAGE:';

  // 已知的超星响应事件名
  const CXBOT_PAGE = {
    GET_TABS: 'CXBOT_PAGE:getTabs',
    WS_CONNECTED: 'CXBOT_PAGE:wsConnected',
    WS_DISCONNECTED: 'CXBOT_PAGE:wsDisconnected',
  };

  /**
   * 向超星发送 CXBOT 消息（底层 API）
   * @param {string} type - CXBOT 消息类型（如 CXBOT.SEND）
   * @param {object} data - 消息数据
   */
  function sendToCx(type, data = {}) {
    const message = { type, data };
    global.parent.postMessage(message, CONFIG.CX_ORIGIN);
  }

  // ---------- 高层 API：常用 CXBOT 操作 ----------

  /**
   * 发送消息到对话区
   * @param {string} text - 消息内容
   * @param {boolean} hidden - true 时不展示在聊天区，仅发送到服务端
   */
  function sendToChat(text, hidden = false) {
    sendToCx(CXBOT.SEND, { text, hidden });
  }

  /**
   * 向输入框写入内容（不自动发送）
   * @param {string} text - 要写入的文本
   */
  function inputToChat(text) {
    sendToCx(CXBOT.INPUT_TEXT, { text });
  }

  /**
   * 弹窗提示
   * @param {string} title - 标题
   * @param {string} text - 内容
   */
  function alertUser(title, text) {
    sendToCx(CXBOT.ALERT, { title, text });
  }

  /**
   * 直接触发指定任务流并预填参数（官方推荐方式）
   * 官方建议：setWsExtraData 后延迟 200ms 再 CXBOT:send
   * @param {string} taskId - 任务流 ID（从超星任务流编辑器获取）
   * @param {object} taskInitParams - 任务流初始参数
   */
  function triggerTask(taskId, taskInitParams = {}) {
    if (!taskId || taskId.startsWith('TODO_REPLACE')) {
      console.error('[LibPanel] taskId 无效，请从超星平台获取真实任务流 ID');
      return;
    }
    sendToCx(CXBOT.SET_EXTRA, {
      taskId,
      chatModel: 'APP',
      taskInitParams,
    });
    // 官方建议延迟 200ms 后再调用 CXBOT:send
    setTimeout(() => {
      sendToCx(CXBOT.SEND, { text: '', hidden: true });
    }, 200);
  }

  /**
   * 语义触发：通过发送意图文本，靠大模型意图识别触发任务流
   * 适用于未拿到 taskId 的开发阶段
   * @param {string} intentText - 意图文本（如"预约座位"、"定时抢座"）
   */
  function triggerByIntent(intentText) {
    sendToChat(intentText, false);
  }

  /**
   * 触发业务流程（统一入口，自动选择触发方式）
   * @param {string} flow - 流程名（bind/seat-reserve/timer-reserve/room-reserve/credit/chat）
   * @param {object} options - { message, params }
   *   - message: 自定义意图文本（优先于默认）
   *   - params: 任务流初始参数（若有 taskId 则用 triggerTask，否则用 triggerByIntent）
   */
  function triggerFlow(flow, options = {}) {
    const { message, params = {} } = options;
    const taskId = TASK_ID_MAP[flow];

    if (taskId && !taskId.startsWith('TODO_REPLACE')) {
      // 有真实 taskId：直接触发任务流
      triggerTask(taskId, params);
    } else {
      // 无 taskId：语义触发
      const text = message || FLOW_INTENT[flow];
      if (text) {
        triggerByIntent(text);
      } else {
        console.warn('[LibPanel] 无法触发 flow:', flow, '（无 taskId 也无默认意图文本）');
      }
    }
  }

  // ---------- 任务流 ID 映射表 ----------
  // ⚠️ 部署前必须替换为真实 taskId
  // 获取方式：超星平台 → 任务流管理 → 编辑对应任务流 → URL 里的 taskId 参数
  const TASK_ID_MAP = {
    'bind': 'TODO_REPLACE_WITH_BIND_TASK_ID',
    'unbind': 'TODO_REPLACE_WITH_UNBIND_TASK_ID',
    'seat-reserve': 'TODO_REPLACE_WITH_SEAT_RESERVE_TASK_ID',
    'timer-reserve': 'TODO_REPLACE_WITH_TIMER_RESERVE_TASK_ID',
    'timer-manage': 'TODO_REPLACE_WITH_TIMER_MANAGE_TASK_ID',
    'room-reserve': 'TODO_REPLACE_WITH_ROOM_RESERVE_TASK_ID',
    'analysis': 'TODO_REPLACE_WITH_ANALYSIS_TASK_ID',
    'credit': 'TODO_REPLACE_WITH_CREDIT_TASK_ID',
    'chat': null, // chat 用语义触发，不需要 taskId
  };

  // 默认意图文本（语义触发用）
  const FLOW_INTENT = {
    'bind': '绑定账号',
    'unbind': '解绑账号',
    'seat-reserve': '预约座位',
    'timer-reserve': '设置定时抢座',
    'timer-manage': '取消定时任务',
    'room-reserve': '预约研讨室',
    'analysis': '查空座',
    'credit': '查信誉分',
    'chat': null, // chat 用调用方传入的 message
  };

  // ---------- 监听超星回传消息 ----------
  /**
   * 注册超星响应消息监听
   * @param {object} handlers - { 'CXBOT_PAGE:xxx': 处理函数 或 处理函数数组 }
   */
  function onCxMessage(handlers) {
    global.addEventListener('message', function (e) {
      const d = e.data;
      if (!d || typeof d !== 'object') return;
      if (typeof d.type !== 'string') return;

      // 只响应 CXBOT_PAGE:* 前缀的消息
      if (!d.type.startsWith(CXBOT_PAGE_PREFIX)) return;

      // 生产环境安全校验：检查 origin 在超星白名单内
      if (!CONFIG.IS_DEV) {
        if (!CX_DOMAINS.includes(e.origin)) {
          console.warn('[LibPanel] 拒绝非超星域名的消息:', e.origin);
          return;
        }
      }

      const handler = handlers[d.type];
      if (!handler) return;
      // 支持单个函数或函数数组（修复 P1-1：多 handler 覆盖问题）
      const fns = Array.isArray(handler) ? handler : [handler];
      for (const fn of fns) {
        if (typeof fn === 'function') fn(d.data, d);
      }
    });
  }

  // ============================================================
  // 向后兼容层（旧 API 保留，内部转 CXBOT 协议）
  // 仅为减少 nav.html / panel.html 改动量，新代码请直接用 CXBOT API
  // ============================================================

  // 旧的消息类型常量（保留供 nav.html/panel.html 引用，但部分已废弃）
  const MSG = {
    TRIGGER_TASK: 'trigger-task',   // 保留：内部转 triggerFlow
    LOAD_IFRAME: 'load-iframe',     // 废弃：超星无此能力，改用对话触发
    READY: 'ready',                 // 废弃：超星无对应响应
    API_PROXY: 'api-proxy',         // 废弃：超星不代理业务 API
    SEAT_PICK: 'seat-pick',         // 保留：选座回传，内部转 CXBOT:send
    NAV_CLICK: 'nav-click',         // 废弃
    DATA_SYNC: 'data-sync',         // 废弃：改用 onCxMessage 监听
  };

  // 旧的父窗口消息类型（已废弃，超星不会发这些）
  const MSG_FROM_PARENT = {
    API_RESULT: 'api-result',       // 废弃
    NAV_UPDATE: 'nav-update',       // 废弃
    REFRESH: 'refresh',             // 废弃：改用 CXBOT_PAGE:wsConnected 触发刷新
    DATA_SYNC: 'data-sync',         // 废弃
  };

  /**
   * 向父窗口发送消息（旧 API，向后兼容）
   * 内部根据 type 转换为 CXBOT 协议调用
   */
  function sendToParent(type, payload = {}) {
    switch (type) {
      case MSG.TRIGGER_TASK: {
        // 旧调用：sendToParent(MSG.TRIGGER_TASK, { flow, message })
        triggerFlow(payload.flow || 'chat', {
          message: payload.message,
          params: payload.params,
        });
        return;
      }
      case MSG.SEAT_PICK: {
        // 选座回传：发送隐藏消息，内容由任务流解析
        const formData = JSON.stringify([
          { name: 'devName', value: payload.seat },
          { name: 'room', value: payload.room },
        ]);
        sendToChat(formData, true);
        return;
      }
      case MSG.LOAD_IFRAME: {
        // 超星无此能力，降级为对话触发
        console.warn('[LibPanel] load-iframe 超星不支持，改为对话引导');
        if (payload.target === 'seatmap') {
          triggerByIntent('看座位图');
        } else if (payload.target === 'analysis') {
          triggerByIntent('查空座');
        }
        return;
      }
      default:
        console.warn('[LibPanel] 未知消息类型（旧 API）:', type);
    }
  }

  /**
   * 注册父窗口消息监听（旧 API，向后兼容）
   * 内部转用 onCxMessage，把旧事件名映射到 CXBOT_PAGE 事件
   * 修复 P1-1：REFRESH 和 DATA_SYNC 都映射到 wsConnected，用数组避免覆盖
   */
  function onParentMessage(handlers) {
    const cxHandlers = {};
    const wsConnectedHandlers = [];

    // 旧 REFRESH → 映射到 wsConnected
    if (handlers[MSG_FROM_PARENT.REFRESH]) {
      wsConnectedHandlers.push(handlers[MSG_FROM_PARENT.REFRESH]);
    }

    // 旧 DATA_SYNC → 映射到 wsConnected
    if (handlers[MSG_FROM_PARENT.DATA_SYNC]) {
      wsConnectedHandlers.push((data) => {
        handlers[MSG_FROM_PARENT.DATA_SYNC]({ type: 'refresh' });
      });
    }

    if (wsConnectedHandlers.length > 0) {
      cxHandlers[CXBOT_PAGE.WS_CONNECTED] = wsConnectedHandlers;
    }

    onCxMessage(cxHandlers);
  }

  // ============================================================
  // API 客户端（与 CXBOT 协议无关，保留原实现）
  // ============================================================

  /**
   * 调用 FC API（GET 只读接口）
   * 生产环境用 bot_signature 签名，开发环境跳过
   * 修复 P1-2：加 8 秒超时，防止 FC 冷启动时面板卡死
   */
  async function apiGet(path, query = {}) {
    const url = new URL(CONFIG.API_BASE + path, global.location.origin);
    url.searchParams.set('uid', UID);
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }

    const headers = {};
    if (!CONFIG.DEV_SKIP_SIGN && BOT_SIGNATURE) {
      headers['X-Robot-Signature'] = BOT_SIGNATURE;
    }

    // 8 秒超时（FC 冷启动最长约 5 秒，留 3 秒余量）
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
      const resp = await fetch(url.toString(), { headers, signal: controller.signal });
      clearTimeout(timeoutId);
      if (!resp.ok) throw new Error(`API ${path} 返回 ${resp.status}`);
      return resp.json();
    } catch (e) {
      clearTimeout(timeoutId);
      if (e.name === 'AbortError') throw new Error(`API ${path} 请求超时（8秒）`);
      throw e;
    }
  }

  /**
   * 调用 FC API（POST 写操作）
   * ⚠️ 超星 iframe 不直接 POST，写操作有两种方式：
   *   1. 开发环境（DEV_SKIP_SIGN）：直接 fetch
   *   2. 生产环境：降级为 CXBOT:send 触发对话操作（修复 P0-3）
   *      iframe 不直接 POST，改为提示用户在对话区操作
   */
  async function apiPost(path, body = {}) {
    if (CONFIG.DEV_SKIP_SIGN) {
      const url = CONFIG.API_BASE + path;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, uid: UID }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (!resp.ok) throw new Error(`API ${path} 返回 ${resp.status}`);
        return resp.json();
      } catch (e) {
        clearTimeout(timeoutId);
        if (e.name === 'AbortError') throw new Error(`API ${path} 请求超时（8秒）`);
        throw e;
      }
    }

    // 生产环境：iframe 不直接 POST，降级为对话引导
    console.warn('[LibPanel] 生产环境 POST 降级为 CXBOT 对话引导:', path);
    // 根据路径推断意图文本
    const intentMap = {
      '/api/schedule': '取消定时任务',
      '/api/auth': '绑定账号',
      '/api/reserve': '预约座位',
    };
    const intent = intentMap[path] || '请在对话区操作';
    triggerByIntent(intent);
    // 返回 redirected 标识，调用方必须检查此字段判断是否真正执行
    // 不返回 code:0 是为了避免调用方误认为操作成功
    return { code: 302, redirected: true, message: '已转向对话区操作，请在对话框完成' };
  }

  // ---------- 工具函数 ----------
  function formatPeriod(period) {
    if (!period) return '--';
    return period.replace(/:00/g, '').replace(/-/g, ' ~ ');
  }

  function formatDate(dateStr) {
    if (!dateStr) return '--';
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}月${d.getDate()}日`;
  }

  function seatStatus(code) {
    return {
      0: { label: '空闲', class: 's0', color: '#22C55E' },
      1: { label: '部分', class: 's1', color: '#F59E0B' },
      2: { label: '已约', class: 's2', color: '#EF4444' },
      3: { label: '我的', class: 's3', color: '#3B82F6' },
      4: { label: '关闭', class: 's4', color: '#C0C4CC' },
    }[code] || { label: '未知', class: '', color: '#999' };
  }

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');  // 修复 P1-7：转义单引号，防止属性注入
  }

  function debounce(fn, wait = 300) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  // ---------- 导航配置 ----------
  const NAV_CONFIG = [
    {
      group: '概览',
      items: [
        {
          id: 'home',
          label: '首页',
          icon: 'home',
          desc: '常见问题与帮助',
          action: { type: 'self', subview: 'home' },
        },
      ],
    },
    {
      group: '查看',
      items: [
        {
          id: 'floor-plan',
          label: '楼层平面图',
          icon: 'map',
          desc: '浏览楼层与房间布局',
          // 超星无 load-iframe 能力，改为语义触发（修复 P1-3：原 subview-floor-mini 不存在）
          action: { type: 'trigger-task', flow: 'chat', message: '看楼层平面图' },
          fallback: { type: 'prompt', message: '请在对话框输入「看楼层平面图」查看楼层布局' },
        },
        {
          id: 'seatmap',
          label: '互动座位图',
          icon: 'grid',
          desc: '实时座位状态与选座',
          // 语义触发：让超星在对话区加载座位图 iframe
          action: { type: 'trigger-task', flow: 'chat', message: '看座位图' },
          fallback: { type: 'prompt', message: '请在对话框输入「看座位图」查看互动座位图' },
        },
        {
          id: 'analysis',
          label: '态势分析',
          icon: 'chart',
          desc: '占用率与空座推荐',
          action: { type: 'self', subview: 'analysis-mini' },
        },
      ],
    },
    {
      group: '预约',
      items: [
        {
          id: 'seat-reserve',
          label: '座位预约',
          icon: 'seat',
          desc: '选座并即时预约',
          action: { type: 'trigger-task', flow: 'seat-reserve' },
          fallback: { type: 'prompt', message: '请在对话框输入「预约座位」开始选座预约' },
        },
        {
          id: 'timer',
          label: '定时抢座',
          icon: 'clock',
          desc: '设置每日自动抢座',
          action: { type: 'trigger-task', flow: 'timer-reserve' },
          fallback: { type: 'prompt', message: '请在对话框输入「设置定时抢座」创建自动抢座任务' },
        },
        {
          id: 'room-reserve',
          label: '研讨室预约',
          icon: 'door',
          desc: '组队预约研讨室',
          action: { type: 'trigger-task', flow: 'room-reserve' },
          fallback: { type: 'prompt', message: '请在对话框输入「约研讨室」开始组队预约' },
        },
      ],
    },
    {
      group: '设置',
      items: [
        {
          id: 'bind',
          label: '账号绑定',
          icon: 'link',
          desc: '绑定/解绑图书馆账号',
          action: { type: 'trigger-task', flow: 'bind' },
          fallback: { type: 'prompt', message: '请在对话框输入「绑定账号」开始绑定图书馆账号' },
        },
        {
          id: 'credit',
          label: '信誉分查询',
          icon: 'shield',
          desc: '查看信誉分与违约记录',
          action: { type: 'trigger-task', flow: 'credit' },
          fallback: { type: 'prompt', message: '请在对话框输入「查信誉分」查询信誉分' },
        },
      ],
    },
  ];

  // ---------- SVG 图标库 ----------
  const ICONS = {
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
    map: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>',
    grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>',
    chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
    seat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4"/><path d="M2 20h20"/><path d="M4 12v8"/><path d="M18 12v8"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    door: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16"/><line x1="15" y1="12" x2="15.01" y2="12"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>',
    arrowLeft: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>',
  };

  // ---------- 导出 ----------
  global.LibPanel = {
    // 配置
    UID,
    BOT_SIGNATURE,
    ROBOT_TIME,
    ROBOT_ID,
    BOT_MSG,
    BOT_CONVERSATION,
    CONFIG,
    // CXBOT 官方协议（新 API，推荐使用）
    CXBOT,
    CXBOT_PAGE,
    sendToCx,
    sendToChat,
    inputToChat,
    alertUser,
    triggerTask,
    triggerByIntent,
    triggerFlow,
    onCxMessage,
    TASK_ID_MAP,
    FLOW_INTENT,
    // 向后兼容（旧 API，内部转 CXBOT）
    MSG,
    MSG_FROM_PARENT,
    sendToParent,
    onParentMessage,
    // API 客户端
    apiGet,
    apiPost,
    // 工具
    formatPeriod,
    formatDate,
    seatStatus,
    escapeHtml,
    debounce,
    // 导航配置
    NAV_CONFIG,
    // 图标
    ICONS,
  };

  // 加载完成通知（超星无对应响应，但保留日志便于调试）
  global.addEventListener('load', () => {
    if (CONFIG.IS_DEV) {
      console.log('[LibPanel] iframe 加载完成，UID:', UID, 'CX_ORIGIN:', CONFIG.CX_ORIGIN);
    }
  });
})(window);
