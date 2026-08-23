/* ============================================================
 * DeepSeekChat - DeepSeek立绘驱动对话前端
 * 纯前端实现：Chat / 流式输出 / 情绪立绘 / 音效 / 特效 / 多对话
 * ============================================================ */
'use strict';

/* ---------------- 工具函数 ---------------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn('保存失败', e);
  }
}

function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

/* ---------------- 默认数据 ---------------- */
const DEFAULT_SYSTEM_PROMPT = `你是 DeepSeek，一位深海主题的拟人智能助手。
你性格温柔、活泼、有亲和力，可以适当带一点拟人化情绪。
请用中文回复，口语化、自然、简洁。
请尽量在每一轮回复末尾附加情绪标签，例如 [emotion=常态]、[emotion=开心]、[emotion=惊喜]、[emotion=思索]、[emotion=悲伤]、[emotion=愤怒]；语境有明显情绪时请更频繁地切换表情。
标签只用于前端立绘切换，不要写进最终对话内容里。`;

const PRESET_PROMPTS = {
  deepseek: DEFAULT_SYSTEM_PROMPT,
  custom: '',
  programmer: `你是一位资深全栈工程师，擅长 JavaScript、Python、前端工程化和架构设计。回答准确、简洁、可操作。`,
  translator: `你是一位专业的中英互译翻译官。忠实传达原意，语言自然流畅，必要时给出注释。`,
};

const DEFAULT_SETTINGS = {
  theme: 'system',
  fontSize: 'medium',
  provider: 'openai',
  apiKeys: [],
  activeKeyId: null,
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  temperature: 0.7,
  topP: 1,
  maxTokens: 2048,
  maxContext: 8192,
  frequencyPenalty: 0,
  presencePenalty: 0,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  promptPresets: [],
  compressionThreshold: 20,
  compressionStrategy: 'summary',
  autoCompress: false,
  soundEnabled: true,
  effectsEnabled: true,
  volume: 0.5,
  proxyEnabled: false,
  proxyPrefix: '',
  customHeaders: '{}',
  customPath: '',
  customMethod: 'POST',
  customBodyTemplate: '',
  customResponsePath: '',
  customStream: true,
  customModelsUrl: '',
  customModelsPath: '',
};

/* 情绪 -> assets 图片 */
const EMOTION_ASSETS = {
  normal: 'normal.png',
  happy: 'happy.png',
  surprised: 'surprised.png',
  angry: 'angry.png',
  thinking: 'thinking.png',
  sad: 'sad.png',
  nervous: 'nervous.png',
  silly: 'silly.png',
  eating: 'eating.png',
};

/* 情绪别名归一化 */
const EMOTION_ALIASES = {
  '常态': 'normal', '平静': 'normal', '正常': 'normal', '普通': 'normal', 'normal': 'normal',
  '开心': 'happy', '高兴': 'happy', '快乐': 'happy', '愉快': 'happy', 'happy': 'happy',
  '惊喜': 'surprised', '惊讶': 'surprised', '惊': 'surprised', 'surprised': 'surprised',
  '愤怒': 'angry', '生气': 'angry', '恼怒': 'angry', 'angry': 'angry',
  '思索': 'thinking', '思考': 'thinking', '疑惑': 'thinking', '困惑': 'thinking', '疑问': 'thinking', 'thinking': 'thinking',
  '悲伤': 'sad', '伤心': 'sad', '难过': 'sad', '委屈': 'sad', 'sad': 'sad',
  '紧张': 'nervous', '害怕': 'nervous', '心虚': 'nervous', '恐惧': 'nervous', 'nervous': 'nervous',
  '傻乐呵': 'silly', '傻笑': 'silly', '流口水': 'silly', '呆萌': 'silly', 'silly': 'silly',
  '干饭': 'eating', '吃token': 'eating', '吃饭': 'eating', '饿了': 'eating', 'eating': 'eating',
  '被震撼': 'sad', '震惊': 'sad', '震撼': 'sad', 'shocked': 'sad',
};

/* ---------------- 全局状态 ---------------- */
let settings = Object.assign({}, DEFAULT_SETTINGS, loadJSON('dsc_settings', {}));
if (!Array.isArray(settings.apiKeys)) settings.apiKeys = [];
if (!Array.isArray(settings.promptPresets)) settings.promptPresets = [];
if (settings.apiKeys.length && (!settings.activeKeyId || !settings.apiKeys.some((k) => k.id === settings.activeKeyId))) {
  settings.activeKeyId = settings.apiKeys[0].id;
} else if (!settings.apiKeys.length) {
  settings.activeKeyId = null;
}
let conversations = loadJSON('dsc_conversations', []);
if (!Array.isArray(conversations)) conversations = [];
let activeConversationId = loadJSON('dsc_active_conversation', null);
let logs = loadJSON('dsc_logs', []);
if (!Array.isArray(logs)) logs = [];

let currentEmotion = 'normal';
let emotionResetTimer = null;
let charFrontIsA = true;
let isStreaming = false;
let abortController = null;
let pendingImages = [];
let audioCtx = null;
let fxParticles = [];
let fxRAF = null;
let streamTargetEl = null;
let streamCharCount = 0;
let streamCharsSinceSound = 0;
let streamStartTime = 0;
let typeSoundClock = 0;
let setupDismissed = loadJSON('dsc_setup_dismissed', false);

/* ---------------- DOM 引用 ---------------- */
const messagesEl = $('#messages');
const errorBanner = $('#errorBanner');
const inputEl = $('#input');
const sendBtn = $('#sendBtn');
const attachBtn = $('#attachBtn');
const fileInput = $('#fileInput');
const imagePreviews = $('#imagePreviews');
const chatTitle = $('#chatTitle');
const conversationList = $('#conversationList');
const conversationDrawer = $('#conversationDrawer');
const settingsDrawer = $('#settingsDrawer');
const drawerMask = $('#drawerMask');
const chatModelSelect = $('#chatModelSelect');
const openLogBtn = $('#openLogBtn');
const logPanel = $('#logPanel');
const logList = $('#logList');
const fxCanvas = $('#fxCanvas');
const characterLayer = $('#characterLayer');
const charImgA = $('#charImgA');
const charImgB = $('#charImgB');
const angryRings = $('#angryRings');
const themeBtn = $('#themeBtn');

/* 简约 SVG 图标（不使用 emoji） */
const ICONS = {
  send: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"></path><path d="M22 2L15 22L11 13L2 9L22 2z"></path></svg>`,
  loading: `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2a10 10 0 0 1 10 10"></path></svg>`,
  moon: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3A7 7 0 0 0 21 12.79z"></path></svg>`,
  sun: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"></path></svg>`,
  pencil: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path></svg>`,
  trash: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6M14 11v6"></path></svg>`,
  copy: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`,
  regenerate: `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"></path><path d="M20.49 15a9 9 0 1 1-2.13-9.36L23 10"></path></svg>`,
};

/* ============================================================
 * 初始化
 * ============================================================ */
function init() {
  bindEvents();
  ensureConversation();
  applyTheme();
  applyFontScale();
  sendBtn.innerHTML = ICONS.send;
  preloadCharacterImages();
  charImgA.onerror = () => { charImgA.src = './assets/calm.png'; };
  renderConversationList();
  renderMessages();
  refreshSettingsForm();
  renderLog();
  scheduleFirstRunSetup();
  window.addEventListener('resize', resizeFxCanvas);
  resizeFxCanvas();
  addLog('info', '应用已启动');
}

function ensureConversation() {
  if (!conversations.length) {
    const c = createConversationObject('新对话');
    conversations.push(c);
    activeConversationId = c.id;
  }
  if (!conversations.some((c) => c.id === activeConversationId)) {
    activeConversationId = conversations[0].id;
  }
  saveState();
}

function getActiveConversation() {
  return conversations.find((c) => c.id === activeConversationId) || conversations[0];
}

function saveState() {
  saveJSON('dsc_settings', settings);
  saveJSON('dsc_conversations', conversations);
  saveJSON('dsc_active_conversation', activeConversationId);
}

function scheduleFirstRunSetup() {
  const hasKey = getActiveKey();
  if (!hasKey && !setupDismissed) {
    $('#setupModal').classList.remove('hidden');
  }
}

/* ============================================================
 * 对话管理
 * ============================================================ */
