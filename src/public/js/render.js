/**
 * 渲染模块 - 消息渲染、Markdown渲染
 */

const ChatRender = {
  md: null,
  agents: [],

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
  }
};

window.ChatRender = ChatRender;
