/**
 * AI 分析引擎 - 深蹲计数 + 姿势评判
 * MediaPipe Pose 所有资源已本地化到 /public/mediapipe/
 */

function loadPoseScript() {
  return new Promise((resolve, reject) => {
    if (typeof window !== 'undefined' && window.Pose) {
      console.log('[PoseAnalyzer] window.Pose 已存在')
      resolve(window.Pose)
      return
    }
    const existing = document.querySelector('script[data-mediapipe-pose]')
    if (existing) {
      existing.addEventListener('load', () => {
        console.log('[PoseAnalyzer] pose.js 加载完成, window.Pose =', typeof window.Pose)
        if (window.Pose) resolve(window.Pose)
        else reject(new Error('pose.js 加载但 window.Pose 未挂载'))
      })
      existing.addEventListener('error', () => reject(new Error('pose.js 加载失败')))
      return
    }
    const s = document.createElement('script')
    // 从本地 public/mediapipe/ 加载，无需网络
    s.src = './mediapipe/pose.js'
    s.setAttribute('data-mediapipe-pose', '')
    s.async = true
    s.onload = () => {
      console.log('[PoseAnalyzer] pose.js 加载完成, window.Pose =', typeof window.Pose)
      if (window.Pose) resolve(window.Pose)
      else reject(new Error('pose.js 加载但 window.Pose 未挂载'))
    }
    s.onerror = () => reject(new Error('无法加载 pose.js，请检查文件是否存在于 public/mediapipe/'))
    document.head.appendChild(s)
  })
}

// MediaPipe Pose landmark indices
const LM = {
  NOSE: 0,
  LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12,
  LEFT_HIP: 23,   RIGHT_HIP: 24,
  LEFT_KNEE: 25,  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27, RIGHT_ANKLE: 28,
  LEFT_HEEL: 29,  RIGHT_HEEL: 30,
}

class PoseAnalyzer {
  constructor() {
    this.pose = null
    this.initialized = false
    this._initPromise = null
  }

  async init() {
    if (this.initialized) return this
    if (this._initPromise) return this._initPromise

    this._initPromise = (async () => {
      console.log('[PoseAnalyzer] 开始加载 MediaPipe Pose...')
      const PoseCtor = await loadPoseScript()
      console.log('[PoseAnalyzer] Pose 构造函数:', PoseCtor.name)

      this.pose = new PoseCtor({
        // 所有模型文件从本地 ./mediapipe/ 加载
        locateFile: (file) => `./mediapipe/${file}`,
      })

      this.pose.setOptions({
        modelComplexity: 1,
        smoothLandmarks: true,
        enableSegmentation: false,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      })

      console.log('[PoseAnalyzer] 正在初始化 pose graph...')
      await this.pose.initialize()
      console.log('[PoseAnalyzer] 初始化完成')

      this.initialized = true
      this._initPromise = null
      return this
    })()

    return this._initPromise
  }

