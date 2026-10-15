/**
 * ui.js —— 全部界面渲染与交互
 *
 * 设计原则：
 * 1. 渲染函数只读 store.state，不做业务判断；业务判断交给 state.js / tasks.js。
 * 2. 所有点击通过 data-action 委托处理，避免为动态列表反复绑定事件。
 * 3. 弹窗使用一个通用 modal + 栈式管理，方便"报告 -> 事件 -> 进化"连续弹出。
 */

import {
  ACHIEVEMENTS,
  AFFINITY_KEYS,
  ATTR_KEYS,
  BUILDING_LEVEL_SOFT_CAP,
  BUILDINGS,
  COMFORT_MAX,
  EVENTS,
  EVOLUTION_BRANCHES,
  ITEM_MAP,
  ITEMS,
  ITEM_TYPE_LABEL,
  RECIPES,
  SAVE_VERSION,
  STAGE_MAP,
  STAT_KEYS,
  TASKS,
  ZONES,
  buildCostForLevel,
  expForLevel,
  getItem,
  getTask,
  getZone,
  stageById,
} from './data.js';
import {
  careAction,
  cancelTask,
  checkEvolution,
  clamp,
  craft,
  evolve,
  isRecipeUnlocked,
  isZoneUnlocked,
  maxActionPoints,
  recipeCost,
  startTask,
  store,
  upgradeBuilding,
  useItem,
} from './state.js';
import { completeActiveTask, taskProgress, taskRemainingMs } from './tasks.js';
import { resolveEventOption } from './events.js';
import { rngFrom } from './rng.js';
import {
  downloadText,
  encodeCapsuleCode,
  exportCapsuleFile,
  isPersistentStorage,
  prepareImport,
  applyImport,
  saveNow,
} from './save.js';
import { settleFromStore } from './offline.js';
import { formatClock, formatDuration, now } from './time.js';
import { describeDeltas, mergeItems } from './utils.js';

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

const $ = (id) => document.getElementById(id);
const esc = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const itemChip = (id, amount) =>
  `<span class="reward">${esc(ITEM_MAP[id]?.emoji ?? '❔')} ${esc(ITEM_MAP[id]?.name ?? id)}${
    amount ? ` ×${amount}` : ''
  }</span>`;

/** 界面局部状态（不写入存档） */
const view = {
  panel: 'home',
  bagFilter: 'all',
  codexTab: 'items',
  lastReport: null,
  pendingReport: null,
  eventQueue: [],
  saveFlashTimer: null,
};

/** 当前正在展示的选择上下文（探索页选区域用） */
let pendingZoneChoice = { taskId: null, zoneId: null, from: 'explore' };

/* ------------------------------------------------------------------ */
/* Toast                                                               */
/* ------------------------------------------------------------------ */

/**
 * 轻提示
 * @param {string} message
 * @param {'info'|'good'|'bad'} [kind]
 */
export function toast(message, kind = 'info') {
  const box = $('toasts');
  if (!box) return;
  const el = document.createElement('div');
  el.className = `toast${kind === 'info' ? '' : ` toast--${kind}`}`;
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => {
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 320);
  }, 2400);
}

/* ------------------------------------------------------------------ */
/* 弹窗栈                                                              */
/* ------------------------------------------------------------------ */

/** 当前弹窗上下文 */
let modalContext = null;

/**
 * 打开弹窗
 * @param {{ title: string, body: string, foot?: string, onMount?: (root: HTMLElement) => void, onClose?: () => void }} opts
 */
export function openModal(opts) {
  modalContext = { ...opts };
  const layer = $('modalLayer');
  $('modalTitle').innerHTML = opts.title;
  $('modalBody').innerHTML = opts.body;
  $('modalFoot').innerHTML = opts.foot ?? '';
  layer.hidden = false;
  // 打开弹窗时禁止背景滚动
  $('main').style.overflow = 'hidden';
  opts.onMount?.($('modal'));
}

/** 关闭弹窗；若事件队列里还有内容则自动弹下一个 */
export function closeModal({ silent = false } = {}) {
  const ctx = modalContext;
  modalContext = null;
  $('modalLayer').hidden = true;
  $('modalBody').innerHTML = '';
  $('modalFoot').innerHTML = '';
  $('main').style.overflow = '';
  if (!silent) ctx?.onClose?.();
  if (view.eventQueue.length > 0) {
    const next = view.eventQueue.shift();
    setTimeout(() => showEventModal(next), 260);
  }
}

/** 是否已有弹窗打开 */
export function isModalOpen() {
  return !$('modalLayer').hidden;
}

/** 便捷：只有确认按钮的提示框 */
export function alertModal(title, bodyHtml, buttonText = '知道了') {
  openModal({
    title,
    body: bodyHtml,
    foot: `<button class="btn btn--primary btn--block" data-close-modal>${esc(buttonText)}</button>`,
  });
}

/* ------------------------------------------------------------------ */
/* 顶部资源栏                                                          */
/* ------------------------------------------------------------------ */

function renderHeader(state) {
  const maxAp = maxActionPoints(state);
  $('chipApValue').textContent = `${Math.floor(state.actionPoints)}/${maxAp}`;
  $('chipStardustValue').textContent = String(state.inventory.stardust ?? 0);
  // 行动点见底时给个视觉提示
  $('chipAp').classList.toggle('is-low', state.actionPoints <= 1);
}

/** 存档状态提示 */
function flashSaveChip(text) {
  const chip = $('chipSave');
  $('chipSaveValue').textContent = text;
  chip.classList.remove('is-flash');
  void chip.offsetWidth;
  chip.classList.add('is-flash');
  if (view.saveFlashTimer) clearTimeout(view.saveFlashTimer);
  view.saveFlashTimer = setTimeout(() => {
    $('chipSaveValue').textContent = '已存档';
  }, 2200);
}

/* ------------------------------------------------------------------ */
/* 主界面                                                              */
/* ------------------------------------------------------------------ */

/** 所有可能的"状态 class"，渲染前需要先清掉 */
const PET_MOOD_CLASSES = ['mood-normal', 'mood-hungry', 'mood-sad', 'mood-sleepy', 'mood-loved'];

/**
 * 计算星兽当前应该长什么样
 *
 * 形象由两部分叠加：
 *  1. 阶段 emoji（幼体按等级再细分，成体看分支，守护体有无穷形态）
 *  2. 状态表情覆盖（饿 / 低落 / 睡着 / 亲密）
 *
 * @param {object} pet state.pet
 * @param {object} stage 阶段定义（来自 STAGE_MAP / stageById）
 * @returns {{emoji: string, mood: string, moodLabel: string, tip: string}}
 */
export function petLook(pet, stage) {
  const stats = pet?.stats ?? {};
  const hunger = stats.hunger ?? 0;
  const moodValue = stats.mood ?? 0;
  const energy = stats.energy ?? 0;
  const intimacy = stats.intimacy ?? 0;
  const level = pet?.level ?? 1;

  // ---- 阶段形象 ----
  let base = stage?.emoji ?? '🥚';
  if (stage?.id === 'larva') {
    // 幼体内部再分两段，避免一直是一个蛋
    base = level >= 5 ? '🐣' : '🥚';
  } else if (stage?.id === 'adult') {
    base = { traveler: '🦅', scholar: '🦉', gardener: '🐢' }[pet?.branch] ?? '🐉';
  }

  // ---- 状态覆盖（优先级：睡着 > 饿 > 低落 > 亲密 > 正常）----
  let mood = 'normal';
  let moodLabel = '状态不错';
  let emoji = base;
  let tip = '';

  if (energy <= 20) {
    mood = 'sleepy';
    moodLabel = '困得不行';
    emoji = '😴';
    tip = '精力见底了，安排一次「休息」吧。';
  } else if (hunger <= 25) {
    mood = 'hungry';
    moodLabel = '饿扁了';
    emoji = '🥺';
    tip = '饱食很低，喂点东西，不然出任务会掉状态。';
  } else if (moodValue <= 25) {
    mood = 'sad';
    moodLabel = '有点低落';
    emoji = '🫠';
    tip = '心情不太好，清洁或抚摸一下它。';
  } else if (intimacy >= 70) {
    mood = 'loved';
    moodLabel = '很黏你';
    emoji = base;
    tip = '它已经很信任你了。';
  }

  return { emoji, mood, moodLabel, tip };
}

