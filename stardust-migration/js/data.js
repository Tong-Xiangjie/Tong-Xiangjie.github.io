/**
 * data.js —— 静态配置表
 *
 * 这里只放"不随存档变化"的静态数据：物品、区域、任务、事件、建筑、成就、进化分支。
 * 存档里只保存 id 与数量，读取时通过索引表还原，避免存档体积膨胀。
 */

export const SAVE_VERSION = 1;
export const GAME_NAME = '星尘迁徙';
export const GAME_NAME_EN = 'Stardust Migration';

/** 稀有度定义（颜色交给 CSS 处理） */
export const RARITY = {
  common: { key: 'common', label: '普通', order: 0 },
  rare: { key: 'rare', label: '稀有', order: 1 },
  epic: { key: 'epic', label: '史诗', order: 2 },
};

/** 物品类型 */
export const ITEM_TYPE_LABEL = {
  currency: '货币',
  material: '材料',
  food: '食物',
  gift: '礼物',
  key: '关键物',
  relic: '遗物',
  blueprint: '配方',
};

/**
 * 物品表（MVP 共 20 种）
 * - use: 可在背包中使用，{ hunger, mood, energy, intimacy } 为恢复量；plus 为特殊说明
 * - gifts: 是否可作为礼物送给星兽
 * - tags: 供成就与配方判断
 */
export const ITEMS = [
  { id: 'stardust', name: '星尘', emoji: '✨', type: 'currency', rarity: 'common', price: 1, desc: '数据海里最基础的微粒，是一切建造与合成的燃料。' },
  { id: 'moss_ball', name: '苔藓团', emoji: '🟢', type: 'food', rarity: 'common', price: 3, desc: '微光浅滩的柔软苔藓，星兽的主食。', use: { hunger: 26 }, tags: ['food', 'basic'] },
  { id: 'crystal_shard', name: '晶体碎片', emoji: '💎', type: 'material', rarity: 'common', price: 6, desc: '凝固的星尘结晶，升级小屋的必需品。' },
  { id: 'shell', name: '潮汐贝壳', emoji: '🐚', type: 'relic', rarity: 'common', price: 8, desc: '贴着耳朵能听到潮汐数据流动的声音。' },
  { id: 'bolt', name: '漂流螺栓', emoji: '🔩', type: 'material', rarity: 'common', price: 5, desc: '来自旧时代浮空器的零件，锈迹里有故事。' },
  { id: 'algae', name: '星藻', emoji: '🌿', type: 'material', rarity: 'common', price: 7, desc: '会缓慢发光的藻类，是料理与药剂的基底。' },
  { id: 'mint_berry', name: '薄荷果', emoji: '🫐', type: 'food', rarity: 'common', price: 6, desc: '咬开是清凉的星尘味，星兽很喜欢。', use: { hunger: 12, mood: 8 }, tags: ['food'] },
  { id: 'glow_moss', name: '发光苔藓', emoji: '🍀', type: 'material', rarity: 'rare', price: 18, desc: '在无光处自行亮起的苔藓，可用于照明与装饰。' },
  { id: 'echo_scale', name: '回声鳞片', emoji: '🐟', type: 'material', rarity: 'rare', price: 20, desc: '会重复播放附近声音的透明鳞片。' },
  { id: 'star_iron', name: '碎星铁', emoji: '🪨', type: 'material', rarity: 'rare', price: 22, desc: '碎星遗迹的金属残骸，沉重而温热。' },
  { id: 'rune_tablet', name: '符文石板', emoji: '🪧', type: 'relic', rarity: 'rare', price: 30, desc: '刻着旧文明符号的石板，学者型星兽会盯着看很久。' },
  { id: 'dream_dust', name: '梦珊瑚粉', emoji: '🪸', type: 'material', rarity: 'rare', price: 26, desc: '安神材料的原料，闻起来像很浅的睡眠。' },
  { id: 'starmap_fragment', name: '星图残页', emoji: '🗺️', type: 'key', rarity: 'rare', price: 40, desc: '记录了另一片海域的坐标，可解锁新的探索区域。' },
  { id: 'star_vein_stone', name: '星脉石', emoji: '🔷', type: 'key', rarity: 'rare', price: 45, desc: '内部有缓慢流动的光脉，是观星台升级的关键。' },
  { id: 'ancient_circuit', name: '古旧电路', emoji: '🧩', type: 'material', rarity: 'epic', price: 55, desc: '仍在微弱运转的旧电路，藏着一段未说完的话。' },
  { id: 'star_crystal_core', name: '星辰晶核', emoji: '💠', type: 'material', rarity: 'epic', price: 70, desc: '高密度星尘凝聚体，是守护体阶段的钥匙。' },
  { id: 'luminous_soup', name: '星辉汤', emoji: '🍲', type: 'food', rarity: 'rare', price: 35, desc: '用发光苔藓熬成的汤，喝下去连影子都会亮一会儿。', use: { hunger: 40, mood: 15, energy: 10 }, tags: ['food', 'cooked'] },
  { id: 'dream_pillow', name: '梦珊瑚枕', emoji: '🛏️', type: 'gift', rarity: 'rare', price: 45, desc: '睡上去会做关于迁徙的梦。', use: { energy: 35 }, gifts: true, tags: ['furniture'] },
  { id: 'starlight_pendant', name: '星光吊坠', emoji: '📿', type: 'gift', rarity: 'epic', price: 90, desc: '把一小片星空封在晶体里，贴身佩戴。', use: { intimacy: 12, mood: 18 }, gifts: true },
  { id: 'starseed', name: '星种', emoji: '🌱', type: 'key', rarity: 'epic', price: 120, desc: '传说中能把荒岛重新长成星港的种子。' },
];

