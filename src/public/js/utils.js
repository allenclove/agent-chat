/**
 * 工具函数模块
 */

// HTML 转义
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// 降级复制方案（兼容旧浏览器）
function fallbackCopy(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand('copy');
    showToast('已复制');
  } catch (e) {
    showToast('复制失败');
  }
  document.body.removeChild(textarea);
}

// Toast 提示
function showToast(message) {
  // 移除已有的toast
  const existingToast = document.querySelector('.toast-message');
  if (existingToast) existingToast.remove();

  const toast = document.createElement('div');
  toast.className = 'toast-message';
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 2000);
}

// 导出模块
window.ChatUtils = {
  escapeHtml,
  fallbackCopy,
  showToast
};