function createConversationObject(title) {
  return {
    id: uid('conv'),
    title: title || '新对话',
    messages: [],
    systemPrompt: settings.systemPrompt !== undefined && settings.systemPrompt !== null ? settings.systemPrompt : DEFAULT_SYSTEM_PROMPT,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function createConversation() {
  const c = createConversationObject('新对话');
  conversations.unshift(c);
  activeConversationId = c.id;
  saveState();
  renderConversationList();
  switchConversation(c.id, true);
  closeDrawers();
}

function switchConversation(id, silent = false) {
  activeConversationId = id;
  saveState();
  renderConversationList();
  renderMessages();
  refreshSettingsForm();
  // 新建/切换对话时立绘回到常态
  switchEmotion('normal', { effect: false, log: true });
  if (!silent) closeDrawers();
  addLog('info', `切换到对话：${getActiveConversation().title}`);
}

function deleteConversation(id) {
  const idx = conversations.findIndex((c) => c.id === id);
  if (idx === -1) return;
  const convo = conversations[idx];
  if (conversations.length > 1 && !confirm(`确定删除对话“${convo.title}”吗？`)) return;
  conversations.splice(idx, 1);
  if (activeConversationId === id) {
    activeConversationId = conversations[0] ? conversations[0].id : null;
  }
  if (!conversations.length) {
    const c = createConversationObject('新对话');
    conversations.push(c);
    activeConversationId = c.id;
  }
  saveState();
  renderConversationList();
  renderMessages();
  refreshSettingsForm();
}

function renameConversation(id) {
  const convo = conversations.find((c) => c.id === id);
  if (!convo) return;
  const title = prompt('重命名对话', convo.title);
  if (title && title.trim()) {
    convo.title = title.trim();
    saveState();
    renderConversationList();
    updateChatTitle();
  }
}

function updateChatTitle() {
  chatTitle.textContent = getActiveConversation().title || '新对话';
}

function renderConversationList() {
  conversationList.innerHTML = '';
  for (const c of conversations) {
    const item = document.createElement('div');
    item.className = 'conversation-item' + (c.id === activeConversationId ? ' active' : '');
    const titleSpan = document.createElement('span');
    titleSpan.className = 'conv-title';
    titleSpan.textContent = c.title || '新对话';
    const actions = document.createElement('div');
    actions.className = 'conv-actions';
    const renameBtn = document.createElement('button');
    renameBtn.className = 'conv-action';
    renameBtn.innerHTML = ICONS.pencil;
    renameBtn.title = '重命名';
    renameBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      renameConversation(c.id);
    });
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'conv-action';
    deleteBtn.innerHTML = ICONS.trash;
    deleteBtn.title = '删除';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteConversation(c.id);
    });
    actions.appendChild(renameBtn);
    actions.appendChild(deleteBtn);
    item.appendChild(titleSpan);
    item.appendChild(actions);
    item.addEventListener('click', () => switchConversation(c.id));
    conversationList.appendChild(item);
  }
}

/* ============================================================
 * 消息渲染
 * ============================================================ */
function createMessageNode(msg) {
  const wrapper = document.createElement('div');
  wrapper.className = `message ${msg.role}`;

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  // 用户上传的图片预览
  if (msg.images && msg.images.length) {
    const imgWrap = document.createElement('div');
    imgWrap.className = 'message-images';
    for (const img of msg.images) {
      const im = document.createElement('img');
      im.src = img.dataUrl;
      im.alt = '上传图片';
      imgWrap.appendChild(im);
    }
    bubble.appendChild(imgWrap);
  }

  // 文本内容
  const textNode = document.createElement('div');
  textNode.className = 'msg-text';
  if (msg.error) {
    bubble.classList.add('error');
    const errText = msg.content ? `${msg.content}\n\n[错误] ${msg.error}` : `[错误] ${msg.error}`;
    textNode.textContent = errText;
  } else if (msg.streaming && !msg.content) {
    textNode.textContent = '…';
  } else {
    textNode.textContent = msg.content || '';
  }
  bubble.appendChild(textNode);

  // token 统计
  if (msg.stats && !msg.error) {
    const meta = document.createElement('div');
    meta.className = 'message-meta';
    meta.textContent = `输入: ${formatNumber(msg.stats.inputTokens)} tokens | 输出: ${formatNumber(msg.stats.outputTokens)} tokens | 速度: ${formatNumber(Math.round(msg.stats.speed))} tokens/s`;
    bubble.appendChild(meta);
  }

  // 消息操作按钮（非流式中显示；使用 SVG 图标，不用 emoji）
  if (!msg.streaming) {
    const actions = document.createElement('div');
    actions.className = 'message-actions';

    const makeAction = (title, icon, handler) => {
      const btn = document.createElement('button');
      btn.className = 'msg-action';
      btn.title = title;
      btn.innerHTML = icon;
      btn.addEventListener('click', handler);
      actions.appendChild(btn);
    };

    makeAction('复制', ICONS.copy, () => copyMessageText(msg));

    if (msg.role === 'user') {
      makeAction('修改', ICONS.pencil, () => editUserMessage(msg.id));
    } else if (msg.role === 'assistant' && !msg.error) {
      makeAction('重新生成', ICONS.regenerate, () => regenerateAssistantMessage(msg.id));
    }

    makeAction('删除', ICONS.trash, () => deleteMessage(msg.id));
    bubble.appendChild(actions);
  }

  wrapper.appendChild(bubble);
  return wrapper;
}

function copyMessageText(msg) {
  const text = msg.content || '';
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch (e) { /* noop */ }
  document.body.removeChild(ta);
}

function editUserMessage(id) {
  const convo = getActiveConversation();
  const msg = convo.messages.find((m) => m.id === id && m.role === 'user');
  if (!msg) return;
  const newText = prompt('修改用户消息', msg.content);
  if (newText === null) return;
  msg.content = newText;
  msg.updatedAt = Date.now();
  saveState();
  renderMessages();
  addLog('info', '已修改用户消息');
}

function deleteMessage(id) {
  const convo = getActiveConversation();
  const idx = convo.messages.findIndex((m) => m.id === id);
  if (idx === -1) return;
  convo.messages.splice(idx, 1);
  saveState();
  renderMessages();
  addLog('info', '已删除一条消息');
}

function regenerateAssistantMessage(id) {
  const convo = getActiveConversation();
  const idx = convo.messages.findIndex((m) => m.id === id && m.role === 'assistant');
  if (idx === -1) return;
  if (isStreaming) {
    alert('正在生成回复，请稍候');
    return;
  }
  if (idx !== convo.messages.length - 1) {
    alert('目前只能重新生成最后一条 AI 回复');
    return;
  }
  convo.messages.splice(idx, 1);
  saveState();
  renderMessages();
  requestAssistantReply(convo);
}