function renderHome(state) {
  const pet = state.pet;
  const stage = STAGE_MAP[pet.stage] ?? stageById(pet.stage) ?? STAGE_MAP.larva;
  const branch = pet.branch ? EVOLUTION_BRANCHES[pet.branch] : null;

  // 形象：阶段 + 状态联动
  const look = petLook(pet, stage);
  $('petEmoji').textContent = look.emoji;

  // mood class 用增删而不是重置 className，避免覆盖掉 is-happy / is-away
  const avatar = $('petAvatar');
  for (const name of PET_MOOD_CLASSES) avatar.classList.remove(name);
  avatar.classList.add(`mood-${look.mood}`);
  avatar.classList.toggle('is-away', Boolean(state.task.active));
  $('petMood').textContent = look.tip ? `${look.moodLabel} · ${look.tip}` : look.moodLabel;

  $('petName').textContent = pet.name;
  $('petStage').textContent = `${stage.name} · ${branch ? `${branch.emoji} ${branch.name}` : '分支未定'}`;
  $('petLevel').textContent = String(pet.level);

  // 经验条
  const need = expForLevel(pet.level);
  const ratio = clamp(pet.exp / need, 0, 1);
  $('expFill').style.width = `${(ratio * 100).toFixed(1)}%`;
  $('expText').textContent = `${Math.floor(pet.exp)} / ${need}`;

  // 状态条：100 是"舒适线"，超过的部分显示为溢出加成
  $('statBars').innerHTML = STAT_KEYS.map((key) => {
    const value = Math.max(0, state.pet.stats[key.id] ?? 0);
    const low = value <= 25;
    const overflow = Math.max(0, value - COMFORT_MAX);
    // 条形图只画到舒适线；溢出时整条填满并加一条"溢出"标记
    const fillPct = clamp((value / COMFORT_MAX) * 100, 0, 100);
    return `
      <div class="stat${low ? ' is-low' : ''}">
        <span class="stat__label">${key.emoji} ${esc(key.name)}</span>
        <span class="bar"><span class="bar__fill bar__fill--${key.id}${
          low ? ' is-low' : ''
        }${overflow > 0 ? ' is-full' : ''}" style="width:${fillPct.toFixed(1)}%"></span></span>
        <span class="stat__value">${Math.round(value)}${
          overflow > 0 ? `<em class="stat__overflow">+${Math.round(overflow)}</em>` : ''
        }</span>
      </div>`;
  }).join('');

  // 成长属性（无上限，数值大时自动缩短显示）
  $('attrList').innerHTML = ATTR_KEYS.map((key) => {
    const raw = Math.max(0, state.pet.attrs[key.id] ?? 0);
    const value = raw >= 10000 ? `${(raw / 1000).toFixed(1)}k` : String(Math.round(raw));
    return `
      <div class="attr">
        <span class="attr__icon">${key.emoji}</span>
        <span class="attr__name">${esc(key.name)}</span>
        <span class="attr__value">${value}</span>
      </div>`;
  }).join('');

  // 当前安排
  const box = $('homeTaskBox');
  if (state.task.active) {
    const def = getTask(state.task.active);
    const zone = state.task.zoneId ? getZone(state.task.zoneId) : null;
    const remain = taskRemainingMs(state);
    const ratio = taskProgress(state) * 100;
    box.innerHTML = `
      <div class="task-live">
        <span>${def?.emoji ?? '🔭'} ${esc(def?.name ?? state.task.active)}${
          zone ? ` · ${esc(zone.emoji)} ${esc(zone.name)}` : ''
        }</span>
        <span class="task-live__time" data-task-countdown>${esc(formatDuration(remain))}</span>
      </div>
      <div class="progress"><div class="progress__fill" data-task-progress style="width:${ratio.toFixed(1)}%"></div></div>
      <button class="btn btn--ghost btn--sm" data-action="task-cancel">召回星兽</button>
    `;
  } else {
    box.innerHTML = `<p class="muted small">星兽现在在岛上休息。安排一次探索，它才会带回东西。</p>
      <button class="btn btn--primary btn--sm" data-nav="explore">安排探索 →</button>`;
  }

  // 时间胶囊摘要
  const awayMs = state.pet.memory.lastAwayMs ?? 0;
  $('lastAwayText').innerHTML =
    awayMs > 0
      ? `上次你离开了 <b>${esc(formatDuration(awayMs))}</b>（${esc(formatClock(state.pet.memory.lastAwayAt))} 回来）。离线收益按时间胶囊一次性结算，上限 12 小时。`
      : '星兽还没有离开过。关掉网页后，它会自己待着，等你回来结算。';

  // 记忆列表
  const zonesVisited = (state.pet.memory.zonesVisited ?? [])
    .map((id) => ZONE_LABEL(id))
    .filter(Boolean);
  $('memoryList').innerHTML = `
    <li>🕰️ 上次离开：<b>${awayMs > 0 ? esc(formatDuration(awayMs)) : '还没有'}</b></li>
    <li>🛰️ 设备迁徙：<b>${state.pet.memory.deviceCount ?? 1} 台</b>（导入过 ${state.imports?.count ?? 0} 次胶囊）</li>
    <li>🗺️ 去过的地方：<b>${zonesVisited.length ? esc(zonesVisited.join('、')) : '还没有出过门'}</b></li>
    <li>🧭 累计探索：<b>${state.pet.memory.totalExplorations ?? 0} 次</b></li>
    <li>🐾 见过的访客：<b>${
      (state.pet.memory.visitors ?? []).length ? esc(state.pet.memory.visitors.length + ' 位') : '还没有'
    }</b></li>
  `;

  // 进化按钮（满足条件时出现在状态卡下方）
  renderEvolutionEntry(state);
}

function ZONE_LABEL(id) {
  const zone = getZone(id);
  return zone ? `${zone.emoji}${zone.name}` : null;
}

/** 进化入口 */
function renderEvolutionEntry(state) {
  const card = $('petStage')?.closest('.card');
  if (!card) return;
  card.querySelector('.evolve-row')?.remove();
  const check = checkEvolution(state);
  const branch = state.pet.branch ? EVOLUTION_BRANCHES[state.pet.branch] : null;

  if (!check.next) {
    if (branch) {
      const row = document.createElement('p');
      row.className = 'muted small evolve-row';
      row.style.marginTop = '12px';
      row.innerHTML = `${branch.emoji} <b>${esc(branch.name)}</b>：${esc(branch.bonusText)}`;
      card.appendChild(row);
    }
    return;
  }

  const row = document.createElement('div');
  row.className = 'btn-row evolve-row';
  row.innerHTML = `
    <button class="btn ${check.ok ? 'btn--primary' : 'is-disabled'} btn--block" data-action="evolve" ${
      check.ok ? '' : 'disabled'
    }>
      🌟 进化到「${esc(stageById(check.next)?.name ?? check.next)}」${check.ok ? '' : '（条件不足）'}
    </button>
    ${
      check.ok
        ? ''
        : `<p class="muted tiny" style="width:100%">${check.reasons.map(esc).join('；')}</p>`
    }
  `;
  card.appendChild(row);
}

/* ------------------------------------------------------------------ */
/* 探索页                                                              */
/* ------------------------------------------------------------------ */

