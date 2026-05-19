// data.js
// 基于《Word Power Made Easy》完整词根整理（第1~19章及附录）
// 格式：id, root, meaning_cn, meaning_en, origin, chapter, examples

const rootsData = [
    // ======================= Chapter 3 =======================
    { id: 1, root: "ego", meaning_cn: "我，自我", meaning_en: "I, self", origin: "Latin", chapter: "3", examples: [{ word: "egoist", trans: "利己主义者" }, { word: "egotist", trans: "自夸者" }, { word: "egocentric", trans: "自我中心的" }, { word: "egomaniac", trans: "自大狂" }] },
    { id: 2, root: "alter", meaning_cn: "其他", meaning_en: "other", origin: "Latin", chapter: "3", examples: [{ word: "altruist", trans: "利他主义者" }, { word: "alternate", trans: "交替的" }, { word: "alter ego", trans: "另一个自我" }, { word: "altercation", trans: "争论" }] },
    { id: 3, root: "vert", "vertō", meaning_cn: "转向", meaning_en: "to turn", origin: "Latin", chapter: "3", examples: [{ word: "introvert", trans: "内向者" }, { word: "extrovert", trans: "外向者" }, { word: "ambivert", trans: "中间性格者" }, { word: "versatile", trans: "多才多艺的" }] },
    { id: 4, root: "misein", meaning_cn: "憎恨", meaning_en: "to hate", origin: "Greek", chapter: "3", examples: [{ word: "misanthrope", trans: "厌世者" }, { word: "misogynist", trans: "厌恶女性者" }, { word: "misogamist", trans: "厌恶婚姻者" }] },
    { id: 5, root: "anthropos", meaning_cn: "人类", meaning_en: "mankind", origin: "Greek", chapter: "3", examples: [{ word: "anthropology", trans: "人类学" }, { word: "philanthropist", trans: "慈善家" }, { word: "anthropomorphic", trans: "拟人化的" }] },
    { id: 6, root: "gyne", meaning_cn: "女性", meaning_en: "woman", origin: "Greek", chapter: "3", examples: [{ word: "gynecologist", trans: "妇科医生" }, { word: "misogyny", trans: "厌女症" }] },
    { id: 7, root: "gamos", meaning_cn: "婚姻", meaning_en: "marriage", origin: "Greek", chapter: "3", examples: [{ word: "monogamy", trans: "一夫一妻制" }, { word: "bigamy", trans: "重婚" }, { word: "polygamy", trans: "多配偶制" }] },
    { id: 8, root: "askētēs", meaning_cn: "苦行者", meaning_en: "monk, hermit", origin: "Greek", chapter: "3", examples: [{ word: "ascetic", trans: "苦行者" }, { word: "asceticism", trans: "禁欲主义" }] },
    // ======================= Chapter 4 =======================
    { id: 9, root: "internus", meaning_cn: "内部", meaning_en: "inside", origin: "Latin", chapter: "4", examples: [{ word: "internist", trans: "内科医生" }, { word: "internal", trans: "内部的" }] },
    { id: 10, root: "obstetrix", meaning_cn: "助产士", meaning_en: "midwife", origin: "Latin", chapter: "4", examples: [{ word: "obstetrician", trans: "产科医生" }, { word: "obstetrics", trans: "产科学" }] },
    { id: 11, root: "paidos (ped- child)", meaning_cn: "儿童", meaning_en: "child", origin: "Greek", chapter: "4", examples: [{ word: "pediatrician", trans: "儿科医生" }, { word: "pedagogy", trans: "教学法" }, { word: "pedodontist", trans: "儿童牙医" }] },
    { id: 12, root: "derma", meaning_cn: "皮肤", meaning_en: "skin", origin: "Greek", chapter: "4", examples: [{ word: "dermatologist", trans: "皮肤科医生" }, { word: "hypodermic", trans: "皮下的" }, { word: "epidermis", trans: "表皮" }, { word: "taxidermy", trans: "动物标本制作" }] },
    { id: 13, root: "ophthalmos", meaning_cn: "眼睛", meaning_en: "eye", origin: "Greek", chapter: "4", examples: [{ word: "ophthalmologist", trans: "眼科医生" }, { word: "ophthalmic", trans: "眼科的" }] },
    { id: 14, root: "kardia", meaning_cn: "心脏", meaning_en: "heart", origin: "Greek", chapter: "4", examples: [{ word: "cardiologist", trans: "心脏病专家" }, { word: "cardiac", trans: "心脏的" }, { word: "cardiogram", trans: "心电图" }] },
    { id: 15, root: "neuron", meaning_cn: "神经", meaning_en: "nerve", origin: "Greek", chapter: "4", examples: [{ word: "neurologist", trans: "神经科医生" }, { word: "neuralgia", trans: "神经痛" }, { word: "neuritis", trans: "神经炎" }] },
    { id: 16, root: "psyche", meaning_cn: "精神，心灵", meaning_en: "mind, soul", origin: "Greek", chapter: "4", examples: [{ word: "psychiatrist", trans: "精神科医生" }, { word: "psychology", trans: "心理学" }, { word: "psychosomatic", trans: "身心相关的" }] },
    // ======================= Chapter 5 =======================
    { id: 17, root: "iatreia", meaning_cn: "医疗", meaning_en: "medical healing", origin: "Greek", chapter: "5", examples: [{ word: "podiatry", trans: "足病学" }, { word: "psychiatry", trans: "精神病学" }, { word: "geriatrics", trans: "老年医学" }] },
    { id: 18, root: "graphein", meaning_cn: "书写", meaning_en: "to write", origin: "Greek", chapter: "5", examples: [{ word: "graphologist", trans: "笔迹学家" }, { word: "calligraphy", trans: "书法" }, { word: "cacography", trans: "拙劣书写" }, { word: "biography", trans: "传记" }] },
    { id: 19, root: "cheir (chiro-)", meaning_cn: "手", meaning_en: "hand", origin: "Greek", chapter: "5", examples: [{ word: "chiropractor", trans: "脊椎按摩师" }, { word: "chirography", trans: "书法" }, { word: "chiromancy", trans: "手相术" }] },
    { id: 20, root: "pous, podos", meaning_cn: "足", meaning_en: "foot", origin: "Greek", chapter: "5", examples: [{ word: "podiatrist", trans: "足病医生" }, { word: "octopus", trans: "章鱼" }, { word: "platypus", trans: "鸭嘴兽" }, { word: "podium", trans: "讲台" }] },
    { id: 21, root: "osteon", meaning_cn: "骨头", meaning_en: "bone", origin: "Greek", chapter: "5", examples: [{ word: "osteopath", trans: "整骨医生" }, { word: "osteopathy", trans: "整骨疗法" }] },
    { id: 22, root: "odontos", meaning_cn: "牙齿", meaning_en: "tooth", origin: "Greek", chapter: "5", examples: [{ word: "orthodontist", trans: "正畸医生" }, { word: "periodontist", trans: "牙周病医生" }, { word: "endodontist", trans: "牙髓病医生" }] },
    // ======================= Chapter 6 =======================
    { id: 23, root: "astron", meaning_cn: "星星", meaning_en: "star", origin: "Greek", chapter: "6", examples: [{ word: "astronomer", trans: "天文学家" }, { word: "astrology", trans: "占星术" }, { word: "astronaut", trans: "宇航员" }, { word: "disaster", trans: "灾难" }] },
    { id: 24, root: "ge (geo-)", meaning_cn: "地球", meaning_en: "earth", origin: "Greek", chapter: "6", examples: [{ word: "geologist", trans: "地质学家" }, { word: "geography", trans: "地理学" }, { word: "geometry", trans: "几何学" }] },
    { id: 25, root: "bios", meaning_cn: "生命", meaning_en: "life", origin: "Greek", chapter: "6", examples: [{ word: "biology", trans: "生物学" }, { word: "biography", trans: "传记" }, { word: "biopsy", trans: "活组织检查" }] },
    { id: 26, root: "zoion", meaning_cn: "动物", meaning_en: "animal", origin: "Greek", chapter: "6", examples: [{ word: "zoologist", trans: "动物学家" }, { word: "zodiac", trans: "黄道十二宫" }] },
    { id: 27, root: "botanē", meaning_cn: "植物", meaning_en: "plant", origin: "Greek", chapter: "6", examples: [{ word: "botanist", trans: "植物学家" }, { word: "botany", trans: "植物学" }] },
    { id: 28, root: "logos", meaning_cn: "科学，言语", meaning_en: "science, word", origin: "Greek", chapter: "6", examples: [{ word: "philology", trans: "语言学" }, { word: "eulogy", trans: "颂词" }, { word: "psychology", trans: "心理学" }] },
    { id: 29, root: "nomos", meaning_cn: "法则，秩序", meaning_en: "law, order", origin: "Greek", chapter: "6", examples: [{ word: "astronomy", trans: "天文学" }, { word: "autonomy", trans: "自治" }, { word: "metronome", trans: "节拍器" }] },
    // ======================= Chapter 7 =======================
    { id: 30, root: "notus", meaning_cn: "已知的", meaning_en: "known", origin: "Latin", chapter: "7", examples: [{ word: "notorious", trans: "臭名昭著的" }, { word: "notoriety", trans: "恶名" }, { word: "notable", trans: "著名的" }] },
    { id: 31, root: "genesis", meaning_cn: "出生，起源", meaning_en: "birth, origin", origin: "Greek", chapter: "7", examples: [{ word: "congenital", trans: "先天的" }, { word: "genetics", trans: "遗传学" }, { word: "gene", trans: "基因" }] },
    { id: 32, root: "chronos", meaning_cn: "时间", meaning_en: "time", origin: "Greek", chapter: "7", examples: [{ word: "chronic", trans: "慢性的" }, { word: "anachronism", trans: "时代错误" }, { word: "synchronize", trans: "同步" }, { word: "chronometer", trans: "精密计时器" }] },
    { id: 33, root: "pathos", meaning_cn: "痛苦，情感", meaning_en: "suffering, feeling", origin: "Greek", chapter: "7", examples: [{ word: "sympathy", trans: "同情" }, { word: "apathy", trans: "冷漠" }, { word: "empathy", trans: "共情" }, { word: "pathology", trans: "病理学" }] },
    { id: 34, root: "grex, gregis", meaning_cn: "群体", meaning_en: "herd, flock", origin: "Latin", chapter: "7", examples: [{ word: "egregious", trans: "极坏的" }, { word: "gregarious", trans: "合群的" }, { word: "congregate", trans: "聚集" }] },
    { id: 35, root: "scio", meaning_cn: "知道", meaning_en: "to know", origin: "Latin", chapter: "7", examples: [{ word: "conscience", trans: "良心" }, { word: "omniscient", trans: "全知的" }, { word: "prescient", trans: "有先见之明的" }] },
    // ======================= Chapter 9 =======================
    { id: 36, root: "par", meaning_cn: "相等", meaning_en: "equal", origin: "Latin", chapter: "9", examples: [{ word: "disparage", trans: "贬低" }, { word: "parity", trans: "平等" }, { word: "peer", trans: "同龄人" }] },
    { id: 37, root: "aequus (equ-)", meaning_cn: "相等", meaning_en: "equal", origin: "Latin", chapter: "9", examples: [{ word: "equivocate", trans: "含糊其辞" }, { word: "equity", trans: "公平" }, { word: "equilibrium", trans: "平衡" }] },
    { id: 38, root: "vox, vocis", meaning_cn: "声音", meaning_en: "voice", origin: "Latin", chapter: "9", examples: [{ word: "vociferous", trans: "喧闹的" }, { word: "vocal", trans: "声音的" }, { word: "equivocal", trans: "模棱两可的" }] },
    { id: 39, root: "scribo, scriptus", meaning_cn: "书写", meaning_en: "to write", origin: "Latin", chapter: "9", examples: [{ word: "proscribe", trans: "禁止" }, { word: "describe", trans: "描述" }, { word: "manuscript", trans: "手稿" }, { word: "scripture", trans: "经文" }] },
    { id: 40, root: "malus", meaning_cn: "坏的", meaning_en: "bad, evil", origin: "Latin", chapter: "9", examples: [{ word: "malign", trans: "诽谤" }, { word: "malevolent", trans: "恶意的" }, { word: "malefactor", trans: "罪犯" }, { word: "malady", trans: "疾病" }] },
    { id: 41, root: "bonus, bene", meaning_cn: "好的", meaning_en: "good, well", origin: "Latin", chapter: "9", examples: [{ word: "benign", trans: "良性的" }, { word: "benevolent", trans: "仁慈的" }, { word: "benefactor", trans: "捐助者" }, { word: "bona fide", trans: "真诚的" }] },
    { id: 42, root: "dono", meaning_cn: "给予", meaning_en: "to give", origin: "Latin", chapter: "9", examples: [{ word: "condone", trans: "宽恕" }, { word: "donor", trans: "捐赠者" }, { word: "donation", trans: "捐赠" }] },
    // ======================= Chapter 10 =======================
    { id: 43, root: "taceo", meaning_cn: "沉默", meaning_en: "to be silent", origin: "Latin", chapter: "10", examples: [{ word: "taciturn", trans: "沉默寡言的" }, { word: "tacit", trans: "心照不宣的" }] },
    { id: 44, root: "loquor", meaning_cn: "说话", meaning_en: "to speak", origin: "Latin", chapter: "10", examples: [{ word: "loquacious", trans: "健谈的" }, { word: "soliloquy", trans: "独白" }, { word: "colloquial", trans: "口语的" }, { word: "ventriloquist", trans: "腹语师" }] },
    { id: 45, root: "volvo, volutus", meaning_cn: "滚动", meaning_en: "to roll", origin: "Latin", chapter: "10", examples: [{ word: "voluble", trans: "流利的" }, { word: "revolve", trans: "旋转" }, { word: "evolve", trans: "进化" }, { word: "revolution", trans: "革命" }] },
    { id: 46, root: "verbum", meaning_cn: "词语", meaning_en: "word", origin: "Latin", chapter: "10", examples: [{ word: "verbose", trans: "冗长的" }, { word: "verbatim", trans: "逐字地" }, { word: "verbal", trans: "言语的" }] },
    // ======================= Chapter 11 =======================
    { id: 47, root: "phanein", meaning_cn: "显示", meaning_en: "to show", origin: "Greek", chapter: "11", examples: [{ word: "sycophant", trans: "马屁精" }, { word: "diaphanous", trans: "透明的" }] },
    { id: 48, root: "vir", meaning_cn: "男性", meaning_en: "man", origin: "Latin", chapter: "11", examples: [{ word: "virago", trans: "泼妇" }, { word: "virile", trans: "有男子气概的" }] },
    { id: 49, root: "pater, patris", meaning_cn: "父亲", meaning_en: "father", origin: "Latin", chapter: "11", examples: [{ word: "patricide", trans: "弑父" }, { word: "patrimony", trans: "遗产" }, { word: "patron", trans: "赞助人" }, { word: "paternal", trans: "父亲的" }] },
    { id: 50, root: "mater, matris", meaning_cn: "母亲", meaning_en: "mother", origin: "Latin", chapter: "11", examples: [{ word: "matricide", trans: "弑母" }, { word: "maternity", trans: "母性" }, { word: "alma mater", trans: "母校" }, { word: "matrimony", trans: "婚姻" }] },
    { id: 51, root: "caedo (-cide)", meaning_cn: "杀死", meaning_en: "to kill", origin: "Latin", chapter: "11", examples: [{ word: "suicide", trans: "自杀" }, { word: "homicide", trans: "杀人" }, { word: "genocide", trans: "种族灭绝" }, { word: "fratricide", trans: "杀兄弟" }] },
    { id: 52, root: "theos", meaning_cn: "神", meaning_en: "God", origin: "Greek", chapter: "11", examples: [{ word: "atheist", trans: "无神论者" }, { word: "monotheism", trans: "一神论" }, { word: "theology", trans: "神学" }] },
    { id: 53, root: "mania", meaning_cn: "疯狂", meaning_en: "madness", origin: "Greek", chapter: "11", examples: [{ word: "monomania", trans: "偏执狂" }, { word: "kleptomania", trans: "盗窃癖" }, { word: "pyromania", trans: "纵火癖" }] },
    { id: 54, root: "phobia", meaning_cn: "恐惧", meaning_en: "morbid fear", origin: "Greek", chapter: "11", examples: [{ word: "claustrophobia", trans: "幽闭恐惧症" }, { word: "acrophobia", trans: "恐高症" }, { word: "agoraphobia", trans: "广场恐惧症" }] },
    // ======================= Chapter 12 =======================
    { id: 55, root: "vivo", meaning_cn: "生活", meaning_en: "to live", origin: "Latin", chapter: "12", examples: [{ word: "convivial", trans: "欢乐的" }, { word: "vivacious", trans: "活泼的" }, { word: "revive", trans: "复活" }, { word: "vivisection", trans: "活体解剖" }] },
    { id: 56, root: "vita", meaning_cn: "生命", meaning_en: "life", origin: "Latin", chapter: "12", examples: [{ word: "vital", trans: "至关重要的" }, { word: "vitamin", trans: "维生素" }, { word: "revitalize", trans: "使恢复生机" }] },
    { id: 57, root: "credo", meaning_cn: "相信", meaning_en: "to believe", origin: "Latin", chapter: "12", examples: [{ word: "credulous", trans: "轻信的" }, { word: "incredible", trans: "难以置信的" }, { word: "creed", trans: "信条" }, { word: "credence", trans: "信任" }] },
    { id: 58, root: "spect", meaning_cn: "看", meaning_en: "to look", origin: "Latin", chapter: "12", examples: [{ word: "perspicacious", trans: "敏锐的" }, { word: "retrospect", trans: "回顾" }, { word: "circumspect", trans: "谨慎的" }, { word: "spectator", trans: "观众" }] },
    { id: 59, root: "animus", meaning_cn: "心灵，思想", meaning_en: "mind", origin: "Latin", chapter: "12", examples: [{ word: "magnanimous", trans: "宽宏大量的" }, { word: "pusillanimous", trans: "胆小的" }, { word: "equanimity", trans: "平静" }, { word: "animosity", trans: "敌意" }] },
    { id: 60, root: "urbs", meaning_cn: "城市", meaning_en: "city", origin: "Latin", chapter: "12", examples: [{ word: "urbane", trans: "温文尔雅的" }, { word: "suburban", trans: "郊区的" }, { word: "urban", trans: "城市的" }] },
    // ======================= Chapter 14 =======================
    { id: 61, root: "fluo", meaning_cn: "流动", meaning_en: "to flow", origin: "Latin", chapter: "14", examples: [{ word: "affluent", trans: "富裕的" }, { word: "influence", trans: "影响" }, { word: "fluent", trans: "流利的" }, { word: "confluence", trans: "汇合" }] },
    { id: 62, root: "carnis", meaning_cn: "肉", meaning_en: "flesh", origin: "Latin", chapter: "14", examples: [{ word: "carnivorous", trans: "食肉的" }, { word: "carnage", trans: "大屠杀" }, { word: "incarnate", trans: "化身的" }, { word: "carnal", trans: "肉体的" }] },
    { id: 63, root: "voro", meaning_cn: "吞食", meaning_en: "to devour", origin: "Latin", chapter: "14", examples: [{ word: "voracious", trans: "贪婪的" }, { word: "herbivorous", trans: "草食的" }, { word: "omnivorous", trans: "杂食的" }, { word: "carnivore", trans: "食肉动物" }] },
    { id: 64, root: "omnis", meaning_cn: "所有", meaning_en: "all", origin: "Latin", chapter: "14", examples: [{ word: "omnipotent", trans: "全能的" }, { word: "omniscient", trans: "全知的" }, { word: "omnipresent", trans: "无处不在的" }, { word: "omnibus", trans: "选集" }] },
    { id: 65, root: "eu-", meaning_cn: "好", meaning_en: "good", origin: "Greek", chapter: "14", examples: [{ word: "euphemism", trans: "委婉语" }, { word: "euphony", trans: "悦耳的声音" }, { word: "eulogy", trans: "颂词" }, { word: "euphoria", trans: "欣快感" }] },
    { id: 66, root: "kakos", meaning_cn: "坏，丑", meaning_en: "bad, harsh", origin: "Greek", chapter: "14", examples: [{ word: "cacophony", trans: "刺耳的声音" }, { word: "cacography", trans: "拙劣书写" }] },
    // ======================= Chapter 15 =======================
    { id: 67, root: "nervus", meaning_cn: "神经", meaning_en: "nerve", origin: "Latin", chapter: "15", examples: [{ word: "enervate", trans: "使衰弱" }, { word: "enervation", trans: "虚弱" }] },
    { id: 68, root: "caput, capitis", meaning_cn: "头", meaning_en: "head", origin: "Latin", chapter: "15", examples: [{ word: "recapitulate", trans: "概括" }, { word: "decapitate", trans: "斩首" }, { word: "captain", trans: "船长" }, { word: "capital", trans: "首都" }] },
    { id: 69, root: "levis", meaning_cn: "轻", meaning_en: "light", origin: "Latin", chapter: "15", examples: [{ word: "alleviate", trans: "缓解" }, { word: "levity", trans: "轻浮" }, { word: "elevate", trans: "提升" }, { word: "levitate", trans: "漂浮" }] },
    { id: 70, root: "simulo", meaning_cn: "模仿", meaning_en: "to copy", origin: "Latin", chapter: "15", examples: [{ word: "simulate", trans: "模拟" }, { word: "dissimulate", trans: "掩饰" }] },
    { id: 71, root: "vacillo", meaning_cn: "摇摆", meaning_en: "to swing", origin: "Latin", chapter: "15", examples: [{ word: "vacillate", trans: "犹豫不决" }, { word: "vacillation", trans: "摇摆不定" }] },
    // ======================= Chapter 16 =======================
    { id: 72, root: "sequor", meaning_cn: "跟随", meaning_en: "to follow", origin: "Latin", chapter: "16", examples: [{ word: "obsequious", trans: "谄媚的" }, { word: "subsequent", trans: "随后的" }, { word: "sequence", trans: "顺序" }, { word: "consecutive", trans: "连续的" }] },
    { id: 73, root: "queror", meaning_cn: "抱怨", meaning_en: "to complain", origin: "Latin", chapter: "16", examples: [{ word: "querulous", trans: "爱发牢骚的" }] },
    { id: 74, root: "super", meaning_cn: "上面", meaning_en: "above", origin: "Latin", chapter: "16", examples: [{ word: "supercilious", trans: "目中无人的" }, { word: "superior", trans: "优越的" }, { word: "supervise", trans: "监督" }] },
    { id: 75, root: "cado", meaning_cn: "落下", meaning_en: "to fall", origin: "Latin", chapter: "16", examples: [{ word: "decadent", trans: "颓废的" }, { word: "incident", trans: "事件" }, { word: "accident", trans: "事故" }, { word: "cadence", trans: "节奏" }] },
    { id: 76, root: "doleo", meaning_cn: "悲伤", meaning_en: "to grieve", origin: "Latin", chapter: "16", examples: [{ word: "dolorous", trans: "悲伤的" }, { word: "condolence", trans: "哀悼" }, { word: "doleful", trans: "忧郁的" }] },
    // ======================= 附录补充 =======================
    { id: 77, root: "mancy", meaning_cn: "占卜", meaning_en: "divination", origin: "Greek", chapter: "appx", examples: [{ word: "chiromancy", trans: "手相术" }, { word: "necromancy", trans: "巫术" }] },
    { id: 78, root: "philos", meaning_cn: "爱", meaning_en: "love", origin: "Greek", chapter: "appx", examples: [{ word: "philanthropy", trans: "博爱" }, { word: "philosophy", trans: "哲学" }, { word: "bibliophile", trans: "爱书者" }] },
    { id: 79, root: "biblion", meaning_cn: "书", meaning_en: "book", origin: "Greek", chapter: "appx", examples: [{ word: "bibliophile", trans: "藏书家" }, { word: "bibliography", trans: "参考书目" }] },
    { id: 80, root: "dromos", meaning_cn: "奔跑", meaning_en: "running", origin: "Greek", chapter: "appx", examples: [{ word: "hippodrome", trans: "赛马场" }, { word: "syndrome", trans: "综合征" }] }
];

// 导出供全局使用
if (typeof module !== 'undefined' && module.exports) {
    module.exports = rootsData;
}
