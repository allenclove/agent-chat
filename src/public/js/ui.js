/**
 * UI 入口模块 - 组合各子模块
 *
 * 模块拆分说明：
 * - scroll.js - 滚动和新消息提示
 * - selection.js - 消息选择和话题创建
 * - modals.js - Agent设置和显示设置弹窗
 * - mention.js - @提及下拉菜单
 *
 * 修改指南：
 * - 修改滚动行为 → ui/scroll.js
 * - 修改选择模式 → ui/selection.js
 * - 修改弹窗 → ui/modals.js
 * - 修改@提及 → ui/mention.js
 */

const ChatUI = {
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
      agentSettingsModal: document.getElementById('agentSettingsModal'),
      settingsBtn: document.getElementById('settingsBtn'),
      displaySettingsModal: document.getElementById('displaySettingsModal'),
      pinLastHumanMsgCheckbox: document.getElementById('pinLastHumanMsg'),
      pinnedMessageContainer: document.getElementById('pinnedMessageContainer'),
      pinnedMessageContent: document.getElementById('pinnedMessageContent'),
      newMessageBtnWrapper: document.getElementById('newMessageBtnWrapper')
    };

    // 初始化子模块
    ScrollModule.init(
      this.elements.messageContainer,
      this.elements.newMessageBtn,
      this.elements.newMessageBtnWrapper,
      this.elements.pinnedMessageContainer
    );

    SelectionModule.init(
      this.elements.selectionToolbar,
      this.elements.selectionCount,
      this.elements.selectModeBtn,
      this.elements.topicModal,
      this.elements.topicTitle,
      this.elements.topicDesc,
      this.elements.selectedCountEl,
      this.elements.messageContainer
    );

    ModalsModule.init(
      this.elements.agentSettingsModal,
      this.elements.displaySettingsModal,
      this.elements.settingsBtn,
      this.elements.pinLastHumanMsgCheckbox,
      this.elements.pinnedMessageContainer,
      this.elements.pinnedMessageContent
    );

    MentionModule.init(
      this.elements.messageInput,
      this.elements.mentionDropdown
    );
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
      MentionModule.hideMentionDropdown();

      // 通知滚动模块
      ScrollModule.onSendMessage();
    });

    // 回车发送
    el.messageInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        if (MentionModule.isShowingDropdown()) {
          e.preventDefault();
          MentionModule.selectFirstMention();
        } else {
          e.preventDefault();
          el.messageForm.dispatchEvent(new Event('submit'));
        }
      }
    });
  },

  // ==================== 代理方法（保持向后兼容） ====================

  // 滚动相关
  checkIsAtBottom() {
    return ScrollModule.checkIsAtBottom();
  },
  scrollToBottom() {
    return ScrollModule.scrollToBottom();
  },
  handleScroll() {
    return ScrollModule.handleScroll();
  },
  updateNewMessageButton() {
    return ScrollModule.updateNewMessageButton();
  },

  // 选择模式相关
  toggleSelectionMode() {
    return SelectionModule.toggleSelectionMode();
  },
  exitSelectionMode() {
    return SelectionModule.exitSelectionMode();
  },
  toggleMessageSelection(msgId, element) {
    return SelectionModule.toggleMessageSelection(msgId, element);
  },
  updateSelectionCount() {
    return SelectionModule.updateSelectionCount();
  },

  // 话题相关
  openTopicModal() {
    return SelectionModule.openTopicModal();
  },
  closeTopicModal() {
    return SelectionModule.closeTopicModal();
  },
  createTopic() {
    return SelectionModule.createTopic();
  },

  // Agent 设置相关
  openAgentSettings(agentId) {
    return ModalsModule.openAgentSettings(agentId);
  },
  closeAgentSettings() {
    return ModalsModule.closeAgentSettings();
  },
  saveAgentSettings() {
    return ModalsModule.saveAgentSettings();
  },

  // 显示设置相关
  openDisplaySettings() {
    return ModalsModule.openDisplaySettings();
  },
  closeDisplaySettings() {
    return ModalsModule.closeDisplaySettings();
  },
  loadDisplaySettings() {
    return ModalsModule.loadDisplaySettings();
  },
  saveDisplaySettings() {
    return ModalsModule.saveDisplaySettings();
  },

  // 置顶消息相关
  setLastHumanMessage(msg) {
    return ModalsModule.setLastHumanMessage(msg);
  },
  hidePinnedMessage() {
    return ModalsModule.hidePinnedMessage();
  },
  updatePinnedMessage() {
    return ModalsModule.updatePinnedMessage();
  },

  // @提及相关
  handleMentionInput() {
    return MentionModule.handleMentionInput();
  },
  showMentionSuggestions(searchText) {
    return MentionModule.showMentionSuggestions(searchText);
  },
  highlightMatch(name, search) {
    return MentionModule.highlightMatch(name, search);
  },
  insertMention(agentName) {
    return MentionModule.insertMention(agentName);
  },
  selectFirstMention() {
    return MentionModule.selectFirstMention();
  },
  hideMentionDropdown() {
    return MentionModule.hideMentionDropdown();
  },
  handleMentionKeydown(e) {
    return MentionModule.handleMentionKeydown(e);
  }
};

window.ChatUI = ChatUI;