function renderExplore(state) {
  // 区域
  $('zoneList').innerHTML = ZONES.map((zone) => {
    const unlocked = isZoneUnlocked(state, zone);
    const visited = (state.pet.memory.zonesVisited ?? []).includes(zone.id);
    const active = pendingZoneChoice.zoneId === zone.id;
    return `
      <button class="zone ${unlocked ? '' : 'is-locked'} ${active ? 'is-active' : ''}"
              data-action="pick-zone" data-zone="${zone.id}" ${unlocked ? '' : 'disabled'}>
        <span class="zone__emoji">${zone.emoji}</span>
        <span class="zone__body">
          <span class="zone__name">${esc(zone.name)} ${visited ? '· 已去过' : ''}</span>
          <span class="zone__desc">${esc(zone.desc)}</span>
          ${
            unlocked
              ? ''
              : `<span class="zone__desc" style="color:var(--warn)">🔒 ${esc(zone.unlock?.hint ?? '尚未解锁')}</span>`
          }
        </span>
        <span class="zone__tag">危险 ${zone.danger}</span>
      </button>`;
  }).join('');

  // 任务
  const active = state.task.active;
  const energy = state.pet.stats.energy ?? 0;
  $('taskList').innerHTML = TASKS.map((task) => {
    const affordable = state.actionPoints >= task.cost;
    const enoughEnergy = energy >= (task.danger ? 15 : 8);
    const disabled = Boolean(active) || !affordable || !enoughEnergy;
    return `
      <button class="task ${active === task.id ? 'is-active' : ''}" data-action="start-task" data-task="${task.id}" ${
        disabled ? 'disabled' : ''
      }>
        <span class="task__emoji">${task.emoji}</span>
        <span class="task__body">
          <span class="task__name">${esc(task.name)}</span>
          <span class="task__desc">${esc(task.desc)}</span>
        </span>
        <span class="task__meta">${Math.round(task.duration / 60)} 分钟<br />${task.cost} ⚡</span>
      </button>`;
  }).join('');

  $('taskHint').textContent = active ? '星兽外出中' : '选择任务类型';

  // 当前任务
  const box = $('activeTaskBox');
  if (active) {
    const def = getTask(active);
    const zone = state.task.zoneId ? getZone(state.task.zoneId) : null;
    box.innerHTML = `
      <div class="task-live">
        <span>${def?.emoji ?? '🔭'} <b>${esc(def?.name ?? active)}</b>${
          zone ? ` · ${zone.emoji}${esc(zone.name)}` : ''
        }</span>
        <span class="task-live__time" data-task-countdown>${esc(formatDuration(taskRemainingMs(state)))}</span>
      </div>
      <div class="progress"><div class="progress__fill" data-task-progress style="width:${(
        taskProgress(state) * 100
      ).toFixed(1)}%"></div></div>
      <p class="muted tiny">任务完成后奖励会在你下次上线时作为离线报告结算；如果你现在就在线上，它会自动结算。</p>
      <button class="btn btn--ghost btn--sm" data-action="task-cancel">召回星兽（不退还行动点）</button>
    `;
  } else {
    box.innerHTML = `<p class="muted small">没有进行中的任务。上线时安排一次，然后关掉网页去忙别的吧。</p>`;
  }
}

/* ------------------------------------------------------------------ */
/* 背包页                                                              */
/* ------------------------------------------------------------------ */

const BAG_FILTERS = [
  { id: 'all', name: '全部' },
  { id: 'material', name: '材料' },
  { id: 'food', name: '食物' },
  { id: 'gift', name: '礼物' },
  { id: 'key', name: '关键物' },
  { id: 'relic', name: '遗物' },
  { id: 'blueprint', name: '配方' },
];

function renderBag(state) {
  const owned = Object.entries(state.inventory).filter(([, amount]) => amount > 0);
  const totalKinds = owned.length;
  $('bagSummary').textContent = `${totalKinds} 种物品`;

  $('bagFilters').innerHTML = BAG_FILTERS.map(
    (f) =>
      `<button class="filter-chip ${view.bagFilter === f.id ? 'is-active' : ''}" data-action="bag-filter" data-filter="${
        f.id
      }">${esc(f.name)}</button>`,
  ).join('');

  const list = owned
    .filter(([id]) => view.bagFilter === 'all' || ITEM_MAP[id]?.type === view.bagFilter)
    .sort((a, b) => {
      const ra = ITEM_MAP[a[0]]?.rarity ?? 'common';
      const rb = ITEM_MAP[b[0]]?.rarity ?? 'common';
      if (ra !== rb) return ra === 'epic' ? -1 : rb === 'epic' ? 1 : ra === 'rare' ? -1 : 1;
      return (ITEM_MAP[a[0]]?.price ?? 0) - (ITEM_MAP[b[0]]?.price ?? 0);
    });

  $('bagList').innerHTML = list.length
    ? list
        .map(([id, amount]) => {
          const item = ITEM_MAP[id];
          const usable = Boolean(item?.use);
          return `
            <button class="item item--${item?.rarity ?? 'common'} ${usable ? 'item--usable' : ''}"
                    data-action="item-detail" data-item="${id}">
              <span class="item__count">×${amount}</span>
              <span class="item__emoji">${item?.emoji ?? '❔'}</span>
              <span class="item__name">${esc(item?.name ?? id)}</span>
            </button>`;
        })
        .join('')
    : `<p class="empty center grow">这一类还没有东西。安排一次探索就能带回来。</p>`;

  // 工作台
  $('recipeList').innerHTML = RECIPES.map((recipe) => {
    const unlocked = isRecipeUnlocked(state, recipe);
    const cost = recipeCost(state, recipe);
    const inputs = recipe.inputs
      .map((input) => {
        const have = state.inventory[input.id] ?? 0;
        const ok = have >= input.amount;
        return `<span class="reward" style="${ok ? '' : 'color:var(--bad)'}">${esc(
          ITEM_MAP[input.id]?.name ?? input.id,
        )} ${have}/${input.amount}</span>`;
      })
      .join('');
    const canCraft =
      unlocked &&
      (state.inventory.stardust ?? 0) >= cost &&
      recipe.inputs.every((i) => (state.inventory[i.id] ?? 0) >= i.amount);
    return `
      <div class="recipe ${unlocked ? '' : 'is-locked'}">
        <div class="recipe__head">
          <span class="recipe__emoji">${recipe.emoji}</span>
          <span class="recipe__name">${esc(recipe.name)}</span>
          ${
            unlocked
              ? ''
              : `<span class="zone__tag">需 ${esc(BUILDINGS.find((b) => b.id === recipe.building)?.name ?? '')} Lv.${recipe.level}</span>`
          }
        </div>
        <p class="recipe__desc">${esc(recipe.desc)}</p>
        <div class="reward-list">${inputs}</div>
        <p class="recipe__cost" style="margin-top:6px">消耗 ✨${cost}</p>
        <button class="btn btn--sm ${canCraft ? 'btn--primary' : 'is-disabled'}" data-action="craft" data-recipe="${
          recipe.id
        }" ${canCraft ? '' : 'disabled'}>制作</button>
      </div>`;
  }).join('');
}

/** 物品详情弹窗 */
function showItemModal(itemId) {
  const item = getItem(itemId);
  if (!item) return;
  const amount = store.state.inventory[itemId] ?? 0;
  const canUse = Boolean(item.use);
  const body = `
    <div class="event__banner">
      <span class="event__emoji">${item.emoji}</span>
      <div>
        <div class="event__title">${esc(item.name)}</div>
        <div class="event__sub">${esc(ITEM_TYPE_LABEL[item.type] ?? item.type)} · ${
          { common: '普通', rare: '稀有', epic: '史诗' }[item.rarity]
        } · 持有 ×${amount}</div>
      </div>
    </div>
    <p class="event__text">${esc(item.desc ?? '')}</p>
    ${
      item.use
        ? `<p class="muted small">使用效果：${[
            item.use.hunger ? `饱食 +${item.use.hunger}` : '',
            item.use.mood ? `心情 +${item.use.mood}` : '',
            item.use.energy ? `精力 +${item.use.energy}` : '',
            item.use.intimacy ? `亲密 +${item.use.intimacy}` : '',
          ]
            .filter(Boolean)
            .join('、')}</p>`
        : ''
    }
  `;
  openModal({
    title: `${item.emoji} ${esc(item.name)}`,
    body,
    foot: `${canUse ? `<button class="btn btn--primary btn--block" data-action="use-item" data-item="${itemId}">使用一个</button>` : ''}`,
  });
}

/* ------------------------------------------------------------------ */
/* 图鉴页                                                              */
/* ------------------------------------------------------------------ */

const CODEX_TABS = [
  { id: 'items', name: '物品' },
  { id: 'encounters', name: '见闻' },
  { id: 'visitors', name: '访客' },
  { id: 'recipes', name: '配方' },
];

