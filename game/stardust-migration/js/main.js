/**
 * main.js —— 引导与生命周期
 *
 * 流程：
 * 1. 读取本地存档（没有就新建）
 * 2. 绑定自动保存与页面生命周期（visibilitychange / pagehide 立即保存）
 * 3. 上线时结算离线时间胶囊 -> 弹出探索报告
 * 4. 启动 1 秒心跳：任务倒计时、任务完成、行动点每日恢复
 *
 * 注意：这里没有任何"后台运行"的机制。
 * setInterval 只在页面打开时存在；关掉网页后逻辑完全停止，只留下时间戳。
 */

import { settleFromStore } from './offline.js';
import {
  bindLifecycle,
  clearLocalSave,
  createNewSave,
  isPersistentStorage,
  readLocalSave,
  saveNow,
  startAutosave,
  writeLocalSave,
} from './save.js';
import { applyDailyReset, maxActionPoints, store } from './state.js';
import {
  bindActions,
  checkAndShowEvolution,
  flashSaveChip,
  hasPendingReport,
  renderAll,
  renderTaskTicker,
  setPendingReport,
  showNamingModal,
  showReportModal,
  switchPanel,
  tickTaskCompletion,
  toast,
} from './ui.js';
import { formatDuration, now } from './time.js';

/** 心跳间隔（毫秒） */
const TICK_MS = 1000;
/** 低频整页重绘间隔（心跳次数） */
const FULL_RENDER_EVERY = 15;

/** 是否为新档（第一次进入需要命名） */
let isFreshSave = false;

/**
 * 启动游戏
 */
function boot() {
  // 1. 读取存档
  const loaded = readLocalSave();
  let save;
  if (loaded.ok) {
    save = loaded.save;
    if (loaded.migrated) {
      console.info(`[main] 存档已从 v${loaded.from} 迁移到 v${loaded.to}`);
    }
  } else {
    save = createNewSave();
    isFreshSave = true;
    if (!loaded.empty) {
      console.warn('[main] 本地存档不可用：', loaded.reasons);
      toast('本地存档读取失败，已新建一座小岛。', 'bad');
    }
    writeLocalSave(save);
  }

  store.replaceSave(save);

  // 2. 自动保存 + 生命周期
  startAutosave();
  bindLifecycle({
    onSaved: (reason) => {
      if (!['visibilitychange', 'pagehide', 'blur'].includes(reason)) return;
      const chip = document.getElementById('chipSaveValue');
      if (chip) chip.textContent = '已存档';
    },
  });

  // 3. 交互绑定（"重新开始"也复用同一条路径）
  bindActions({
    onRestart: () => {
      saveNow();
      clearLocalSave({ keepBackup: true });
      const fresh = createNewSave();
      writeLocalSave(fresh);
      store.replaceSave(fresh);
      isFreshSave = true;
      switchPanel('home');
      renderAll();
      toast('新的小岛已经生成，旧存档留在备份里。', 'good');
      askNameIfNeeded();
    },
  });

  // 4. 首次渲染
  switchPanel('home');
  renderAll();
  flashSaveChip('已存档');

  // 5. 新档命名
  askNameIfNeeded();

  // 6. 存储不可用时给出明确提示（file:// 下的 Firefox / Safari，或隐私模式）
  if (!isPersistentStorage()) {
    setTimeout(
      () => toast('⚠️ 当前环境无法保存进度（只在内存中），请用「封入胶囊」保存。', 'bad'),
      1400,
    );
  }

  // 7. 离线时间胶囊结算
  settleOnBoot();
}

/** 新档时询问名字 */
function askNameIfNeeded() {
  if (!isFreshSave) return;
  showNamingModal((name) => {
    isFreshSave = false;
    store.set((state) => {
      state.pet.name = name;
      state.pet.bornAt = now();
    });
    saveNow();
    toast(`「${name}」记住了自己的名字。`, 'good');
  });
}

/**
 * 上线结算：整个"离线时间胶囊"的入口
 */
function settleOnBoot() {
  const elapsed = now() - store.save.lastSettleTime;

  // 先处理"每天都该恢复的行动点"
  let apGained = 0;
  store.set((state) => {
    const result = applyDailyReset(state, now());
    apGained = result.apGained;
  });

  const { report } = settleFromStore(now());
  saveNow();
  if (!report) return;

  // 离开不足 1 分钟且没有异常时静默处理
  const significant = Math.abs(elapsed) > 60 * 1000 || report.rewound || report.overflowCounted;
  setPendingReport(report);

  if (significant) {
    setTimeout(() => {
      if (hasPendingReport()) showReportModal(report);
    }, 420);
  }

  if (apGained > 0) {
    setTimeout(
      () => toast(`行动点恢复 +${apGained}（上限 ${maxActionPoints(store.state)}）。`, 'good'),
      900,
    );
  }
}

/**
 * 心跳：每秒一次，只在页面打开时运行
 */
function startTick() {
  let lastMinute = null;
  let ticks = 0;

  setInterval(() => {
    const ts = now();
    ticks += 1;

    // 1. 任务倒计时（高频但轻量，不整页重绘）
    renderTaskTicker();

    // 2. 任务完成检查
    const completed = tickTaskCompletion();
    if (completed) {
      // 任务完成后可能满足进化条件
      setTimeout(() => checkAndShowEvolution(), 600);
    }

    // 3. 每分钟检查一次"行动点每日恢复"
    const minuteKey = Math.floor(ts / 60000);
    if (lastMinute !== minuteKey) {
      lastMinute = minuteKey;
      let apGained = 0;
      let days = 0;
      store.set((state) => {
        const result = applyDailyReset(state, ts);
        apGained = result.apGained;
        days = result.days ?? 0;
      });
      if (apGained > 0) {
        toast(days > 1 ? `过了 ${days} 天，行动点恢复 +${apGained}。` : `新的一天，行动点 +${apGained}。`, 'good');
      }
    }

    // 4. 低频整页重绘（保证进度条与状态条不会长期失真）
    if (ticks % FULL_RENDER_EVERY === 0) renderAll();
  }, TICK_MS);

  console.info(
    `[星尘迁徙] 启动完成 · 设备 ${store.save.deviceId} · 存档 v${store.save.v} · ${
      store.save.data.pet.name
    } Lv.${store.save.data.pet.level} · 上次结算距今 ${formatDuration(now() - store.save.lastSettleTime)}`,
  );
}

/** DOM 就绪后启动 */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    boot();
    startTick();
  });
} else {
  boot();
  startTick();
}

/**
 * 注册 Service Worker（可选能力）
 *
 * 只用于"缓存 + 可安装"，让游戏离线也能打开。
 * 它不参与任何游戏逻辑：离线结算完全由 offline.js 在页面打开时一次性完成。
 * 注意：file:// 协议下无法注册，直接跳过。
 */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return; // 本地双击打开时不注册，避免报错
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).then(
      () => console.info('[星尘迁徙] Service Worker 已注册（仅用于缓存，不做后台模拟）。'),
      (err) => console.warn('[星尘迁徙] Service Worker 注册失败：', err),
    );
  });
}

registerServiceWorker();
