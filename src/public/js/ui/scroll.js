/**
 * 滚动模块 - 处理消息区域滚动和新消息提示
 */

const ScrollModule = {
  // 状态
  state: {
    unreadCount: 0,
    isAtBottom: true,
    forceScrollToBottom: false
  },

  // DOM 元素
  elements: {
    messageContainer: null,
    newMessageBtn: null,
    newMessageBtnWrapper: null,
    pinnedMessageContainer: null
  },

  // 初始化
  init(messageContainer, newMessageBtn, newMessageBtnWrapper, pinnedMessageContainer) {
    this.elements.messageContainer = messageContainer;
    this.elements.newMessageBtn = newMessageBtn;
    this.elements.newMessageBtnWrapper = newMessageBtnWrapper;
    this.elements.pinnedMessageContainer = pinnedMessageContainer;

    // 滚动监听
    this.elements.messageContainer?.addEventListener('scroll', () => this.handleScroll());

    // 新消息按钮
    this.elements.newMessageBtn?.addEventListener('click', () => {
      this.scrollToBottom();
      this.state.unreadCount = 0;
      this.updateNewMessageButton();
    });
  },

  // 检查是否在底部
  checkIsAtBottom() {
    const el = this.elements.messageContainer;
    if (!el) return true;
    const { scrollTop, scrollHeight, clientHeight } = el;
    // 增大阈值到 250px，更容易触发自动滚动
    return scrollTop + clientHeight >= scrollHeight - 250;
  },

  // 滚动到底部
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

  // 立即滚动到底部（无动画）
  scrollToBottomImmediate() {
    const el = this.elements.messageContainer;
    if (el) {
      el.scrollTop = el.scrollHeight;
      this.state.isAtBottom = true;
      this.state.unreadCount = 0;
      this.updateNewMessageButton();
    }
  },

  // 处理滚动事件
  handleScroll() {
    const wasAtBottom = this.state.isAtBottom;
    this.state.isAtBottom = this.checkIsAtBottom();

    // 如果滚动到底部，清除未读计数
    if (this.state.isAtBottom && this.state.unreadCount > 0) {
      this.state.unreadCount = 0;
      this.updateNewMessageButton();
    }
  },

  // 新消息时调用
  onNewMessage(isHumanMessage = false) {
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