function renderCodex(state) {
  $('codexTabs').innerHTML = CODEX_TABS.map(
    (tab) =>
      `<button class="filter-chip ${view.codexTab === tab.id ? 'is-active' : ''}" data-action="codex-tab" data-tab="${
        tab.id
      }">${esc(tab.name)}</button>`,
  ).join('');

  const box = $('codexList');
  let total = 0;
  let found = 0;

  if (view.codexTab === 'items') {
    total = ITEMS.length;
    found = ITEMS.filter((it) => state.codex.items[it.id]).length;
    box.innerHTML = ITEMS.map((it) => {
      const known = Boolean(state.codex.items[it.id]);
      return `
        <div class="codex-cell ${known ? '' : 'is-locked'}">
          <span class="codex-cell__emoji">${known ? it.emoji : '❔'}</span>
          <span>${known ? esc(it.name) : '未发现'}</span>
          <span class="codex-cell__sub">${
            known ? esc(ITEM_TYPE_LABEL[it.type] ?? '') : `持有 ${state.inventory[it.id] ?? 0}`
          }</span>
        </div>`;
    }).join('');
  } else if (view.codexTab === 'encounters') {
    total = EVENTS.length;
    found = EVENTS.filter((e) => state.codex.encounters[e.id]).length;
    box.innerHTML = EVENTS.map((e) => {
      const known = Boolean(state.codex.encounters[e.id]);
      return `
        <div class="codex-cell ${known ? '' : 'is-locked'}">
          <span class="codex-cell__emoji">${known ? e.emoji : '❔'}</span>
          <span>${known ? esc(e.name) : '未经历'}</span>
          <span class="codex-cell__sub">${
            known ? `遇见 ${state.progress.eventsSeen?.[e.id] ?? 1} 次` : '随机事件'
          }</span>
        </div>`;
    }).join('');
  } else if (view.codexTab === 'visitors') {
    const visitors = Object.keys(state.codex.visitors);
    total = visitors.length || 1;
    found = visitors.length;
    box.innerHTML = visitors.length
      ? visitors
          .map(
            (id) => `
        <div class="codex-cell">
          <span class="codex-cell__emoji">🐾</span>
          <span>${esc(visitorName(id))}</span>
          <span class="codex-cell__sub">首次 ${esc(formatClock(state.codex.visitors[id].firstAt ?? now()))}</span>
        </div>`,
          )
          .join('')
      : `<p class="empty">还没有访客来过。小岛安静的时候，拾荒商人才会路过。</p>`;
  } else {
    total = RECIPES.length;
    found = RECIPES.filter((r) => state.codex.recipes[r.id]).length;
    box.innerHTML = RECIPES.map((r) => {
      const known = Boolean(state.codex.recipes[r.id]);
      return `
        <div class="codex-cell ${known ? '' : 'is-locked'}">
          <span class="codex-cell__emoji">${known ? r.emoji : '❔'}</span>
          <span>${known ? esc(r.name) : '未掌握'}</span>
          <span class="codex-cell__sub">${known ? '已制作' : '制作一次即记录'}</span>
        </div>`;
    }).join('');
  }

  $('codexProgress').textContent = `${found} / ${total}`;

  // 成就
  const unlockedCount = ACHIEVEMENTS.filter((a) => state.achievements[a.id]).length;
  $('achProgress').textContent = `${unlockedCount} / ${ACHIEVEMENTS.length}`;
  $('achievementList').innerHTML = ACHIEVEMENTS.map((a) => {
    const got = Boolean(state.achievements[a.id]);
    return `
      <div class="achievement ${got ? '' : 'is-locked'}">
        <span class="achievement__emoji">${got ? a.emoji : '🔒'}</span>
        <div>
          <div class="achievement__name">${esc(a.name)}</div>
          <div class="achievement__desc">${esc(a.desc)}${
            got ? ` · ${esc(formatClock(state.achievements[a.id].at))}` : ''
          }</div>
        </div>
      </div>`;
  }).join('');
}

function visitorName(id) {
  const map = { scavenger: '拾荒商人', guardian: '遗迹守卫' };
  return map[id] ?? id;
}

/* ------------------------------------------------------------------ */
/* 设置页                                                              */
/* ------------------------------------------------------------------ */

