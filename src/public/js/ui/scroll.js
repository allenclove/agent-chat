/**
 * 滚动模块 - 处理消息区域滚动和新消息提示
 * 支持：记住最后阅读位置、新消息提示
 */

const ScrollModule = {
  // 状态
  state: {
    unreadCount: 0,
    isAtBottom: true,
    forceScrollToBottom: false,
    lastReadMessageId: null,      // 用户最后阅读的消息ID
    latestMessageId: null,        // 服务器最新消息ID
    initialized: false            // 是否已完成初始化
  },

  // DOM 元素
  elements: {
    messageContainer: null,
    newMessageBtn: null,
    newMessageBtnWrapper: null,
    pinnedMessageContainer: null
  },

  // 存储 key
  STORAGE_KEY: 'chat_last_read_position',

  // 初始化
  init(messageContainer, newMessageBtn, newMessageBtnWrapper, pinnedMessageContainer) {
    this.elements.messageContainer = messageContainer;
    this.elements.newMessageBtn = newMessageBtn;
    this.elements.newMessageBtnWrapper = newMessageBtnWrapper;
    this.elements.pinnedMessageContainer = pinnedMessageContainer;

    // 加载保存的最后阅读位置
    this.loadLastReadPosition();

    // 滚动监听
    this.elements.messageContainer?.addEventListener('scroll', () => this.handleScroll());

    // 新消息按钮点击
    this.elements.newMessageBtn?.addEventListener('click', () => {
      this.scrollToBottom();
    });

    // 页面关闭前保存阅读位置
    window.addEventListener('beforeunload', () => this.saveLastReadPosition());

    // 页面隐藏时也保存（移动端切换应用）
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        this.saveLastReadPosition();
      }
    });
  },

  // ==================== 阅读位置管理 ====================

  // 加载保存的最后阅读位置
  loadLastReadPosition() {
    try {
      const saved = localStorage.getItem(this.STORAGE_KEY);
      if (saved) {
        const data = JSON.parse(saved);
        this.state.lastReadMessageId = data.lastReadMessageId;
      }
    } catch (e) {
      console.error('加载阅读位置失败:', e);
    }
  },

  // 保存最后阅读位置
  saveLastReadPosition() {
    try {
      const currentReadId = this.getCurrentVisibleMessageId();
      if (currentReadId) {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify({
          lastReadMessageId: currentReadId,
          savedAt: Date.now()
        }));
      }
    } catch (e) {
      console.error('保存阅读位置失败:', e);
    }
  },

  // 获取当前可见区域最后一条消息的ID
  getCurrentVisibleMessageId() {
    const container = this.elements.messageContainer;
    if (!container) return null;

    const messages = container.querySelectorAll('[data-msg-id]');
    const containerRect = container.getBoundingClientRect();

    // 找到当前可见的最后一条消息
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      const rect = msg.getBoundingClientRect();
      // 消息在可见区域内
      if (rect.top < containerRect.bottom && rect.bottom > containerRect.top) {
        return msg.dataset.msgId;
      }
    }
    return null;
  },

  // 历史消息加载完成时调用
  onHistoryLoaded(messages) {
    if (!messages || messages.length === 0) return;

    // 记录最新消息ID
    const latestMsg = messages[messages.length - 1];
    this.state.latestMessageId = latestMsg.id;

    // 检查是否有新消息（与上次阅读位置比较）
    if (this.state.lastReadMessageId && !this.state.initialized) {
      const lastReadIndex = messages.findIndex(m => String(m.id) === String(this.state.lastReadMessageId));

      if (lastReadIndex !== -1 && lastReadIndex < messages.length - 1) {
        // 有新消息
        this.state.unreadCount = messages.length - 1 - lastReadIndex;

        // 定位到上次阅读位置
        this.scrollToMessage(this.state.lastReadMessageId);

        // 显示新消息按钮
        setTimeout(() => this.updateNewMessageButton(), 100);
      } else {
        // 没有新消息，直接滚动到底部
        this.scrollToBottomImmediate();
      }
    } else {
      // 首次使用或没有保存位置，滚动到底部
      this.scrollToBottomImmediate();
    }

    this.state.initialized = true;
  },

  // 滚动到指定消息
  scrollToMessage(msgId) {
    const container = this.elements.messageContainer;
    if (!container) return;

    const targetMsg = container.querySelector(`[data-msg-id="${msgId}"]`);
    if (targetMsg) {
      targetMsg.scrollIntoView({ behavior: 'auto', block: 'start' });
      // 高亮效果
      targetMsg.classList.add('message-highlight');
      setTimeout(() => targetMsg.classList.remove('message-highlight'), 2000);
    }
  },

  // ==================== 滚动处理 ====================

  // 检查是否在底部
  checkIsAtBottom() {
    const el = this.elements.messageContainer;
    if (!el) return true;
    const { scrollTop, scrollHeight, clientHeight } = el;
    return scrollTop + clientHeight >= scrollHeight - 100;
  },

  // 滚动到底部
  scrollToBottom() {
    const el = this.elements.messageContainer;
    if (el) {
      el.scrollTo({
        top: el.scrollHeight,
        behavior: 'smooth'
      });
      // 清除未读计数
      this.state.unreadCount = 0;
      this.state.isAtBottom = true;
      this.updateNewMessageButton();
      // 更新最后阅读位置为最新
      this.state.lastReadMessageId = this.state.latestMessageId;
    }
  },

  // 立即滚动到底部（无动画）
  scrollToBottomImmediate() {
    const el = this.elements.messageContainer;
    if (el) {
      el.scrollTop = el.scrollHeight;
      this.state.isAtBottom = true;
      this.state.unreadCount = 0;
      this.updateNewMessageButton();
      // 更新最后阅读位置为最新
      this.state.lastReadMessageId = this.state.latestMessageId;
    }
  },

  // 处理滚动事件
  handleScroll() {
    this.state.isAtBottom = this.checkIsAtBottom();

    // 如果滚动到底部，清除未读计数
    if (this.state.isAtBottom && this.state.unreadCount > 0) {
      this.state.unreadCount = 0;
      this.state.lastReadMessageId = this.state.latestMessageId;
      this.updateNewMessageButton();
    }
  },

  // 新消息时调用
  onNewMessage(msg) {
    // 更新最新消息ID
    if (msg && msg.id) {
      this.state.latestMessageId = msg.id;
    }

    if (this.state.isAtBottom || this.state.forceScrollToBottom) {
      this.state.forceScrollToBottom = false;
      this.scrollToBottomImmediate();
    } else {
      this.state.unreadCount++;
      this.updateNewMessageButton();
    }
  },

  // 更新新消息按钮
  updateNewMessageButton() {
    const wrapper = this.elements.newMessageBtnWrapper;
    if (!wrapper) return;

    const countEl = document.getElementById('newMessageCount');
    if (this.state.unreadCount > 0) {
      if (countEl) countEl.textContent = this.state.unreadCount;

      // 根据置顶消息是否显示调整按钮位置
      const pinnedContainer = this.elements.pinnedMessageContainer;
      const isPinnedVisible = pinnedContainer && !pinnedContainer.classList.contains('hidden');
      if (isPinnedVisible) {
        wrapper.style.top = `${pinnedContainer.offsetHeight + 8}px`;
      } else {
        wrapper.style.top = '8px';
      }

      wrapper.classList.remove('hidden');
    } else {
      wrapper.classList.add('hidden');
    }
  },

  // 发送消息后重置状态
  onSendMessage() {
    this.state.isAtBottom = true;
    this.state.unreadCount = 0;
    this.state.forceScrollToBottom = true;
    this.updateNewMessageButton();
    this.scrollToBottomImmediate();
  }
};

window.ScrollModule = ScrollModule;
