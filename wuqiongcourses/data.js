/**
 * 无穹书院 人工智能专业本科培养方案 - 课程数据
 *
 * 使用说明：
 * - 录入成绩：将 score 字段从 "未修" 改为绩点数值（如 4.0, 3.7, 3.3）
 * - "已选课"：表示已选课但尚未获得成绩
 * - 多选一课程：只保留所选课程的数据行，为其填入成绩即可
 * - 通识选修课：在 generalEducation 的四个课组中填入所选课程名称与成绩
 */

var curriculumData = {
  meta: {
    title: "无穹书院<br>人工智能专业本科培养方案",
    version: "2025级",
    lastUpdated: "2026-05-25"
  },

  student: {
    name: "童湘杰",
    studentId: "2025013206",
    major: "无穹书院",
    direction: "具身智能"
  },

  // 学分要求概览
  creditRequirements: [
    { category: "校级通识教育", required: 47, key: "general" },
    { sub: "思想政治理论课", required: 18, key: "ideology" },
    { sub: "体育", required: 4, key: "pe" },
    { sub: "外语", required: 8, key: "foreignLang" },
    { sub: "写作与沟通", required: 2, key: "writing" },
    { sub: "通识选修课", required: 11, key: "liberal" },
    { sub: "军事课程", required: 4, key: "military" },
    { category: "基础课程", required: "44-49", key: "foundation" },
    { sub: "数学基础", required: 25, key: "math" },
    { sub: "科学基础", required: "4-9", key: "science" },
    { sub: "信息基础", required: 15, key: "informatics" },
    { category: "专业核心课程", required: 16, key: "core" },
    { category: "专业选修课程", required: "20-26", key: "elective" },
    { category: "创新实践环节", required: 18, key: "practice" },
    { total: true, required: "146-150", key: "total" }
  ],

  // ====== 通识选修课（四个课组） ======
  // 书院定制通识课已分布在学期数据中：
  //   脑与认知科学(3学分) -> 科学课组
  //   人工智能伦理与社会(3学分) -> 社科课组
  // 以下请自行填写各课组其他选修课程
  generalEducation: {
    note: "通识选修课共需11学分。书院定制通识课（脑与认知科学3cr计入科学课组、人工智能伦理与社会3cr计入社科课组）已包含在学期数据中。以下四个课组各至少需2学分，请自行填写所选课程。",
    groups: [
      {
        name: "人文",
        required: 2,
        courses: [
          { name: "老庄研读", credits: 3, score: "4.0", remark: "" }
        ]
      },
      {
        name: "社科",
        required: 2,
        courses: [
          { name: "人工智能伦理与社会", credits: 3, score: "未修", remark: "" },
          { name: "实验室科研探究（1）", credits: 1, score: "P", remark: "" },
          { name: "实验室科研探究（2）", credits: 1, score: "已选课", remark: "" }
        ]
      },
      {
        name: "艺术",
        required: 2,
        courses: [
          { name: "电影音乐鉴赏", credits: 2, score: "已选课", remark: "" }
        ]
      },
      {
        name: "科学",
        required: 2,
        courses: [
          { name: "脑与认知科学", credits: 0, score: "未修", remark: "" }
        ]
      }
    ]
  },

  // ====== 按学期组织的课程数据 ======
  // score: 绩点数值（如4.0）/ "已选课" / "未修"
  // 多选一课程只保留所选的那一行，alternatives 字段列出其他可选方案（仅作参考展示）
  semesters: [

    // ========== 第一学年 ==========
    {
      year: "第一学年",
      season: "入学前（军事课程）",
      note: "建议修读学分: 4",
      courses: [
        { id: "12090052", name: "军事理论", credits: 2, category: "军事课程", score: "4.0", remark: "" },
        { id: "12090062", name: "军事技能", credits: 2, category: "军事课程", score: "3.3", remark: "3周" }
      ]
    },
    {
      year: "第一学年",
      season: "秋季学期",
      note: "建议修读学分: 21",
      courses: [
        { id: "30420095", name: "微积分A(1)", credits: 5, category: "数学基础", score: "4.0", remark: "另可选：高等微积分(1)" },
        { id: "30240233", name: "程序设计基础", credits: 3, category: "信息基础", score: "3.6", remark: "另可选：34100063 程序设计基础" },
        { id: "10421324", name: "线性代数", credits: 4, category: "数学基础", score: "3.6", remark: "" },
        { id: "10680053", name: "思想道德与法治", credits: 3, category: "思想政治理论课", score: "4.0", remark: "" },
        { id: "10680101", name: "形势与政策(1)-秋", credits: 1, category: "思想政治理论课", score: "P", remark: "" },
        { id: "14201002", name: "英语(1)", credits: 2, category: "外语", score: "免修", remark: "" },
        { id: "10720011", name: "体育(1)", credits: 1, category: "体育", score: "2.6", remark: "" }
      ]
    },
    {
      year: "第一学年",
      season: "春季学期",
      note: "建议修读学分: 21",
      courses: [
        { id: "30420105", name: "微积分A(2)", credits: 5, category: "数学基础", score: "已选课", remark: "另可选：高等微积分(2)" },
        { id: "30240532", name: "面向对象程序设计基础", credits: 2, category: "信息基础", score: "已选课", remark: "另可选：34100362 面向对象程序设计基础" },
        { id: "10880012", name: "概率论", credits: 2, category: "数学基础", score: "已选课", remark: "" },
        { id: "10430934", name: "大学物理A(1)", credits: 4, category: "科学基础", score: "已选课", remark: "AI专业方向可选；另可選：大学物理B(1)、大学物理(1)英" },
        { id: "10610193", name: "中国近现代史纲要", credits: 3, category: "思想政治理论课", score: "已选课", remark: "" },
        { id: "10680131", name: "形势与政策(2)-春", credits: 1, category: "思想政治理论课", score: "已选课", remark: "" },
        { id: "14201012", name: "英语(2)", credits: 2, category: "外语", score: "免修", remark: "" },
        { id: "10691342", name: "写作与沟通", credits: 2, category: "写作与沟通", score: "已选课", remark: "" },
        { id: "10720021", name: "体育(2)", credits: 1, category: "体育", score: "已选课", remark: "" }
      ]
    },
    {
      year: "第一学年",
      season: "夏季学期",
      note: "建议修读学分: 4",
      courses: [
        { id: "30940022", name: "AI基石设计", credits: 2, category: "创新实践环节", score: "已选课", remark: "" },
        { id: "10680092", name: "思政实践", credits: 2, category: "思想政治理论课", score: "已选课", remark: "建议大一大二暑期选修" }
      ]
    },

    // ========== 第二学年 ==========
    {
      year: "第二学年",
      season: "秋季学期",
      note: "建议修读学分: 22",
      courses: [
        { id: "30160263", name: "统计推断", credits: 3, category: "数学基础", score: "未修", remark: "" },
        { id: "30240184", name: "数据结构", credits: 4, category: "信息基础", score: "未修", remark: "另可选：34100373 数据结构(3学分)" },
        { id: "20240143", name: "离散数学(1)", credits: 3, category: "数学基础", score: "未修", remark: "" },
        { id: "20240152", name: "人工智能导论", credits: 2, category: "专业核心课程", score: "未修", remark: "另可选：30940032 / 44100102" },
        { id: "10680073", name: "马克思主义基本原理", credits: 3, category: "思想政治理论课", score: "未修", remark: "" },
        { id: "10720031", name: "体育(3)", credits: 1, category: "体育", score: "未修", remark: "" },
        { id: "14201022", name: "英语(3)", credits: 2, category: "外语", score: "未修", remark: "" },
        { id: "10430944", name: "大学物理A(2)", credits: 4, category: "科学基础", score: "未修", remark: "AI专业方向可选；另可選：大学物理B(2)、大学物理(2)英" },
        { id: "10430801", name: "物理实验B(1)", credits: 1, category: "科学基础", score: "未修", remark: "AI专业方向选修" }
      ]
    },
    {
      year: "第二学年",
      season: "春季学期",
      note: "建议修读学分: 22",
      courses: [
        { id: "new001", name: "最优化方法", credits: 3, category: "数学基础", score: "未修", remark: "新开课" },
        { id: "new002", name: "信息论", credits: 3, category: "信息基础", score: "未修", remark: "新开课" },
        { id: "new003", name: "计算机组成原理与系统", credits: 3, category: "信息基础", score: "未修", remark: "新开课" },
        { id: "new004", name: "机器学习", credits: 3, category: "专业核心课程", score: "未修", remark: "新开课；另可选：统计机器学习(40880043)" },
        { id: "10430811", name: "物理实验B(2)", credits: 1, category: "科学基础", score: "未修", remark: "AI专业方向选修，先修物理实验B(1)" },
        { id: "10680142", name: "毛泽东思想和中国特色社会主义理论体系概论", credits: 2, category: "思想政治理论课", score: "未修", remark: "" },
        { id: "10680022", name: "习近平新时代中国特色社会主义思想概论", credits: 2, category: "思想政治理论课", score: "未修", remark: "" },
        { id: "14201032", name: "英语(4)", credits: 2, category: "外语", score: "未修", remark: "" },
        { id: "10720041", name: "体育(4)", credits: 1, category: "体育", score: "未修", remark: "" },
        { id: "elec_s2_1", name: "人工智能选修课组", credits: 3, category: "专业选修课程", score: "未修", remark: "二选一；另可选：项目式学习" }
      ]
    },
    {
      year: "第二学年",
      season: "夏季学期",
      note: "建议修读学分: 2（AI专业方向限选）",
      courses: [
        { id: "new005", name: "AI智能体创新实践", credits: 2, category: "创新实践环节", score: "未修", remark: "AI专业方向限选" }
      ]
    },

    // ========== 第三学年 ==========
    {
      year: "第三学年",
      season: "秋季学期",
      note: "建议修读学分: 15",
      courses: [
        { id: "new006", name: "脑与认知科学", credits: 3, category: "通识选修课", score: "未修", remark: "书院定制通识课（计入科学课组）" },
        { id: "80240743", name: "深度学习", credits: 3, category: "专业核心课程", score: "未修", remark: "二选一；另可选：84100343 深度学习" },
        { id: "ideology_limit", name: "思政限选课", credits: 1, category: "思想政治理论课", score: "未修", remark: "限选（四史等）" },
        { id: "lib_elec_1", name: "通识选修课", credits: 3, category: "通识选修课", score: "未修", remark: "人文/社科/艺术/科学" },
        { id: "elec_s3_1", name: "人工智能选修课组", credits: 5, category: "专业选修课程", score: "未修", remark: "二选一；另可选：人工智能选修课组+项目式学习" }
      ]
    },
    {
      year: "第三学年",
      season: "春季学期",
      note: "建议修读学分: 16",
      courses: [
        { id: "new007", name: "计算机视觉", credits: 3, category: "专业核心课程", score: "未修", remark: "二选一；另可选：自然语言处理" },
        { id: "40241012", name: "强化学习", credits: 3, category: "专业核心课程", score: "未修", remark: "" },
        { id: "new009", name: "人工智能伦理与社会", credits: 3, category: "通识选修课", score: "未修", remark: "书院定制通识课（计入社科课组）" },
        { id: "elec_s4_1", name: "人工智能选修课组", credits: 5, category: "专业选修课程", score: "未修", remark: "" },
        { id: "lib_elec_2", name: "通识选修课", credits: 2, category: "通识选修课", score: "未修", remark: "人文/社科/艺术/科学" }
      ]
    },
    {
      year: "第三学年",
      season: "夏季学期",
      note: "建议修读学分: 2",
      courses: [
        { id: "new010", name: "专业实践", credits: 2, category: "创新实践环节", score: "未修", remark: "新开课" }
      ]
    },

    // ========== 第四学年 ==========
    {
      year: "第四学年",
      season: "秋季学期",
      note: "建议修读学分: 15",
      courses: [
        { id: "elec_s5_1", name: "人工智能选修课组", credits: 15, category: "专业选修课程", score: "未修", remark: "二选一；另可选：人工智能选修课组+项目式学习" }
      ]
    },
    {
      year: "第四学年",
      season: "春季学期",
      note: "建议修读学分: 8",
      courses: [
        { id: "new011", name: "综合论文训练", credits: 8, category: "创新实践环节", score: "未修", remark: "二选一；另可选：论文写作+人工智能选修课组" }
      ]
    }
  ],

  // ====== 专业选修课组详细列表 ======
  electiveGroups: {
    title: "人工智能专业方向选修课组（三横两纵：先进模型与算法、智能信息处理、AI软硬件基础、具身智能、人工智能安全。需至少覆盖3个课组，总学分不少于20学分）",
    groups: [
      {
        name: "课组1：先进模型与算法",
        required: [
          { id: "10421382", name: "高等线性代数选讲", credits: 2, remark: "A类必修，先修线性代数" },
          { id: "20240023", name: "离散数学(1)", credits: 3, remark: "A类必修，二选一" },
          { id: "24100013", name: "离散数学(2)", credits: 3, remark: "A类必修，二选一，先修离散数学(1)" },
          { id: "new013", name: "生成式人工智能", credits: 3, remark: "A类必修，先修深度学习" }
        ],
        optional: [
          { id: "44100582", name: "算法分析与设计基础", credits: 2 },
          { id: "40241003", name: "理论计算机科学导论", credits: 3 },
          { id: "10420252", name: "复变函数引论", credits: 2, remark: "先修微积分(1)(2)" },
          { id: "40160853", name: "因果推断导论", credits: 3 },
          { id: "40160833", name: "贝叶斯统计导论", credits: 3 },
          { id: "30470154", name: "博弈论", credits: 4, remark: "二选一" },
          { id: "40241092", name: "智能博弈基础", credits: 2, remark: "二选一" },
          { id: "40240432", name: "形式语言与自动机", credits: 2 },
          { id: "new014", name: "程序验证原理", credits: 3 },
          { id: "40240963", name: "量子计算研讨课", credits: 3 },
          { id: "30880023", name: "数据分析引论", credits: 3 },
          { id: "40160763", name: "多元统计分析", credits: 3 }
        ]
      },
      {
        name: "课组2：智能信息处理",
        required: [
          { id: "30240063", name: "信号处理原理", credits: 3, remark: "A类必修，三选一" },
          { id: "30230104", name: "信号与系统", credits: 4, remark: "A类必修，三选一" },
          { id: "30260294", name: "信号与系统", credits: 4, remark: "A类必修，三选一" },
          { id: "new015", name: "大语言模型:理论与应用", credits: 2, remark: "A类必修，先修深度学习" }
        ],
        optional: [
          { id: "40240422", name: "计算机图形学基础", credits: 2, remark: "二选一" },
          { id: "new016", name: "计算机图形学与动画", credits: 4, remark: "二选一" },
          { id: "40240492", name: "数据挖掘", credits: 2 },
          { id: "new017", name: "知识表示与检索", credits: 2, remark: "二选一" },
          { id: "40240372", name: "信息检索", credits: 2, remark: "二选一" },
          { id: "40240062", name: "数字图像处理", credits: 2, remark: "二选一" },
          { id: "30230703", name: "数字图像处理", credits: 2, remark: "二选一" },
          { id: "40240872", name: "媒体计算", credits: 2, remark: "三选一" },
          { id: "40231223", name: "媒体与认知", credits: 3, remark: "三选一" },
          { id: "40240392", name: "多媒体技术基础及应用", credits: 2, remark: "三选一" },
          { id: "30230863", name: "视听信息系统导论", credits: 3 },
          { id: "40231103", name: "语音信号处理", credits: 3 },
          { id: "40240952", name: "虚拟现实技术", credits: 2 },
          { id: "new018", name: "工业智能大模型", credits: 3 }
        ]
      },
      {
        name: "课组3：AI软硬件基础",
        required: [
          { id: "30240343", name: "数字逻辑电路", credits: 3, remark: "A类必修，四选一" },
          { id: "30240353", name: "数字逻辑设计", credits: 3, remark: "A类必修，四选一" },
          { id: "30230793", name: "数字逻辑与处理器基础", credits: 3, remark: "A类必修，四选一" },
          { id: "30260203", name: "数字集成电路与系统", credits: 3, remark: "A类必修，四选一" },
          { id: "30231114", name: "电子电路与系统基础(1)", credits: 4, remark: "A类必修，四选一" },
          { id: "30260222", name: "电子学基础", credits: 2, remark: "A类必修，四选一" },
          { id: "30260252", name: "电子电路与系统基础(1)", credits: 2, remark: "A类必修，四选一" },
          { id: "30260272", name: "电子电路与系统基础(2)", credits: 2, remark: "A类必修，四选一" },
          { id: "40260373", name: "集成电路基础:芯片设计", credits: 3, remark: "" },
          { id: "40241103", name: "人工智能编译框架与原理", credits: 3, remark: "" },
          { id: "new019", name: "智能操作系统", credits: 3, remark: "" }
        ],
        optional: [
          { id: "30240192", name: "高性能计算导论", credits: 2 },
          { id: "30240551", name: "数字逻辑实验", credits: 1 },
          { id: "new020", name: "智能计算集群设计", credits: 3 },
          { id: "40240513", name: "计算机网络原理", credits: 3, remark: "二选一" },
          { id: "30230643", name: "计算机网络技术与实践", credits: 3, remark: "二选一" },
          { id: "44100512", name: "大数据系统软件", credits: 3 },
          { id: "new021", name: "模型驱动软件开发", credits: 2, remark: "二选一" },
          { id: "new022", name: "基于生成式AI的代码生成", credits: 2, remark: "二选一" },
          { id: "30240262", name: "数据库系统概论", credits: 2, remark: "三选一" },
          { id: "30230272", name: "数据库", credits: 2, remark: "三选一" },
          { id: "34100173", name: "数据库原理", credits: 3, remark: "三选一" },
          { id: "44100203", name: "软件工程", credits: 3, remark: "二选一" },
          { id: "30240163", name: "软件工程", credits: 3, remark: "二选一" },
          { id: "80231392", name: "AI基础软硬件核心技术", credits: 2 }
        ]
      },
      {
        name: "课组4：具身智能（当前方向）",
        required: [
          { id: "new023", name: "机器人运动学与动力学", credits: 3, remark: "A类必修" },
          { id: "40240013", name: "系统分析与控制", credits: 3, remark: "A类必修，二选一" },
          { id: "40240462", name: "现代控制技术", credits: 2, remark: "A类必修，二选一" }
        ],
        optional: [
          { id: "80470253", name: "深度强化学习", credits: 3 },
          { id: "80240813", name: "具身智能", credits: 2 },
          { id: "new024", name: "空间计算技术基础", credits: 3 },
          { id: "40231212", name: "智能机器人设计实践", credits: 2 },
          { id: "40231282", name: "智能无人机技术设计实践", credits: 2 },
          { id: "20230192", name: "单片机和嵌入式系统", credits: 2, remark: "三选一" },
          { id: "44100632", name: "嵌入式系统", credits: 3, remark: "三选一" },
          { id: "40240552", name: "嵌入式系统", credits: 2, remark: "三选一" }
        ]
      },
      {
        name: "课组5：人工智能安全",
        required: [
          { id: "40241052", name: "人工智能安全与治理技术", credits: 2, remark: "A类必修" },
          { id: "new025", name: "大模型安全与对齐", credits: 2, remark: "A类必修" }
        ],
        optional: [
          { id: "84120163", name: "机器学习安全", credits: 3 },
          { id: "84120222", name: "云计算与大数据安全", credits: 2 },
          { id: "30240573", name: "网络空间安全导论", credits: 3 },
          { id: "40240572", name: "计算机网络安全技术", credits: 2, remark: "先修计算机网络原理" },
          { id: "40240892", name: "现代密码学", credits: 2 },
          { id: "40240862", name: "网络安全工程与实践", credits: 2 }
        ]
      }
    ]
  }
};
