/**
 * offline.js —— 离线"时间胶囊"结算
 *
 * 世界观：你离开小岛后，星兽不会在后台运行。
 *       再次上线时，所有本该发生的事被压缩成一段"探索报告"，一次性结算。
 *
 * 关键设计：
 * 1. 只用时间戳：now - lastSettleTime，没有任何定时器 / Service Worker 参与。
 * 2. 确定性随机：种子 = randomSeed + 任务开始时间 + 任务类型 + 时间片序号。
 *    同一份存档、同一段离线时间、同一个任务，刷新页面结果完全一致。
 * 3. 收益封顶：12 小时以内正常，超出部分按 5% 保底，避免改系统时间无限刷。
 * 4. 时间倒退：now < lastSettleTime 时只给保底收益，并提示"星兽时差晕眩"。
 */

import { OFFLINE, TASK_MAP } from './data.js';
import { autoResolveEvent, pickEventForZone } from './events.js';
import { createRng, hash32 } from './rng.js';
import { addExp, addItem, applyDeltas, absorbStat, checkAutoAchievements, store, syncZoneUnlocks } from './state.js';
import { resolveTask } from './tasks.js';
import { formatDuration, now as currentTime } from './time.js';
import { describeItems, mergeItems } from './utils.js';

/** 空闲（没安排任务）时的每小时状态变化 */
const IDLE_DRAIN_PER_HOUR = { hunger: 3.4, mood: 1.3, energy: -4.5 };
/** 状态安全下限：低于该值星兽会优先照顾自己，不再继续掉 */
const IDLE_FLOOR = { hunger: 18, mood: 10, energy: 12 };

/**
 * 主入口：结算离线时间
 *
 * @param {object} state 游戏状态
 * @param {{ lastSettleTime: number, randomSeed: number }} save 存档元信息
 * @param {number} [ts] 当前时间戳
 * @returns {object} 离线报告（纯数据，UI 负责渲染）
 */