  async analyzeVideo(videoFile, onProgress) {
    await this.init()

    const url = URL.createObjectURL(videoFile)
    const video = document.createElement('video')
    video.preload = 'auto'
    video.src = url
    video.muted = true
    video.playsInline = true

    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve
      video.onerror = () => reject(new Error('视频加载失败'))
    })

    const duration = video.duration
    console.log('[PoseAnalyzer] 视频时长:', duration.toFixed(2) + 's',
                '分辨率:', video.videoWidth + 'x' + video.videoHeight)

    // 改用 onResults 回调模式 + send 返回值双通道
    let lastResult = null
    let resultResolve = null
    this.pose.onResults((r) => {
      lastResult = r
      if (resultResolve) resultResolve(r)
    })

    const SAMPLE_INTERVAL = 1 / 10 // 10fps，更稳
    const totalSamples = Math.max(3, Math.floor(duration / SAMPLE_INTERVAL))
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth || 640
    canvas.height = video.videoHeight || 480
    const ctx = canvas.getContext('2d')

    const frameResults = []
    let successCount = 0
    let failCount = 0
    let lastErr = null

    try {
      for (let sIdx = 0; sIdx < totalSamples; sIdx++) {
        const t = Math.min(sIdx * SAMPLE_INTERVAL, duration - 0.001)

        // 可靠的 seek + 微任务等待：确保当前帧绘制完成
        await new Promise((resolve) => {
          const handler = () => {
            video.removeEventListener('seeked', handler)
            // 等一帧确保 drawImage 数据就绪
            requestAnimationFrame(() => resolve())
          }
          video.addEventListener('seeked', handler)
          video.currentTime = t
        })

        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

        let landmarks = null
        try {
          // 同时：send 本身的返回值 和 onResults 回调都会给我们
          const r = await this.pose.send({ image: canvas })
          const actual = r || lastResult
          if (actual && actual.poseLandmarks && actual.poseLandmarks.length >= 20) {
            landmarks = actual.poseLandmarks
            successCount++
          } else if (sIdx < 3) {
            console.warn('[PoseAnalyzer] 第', sIdx, '帧返回无 landmarks, r=', !!r, 'lastResult=', !!lastResult)
          }
        } catch (e) {
          failCount++
          lastErr = e
          if (sIdx < 3) {
            console.error('[PoseAnalyzer] 第', sIdx, '帧 send 异常:', e?.message || e)
          }
        }

        frameResults.push({
          time: Math.round(sIdx * SAMPLE_INTERVAL * 1000),
          landmarks,
        })

        if (onProgress && sIdx % 2 === 0) {
          onProgress(Math.round((sIdx / totalSamples) * 100), sIdx, totalSamples)
        }
      }
    } finally {
      URL.revokeObjectURL(url)
    }

    if (onProgress) onProgress(100, totalSamples, totalSamples)
    console.log('[PoseAnalyzer] 推理完成: 成功', successCount, '帧, 失败', failCount, '帧')
    if (lastErr) console.warn('[PoseAnalyzer] 最后错误:', lastErr?.message || lastErr)

    const analysis = this.analyzeLandmarks(frameResults)
    // 为结果页回放保留关键点（最多保留100帧，避免 sessionStorage 过大）
    const validKps = frameResults.filter(f => f.landmarks)
      .map(f => ({ frame: 0, time: f.time, landmarks: f.landmarks }))
    analysis.keypoints = validKps.slice(0, 100)
    console.log('[PoseAnalyzer] 分析结果:', JSON.stringify({
      count: analysis.totalCount,
      score: analysis.poseScore,
      validFrames: validKps.length,
      totalFrames: frameResults.length,
    }))

    return analysis
  }

  analyzeLandmarks(frameResults) {
    const validFrames = frameResults.filter(f => f.landmarks)

    if (validFrames.length < 3 || validFrames.length < frameResults.length * 0.3) {
      console.warn('[PoseAnalyzer] 有效人体帧过少:', validFrames.length, '/', frameResults.length)
      return {
        totalCount: 0,
        repTimestamps: [],
        rhythmStats: { fastest: 0, slowest: 0, average: 0 },
        poseScore: 0,
        poseRating: 'need_improve',
        poseDimensions: this.getDefaultDimensions(),
        keypoints: [],
      }
    }

    const features = validFrames.map(f => ({
      ...this.extractFeatures(f.landmarks),
      time: f.time,
    }))

    const countResult = this.countSquats(features)
    const deepestIdx = this.findDeepestFrameIdx(features)
    const deepestLandmarks = validFrames[deepestIdx]?.landmarks

    const poseResult = deepestLandmarks
      ? this.evaluatePose(deepestLandmarks)
      : { dimensions: this.getDefaultDimensions(), score: 0, rating: 'need_improve' }

    return {
      totalCount: countResult.totalCount,
      repTimestamps: countResult.repTimestamps,
      rhythmStats: countResult.rhythmStats,
      poseScore: poseResult.score,
      poseRating: poseResult.rating,
      poseDimensions: poseResult.dimensions,
      keypoints: [],
    }
  }

  extractFeatures(landmarks) {
    const hipL = landmarks[LM.LEFT_HIP], hipR = landmarks[LM.RIGHT_HIP]
    const kneeL = landmarks[LM.LEFT_KNEE], kneeR = landmarks[LM.RIGHT_KNEE]
    const ankleL = landmarks[LM.LEFT_ANKLE], ankleR = landmarks[LM.RIGHT_ANKLE]
    const shoulderL = landmarks[LM.LEFT_SHOULDER], shoulderR = landmarks[LM.RIGHT_SHOULDER]

    return {
      hipY: (hipL.y + hipR.y) / 2,
      hipX: (hipL.x + hipR.x) / 2,
      kneeY: (kneeL.y + kneeR.y) / 2,
      kneeX: (kneeL.x + kneeR.x) / 2,
      ankleY: (ankleL.y + ankleR.y) / 2,
      ankleX: (ankleL.x + ankleR.x) / 2,
      shoulderY: (shoulderL.y + shoulderR.y) / 2,
      shoulderX: (shoulderL.x + shoulderR.x) / 2,
    }
  }

  countSquats(features) {
    if (features.length < 5) {
      return { totalCount: 0, repTimestamps: [], rhythmStats: { fastest: 0, slowest: 0, average: 0 } }
    }

    // 平滑
    const WINDOW = 4
    const smoothed = features.map((_, i) => {
      const start = Math.max(0, i - WINDOW)
      const end = Math.min(features.length, i + WINDOW + 1)
      let sum = 0, cnt = 0
      for (let j = start; j < end; j++) { sum += features[j].hipY; cnt++ }
      return sum / cnt
    })

    // 站立基线 = 最小 15% 的平均值
    const sorted = [...smoothed].sort((a, b) => a - b)
    const n = Math.max(1, Math.floor(sorted.length * 0.15))
    const baseline = sorted.slice(0, n).reduce((a, b) => a + b, 0) / n

    const mean = smoothed.reduce((a, b) => a + b, 0) / smoothed.length
    const swing = mean - baseline
    const SQUAT_THRESHOLD = baseline + swing * 0.5

    console.log('[PoseAnalyzer] 计数参数: baseline=', baseline.toFixed(3),
                'swing=', swing.toFixed(3), 'threshold=', SQUAT_THRESHOLD.toFixed(3))

    // 状态机
    const reps = []
    let state = 'standing'
    let repStart = -1

    for (let i = 1; i < smoothed.length; i++) {
      const cur = smoothed[i]
      const prev = smoothed[i - 1]

      if (state === 'standing') {
        if (cur > SQUAT_THRESHOLD && cur > prev) {
          state = 'squatting'
          repStart = i
        }
      } else {
        if (cur < baseline + swing * 0.1 && cur < prev) {
          state = 'standing'
          if (repStart > 0 && i - repStart >= 3) {
            reps.push({
              start: features[repStart].time,
              end: features[i].time,
              frameStart: repStart,
              frameEnd: i,
            })
          }
          repStart = -1
        }
      }
    }

    const durations = reps.map(r => r.end - r.start)
    let rhythmStats = { fastest: 0, slowest: 0, average: 0 }
    if (durations.length > 0) {
      rhythmStats = {
        fastest: Math.round(Math.min(...durations)),
        slowest: Math.round(Math.max(...durations)),
        average: Math.round(durations.reduce((a, b) => a + b, 0) / durations.length),
      }
    }

    console.log('[PoseAnalyzer] 检测到深蹲:', reps.length, '次')
    return { totalCount: reps.length, repTimestamps: reps, rhythmStats }
  }

  findDeepestFrameIdx(features) {
    let maxY = -1, idx = -1
    for (let i = 0; i < features.length; i++) {
      if (features[i].hipY > maxY) { maxY = features[i].hipY; idx = i }
    }
    return idx
  }

  evaluatePose(landmarks) {
    const L = (i) => landmarks[i]
    const hipL = L(LM.LEFT_HIP), hipR = L(LM.RIGHT_HIP)
    const kneeL = L(LM.LEFT_KNEE), kneeR = L(LM.RIGHT_KNEE)
    const ankleL = L(LM.LEFT_ANKLE), ankleR = L(LM.RIGHT_ANKLE)
    const shoulderL = L(LM.LEFT_SHOULDER), shoulderR = L(LM.RIGHT_SHOULDER)

    const hipY = (hipL.y + hipR.y) / 2
    const kneeY = (kneeL.y + kneeR.y) / 2
    const ankleX = (ankleL.x + ankleR.x) / 2
    const kneeX = (kneeL.x + kneeR.x) / 2
    const hipX = (hipL.x + hipR.x) / 2
    const shoulderY = (shoulderL.y + shoulderR.y) / 2
    const shoulderX = (shoulderL.x + shoulderR.x) / 2

    // 1. 下蹲深度
    const depthOK = hipY >= kneeY - 0.03
    const depth = depthOK
      ? { status: 'ok', detail: '下蹲深度达标，大腿接近或低于水平线', suggestion: '' }
      : { status: 'warn', detail: `髋部比膝盖高约 ${Math.max(1, Math.round((kneeY - hipY) * 100))}%，蹲得偏浅`,
          suggestion: '下蹲时想象要坐到身后的椅子上，确保大腿与地面平行或更低' }

    // 2. 膝盖方向
    const kneeOffsetL = kneeL.x - hipL.x
    const kneeOffsetR = hipR.x - kneeR.x
    const kneeDirOK = Math.abs(kneeOffsetL - kneeOffsetR) < 0.15
    const kneeDir = kneeDirOK
      ? { status: 'ok', detail: '膝盖方向与髋部对齐正常', suggestion: '' }
      : { status: 'warn', detail: '膝盖与髋部对齐有偏差，可能存在内扣或外撇',
          suggestion: '注意膝盖与脚尖方向一致，下蹲时膝盖向外打开' }

    // 3. 膝盖过脚尖
    const ankleSpan = Math.abs(ankleL.x - ankleR.x) || 0.3
    const kneeOverRatio = Math.abs(kneeX - ankleX) / ankleSpan
    const kneeOverOK = kneeOverRatio < 0.8
    const kneeOver = kneeOverOK
      ? { status: 'ok', detail: '膝盖未过度超过脚尖', suggestion: '' }
      : { status: 'warn', detail: '膝盖相对脚尖的前移量较大',
          suggestion: '下蹲时重心后移到脚跟，注意膝盖不要超过脚尖太多' }

    // 4. 背部挺直
    const backAngle = this.calcAngle(
      { x: shoulderX, y: shoulderY },
      { x: hipX, y: hipY },
      { x: kneeX, y: kneeY }
    )
    const backOK = backAngle >= 150
    const back = backOK
      ? { status: 'ok', detail: `背部挺直度良好（夹角约 ${Math.round(backAngle)}°）`, suggestion: '' }
      : { status: 'warn', detail: `背部有弯曲（夹角约 ${Math.round(backAngle)}°）`,
          suggestion: '保持核心收紧，想象头顶向上延伸，避免弓背或塌腰' }

    // 5. 身体前倾
    const leanAngle = Math.abs(
      Math.atan2(Math.abs(shoulderX - hipX), Math.max(0.01, hipY - shoulderY)) * 180 / Math.PI
    )
    const leanOK = leanAngle < 45
    const lean = leanOK
      ? { status: 'ok', detail: `身体前倾角度正常（约 ${Math.round(leanAngle)}°）`, suggestion: '' }
      : { status: 'warn', detail: `身体前倾较多（约 ${Math.round(leanAngle)}°）`,
          suggestion: '保持躯干直立，核心收紧，必要时可以扶墙练习平衡' }

    const dimensions = { depth, kneeDir, kneeOver, back, lean }

    let okCount = 0
    for (const k of Object.keys(dimensions)) if (dimensions[k].status === 'ok') okCount++
    let score = Math.round(okCount * 20)
    if (backAngle >= 165) score += 3
    if (depthOK) score += 2
    if (leanAngle < 30) score += 2
    score = Math.min(100, score)

    let rating = 'need_improve'
    if (score >= 90) rating = 'excellent'
    else if (score >= 75) rating = 'good'
    else if (score >= 60) rating = 'pass'

    return { dimensions, score, rating }
  }

  calcAngle(a, b, c) {
    const v1x = a.x - b.x, v1y = a.y - b.y
    const v2x = c.x - b.x, v2y = c.y - b.y
    const dot = v1x * v2x + v1y * v2y
    const m1 = Math.sqrt(v1x * v1x + v1y * v1y)
    const m2 = Math.sqrt(v2x * v2x + v2y * v2y)
    const cos = Math.max(-1, Math.min(1, dot / (m1 * m2 + 1e-8)))
    return Math.acos(cos) * 180 / Math.PI
  }

  getDefaultDimensions() {
    return {
      depth:    { status: 'warn', detail: '未检测到有效人体', suggestion: '请确保全身入镜，光线充足' },
      kneeDir:  { status: 'warn', detail: '未检测到有效人体', suggestion: '请确保全身入镜，光线充足' },
      kneeOver: { status: 'warn', detail: '未检测到有效人体', suggestion: '请确保全身入镜，光线充足' },
      back:     { status: 'warn', detail: '未检测到有效人体', suggestion: '请确保全身入镜，光线充足' },
      lean:     { status: 'warn', detail: '未检测到有效人体', suggestion: '请确保全身入镜，光线充足' },
    }
  }
}

export const poseAnalyzer = new PoseAnalyzer()

export const POSE_CONNECTIONS = [
  [11, 12], [11, 23], [12, 24], [23, 24],
  [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20],
  [23, 25], [25, 27], [27, 29], [27, 31], [29, 31],
  [24, 26], [26, 28], [28, 30], [28, 32], [30, 32],
]