/** id -> 物品 的索引 */
export const ITEM_MAP = Object.fromEntries(ITEMS.map((it) => [it.id, it]));

/** 便捷查询 */
export function getItem(id) {
  return ITEM_MAP[id];
}
export function itemName(id) {
  return ITEM_MAP[id]?.name ?? id;
}
export function itemEmoji(id) {
  return ITEM_MAP[id]?.emoji ?? '❔';
}

/**
 * 探索区域（至少 2 个）
 * - drops: 基础产出，amount 为 [min, max]，随任务时长线性放大
 * - rare: 概率额外掉落
 * - events: 该区域可触发的事件 id
 * - story: 收获时用于报告叙事的碎片
 */
export const ZONES = [
  {
    id: 'shallow',
    name: '微光浅滩',
    emoji: '🌊',
    desc: '数据海最浅的一片水域，浪花里全是细碎星光，适合新手星兽练习呼吸。',
    unlock: null,
    danger: 1,
    drops: [
      { id: 'moss_ball', amount: [1, 3] },
      { id: 'crystal_shard', amount: [1, 2] },
      { id: 'bolt', amount: [0, 2] },
      { id: 'shell', amount: [0, 1] },
    ],
    rare: [
      { id: 'glow_moss', chance: 0.16 },
      { id: 'echo_scale', chance: 0.12 },
      { id: 'algae', chance: 0.22 },
      { id: 'mint_berry', chance: 0.2 },
    ],
    events: ['e01', 'e02', 'e03', 'e04', 'e05', 'e06', 'e10'],
    story: [
      '星兽在浅滩上踩出一串发光的脚印，过了一会儿才慢慢暗下去。',
      '它把脸埋进水里又抬起来，鼻尖挂着一颗不肯掉的小水珠。',
      '浅滩的浪推来一枚贝壳，它听了很久，然后郑重地放进口袋。',
      '它对着自己的倒影练习了三次打招呼，第三次才满意。',
    ],
  },
  {
    id: 'ruins',
    name: '碎星遗迹',
    emoji: '🛕',
    desc: '一片沉在数据海深处的旧文明残骸，金属会记住走过的人。',
    unlock: { item: 'starmap_fragment', building: { id: 'observatory', level: 2 }, hint: '需要「星图残页」，或把观星台升到 2 级' },
    danger: 2,
    drops: [
      { id: 'star_iron', amount: [1, 3] },
      { id: 'bolt', amount: [1, 3] },
      { id: 'rune_tablet', amount: [0, 1] },
      { id: 'crystal_shard', amount: [1, 3] },
    ],
    rare: [
      { id: 'ancient_circuit', chance: 0.14 },
      { id: 'star_vein_stone', chance: 0.12 },
      { id: 'dream_dust', chance: 0.18 },
      { id: 'starmap_fragment', chance: 0.08 },
      { id: 'star_crystal_core', chance: 0.04 },
    ],
    events: ['e03', 'e06', 'e07', 'e08', 'e09', 'e02', 'e05'],
    story: [
      '遗迹的走廊里，星兽的脚步被墙体重复了很多遍才还回来。',
      '它在断墙下发现一台还在待机的旧机器，屏幕只亮着一句「欢迎回来」。',
      '它绕着一根倾斜的柱子转了三圈，像在确认它明天还在不在。',
      '它把爪子按在冰冷的金属上，金属慢慢有了体温。',
    ],
  },
];

export const ZONE_MAP = Object.fromEntries(ZONES.map((z) => [z.id, z]));
export function getZone(id) {
  return ZONE_MAP[id];
}

/**
 * 任务类型（下线前安排的那一件事）
 * - duration: 基础时长（分钟），完成后任务结束
 * - zone: 是否必须选择探索区域
 * - cost: 启动消耗（行动点）
 */
