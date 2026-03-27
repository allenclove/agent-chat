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
    pinnedManuallyHidden: false
  },

  // DOM 元素
  elements: {
    agentSettingsModal: null,
    displaySettingsModal: null,
    settingsBtn: null,
    pinLastHumanMsgCheckbox: null,
    pinnedMessageContainer: null,
    pinnedMessageContent: null
  },

  // 初始化
  init(agentSettingsModal, displaySettingsModal, settingsBtn, pinLastHumanMsgCheckbox, pinnedMessageContainer, pinnedMessageContent) {
    this.elements.agentSettingsModal = agentSettingsModal;
    this.elements.displaySettingsModal = displaySettingsModal;
    this.elements.settingsBtn = settingsBtn;
    this.elements.pinLastHumanMsgCheckbox = pinLastHumanMsgCheckbox;
    this.elements.pinnedMessageContainer = pinnedMessageContainer;
    this.elements.pinnedMessageContent = pinnedMessageContent;

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

    // 加载显示设置
    this.loadDisplaySettings();
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
    this.updatePinnedMessage();
  },

  hidePinnedMessage() {
    this.state.pinnedManuallyHidden = true;
    this.elements.pinnedMessageContainer?.classList.add('hidden');
  },

  updatePinnedMessage() {
    const container = this.elements.pinnedMessageContainer;
    const content = this.elements.pinnedMessageContent;

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
        <div class="text-sm text-gray-700 mt-0.5 message-content">${ChatRender.renderContent(msg.content, false)}</div>
      `;
      container.classList.remove('hidden');
    } else {
      container.classList.add('hidden');
    }
  }
};

window.ModalsModule = ModalsModule;
