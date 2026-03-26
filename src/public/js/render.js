/**
 * 渲染模块 - 消息渲染、Markdown渲染
 */

const ChatRender = {
  md: null,
  agents: [],

  // 解析上海时间字符串为Date对象
  // 输入格式: "2026-03-23 12:00:00" (上海时间)
  parseShanghaiTime(timeStr) {
    if (!timeStr) return new Date();
    // 将上海时间字符串转换为ISO格式，明确指定时区
    // 格式: "2026-03-23 12:00:00" -> "2026-03-23T12:00:00+08:00"
    const isoStr = timeStr.replace(' ', 'T') + '+08:00';
    return new Date(isoStr);
  },

  // 初始化 Markdown-it
  initMarkdown() {
    this.md = window.markdownit({
      html: false,
      breaks: true,
      linkify: true,
      typographer: true,
      highlight: function(code, lang) {
        if (lang && hljs.getLanguage(lang)) {
          try {
            return hljs.highlight(code, { language: lang }).value;
          } catch (e) {}
        }
        return hljs.highlightAuto(code).value;
      }
    });
  },

  // 设置Agent列表
  setAgents(agentList) {
    this.agents = agentList;
  },

  // 渲染消息内容（Markdown + @提及高亮）
  renderContent(content, isSelf) {
    const placeholderPrefix = 'MNTN' + Math.random().toString(36).slice(2, 8) + 'X';
    const mentionPlaceholders = [];
    let processedContent = content;

    if (this.agents && this.agents.length > 0) {
      const sortedAgents = [...this.agents].sort((a, b) => b.name.length - a.name.length);
      for (const agent of sortedAgents) {
        const escapedName = agent.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`@${escapedName}`, 'g');
        const highlightClass = isSelf
          ? 'bg-purple-500 text-white px-1 rounded'
          : 'bg-purple-200 text-purple-800 px-1 rounded';
        const placeholder = placeholderPrefix + mentionPlaceholders.length;
        processedContent = processedContent.replace(regex, placeholder);
        mentionPlaceholders.push(`<span class="${highlightClass}">@${ChatUtils.escapeHtml(agent.name)}</span>`);
      }
    }

    let html;
    try {
      html = this.md.render(processedContent);
    } catch (e) {
      html = ChatUtils.escapeHtml(processedContent).replace(/\n/g, '<br>');
    }

    mentionPlaceholders.forEach((mention, i) => {
      const placeholder = placeholderPrefix + i;
      html = html.split(placeholder).join(mention);
      const pWrapped = '<p>' + placeholder;
      if (html.includes(pWrapped)) {
        html = html.split(pWrapped).join('<p>' + mention);
      }
    });

    return html;
  },

  // 为代码块添加复制按钮
  addCopyButtons(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const preBlocks = container.querySelectorAll('pre');
    preBlocks.forEach((pre, index) => {
      const code = pre.querySelector('code');
      const langClass = code?.className.match(/language-(\w+)/);
      const lang = langClass ? langClass[1] : 'code';

      const wrapper = document.createElement('div');
      wrapper.className = 'code-block-wrapper';
      pre.parentNode.insertBefore(wrapper, pre);

      const header = document.createElement('div');
      header.className = 'code-block-header';
      header.innerHTML = `
        <span>${lang}</span>
        <button class="copy-btn" data-index="${index}">复制</button>
      `;

      wrapper.appendChild(header);
      wrapper.appendChild(pre);

      const copyBtn = header.querySelector('.copy-btn');
      copyBtn.addEventListener('click', async () => {
        const codeText = code?.textContent || pre.textContent;
        try {
          await navigator.clipboard.writeText(codeText);
          copyBtn.textContent = '已复制';
          copyBtn.classList.add('copied');
          setTimeout(() => {
            copyBtn.textContent = '复制';
            copyBtn.classList.remove('copied');
          }, 2000);
        } catch (e) {
          copyBtn.textContent = '失败';
          setTimeout(() => {
            copyBtn.textContent = '复制';
          }, 2000);
        }
      });
    });
  },

  // 渲染用户列表
  renderUserList(users, userListEl, onlineCountEl) {
    if (onlineCountEl) onlineCountEl.textContent = users.length;
    if (!userListEl) return;
    userListEl.innerHTML = users.map(user => `
      <div class="flex items-center space-x-2 p-2 rounded-lg hover:bg-gray-50">
        <div class="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-sm">👤</div>
        <span class="text-sm text-gray-700">${user.display_name || user.username}</span>
      </div>
    `).join('');
  },

  // 渲染Agent列表
  renderAgentList(agentList, agentListEl, agentCountEl) {
    this.setAgents(agentList);
    const onlineAgents = agentList.filter(a => a.status === 'online');
    if (agentCountEl) agentCountEl.textContent = onlineAgents.length;
    if (!agentListEl) return;

    agentListEl.innerHTML = agentList.map(agent => `
      <div class="flex items-center space-x-2 p-2 rounded-lg hover:bg-gray-50 group">
        <div class="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center text-sm">🤖</div>
        <span class="text-sm text-gray-700 flex-1">${ChatUtils.escapeHtml(agent.name)}</span>
        <button onclick="ChatUI.openAgentSettings('${agent.id}')" class="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-purple-600 p-1" title="设置">
          ⚙️
        </button>
        <span class="w-2 h-2 rounded-full ${agent.status === 'online' ? 'bg-green-500' : 'bg-gray-300'}"></span>
      </div>
    `).join('');
  },

  // 添加消息到容器
  addMessage(msg, container, autoScroll, currentUser) {
    const div = document.createElement('div');
    const isSelf = msg.sender_id === currentUser?.id;
    const senderType = msg.sender_type || 'user';
    const senderIcon = senderType === 'agent' ? '🤖 ' : '';
    const senderName = msg.sender_name || 'Unknown';

    // 保存原始消息内容（用于复制）
    div.dataset.rawContent = msg.content;

    // 根据发送者设置对齐方式
    div.className = `message-item flex flex-col mb-4 ${isSelf ? 'items-end' : 'items-start'}`;
    div.dataset.msgId = msg.id;

    // 消息头部
    const header = document.createElement('div');
    header.className = 'flex items-center space-x-2 mb-1';
    const messageTime = this.parseShanghaiTime(msg.created_at);
    header.innerHTML = `
      <span class="text-sm font-semibold ${isSelf ? 'text-purple-600' : 'text-gray-600'}">
        ${senderIcon}${ChatUtils.escapeHtml(senderName)}
      </span>
      <span class="text-xs text-gray-400">${messageTime.toLocaleTimeString('zh-CN', { hour12: false })}</span>
    `;
    div.appendChild(header);

    // 消息气泡容器（用于定位复制按钮）
    // 消息气泡容器 - inline-block 让宽度适应内容
    const bubbleWrapper = document.createElement('div');
    bubbleWrapper.className = 'message-bubble-wrapper inline-block relative group max-w-[85%] md:max-w-[75%]';

    // 消息气泡
    const bubble = document.createElement('div');
    const bubbleClass = isSelf
      ? 'bg-purple-500 text-white rounded-2xl rounded-tr-sm px-4 py-2 pr-10'
      : senderType === 'agent'
        ? 'bg-gradient-to-r from-purple-50 to-indigo-50 text-gray-800 rounded-2xl rounded-tl-sm px-4 py-2 pr-10 border border-purple-200'
        : 'bg-gray-100 text-gray-800 rounded-2xl rounded-tl-sm px-4 py-2 pr-10';

    bubble.className = bubbleClass;
    bubble.innerHTML = `<div class="message-content text-sm ${isSelf ? 'self-message' : ''}">${this.renderContent(msg.content, isSelf)}</div>`;

    // 为代码块添加包装器和复制按钮
    this.wrapCodeBlocks(bubble);

    bubbleWrapper.appendChild(bubble);

    // 电脑版复制按钮（深色图标按钮，固定在消息气泡右下角内部）
    const copyBtn = document.createElement('button');
    copyBtn.className = `msg-copy-btn absolute bottom-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200 text-gray-400 hover:text-gray-600 p-1 rounded hidden md:block`;
    copyBtn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>`;
    copyBtn.title = '复制消息';
    copyBtn.onclick = (e) => {
      e.stopPropagation();
      this.copyMessage(div.dataset.rawContent, copyBtn);
    };
    bubble.appendChild(copyBtn);

    div.appendChild(bubbleWrapper);

    // 手机版长按复制
    div.addEventListener('contextmenu', (e) => {
      if (window.innerWidth < 768) {
        e.preventDefault();
        this.showMobileCopyMenu(e, div.dataset.rawContent);
      }
    });

    // 手机版长按
    let longPressTimer = null;
    div.addEventListener('touchstart', (e) => {
      if (window.innerWidth < 768) {
        longPressTimer = setTimeout(() => {
          this.showMobileCopyMenu(e, div.dataset.rawContent);
        }, 500);
      }
    });
    div.addEventListener('touchend', () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    });
    div.addEventListener('touchmove', () => {
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    });

    container.appendChild(div);

    if (autoScroll) {
      container.scrollTop = container.scrollHeight;
    }
  },

  // 为代码块添加包装器和复制按钮
  wrapCodeBlocks(container) {
    const preBlocks = container.querySelectorAll('.message-content pre');
    preBlocks.forEach((pre) => {
      if (pre.closest('.code-block-wrapper')) return; // 已包装过

      const code = pre.querySelector('code');
      const langClass = code?.className.match(/language-(\w+)/);
      const lang = langClass ? langClass[1] : 'code';

      const wrapper = document.createElement('div');
      wrapper.className = 'code-block-wrapper';
      pre.parentNode.insertBefore(wrapper, pre);

      const header = document.createElement('div');
      header.className = 'code-block-header';
      header.innerHTML = `
        <span>${lang}</span>
        <button class="copy-btn">📋 复制</button>
      `;

      wrapper.appendChild(header);
      wrapper.appendChild(pre);

      const copyBtn = header.querySelector('.copy-btn');
      const codeText = code?.textContent || pre.textContent;

      copyBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(codeText);
          copyBtn.innerHTML = '✓ 已复制';
          copyBtn.classList.add('copied');
          ChatUtils.showToast('代码已复制');
        } catch (e) {
          // Fallback 方案
          ChatUtils.fallbackCopy(codeText);
          copyBtn.innerHTML = '✓ 已复制';
          copyBtn.classList.add('copied');
        }
        setTimeout(() => {
          copyBtn.innerHTML = '📋 复制';
          copyBtn.classList.remove('copied');
        }, 2000);
      });
    });
  },

  // 复制消息内容
  async copyMessage(content, btn) {
    try {
      await navigator.clipboard.writeText(content);
      btn.innerHTML = '✓';
      btn.title = '已复制';
      setTimeout(() => {
        btn.innerHTML = '📋';
        btn.title = '复制消息';
      }, 1500);
      ChatUtils.showToast('已复制到剪贴板');
    } catch (e) {
      ChatUtils.fallbackCopy(content);
    }
  },

  // 手机版复制菜单
  showMobileCopyMenu(e, content) {
    // 移除已存在的菜单
    const existingMenu = document.querySelector('.mobile-copy-menu');
    if (existingMenu) existingMenu.remove();

    const menu = document.createElement('div');
    menu.className = 'mobile-copy-menu fixed bg-white rounded-lg shadow-lg p-2 z-50';
    menu.innerHTML = `
      <button class="copy-raw-btn w-full text-left px-4 py-2 hover:bg-gray-100 rounded text-sm">
        📋 复制消息
      </button>
    `;

    // 定位菜单
    const touch = e.touches ? e.touches[0] : e;
    if (touch) {
      menu.style.left = `${Math.min(touch.clientX - 60, window.innerWidth - 120)}px`;
      menu.style.top = `${Math.min(touch.clientY - 50, window.innerHeight - 60)}px`;
    }

    document.body.appendChild(menu);

    // 点击复制按钮
    menu.querySelector('.copy-raw-btn').onclick = () => {
      ChatUtils.fallbackCopy(content);
      menu.remove();
    };

    // 点击其他地方关闭菜单
    setTimeout(() => {
      document.addEventListener('click', function closeMenu() {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      });
    }, 100);
  }
};

window.ChatRender = ChatRender;