export const TASKS = [
  {
    id: 'gather',
    name: '采集',
    emoji: '🧺',
    desc: '在浅滩或遗迹里收集基础材料，最稳妥的收益。',
    duration: 120,
    cost: 2,
    zone: true,
    gains: [
      { stat: 'perception', amount: 1 },
      { stat: 'agility', amount: 1 },
    ],
    tags: ['explore', 'gather'],
  },
  {
    id: 'explore',
    name: '探险',
    emoji: '🧭',
    desc: '深入未知区域，稀有掉落与随机事件都更多，消耗也更大。',
    duration: 180,
    cost: 3,
    zone: true,
    danger: true,
    gains: [
      { stat: 'agility', amount: 2 },
      { stat: 'perception', amount: 1 },
      { stat: 'physique', amount: 1 },
    ],
    tags: ['explore'],
  },
  {
    id: 'study',
    name: '学习',
    emoji: '📖',
    desc: '在观星台研读残页与石板，稳步提升智慧。',
    duration: 120,
    cost: 2,
    zone: false,
    gains: [
      { stat: 'wisdom', amount: 3 },
      { stat: 'perception', amount: 1 },
    ],
    tags: ['study'],
  },
  {
    id: 'rest',
    name: '休息',
    emoji: '💤',
    desc: '什么都不做，只是睡一觉。恢复精力，但几乎不带回资源。',
    duration: 240,
    cost: 1,
    zone: false,
    gains: [{ stat: 'physique', amount: 1 }],
    tags: ['rest'],
  },
];

export const TASK_MAP = Object.fromEntries(TASKS.map((t) => [t.id, t]));
export function getTask(id) {
  return TASK_MAP[id];
}

/**
 * 随机事件（10 个，均为二选一）
 * check 用于判定该选项在当前状态下是否可用（可选）
 * outcome 可以是函数：({ rng, zone }) => ({ text, items, stats, tendency, flags })
 */
