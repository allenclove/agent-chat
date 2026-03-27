/**
 * 选择模式模块 - 处理消息选择和话题创建
 */

const SelectionModule = {
  // 状态
  state: {
    selectionMode: false,
    selectedMessages: new Set()
  },

  // DOM 元素
  elements: {
    selectionToolbar: null,
    selectionCount: null,
    selectModeBtn: null,
    topicModal: null,
    topicTitle: null,
    topicDesc: null,
    selectedCountEl: null,
    messageContainer: null
  },

  // 初始化
  init(selectionToolbar, selectionCount, selectModeBtn, topicModal, topicTitle, topicDesc, selectedCountEl, messageContainer) {
    this.elements.selectionToolbar = selectionToolbar;
    this.elements.selectionCount = selectionCount;
    this.elements.selectModeBtn = selectModeBtn;
    this.elements.topicModal = topicModal;
    this.elements.topicTitle = topicTitle;
    this.elements.topicDesc = topicDesc;
    this.elements.selectedCountEl = selectedCountEl;
    this.elements.messageContainer = messageContainer;

    // 选择模式按钮
    this.elements.selectModeBtn?.addEventListener('click', () => this.toggleSelectionMode());

    // 话题相关
    document.getElementById('saveAsTopicBtn')?.addEventListener('click', () => this.openTopicModal());
    document.getElementById('cancelSelectionBtn')?.addEventListener('click', () => this.exitSelectionMode());
    document.getElementById('cancelTopicBtn')?.addEventListener('click', () => this.closeTopicModal());
    document.getElementById('createTopicBtn')?.addEventListener('click', () => this.createTopic());

    this.elements.topicModal?.addEventListener('click', (e) => {
      if (e.target === this.elements.topicModal) this.closeTopicModal();
    });
  },

  // 切换选择模式
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

  // 退出选择模式
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

  // 切换消息选择
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

  // 更新选择计数
  updateSelectionCount() {
    const count = this.state.selectedMessages.size;
    this.elements.selectionCount.textContent = count;
    if (count === 0) {
      this.elements.selectionToolbar?.classList.add('hidden');
    } else {
      this.elements.selectionToolbar?.classList.remove('hidden');
    }
  },

  // 打开话题弹窗
  openTopicModal() {
    if (this.state.selectedMessages.size === 0) return;
    this.elements.selectedCountEl.textContent = this.state.selectedMessages.size;
    this.elements.topicModal?.classList.remove('hidden');
  },

  // 关闭话题弹窗
  closeTopicModal() {
    this.elements.topicModal?.classList.add('hidden');
  },

  // 创建话题
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

  // 是否在选择模式
  isInSelectionMode() {
    return this.state.selectionMode;
  },

  // 获取选中的消息
  getSelectedMessages() {
    return this.state.selectedMessages;
  }
};

window.SelectionModule = SelectionModule;