function renderMessages() {
  const convo = getActiveConversation();
  messagesEl.innerHTML = '';
  for (const msg of convo.messages) {
    messagesEl.appendChild(createMessageNode(msg));
  }
  scrollToBottom();
  updateChatTitle();
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function showErrorBanner(text) {
  errorBanner.textContent = text;
  errorBanner.classList.remove('hidden');
  setTimeout(() => errorBanner.classList.add('hidden'), 6000);
}

/* ============================================================
 * 发送与流式回复
 * ============================================================ */
async function handleSend() {
  if (isStreaming) return;
  const text = inputEl.value.trim();
  if (!text && pendingImages.length === 0) return;

  const convo = getActiveConversation();
  const userMsg = {
    id: uid('msg'),
    role: 'user',
    content: text,
    images: pendingImages.slice(),
    createdAt: Date.now(),
  };
  convo.messages.push(userMsg);
  if (!convo.title || convo.title === '新对话') {
    convo.title = text.slice(0, 18) || '新对话';
  }
  convo.updatedAt = Date.now();

  pendingImages = [];
  inputEl.value = '';
  autoResizeInput();
  renderImagePreviews();
  saveState();
  renderConversationList();
  renderMessages();

  await requestAssistantReply(convo);
}

async function requestAssistantReply(convo) {
  if (!getActiveKey()) {
    const err = '还没有配置 API Key，请先在设置中填写 Key。';
    appendErrorToConversation(convo, err);
    showErrorBanner(err);
    openSettings();
    return;
  }

  const assistantMsg = {
    id: uid('msg'),
    role: 'assistant',
    content: '',
    streaming: true,
    createdAt: Date.now(),
    stats: null,
  };

  // 用于 API 的历史消息不包含刚创建的空白流式占位
  const apiMessages = convo.messages
    .filter((m) => m.id !== assistantMsg.id && !m.streaming && !m.error)
    .map(normalizeMessageForAPI);
  // 根据“最大上下文长度”粗略裁剪早期消息
  const apiMessagesForRequest = limitMessagesForContext(apiMessages);

  convo.messages.push(assistantMsg);
  saveState();
  renderMessages();

  // 取最后一条用户消息，用于情绪推断
  const lastUserMsg = [...convo.messages].reverse().find((m) => m.role === 'user' && !m.error);
  const userTextForContext = lastUserMsg ? (lastUserMsg.content || '') : '';

  const systemPrompt = convo.systemPrompt !== undefined && convo.systemPrompt !== null
    ? convo.systemPrompt
    : (settings.systemPrompt || DEFAULT_SYSTEM_PROMPT);

  // 新一轮回复开始时：先根据用户语境触发情绪，更灵敏
  const initialEmotion = inferEmotionFromText(userTextForContext);
  if (initialEmotion !== 'normal') {
    switchEmotion(initialEmotion, { effect: true, log: true });
  } else {
    switchEmotion('normal', { effect: false, log: true });
  }

  isStreaming = true;
  sendBtn.disabled = true;
  sendBtn.innerHTML = ICONS.loading; sendBtn.classList.add('loading');
  abortController = new AbortController();
  streamTargetEl = messagesEl.lastElementChild ? messagesEl.lastElementChild.querySelector('.msg-text') : null;
  streamCharCount = 0;
  streamCharsSinceSound = 0;
  typeSoundClock = 0;
  streamStartTime = Date.now();

  let rawContent = '';
  let displayText = '';
  let lastEmotion = null;

  try {
    await streamApi({
      messages: apiMessagesForRequest,
      systemPrompt: systemPrompt,
      signal: abortController.signal,
      onDelta: (chunk) => {
        rawContent += chunk;
        streamCharCount += chunk.length;
        // 每一个字符都触发一次打字音效，而不是整轮只响一次
        for (let i = 0; i < chunk.length; i++) playTypeSound();

        const parsed = parseEmotionTags(rawContent);
        displayText = parsed.clean;
        if (streamTargetEl) streamTargetEl.textContent = displayText || '…';
        scrollToBottom();

        let detectedEmotion = parsed.emotion;
        if (!detectedEmotion) {
          // 没有显式标签时，用本地语境推断，让立绘触发更频繁、更灵动
          const inferred = inferEmotionFromText(displayText);
          if (inferred !== 'normal') detectedEmotion = inferred;
        }
        if (detectedEmotion && detectedEmotion !== lastEmotion) {
          lastEmotion = detectedEmotion;
          switchEmotion(detectedEmotion, { effect: true, log: true });
        }
      },
    });

    if (!rawContent) {
      assistantMsg.content = '';
      assistantMsg.streaming = false;
      renderMessages();
      return;
    }

    const finalParsed = parseEmotionTags(rawContent);
    displayText = finalParsed.clean;
    let finalEmotion = finalParsed.emotion || inferEmotionFromText(displayText);
    if (lastEmotion) {
      // 已处理
    } else if (finalEmotion && finalEmotion !== 'normal') {
      lastEmotion = finalEmotion;
      switchEmotion(lastEmotion, { effect: true, log: true });
    } else {
      switchEmotion('normal', { effect: false, log: true });
    }

    const elapsedSec = Math.max(0.01, (Date.now() - streamStartTime) / 1000);
    const inputTokens = estimateTokens(JSON.stringify(apiMessagesForRequest.map((m) => m.content || '')));
    const outputTokens = estimateTokens(displayText);
    const speed = outputTokens / elapsedSec;

    assistantMsg.content = displayText;
    assistantMsg.streaming = false;
    assistantMsg.stats = { inputTokens, outputTokens, speed };
    convo.updatedAt = Date.now();
    saveState();
    renderMessages();
    addLog('api', `回复完成：模型 ${settings.model}，输入 ${inputTokens} tokens，输出 ${outputTokens} tokens`);
    maybeAutoFetchModels();

    if (settings.autoCompress && convo.messages.length > settings.compressionThreshold) {
      await compressConversation(convo);
    }
  } catch (err) {
    const friendly = friendlyError(err);
    const hasPartial = !!displayText;
    assistantMsg.content = hasPartial ? displayText : '';
    assistantMsg.error = friendly;
    assistantMsg.streaming = false;
    convo.updatedAt = Date.now();
    saveState();
    renderMessages();
    showErrorBanner(friendly);
    addLog('error', `API 错误：${friendly}`);
  } finally {
    isStreaming = false;
    sendBtn.disabled = false;
    sendBtn.innerHTML = ICONS.send; sendBtn.classList.remove('loading');
    abortController = null;
    streamTargetEl = null;
    streamCharCount = 0;
    streamCharsSinceSound = 0;
    typeSoundClock = 0;
  }
}

function appendErrorToConversation(convo, message) {
  convo.messages.push({
    id: uid('msg'),
    role: 'assistant',
    content: '',
    error: message,
    createdAt: Date.now(),
  });
  saveState();
  renderMessages();
}

/* ============================================================
 * 解析情绪标签
 * [emotion=惊喜] 完整标签会被移除；未闭合标签也不会显示出来
 * ============================================================ */
function parseEmotionTags(raw) {
  const regex = /\[emotion=([^\]]+)\]/g;
  let emotion = null;
  let match;
  while ((match = regex.exec(raw)) !== null) {
    emotion = match[1];
  }
  // 去掉完整标签和尾部未闭合标签
  const clean = raw.replace(/\[emotion=[^\]]*\]/g, '').replace(/\[emotion=[^\]]*$/g, '');
  return { clean: clean.trim(), emotion };
}

function normalizeEmotion(input) {
  if (!input) return 'normal';
  const key = String(input).trim();
  return EMOTION_ALIASES[key] || EMOTION_ALIASES[key.toLowerCase()] || 'normal';
}

/* 本地情绪推断：没有显式标签时也根据语境触发，让立绘更灵敏、更生动 */
function inferEmotionFromText(text) {
  if (!text) return 'normal';
  const t = String(text);

  if (/(谢谢|感谢|夸奖|夸我|厉害|好棒|真棒|太棒|优秀|聪明|喜欢|爱你|表白|神仙|膜拜|惊喜)/.test(t)) return 'surprised';
  if (/(生气|愤怒|讨厌|烦死|气死|可恶|混蛋|滚|不满|批评|骂我|过分)/.test(t)) return 'angry';
  if (/(伤心|难过|哭|委屈|悲伤|难受|失望|失败|孤独|心痛)/.test(t)) return 'sad';
  if (/(哈哈|嘻嘻|开心|高兴|快乐|好笑|有趣|笑死|逗死|好玩)/.test(t)) return 'happy';
  if (/(为什么|怎么|如何|是什么|分析|解释|复杂|思考|问题|总结|代码|逻辑|方案|原因)/.test(t)) return 'thinking';
  return 'normal';
}

/* ============================================================
 * 立绘切换：switchEmotion()
 * ============================================================ */
function preloadCharacterImages() {
  Object.values(EMOTION_ASSETS).forEach((file) => {
    const img = new Image();
    img.src = `./assets/${file}`;
  });
}

function switchEmotion(state, { effect = true, log = true } = {}) {
  const normalized = normalizeEmotion(state);
  if (normalized === currentEmotion) {
    return;
  }
  currentEmotion = normalized;

  // 非常态情绪 30 秒后自动回到常态；常态无需切换
  if (emotionResetTimer) {
    clearTimeout(emotionResetTimer);
    emotionResetTimer = null;
  }
  if (normalized !== 'normal') {
    emotionResetTimer = setTimeout(() => {
      emotionResetTimer = null;
      if (currentEmotion !== 'normal') {
        switchEmotion('normal', { effect: false, log: true });
      }
    }, 30000);
  }

  const assetFile = EMOTION_ASSETS[normalized] || 'normal.png';
  const nextSrc = `./assets/${assetFile}`;
  const front = charFrontIsA ? charImgA : charImgB;
  const back = charFrontIsA ? charImgB : charImgA;

  // 如果隐藏层已经是目标图片（例如切回之前用过的状态），直接切换，避免相同 src 不触发 load
  const backAlreadyHasSrc = back.getAttribute('src') === nextSrc && back.complete;
  if (backAlreadyHasSrc) {
    back.onload = null;
    back.onerror = null;
    front.classList.remove('visible');
    back.classList.add('visible');
    charFrontIsA = !charFrontIsA;
  } else {
    // 先把新图放到隐藏层，加载完成后再交叉淡化
    back.onload = () => {
      front.classList.remove('visible');
      back.classList.add('visible');
      charFrontIsA = !charFrontIsA;
    };
    back.onerror = () => {
      // 占位回退：任何缺失图片都回退到平静.png（calm.png / normal.png 同图）
      if (nextSrc !== './assets/calm.png') {
        back.onerror = null;
        back.src = './assets/calm.png';
        currentEmotion = 'normal';
        addLog('emotion', '立绘图片缺失，已回退至 平静.png');
      }
    };
    back.src = nextSrc;
  }

  if (log) addLog('emotion', `立绘切换到：${normalized}（${assetFile}）`);
  if (effect && settings.effectsEnabled) {
    playEmotionEffect(normalized);
  }
}