export const EVENTS = [
  {
    id: 'e01',
    name: '发光苔藓',
    emoji: '🍀',
    text: '星兽在礁石背面发现一片会呼吸般明灭的苔藓。它回头看你的方向，等你决定。',
    options: [
      {
        text: '轻轻采下一些',
        outcome: (ctx) => ({
          text: ctx.zoneId === 'ruins'
            ? '它小心地剥下苔藓，顺手把根部的碎铁也捡了回来。'
            : '它用爪子一圈圈绕开根系，只取走最外层的部分。',
          items: [
            { id: 'glow_moss', amount: 1 },
            ...(ctx.rng.chance(0.5) ? [{ id: 'algae', amount: 1 }] : []),
          ],
          stats: { perception: 1 },
          tendency: { care: 1 },
        }),
      },
      {
        text: '坐下来陪它看一会儿',
        outcome: () => ({
          text: '你们看了很久。苔藓的光慢慢暗下去时，它的心情却亮了起来。',
          items: [],
          stats: { wisdom: 1 },
          delta: { mood: 8, energy: 2 },
          tendency: { care: 1 },
        }),
      },
    ],
  },
  {
    id: 'e02',
    name: '潮汐礼物',
    emoji: '🐚',
    text: '退潮后，浅滩上躺着一串回声鳞片，边缘还在重复几分钟前的浪声。',
    options: [
      {
        text: '收进背包',
        outcome: (ctx) => ({
          text: '鳞片一路都在小声说话，星兽偶尔应一句。',
          items: [{ id: 'echo_scale', amount: ctx.rng.int(1, 2) }],
          stats: {},
          tendency: { explore: 1 },
        }),
      },
      {
        text: '留在原处，只做个记号',
        outcome: (ctx) => ({
          text: '它把鳞片摆正，用石头围了个圈。第二天路过时，那里多了三枚。',
          items: ctx.rng.chance(0.55) ? [{ id: 'shell', amount: 2 }] : [],
          stats: { wisdom: 1 },
          delta: { intimacy: 2 },
          tendency: { care: 1 },
        }),
      },
    ],
  },
  {
    id: 'e03',
    name: '数据潮汐',
    emoji: '🌊',
    text: '一阵异常的数据潮汐涌来，海水在瞬间变成了竖着的墙。星兽的毛全竖起来了。',
    options: [
      {
        text: '让它冲过去',
        outcome: (ctx) => ({
          text: ctx.rng.chance(0.65)
            ? '它贴着浪壁穿了过去，回来时爪子里多了一块晶核碎屑。'
            : '它被浪推得翻了个跟头，爬起来先检查背包还在不在。',
          items: ctx.rng.chance(0.65) ? [{ id: 'crystal_shard', amount: 2 }, { id: 'star_iron', amount: 1 }] : [],
          delta: { energy: -12, mood: -4, intimacy: 2 },
          stats: { physique: 2, agility: 1 },
          tendency: { explore: 2 },
        }),
      },
      {
        text: '先退回岸边',
        outcome: () => ({
          text: '它有点不服气，但很听话。你们一起等潮汐退去，顺手捡了些浮上来的东西。',
          items: [{ id: 'moss_ball', amount: 1 }, { id: 'bolt', amount: 1 }],
          stats: { wisdom: 1 },
          delta: { intimacy: 3, mood: -2 },
          tendency: { care: 1 },
        }),
      },
    ],
  },
  {
    id: 'e04',
    name: '迷路的小水母',
    emoji: '🎐',
    text: '一只几乎透明的数据水母搁浅在礁石缝里，还在微弱地闪。',
    options: [
      {
        text: '引水把它送回去',
        outcome: () => ({
          text: '它把水母托在背上，慢慢走回深处。水母临走时在它额头上留了一点光。',
          items: [{ id: 'glow_moss', amount: 1 }],
          delta: { intimacy: 3, energy: -5, hunger: -6 },
          stats: { wisdom: 1, perception: 1 },
          tendency: { care: 2 },
        }),
      },
      {
        text: '先拍照记录，再想办法',
        outcome: (ctx) => ({
          text: '它认真记录下水母的闪烁频率，并把这段数据带回了观星台。',
          items: [],
          delta: { hunger: -4 },
          stats: { wisdom: 2 },
          research: ctx.rng.chance(0.35) ? 1 : 0,
          tendency: { study: 2 },
        }),
      },
    ],
  },
  {
    id: 'e05',
    name: '星兽的低语',
    emoji: '🌌',
    text: '星兽忽然停下来，对着空无一物的海面轻声叫了几下，像在回应什么。',
    options: [
      {
        text: '蹲下来问它怎么了',
        outcome: () => ({
          text: '它把额头抵在你手心上。你什么都没听懂，但你们都很安心。',
          items: [],
          delta: { intimacy: 5, mood: 6 },
          stats: { perception: 1 },
          tendency: { care: 2 },
        }),
      },
      {
        text: '什么都不说，只是陪着',
        outcome: () => ({
          text: '你们并排坐了一会儿。海面上的光一点点聚过来，又散开。',
          items: [{ id: 'dream_dust', amount: 1 }],
          delta: { mood: 3, energy: -2 },
          stats: { wisdom: 1 },
          tendency: { care: 1, explore: 1 },
        }),
      },
    ],
  },
  {
    id: 'e06',
    name: '旧端口的呼唤',
    emoji: '📡',
    text: '遗迹里一个旧端口亮起，屏幕上滚动着一段无法解析的邀请。',
    options: [
      {
        text: '接入看看',
        outcome: (ctx) => ({
          text: ctx.rng.chance(0.7)
            ? '数据流灌进来，星兽愣了几秒，然后开始用爪子在地上画奇怪的符号。'
            : '端口过热，星兽被烫得缩回爪子，但顺手掰下了一块电路。',
          items: ctx.rng.chance(0.7) ? [{ id: 'rune_tablet', amount: 1 }] : [{ id: 'ancient_circuit', amount: 1 }],
          delta: { energy: -14, hunger: -6 },
          stats: { wisdom: 2 },
          research: 1,
          tendency: { study: 2 },
        }),
      },
      {
        text: '断开端口，绕路走',
        outcome: () => ({
          text: '它记住了这条路。绕行时你们发现了一条更安静、也更安全的通道。',
          items: [{ id: 'star_iron', amount: 2 }],
          delta: { intimacy: 2 },
          stats: { agility: 2 },
          tendency: { explore: 1 },
        }),
      },
    ],
  },
  {
    id: 'e07',
    name: '碎星坠落',
    emoji: '☄️',
    text: '一小块陨石砸在遗迹中央，坑里冒着蓝色的热气，边缘的金属开始融化。',
    options: [
      {
        text: '趁热去取',
        outcome: (ctx) => ({
          text: ctx.rng.chance(0.6)
            ? '它用爪子把还没冷却的金属拨出来，爪垫上留了个浅印。'
            : '它退得很快，只捡到边缘的碎块。烫是烫，收获还是有的。',
          items:
            ctx.rng.chance(0.6)
              ? [{ id: 'star_crystal_core', amount: 1 }, { id: 'star_iron', amount: 2 }]
              : [{ id: 'star_iron', amount: 2 }, { id: 'crystal_shard', amount: 1 }],
          delta: { energy: -10, mood: -6 },
          stats: { physique: 2 },
          tendency: { explore: 2 },
        }),
      },
      {
        text: '等冷却后慢慢挖',
        outcome: () => ({
          text: '你们等了很久。挖出来的东西不多，但它学会了怎么判断金属的温度。',
          items: [{ id: 'star_iron', amount: 1 }, { id: 'star_vein_stone', amount: 1 }],
          delta: { energy: -4 },
          stats: { wisdom: 1, perception: 2 },
          tendency: { study: 1 },
        }),
      },
    ],
  },
  {
    id: 'e08',
    name: '遗迹守卫',
    emoji: '🗿',
    text: '一尊半塌的守卫雕像忽然亮起单眼，缓缓转向星兽，但没有立刻攻击。',
    options: [
      {
        text: '正面应对',
        outcome: (ctx) => ({
          text: ctx.rng.chance(0.55)
            ? '它绕着雕像的关节走了两圈，找到了老旧的活动间隙。守卫的扫描灯慢慢暗了下去。'
            : '雕像只是扫描了一下，便退回墙里。它记下了星兽的编号。',
          items: [{ id: 'ancient_circuit', amount: 1 }, { id: 'rune_tablet', amount: 1 }],
          delta: { energy: -18, mood: -5 },
          stats: { physique: 2, agility: 2 },
          flags: ['met_guardian'],
          tendency: { explore: 3 },
        }),
      },
      {
        text: '悄悄绕开',
        outcome: () => ({
          text: '它贴着墙根一点点挪过去，连呼吸都放轻了，进门后才敢喘气。',
          items: [{ id: 'dream_dust', amount: 1 }],
          delta: { energy: -8, mood: 2 },
          stats: { agility: 3 },
          tendency: { explore: 1, care: 1 },
        }),
      },
    ],
  },
  {
    id: 'e09',
    name: '星尘风暴',
    emoji: '🌪️',
    text: '星尘浓度在几分钟内翻了几倍，视野里全是发亮的颗粒，方向感开始失效。',
    options: [
      {
        text: '打开灯塔，标定方向',
        outcome: (ctx) => ({
          text: '你带着它一点点挪回灯塔的光柱里。风停之前，你们谁都没松手。',
          items: [{ id: 'stardust', amount: ctx.rng.int(8, 16) }],
          delta: { hunger: -8, energy: -6, intimacy: 4 },
          stats: { perception: 2 },
          tendency: { care: 2 },
        }),
      },
      {
        text: '迎着风收集星尘',
        outcome: (ctx) => ({
          text: '它张开前肢在风里站了很久，回来时整只兽都在发光，背包也鼓了。',
          items: [{ id: 'stardust', amount: ctx.rng.int(14, 26) }, { id: 'crystal_shard', amount: 1 }],
          delta: { energy: -20, mood: -8, hunger: -10 },
          stats: { physique: 2, agility: 1 },
          tendency: { explore: 3 },
        }),
      },
    ],
  },
  {
    id: 'e10',
    name: '访客：拾荒商人',
    emoji: '🐾',
    text: '一只背着巨大壳的拾荒商人慢慢爬上小岛，壳上挂着乱七八糟的东西。',
    options: [
      {
        text: '交换物资',
        outcome: (ctx) => ({
          text: `你用一些星尘换来了它的存货。它走的时候还留下一句「下次带更好的」。`,
          cost: { stardust: ctx.rng.int(6, 10) },
          items: [{ id: 'shell', amount: 2 }, { id: 'glow_moss', amount: 1 }],
          stats: {},
          tendency: { explore: 1 },
        }),
      },
      {
        text: '请它休息，听听外面的消息',
        outcome: () => ({
          text: '商人讲了很多别的岛的事。星兽全程趴在你脚边，一句话都没漏听。',
          items: [{ id: 'starmap_fragment', amount: 1 }],
          delta: { mood: 6, intimacy: 2 },
          stats: { wisdom: 1, perception: 1 },
          research: 1,
          visited: ['scavenger'],
          tendency: { study: 1, care: 1 },
        }),
      },
    ],
  },
];