export function settleOffline(state, save, ts = currentTime()) {
  const lastSettleTime = Number(save?.lastSettleTime) || ts;
  const randomSeed = Number(save?.randomSeed) || 0;
  const rawDelta = ts - lastSettleTime;

  const report = {
    at: ts,
    from: lastSettleTime,
    rawElapsedMs: rawDelta,
    countedElapsedMs: 0,
    capMs: OFFLINE.capMs,
    overflowCounted: false,
    rewound: rawDelta < 0,
    apGained: 0,
    task: null,
    items: [],
    events: [],
    timeline: [],
    story: [],
    evolutions: [],
    achievements: [],
    newZones: [],
    notes: [],
    stats: null,
  };

  /* ---------- 情况 A：时间倒退（改过系统时间 / 换了时区） ---------- */
  if (rawDelta < 0) {
    const rng = createRng(hash32(randomSeed, 'rewind', ts));
    const stardust = rng.int(OFFLINE.rewind.stardust[0], OFFLINE.rewind.stardust[1]);
    const gain = [{ id: 'stardust', amount: stardust }, ...OFFLINE.rewind.items];
    for (const it of gain) addItem(state, it.id, it.amount);
    report.items = mergeItems(gain);
    report.notes.push('星兽时差晕眩：检测到时间倒退，本次只结算了保底收益。');
    report.timeline.push({
      at: ts,
      title: '时差晕眩',
      text: '它分不清现在是哪一天，只是把爪子搭在你手上，等你确认时间。',
      emoji: '😵‍💫',
    });
    finishReport(state, report, ts);
    return report;
  }

  const counted = Math.min(rawDelta, OFFLINE.capMs);
  const overflow = Math.max(0, rawDelta - OFFLINE.capMs);
  report.countedElapsedMs = counted;
  report.overflowCounted = overflow > 0;

  const hours = counted / 3600000;

  /* ---------- 情况 B0：任务还没结束 ---------- */
  // 玩家在任务跑完之前就回来了（刷新页面、切回来看看、只是关了一小会儿）。
  // 这时**绝对不能**判完成、发奖励、清任务 —— 否则一次刷新就等于把任务
  // 提前结算掉，剩下的时间白丢。正确做法是：
  //   · 只结算"已过去这段时间"的状态消耗与随机事件
  //   · 任务原样保留，上线后由心跳继续倒计时，到点再按在线路径结算
  if (state.task.active && state.task.startedAt && ts < state.task.endsAt) {
    if (counted > 0) {
      applyIdleTime(state, counted, randomSeed, lastSettleTime, report);
    }
    report.task = null;
    report.notes.push('任务还在进行中，回来后由岛上的时钟继续计时。');
    report.timeline.push({
      at: ts,
      title: '任务进行中',
      text: `${TASK_MAP[state.task.active]?.name ?? '任务'}还没结束，它还在外面。`,
      emoji: TASK_MAP[state.task.active]?.emoji ?? '🔭',
    });
    finishReport(state, report, ts);
    return report;
  }

  /* ---------- 情况 B：任务已经跑完 -> 走完整的任务结算 ---------- */
  if (state.task.active && state.task.startedAt) {
    const taskDef = TASK_MAP[state.task.active];
    // 任务完成时刻；离线很久时任务早已结束，剩余时间算作空闲
    const taskDoneAt = Math.min(ts, state.task.startedAt + Math.max(1, state.task.endsAt - state.task.startedAt));

    // 确定性随机：同一存档 + 同一任务起点 => 完全一致的结算
    const taskRng = createRng(
      hash32(randomSeed, state.task.active, state.task.startedAt, state.task.zoneId ?? 'none', 'offline'),
    );

    const result = resolveTask(state, {
      taskId: state.task.active,
      zoneId: state.task.zoneId,
      startedAt: state.task.startedAt,
      endsAt: state.task.endsAt,
      now: taskDoneAt,
      rng: taskRng,
    });

    if (result.ok) {
      report.task = {
        id: result.taskId,
        name: result.taskName,
        emoji: taskDef?.emoji ?? '🔭',
        zoneId: result.zoneId,
        zoneName: result.zoneName,
        hours: result.hours,
        exp: result.exp,
        levelUps: result.levelUps,
      };
      report.items = mergeItems(result.items);
      report.events = result.events ?? [];
      report.achievements.push(...(result.achievements ?? []));
      report.newZones.push(...(result.newZones ?? []));
      report.timeline.push({
        at: taskDoneAt,
        title: `${taskDef?.name ?? '任务'}完成`,
        text: result.story,
        emoji: taskDef?.emoji ?? '🔭',
        items: report.items,
      });
    }

    // 任务结束后剩余的空闲时间：继续消耗状态，并可能触发事件
    const idleMs = Math.max(0, ts - taskDoneAt);
    if (idleMs > 0) {
      applyIdleTime(state, idleMs, randomSeed, taskDoneAt, report);
    }

    // 任务结束，状态回到空闲
    state.task.active = null;
    state.task.startedAt = 0;
    state.task.endsAt = 0;
    state.task.zoneId = null;
  } else {
    /* ---------- 情况 C：没安排任务 -> 只是空等 ---------- */
    applyIdleTime(state, counted, randomSeed, lastSettleTime, report);
  }

  /* ---------- 超出 12 小时的部分：保底收益 ---------- */
  if (overflow > 0) {
    const rng = createRng(hash32(randomSeed, 'overflow', Math.floor(overflow / 60000)));
    const bonusHours = overflow / 3600000;
    const stardust = Math.max(1, Math.round(1.5 * bonusHours * OFFLINE.beyondRate));
    const gain = [{ id: 'stardust', amount: stardust }];
    if (rng.chance(0.35)) gain.push({ id: 'moss_ball', amount: 1 });
    for (const it of gain) addItem(state, it.id, it.amount);
    report.items = mergeItems([...report.items, ...gain]);
    report.notes.push(
      `离线超过 ${formatDuration(OFFLINE.capMs)}（共 ${formatDuration(rawDelta)}），超出的时间只结算了少量保底星尘。`,
    );
    report.timeline.push({
      at: ts,
      title: '余波',
      text: '太久没回来，岛上的时间自己折叠了几次。它把这些折痕都收进了口袋。',
      emoji: '⏳',
    });
  }

  finishReport(state, report, ts);
  return report;
}

/**
 * 空闲时间结算：状态消耗 + 触发随机事件
 * @param {object} state
 * @param {number} ms
 * @param {number} randomSeed
 * @param {number} baseTs
 * @param {object} report
 */