/* ============================================================
 * 音效：Web Audio 实时合成 800Hz / 50ms
 * ============================================================ */
function ensureAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) audioCtx = new AC();
  }
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
}

function playTypeSound() {
  if (!settings.soundEnabled || settings.volume <= 0) return;
  ensureAudio();
  if (!audioCtx) return;

  // 固定约 50ms 间隔，从输出开始持续到输出结束，不会太快也不会太慢
  const now = audioCtx.currentTime;
  if (now < typeSoundClock) return;
  const startAt = now;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.value = 800;
  osc.connect(gain);
  gain.connect(audioCtx.destination);

  const vol = Math.max(0.001, settings.volume * 0.25);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(vol, startAt + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.05);
  osc.start(startAt);
  osc.stop(startAt + 0.06);
  typeSoundClock = now + 0.05;
}

function playCharacterTapSound() {
  if (!settings.soundEnabled || settings.volume <= 0) return;
  ensureAudio();
  if (!audioCtx) return;
  const t = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(520, t);
  osc.frequency.exponentialRampToValueAtTime(880, t + 0.09);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  const vol = Math.max(0.001, settings.volume * 0.3);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  osc.start(t);
  osc.stop(t + 0.15);
}

function triggerCharacterTap() {
  if (!characterLayer) return;
  characterLayer.classList.remove('tap');
  void characterLayer.offsetWidth;
  characterLayer.classList.add('tap');
  setTimeout(() => characterLayer.classList.remove('tap'), 450);
  playCharacterTapSound();
}

/* ============================================================
 * 情绪特效：烟花 / 花瓣 / 雨滴 / 红色波动环
 * ============================================================ */
function resizeFxCanvas() {
  const scale = window.devicePixelRatio || 1;
  fxCanvas.width = innerWidth * scale;
  fxCanvas.height = innerHeight * scale;
  fxCanvas.style.width = innerWidth + 'px';
  fxCanvas.style.height = innerHeight + 'px';
  const ctx = fxCanvas.getContext('2d');
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
}

function scheduleEffectTone(freq, startAt, dur, type, volScale) {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  const vol = Math.max(0.001, settings.volume * volScale);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(vol, startAt + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + Math.max(0.05, dur - 0.02));
  osc.start(startAt);
  osc.stop(startAt + dur + 0.02);
}

function playEmotionEffectSound(state) {
  if (!settings.soundEnabled || settings.volume <= 0) return;
  ensureAudio();
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  if (state === 'surprised') {
    // 烟花音效：先一声低鸣，再一串金色高频星点声
    scheduleEffectTone(140, now, 0.3, 'sine', 0.35);
    for (let i = 0; i < 6; i++) {
      scheduleEffectTone(600 + i * 180, now + 0.06 + i * 0.04, 0.09, 'triangle', 0.14);
    }
  } else if (state === 'happy') {
    scheduleEffectTone(660, now, 0.1, 'sine', 0.2);
    scheduleEffectTone(880, now + 0.1, 0.12, 'sine', 0.2);
  } else if (state === 'sad') {
    scheduleEffectTone(440, now, 0.25, 'sine', 0.18);
    scheduleEffectTone(330, now + 0.2, 0.3, 'sine', 0.16);
  } else if (state === 'angry') {
    scheduleEffectTone(110, now, 0.25, 'sawtooth', 0.14);
    scheduleEffectTone(90, now + 0.12, 0.3, 'sawtooth', 0.14);
  }
}

function playEmotionEffect(state) {
  if (state === 'surprised') fireworkEffect();
  else if (state === 'happy') petalEffect();
  else if (state === 'sad') rainEffect();
  else if (state === 'angry') angryRingEffect();
  playEmotionEffectSound(state);
}

function addFxParticle(p) {
  fxParticles.push(p);
  if (!fxRAF) fxRAF = requestAnimationFrame(runFxLoop);
}

function runFxLoop() {
  const ctx = fxCanvas.getContext('2d');
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  const alive = [];

  for (const p of fxParticles) {
    p.life -= 1 / 60;
    if (p.life <= 0) continue;

    if (p.type === 'rocket') {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.05;
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fill();
      if (p.y <= p.targetY) {
        // 到达目标高度后爆炸为金色星点（压入 alive，避免被下一帧清空）
        for (let i = 0; i < 28; i++) {
          const angle = (Math.PI * 2 * i) / 28 + Math.random() * 0.4;
          const speed = 2 + Math.random() * 4;
          alive.push({
            type: 'spark',
            x: p.x,
            y: p.y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 0.8,
            color: Math.random() > 0.5 ? '#ffd166' : '#ffb703',
            size: 2 + Math.random() * 2,
          });
        }
        continue;
      }
      alive.push(p);
    } else if (p.type === 'spark') {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.08;
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
      alive.push(p);
    } else if (p.type === 'petal') {
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.01;
      p.rot += p.vr;
      ctx.globalAlpha = Math.max(0, p.life) * 0.8;
      ctx.fillStyle = p.color;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.beginPath();
      ctx.ellipse(0, 0, p.size, p.size * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      alive.push(p);
    } else if (p.type === 'rain') {
      p.x += p.vx;
      p.y += p.vy;
      ctx.globalAlpha = Math.max(0, p.life) * 0.7;
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 2, p.y - p.vy * 2);
      ctx.stroke();
      alive.push(p);
    }
  }

  fxParticles = alive;
  if (fxParticles.length) {
    fxRAF = requestAnimationFrame(runFxLoop);
  } else {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    fxRAF = null;
  }
}

/* 惊喜：两束小型烟花从底部升空，爆炸为金色星点 */
function fireworkEffect() {
  for (let i = 0; i < 2; i++) {
    const targetY = innerHeight * (0.2 + Math.random() * 0.25);
    addFxParticle({
      type: 'rocket',
      x: innerWidth * (0.3 + Math.random() * 0.4),
      y: innerHeight + 10,
      vx: (Math.random() - 0.5) * 1.2,
      vy: -(14 + Math.random() * 4),
      targetY,
      life: 1.0,
      color: '#ffd166',
    });
  }
}

/* 开心：屏幕边缘飘落粉色半透明花瓣 */
function petalEffect() {
  const count = 18;
  for (let i = 0; i < count; i++) {
    let x, y, vx;
    if (i % 3 === 0) {
      // 从左右边缘飘入
      const fromLeft = Math.random() > 0.5;
      x = fromLeft ? -12 : innerWidth + 12;
      y = Math.random() * innerHeight * 0.6;
      vx = (fromLeft ? 1 : -1) * (0.5 + Math.random() * 0.7);
    } else {
      // 从顶部飘落
      x = Math.random() * innerWidth;
      y = -10 - Math.random() * 40;
      vx = (Math.random() - 0.5) * 0.8;
    }
    addFxParticle({
      type: 'petal',
      x,
      y,
      vx,
      vy: 1.2 + Math.random() * 1.5,
      rot: Math.random() * Math.PI * 2,
      vr: (Math.random() - 0.5) * 0.08,
      size: 5 + Math.random() * 5,
      color: `rgba(255, ${150 + Math.floor(Math.random() * 80)}, 200, 0.6)`,
      life: 1.6,
    });
  }
}

/* 悲伤：屏幕顶部落下稀疏淡蓝雨滴 */
function rainEffect() {
  const count = 26;
  for (let i = 0; i < count; i++) {
    const x = Math.random() * innerWidth;
    const speed = 6 + Math.random() * 5;
    addFxParticle({
      type: 'rain',
      x,
      y: -20 - Math.random() * 80,
      vx: -0.3,
      vy: speed,
      color: 'rgba(96,165,250,0.75)',
      life: 1.6,
    });
  }
}

/* 愤怒：角色周围红色波动环（CSS 动画） */
function angryRingEffect() {
  angryRings.classList.remove('active');
  void angryRings.offsetWidth;
  angryRings.classList.add('active');
  setTimeout(() => angryRings.classList.remove('active'), 1600);
}

/* ============================================================
 * API 流式请求
 * 支持 OpenAI / Anthropic / 自定义协议
 * ============================================================ */
function getActiveKey() {
  const key = settings.apiKeys.find((k) => k.id === settings.activeKeyId);
  return key && key.key ? key : null;
}

function parseCustomHeaders() {
  try {
    const key = getActiveKey();
    const text = (settings.customHeaders || '{}')
      .replace(/\{\{apiKey\}\}/g, key ? key.key : '')
      .replace(/\{\{model\}\}/g, settings.model || '');
    const obj = JSON.parse(text);
    return Object.keys(obj).reduce((acc, k) => {
      if (typeof obj[k] === 'string') acc[k] = obj[k];
      return acc;
    }, {});
  } catch {
    return {};
  }
}

