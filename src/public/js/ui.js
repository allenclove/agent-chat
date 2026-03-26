/**
 * UI 交互模块 - 模态框、选择模式、 滚动、 @提及
 */

const ChatUI = {
  // 状态
  state: {
    selectionMode: false,
    selectedMessages: new Set(),
    unreadCount: 0,
    isAtBottom: true,
    mentionStartIndex: -1,
    showMentionDropdown: false,
    currentEditingAgent: null
  },

  // DOM 元素缓存
  elements: {},

  // 初始化DOM元素引用
  initElements() {
    this.elements = {
      messageContainer: document.getElementById('messageContainer'),
      messageForm: document.getElementById('messageForm'),
      messageInput: document.getElementById('messageInput'),
      userList: document.getElementById('userList'),
      agentListEl: document.getElementById('agentList'),
      onlineCount: document.getElementById('onlineCount'),
      agentCount: document.getElementById('agentCount'),
      logoutBtn: document.getElementById('logoutBtn'),
      clearHistoryBtn: document.getElementById('clearHistoryBtn'),
      toggleSidebar: document.getElementById('toggleSidebar'),
      sidebar: document.getElementById('sidebar'),
      overlay: document.getElementById('overlay'),
      mentionDropdown: document.getElementById('mentionDropdown'),
      newMessageBtn: document.getElementById('newMessageBtn'),
      selectionToolbar: document.getElementById('selectionToolbar'),
      selectionCount: document.getElementById('selectionCount'),
      selectModeBtn: document.getElementById('selectModeBtn'),
      topicModal: document.getElementById('topicModal'),
      topicTitle: document.getElementById('topicTitle'),
      topicDesc: document.getElementById('topicDesc'),
      selectedCountEl: document.getElementById('selectedCount'),
      agentSettingsModal: document.getElementById('agentSettingsModal')
    };
  },

  // 初始化事件监听
  initEvents() {
    const el = this.elements;

    // 侧边栏切换
    el.toggleSidebar?.addEventListener('click', () => {
      el.sidebar.classList.toggle('hidden-mobile');
      el.overlay.classList.toggle('hidden');
    });

    el.overlay?.addEventListener('click', () => {
      el.sidebar.classList.add('hidden-mobile');
      el.overlay.classList.add('hidden');
    });

    // 登出
    el.logoutBtn?.addEventListener('click', async () => {
      const sessionId = localStorage.getItem('session_id');
      await ChatAPI.logout(sessionId);
    });

    // 清空聊天记录
    el.clearHistoryBtn?.addEventListener('click', async () => {
      if (!confirm('确定要清空所有聊天记录吗？此操作不可恢复！')) return;
      try {
        const data = await ChatAPI.clearMessages();
        if (data.success) {
          el.messageContainer.innerHTML = '';
          alert('聊天记录已清空');
        }
      } catch (e) {
        alert('清空失败：' + e.message);
      }
    });

    // 发送消息
    el.messageForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      const content = el.messageInput.value.trim();
      if (!content || !ChatWS.isConnected()) return;

      ChatWS.sendMessage(content);
      el.messageInput.value = '';
      this.hideMentionDropdown();

      // 发送消息后重置状态，确保后续回复自动滚动到底部
      this.state.isAtBottom = true;
      this.state.unreadCount = 0;
      this.updateNewMessageButton();
      this.scrollToBottom();
    });

    // 回车发送
    el.messageInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        if (this.state.showMentionDropdown) {
          e.preventDefault();
          this.selectFirstMention();
        } else {
          e.preventDefault();
          el.messageForm.dispatchEvent(new Event('submit'));
        }
      }
    });

    // @提及输入监听
    el.messageInput?.addEventListener('input', (e) => this.handleMentionInput());

    // 方向键导航@提及列表
    el.messageInput?.addEventListener('keydown', (e) => this.handleMentionKeydown(e));

    // 点击其他地方关闭下拉菜单
    document.addEventListener('click', (e) => {
      if (!el.messageInput?.contains(e.target) && !el.mentionDropdown?.contains(e.target)) {
        this.hideMentionDropdown();
      }
    });

    // 滚动监听
    el.messageContainer?.addEventListener('scroll', () => this.handleScroll());

    // 新消息按钮
    el.newMessageBtn?.addEventListener('click', () => {
      this.scrollToBottom();
      this.state.unreadCount = 0;
      this.updateNewMessageButton();
    });

    // 选择模式
    el.selectModeBtn?.addEventListener('click', () => this.toggleSelectionMode());

    // 话题相关
    document.getElementById('saveAsTopicBtn')?.addEventListener('click', () => this.openTopicModal());
    document.getElementById('cancelSelectionBtn')?.addEventListener('click', () => this.exitSelectionMode());
    document.getElementById('cancelTopicBtn')?.addEventListener('click', () => this.closeTopicModal());
    document.getElementById('createTopicBtn')?.addEventListener('click', () => this.createTopic());
    el.topicModal?.addEventListener('click', (e) => {
      if (e.target === el.topicModal) this.closeTopicModal();
    });

    // Agent设置弹窗
    el.agentSettingsModal?.addEventListener('click', (e) => {
      if (e.target === el.agentSettingsModal) this.closeAgentSettings();
    });
  },

  // ==================== 滚动相关 ====================

  checkIsAtBottom() {
    const el = this.elements.messageContainer;
    if (!el) return true;
    const { scrollTop, scrollHeight, clientHeight } = el;
    // 增大阈值到 250px，更容易触发自动滚动
    return scrollTop + clientHeight >= scrollHeight - 250;
  },

  scrollToBottom() {
    const el = this.elements.messageContainer;
    if (el) {
      el.scrollTo({
        top: el.scrollHeight,
        behavior: 'smooth'
      });
      this.state.isAtBottom = true;
      this.state.unreadCount = 0;
      this.updateNewMessageButton();
    }
  },

  handleScroll() {
    const wasAtBottom = this.state.isAtBottom;
    this.state.isAtBottom = this.checkIsAtBottom();

    // 如果滚动到底部，清除未读计数
    if (this.state.isAtBottom && this.state.unreadCount > 0) {
      this.state.unreadCount = 0;
      this.updateNewMessageButton();
    }
  },

  updateNewMessageButton() {
    const btn = this.elements.newMessageBtn;
    if (!btn) return;

    const countEl = document.getElementById('newMessageCount');
    if (this.state.unreadCount > 0) {
      if (countEl) countEl.textContent = this.state.unreadCount;
      btn.classList.remove('hidden');
    } else {
      btn.classList.add('hidden');
    }
  },

  // ==================== 选择模式 ====================

  toggleSelectionMode() {
    this.state.selectionMode = !this.state.selectionMode;
    const btn = this.elements.selectModeBtn;
    btn?.classList.toggle('bg-purple-100', this.state.selectionMode);
    btn?.classList.toggle('text-purple-600', this.state.selectionMode);

    if (!this.state.selectionMode) {
      this.exitSelectionMode();
    } else {
      this.elements.selectionToolbar?.classList.remove('hidden');
    }
  },

  exitSelectionMode() {
    this.state.selectionMode = false;
    this.state.selectedMessages.clear();
    this.elements.selectModeBtn?.classList.remove('bg-purple-100', 'text-purple-600');
    this.elements.selectionToolbar?.classList.add('hidden');

    document.querySelectorAll('.message-item.selected').forEach(el => {
      el.classList.remove('selected');
    });
    this.updateSelectionCount();
  },

  toggleMessageSelection(msgId, element) {
    if (this.state.selectedMessages.has(msgId)) {
      this.state.selectedMessages.delete(msgId);
      element.classList.remove('selected');
      element.querySelector('.message-checkbox')?.classList.remove('checked');
    } else {
      this.state.selectedMessages.add(msgId);
      element.classList.add('selected');
      element.querySelector('.message-checkbox')?.classList.add('checked');
    }
    this.updateSelectionCount();
  },

  updateSelectionCount() {
    const count = this.state.selectedMessages.size;
    this.elements.selectionCount.textContent = count;
    if (count === 0) {
      this.elements.selectionToolbar?.classList.add('hidden');
    } else {
      this.elements.selectionToolbar?.classList.remove('hidden');
    }
  },

  // ==================== 话题相关 ====================

  openTopicModal() {
    if (this.state.selectedMessages.size === 0) return;
    this.elements.selectedCountEl.textContent = this.state.selectedMessages.size;
    this.elements.topicModal?.classList.remove('hidden');
  },

  closeTopicModal() {
    this.elements.topicModal?.classList.add('hidden');
  },

  async createTopic() {
    const title = this.elements.topicTitle?.value.trim();
    if (!title) {
      alert('请输入话题标题');
      return;
    }

    try {
      const currentUser = JSON.parse(localStorage.getItem('user') || '{}');
      const messageIds = Array.from(this.state.selectedMessages);
      const data = await ChatAPI.createTopic(
        title,
        this.elements.topicDesc?.value.trim(),
        currentUser.id,
        messageIds
      );

      if (data.success) {
        alert('话题创建成功！');
        this.closeTopicModal();
        this.exitSelectionMode();
        this.elements.topicTitle.value = '';
        this.elements.topicDesc.value = '';
      } else {
        alert('创建失败: ' + (data.error || '未知错误'));
      }
    } catch (e) {
      alert('创建失败: ' + e.message);
    }
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
            <button onclick="ChatUI.saveAgentSettings()" class="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700">💾 保存</button>
            <button onclick="ChatUI.closeAgentSettings()" class="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300">取消</button>
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

  // ==================== @提及功能 ====================

  handleMentionInput() {
    const el = this.elements.messageInput;
    const value = el.value;
    const cursorPos = el.selectionStart;

    const textBeforeCursor = value.substring(0, cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');

    if (lastAtIndex !== -1) {
      const textAfterAt = textBeforeCursor.substring(lastAtIndex + 1);
      if (!textAfterAt.includes(' ')) {
        this.state.mentionStartIndex = lastAtIndex;
        const searchText = textAfterAt.toLowerCase();
        this.showMentionSuggestions(searchText);
        return;
      }
    }

    this.hideMentionDropdown();
  },

  showMentionSuggestions(searchText) {
    const agents = ChatRender.agents;
    const filteredAgents = agents.filter(agent =>
      agent.status === 'online' &&
      agent.name.toLowerCase().includes(searchText)
    );

    if (filteredAgents.length === 0) {
      this.hideMentionDropdown();
      return;
    }

    const dropdown = this.elements.mentionDropdown;
    dropdown.innerHTML = filteredAgents.map((agent, index) => `
      <div class="mention-item px-4 py-2 hover:bg-purple-50 cursor-pointer flex items-center space-x-2 ${index === 0 ? 'bg-purple-50' : ''}"
           data-agent-name="${ChatUtils.escapeHtml(agent.name)}">
        <span class="text-purple-600">🤖</span>
        <span>${this.highlightMatch(agent.name, searchText)}</span>
      </div>
    `).join('');

    dropdown.classList.remove('hidden');
    this.state.showMentionDropdown = true;

    dropdown.querySelectorAll('.mention-item').forEach(item => {
      item.addEventListener('click', () => {
        this.insertMention(item.dataset.agentName);
      });
    });
  },

  highlightMatch(name, search) {
    if (!search) return ChatUtils.escapeHtml(name);
    const escapedName = ChatUtils.escapeHtml(name);
    const escapedSearch = ChatUtils.escapeHtml(search);
    const regex = new RegExp(`(${escapedSearch})`, 'gi');
    return escapedName.replace(regex, '<span class="text-purple-600 font-semibold">$1</span>');
  },

  insertMention(agentName) {
    const el = this.elements.messageInput;
    const value = el.value;
    const beforeMention = value.substring(0, this.state.mentionStartIndex);
    const afterCursor = value.substring(el.selectionStart);

    el.value = beforeMention + '@' + agentName + ' ' + afterCursor;
    el.focus();

    const newPos = beforeMention.length + agentName.length + 2;
    el.setSelectionRange(newPos, newPos);

    this.hideMentionDropdown();
  },

  selectFirstMention() {
    const firstItem = this.elements.mentionDropdown?.querySelector('.mention-item');
    if (firstItem) {
      this.insertMention(firstItem.dataset.agentName);
    }
  },

  hideMentionDropdown() {
    this.elements.mentionDropdown?.classList.add('hidden');
    this.state.showMentionDropdown = false;
  },

  handleMentionKeydown(e) {
    if (!this.state.showMentionDropdown) return;

    const items = this.elements.mentionDropdown?.querySelectorAll('.mention-item');
    if (!items || items.length === 0) return;

    const currentIndex = Array.from(items).findIndex(item => item.classList.contains('bg-purple-50'));

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIndex = (currentIndex + 1) % items.length;
      items[currentIndex]?.classList.remove('bg-purple-50');
      items[nextIndex]?.classList.add('bg-purple-50');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prevIndex = (currentIndex - 1 + items.length) % items.length;
      items[currentIndex]?.classList.remove('bg-purple-50');
      items[prevIndex]?.classList.add('bg-purple-50');
    } else if (e.key === 'Tab' || e.key === 'Enter') {
      e.preventDefault();
      const selectedItem = this.elements.mentionDropdown?.querySelector('.mention-item.bg-purple-50');
      if (selectedItem) {
        this.insertMention(selectedItem.dataset.agentName);
      }
    } else if (e.key === 'Escape') {
      this.hideMentionDropdown();
    }
  }
};

window.ChatUI = ChatUI;
