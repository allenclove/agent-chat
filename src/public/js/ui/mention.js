/**
 * @提及模块 - 处理输入框中的 @提及 下拉菜单
 */

const MentionModule = {
  // 状态
  state: {
    mentionStartIndex: -1,
    showMentionDropdown: false
  },

  // DOM 元素
  elements: {
    messageInput: null,
    mentionDropdown: null
  },

  // Agent 列表引用（由外部设置）
  agents: [],

  // 初始化
  init(messageInput, mentionDropdown) {
    this.elements.messageInput = messageInput;
    this.elements.mentionDropdown = mentionDropdown;

    // @提及输入监听
    this.elements.messageInput?.addEventListener('input', () => this.handleMentionInput());

    // 方向键导航@提及列表
    this.elements.messageInput?.addEventListener('keydown', (e) => this.handleMentionKeydown(e));

    // 点击其他地方关闭下拉菜单
    document.addEventListener('click', (e) => {
      if (!this.elements.messageInput?.contains(e.target) && !this.elements.mentionDropdown?.contains(e.target)) {
        this.hideMentionDropdown();
      }
    });
  },

  // 设置 Agent 列表
  setAgents(agents) {
    this.agents = agents;
  },

  // 处理 @ 输入
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

  // 显示提及建议
  showMentionSuggestions(searchText) {
    const filteredAgents = this.agents.filter(agent =>
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

  // 高亮匹配文字
  highlightMatch(name, search) {
    if (!search) return ChatUtils.escapeHtml(name);
    const escapedName = ChatUtils.escapeHtml(name);
    const escapedSearch = ChatUtils.escapeHtml(search);
    const regex = new RegExp(`(${escapedSearch})`, 'gi');
    return escapedName.replace(regex, '<span class="text-purple-600 font-semibold">$1</span>');
  },

  // 插入提及
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

  // 选择第一个提及
  selectFirstMention() {
    const firstItem = this.elements.mentionDropdown?.querySelector('.mention-item');
    if (firstItem) {
      this.insertMention(firstItem.dataset.agentName);
    }
  },

  // 隐藏下拉菜单
  hideMentionDropdown() {
    this.elements.mentionDropdown?.classList.add('hidden');
    this.state.showMentionDropdown = false;
  },

  // 处理键盘导航
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
  },

  // 是否显示下拉菜单
  isShowingDropdown() {
    return this.state.showMentionDropdown;
  }
};

window.MentionModule = MentionModule;
