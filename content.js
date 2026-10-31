(function () {
  // 防止重复注入
  if (document.getElementById('mindful-gate-host')) return;

  // 跨浏览器 API 统一桥接（同时兼容 Chrome / Edge / Firefox / Safari）
  const extApi = typeof browser !== 'undefined' ? browser : (typeof chrome !== 'undefined' ? chrome : null);

  // 检查当前插件上下文是否有效
  function isContextValid() {
    return !!extApi && !!extApi.runtime && !!extApi.runtime.id;
  }

  // 安全读取 Storage
  function safeStorageGet(keys, callback) {
    if (!isContextValid()) return;
    try {
      extApi.storage.local.get(keys, callback);
    } catch (e) {}
  }

  // 安全写入 Storage
  function safeStorageSet(items, callback) {
    if (!isContextValid()) {
      if (callback) callback();
      return;
    }
    try {
      extApi.storage.local.set(items, callback);
    } catch (e) {
      if (callback) callback();
    }
  }

  // 安全移除 Storage
  function safeStorageRemove(key, callback) {
    if (!isContextValid()) {
      if (callback) callback();
      return;
    }
    try {
      extApi.storage.local.remove(key, callback);
    } catch (e) {
      if (callback) callback();
    }
  }

  // 获取当前网站的主域名（确保同平台跨标签页共享倒计时）
  const rootDomain = location.hostname.split('.').slice(-2).join('.');
  const STORAGE_KEY = 'mindful_gate_v2_' + rootDomain;
  const PLEDGE_TEXT = '我确认目前仍在处理写下的目的，并非无意识刷算法流';

  let timerInterval = null;
  let breathTimeoutList = [];
  let selectedSeconds = 15;  // 首次进入默认选中 15 秒
  let extendSeconds = 0;     // 超时后选择加时的秒数（0 代表选了“否”）
  let hasTriggeredOvertimeUI = false;
  let isFadingPhase = false; // 是否处于最后阶段的褪色与滚轮阻尼阶段
  let currentIntent = '';

  // 9 大平台搜索结果页 URL 映射表
  function getSearchUrl(keyword) {
    const encoded = encodeURIComponent(keyword);
    const host = location.hostname;
    if (host.includes('xiaohongshu.com')) {
      return `https://www.xiaohongshu.com/search_result?keyword=${encoded}`;
    } else if (host.includes('douyin.com')) {
      return `https://www.douyin.com/search/${encoded}`;
    } else if (host.includes('bilibili.com')) {
      return `https://search.bilibili.com/all?keyword=${encoded}`;
    } else if (host.includes('kuaishou.com')) {
      return `https://www.kuaishou.com/search/video?searchKey=${encoded}`;
    } else if (host.includes('tiktok.com')) {
      return `https://www.tiktok.com/search?q=${encoded}`;
    } else if (host.includes('instagram.com')) {
      return `https://www.instagram.com/explore/search/keyword/?q=${encoded}`;
    } else if (host.includes('x.com') || host.includes('twitter.com')) {
      return `https://x.com/search?q=${encoded}`;
    } else if (host.includes('youtube.com')) {
      return `https://www.youtube.com/results?search_query=${encoded}`;
    } else if (host.includes('threads.net') || host.includes('threads.com')) {
      return `https://www.threads.net/search?q=${encoded}`;
    }
    return null;
  }

  // 1. 创建隔离的 Shadow DOM 容器
  const host = document.createElement('div');
  host.id = 'mindful-gate-host';
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });

  // 2. 注入样式与界面 HTML
  shadow.innerHTML = `
    <style>
      * {
        box-sizing: border-box;
        font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
      }
      
      /* 全屏温暖亚麻毛玻璃遮罩 */
      .overlay {
        position: fixed; inset: 0; z-index: 2147483647;
        background: rgba(238, 234, 226, 0.86);
        backdrop-filter: blur(28px); -webkit-backdrop-filter: blur(28px);
        display: flex; align-items: center; justify-content: center;
        transition: opacity 0.45s cubic-bezier(0.22, 1, 0.36, 1);
      }
      .overlay.hidden { opacity: 0; pointer-events: none; }

      /* 羊皮纸白居中卡片 */
      .card {
        background: #FAF8F5;
        border: 1px solid rgba(74, 107, 93, 0.14);
        border-radius: 28px;
        padding: 44px 40px 36px;
        width: 480px; max-width: 90vw;
        color: #2C302E;
        box-shadow: 0 24px 48px -12px rgba(44, 48, 46, 0.08), 0 4px 16px -2px rgba(44, 48, 46, 0.04);
        text-align: center;
        transition: all 0.3s ease;
      }
      .view-section.hidden { display: none; }

      /* 顶部正念呼吸小圆点装饰 */
      .breath-dot {
        width: 8px; height: 8px; border-radius: 50%;
        background: #4A6B5D; margin: 0 auto 20px;
        opacity: 0.6; animation: gentleBreath 4s ease-in-out infinite;
      }

      /* 人文衬线体标题 */
      .title {
        font-family: "Songti SC", "Noto Serif SC", "Source Han Serif SC", "STSong", Georgia, serif;
        font-size: 22px; font-weight: 600; color: #2C302E;
        margin: 0 0 10px 0; letter-spacing: 0.03em;
      }
      .subtitle {
        font-size: 13.5px; color: #787F7B;
        margin: 0 0 28px 0; letter-spacing: 0.02em; font-weight: 400;
      }

      /* 输入框 */
      .input-wrapper { margin-bottom: 22px; }
      .input {
        width: 100%; padding: 15px 18px; border-radius: 14px;
        border: 1.5px solid #E2DDD5; background: #F3EFEA;
        color: #2C302E; font-size: 14.5px; outline: none;
        transition: all 0.25s ease; text-align: left;
      }
      .input::placeholder { color: #9FA6A2; }
      .input:focus {
        background: #FFFFFF; border-color: #4A6B5D;
        box-shadow: 0 0 0 4px rgba(74, 107, 93, 0.1);
      }
      .input.error {
        border-color: #C85A53; background: #FDF6F6;
        animation: shake 0.35s;
      }

      /* 鹅卵石时间胶囊组 */
      .pills {
        display: flex; gap: 8px; justify-content: center;
        margin-bottom: 24px; flex-wrap: wrap;
      }
      .pill {
        padding: 9px 16px; border-radius: 999px;
        font-size: 13.5px; font-weight: 500;
        background: #EFECE6; color: #68706C;
        border: 1px solid transparent; cursor: pointer;
        transition: all 0.2s ease;
      }
      .pill:hover { background: #E5E0D8; color: #2C302E; }
      .pill.active {
        background: #4A6B5D; color: #FAF8F5;
        font-weight: 500; box-shadow: 0 4px 12px rgba(74, 107, 93, 0.2);
      }

      /* 按钮区 */
      .action-buttons { display: flex; flex-direction: column; align-items: center; gap: 14px; }
      .btn-primary {
        width: 100%; padding: 15px; border-radius: 14px; border: none;
        background: #4A6B5D; color: #FAF8F5;
        font-size: 15px; font-weight: 500; letter-spacing: 0.03em;
        cursor: pointer; transition: all 0.2s ease;
        box-shadow: 0 6px 16px -4px rgba(74, 107, 93, 0.3);
      }
      .btn-primary:hover:not(:disabled) { background: #3E5B4E; transform: translateY(-1px); }
      .btn-primary:disabled {
        background: #D5D0C8; color: #8C928E; cursor: not-allowed; box-shadow: none;
      }

      .btn-just-enter {
        background: none; border: none; padding: 4px 12px;
        color: #A0A6A2; font-size: 12.5px; font-weight: 400;
        cursor: pointer; transition: color 0.2s;
        text-decoration: underline; text-underline-offset: 4px;
        text-decoration-color: rgba(160, 166, 162, 0.4);
      }
      .btn-just-enter:hover { color: #5C6360; text-decoration-color: #5C6360; }

      /* ========== 第二层视图 A：超时后的深呼吸引导区 ========== */
      .breathing-stage {
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        padding: 20px 0;
      }
      .circle-container {
        width: 180px; height: 180px;
        display: flex; align-items: center; justify-content: center;
        margin: 16px 0 28px; position: relative;
      }
      .breath-orb {
        width: 80px; height: 80px; border-radius: 50%;
        background: radial-gradient(circle at 35% 35%, #689482, #4A6B5D);
        box-shadow: 0 0 35px rgba(74, 107, 93, 0.35);
        transform: scale(1);
      }
      /* 鼻吸气 4 秒：缩小 */
      .breath-orb.inhale {
        transition: transform 4s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 4s ease;
        transform: scale(0.48);
        box-shadow: 0 0 15px rgba(74, 107, 93, 0.2);
      }
      /* 口呼气 8 秒：胀大 */
      .breath-orb.exhale {
        transition: transform 8s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 8s ease;
        transform: scale(1.85);
        box-shadow: 0 0 60px rgba(74, 107, 93, 0.5);
      }
      .breath-instruction {
        font-family: "Songti SC", "Noto Serif SC", Georgia, serif;
        font-size: 21px; font-weight: 600; color: #2C302E;
        margin-bottom: 8px; min-height: 30px; letter-spacing: 0.04em;
      }
      .breath-sub {
        font-size: 13.5px; color: #787F7B; min-height: 20px;
      }

      /* ========== 第二层视图 B：深呼吸结束后的抉择与打字契约框 ========== */
      .pledge-box {
        margin-top: 8px; margin-bottom: 22px; padding: 18px;
        background: #F3EFEA; border-radius: 16px;
        border: 1px solid #E2DDD5; text-align: left;
        animation: fadeIn 0.3s ease;
      }
      .pledge-box.hidden { display: none; }
      .pledge-guide {
        font-size: 12.5px; color: #68706C; margin: 0 0 8px 0; line-height: 1.5;
      }
      .pledge-target {
        font-size: 13.5px; font-weight: 600; color: #2C302E;
        background: #EAE5DC; padding: 10px 12px; border-radius: 8px;
        margin-bottom: 12px; user-select: none; letter-spacing: 0.02em;
      }
      .pledge-input {
        width: 100%; padding: 12px 14px; border-radius: 10px;
        border: 1.5px solid #D5CFC7; background: #FAF8F5;
        color: #2C302E; font-size: 13.5px; outline: none;
        transition: border-color 0.2s;
      }
      .pledge-input:focus { border-color: #4A6B5D; background: #FFF; }
      .pledge-input.matched { border-color: #4A6B5D; background: #F2F7F4; color: #2E5243; }

      /* 右上角悬浮书签胶囊 */
      .capsule {
        position: fixed; top: 20px; right: 20px; z-index: 2147483647;
        background: rgba(250, 248, 245, 0.94);
        backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px);
        border: 1px solid rgba(74, 107, 93, 0.22);
        border-radius: 999px; padding: 9px 16px;
        color: #2C302E; font-size: 13px;
        display: flex; align-items: center; gap: 12px;
        box-shadow: 0 10px 28px -6px rgba(44, 48, 46, 0.14);
        transition: all 0.3s ease;
      }
      .capsule.hidden { opacity: 0; pointer-events: none; transform: translateY(-16px); }
      .capsule.warning { border-color: #D99B52; background: rgba(253, 249, 243, 0.95); }
      .intent-dot { width: 7px; height: 7px; border-radius: 50%; background: #4A6B5D; display: inline-block; }
      .intent-label {
        max-width: 160px; white-space: nowrap; overflow: hidden;
        text-overflow: ellipsis; color: #4A504D; font-weight: 500;
      }
      .timer-label {
        font-variant-numeric: tabular-nums; font-weight: 600; font-size: 13.5px; color: #4A6B5D;
      }
      .capsule.warning .timer-label { color: #C47D2B; }
      .btn-small {
        background: #EAE5DC; border: none; color: #3D4240;
        padding: 5px 12px; border-radius: 999px; font-size: 12px;
        font-weight: 500; cursor: pointer; transition: all 0.2s; white-space: nowrap;
      }
      .btn-small:hover { background: #DDD6CA; }

      @keyframes gentleBreath {
        0%, 100% { transform: scale(1); opacity: 0.4; }
        50% { transform: scale(1.4); opacity: 0.85; }
      }
      @keyframes fadeIn {
        from { opacity: 0; transform: translateY(-6px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes shake {
        0%, 100% { transform: translateX(0); }
        25% { transform: translateX(-5px); }
        75% { transform: translateX(5px); }
      }
    </style>

    <!-- 全屏毛玻璃遮罩 -->
    <div class="overlay hidden" id="gate-overlay">
      <div class="card">
        
        <!-- 【第一层页面】：首次进入 · 意图设定 -->
        <div class="view-section" id="view-initial">
          <div class="breath-dot"></div>
          <h2 class="title">在进入信息流之前，先停一下</h2>
          <p class="subtitle">你点击的目的是什么？</p>
          
          <div class="input-wrapper">
            <input type="text" class="input" id="intent-input" placeholder="我想主动寻找...（回车直达搜索结果）" autocomplete="off" />
          </div>

          <div class="pills" id="initial-pills">
            <button class="pill active" data-sec="15">就看15秒</button>
            <button class="pill" data-sec="180">3 分钟</button>
            <button class="pill" data-sec="300">5 分钟</button>
            <button class="pill" data-sec="600">10 分钟</button>
          </div>

          <div class="action-buttons">
            <button class="btn-primary" id="btn-search">🔍 带着清醒去寻找</button>
            <button class="btn-just-enter" id="btn-start">只是随便看看（停留在当前页）</button>
          </div>
        </div>

        <!-- 【第二层页面 A】：使用超时后弹出 · 两组深呼吸引导 -->
        <div class="view-section hidden" id="view-breathing">
          <div class="breathing-stage">
            <div class="breath-instruction" id="breath-title">时间到了，跟随圆点深呼吸</div>
            <div class="breath-sub" id="breath-subtitle">让大脑从信息流中抽离片刻</div>
            <div class="circle-container">
              <div class="breath-orb" id="breath-orb"></div>
            </div>
            <div class="breath-sub" id="breath-progress">第 1 / 2 组</div>
          </div>
        </div>

        <!-- 【第二层页面 B】：深呼吸结束后 · 抉择与打字契约 -->
        <div class="view-section hidden" id="view-decision">
          <div class="breath-dot"></div>
          <h2 class="title" style="margin-bottom: 22px;">还要继续进入信息流吗？</h2>

          <div class="pills" id="decision-pills">
            <button class="pill active" data-extend="0">否</button>
            <button class="pill" data-extend="180">3 分钟</button>
            <button class="pill" data-extend="300">5 分钟</button>
            <button class="pill" data-extend="600">10 分钟</button>
          </div>

          <!-- 只有选了 3/5/10 分钟才会弹出的打字契约框 -->
          <div class="pledge-box hidden" id="pledge-box">
            <p class="pledge-guide">请在下方手动输入（已禁用粘贴）：</p>
            <div class="pledge-target">“我确认目前仍在处理写下的目的，并非无意识刷算法流”</div>
            <input type="text" class="pledge-input" id="pledge-input" placeholder="在此输入引号内的完整句子" autocomplete="off" />
          </div>

          <button class="btn-primary" id="btn-decision-confirm">确认离开网页</button>
        </div>

      </div>
    </div>

    <!-- 右上角温润书签胶囊 -->
    <div class="capsule hidden" id="status-capsule">
      <span class="intent-dot"></span>
      <span class="intent-label" id="capsule-intent"></span>
      <span class="timer-label" id="capsule-timer">00:15</span>
      <button class="btn-small" id="btn-finish">已完成，离开</button>
    </div>
  `;

  // 获取 DOM 元素
  const overlay = shadow.getElementById('gate-overlay');
  const viewInitial = shadow.getElementById('view-initial');
  const viewBreathing = shadow.getElementById('view-breathing');
  const viewDecision = shadow.getElementById('view-decision');

  const intentInput = shadow.getElementById('intent-input');
  const initialPills = shadow.querySelectorAll('#initial-pills .pill');
  const btnSearch = shadow.getElementById('btn-search');
  const btnStart = shadow.getElementById('btn-start');

  const breathOrb = shadow.getElementById('breath-orb');
  const breathTitle = shadow.getElementById('breath-title');
  const breathSubtitle = shadow.getElementById('breath-subtitle');
  const breathProgress = shadow.getElementById('breath-progress');

  const decisionPills = shadow.querySelectorAll('#decision-pills .pill');
  const pledgeBox = shadow.getElementById('pledge-box');
  const pledgeInput = shadow.getElementById('pledge-input');
  const btnDecisionConfirm = shadow.getElementById('btn-decision-confirm');

  const capsule = shadow.getElementById('status-capsule');
  const capsuleIntent = shadow.getElementById('capsule-intent');
  const capsuleTimer = shadow.getElementById('capsule-timer');
  const btnFinish = shadow.getElementById('btn-finish');

  function clearBreathTimeouts() {
    breathTimeoutList.forEach(t => clearTimeout(t));
    breathTimeoutList = [];
  }

  function switchView(viewName) {
    viewInitial.classList.toggle('hidden', viewName !== 'initial');
    viewBreathing.classList.toggle('hidden', viewName !== 'breathing');
    viewDecision.classList.toggle('hidden', viewName !== 'decision');
  }

  // 1. 第一层页面：时间胶囊切换
  initialPills.forEach(pill => {
    pill.addEventListener('click', () => {
      initialPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      selectedSeconds = parseInt(pill.getAttribute('data-sec'), 10);
    });
  });

  // 2. 第二层页面：使用超时后才触发的深呼吸流程
  function startBreathingRitual() {
    clearBreathTimeouts();
    isFadingPhase = false;
    document.documentElement.style.filter = 'none';
    document.documentElement.style.transition = '';
    overlay.classList.remove('hidden');
    capsule.classList.add('hidden');
    document.body.style.overflow = 'hidden';
    switchView('breathing');

    breathOrb.className = 'breath-orb';

    const schedule = (fn, delay) => {
      const id = setTimeout(fn, delay);
      breathTimeoutList.push(id);
    };

    // 第 1 组：鼻吸气 4 秒
    schedule(() => {
      breathTitle.textContent = '鼻吸气 · 4秒';
      breathSubtitle.textContent = '感受气息缓缓内聚';
      breathProgress.textContent = '第 1 / 2 组';
      breathOrb.className = 'breath-orb inhale';
    }, 50);

    // 第 1 组：口呼气 8 秒
    schedule(() => {
      breathTitle.textContent = '口呼气 · 8秒';
      breathSubtitle.textContent = '缓慢吐气，释放大脑焦躁';
      breathProgress.textContent = '第 1 / 2 组';
      breathOrb.className = 'breath-orb exhale';
    }, 4050);

    // 无缝衔接第 2 组：鼻吸气 4 秒
    schedule(() => {
      breathTitle.textContent = '鼻吸气 · 4秒';
      breathSubtitle.textContent = '吸气，让注意力回到当下';
      breathProgress.textContent = '第 2 / 2 组';
      breathOrb.className = 'breath-orb inhale';
    }, 12050);

    // 第 2 组：口呼气 8 秒
    schedule(() => {
      breathTitle.textContent = '口呼气 · 8秒';
      breathSubtitle.textContent = '彻底呼出，找回清醒的判断力';
      breathProgress.textContent = '第 2 / 2 组';
      breathOrb.className = 'breath-orb exhale';
    }, 16050);

    // 两组呼吸结束，切入抉择界面
    schedule(() => {
      showDecisionView();
    }, 24050);
  }

  // 3. 深呼吸结束后的抉择界面
  function showDecisionView() {
    switchView('decision');
    extendSeconds = 0;
    decisionPills.forEach(p => {
      p.classList.toggle('active', p.getAttribute('data-extend') === '0');
    });
    pledgeBox.classList.add('hidden');
    pledgeInput.value = '';
    pledgeInput.classList.remove('matched');
    btnDecisionConfirm.disabled = false;
    btnDecisionConfirm.textContent = '确认离开网页';
  }

  decisionPills.forEach(pill => {
    pill.addEventListener('click', () => {
      decisionPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      extendSeconds = parseInt(pill.getAttribute('data-extend'), 10);

      if (extendSeconds === 0) {
        pledgeBox.classList.add('hidden');
        btnDecisionConfirm.disabled = false;
        btnDecisionConfirm.textContent = '确认离开网页';
      } else {
        pledgeBox.classList.remove('hidden');
        btnDecisionConfirm.textContent = `完成上方输入以延长 ${extendSeconds / 60} 分钟`;
        checkPledgeMatch();
        setTimeout(() => pledgeInput.focus(), 50);
      }
    });
  });

  // 禁用粘贴事件 onpaste
  pledgeInput.addEventListener('paste', (e) => e.preventDefault());
  pledgeInput.addEventListener('drop', (e) => e.preventDefault());
  pledgeInput.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
      e.preventDefault();
    }
    if (e.key === 'Enter' && !btnDecisionConfirm.disabled) {
      btnDecisionConfirm.click();
    }
  });

  function checkPledgeMatch() {
    const val = pledgeInput.value.trim().replace(/^[“"']|[”"']$/g, '');
    if (val === PLEDGE_TEXT) {
      pledgeInput.classList.add('matched');
      btnDecisionConfirm.disabled = false;
      btnDecisionConfirm.textContent = `✓ 验证通过，重新开启 ${extendSeconds / 60} 分钟`;
    } else {
      pledgeInput.classList.remove('matched');
      btnDecisionConfirm.disabled = true;
      btnDecisionConfirm.textContent = `请一字不差输入上方句子以延长 ${extendSeconds / 60} 分钟`;
    }
  }

  pledgeInput.addEventListener('input', checkPledgeMatch);

  btnDecisionConfirm.addEventListener('click', () => {
    if (extendSeconds === 0) {
      exitWebsite();
    } else {
      const val = pledgeInput.value.trim().replace(/^[“"']|[”"']$/g, '');
      if (val !== PLEDGE_TEXT) return;

      const newEndTime = Date.now() + extendSeconds * 1000;
      const sessionData = {
        intent: currentIntent || '继续处理未竟事项',
        endTime: newEndTime,
        totalDuration: extendSeconds
      };

      safeStorageSet({ [STORAGE_KEY]: sessionData }, () => {
        startSession(sessionData.intent, newEndTime, extendSeconds);
      });
    }
  });

  function exitWebsite() {
    clearBreathTimeouts();
    isFadingPhase = false;
    document.documentElement.style.filter = 'none';
    safeStorageRemove(STORAGE_KEY, () => {
      window.location.href = 'about:blank';
    });
  }

  // 显示第一层页面（首次进入门神）
  function showInitialGate() {
    if (timerInterval) clearInterval(timerInterval);
    clearBreathTimeouts();
    hasTriggeredOvertimeUI = false;
    isFadingPhase = false;
    document.documentElement.style.filter = 'none';
    capsule.classList.add('hidden');
    switchView('initial');
    overlay.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    setTimeout(() => intentInput.focus(), 100);
  }

  // 启动倒计时会话：包含最后 60 秒的渐进式黑白化 + 25% 滚轮物理阻尼
  function startSession(intentText, endTime, totalDuration) {
    currentIntent = intentText;
    clearBreathTimeouts();
    hasTriggeredOvertimeUI = false;
    isFadingPhase = false;
    document.documentElement.style.filter = 'none';
    overlay.classList.add('hidden');
    document.body.style.overflow = '';
    capsule.classList.remove('hidden', 'warning');
    capsuleIntent.textContent = intentText;

    if (timerInterval) clearInterval(timerInterval);

    const tick = () => {
      const now = Date.now();
      const remainingSec = Math.ceil((endTime - now) / 1000);

      if (remainingSec > 0) {
        const mins = String(Math.floor(remainingSec / 60)).padStart(2, '0');
        const secs = String(remainingSec % 60).padStart(2, '0');
        capsuleTimer.textContent = `${mins}:${secs}`;

        const fadeWindow = totalDuration <= 15 ? 10 : 60;
        if (remainingSec <= fadeWindow) {
          isFadingPhase = true;
          capsule.classList.add('warning');
          const grayPercent = Math.min(100, Math.round(((fadeWindow - remainingSec) / fadeWindow) * 100));
          document.documentElement.style.filter = `grayscale(${grayPercent}%)`;
          document.documentElement.style.transition = 'filter 1s linear';
        } else {
          isFadingPhase = false;
          capsule.classList.remove('warning');
          document.documentElement.style.filter = 'none';
        }
      } else {
        if (!hasTriggeredOvertimeUI) {
          hasTriggeredOvertimeUI = true;
          isFadingPhase = false;
          clearInterval(timerInterval);
          safeStorageRemove(STORAGE_KEY);
          startBreathingRitual();
        }
      }
    };

    tick();
    timerInterval = setInterval(tick, 1000);
  }

  // 滚轮阻尼：在最后 60 秒褪色阶段，将滚动速度降为原来的 25%
  window.addEventListener('wheel', (e) => {
    if (isFadingPhase) {
      e.preventDefault();
      window.scrollBy({
        top: e.deltaY * 0.25,
        behavior: 'auto'
      });
    }
  }, { passive: false });

  // 第一层页面点击进入处理逻辑
  function handleEnter(redirectSearch) {
    const text = intentInput.value.trim();
    if (!text) {
      intentInput.classList.add('error');
      setTimeout(() => intentInput.classList.remove('error'), 400);
      intentInput.focus();
      return;
    }

    const endTime = Date.now() + selectedSeconds * 1000;
    const sessionData = {
      intent: text,
      endTime: endTime,
      totalDuration: selectedSeconds
    };

    safeStorageSet({ [STORAGE_KEY]: sessionData }, () => {
      if (redirectSearch) {
        const searchUrl = getSearchUrl(text);
        if (searchUrl) {
          btnSearch.textContent = '🌿 正在为你开启专注检索...';
          window.location.href = searchUrl;
          return;
        }
      }
      startSession(text, endTime, selectedSeconds);
    });
  }

  btnSearch.addEventListener('click', () => handleEnter(true));
  btnStart.addEventListener('click', () => handleEnter(false));
  intentInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleEnter(true);
  });

  btnFinish.addEventListener('click', exitWebsite);

  // 跨标签页状态同步
  if (isContextValid()) {
    try {
      extApi.storage.onChanged.addListener((changes, area) => {
        if (!isContextValid()) return;
        if (area === 'local' && changes[STORAGE_KEY]) {
          const newVal = changes[STORAGE_KEY].newValue;
          if (newVal && newVal.endTime && Date.now() < newVal.endTime) {
            startSession(newVal.intent, newVal.endTime, newVal.totalDuration || 15);
          }
        }
      });
    } catch (e) {}
  }

  // 页面初始化检查
  safeStorageGet([STORAGE_KEY], (result) => {
    const data = result ? result[STORAGE_KEY] : null;
    if (data && data.endTime && Date.now() < data.endTime) {
      startSession(data.intent, data.endTime, data.totalDuration || 15);
    } else {
      safeStorageRemove(STORAGE_KEY);
      showInitialGate();
    }
  });
})();