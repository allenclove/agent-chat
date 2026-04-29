/**
 * 场景管理模块
 * 场景 = 聊天室运行模式（自由发言/头脑风暴/故事接龙/闲聊...）
 * 替代旧的 capability_packs + scene_states
 */

const db = require('./database');

// 配置
const CONFIG = {
  scene_max_duration_min: 60,
  auto_expire: true
};

/**
 * 检测消息是否触发场景关键词
 * @param {string} content - 消息内容
 * @returns {Object|null} 匹配的场景
 */
function detectTrigger(content) {
  if (!content || typeof content !== 'string') return null;
  const scenes = db.getEnabledScenes();
  for (const scene of scenes) {
    if (!scene.auto_activate || !scene.trigger_keywords) continue;
    const keywords = Array.isArray(scene.trigger_keywords) ? scene.trigger_keywords : [];
    for (const kw of keywords) {
      if (content.includes(kw)) {
        return scene;
      }
    }
  }
  return null;
}

/**
 * 激活场景
 * @param {string} sceneId - 场景ID
 * @param {string} activatedBy - 激活者
 * @param {Array} participants - 参与者名称列表
 * @returns {Object} 激活后的场景
 */
function activateScene(sceneId, activatedBy, participants = []) {
  const scene = db.getSceneById(sceneId);
  if (!scene) throw new Error(`场景 ${sceneId} 不存在`);
  if (!scene.enabled) throw new Error(`场景 ${sceneId} 已禁用`);

  const updated = db.activateScene(sceneId, activatedBy, participants);
  console.log(`[Scene] 场景激活: ${updated.name} (${sceneId}) by ${activatedBy}`);
  return updated;
}

/**
 * 结束场景
 * @param {string} sceneId - 场景ID
 */
function deactivateScene(sceneId) {
  db.deactivateScene(sceneId);
  console.log(`[Scene] 场景已结束: ${sceneId}`);
}

/**
 * 获取当前活跃场景
 * @returns {Object|null}
 */
function getActiveScene() {
  return db.getActiveScene();
}

/**
 * 获取可用场景列表
 * @param {boolean} enabledOnly
 * @returns {Array}
 */
function getAvailableScenes(enabledOnly = true) {
  const scenes = enabledOnly ? db.getEnabledScenes() : db.getAllScenes();
  return scenes.map(s => ({
    id: s.id, name: s.name, description: s.description,
    icon: s.icon || '📦',
    trigger_keywords: s.trigger_keywords || [],
    skills: s.skills || [],
    auto_activate: !!s.auto_activate,
    is_active: !!s.is_active,
    activated_at: s.activated_at,
    activated_by: s.activated_by,
    participants: s.participants || []
  }));
}

/**
 * 注入场景上下文到消息（转发给Agent时调用）
 * @param {Object} message
 * @param {string} agentId
 * @returns {Object} 场景上下文
 */
function getSceneContext(agentId) {
  const active = db.getActiveScene();
  if (!active) return null;

  return {
    scene_id: active.id,
    scene_name: active.name,
    scene_icon: active.icon || '📦',
    scene_mode: active.context_prompt,
    skills: active.skills || [],
    participants: active.participants || [],
    activated_at: active.activated_at
  };
}

/**
 * 创建场景
 */
function createScene(data) {
  if (!data.id || !data.name || !data.context_prompt) {
    throw new Error('id、name 和 context_prompt 必填');
  }
  return db.createScene(data);
}

/**
 * 更新场景
 */
function updateScene(id, updates) {
  return db.updateScene(id, updates);
}

/**
 * 删除场景
 */
function deleteScene(id) {
  db.deleteScene(id);
}

module.exports = {
  detectTrigger,
  activateScene,
  deactivateScene,
  getActiveScene,
  getAvailableScenes,
  getSceneContext,
  createScene,
  updateScene,
  deleteScene,
  CONFIG
};