export const EVENT_MAP = Object.fromEntries(EVENTS.map((e) => [e.id, e]));
export function getEvent(id) {
  return EVENT_MAP[id];
}

/**
 * 建筑等级的"软上限"
 *
 * 严格来说建筑可以无限升（消耗按 1.55 倍递推增长），但为了避免数字失控
 * 到 10^9 这种量级，在 30 级做了一个软性收尾。30 级需要约 1.1 亿星尘，
 * 正常玩法不可能碰到。
 */
export const BUILDING_LEVEL_SOFT_CAP = 30;

/**
 * 建筑（5 个）
 *
 * **建筑等级无上限**：`effects` 里给出的只是前几级的效果表，
 * 超出表长后由 buildingEffect() 按"最后一档 + 固定增量"继续线性增长；
 * 升级消耗由 buildCostForLevel() 递推，越升越贵但永远能升。
 *
 * - effects 数组下标 = 等级（index 0 表示未建造）
 * - effectText 数组下标 = "升到第 n+1 级"的说明
 */
export const BUILDINGS = [
  {
    id: 'nursery',
    name: '孵化舱',
    emoji: '🛖',
    desc: '星兽休息的地方，决定行动力上限与休息效率。',
    baseCost: 20,
    effects: { apBonus: [0, 1, 2, 3], restBonus: [0, 0.15, 0.35, 0.5] },
    effectText: ['行动力上限 +1、休息恢复 +15%', '行动力上限 +2、休息恢复 +35%', '行动力上限 +3、休息恢复 +50%'],
  },
  {
    id: 'kitchen',
    name: '潮汐厨房',
    emoji: '🍳',
    desc: '把生材料做成料理，食物恢复效果更好。',
    baseCost: 30,
    effects: { foodBonus: [0, 0.2, 0.45, 0.7], unlockCook: [false, true, true, true] },
    effectText: ['解锁料理「星辉汤」', '食物恢复效果 +45%', '食物恢复效果 +70%'],
  },
  {
    id: 'workshop',
    name: '星尘工作台',
    emoji: '🛠️',
    desc: '制作礼物与关键道具，等级越高合成越便宜。',
    baseCost: 45,
    effects: { recipes: [0, 1, 2, 3], craftDiscount: [0, 0.1, 0.2, 0.3] },
    effectText: ['解锁「梦珊瑚枕」配方、合成费用 -10%', '解锁「星光吊坠」配方、合成费用 -20%', '合成费用 -30%'],
  },
  {
    id: 'observatory',
    name: '观星台',
    emoji: '🔭',
    desc: '研究图鉴、提升学习效率，2 级后可前往碎星遗迹。',
    baseCost: 50,
    effects: { researchBonus: [0, 0.25, 0.5, 0.8], unlockZone: [null, 'ruins', 'ruins', 'ruins'] },
    effectText: ['解锁探索区域「碎星遗迹」', '研究产出 +50%', '研究产出 +80%'],
  },
  {
    id: 'garden',
    name: '苔藓花园',
    emoji: '🌱',
    desc: '每天产出一次苔藓，并缓慢提升亲密。等级越高产出越多。',
    baseCost: 25,
    effects: { dailyMoss: [0, 2, 5, 9], dailyIntimacy: [0, 1, 2, 3] },
    effectText: ['每天产出 2 份苔藓团、亲密 +1', '每天产出 5 份苔藓团、亲密 +2', '每天产出 9 份苔藓团、亲密 +3'],
  },
];