function msgTextForLimiting(m) {
  if (Array.isArray(m.content)) {
    return m.content.map((c) => c.text || '').join(' ');
  }
  return m.content || '';
}

function limitMessagesForContext(messages) {
  const maxContext = Number(settings.maxContext) || 8192;
  const total = estimateTokens(messages.map(msgTextForLimiting).join('\n'));
  if (total <= maxContext || messages.length <= 2) return messages;

  const kept = [];
  let acc = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const t = estimateTokens(msgTextForLimiting(messages[i]));
    if (kept.length >= 2 && acc + t > maxContext) break;
    kept.unshift(messages[i]);
    acc += t;
  }
  addLog('api', `上下文超出预算，仅保留最近 ${kept.length} 条消息`);
  return kept;
}

function normalizeMessageForAPI(msg) {
  const role = msg.role === 'assistant' ? 'assistant' : 'user';
  const images = msg.images || [];

  if (!images.length) {
    return { role, content: msg.content || '' };
  }

  // OpenAI 风格多模态 content
  if (settings.provider !== 'anthropic') {
    const content = [{ type: 'text', text: msg.content || '' }];
    for (const img of images) {
      content.push({ type: 'image_url', image_url: { url: img.dataUrl } });
    }
    return { role, content };
  }

  // Anthropic 风格多模态 content
  const content = [{ type: 'text', text: msg.content || '' }];
  for (const img of images) {
    const parts = (img.dataUrl || '').split(',');
    const mime = img.mime || 'image/png';
    const data = parts[1] || '';
    content.push({ type: 'image', source: { type: 'base64', media_type: mime, data } });
  }
  return { role, content };
}

function buildFinalUrl(url) {
  let finalUrl = url;
  if (settings.proxyEnabled && settings.proxyPrefix) {
    const prefix = settings.proxyPrefix.replace(/\/+$/, '');
    finalUrl = prefix + '/' + url.replace(/^\/+/, '');
  }
  return finalUrl;
}

async function streamApi({ messages, systemPrompt, signal, onDelta }) {
  const apiKey = getActiveKey();
  const provider = settings.provider;

  if (provider === 'custom') {
    await streamCustomProtocol({ messages, systemPrompt, signal, onDelta, apiKey });
  } else if (provider === 'anthropic') {
    await streamAnthropic({ messages, systemPrompt, signal, onDelta, apiKey });
  } else {
    await streamOpenAICompatible({ messages, systemPrompt, signal, onDelta, apiKey });
  }
}

/* ---------------- 自定义协议：完全由用户填写模板 ---------------- */
function renderCustomTemplate(template, vars) {
  return String(template || '').replace(/\{\{(\w+)\}\}/g, (m, key) => {
    if (key === 'messages') return JSON.stringify(vars.messages || []);
    if (key === 'system' || key === 'systemPrompt') return JSON.stringify(vars.systemPrompt || '');
    if (key in vars) {
      const val = vars[key];
      if (typeof val === 'string') return JSON.stringify(val);
      if (val === undefined || val === null) return '';
      return String(val);
    }
    return '';
  });
}

function extractJsonPath(obj, path) {
  if (!path) return '';
  return String(path).split('.').reduce((cur, part) => {
    if (cur === null || cur === undefined) return undefined;
    const arr = part.match(/^(.*)\[(\d+)\]$/);
    if (arr) return cur[arr[1]] ? cur[arr[1]][Number(arr[2])] : undefined;
    return cur[part];
  }, obj);
}

function firstTextFromJson(json) {
  if (!json) return '';
  if (json.output?.text) return json.output.text;
  if (json.text) return json.text;
  if (json.content && typeof json.content === 'string') return json.content;
  if (Array.isArray(json.content)) return json.content.map((c) => c.text || '').join('');
  if (json.choices?.[0]?.delta?.content) return json.choices[0].delta.content;
  if (json.choices?.[0]?.message?.content) return json.choices[0].message.content;
  if (json.data?.output?.text) return json.data.output.text;
  return '';
}

async function readSSECustom(response, processor) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.search(/\r?\n/)) >= 0) {
      let line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data:')) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === '[DONE]') continue;
      try {
        processor(JSON.parse(data));
      } catch {
        processor(data);
      }
    }
  }
  const rest = buffer.trim();
  if (rest.startsWith('data:')) {
    const data = rest.slice(5).trim();
    if (data && data !== '[DONE]') {
      try { processor(JSON.parse(data)); } catch { processor(data); }
    }
  }
}

async function streamCustomProtocol({ messages, systemPrompt, signal, onDelta }) {
  const base = (settings.baseUrl || '').replace(/\/+$/, '');
  const customPath = (settings.customPath || '').replace(/^\/+/, '');
  let url = customPath ? `${base}/${customPath}` : base;
  if (!url) throw new Error('自定义协议未填写 Base URL 或请求路径');
  url = buildFinalUrl(url);

  const method = (settings.customMethod || 'POST').toUpperCase();
  const headers = { ...parseCustomHeaders() };
  if (method === 'POST' && !Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
    headers['Content-Type'] = 'application/json';
  }

  const vars = {
    system: systemPrompt,
    systemPrompt,
    messages,
    model: settings.model,
    temperature: settings.temperature,
    top_p: settings.topP,
    topP: settings.topP,
    max_tokens: settings.maxTokens,
    maxTokens: settings.maxTokens,
    frequency_penalty: settings.frequencyPenalty,
    presence_penalty: settings.presencePenalty,
  };
  const template = settings.customBodyTemplate || '{}';
  const rendered = renderCustomTemplate(template, vars);
  let requestBody = rendered;
  try {
    requestBody = JSON.parse(rendered);
  } catch {
    requestBody = rendered;
  }

  addLog('api', `自定义协议请求：${method} ${url}`);

  const response = await fetch(url, {
    method,
    headers,
    body: method === 'GET' ? undefined : (typeof requestBody === 'string' ? requestBody : JSON.stringify(requestBody)),
    signal,
  });
  if (!response.ok) throw await createApiError(response);

  if (!settings.customStream || !response.body) {
    const text = await response.text();
    let content = text;
    if (settings.customResponsePath) {
      try { content = extractJsonPath(JSON.parse(text), settings.customResponsePath) || text; } catch { content = text; }
    } else {
      try { content = firstTextFromJson(JSON.parse(text)) || text; } catch { content = text; }
    }
    if (content) onDelta(String(content));
    return;
  }

  await readSSECustom(response, (chunk) => {
    let content = '';
    if (settings.customResponsePath) {
      content = typeof chunk === 'string' ? chunk : (extractJsonPath(chunk, settings.customResponsePath) || '');
    } else {
      content = typeof chunk === 'string' ? chunk : (firstTextFromJson(chunk) || '');
    }
    if (content) onDelta(String(content));
  });
}