function renderSettings(state, save) {
  // 本地存储不可用时给出明确警告（file:// 下的 Firefox / Safari，或隐私模式）
  const persistenceWarning = !isPersistentStorage();
  const stardust = state.inventory.stardust ?? 0;

  $('buildingList').innerHTML = BUILDINGS.map((b) => {
    const level = state.buildings[b.id] ?? 0;
    const capped = level >= BUILDING_LEVEL_SOFT_CAP;
    const cost = capped ? 0 : buildCostForLevel(b, level + 1);
    const affordable = !capped && stardust >= cost;
    // 效果文案：表内有就用表内，超出后说明"继续按每级递增"
    const nextEffect = capped
      ? null
      : b.effectText[level] ?? '效果继续按每级递增（等级无上限）';
    const progress = Math.min(100, (level / BUILDING_LEVEL_SOFT_CAP) * 100);
    return `
      <div class="building">
        <div class="building__head">
          <span class="building__emoji">${b.emoji}</span>
          <span class="building__name">${esc(b.name)}</span>
          <span class="building__level">Lv.${level}</span>
        </div>
        <div class="building__bar"><span style="width:${progress.toFixed(1)}%"></span></div>
        <p class="building__desc">${esc(b.desc)}</p>
        ${
          capped
            ? `<p class="building__effect">已达 ${BUILDING_LEVEL_SOFT_CAP} 级（软上限）</p>`
            : `<p class="building__next">下一级（Lv.${level + 1}）：${esc(nextEffect ?? '')}</p>
               <button class="btn btn--sm ${affordable ? 'btn--primary' : 'is-disabled'}" data-action="upgrade" data-building="${
                 b.id
               }" ${affordable ? '' : 'disabled'}>升级（✨${cost}）</button>`
        }
      </div>`;
  }).join('');

  const summary = {
    savedAtText: formatClock(save.savedAt),
    deviceId: save.deviceId,
    version: save.v,
    lastSettleText: formatClock(save.lastSettleTime),
  };
  $('settingsSaveInfo').innerHTML = `
    本地存档：v${summary.version} · 最后保存 ${esc(summary.savedAtText)} · 上次结算 ${esc(
      summary.lastSettleText,
    )}<br />设备标识：<code>${esc(summary.deviceId)}</code>
    ${
      persistenceWarning
        ? `<br /><span style="color:var(--warn)">⚠️ 当前环境无法写入浏览器本地存储，进度只保存在内存里，刷新会丢失。请用「封入胶囊」保存进度。</span>`
        : ''
    }
  `;

  $('inputPetName').value = state.pet.name;
  $('aboutVersion').textContent = `存档版本 v${SAVE_VERSION} · 游戏版本 MVP 1.0`;
}

/* ------------------------------------------------------------------ */
/* 战斗（tick）时的高频更新：任务倒计时                                 */
/* ------------------------------------------------------------------ */

export function renderTaskTicker() {
  const state = store.state;
  if (!state?.task.active) return;
  const remain = taskRemainingMs(state);
  const ratio = taskProgress(state) * 100;
  for (const el of document.querySelectorAll('[data-task-countdown]')) {
    el.textContent = formatDuration(remain);
  }
  for (const el of document.querySelectorAll('[data-task-progress]')) {
    el.style.width = `${ratio.toFixed(1)}%`;
  }
}

/* ------------------------------------------------------------------ */
/* 总渲染                                                              */
/* ------------------------------------------------------------------ */

export function renderAll() {
  const state = store.state;
  const save = store.save;
  if (!state || !save) return;
  renderHeader(state);
  switch (view.panel) {
    case 'home':
      renderHome(state);
      break;
    case 'explore':
      renderExplore(state);
      break;
    case 'bag':
      renderBag(state);
      break;
    case 'codex':
      renderCodex(state);
      break;
    case 'settings':
      renderSettings(state, save);
      break;
  }
}

/** 切换面板 */
export function switchPanel(name) {
  if (!['home', 'explore', 'bag', 'codex', 'settings'].includes(name)) return;
  view.panel = name;
  for (const panel of document.querySelectorAll('.panel')) {
    panel.classList.toggle('is-active', panel.dataset.panel === name);
  }
  for (const tab of document.querySelectorAll('.tab')) {
    tab.classList.toggle('is-active', tab.dataset.nav === name);
  }
  $('main').scrollTop = 0;
  renderAll();
}

/* ------------------------------------------------------------------ */
/* 业务动作                                                            */
/* ------------------------------------------------------------------ */

/** 安排任务（需要区域时先提示选区域） */
function actionStartTask(taskId) {
  const state = store.state;
  const def = getTask(taskId);
  if (!def) return;
  if (state.task.active) {
    toast('星兽还在外面，先等它回来。', 'bad');
    return;
  }
  if (def.zone) {
    const zone = pendingZoneChoice.zoneId ? getZone(pendingZoneChoice.zoneId) : null;
    if (!zone || !isZoneUnlocked(state, zone.id)) {
      toast('请先在上方选择一个探索区域。', 'bad');
      return;
    }
    runStart(def, zone.id);
  } else {
    runStart(def, null);
  }
}

function runStart(def, zoneId) {
  let result = { ok: false, message: '' };
  store.set((state) => {
    result = startTask(state, def, zoneId, now());
  });
  toast(result.message, result.ok ? 'good' : 'bad');
  if (result.ok) {
    renderAll();
    switchPanel('home');
  }
}

/** 照顾动作 */
function actionCare(kind) {
  const state = store.state;
  if (kind === 'feed') {
    // 有苔藓团就直接喂，否则打开食物选择
    const foods = Object.keys(state.inventory).filter((id) => ITEM_MAP[id]?.use?.hunger && state.inventory[id] > 0);
    if (foods.length === 0) {
      toast('背包里没有食物了。让星兽去「采集」一趟吧。', 'bad');
      return;
    }
    if (foods.length === 1) {
      doCare('feed', foods[0]);
      return;
    }
    openModal({
      title: '🍚 喂什么？',
      body: foods
        .map((id) => {
          const item = ITEM_MAP[id];
          return `<button class="option" data-action="feed-with" data-item="${id}">
            ${item.emoji} <b>${esc(item.name)}</b> ×${state.inventory[id]}
            <span class="option__tag">饱食 +${item.use.hunger}${
              item.use.mood ? ` · 心情 +${item.use.mood}` : ''
            }${item.use.energy ? ` · 精力 +${item.use.energy}` : ''}</span>
          </button>`;
        })
        .join(''),
      foot: `<button class="btn btn--ghost btn--block" data-close-modal>算了</button>`,
    });
    return;
  }
  doCare(kind, null);
}

function doCare(kind, itemId) {
  let result = { ok: false, message: '' };
  store.set((state) => {
    result = careAction(state, kind, itemId);
  });
  toast(result.message, result.ok ? 'good' : 'bad');
  if (result.ok) {
    $('petAvatar').classList.add('is-happy');
    setTimeout(() => $('petAvatar')?.classList.remove('is-happy'), 1300);
  }
}

/** 升级建筑 */
function actionUpgrade(buildingId) {
  let result = { ok: false, message: '' };
  store.set((state) => {
    result = upgradeBuilding(state, buildingId);
  });
  toast(result.message, result.ok ? 'good' : 'bad');
}

/** 制作 */
function actionCraft(recipeId) {
  let result = { ok: false, message: '' };
  store.set((state) => {
    result = craft(state, recipeId);
  });
  toast(result.message, result.ok ? 'good' : 'bad');
}

/** 使用物品 */
function actionUseItem(itemId) {
  let result = { ok: false, message: '' };
  store.set((state) => {
    result = useItem(state, itemId);
  });
  toast(result.message, result.ok ? 'good' : 'bad');
  if (result.ok) closeModal();
}

/** 进化 */
function actionEvolve() {
  let result = { ok: false, message: '' };
  let branch = null;
  store.set((state) => {
    result = evolve(state);
    branch = result.branch ? EVOLUTION_BRANCHES[result.branch] : null;
  });
  if (!result.ok) {
    toast(result.message, 'bad');
    return;
  }
  const evolvedStage = stageById(result.stage) ?? STAGE_MAP.larva;
  openModal({
    title: '🌟 进化',
    body: `
      <div class="event__banner">
        <span class="event__emoji">${evolvedStage.emoji}</span>
        <div>
          <div class="event__title">${esc(evolvedStage.name)}</div>
          <div class="event__sub">${esc(evolvedStage.desc ?? '')}</div>
        </div>
      </div>
      ${branch ? `<p class="event__text">它选择了「${esc(branch.name)}」的道路。<br />${esc(branch.desc)}</p>
        <p class="muted small">${esc(branch.bonusText)}</p>` : '<p class="event__text">它还小，但光已经开始稳稳地亮着。</p>'}
      ${evolvedStage.infinite ? '<p class="muted small">形态还没有尽头 —— 它可以一直长下去。</p>' : ''}
    `,
    foot: `<button class="btn btn--primary btn--block" data-close-modal>继续</button>`,
  });
}

/* ------------------------------------------------------------------ */
/* 离线报告                                                            */
/* ------------------------------------------------------------------ */

/**
 * 弹出离线报告
 * @param {object} report settleOffline 的返回值
 * @param {{ countOfflineTime?: boolean }} [opts]
 */
export function showReportModal(report, opts = {}) {
  if (!report) {
    alertModal('📭 没有新的报告', '<p class="muted">星兽这段时间没什么特别的事要说。</p>');
    return;
  }
  view.lastReport = report;

  const from = formatClock(report.from);
  const to = formatClock(report.at);
  const elapsed = formatDuration(Math.max(0, report.rawElapsedMs));

  const lines = (report.story ?? [])
    .map((entry) => {
      const cls = entry.title === '时差晕眩' || entry.title === '余波' ? ' report__line--warn' : '';
      return `<div class="report__line${cls}">${esc(entry.line)}</div>`;
    })
    .join('');

  const items = mergeItems(report.items ?? []);
  const rewards = items.length
    ? items.map((it) => `<span class="reward reward--plus">${itemChip(it.id, it.amount)}</span>`).join('')
    : '<span class="muted small">这次没有带回物品。</span>';

  const deltas = describeDeltas(report.idleDeltas);
  const events = (report.events ?? []).length
    ? `<div class="report__section"><h4>随机事件</h4>${report.events
        .map(
          (e) =>
            `<div class="report__line">${e.eventEmoji ?? ''} <b>${esc(e.eventName ?? '')}</b>：${esc(
              e.optionText ?? '',
            )}<br /><span class="muted small">${esc(e.text ?? '')}</span></div>`,
        )
        .join('')}</div>`
    : '';

  const notes = (report.notes ?? []).length
    ? `<div class="report__section"><h4>提示</h4>${report.notes
        .map((n) => `<div class="report__line report__line--warn">${esc(n)}</div>`)
        .join('')}</div>`
    : '';

  const achievements = (report.achievements ?? []).length
    ? `<div class="report__section"><h4>解锁</h4><div class="reward-list">${report.achievements
        .map((id) => {
          const a = ACHIEVEMENTS.find((x) => x.id === id);
          return `<span class="reward reward--plus">${a?.emoji ?? '🏆'} ${esc(a?.name ?? id)}</span>`;
        })
        .join('')}</div></div>`
    : '';

  const zones = (report.newZones ?? []).length
    ? `<div class="report__section"><h4>新区域</h4><div class="reward-list">${report.newZones
        .map((id) => `<span class="reward reward--plus">🗺️ ${esc(getZone(id)?.name ?? id)}</span>`)
        .join('')}</div></div>`
    : '';

  const body = `
    <p class="report__lead">
      ${
        report.rewound
          ? '⚠️ 检测到时间倒退，本次只结算了保底收益。'
          : `你离开了 <b>${esc(elapsed)}</b>，星兽在这座小岛上做完了它自己的事。`
      }
    </p>
    <p class="report__meta">${esc(from)} → ${esc(to)} · 结算上限 ${esc(formatDuration(report.capMs ?? 0))}${
      report.task ? ` · 任务「${esc(report.task.name)}」` : ' · 这段时间没有安排任务'
    }</p>
    <div class="report__section"><h4>时间轴</h4>${
      lines || '<div class="report__line">它安静地待着，把海面的光数了很多遍。</div>'
    }</div>
    <div class="report__section"><h4>收获</h4><div class="reward-list">${rewards}</div></div>
    ${deltas ? `<div class="report__section"><h4>状态变化</h4><p class="muted small">${esc(deltas)}</p></div>` : ''}
    ${events}
    ${zones}
    ${achievements}
    ${notes}
  `;

  openModal({
    title: '🛰️ 离线探索报告',
    body,
    foot: `
      <button class="btn btn--primary btn--block" data-action="claim-report">领取并继续</button>
      <button class="btn btn--ghost btn--block" data-close-modal>稍后再看</button>
    `,
  });
}

/* ------------------------------------------------------------------ */
/* 事件弹窗                                                            */
/* ------------------------------------------------------------------ */

/**
 * 展示一个随机事件（二选一）
 * @param {object} event
 * @param {{ zoneId?: string|null, ts?: number, source?: string }} [ctx]
 */
export function showEventModal(event, ctx = {}) {
  if (!event) return;
  const state = store.state;
  const zoneId = ctx.zoneId ?? state.task.zoneId ?? null;
  const ts = ctx.ts ?? now();

  openModal({
    title: '✨ 随机事件',
    body: `
      <div class="event__banner">
        <span class="event__emoji">${event.emoji}</span>
        <div>
          <div class="event__title">${esc(event.name)}</div>
          <div class="event__sub">${zoneId ? esc(getZone(zoneId)?.name ?? '') : '小岛周边'}${
            ctx.source === 'offline' ? ' · 离线补算' : ''
          }</div>
        </div>
      </div>
      <p class="event__text">${esc(event.text)}</p>
      <p class="event__option-hint">选择星兽的做法：</p>
      ${event.options
        .map(
          (opt, index) => `
        <button class="option" data-action="event-option" data-index="${index}">
          ${esc(opt.text)}
          <span class="option__tag">${optionTag(opt, state)}</span>
        </button>`,
        )
        .join('')}
    `,
    onMount: (root) => {
      root.dataset.eventId = event.id;
      root.dataset.eventZone = zoneId ?? '';
      root.dataset.eventTs = String(ts);
    },
  });
}

/** 选项的模糊提示：不算精确数值，但告诉玩家倾向 */
function optionTag(option, state) {
  const outcome = typeof option.outcome === 'function' ? null : option.outcome;
  const tags = [];
  if (outcome?.delta) {
    if ((outcome.delta.mood ?? 0) > 0) tags.push('心情↑');
    if ((outcome.delta.mood ?? 0) < 0) tags.push('心情↓');
    if ((outcome.delta.energy ?? 0) < 0) tags.push('精力↓');
    if ((outcome.delta.intimacy ?? 0) > 0) tags.push('亲密↑');
    if ((outcome.delta.hunger ?? 0) < 0) tags.push('饱食↓');
  }
  if (outcome?.cost) {
    for (const [id, amount] of Object.entries(outcome.cost)) {
      const have = state.inventory[id] ?? 0;
      tags.push(`消耗 ${ITEM_MAP[id]?.name ?? id}×${amount}（持有 ${have}）`);
    }
  }
  if (outcome?.stats) {
    for (const [key, value] of Object.entries(outcome.stats)) {
      const attr = ATTR_KEYS.find((a) => a.id === key);
      tags.push(`${attr?.name ?? key}+${value}`);
    }
  }
  if (!outcome) tags.push('结果未知');
  return tags.join(' · ') || '结果未知';
}

/** 处理事件选项 */
function actionEventOption(index) {
  const root = $('modal');
  const eventId = root.dataset.eventId;
  const zoneId = root.dataset.eventZone || null;
  const ts = Number(root.dataset.eventTs) || now();
  const event = EVENTS.find((e) => e.id === eventId);
  if (!event) {
    closeModal();
    return;
  }

  const save = store.save;
  const rng = rngFrom(save.randomSeed, eventId, ts, 'player', zoneId ?? 'none');
  let result = { ok: false, message: '', detail: {} };
  store.set((state) => {
    result = resolveEventOption(state, event, index, { rng, zoneId, ts });
  });

  if (!result.ok) {
    toast(result.message, 'bad');
    return;
  }

  const detail = result.detail;
  const itemLine = (detail.items ?? []).length
    ? `<div class="reward-list">${detail.items
        .map((it) => `<span class="reward reward--plus">${itemChip(it.id, it.amount)}</span>`)
        .join('')}</div>`
    : '';
  // 消耗掉的物资也列出来，让玩家清楚代价
  const costLine = (detail.cost ?? []).length
    ? `<div class="reward-list">${detail.cost
        .map((it) => `<span class="reward reward--minus">−${itemChip(it.id, it.amount)}</span>`)
        .join('')}</div>`
    : '';
  const deltaLine = describeDeltas(detail.deltas);

  openModal({
    title: `${detail.eventEmoji ?? '✨'} ${esc(detail.eventName ?? '')}`,
    body: `
      <p class="muted small">你的选择：${esc(detail.optionText ?? '')}</p>
      <p class="event__text">${esc(detail.text ?? '')}</p>
      ${itemLine}
      ${costLine}
      ${deltaLine ? `<p class="muted small">状态变化：${esc(deltaLine)}</p>` : ''}
      ${
        (detail.achievements ?? []).length
          ? `<p class="muted small">🏆 解锁成就：${esc(
              detail.achievements.map((id) => ACHIEVEMENTS.find((a) => a.id === id)?.name ?? id).join('、'),
            )}</p>`
          : ''
      }
    `,
    foot: `<button class="btn btn--primary btn--block" data-action="close-and-check">继续</button>`,
  });
}

/* ------------------------------------------------------------------ */
/* 迁徙胶囊：导出 / 导入                                                */
/* ------------------------------------------------------------------ */

function actionExportFile() {
  const { filename, text } = exportCapsuleFile(store.save);
  downloadText(filename, text);
  toast('胶囊已封好，开始下载。', 'good');
}

function actionExportCode() {
  let code = '';
  try {
    code = encodeCapsuleCode(store.save);
  } catch (err) {
    toast('生成存档码失败：' + err.message, 'bad');
    return;
  }
  const kb = (code.length / 1024).toFixed(1);
  openModal({
    title: '🔗 存档码',
    body: `
      <p class="muted small">把下面的存档码复制到新设备即可唤醒星兽（约 ${kb} KB，适合小存档）。</p>
      <textarea id="capsuleCode" rows="6" readonly>${esc(code)}</textarea>
    `,
    foot: `
      <button class="btn btn--primary btn--block" data-action="copy-code">复制存档码</button>
      <button class="btn btn--ghost btn--block" data-action="download-code">下载为文件</button>
    `,
  });
}

function actionCopyCode() {
  const area = $('capsuleCode');
  if (!area) return;
  area.select();
  const done = () => toast('已复制。', 'good');
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(area.value).then(done).catch(() => {
      try {
        document.execCommand('copy');
        done();
      } catch {
        toast('复制失败，请手动长按选择。', 'bad');
      }
    });
  } else {
    try {
      document.execCommand('copy');
      done();
    } catch {
      toast('复制失败，请手动长按选择。', 'bad');
    }
  }
}

function actionDownloadCode() {
  const area = $('capsuleCode');
  if (!area) return;
  downloadText('迁徙胶囊_存档码.txt', area.value, 'text/plain');
}

function actionImportOpen() {
  openModal({
    title: '🚀 在新星门唤醒',
    body: `
      <p class="muted small">
        导入会替换或合并当前存档。<b>建议先「封入胶囊」备份一次</b>，避免误覆盖丢档。
      </p>
      <div class="btn-row">
        <button class="btn btn--primary btn--block" data-action="import-file">📂 选择胶囊文件（.json）</button>
      </div>
      <div class="field" style="margin-top:12px">
        <label for="importText">或粘贴存档码 / 存档 JSON</label>
        <textarea id="importText" rows="5" placeholder="粘贴「生成存档码」得到的 Base64 字符，或直接贴 json 内容"></textarea>
      </div>
      <p class="muted tiny">Base64 存档码与 JSON 都可以，二选一即可。</p>
      <button class="btn btn--block" data-action="import-text">解析这段文本</button>
      <p class="muted tiny" style="margin-top:10px">
        导入时会自动校验、修补缺失字段，并执行版本迁移；损坏的存档会被拒绝，不会污染本地数据。
      </p>
    `,
  });
}

/** 解析并弹出导入预览 */
function handleImportText(text) {
  const preview = prepareImport(text, store.save);
  if (!preview.ok) {
    importPreview = null;
    alertModal('⚠️ 无法导入', `<p class="muted">${preview.reasons?.map(esc).join('<br />') ?? '未知错误'}</p>`);
    return;
  }
  importPreview = preview;
  const incoming = preview.save;
  const conflict = preview.conflict;

  const migrationNote = preview.migrated
    ? `<p class="report__line">检测到旧版本存档（v${preview.from} → v${preview.to}），已自动迁移。</p>`
    : '';

  const compareTable = conflict
    ? `
      <table class="compare">
        <tr><th>项目</th><th>当前星门</th><th>胶囊</th></tr>
        <tr class="${conflict.newer === 'current' ? 'is-newer' : ''}">
          <td>上次结算</td><td class="num">${esc(formatClock(conflict.currentSettle))}</td>
          <td class="num">${esc(formatClock(conflict.incomingSettle))}</td>
        </tr>
        <tr class="${conflict.newer === 'incoming' ? 'is-newer' : ''}">
          <td>最后保存</td><td class="num">${esc(formatClock(conflict.currentSavedAt))}</td>
          <td class="num">${esc(formatClock(conflict.incomingSavedAt))}</td>
        </tr>
        <tr><td>星兽等级</td><td class="num">Lv.${conflict.currentLevel}</td><td class="num">Lv.${conflict.incomingLevel}</td></tr>
        <tr><td>图鉴条目</td><td class="num">${conflict.currentItems}</td><td class="num">${conflict.incomingItems}</td></tr>
        <tr><td>设备</td><td class="num tiny">${esc(conflict.currentDevice.slice(0, 12))}…</td><td class="num tiny">${esc(
          conflict.incomingDevice.slice(0, 12),
        )}…</td></tr>
      </table>
      <p class="muted small">
        更“新”的一份是：<b>${conflict.newer === 'incoming' ? '迁徙胶囊' : '当前星门'}</b>。
        资源与进度只能保留一份（避免刷档）；图鉴、成就、去过的区域可以合并。
      </p>
    `
    : '<p class="muted small">当前没有本地存档，直接唤星兽即可。</p>';

  openModal({
    title: '🛰️ 胶囊预览',
    body: `
      <div class="event__banner">
        <span class="event__emoji">${stageById(incoming.data.pet.stage)?.emoji ?? '🌟'}</span>
        <div>
          <div class="event__title">${esc(incoming.data.pet.name)} · Lv.${incoming.data.pet.level}</div>
          <div class="event__sub">来自设备 ${esc(String(incoming.deviceId).slice(0, 14))}… · 存档 v${incoming.v}</div>
        </div>
      </div>
      ${migrationNote}
      ${compareTable}
    `,
    foot: `
      ${
        conflict
          ? `<button class="btn btn--primary btn--block" data-action="import-apply" data-mode="${
              conflict.newer === 'incoming' ? 'replace' : 'merge'
            }">按建议导入（${
              conflict.newer === 'incoming' ? '替换为胶囊' : '合并图鉴成就'
            }）</button>
             <button class="btn btn--block" data-action="import-apply" data-mode="replace">强制用胶囊替换</button>
             <button class="btn btn--block" data-action="import-apply" data-mode="merge">只合并图鉴 / 成就</button>`
          : `<button class="btn btn--primary btn--block" data-action="import-apply" data-mode="replace">唤醒星兽</button>`
      }
      <button class="btn btn--ghost btn--block" data-close-modal>取消</button>
    `,
  });
}

/** 应用导入 */
function actionImportApply(mode) {
  const preview = importPreview;
  if (!preview?.ok) {
    toast('导入信息已失效，请重新选择文件。', 'bad');
    return;
  }
  if (mode === 'keep') {
    closeModal();
    return;
  }
  // 覆盖前自动留一份本地备份
  saveNow();
  const { save, message } = applyImport(preview.save, mode, store.save);
  store.replaceSave(save);
  saveNow();
  importPreview = null;
  closeModal({ silent: true });
  renderAll();
  switchPanel('home');
  toast(message, 'good');

  // 导入后立即结算一次（等价于"在新星门唤醒"）
  const { report } = settleFromStore(now());
  saveNow();
  if (report && (report.items.length || report.timeline.length)) {
    setTimeout(() => showReportModal(report), 300);
  }
}

/** 从文件导入 */
function actionImportFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,.sav,application/json,text/plain';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => handleImportText(String(reader.result ?? ''));
    reader.onerror = () => toast('读取文件失败。', 'bad');
    reader.readAsText(file, 'utf-8');
  });
  input.click();
}

/* ------------------------------------------------------------------ */
/* 统计与重置                                                          */
/* ------------------------------------------------------------------ */

function actionOpenStats() {
  const state = store.state;
  const save = store.save;
  const affinity = AFFINITY_KEYS.map(
    (k) =>
      `<span class="reward">${k.emoji} ${esc(k.name)} ${Math.round(
        state.progress.affinity[k.id] ?? 0,
      )}</span>`,
  ).join('');
  openModal({
    title: '📊 统计',
    body: `
      <dl class="kv">
        <dt>设备标识</dt><dd>${esc(save.deviceId)}</dd>
        <dt>换设备次数</dt><dd>${state.pet.memory.deviceCount ?? 1}</dd>
        <dt>导入胶囊次数</dt><dd>${state.imports?.count ?? 0}</dd>
        <dt>累计探索</dt><dd>${state.pet.memory.totalExplorations ?? 0} 次</dd>
        <dt>喂食 / 清洁 / 抚摸</dt><dd>${state.progress.careCounts.feed} / ${state.progress.careCounts.clean} / ${
          state.progress.careCounts.touch
        }</dd>
        <dt>研究点数</dt><dd>${Math.round(state.progress.researchPoints)}</dd>
        <dt>图鉴 / 见闻</dt><dd>${Object.keys(state.codex.items).length} / ${
          Object.keys(state.codex.encounters).length
        }</dd>
        <dt>出生时间</dt><dd>${esc(formatClock(state.pet.bornAt))}</dd>
        <dt>存档版本</dt><dd>v${save.v}</dd>
      </dl>
      <div class="report__section" style="margin-top:12px"><h4>亲和倾向</h4>
        <div class="reward-list">${affinity}</div>
        <p class="muted tiny" style="margin-top:6px">倾向值决定成体时的进化分支（需要 12 点以上）。</p>
      </div>
    `,
    foot: `<button class="btn btn--primary btn--block" data-close-modal>关闭</button>`,
  });
}

function actionNewGame() {
  openModal({
    title: '🌑 重新开始',
    body: `
      <p class="muted">
        这会放弃当前小岛上的全部进度（星兽、图鉴、成就、建筑），并且<b>无法撤销</b>。
        当前存档会自动留一份备份，但你更需要的是先封一枚迁徙胶囊。
      </p>
    `,
    foot: `
      <button class="btn btn--danger btn--block" data-action="new-game-confirm">我确定，重新开始</button>
      <button class="btn btn--block" data-action="export-file">先导出胶囊再决定</button>
      <button class="btn btn--ghost btn--block" data-close-modal>取消</button>
    `,
  });
}

/* ------------------------------------------------------------------ */
/* 事件委托                                                            */
/* ------------------------------------------------------------------ */

/** 导入预览（模块内暂存，操作完成后清空） */
let importPreview = null;

export function bindActions({ onRestart } = {}) {
  document.addEventListener('click', (ev) => {
    const target = ev.target.closest('[data-action], [data-nav], [data-close-modal]');
    if (!target) return;

    if (target.hasAttribute('data-close-modal')) {
      closeModal();
      return;
    }

    if (target.dataset.nav) {
      switchPanel(target.dataset.nav);
      return;
    }

    const action = target.dataset.action;
    switch (action) {
      case 'care':
        actionCare(target.dataset.kind);
        break;
      case 'feed-with':
        doCare('feed', target.dataset.item);
        closeModal({ silent: true });
        break;
      case 'use-item':
        actionUseItem(target.dataset.item);
        break;
      case 'item-detail':
        showItemModal(target.dataset.item);
        break;
      case 'start-task':
        actionStartTask(target.dataset.task);
        break;
      case 'task-cancel': {
        let result = { ok: false, message: '' };
        store.set((state) => {
          result = cancelTask(state);
        });
        toast(result.message, result.ok ? 'good' : 'bad');
        break;
      }
      case 'pick-zone':
        pendingZoneChoice = { taskId: pendingZoneChoice.taskId, zoneId: target.dataset.zone, from: 'explore' };
        renderAll();
        break;
      case 'craft':
        actionCraft(target.dataset.recipe);
        break;
      case 'upgrade':
        actionUpgrade(target.dataset.building);
        break;
      case 'evolve':
        actionEvolve();
        break;
      case 'bag-filter':
        view.bagFilter = target.dataset.filter;
        renderBag(store.state);
        break;
      case 'codex-tab':
        view.codexTab = target.dataset.tab;
        renderCodex(store.state);
        break;
      case 'event-option':
        actionEventOption(Number(target.dataset.index));
        break;
      case 'close-and-check':
        closeModal({ silent: true });
        checkAndShowEvolution();
        break;
      case 'open-report':
        if (view.pendingReport) {
          const report = view.pendingReport;
          view.pendingReport = null;
          showReportModal(report);
        } else if (view.lastReport) {
          showReportModal(view.lastReport);
        } else {
          toast('还没有报告，先去安排一次探索吧。', 'bad');
        }
        break;
      case 'claim-report':
        closeModal({ silent: true });
        toast('报告已领取，资源已入库。', 'good');
        checkAndShowEvolution();
        break;
      case 'export-file':
        actionExportFile();
        break;
      case 'export-code':
        actionExportCode();
        break;
      case 'copy-code':
        actionCopyCode();
        break;
      case 'download-code':
        actionDownloadCode();
        break;
      case 'import-open':
        actionImportOpen();
        break;
      case 'import-file':
        actionImportFile();
        break;
      case 'import-text': {
        const area = $('importText');
        if (!area?.value.trim()) {
          toast('请先粘贴存档码或 JSON。', 'bad');
          break;
        }
        handleImportText(area.value.trim());
        break;
      }
      case 'import-apply':
        actionImportApply(target.dataset.mode);
        break;
      case 'rename-pet': {
        const input = $('inputPetName');
        const name = input?.value.trim().slice(0, 12);
        if (!name) {
          toast('名字不能为空。', 'bad');
          break;
        }
        store.set((state) => {
          state.pet.name = name;
        });
        toast(`它现在叫「${name}」。`, 'good');
        break;
      }
      case 'open-stats':
        actionOpenStats();
        break;
      case 'new-game':
        actionNewGame();
        break;
      case 'new-game-confirm':
        closeModal({ silent: true });
        onRestart?.();
        break;
      default:
        break;
    }
  });

  // 点击星兽：随机小反应
  $('petAvatar')?.addEventListener('click', () => {
    const state = store.state;
    const lines = [
      '它歪了歪头，光晕晃了一下。',
      '它把爪子搭在你手上，又收回去。',
      '它盯着一颗不存在的星星看了一会儿。',
      '它打了个小喷嚏，周围浮起几点星尘。',
    ];
    if (state.task.active) {
      toast('星兽不在岛上，它在外面忙着。');
      return;
    }
    const line = lines[Math.floor(Math.random() * lines.length)];
    toast(line);
    $('petAvatar').classList.add('is-happy');
    setTimeout(() => $('petAvatar')?.classList.remove('is-happy'), 1300);
  });

  // 面板切换后按需重绘
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => switchPanel(tab.dataset.nav));
  });
}

/* ------------------------------------------------------------------ */
/* 事件 / 进化 检查                                                     */
/* ------------------------------------------------------------------ */

/**
 * 上线时：若当前任务已完成，补一次结算（在线完成）
 */
export function tickTaskCompletion() {
  const state = store.state;
  if (!state?.task.active) return null;
  if (now() < state.task.endsAt) return null;

  let result = { ok: false, message: '' };
  store.set((s) => {
    result = completeActiveTask(s, now(), store.save?.randomSeed ?? 0);
  });
  if (!result.ok) return null;

  openModal({
    title: '🔭 星兽回来了',
    body: `
      <div class="event__banner">
        <span class="event__emoji">${getTask(result.taskId)?.emoji ?? '🔭'}</span>
        <div>
          <div class="event__title">${esc(result.taskName)} · ${esc(result.zoneName)}</div>
          <div class="event__sub">耗时 ${esc(formatDuration(result.hours * 3600000))} · 经验 +${result.exp}${
            result.levelUps ? ` · 升级 ×${result.levelUps}` : ''
          }</div>
        </div>
      </div>
      <p class="event__text">${esc(result.story)}</p>
      <div class="reward-list">${
        (result.items ?? []).length
          ? result.items.map((it) => `<span class="reward reward--plus">${itemChip(it.id, it.amount)}</span>`).join('')
          : '<span class="muted small">这次没带回什么。</span>'
      }</div>
      ${
        describeDeltas(result.deltas)
          ? `<p class="muted small" style="margin-top:8px">状态变化：${esc(describeDeltas(result.deltas))}</p>`
          : ''
      }
    `,
    foot: `<button class="btn btn--primary btn--block" data-action="close-and-check">好</button>`,
  });

  // 完成后的事件排队
  for (const detail of result.events ?? []) {
    queueEventDetail(detail);
  }
  return result;
}

function queueEventDetail(detail) {
  if (!detail?.eventId) return;
  const event = EVENTS.find((e) => e.id === detail.eventId);
  if (event) view.eventQueue.push(event);
}

/** 进化条件达成时主动询问 */
export function checkAndShowEvolution() {
  const check = checkEvolution(store.state);
  if (!check.ok || !check.next) return;
  openModal({
    title: '🌟 星兽在发光',
    body: `
      <p class="event__text">
        你能感觉到它体内那点光正在重新排列。
        现在可以让它进化到「<b>${esc(stageById(check.next)?.name ?? '')}</b>」——
        ${esc(stageById(check.next)?.desc ?? '')}
      </p>
      <p class="muted small">进化会消耗满足条件的物品，并根据这段时间的照顾与探索方式决定分支。</p>
    `,
    foot: `
      <button class="btn btn--primary btn--block" data-action="evolve">现在进化</button>
      <button class="btn btn--ghost btn--block" data-close-modal>再等等</button>
    `,
  });
}

/** 设置待展示的离线报告（由 main.js 调用） */
export function setPendingReport(report) {
  view.pendingReport = report;
  if (report) view.lastReport = report;
}

/** 供 main.js 判断是否有未读报告 */
export function hasPendingReport() {
  return Boolean(view.pendingReport);
}

/** 首次进入：给星兽起名 */
export function showNamingModal(onDone) {
  openModal({
    title: '✦ 它醒过来了',
    body: `
      <p class="event__text">
        数据海的浅滩上漂来一枚胶囊。你打开它，一团还不太稳定的光落在你的手心里。
        它需要先有一个名字，才能知道自己是谁。
      </p>
      <div class="field">
        <label for="newPetName">给它起个名字（最多 12 个字）</label>
        <input type="text" id="newPetName" maxlength="12" placeholder="例如：小满、星九、阿尘" />
      </div>
      <div class="reward-list">
        ${['小满', '星九', '阿尘', '潮生', '拾光']
          .map((n) => `<button class="reward" data-action="pick-name" data-name="${n}">${n}</button>`)
          .join('')}
      </div>
    `,
    foot: `<button class="btn btn--primary btn--block" data-action="confirm-name">就是这个名字</button>`,
    onMount: (root) => {
      root.querySelectorAll('[data-action="pick-name"]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const input = $('newPetName');
          if (input) input.value = btn.dataset.name;
        });
      });
    },
  });
  // 命名确认的动作需要一次性回调
  const handler = (ev) => {
    const btn = ev.target.closest('[data-action="confirm-name"]');
    if (!btn) return;
    const name = $('newPetName')?.value.trim().slice(0, 12) || '星九';
    document.removeEventListener('click', handler, true);
    closeModal({ silent: true });
    onDone?.(name);
  };
  document.addEventListener('click', handler, true);
}

export { flashSaveChip };