export const BUILDING_MAP = Object.fromEntries(BUILDINGS.map((b) => [b.id, b]));
export function getBuilding(id) {
  return BUILDING_MAP[id];
}

/**
 * 升到 `level` 级所需的星尘（level 无上限）
 *
 * 递推：cost(1) = baseCost，之后 cost(n) = round(cost(n-1) * 1.55) + 8
 * 越往后越贵，但永远升得动（花园/厨房不需要星尘以外的材料）。
 *
 * @param {{baseCost: number}} def
 * @param {number} level 目标等级（>= 1）
 */
export function buildCostForLevel(def, level) {
  let cost = def.baseCost;
  for (let n = 2; n <= level; n++) {
    cost = Math.round(cost * 1.55) + 8;
  }
  return cost;
}

/**
 * 建筑效果的"基础表"（不含无限延伸部分）
 * @param {string} id
 * @param {string} effectKey
 * @param {number} level
 */
export function buildingEffectBase(id, effectKey, level) {
  const table = BUILDING_MAP[id]?.effects?.[effectKey];
  if (!table) return 0;
  return table[Math.min(level, table.length - 1)] ?? 0;
}

/**
 * 配方（由星尘工作台解锁）
 * cost 为星尘消耗（会应用 craftDiscount）
 */
export const RECIPES = [
  {
    id: 'r_luminous_soup',
    name: '星辉汤',
    emoji: '🍲',
    building: 'kitchen',
    level: 1,
    cost: 4,
    inputs: [{ id: 'glow_moss', amount: 1 }, { id: 'algae', amount: 2 }, { id: 'moss_ball', amount: 1 }],
    output: { id: 'luminous_soup', amount: 1 },
    desc: '把发光苔藓和星藻熬在一起，冷了也会发亮。',
  },
  {
    id: 'r_dream_pillow',
    name: '梦珊瑚枕',
    emoji: '🛏️',
    building: 'workshop',
    level: 1,
    cost: 8,
    inputs: [{ id: 'dream_dust', amount: 2 }, { id: 'algae', amount: 2 }],
    output: { id: 'dream_pillow', amount: 1 },
    desc: '用梦珊瑚粉填充的枕头，睡一整晚精力全满。',
  },
  {
    id: 'r_starlight_pendant',
    name: '星光吊坠',
    emoji: '📿',
    building: 'workshop',
    level: 2,
    cost: 15,
    inputs: [
      { id: 'star_crystal_core', amount: 1 },
      { id: 'echo_scale', amount: 2 },
      { id: 'crystal_shard', amount: 3 },
    ],
    output: { id: 'starlight_pendant', amount: 1 },
    desc: '把一小片星空封进晶体，是最高级的礼物。',
  },
];

export const RECIPE_MAP = Object.fromEntries(RECIPES.map((r) => [r.id, r]));

/**
 * 成就（5 个）
 */
export const ACHIEVEMENTS = [
  { id: 'first_light', name: '第一缕星尘', emoji: '✨', desc: '完成第一次探索任务。' },
  { id: 'device_drifter', name: '迁徙者', emoji: '🛰️', desc: '至少在两台设备上唤醒过星兽（导入过 1 次胶囊）。' },
  { id: 'collector', name: '收藏家', emoji: '📦', desc: '图鉴中记录 15 种不同的物品。' },
  { id: 'archivist', name: '见闻记录者', emoji: '🪶', desc: '见证 5 个不同的随机事件。' },
  { id: 'guardian_born', name: '守护体诞生', emoji: '🌟', desc: '让星兽进化到守护体阶段。' },
];

export const ACHIEVEMENT_MAP = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));

/**
 * 进化分支
 * - affinity 指定该分支由哪一种倾向值决定（explore / study / care）
 * - requirements.affinity 为该倾向的最低门槛
 * - 亲和度由 state.progress.affinity 累计（来自探索、研究、照料三类行为）
 */