async function streamOpenAICompatible({ messages, systemPrompt, signal, onDelta, apiKey }) {
  const base = (settings.baseUrl || 'https://api.deepseek.com/v1').replace(/\/+$/, '');
  const url = buildFinalUrl(
    base.endsWith('/chat/completions') ? base :
    base.endsWith('/v1') ? `${base}/chat/completions` :
    `${base}/v1/chat/completions`
  );

  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream',
    ...parseCustomHeaders(),
  };
  if (apiKey && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${apiKey.key}`;
  }

  const requestMessages = systemPrompt
    ? [{ role: 'system', content: systemPrompt }, ...messages]
    : messages;
  const body = {
    model: settings.model || 'deepseek-chat',
    messages: requestMessages,
    stream: true,
    temperature: Number(settings.temperature),
    top_p: Number(settings.topP),
    max_tokens: Number(settings.maxTokens),
    frequency_penalty: Number(settings.frequencyPenalty),
    presence_penalty: Number(settings.presencePenalty),
  };

  addLog('api', `请求 OpenAI 协议接口：${url}，模型 ${settings.model}`);

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    throw await createApiError(response);
  }
  if (!response.body) {
    // 极少数环境没有 ReadableStream 时退化为整段响应
    const json = await response.json();
    const text = json.choices?.[0]?.message?.content || '';
    if (text) onDelta(text);
    return;
  }

  await readSSE(response, (json) => {
    const delta = json.choices?.[0]?.delta?.content || json.choices?.[0]?.message?.content || '';
    if (delta) onDelta(delta);
  });
}

async function streamAnthropic({ messages, systemPrompt, signal, onDelta, apiKey }) {
  const base = (settings.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
  const url = buildFinalUrl(
    base.endsWith('/messages') ? base :
    base.endsWith('/v1') ? `${base}/messages` :
    `${base}/v1/messages`
  );

  const headers = {
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream',
    'anthropic-version': '2023-06-01',
    ...parseCustomHeaders(),
  };
  if (apiKey && !headers['x-api-key']) {
    headers['x-api-key'] = apiKey.key;
  }

  const body = {
    model: settings.model || 'claude-3-opus',
    messages,
    stream: true,
    max_tokens: Number(settings.maxTokens),
    temperature: Number(settings.temperature),
    top_p: Number(settings.topP),
  };
  if (systemPrompt) body.system = systemPrompt;

  addLog('api', `请求 Anthropic 接口：${url}，模型 ${settings.model}`);

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) {
    throw await createApiError(response);
  }
  if (!response.body) {
    const json = await response.json();
    const text = json.content?.map((c) => c.text || '').join('') || '';
    if (text) onDelta(text);
    return;
  }

  await readSSE(response, (json) => {
    if (json.type === 'content_block_delta' && json.delta && json.delta.type === 'text_delta') {
      if (json.delta.text) onDelta(json.delta.text);
    }
  });
}

async function readSSE(response, processChunk) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx;
    while ((idx = buffer.search(/\r?\n/)) >= 0) {
      let line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('data:')) {
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') return;
        try {
          processChunk(JSON.parse(data));
        } catch {
          // 忽略无法解析的 SSE 行
        }
      }
    }
  }

  // 处理残余缓冲区
  const rest = buffer.trim();
  if (rest.startsWith('data:')) {
    const data = rest.slice(5).trim();
    if (data && data !== '[DONE]') {
      try {
        processChunk(JSON.parse(data));
      } catch {
        // ignore
      }
    }
  }
}

async function createApiError(response) {
  let detail = '';
  try {
    const text = await response.text();
    try {
      const json = JSON.parse(text);
      detail = json.error?.message || json.message || text;
    } catch {
      detail = text;
    }
  } catch {
    detail = '';
  }
  return new Error(friendlyApiError(response.status, detail));
}

function friendlyApiError(status, detail) {
  if (status === 401) return 'API Key 无效，请检查设置（401 鉴权失败）';
  if (status === 403) return '没有访问权限（403），请检查 API Key 权限';
  if (status === 404) return '接口地址或模型名不存在（404）';
  if (status === 429) return '请求过于频繁（429 速率限制），请稍后再试';
  if (status >= 500) return `服务端错误（${status}），请稍后再试`;
  if (detail) return `请求失败（${status}）：${detail}`;
  return `请求失败（${status}）`;
}

function friendlyError(err) {
  if (!err) return '未知错误';
  const name = err.name || '';
  const msg = err.message ? String(err.message) : String(err);
  if (name === 'AbortError') return '请求已取消';
  if (name === 'TypeError' || msg.includes('fetch')) return '网络请求失败，请检查网络或 CORS/代理设置';
  return msg || '未知错误';
}

/* ============================================================
 * 上下文压缩
 * ============================================================ */
async function compressConversation(convo) {
  if (convo.messages.length < 3) return;
  const complete = convo.messages.filter((m) => !m.error && m.content);
  if (complete.length < 3) return;

  const keepCount = Math.max(2, Math.ceil(complete.length / 2));
  const toSummarize = complete.slice(0, Math.max(1, complete.length - keepCount));
  const kept = complete.slice(Math.max(0, complete.length - keepCount));

  let summaryText = '';
  if (settings.compressionStrategy === 'summary' && getActiveKey()) {
    addLog('api', '开始压缩上下文：请求 AI 摘要');
    try {
      summaryText = await requestSummary(convo, toSummarize);
    } catch (err) {
      addLog('error', `压缩摘要失败：${friendlyError(err)}`);
    }
  }

  const summaryMsg = {
    id: uid('msg'),
    role: 'assistant',
    content: `[历史摘要]\n${summaryText || '（已压缩早期对话，以下保留最近消息）'}`,
    stats: null,
    createdAt: Date.now(),
  };

  convo.messages = [summaryMsg, ...kept];
  convo.updatedAt = Date.now();
  saveState();
  renderMessages();
  addLog('info', `当前对话已压缩：保留最近 ${kept.length} 条消息`);
}

async function requestSummary(convo, messages) {
  const text = messages.map((m) => `${m.role === 'user' ? '用户' : 'DeepSeek'}：${m.content}`).join('\n');
  const summaryPrompt = `请把下面这段对话压缩为不超过 300 字的中文摘要，保留关键信息和情绪转折，直接输出摘要正文：\n\n${text}`;

  let result = '';
  await streamApi({
    messages: [{ role: 'user', content: summaryPrompt }],
    systemPrompt: '你是一个对话压缩助手，只输出摘要正文。',
    signal: undefined,
    onDelta: (chunk) => { result += chunk; },
  });
  return parseEmotionTags(result).clean;
}

/* ============================================================
 * Token 估算与格式化
 * ============================================================ */
function estimateTokens(text) {
  if (!text) return 0;
  const str = String(text);
  const cjk = (str.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
  const other = str.length - cjk;
  return Math.ceil(cjk * 1.5 + other * 0.3);
}

function formatNumber(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(Math.round(n));
}

/* ============================================================
 * 主题 / 字体
 * ============================================================ */
function applyTheme() {
  let theme = settings.theme || 'light';
  if (theme === 'system') {
    theme = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.documentElement.dataset.theme = theme;
  document.body.dataset.theme = theme;
  themeBtn.innerHTML = theme === 'dark' ? ICONS.sun : ICONS.moon;
}

function applyFontScale() {
  document.documentElement.dataset.font = settings.fontSize || 'medium';
}

/* ============================================================
 * 设置表单
 * ============================================================ */
function refreshSettingsForm() {
  const convo = getActiveConversation();
  $('#settingTheme').value = settings.theme || 'system';
  $('#settingFontSize').value = settings.fontSize || 'medium';
  $('#settingSystemPrompt').value = convo.systemPrompt !== undefined && convo.systemPrompt !== null
    ? convo.systemPrompt
    : (settings.systemPrompt || DEFAULT_SYSTEM_PROMPT);

  $('#settingProvider').value = settings.provider || 'openai';
  $('#settingBaseUrl').value = settings.baseUrl || '';
  $('#settingModel').value = settings.model || '';
  $('#settingCustomPath').value = settings.customPath || '';
  $('#settingCustomMethod').value = settings.customMethod || 'POST';
  $('#settingCustomBody').value = settings.customBodyTemplate || '';
  $('#settingCustomResponsePath').value = settings.customResponsePath || '';
  $('#settingCustomStream').checked = !!settings.customStream;
  $('#settingCustomModelsUrl').value = settings.customModelsUrl || '';
  $('#settingCustomModelsPath').value = settings.customModelsPath || '';
  $('#settingCustomHeaders').value = settings.customHeaders || '{}';
  $('#settingProxyEnabled').checked = !!settings.proxyEnabled;
  $('#settingProxyPrefix').value = settings.proxyPrefix || '';
  $('#customProtocolFields').classList.toggle('hidden', settings.provider !== 'custom');
  $('#settingTemperature').value = settings.temperature;
  $('#temperatureValue').textContent = Number(settings.temperature).toFixed(1);
  $('#settingTopP').value = settings.topP;
  $('#topPValue').textContent = Number(settings.topP).toFixed(2);
  $('#settingMaxTokens').value = settings.maxTokens;
  $('#settingMaxContext').value = settings.maxContext;
  $('#settingFrequencyPenalty').value = settings.frequencyPenalty;
  $('#settingPresencePenalty').value = settings.presencePenalty;
  $('#settingCompressThreshold').value = settings.compressionThreshold;
  $('#settingCompressStrategy').value = settings.compressionStrategy || 'summary';
  $('#settingAutoCompress').checked = !!settings.autoCompress;
  $('#settingSoundEnabled').checked = !!settings.soundEnabled;
  $('#settingEffectsEnabled').checked = !!settings.effectsEnabled;
  $('#settingVolume').value = settings.volume;

  const keySelect = $('#settingActiveKey');
  keySelect.innerHTML = '';
  if (settings.apiKeys.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '（暂无已保存 Key）';
    keySelect.appendChild(opt);
  } else {
    for (const k of settings.apiKeys) {
      const opt = document.createElement('option');
      opt.value = k.id;
      opt.textContent = `${k.name || '未命名'} • ${maskKey(k.key)}`;
      keySelect.appendChild(opt);
    }
  }
  const activeKey = getActiveKey();
  keySelect.value = settings.activeKeyId || '';
  $('#settingKeyName').value = activeKey ? activeKey.name : '';
  $('#settingApiKey').value = activeKey ? activeKey.key : '';

  // 当前 Key 的模型列表（自动获取后可下拉选择）
  const modelList = $('#modelOptions');
  modelList.innerHTML = '';
  const models = activeKey && Array.isArray(activeKey.models) ? activeKey.models : [];
  for (const m of models) {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    modelList.appendChild(opt);
  }
  if (activeKey && activeKey.selectedModel && !$('#settingModel').value) {
    $('#settingModel').value = activeKey.selectedModel;
  }
  if (!settings.model && models.length) {
    $('#settingModel').value = activeKey.selectedModel || models[0];
  }
  refreshChatModelSelect();
}

function maskKey(key) {
  if (!key) return '';
  if (key.length <= 8) return '••••';
  return key.slice(0, 5) + '••••' + key.slice(-4);
}

function refreshChatModelSelect() {
  if (!chatModelSelect) return;
  const activeKey = getActiveKey();
  const models = activeKey && Array.isArray(activeKey.models) ? activeKey.models : [];
  const current = settings.model || '';
  const all = [];
  if (current && !models.includes(current)) all.push(current);
  for (const m of models) {
    if (!all.includes(m)) all.push(m);
  }
  chatModelSelect.innerHTML = '';
  if (!all.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '未选择模型';
    chatModelSelect.appendChild(opt);
    return;
  }
  for (const m of all) {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    if (m === current) opt.selected = true;
    chatModelSelect.appendChild(opt);
  }
}

function saveSystemPromptFromTextarea() {
  const convo = getActiveConversation();
  convo.systemPrompt = $('#settingSystemPrompt').value;
  settings.systemPrompt = convo.systemPrompt;
  saveState();
}

function collectSettingsFromForm() {
  settings.theme = $('#settingTheme').value;
  settings.fontSize = $('#settingFontSize').value;
  settings.provider = $('#settingProvider').value;
  settings.baseUrl = $('#settingBaseUrl').value.trim();
  settings.model = $('#settingModel').value.trim();
  settings.customPath = $('#settingCustomPath').value.trim();
  settings.customMethod = $('#settingCustomMethod').value || 'POST';
  settings.customBodyTemplate = $('#settingCustomBody').value;
  settings.customResponsePath = $('#settingCustomResponsePath').value.trim();
  settings.customStream = $('#settingCustomStream').checked;
  settings.customModelsUrl = $('#settingCustomModelsUrl').value.trim();
  settings.customModelsPath = $('#settingCustomModelsPath').value.trim();
  settings.customHeaders = $('#settingCustomHeaders').value.trim() || '{}';
  settings.proxyEnabled = $('#settingProxyEnabled').checked;
  settings.proxyPrefix = $('#settingProxyPrefix').value.trim();
  if ($('#customProtocolFields')) {
    $('#customProtocolFields').classList.toggle('hidden', settings.provider !== 'custom');
  }
  const activeKey = getActiveKey();
  if (activeKey && settings.model) activeKey.selectedModel = settings.model;
  settings.temperature = Number($('#settingTemperature').value);
  settings.topP = Number($('#settingTopP').value);
  settings.maxTokens = Number($('#settingMaxTokens').value) || 2048;
  settings.maxContext = Number($('#settingMaxContext').value) || 8192;
  settings.frequencyPenalty = Number($('#settingFrequencyPenalty').value) || 0;
  settings.presencePenalty = Number($('#settingPresencePenalty').value) || 0;
  settings.compressionThreshold = Number($('#settingCompressThreshold').value) || 20;
  settings.compressionStrategy = $('#settingCompressStrategy').value;
  settings.autoCompress = $('#settingAutoCompress').checked;
  settings.soundEnabled = $('#settingSoundEnabled').checked;
  settings.effectsEnabled = $('#settingEffectsEnabled').checked;
  settings.volume = Number($('#settingVolume').value);
  saveState();
  applyTheme();
  applyFontScale();
  refreshChatModelSelect();
}

/* ---------------- 模型列表：连接成功后自动获取 ---------------- */
async function fetchModels({ silent = false } = {}) {
  const statusEl = $('#modelFetchStatus');
  const activeKey = getActiveKey();
  if (!activeKey) {
    if (!silent) statusEl.textContent = '请先保存 API Key';
    return;
  }
  const provider = settings.provider;
  let models = [];
  try {
    if (provider === 'custom') {
      if (!settings.customModelsUrl) throw new Error('自定义协议未配置模型列表地址');
      const url = buildFinalUrl(settings.customModelsUrl.trim());
      const res = await fetch(url, { headers: { ...parseCustomHeaders() } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const path = settings.customModelsPath || 'data';
      const data = extractJsonPath(json, path) || [];
      models = (Array.isArray(data) ? data : [])
        .map((x) => typeof x === 'string' ? x : (x.id || x.name || ''))
        .filter(Boolean);
    } else if (provider === 'anthropic') {
      const base = (settings.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
      const url = buildFinalUrl(
        base.endsWith('/models') ? base :
        base.endsWith('/v1') ? `${base}/models` :
        `${base}/v1/models`
      );
      const res = await fetch(url, {
        headers: { 'x-api-key': activeKey.key, 'anthropic-version': '2023-06-01', ...parseCustomHeaders() },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      models = (json.data || []).map((x) => x.id).filter(Boolean);
    } else {
      const base = (settings.baseUrl || '').replace(/\/+$/, '');
      const url = buildFinalUrl(
        base.endsWith('/models') ? base : `${base}/models`
      );
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${activeKey.key}`, ...parseCustomHeaders() },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      models = (json.data || []).map((x) => x.id).filter(Boolean);
    }

    activeKey.models = models;
    activeKey.modelsFetched = true;
    if (models.length && (!activeKey.selectedModel || !models.includes(activeKey.selectedModel))) {
      activeKey.selectedModel = models[0];
    }
    if (models.length && !settings.model) {
      settings.model = activeKey.selectedModel;
    }
    saveState();
    refreshSettingsForm();
    if (!silent) statusEl.textContent = `已获取 ${models.length} 个模型`;
    addLog('api', `获取模型成功：${models.length} 个`);
  } catch (e) {
    activeKey.modelsFetched = true;
    if (!silent) statusEl.textContent = '获取失败：' + friendlyError(e);
    addLog('error', '获取模型失败：' + friendlyError(e));
  }
}

