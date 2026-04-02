/**
 * 能力包管理模块
 * 管理场景能力包的定义、激活和状态
 */

const db = require('./database');
const { v4: uuidv4 } = require('uuid');

// 配置
const CONFIG = {
  scene_max_duration_min: 30,
  auto_expire: true
};

// 活跃场景缓存
const activeScenes = new Map();

/**
 * 获取所有可用能力包
 * @param {boolean} enabledOnly - 是否只返回启用的
 * @returns {Array} 能力包列表
 */
function getAvailablePacks(enabledOnly = true) {
  const packs = enabledOnly ? db.getActivePacks() : db.getAllPacks();
  return packs.map(pack => ({
    id: pack.id,
    name: pack.name,
    goal: pack.goal,
    skills: pack.skills || [],
    trigger_keywords: pack.trigger_keywords || []
  }));
}

/**
 * 获取能力包详情
 * @param {string} packId - 能力包ID
 * @returns {Object|null} 能力包详情
 */
function getPackDetail(packId) {
  const pack = db.getPackById(packId);
  if (!pack) return null;

  return {
    id: pack.id,
    name: pack.name,
    goal: pack.goal,
    skills: pack.skills || [],
    state_fields: pack.state_fields || {},
    trigger_keywords: pack.trigger_keywords || [],
    core_rules: pack.core_rules || [],
    version: pack.version
  };
}

/**
 * 检测触发关键词
 * @param {string} content - 消息内容
 * @returns {Object|null} 匹配的能力包
 */
function detectTrigger(content) {
  if (!content || typeof content !== 'string') return null;

  const packs = db.getActivePacks();
  for (const pack of packs) {
    const keywords = pack.trigger_keywords || [];
    for (const keyword of keywords) {
      if (content.includes(keyword)) {
        return pack;
      }
    }
  }
  return null;
}

/**
 * 激活场景
 * @param {string} packId - 能力包ID
 * @param {Array} participants - 参与者 ID 列表
 * @param {Object} initialContext - 初始上下文
 * @returns {Object} 激活的场景
 */
function activateScene(packId, participants = [], initialContext = {}) {
  const pack = db.getPackById(packId);
  if (!pack) {
    throw new Error(`能力包 ${packId} 不存在`);
  }
  if (!pack.enabled) {
    throw new Error(`能力包 ${packId} 已禁用`);
  }

  // 生成场景 ID
  const sceneId = `scene-${uuidv4().substring(0, 8)}`;

  // 初始化状态
  const stateData = {
    ...pack.state_fields,
    ...initialContext,
    _activatedAt: new Date().toISOString()
  };

  // 创建场景状态
  const scene = db.createSceneState({
    scene_id: sceneId,
    pack_id: packId,
    participants,
    state_data: stateData
  });

  // 缓存到内存
  activeScenes.set(sceneId, {
    ...scene,
    pack
  });

  console.log(`[Packs] 场景已激活: ${sceneId} (${pack.name})`);

  return {
    scene_id: sceneId,
    pack_id: packId,
    pack_name: pack.name,
    participants,
    state: stateData
  };
}

/**
 * 获取场景状态
 * @param {string} sceneId - 场景ID
 * @returns {Object|null} 场景状态
 */
function getSceneState(sceneId) {
  // 先从缓存获取
  if (activeScenes.has(sceneId)) {
    return activeScenes.get(sceneId);
  }

  // 从数据库获取
  const scene = db.getActiveScene(sceneId);
  if (scene) {
    const pack = db.getPackById(scene.pack_id);
    activeScenes.set(sceneId, { ...scene, pack });
  }
  return scene;
}

/**
 * 更新场景状态
 * @param {string} sceneId - 场景ID
 * @param {Object} updates - 状态更新
 * @returns {Object} 更新后的状态
 */