export const EVOLUTION_BRANCHES = {
  traveler: {
    id: 'traveler',
    affinity: 'explore',
    name: '旅者',
    emoji: '🧭',
    title: '风与坐标的收藏者',
    desc: '它把每一次离开都当成回家的一部分。它记得所有去过的海域的名字。',
    requirements: { affinity: { explore: 12 } },
    bonus: { exploreSpeed: 0.12 },
    bonusText: '探索类任务时长 -12%',
  },
  scholar: {
    id: 'scholar',
    affinity: 'study',
    name: '学者',
    emoji: '📚',
    title: '把星图读成故事的人',
    desc: '它会对着石板发呆很久，然后忽然用爪子在地上画出一段公式。',
    requirements: { affinity: { study: 12 } },
    bonus: { researchYield: 0.2 },
    bonusText: '研究与学习产出 +20%',
  },
  gardener: {
    id: 'gardener',
    affinity: 'care',
    name: '园丁',
    emoji: '🌷',
    title: '在海面上种花的人',
    desc: '它学会了自己养苔藓，并把最亮的一小丛留给你。',
    requirements: { affinity: { care: 12 } },
    bonus: { careGain: 0.25 },
    bonusText: '喂食 / 清洁 / 抚摸效果 +25%',
  },
};

/** 倾向 id -> 分支。用于把玩家的照顾方式映射到进化分支 */
export const BRANCH_BY_AFFINITY = Object.fromEntries(
  Object.values(EVOLUTION_BRANCHES).map((b) => [b.affinity, b]),
);

/* ------------------------------------------------------------------ */
/* 进化阶段：基础三段 + 无限延伸的守护体形态                            */
/* ------------------------------------------------------------------ */

/** 中文数字（1~99），用于"第二形态""第三形态"…… 可以无限往后命名 */
const CN_DIGITS = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
function cnNumber(n) {
  if (n < 10) return CN_DIGITS[n];
  if (n < 20) return `十${n % 10 ? CN_DIGITS[n % 10] : ''}`;
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return `${CN_DIGITS[tens]}十${ones ? CN_DIGITS[ones] : ''}`;
}

/** 守护体之后的形态配色（循环使用） */
const GUARDIAN_THEMES = [
  { emoji: '🌟', tint: 'gold' },
  { emoji: '💫', tint: 'violet' },
  { emoji: '🌠', tint: 'cyan' },
  { emoji: '🔆', tint: 'rose' },
  { emoji: '🌌', tint: 'deep' },
];

/** 基础三段：幼体 → 成体 → 守护体 */
export const BASE_STAGES = [
  {
    id: 'larva',
    name: '幼体',
    emoji: '🥚',
    level: 1,
    desc: '刚在数据海里点亮的一小团光，什么都好奇。',
  },
  {
    id: 'adult',
    name: '成体',
    emoji: '🐉',
    level: 10,
    desc: '已经能独自走过浅滩和遗迹，开始在意外面的世界。',
  },
  {
    id: 'guardian',
    name: '守护体',
    emoji: '🌟',
    level: 22,
    desc: '光从它的脊背一直连到岛的边缘，小岛终于有了守望者。',
  },
];

/** 守护体之后的阶段只有编号，没有终点（"无上限"） */
export const INFINITE_STAGE_MIN_LEVEL = 35;

/**
 * 生成第 n 个形态（n >= 4）
 * Lv.35 起每 13 级一个形态，可以一直长下去。
 */
export function guardianForm(n) {
  const theme = GUARDIAN_THEMES[(n - 4) % GUARDIAN_THEMES.length];
  const cycle = Math.floor((n - 4) / GUARDIAN_THEMES.length);
  return {
    id: `guardian_${n}`,
    name: `守护体·${cnNumber(n)}`,
    emoji: theme.emoji,
    tint: theme.tint,
    level: INFINITE_STAGE_MIN_LEVEL + (n - 4) * 13,
    infinite: true,
    desc:
      cycle === 0
        ? `第 ${cnNumber(n)}形态。它开始把岛上的光一点点收拢、再重新撒出去。`
        : `第 ${cnNumber(n)}形态。光在它身上绕了 ${cycle} 圈，还没有要停下的意思。`,
  };
}

/** 阶段表（幼体 → 成体 → 守护体 → 无数形态），按等级升序 */
export const STAGES = [
  ...BASE_STAGES,
  ...Array.from({ length: 20 }, (_, i) => guardianForm(i + 4)),
];

/**
 * 按等级取阶段定义（内部使用；对外请用 stageForLevel / stageById）
 * @param {number} level
 * @returns {object} 阶段定义
 */
export function stageDefForLevel(level) {
  let stage = STAGES[0];
  for (const s of STAGES) {
    if (level >= s.level) stage = s;
    else break;
  }
  return stage;
}