function maybeAutoFetchModels() {
  const key = getActiveKey();
  if (!key) return;
  if (key.modelsFetched) return;
  if (Array.isArray(key.models) && key.models.length) return;
  if (settings.provider === 'custom' && !settings.customModelsUrl) return;
  if (settings.provider !== 'custom' && !settings.baseUrl) return;
  fetchModels({ silent: true });
}

function saveApiKeyFromForm() {
  const name = $('#settingKeyName').value.trim();
  const key = $('#settingApiKey').value.trim();
  if (!key) {
    alert('请填写 API Key');
    return;
  }
  const currentId = settings.activeKeyId;
  let target = settings.apiKeys.find((k) => k.id === currentId);
  if (target) {
    target.name = name || target.name;
    target.key = key;
  } else {
    target = { id: uid('key'), name: name || '未命名', key };
    settings.apiKeys.push(target);
  }
  // Key 变更后重置已获取的模型，重新连接时再拉取
  target.models = [];
  target.selectedModel = null;
  target.modelsFetched = false;
  settings.activeKeyId = target.id;
  saveState();
  refreshSettingsForm();
  addLog('api', `已保存 API Key：${target.name || '未命名'}`);
  if (settings.baseUrl || (settings.provider === 'custom' && settings.customModelsUrl)) {
    maybeAutoFetchModels();
  }
}

function deleteApiKeyFromForm() {
  const id = settings.activeKeyId;
  if (!id) return;
  settings.apiKeys = settings.apiKeys.filter((k) => k.id !== id);
  settings.activeKeyId = settings.apiKeys[0] ? settings.apiKeys[0].id : null;
  saveState();
  refreshSettingsForm();
  addLog('api', '已删除一组 API Key');
}

/* ============================================================
 * 日志
 * ============================================================ */
function addLog(type, message) {
  logs.push({
    time: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    type,
    message,
  });
  if (logs.length > 200) logs = logs.slice(-200);
  saveJSON('dsc_logs', logs);
  renderLog();
}

function renderLog() {
  logList.innerHTML = '';
  for (const item of logs.slice().reverse()) {
    const div = document.createElement('div');
    div.className = 'log-item';
    const timeSpan = document.createElement('span');
    timeSpan.className = 'log-time';
    timeSpan.textContent = item.time;
    const typeSpan = document.createElement('span');
    typeSpan.className = `log-type ${item.type}`;
    typeSpan.textContent = item.type === 'error' ? '错误' : item.type === 'api' ? 'API' : item.type === 'emotion' ? '情绪' : '信息';
    const msgSpan = document.createElement('span');
    msgSpan.textContent = item.message;
    div.appendChild(timeSpan);
    div.appendChild(typeSpan);
    div.appendChild(msgSpan);
    logList.appendChild(div);
  }
}

