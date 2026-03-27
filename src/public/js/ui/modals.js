/**
 * 弹窗模块 - 处理 Agent 设置和显示设置弹窗
 */

const ModalsModule = {
  // 状态
  state: {
    currentEditingAgent: null,
    displaySettings: {
      pinLastHumanMsg: false
    },
    lastHumanMessage: null,
    pinnedManuallyHidden: false,
    pinnedExpanded: false  // 置顶消息是否展开
  },

  // DOM 元素
  elements: {
    agentSettingsModal: null,
    displaySettingsModal: null,
    settingsBtn: null,
    pinLastHumanMsgCheckbox: null,
    pinnedMessageContainer: null,
    pinnedMessageContent: null,
    pinnedExpandBtn: null,
    pinnedCloseBtn: null
  },

  // 初始化
  init(agentSettingsModal, displaySettingsModal, settingsBtn, pinLastHumanMsgCheckbox, pinnedMessageContainer, pinnedMessageContent) {
    this.elements.agentSettingsModal = agentSettingsModal;
    this.elements.displaySettingsModal = displaySettingsModal;
    this.elements.settingsBtn = settingsBtn;
    this.elements.pinLastHumanMsgCheckbox = pinLastHumanMsgCheckbox;
    this.elements.pinnedMessageContainer = pinnedMessageContainer;
    this.elements.pinnedMessageContent = pinnedMessageContent;
    this.elements.pinnedExpandBtn = document.getElementById('pinnedExpandBtn');
    this.elements.pinnedCloseBtn = document.getElementById('pinnedCloseBtn');

    // Agent设置弹窗关闭
    this.elements.agentSettingsModal?.addEventListener('click', (e) => {
      if (e.target === this.elements.agentSettingsModal) this.closeAgentSettings();
    });

    // 显示设置
    this.elements.settingsBtn?.addEventListener('click', () => this.openDisplaySettings());
    this.elements.displaySettingsModal?.addEventListener('click', (e) => {
      if (e.target === this.elements.displaySettingsModal) this.closeDisplaySettings();
    });
    this.elements.pinLastHumanMsgCheckbox?.addEventListener('change', (e) => {
      this.state.displaySettings.pinLastHumanMsg = e.target.checked;
      this.saveDisplaySettings();
      this.updatePinnedMessage();
    });

    // 置顶消息事件
    this.initPinnedMessageEvents();

    // 加载显示设置
    this.loadDisplaySettings();
  },

  // 初始化置顶消息事件
  initPinnedMessageEvents() {
    const container = this.elements.pinnedMessageContainer;
    const expandBtn = this.elements.pinnedExpandBtn;
    const closeBtn = this.elements.pinnedCloseBtn;

    // 双击跳转到原消息
    container?.addEventListener('dblclick', (e) => {
      // 排除点击按钮的情况
      if (e.target.closest('button')) return;
      this.scrollToPinnedMessage();
    });

    // 关闭按钮
    closeBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hidePinnedMessage();
    });

    // 展开/收起按钮
    expandBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.togglePinnedExpand();
    });

    // 点击外部收起（手机端逻辑）
    document.addEventListener('click', (e) => {
      if (this.state.pinnedExpanded && container && !container.contains(e.target)) {
        this.collapsePinned();
      }
    });

    // 电脑端：鼠标离开时收起（如果已展开）
    container?.addEventListener('mouseleave', () => {
      if (this.state.pinnedExpanded && window.innerWidth >= 768) {
        // 电脑端延迟收起，给用户时间操作
        setTimeout(() => {
          if (!container.matches(':hover')) {
            this.collapsePinned();
          }
        }, 500);
      }
    });
  },

  // ==================== Agent 设置 ====================

  async openAgentSettings(agentId) {
    this.state.currentEditingAgent = agentId;
    const modal = this.elements.agentSettingsModal;
    const content = document.getElementById('agentSettingsContent');

    modal?.classList.remove('hidden');
    content.innerHTML = '<div class="text-center text-gray-400 py-8">加载中...</div>';

    try {
      const data = await ChatAPI.getAgentConfig(agentId);

      if (!data.success) {
        content.innerHTML = `<div class="text-red-500 text-center py-4">${data.error || '加载失败'}</div>`;
        return;
      }

      const config = data.config;
      const customSettings = config.custom_settings || {};

      content.innerHTML = `
        <div class="space-y-4">
          <div>
            <label class="block text-sm text-gray-600 mb-1">名称</label>
            <input type="text" id="agentName" value="${config.name || ''}" class="w-full px-3 py-2 border rounded-lg">
          </div>
          <div>
            <label class="block text-sm text-gray-600 mb-1">🎭 人设 / 性格</label>
            <textarea id="agentPersona" class="w-full px-3 py-2 border rounded-lg" rows="3">${config.persona || ''}</textarea>
          </div>
          <div>
            <label class="block text-sm text-gray-600 mb-1">💬 对话模式</label>
            <select id="agentConversationMode" class="w-full px-3 py-2 border rounded-lg">
              <option value="free" ${config.conversation_mode === 'free' ? 'selected' : ''}>自由模式</option>
              <option value="mention" ${config.conversation_mode === 'mention' ? 'selected' : ''}>提及模式</option>
              <option value="passive" ${config.conversation_mode === 'passive' ? 'selected' : ''}>被动模式</option>
            </select>
          </div>
          <div>
            <label class="block text-sm text-gray-600 mb-1">📩 消息过滤</label>
            <select id="agentMessageFilter" class="w-full px-3 py-2 border rounded-lg">
              <option value="all" ${config.message_filter === 'all' ? 'selected' : ''}>接收所有消息</option>
              <option value="keywords" ${config.message_filter === 'keywords' ? 'selected' : ''}>仅关键词匹配</option>
              <option value="mention" ${config.message_filter === 'mention' ? 'selected' : ''}>仅被提及时</option>
            </select>
          </div>
          <div>
            <label class="block text-sm text-gray-600 mb-1">📜 历史消息数量</label>
            <input type="number" id="agentHistoryLimit" value="${config.history_limit || 50}" min="10" max="500" class="w-full px-3 py-2 border rounded-lg">
          </div>
          <div>
            <label class="block text-sm text-gray-600 mb-1">🔧 自定义设置 (JSON)</label>
            <textarea id="agentCustomSettings" class="w-full px-3 py-2 border rounded-lg font-mono text-sm" rows="3">${JSON.stringify(customSettings, null, 2)}</textarea>
          </div>
          <div class="flex space-x-2 pt-2">
            <button onclick="ModalsModule.saveAgentSettings()" class="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700">💾 保存</button>
            <button onclick="ModalsModule.closeAgentSettings()" class="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300">取消</button>
          </div>
        </div>
      `;
    } catch (e) {
      content.innerHTML = `<div class="text-red-500 text-center py-4">加载失败: ${e.message}</div>`;
    }
  },

  closeAgentSettings() {
    this.elements.agentSettingsModal?.classList.add('hidden');
    this.state.currentEditingAgent = null;
  },

  async saveAgentSettings() {
    if (!this.state.currentEditingAgent) return;

    const name = document.getElementById('agentName')?.value.trim();
    const persona = document.getElementById('agentPersona')?.value.trim();
    const conversationMode = document.getElementById('agentConversationMode')?.value;
    const messageFilter = document.getElementById('agentMessageFilter')?.value;
    const historyLimit = parseInt(document.getElementById('agentHistoryLimit')?.value) || 50;
    const customSettingsStr = document.getElementById('agentCustomSettings')?.value.trim();

    let customSettings = {};
    if (customSettingsStr) {
      try {
        customSettings = JSON.parse(customSettingsStr);
      } catch (e) {
        alert('自定义设置 JSON 格式错误');
        return;
      }
    }

    const settings = {
      name,
      persona,
      conversation_mode: conversationMode,
      message_filter: messageFilter,
      history_limit: historyLimit,
      custom_settings: customSettings
    };

    try {
      const data = await ChatAPI.updateAgentConfig(this.state.currentEditingAgent, settings);

      if (data.success) {
        this.closeAgentSettings();
        ChatWS.requestAgentList();
        ChatUtils.showToast(`✅ Agent "${name}" 设置已保存`);
      } else {
        alert(data.error || '保存失败');
      }
    } catch (e) {
      alert('保存失败: ' + e.message);
    }
  },

  // ==================== 显示设置 ====================

  openDisplaySettings() {
    this.elements.displaySettingsModal?.classList.remove('hidden');
    if (this.elements.pinLastHumanMsgCheckbox) {
      this.elements.pinLastHumanMsgCheckbox.checked = this.state.displaySettings.pinLastHumanMsg;
    }
  },

  closeDisplaySettings() {
    this.elements.displaySettingsModal?.classList.add('hidden');
  },

  loadDisplaySettings() {
    try {
      const saved = localStorage.getItem('chat_display_settings');
      if (saved) {
        this.state.displaySettings = JSON.parse(saved);
      }
    } catch (e) {
      console.error('加载显示设置失败:', e);
    }
    // 更新复选框状态
    if (this.elements.pinLastHumanMsgCheckbox) {
      this.elements.pinLastHumanMsgCheckbox.checked = this.state.displaySettings.pinLastHumanMsg;
    }
    // 更新置顶消息
    this.updatePinnedMessage();
  },

  saveDisplaySettings() {
    try {
      localStorage.setItem('chat_display_settings', JSON.stringify(this.state.displaySettings));
    } catch (e) {
      console.error('保存显示设置失败:', e);
    }
  },

  // ==================== 置顶消息 ====================

  setLastHumanMessage(msg) {
    this.state.lastHumanMessage = msg;
    this.state.pinnedManuallyHidden = false; // 新消息时重置
    this.state.pinnedExpanded = false; // 重置展开状态
    this.updatePinnedMessage();
  },

  hidePinnedMessage() {
    this.state.pinnedManuallyHidden = true;
    this.elements.pinnedMessageContainer?.classList.add('hidden');
  },

  // 双击跳转到原消息
  scrollToPinnedMessage() {
    if (!this.state.lastHumanMessage) return;

    const msgId = this.state.lastHumanMessage.id;
    const messageContainer = document.getElementById('messageContainer');

    if (!messageContainer) return;

    // 查找对应的消息元素
    const targetMsg = messageContainer.querySelector(`[data-msg-id="${msgId}"]`);

    if (targetMsg) {
      // 滚动到消息位置
      targetMsg.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // 高亮效果
      targetMsg.classList.add('ring-2', 'ring-purple-400', 'ring-opacity-75');
      setTimeout(() => {
        targetMsg.classList.remove('ring-2', 'ring-purple-400', 'ring-opacity-75');
      }, 2000);
    } else {
      // 如果消息不在当前视图中，提示用户
      ChatUtils.showToast('消息已不在当前页面，请向上滚动查找');
    }
  },

  // 展开/收起置顶消息
  togglePinnedExpand() {
    if (this.state.pinnedExpanded) {
      this.collapsePinned();
    } else {
      this.expandPinned();
    }
  },

  expandPinned() {
    const container = this.elements.pinnedMessageContainer;
    const expandBtn = this.elements.pinnedExpandBtn;

    this.state.pinnedExpanded = true;
    container?.classList.add('pinned-expanded');

    // 更新按钮图标为向上箭头
    if (expandBtn) {
      expandBtn.innerHTML = `
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"></path>
        </svg>
      `;
      expandBtn.title = '收起';
    }
  },

  collapsePinned() {
    const container = this.elements.pinnedMessageContainer;
    const expandBtn = this.elements.pinnedExpandBtn;

    this.state.pinnedExpanded = false;
    container?.classList.remove('pinned-expanded');

    // 更新按钮图标为向下箭头
    if (expandBtn) {
      expandBtn.innerHTML = `
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path>
        </svg>
      `;
      expandBtn.title = '展开查看完整内容';
    }
  },

  updatePinnedMessage() {
    const container = this.elements.pinnedMessageContainer;
    const content = this.elements.pinnedMessageContent;
    const expandBtn = this.elements.pinnedExpandBtn;

    if (!container || !content) return;

    // 如果用户手动关闭了，不显示
    if (this.state.pinnedManuallyHidden) {
      container.classList.add('hidden');
      return;
    }

    if (this.state.displaySettings.pinLastHumanMsg && this.state.lastHumanMessage) {
      const msg = this.state.lastHumanMessage;
      const senderName = msg.sender_name || 'Unknown';

      content.innerHTML = `
        <div class="flex items-center space-x-2 text-sm">
          <span class="font-semibold text-purple-700">${ChatUtils.escapeHtml(senderName)}</span>
          <span class="text-xs text-gray-400">${ChatRender.formatTime(msg.created_at)}</span>
        </div>
        <div class="text-sm text-gray-700 mt-0.5 pinned-message-content">${ChatRender.renderContent(msg.content, false)}</div>
      `;

      container.classList.remove('hidden');

      // 检查消息是否过长，显示/隐藏展开按钮
      // 延迟检查，等待 DOM 渲染完成
      setTimeout(() => {
        const msgContent = content.querySelector('.pinned-message-content');
        if (msgContent && expandBtn) {
          const isOverflow = msgContent.scrollHeight > 42; // 约2行文字高度
          if (isOverflow) {
            expandBtn.classList.remove('hidden');
          } else {
            expandBtn.classList.add('hidden');
          }
        }
      }, 50);

      // 重置展开状态
      this.collapsePinned();
    } else {
      container.classList.add('hidden');
    }
  }
};

window.ModalsModule = ModalsModule;
