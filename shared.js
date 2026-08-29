/* ============================================================
 * 广大图书馆助手 - iframe 面板共享 JS 库 v2
 * URL 参数解析 + 超星官方 CXBOT 跨页通信协议 + API 客户端
 * 协议来源：https://robot-docs.chaoxing.com/docs/channel/
 * ============================================================ */

(function (global) {
  'use strict';

  // ---------- URL 参数解析 ----------
  const params = new URLSearchParams(global.location.search);
  // ⚠️ robotId 是机器人 ID（INNER_robotId）不是用户 ID，不可作 uid 兜底（8-21 移除）
  // uid 解析优先级：URL 参数 > localStorage 身份自举 > test_user 兜底
  // 身份自举（2026-08-24）：常驻侧边 iframe 的 URL 不支持平台变量注入（实测），
  // 无 uid 时从同 origin localStorage 恢复身份——优先取最近使用账号
  // （libpanel_last_uid，setToken 时维护），否则枚举唯一的 libpanel_token_* 凭证；
  // 多账号且无最近标记时放弃自举（避免常驻面板绑错人）。
  // 效果：对话区 iframe 完成一次绑定后，无注入的常驻面板即获得真实身份+凭证，
  // 升级为完整功能面板。安全性：localStorage 按 origin 隔离，本页面即凭证属主。
  function _bootstrapUid() {
    try {
      const lastUid = global.localStorage.getItem('libpanel_last_uid');
      if (lastUid && global.localStorage.getItem('libpanel_token_' + lastUid)) {
        return lastUid;
      }
      let found = '';
      const prefix = 'libpanel_token_';
      for (let i = 0; i < global.localStorage.length; i++) {
        const k = global.localStorage.key(i);
        if (k && k.indexOf(prefix) === 0) {
          if (found) return '';
          found = k.slice(prefix.length);
        }
      }
      return found;
    } catch (e) { return ''; }  // 隐私模式等 localStorage 不可用
  }
  // 未替换的平台模板（如常驻 iframe 配了 {{INNER_userId}} 但宿主不做变量替换，
  // 字面量 "{{INNER_userId}}" 会被当成 uid 使用）视为无效——识别后走身份自举
  const _rawUid = params.get('uid') || '';
  const _uidIsTemplate = /\{\{[^}]*\}\}/.test(_rawUid);
  const UID = (_rawUid && !_uidIsTemplate) ? _rawUid
    : (_bootstrapUid() || _rawUid || 'test_user');
  const BOT_SIGNATURE = params.get('bot_signature') || '';
  const ROBOT_TIME = params.get('robotTime') || '';
  const ROBOT_ID = params.get('robotId') || '';
  // 超星自动注入的消息 ID（用于 setContext / resizeMessage）
  const BOT_MSG = params.get('bot_msg') || '';
  const BOT_CONVERSATION = params.get('bot_conversation') || '';

  // 用户级 Token（方案 E：超星 iframe 未注入签名时使用）
  // let 而非 const：方案 4 内嵌绑定表单绑定成功后经 setToken() 原地更新，免刷新页面
  // 持久化：URL 参数优先，其次 localStorage（超星 iframe URL 无法注入按用户定制的
  // token——平台变量只有 {{INNER_userId}}，绑定成功后存本浏览器，下次打开免重复绑定；
  // 暴露面与 URL 参数相当，且不进代理/服务器日志，整体不劣于原方案）
  const TOKEN_STORAGE_KEY = 'libpanel_token_' + UID;

  function _loadStoredToken() {
    try { return global.localStorage.getItem(TOKEN_STORAGE_KEY) || ''; }
    catch (e) { return ''; }  // 隐私模式等场景 localStorage 不可用
  }

  let TOKEN = params.get('token') || _loadStoredToken();

  // 超星官方白名单域名（必须在 CONFIG 之前定义，因为 getCxOrigin 会用到）
  const CX_DOMAINS = [
    'https://robot.chaoxing.com',
    'https://robot1.chaoxing.com',
    'https://robot2.chaoxing.com',
    'https://robot-dev.chaoxing.com',
    'https://robot-lc.chaoxing.com',
    'https://robot-lc1.chaoxing.com',
    'https://robot-lc2.chaoxing.com',
    // 学校自建超星平台
    'https://myagent.gzhu.edu.cn',
  ];

  // ---------- 配置 ----------
  const CONFIG = {
    API_BASE: getApiBase(),
    // 超星平台 origin：优先用 bot_referer（超星自动注入），其次硬编码白名单
    CX_ORIGIN: getCxOrigin(),
    // 是否跳过签名：仅限开发环境显式传 skip_sign=1 时生效
    // 修复 P0-2：「无签名」不等于「开发模式」——生产环境超星本来就不注入签名，
    // 原来的 `|| !BOT_SIGNATURE` 会让生产环境恒为 true，POST 误走直连分支必然 403
    DEV_SKIP_SIGN: params.get('skip_sign') === '1',
    // 是否本地开发环境
    IS_DEV: isDevEnv(),
    // 是否持有直连 FC 的凭证（签名或 token 任一）——决定 POST 能否直连
    HAS_CREDENTIAL: Boolean(BOT_SIGNATURE || TOKEN),
  };

  // ---------- 调试日志：启动时打印所有 URL 参数（验证超星自动注入） ----------
  // 上线后可保留，仅 console 不影响业务逻辑
  console.log('[LibPanel] ====== iframe URL 参数诊断 ======');
  console.log('[LibPanel] location.href:', global.location.href);
  console.log('[LibPanel] location.search:', global.location.search);
  console.log('[LibPanel] document.referrer:', global.document.referrer);
  console.log('[LibPanel] 所有 URL 参数:');
  for (const [k, v] of params.entries()) {
    console.log(`[LibPanel]   ${k} = ${v}`);
  }
  console.log('[LibPanel] 解析后:');
  console.log('  UID:', UID);
  console.log('  BOT_SIGNATURE:', BOT_SIGNATURE ? `${BOT_SIGNATURE.slice(0, 8)}...(${BOT_SIGNATURE.length}字符)` : '(空)');
  console.log('  ROBOT_TIME:', ROBOT_TIME);
  console.log('  ROBOT_ID:', ROBOT_ID);
  console.log('  BOT_MSG:', BOT_MSG);
  console.log('  BOT_CONVERSATION:', BOT_CONVERSATION);
  console.log('  TOKEN:', TOKEN ? `${TOKEN.slice(0, 8)}...(${TOKEN.length}字符)` : '(空)');
  console.log('  CX_ORIGIN:', CONFIG.CX_ORIGIN);
  console.log('  API_BASE:', CONFIG.API_BASE);
  console.log('  DEV_SKIP_SIGN:', CONFIG.DEV_SKIP_SIGN);
  console.log('[LibPanel] ====== 诊断结束 ======');

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

    // 4. 生产环境兜底：学校自建平台是当前实际部署环境（实测不注入 bot_referer）
    // 注意：postMessage 的 targetOrigin 不支持数组，只能选实际部署的父窗口域名
    // 修复 P0-1：原兜底 robot.chaoxing.com 与真实父窗口 myagent.gzhu.edu.cn 不匹配，
    // 浏览器会静默丢弃所有 CXBOT 消息（不报错），导致 triggerTask/alertUser 全部失效
    console.error('[LibPanel] 无法确定超星 origin，bot_referer 未注入且 referrer 不可用，兜底使用学校自建平台');
    return 'https://myagent.gzhu.edu.cn';
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
   * 动态调整本 iframe 尺寸（CXBOT:resizeMessage，2026-08-24 启用）
   * 平台嵌入节点配置的 px 只是初始值；页面可在运行时按内容自适应上报尺寸，
   * 如：座位图二级展开时请求加高、绑定成功后内容变矮时请求回落。
   * 上限仍受平台约束（实测 1000×1000，宽度受宿主消息列压缩——请求超宽无效但无害）。
   * 对侧边常驻 iframe 是否生效未实测；父窗口不认识消息时静默忽略，无副作用。
   * @param {number} width - 请求宽度 px
   * @param {number} height - 请求高度 px
   */
  function resizeIframe(width, height) {
    sendToCx(CXBOT.RESIZE, { width, height });
    console.log('[LibPanel] resizeMessage:', width, 'x', height);
  }

  /**
   * 请求全屏（CXBOT:requestFullscreen）——替代用户手动点平台全屏按钮，
   * 页面可自定义入口（如座位图「大屏操作」按钮）
   */
  function requestIframeFullscreen() {
    sendToCx(CXBOT.FULLSCREEN, {});
  }

  /**
   * 退出全屏（CXBOT:cancelFullscreen）——解决"点全屏后其他内容看不到"：
   * 全屏态由页面自己控制进出，可提供明显的退出按钮/操作完成自动退出
   */
  function cancelIframeFullscreen() {
    sendToCx(CXBOT.CANCEL_FULLSCREEN, {});
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
    'bind': '149783',
    'unbind': '149783',
    'seat-reserve': '150328',
    'timer-reserve': 'TODO_REPLACE_WITH_TIMER_RESERVE_TASK_ID',
    'timer-manage': 'TODO_REPLACE_WITH_TIMER_MANAGE_TASK_ID',
    'room-reserve': '164198',
    // 按用户 8-28 提供的名称对应：取消座位预约=164200、取消研讨室预约=164201
    // （8-29 曾反向填写，如与平台实际不符请以任务流编辑 URL 的 taskId 为准对调）
    'seat-cancel': '164200',
    'room-cancel': '164201',
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
    'room-cancel': '取消研讨室预约',
    'seat-cancel': '取消座位预约',
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
        // 选座回传：混合通道 = taskId 路由 + JSON 载荷随隐藏消息文本。
        // 只 sendToChat 不带路由时，JSON 无预约关键词 → 意图识别认领不了 → 被通用大模型接走
        const form = [
          { name: 'devName', value: payload.seat },
          { name: 'room', value: payload.room },
        ];
        if (payload.date) form.push({ name: 'date', value: payload.date });
        if (payload.periods && payload.periods.length) {
          form.push({ name: 'periods', value: payload.periods.join(',') });
        }
        const json = JSON.stringify(form);
        const taskId = TASK_ID_MAP['seat-reserve'];
        if (taskId && !taskId.startsWith('TODO_REPLACE')) {
          // 正式通道：setWsExtraData(taskId) + 200ms 后隐藏发送 JSON（taskInitParams 平台会清空，不放参数）
          sendToCx(CXBOT.SET_EXTRA, {
            taskId,
            chatModel: 'APP',
            taskInitParams: {},
          });
          setTimeout(() => {
            sendToCx(CXBOT.SEND, { text: json, hidden: true });
          }, 200);
        } else {
          // 降级通道：意图前缀 + JSON（normalize_input 容错提取 '[' 起的 JSON）
          console.warn('[LibPanel] seat-reserve 未配置 taskId，降级为意图触发');
          sendToChat('预约座位 ' + json, true);
        }
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
  // 短时效凭证管理（方案 5：长期 token 换 5 分钟 JWT，业务请求不携带长期 token）
  // ============================================================

  // 内存缓存（刻意不落 localStorage：随页面关闭即失效，进一步缩小泄漏窗口）
  let _stToken = '';
  let _stTokenExpireAt = 0;    // 过期毫秒时间戳
  let _stTokenPromise = null;  // 并发去重：多个请求同时发现凭证过期时只发一次 exchange
  const ST_REFRESH_MARGIN_MS = 30 * 1000;  // 提前 30 秒视为过期，规避边界竞态

  /**
   * 获取短时效凭证（st_token）：
   * - 持有长期 token 时自动调 /api/auth/exchange 换取 JWT（默认 5 分钟有效）
   * - 有效期内直接用内存缓存；并发调用共享同一个 exchange 请求
   * - 换取失败（长期 token 失效 / FC 未部署新端点）返回 ''，调用方回落携带长期 token
   * - 未绑定（无长期 token）返回 ''，走签名/对话引导链路
   * @param {boolean} force - 忽略缓存强制换取（403 过期重试时用）
   */
  async function getStToken(force = false) {
    if (!TOKEN) return '';
    if (!force && _stToken && _stTokenExpireAt - ST_REFRESH_MARGIN_MS > Date.now()) {
      return _stToken;
    }
    if (_stTokenPromise) return _stTokenPromise;

    _stTokenPromise = (async () => {
      try {
        // v19：改用 POST + JSON body 携带长期 token——URL query 会被 FC 访问日志/
        // CDN/监控工具默认完整记录，而 body 仅存在于两端内存（OAuth2 token endpoint
        // 强制 POST 同理）；后端 index.py 同时支持 GET/POST，旧版缓存页面不受影响
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);
        const resp = await fetch(CONFIG.API_BASE + '/api/auth/exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uid: UID, token: TOKEN }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        const data = await resp.json().catch(() => ({}));
        if (resp.ok && data.code === 0 && data.st_token) {
          _stToken = data.st_token;
          _stTokenExpireAt = Date.now() + (data.expires_in || 300) * 1000;
          console.log('[LibPanel] 短时效凭证签发成功，有效期', data.expires_in, '秒');
          return _stToken;
        }
        // 换取失败：清缓存返回空串，本次请求回落携带长期 token（旧链路兼容）
        console.warn('[LibPanel] 短时效凭证签发失败，回落长期 token:', resp.status, data.msg || '');
        _stToken = '';
        _stTokenExpireAt = 0;
        return '';
      } catch (e) {
        console.warn('[LibPanel] exchange 请求失败，回落长期 token:', e.message);
        _stToken = '';
        _stTokenExpireAt = 0;
        return '';
      } finally {
        _stTokenPromise = null;
      }
    })();
    return _stTokenPromise;
  }

  /**
   * 更新长期 token（方案 4：内嵌绑定表单绑定成功后调用，免刷新页面立即可用）
   * 同时清空短时效凭证缓存（下次请求自动用新 token 重新换取）并持久化到 localStorage
   */
  function setToken(newToken) {
    TOKEN = newToken || '';
    CONFIG.HAS_CREDENTIAL = Boolean(BOT_SIGNATURE || TOKEN);
    _stToken = '';
    _stTokenExpireAt = 0;
    try {
      if (TOKEN) {
        global.localStorage.setItem(TOKEN_STORAGE_KEY, TOKEN);
        // 身份自举配套：记录最近使用账号，无 uid 注入的常驻 iframe 按此恢复身份
        global.localStorage.setItem('libpanel_last_uid', UID);
      } else {
        global.localStorage.removeItem(TOKEN_STORAGE_KEY);
      }
    } catch (e) { /* localStorage 不可用时跳过持久化（仅影响下次会话） */ }
    console.log('[LibPanel] 长期 token 已更新，短时效凭证缓存已清空');
  }

  /** 清空凭证（解绑后调用）：后续请求回落无凭证链路（GET 裸查 / POST 对话引导） */
  function clearToken() {
    setToken('');
  }

  /**
   * 本机当前是否持有长期 token（实时值）。供面板判断「已绑定但凭证未同步」
   * 状态（换设备/清浏览器数据/其他通道绑定）——导出的 TOKEN 是初始快照，
   * setToken 后不更新，勿用于判断
   */
  function hasCredential() {
    return Boolean(TOKEN);
  }

  /**
   * 跨 iframe 凭证同步（2026-08-25，绑定后右侧面板 403 修复）：
   * 本 iframe 若在绑定前加载，TOKEN 快照为空；另一个 iframe（登录面板）完成绑定
   * 写入 localStorage 后，storage 事件触发本函数重读 token——否则 apiGet 会
   * 无凭证请求 /api/credit、/api/schedule 等需鉴权接口（status 是白名单所以
   * 账号卡片能正常显示"已绑定"，形成"状态已绑定但查询 403"的割裂现象）。
   * 同时清空缓存的 st_token（旧凭证已随解绑/重绑失效）。
   * 注意：UID 是加载期常量，无法在此重解析——常驻 iframe 首次绑定场景
   * （加载时无 last_uid 回落 test_user）仍需刷新页面走身份自举。
   */
  function reloadCredential() {
    TOKEN = _loadStoredToken();
    CONFIG.HAS_CREDENTIAL = Boolean(BOT_SIGNATURE || TOKEN);
    _stToken = '';
    _stTokenExpireAt = 0;
    return Boolean(TOKEN);
  }

  // ============================================================
  // API 客户端（与 CXBOT 协议无关）
  // ============================================================

  /**
   * 调用 FC API（GET 只读接口）
   * 生产环境用 bot_signature 签名，开发环境跳过
   * 修复 P1-2：加 8 秒超时，防止 FC 冷启动时面板卡死
   * 方案 5：优先携带短时效凭证 st_token（长期 token 不出现在业务 URL）；
   * exchange 不可用时回落携带长期 token（兼容旧版 FC）
   */
  async function apiGet(path, query = {}, _retried = false) {
    const stToken = await getStToken();
    const url = new URL(CONFIG.API_BASE + path, global.location.origin);
    url.searchParams.set('uid', UID);
    if (stToken) {
      url.searchParams.set('st_token', stToken);
    } else if (TOKEN) {
      // 回落：长期 token 兜底鉴权（方案 E：超星未注入签名时使用）
      url.searchParams.set('token', TOKEN);
    }
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }

    const headers = {};
    if (!CONFIG.DEV_SKIP_SIGN && BOT_SIGNATURE) {
      headers['X-Robot-Signature'] = BOT_SIGNATURE;
    }

    // 调试日志：打印请求信息（上线后可保留）
    console.log(`[LibPanel] apiGet → ${path}`);
    console.log('  URL:', url.toString());
    console.log('  凭证:', stToken ? 'st_token(短时效)' : (TOKEN ? 'token(长期)' : '无'));
    console.log('  Headers:', headers);

    // 8 秒超时（FC 冷启动最长约 5 秒，留 3 秒余量）
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);

    try {
      const resp = await fetch(url.toString(), { headers, signal: controller.signal });
      clearTimeout(timeoutId);
      console.log(`[LibPanel] apiGet ← ${path} status=${resp.status}`);
      // 短时效凭证过期（页面停留超有效期）：强制换取新凭证重试一次
      if (resp.status === 403 && stToken && !_retried) {
        console.warn('[LibPanel] st_token 疑似过期，强制刷新后重试:', path);
        const fresh = await getStToken(true);
        if (fresh) return apiGet(path, query, true);
      }
      if (!resp.ok) {
        // 修复 P1-2：读取错误响应体，透出 FC 精心构造的 msg/debug 字段
        // （如 403 时的 uid、token_len、query_keys），不再丢弃排障信息
        let errData = null;
        try { errData = await resp.json(); } catch (e) { /* 响应体非 JSON，忽略 */ }
        console.error(`[LibPanel] apiGet ${path} ${resp.status} 错误响应体:`, errData);
        const detail = errData && errData.msg ? `：${errData.msg}` : '';
        const debug = errData && errData.debug
          ? `（uid=${errData.debug.uid ?? '?'}, token_len=${errData.debug.token_len ?? '?'}）`
          : '';
        const err = new Error(`API ${path} 返回 ${resp.status}${detail}${debug}`);
        err.status = resp.status;
        err.data = errData;  // 挂载完整响应体，供调用方细粒度处理
        throw err;
      }
      const data = await resp.json();
      console.log(`[LibPanel] apiGet 响应体:`, data);
      return data;
    } catch (e) {
      clearTimeout(timeoutId);
      console.error(`[LibPanel] apiGet 失败 ${path}:`, e);
      if (e.name === 'AbortError') throw new Error(`API ${path} 请求超时（8秒）`);
      throw e;
    }
  }

  // FC 鉴权白名单端点：无需任何凭证即可直连（绑定时用户必然尚无 token，
  // 若走「无凭证降级对话引导」逻辑，方案 4 内嵌表单在生产环境永远无法直连提交）
  const NO_CREDENTIAL_PATHS = ['/api/bind'];

  /**
   * 调用 FC API（POST 写操作）
   * 直连条件（满足其一即可直接 fetch）：
   *   1. 白名单端点：/api/bind（FC 侧免鉴权，安全由图书馆账号验证 + 限流保障）
   *   2. 开发环境：显式 skip_sign=1 或本地 localhost
   *   3. 持有凭证：URL 带 token（或签名）——FC 端有对应校验可放行
   * 生产环境且无任何凭证时：降级为 CXBOT:send 对话引导（直连必然 403）
   * 修复 P0-2：原实现误用「无签名」判断开发模式，生产环境恒走直连分支
   * 方案 5：凭证优先级 st_token > token；exchange 不可用时回落长期 token
   */
  async function apiPost(path, body = {}, _retried = false) {
    const noCred = NO_CREDENTIAL_PATHS.includes(path);
    if (noCred || CONFIG.DEV_SKIP_SIGN || CONFIG.IS_DEV || CONFIG.HAS_CREDENTIAL) {
      const stToken = noCred ? '' : await getStToken();
      const credential = noCred
        ? {}
        : (stToken ? { st_token: stToken } : (TOKEN ? { token: TOKEN } : {}));
      const url = CONFIG.API_BASE + path;
      const headers = { 'Content-Type': 'application/json' };
      if (BOT_SIGNATURE) headers['X-Robot-Signature'] = BOT_SIGNATURE;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({ ...body, uid: UID, ...credential }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        // 短时效凭证过期（页面停留超有效期）：强制换取新凭证重试一次
        if (resp.status === 403 && stToken && !_retried) {
          console.warn('[LibPanel] st_token 疑似过期，强制刷新后重试:', path);
          const fresh = await getStToken(true);
          if (fresh) return apiPost(path, body, true);
        }
        if (!resp.ok) {
          // 与 apiGet 一致：读取错误响应体，透出 FC 的 msg/debug 信息
          let errData = null;
          try { errData = await resp.json(); } catch (e) { /* 响应体非 JSON，忽略 */ }
          const detail = errData && errData.msg ? `：${errData.msg}` : '';
          const err = new Error(`API ${path} 返回 ${resp.status}${detail}`);
          err.status = resp.status;
          err.data = errData;
          throw err;
        }
        return resp.json();
      } catch (e) {
        clearTimeout(timeoutId);
        if (e.name === 'AbortError') throw new Error(`API ${path} 请求超时（8秒）`);
        throw e;
      }
    }

    // 生产环境且无凭证：iframe 不直接 POST，降级为对话引导
    console.warn('[LibPanel] 生产环境无凭证，POST 降级为 CXBOT 对话引导:', path);
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
          id: 'roommap',
          label: '研讨室地图',
          icon: 'door',
          desc: '研讨室分布与实时余量',
          // 语义触发：让超星在对话区加载研讨室地图 iframe（roommap.html）
          action: { type: 'trigger-task', flow: 'chat', message: '看研讨室地图' },
          fallback: { type: 'prompt', message: '请在对话框输入「看研讨室地图」查看研讨室分布与余量' },
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
          id: 'seat-cancel',
          label: '取消座位预约',
          icon: 'x',
          desc: '查看并取消座位预约',
          action: { type: 'trigger-task', flow: 'seat-cancel' },
          fallback: { type: 'prompt', message: '请在对话框输入「取消座位预约」查看并取消座位预约' },
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
        {
          id: 'room-cancel',
          label: '取消研讨室预约',
          icon: 'x',
          desc: '查看并取消研讨室预约',
          action: { type: 'trigger-task', flow: 'room-cancel' },
          fallback: { type: 'prompt', message: '请在对话框输入「取消研讨室预约」查看并取消研讨室预约' },
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
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
    eyeOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>',
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
    // 注意：TOKEN 导出的是初始值快照（仅调试用）；
    // setToken() 后的最新值请通过后续 API 调用隐式使用，勿读此字段判断
    TOKEN,
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
    // iframe 尺寸与全屏控制（CXBOT 官方协议，2026-08-24）
    resizeIframe,
    requestIframeFullscreen,
    cancelIframeFullscreen,
    // 向后兼容（旧 API，内部转 CXBOT）
    MSG,
    MSG_FROM_PARENT,
    sendToParent,
    onParentMessage,
    // API 客户端
    apiGet,
    apiPost,
    // 凭证管理（方案 4/5：绑定成功后 setToken 免刷新；getStToken 供调试）
    setToken,
    clearToken,
    hasCredential,
    reloadCredential,
    getStToken,
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
    // 测试工具（Console 调用，便于验证签名机制）
    debug: {
      // 测试 1：从 iframe 内 fetch FC 测试接口，看返回的 X-Robot-Signature 头部
      // 用法：在 DevTools Console 执行 LibPanel.debug.testSignature()
      async testSignature() {
        const url = CONFIG.API_BASE + '/api/test/signature?uid=' + UID;
        console.log('[LibPanel.Debug] 测试 1：调用 FC /api/test/signature');
        console.log('  URL:', url);
        console.log('  BOT_SIGNATURE:', BOT_SIGNATURE);
        console.log('  DEV_SKIP_SIGN:', CONFIG.DEV_SKIP_SIGN);
        try {
          const headers = {};
          if (!CONFIG.DEV_SKIP_SIGN && BOT_SIGNATURE) {
            headers['X-Robot-Signature'] = BOT_SIGNATURE;
          }
          const resp = await fetch(url, { headers });
          const data = await resp.json();
          console.log('[LibPanel.Debug] ====== 测试结果 ======');
          console.log('  状态码:', resp.status);
          console.log('  超星注入的 X- 头部:', data.received?.x_headers);
          console.log('  来源 IP:', data.received?.remote_ip);
          console.log('  完整响应:', data);
          console.log('[LibPanel.Debug] ====== 结束 ======');
          console.log('  结论判断：');
          console.log('    - 若 x_headers 含 X-Robot-Signature → 超星自动注入签名给 iframe fetch');
          console.log('    - 若 x_headers 为空或不含 → iframe 路径无自动签名，需走 CXBOT 对话引导');
          return data;
        } catch (e) {
          console.error('[LibPanel.Debug] 测试失败:', e);
          throw e;
        }
      },

      // 测试 2：向超星发 CXBOT 消息，验证协议可达性
      // 用法：LibPanel.debug.testCxbot()
      testCxbot(message = '测试 CXBOT 协议') {
        console.log('[LibPanel.Debug] 测试 2：向超星发 CXBOT:send');
        console.log('  targetOrigin:', CONFIG.CX_ORIGIN);
        console.log('  消息:', message);
        return sendToChat(message, { hidden: false });
      },

      // 测试 3：打印当前 iframe 收到的所有 URL 参数
      // 用法：LibPanel.debug.dumpParams()
      dumpParams() {
        console.log('[LibPanel.Debug] ====== iframe URL 参数 ======');
        console.log('  location.href:', global.location.href);
        console.log('  location.search:', global.location.search);
        console.log('  document.referrer:', global.document.referrer);
        for (const [k, v] of params.entries()) {
          console.log(`  ${k} = ${v}`);
        }
        console.log('[LibPanel.Debug] ====== 结束 ======');
        return {
          uid: UID,
          bot_signature: BOT_SIGNATURE,
          robotTime: ROBOT_TIME,
          robotId: ROBOT_ID,
          bot_msg: BOT_MSG,
          bot_conversation: BOT_CONVERSATION,
          cx_origin: CONFIG.CX_ORIGIN,
          api_base: CONFIG.API_BASE,
          dev_skip_sign: CONFIG.DEV_SKIP_SIGN,
          all_params: Object.fromEntries(params.entries()),
        };
      },

      // 测试 4：从 iframe 内 fetch FC /health，验证基础连通性
      async testHealth() {
        const url = CONFIG.API_BASE + '/health';
        console.log('[LibPanel.Debug] 测试 4：fetch FC /health');
        console.log('  URL:', url);
        try {
          const resp = await fetch(url);
          const data = await resp.json();
          console.log('[LibPanel.Debug] /health 返回:', resp.status, data);
          return data;
        } catch (e) {
          console.error('[LibPanel.Debug] /health 失败:', e);
          throw e;
        }
      },
    },
  };

  // 加载完成通知（超星无对应响应，但保留日志便于调试）
  global.addEventListener('load', () => {
    if (CONFIG.IS_DEV) {
      console.log('[LibPanel] iframe 加载完成，UID:', UID, 'CX_ORIGIN:', CONFIG.CX_ORIGIN);
    }
  });
})(window);