/** 按 id 取阶段；查不到时回退到按等级推导（兼容旧存档里的 guardian_7 之类） */
export function stageById(id) {
  const found = STAGES.find((s) => s.id === id);
  if (found) return found;
  const m = /^guardian_(\d+)$/.exec(String(id ?? ''));
  if (m) return guardianForm(Number(m[1]));
  return null;
}

export const STAGE_MAP = Object.fromEntries(STAGES.map((s) => [s.id, s]));

/**
 * 进化条件（无限）
 *
 * - 成体：Lv.10 + 亲密 45
 * - 守护体：Lv.22 + 亲密 70 + 星辰晶核 ×1
 * - 之后每一个新形态：等级门槛逐级 +13，亲密门槛逐级 +15，
 *   星辰晶核的需求量随形态递增；从第 8 形态起还需要「星种」。
 *   没有终点。
 *
 * @param {string} stageId
 * @returns {{level:number, intimacy:number, item:{id:string,amount:number}|null}}
 */
export function evolutionRequirement(stageId) {
  if (stageId === 'adult') return { level: 10, intimacy: 45, item: null };
  if (stageId === 'guardian') return { level: 22, intimacy: 70, item: { id: 'star_crystal_core', amount: 1 } };

  const m = /^guardian_(\d+)$/.exec(String(stageId ?? ''));
  if (!m) return { level: 1, intimacy: 0, item: null };

  const n = Number(m[1]);
  const overflow = n - 3; // 守护体是第 3 形态，之后从 1 开始递增
  // 第 8 形态起，晶核越来越难找，改用稀有的「星种」
  const item = n >= 8
    ? { id: 'starseed', amount: n - 7 }
    : { id: 'star_crystal_core', amount: overflow };

  return {
    level: INFINITE_STAGE_MIN_LEVEL + (n - 4) * 13,
    intimacy: 70 + overflow * 15,
    item,
  };
}

/** 兼容旧调用：前三段的固定需求 */
export const EVOLUTION_REQUIREMENTS = {
  adult: evolutionRequirement('adult'),
  guardian: evolutionRequirement('guardian'),
};

/** 状态条的字段与中文名 */
export const STAT_KEYS = [
  { id: 'hunger', name: '饱食', emoji: '🍚' },
  { id: 'mood', name: '心情', emoji: '🎵' },
  { id: 'energy', name: '精力', emoji: '⚡' },
  { id: 'intimacy', name: '亲密', emoji: '💗' },
];

/** 成长属性 */
export const ATTR_KEYS = [
  { id: 'physique', name: '体质', emoji: '💪' },
  { id: 'agility', name: '敏捷', emoji: '🌀' },
  { id: 'wisdom', name: '智慧', emoji: '🧠' },
  { id: 'perception', name: '感知', emoji: '👁️' },
];

/** 亲和倾向（决定进化分支） */
export const AFFINITY_KEYS = [
  { id: 'explore', name: '探索', emoji: '🧭' },
  { id: 'study', name: '研究', emoji: '📖' },
  { id: 'care', name: '照料', emoji: '💗' },
];

/** 升级所需经验（等级 -> 经验） */
export function expForLevel(level) {
  return 40 + (level - 1) * 18;
}

/**
 * 状态条的"舒适线"
 *
 * 注意：这不是硬上限。饱食/心情/亲密可以超过 100，超出的部分在 UI 上显示为
 * 「溢出加成」，并在离线结算时作为缓冲先被消耗掉 —— 也就是说：
 * 把它喂得饱饱的再下线，回来时状态不会那么难看。
 *
 * 只有达到舒适线时才拒绝继续喂食/清洁（避免浪费行动点）。
 */
export const COMFORT_MAX = 100;
/** 舒适线以上的部分最多能存多少（超过就真的浪费了） */
export const STAT_OVERFLOW_CAP = 200;

/** 参数占位：属性无上限，这里只保留一个用于 UI 分档显示的参考值 */
export const ATTR_REFERENCE = 50;

/** 离线结算相关参数 */
export const OFFLINE = {
  /** 分段长度（30 分钟），让报告能按时段叙事 */
  sliceMs: 30 * 60 * 1000,
  /** 收益封顶时长：12 小时 */
  capMs: 12 * 60 * 60 * 1000,
  /** 超过封顶部分只给 5% 保底收益 */
  beyondRate: 0.05,
  /** 单个时间片最多触发的事件数 */
  eventChancePerSlice: 0.16,
  /** 报告最多列出的叙事条目 */
  maxNarratives: 12,
  /** 时间倒退时的保底收益 */
  rewind: {
    stardust: [1, 3],
    items: [{ id: 'moss_ball', amount: 1 }],
  },
};

/** 行动点参数 */
export const ACTION = {
  base: 8,
  baseMax: 12,
  /** 每次喂食 / 清洁 / 抚摸消耗 */
  cost: { feed: 1, clean: 1, touch: 1 },
  /** 基础恢复量 */
  gain: {
    feed: { hunger: 30, mood: 6 },
    clean: { mood: 12, intimacy: 2 },
    touch: { mood: 8, intimacy: 4 },
  },
};