function updateSceneState(sceneId, updates) {
  const scene = db.getActiveScene(sceneId);
  if (!scene) {
    throw new Error(`场景 ${sceneId} 不存在或已结束`);
  }

  const newState = {
    ...scene.state_data,
    ...updates,
    _updatedAt: new Date().toISOString()
  };

  const updated = db.updateSceneState(sceneId, { state_data: newState });

  // 更新缓存
  if (activeScenes.has(sceneId)) {
    const cached = activeScenes.get(sceneId);
    activeScenes.set(sceneId, { ...cached, state_data: newState });
  }

  return updated;
}

/**
 * 结束场景
 * @param {string} sceneId - 场景ID
 * @param {string} reason - 结束原因
 */
function endScene(sceneId, reason = 'completed') {
  const scene = db.getActiveScene(sceneId);
  if (!scene) {
    console.warn(`[Packs] 场景 ${sceneId} 不存在或已结束`);
    return;
  }

  db.endScene(sceneId);
  activeScenes.delete(sceneId);

  console.log(`[Packs] 场景已结束: ${sceneId} (${reason})`);
}

/**
 * 获取所有活跃场景
 * @returns {Array} 活跃场景列表
 */
function getActiveScenes() {
  const scenes = db.getActiveScenes();
  return scenes.map(scene => {
    const pack = db.getPackById(scene.pack_id);
    return {
      scene_id: scene.scene_id,
      pack_id: scene.pack_id,
      pack_name: pack?.name || '未知',
      participants: scene.participants || [],
      status: scene.status,
      created_at: scene.created_at
    };
  });
}

/**
 * 检查 Agent 是否在某个场景中
 * @param {string} agentId - Agent ID
 * @returns {Object|null} 场景信息
 */
function getAgentActiveScene(agentId) {
  const scenes = db.getActiveScenes();
  for (const scene of scenes) {
    const participants = scene.participants || [];
    if (participants.includes(agentId)) {
      const pack = db.getPackById(scene.pack_id);
      return {
        scene_id: scene.scene_id,
        pack_id: scene.pack_id,
        pack_name: pack?.name,
        role: 'participant',
        state: scene.state_data
      };
    }
  }
  return null;
}

/**
 * 清理过期场景
 */
function cleanupExpiredScenes() {
  const scenes = db.getActiveScenes();
  const now = Date.now();

  for (const scene of scenes) {
    const expiresAt = scene.expires_at ? new Date(scene.expires_at).getTime() : null;
    if (expiresAt && now > expiresAt) {
      endScene(scene.scene_id, 'expired');
    }
  }
}

/**
 * 创建能力包
 * @param {Object} pack - 能力包定义
 * @returns {Object} 创建的能力包
 */
function createPack(pack) {
  if (!pack.id || !pack.name) {
    throw new Error('能力包 id 和 name 必填');
  }

  const existing = db.getPackById(pack.id);
  if (existing) {
    throw new Error(`能力包 ${pack.id} 已存在`);
  }

  return db.createPack(pack);
}

/**
 * 更新能力包
 * @param {string} packId - 能力包ID
 * @param {Object} updates - 更新内容
 * @returns {Object} 更新后的能力包
 */
function updatePack(packId, updates) {
  const existing = db.getPackById(packId);
  if (!existing) {
    throw new Error(`能力包 ${packId} 不存在`);
  }

  return db.updatePack(packId, updates);
}

/**
 * 删除能力包
 * @param {string} packId - 能力包ID
 */
function deletePack(packId) {
  const existing = db.getPackById(packId);
  if (!existing) {
    throw new Error(`能力包 ${packId} 不存在`);
  }

  // 检查是否有活跃场景
  const scenes = db.getActiveScenes();
  const hasActiveScene = scenes.some(s => s.pack_id === packId);
  if (hasActiveScene) {
    throw new Error(`能力包 ${packId} 有活跃场景，无法删除`);
  }

  db.deletePack(packId);
}

// 定期清理过期场景
setInterval(cleanupExpiredScenes, 60000); // 每分钟检查一次

module.exports = {
  getAvailablePacks,
  getPackDetail,
  detectTrigger,
  activateScene,
  getSceneState,
  updateSceneState,
  endScene,
  getActiveScenes,
  getAgentActiveScene,
  cleanupExpiredScenes,
  createPack,
  updatePack,
  deletePack,
  CONFIG
};