function applyIdleTime(state, ms, randomSeed, baseTs, report) {
  const hours = ms / 3600000;
  if (hours <= 0) return;

  // 1. 状态消耗
  //    状态可以超过舒适线 100，超出的部分就是留给你离线的缓冲：
  //    先吃溢出，再动核心值，最多扣到 IDLE_FLOOR 为止。
  const applied = {};
  for (const [key, perHour] of Object.entries(IDLE_DRAIN_PER_HOUR)) {
    if (perHour <= 0) {
      // 负数表示恢复（目前没有这种项，保留以兼容将来调整）
      const gained = applyDeltas(state, { [key]: Math.round(-perHour * hours) });
      Object.assign(applied, gained);
      continue;
    }
    const real = Math.round(absorbStat(state, key, perHour * hours, IDLE_FLOOR[key]));
    if (real !== 0) applied[key] = -real;
  }
  report.idleDeltas = applied;

  // 2. 事件：按时间片数量决定最多触发几次
  const slices = Math.min(Math.floor(ms / OFFLINE.sliceMs), 64);
  let triggered = 0;
  const rng = createRng(hash32(randomSeed, 'idle', baseTs, 'events'));
  const zoneId = state.unlockedZones[state.unlockedZones.length - 1] ?? 'shallow';

  for (let i = 0; i < slices; i++) {
    if (triggered >= 3) break; // 一次上线最多 3 个离线事件，避免报告刷屏
    if (!rng.chance(OFFLINE.eventChancePerSlice * 1.6)) continue;
    const sliceAt = baseTs + i * OFFLINE.sliceMs;
    const event = pickEventForZone(rng, zoneId);
    if (!event) continue;
    const result = autoResolveEvent(state, rng, zoneId, sliceAt);
    if (!result.ok) continue;
    triggered += 1;
    report.events.push(result.detail);
    report.achievements.push(...(result.detail.achievements ?? []));
    report.timeline.push({
      at: sliceAt,
      title: `${event.emoji} ${event.name}`,
      text: result.detail.text || event.text,
      emoji: event.emoji,
      items: mergeItems(result.detail.items ?? []),
    });
  }

  // 3. 空闲也会慢慢积累经验（很少）
  const exp = Math.round(hours * 3);
  if (exp > 0) addExp(state, exp);
}

/**
 * 收尾：行动点恢复、成就、区域解锁、记忆写入、状态快照
 */
function finishReport(state, report, ts) {
  // 星兽记忆：上次离开多久
  state.pet.memory.lastAwayMs = report.rawElapsedMs > 0 ? report.rawElapsedMs : 0;
  state.pet.memory.lastAwayAt = ts;
  state.lastSeen = ts;

  report.achievements = [...new Set([...report.achievements, ...checkAutoAchievements(state)])];
  report.newZones = [...new Set([...report.newZones, ...syncZoneUnlocks(state)])];
  report.stats = { ...state.pet.stats };
  report.level = state.pet.level;
  report.items = mergeItems(report.items);

  // 叙事：把 timeline 精简到上限条数
  report.timeline = report.timeline
    .sort((a, b) => a.at - b.at)
    .slice(0, OFFLINE.maxNarratives);
  report.story = report.timeline.map((entry) => {
    const offsetH = Math.max(0, (entry.at - report.from) / 3600000);
    return { ...entry, hour: offsetH, line: narrativeLine(entry, offsetH) };
  });
}

/**
 * 生成世界观化的报告句子
 * 例如："你离开的第 3 小时，星兽发现了一片发光苔藓。"
 */
function narrativeLine(entry, hour) {
  const hourText = hour < 1 ? '刚离开不久' : `你离开的第 ${formatHour(hour)}`;
  const prefix = entry.emoji ? `${entry.emoji} ` : '';
  const itemText = entry.items?.length ? ` 带回：${describeItems(entry.items)}。` : '';
  const head = entry.title ? `【${entry.title}】` : '';
  return `${prefix}${hourText}，${head}${entry.text}${itemText}`;
}

/** 小时数格式化：3.5 -> "3.5"，3 -> "3" */
function formatHour(hour) {
  const rounded = Math.round(hour * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded} 小时` : `${rounded.toFixed(1)} 小时`;
}

/** 报告里是否有"值得弹窗"的内容 */
export function hasContent(report) {
  return Boolean(
    report &&
      (report.task ||
        report.events?.length ||
        report.items?.length ||
        report.rewound ||
        report.overflowCounted ||
        report.newZones?.length),
  );
}

/**
 * 便捷方法：从 store 读取存档并结算（UI 使用）
 * @returns {{report: object, hasContent: boolean}}
 */
export function settleFromStore(ts = currentTime()) {
  let report = null;
  store.set((state) => {
    report = settleOffline(state, store.save, ts);
    if (store.save) store.save.lastSettleTime = ts;
  });
  return { report, hasContent: hasContent(report) };
}