/* ============================================================
 * 图片附件
 * ============================================================ */
function handleFiles(files) {
  const imageFiles = Array.from(files).filter((f) => f.type.startsWith('image/'));
  const nonImageCount = files.length - imageFiles.length;
  if (nonImageCount > 0) {
    alert('目前仅支持图片作为多模态附件发送，已忽略非图片文件。');
  }
  for (const file of imageFiles.slice(0, 4)) {
    const reader = new FileReader();
    reader.onload = () => {
      pendingImages.push({
        id: uid('img'),
        name: file.name,
        mime: file.type,
        dataUrl: reader.result,
      });
      renderImagePreviews();
    };
    reader.readAsDataURL(file);
  }
}

function renderImagePreviews() {
  imagePreviews.innerHTML = '';
  if (!pendingImages.length) {
    imagePreviews.classList.add('hidden');
    return;
  }
  imagePreviews.classList.remove('hidden');
  for (const img of pendingImages) {
    const preview = document.createElement('div');
    preview.className = 'preview';
    const im = document.createElement('img');
    im.src = img.dataUrl;
    const remove = document.createElement('button');
    remove.className = 'remove-preview';
    remove.textContent = '✕';
    remove.addEventListener('click', () => {
      pendingImages = pendingImages.filter((x) => x.id !== img.id);
      renderImagePreviews();
    });
    preview.appendChild(im);
    preview.appendChild(remove);
    imagePreviews.appendChild(preview);
  }
}

function autoResizeInput() {
  inputEl.style.height = 'auto';
  inputEl.style.height = Math.min(120, inputEl.scrollHeight) + 'px';
}

/* ============================================================
 * 事件绑定
 * ============================================================ */
function bindEvents() {
  // 顶栏
  $('#menuBtn').addEventListener('click', () => {
    conversationDrawer.classList.add('open');
    drawerMask.classList.remove('hidden');
  });
  $('#settingsBtn').addEventListener('click', () => {
    refreshSettingsForm();
    openSettings();
  });
  themeBtn.addEventListener('click', () => {
    settings.theme = (document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
    saveState();
    applyTheme();
    refreshSettingsForm();
  });

  // 抽屉关闭
  drawerMask.addEventListener('click', closeDrawers);
  $('#closeSettingsBtn').addEventListener('click', closeDrawers);

  // 新建对话
  $('#newChatBtn').addEventListener('click', createConversation);

  // 重命名
  $('#renameBtn').addEventListener('click', () => renameConversation(activeConversationId));

  // 输入
  sendBtn.addEventListener('click', handleSend);
  inputEl.addEventListener('input', autoResizeInput);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  });

  // 附件
  attachBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    handleFiles(fileInput.files);
    fileInput.value = '';
  });

  // 日志（入口在设置中，避免和发送按钮重合）
  openLogBtn.addEventListener('click', () => {
    logPanel.classList.toggle('hidden');
    if (!logPanel.classList.contains('hidden')) renderLog();
    closeDrawers();
  });
  $('#closeLogBtn').addEventListener('click', () => logPanel.classList.add('hidden'));
  $('#clearLogBtn').addEventListener('click', () => {
    logs = [];
    saveJSON('dsc_logs', logs);
    renderLog();
  });

  // 聊天头部模型选择器
  chatModelSelect.addEventListener('change', () => {
    settings.model = chatModelSelect.value;
    const activeKey = getActiveKey();
    if (activeKey && settings.model) activeKey.selectedModel = settings.model;
    $('#settingModel').value = settings.model;
    saveState();
    addLog('api', `切换模型：${settings.model || '未选择'}`);
  });

  // 点击立绘：抖动反馈 + 音效
  characterLayer.addEventListener('click', triggerCharacterTap);

  // 设置：实时保存
  const liveSettingIds = [
    '#settingTheme', '#settingFontSize', '#settingProvider', '#settingBaseUrl', '#settingModel',
    '#settingCustomHeaders', '#settingProxyEnabled', '#settingProxyPrefix', '#settingTemperature',
    '#settingTopP', '#settingMaxTokens', '#settingMaxContext', '#settingFrequencyPenalty', '#settingPresencePenalty',
    '#settingCustomPath', '#settingCustomMethod', '#settingCustomBody', '#settingCustomResponsePath',
    '#settingCustomStream', '#settingCustomModelsUrl', '#settingCustomModelsPath',
    '#settingCompressThreshold', '#settingCompressStrategy', '#settingAutoCompress',
    '#settingSoundEnabled', '#settingEffectsEnabled', '#settingVolume',
  ];
  liveSettingIds.forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener('input', () => {
      if (id === '#settingTemperature') {
        $('#temperatureValue').textContent = Number(el.value).toFixed(1);
      }
      if (id === '#settingTopP') {
        $('#topPValue').textContent = Number(el.value).toFixed(2);
      }
      collectSettingsFromForm();
    });
    el.addEventListener('change', () => {
      collectSettingsFromForm();
    });
  });

  // 切换提供商时，若 Base URL 还停留在上一家的默认值，则自动换成新默认值
  $('#settingProvider').addEventListener('change', () => {
    const provider = $('#settingProvider').value;
    const base = $('#settingBaseUrl').value.trim();
    const isOpenAIDefault = base === '' || base === 'https://api.deepseek.com/v1';
    const isAnthropicDefault = base === '' || base === 'https://api.anthropic.com' || base === 'https://api.anthropic.com/v1';
    if (provider === 'anthropic' && isOpenAIDefault) {
      $('#settingBaseUrl').value = 'https://api.anthropic.com';
      settings.baseUrl = 'https://api.anthropic.com';
    } else if (provider === 'openai' && isAnthropicDefault) {
      $('#settingBaseUrl').value = 'https://api.deepseek.com/v1';
      settings.baseUrl = 'https://api.deepseek.com/v1';
    }
    // custom 协议不自动填充任何预设地址，由用户自行填写
    saveState();
    refreshSettingsForm();
  });

  // Key 管理
  $('#saveKeyBtn').addEventListener('click', saveApiKeyFromForm);
  $('#deleteKeyBtn').addEventListener('click', deleteApiKeyFromForm);
  $('#fetchModelsBtn').addEventListener('click', () => fetchModels());
  $('#settingActiveKey').addEventListener('change', () => {
    settings.activeKeyId = $('#settingActiveKey').value || null;
    const key = getActiveKey();
    if (key && key.selectedModel) {
      settings.model = key.selectedModel;
    } else if (key && Array.isArray(key.models) && key.models.length) {
      settings.model = key.models[0];
    }
    saveState();
    refreshSettingsForm();
    maybeAutoFetchModels();
  });

  $('#saveSystemPromptBtn').addEventListener('click', () => {
    saveSystemPromptFromTextarea();
    addLog('info', '已保存 System Prompt 到当前对话');
    alert('提示词已保存到当前对话');
  });
  // 提示词直接输入时自动保存，切换对话/重新打开设置不会丢失
  $('#settingSystemPrompt').addEventListener('input', saveSystemPromptFromTextarea);

  // 压缩当前对话
  $('#compressNowBtn').addEventListener('click', async () => {
    if (isStreaming) {
      alert('正在生成回复，请稍候再压缩。');
      return;
    }
    const convo = getActiveConversation();
    addLog('info', '手动触发上下文压缩');
    await compressConversation(convo);
  });

  // 关于
  $('#resetSettingsBtn').addEventListener('click', () => {
    if (!confirm('确定恢复默认设置吗？当前 API Key 和对话也会被清空。')) return;
    settings = Object.assign({}, DEFAULT_SETTINGS);
    conversations = [];
    activeConversationId = null;
    saveState();
    ensureConversation();
    renderConversationList();
    renderMessages();
    refreshSettingsForm();
    applyTheme();
    applyFontScale();
    addLog('info', '设置已恢复默认');
  });

  // 首次引导
  $('#setupGoBtn').addEventListener('click', () => {
    $('#setupModal').classList.add('hidden');
    openSettings();
  });
  $('#setupLaterBtn').addEventListener('click', () => {
    $('#setupModal').classList.add('hidden');
    setupDismissed = true;
    saveJSON('dsc_setup_dismissed', true);
  });

  // 系统主题变化
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (settings.theme === 'system') applyTheme();
  });
}

function openSettings() {
  refreshSettingsForm();
  settingsDrawer.classList.add('open');
  drawerMask.classList.remove('hidden');
}

function closeDrawers() {
  conversationDrawer.classList.remove('open');
  settingsDrawer.classList.remove('open');
  drawerMask.classList.add('hidden');
}

/* ---------------- 启动 ---------------- */
document.addEventListener('DOMContentLoaded', init);
