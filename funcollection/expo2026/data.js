// funcollection/expo2026/data.js —— 2026年北京国际钱币博览会 · 展会收获（赠品）
//
// ══════════════════════════════════════════════════════════════════════════
// 这个专题装的是"本站没有的品类 / 一时归不进正式分类"的展会收获：
//   门票、纸币、外国硬币、古钱币（铜钱）、邮票…… 混装在一起。
//   ⇒ 能当正常数据录的仍照旧录进各自分类，只多一个
//     acquiredFrom: '2026年北京国际钱币博览会'，这样它们在搜索/统计/导出里都是正常成员。
//
// ★ copyId = 唯一身份（重要）
//   本专题每一件都必须有一个 copyId，号段：**26BICExx**
//     · 26 = 2026 年，BICE = Beijing International Coin Exposition，xx = 两位序号
//       （26BICE01、26BICE02 ……；超过 99 件就顺着写 26BICE100）
//     · 将来这件东西要录进正式藏品（notecollection/… 或 coincollection/…）时，
//       **照抄同一个 copyId** ⇒ 全站认得出是同一件，不会重复计数。
//     · 已验证：copyId 在现有代码里不被当数字用（无法匹配评级费台账时一律"不减"），
//       所以带字母的号段是安全的。
//
// 字段：
//   copyId     必填。唯一身份，见上。
//   name       必填。条目名称。
//   group      侧边栏分组名（中文，专题按它分类）
//   kind       种类：note 纸币 | coin 硬币 | ancient 古钱币 | stamp 邮票 | other 其它
//   version    冠字号码 / 流水号
//   grader     评级公司；condition 评级结果/分数
//   remark     备注
//   price      赠品写 0（照普通口径参与统计，不做特殊处理）
//   purchaseDate 到手日期
//   tags       标签数组
//   img1/img2  正面/背面图，命名 **{copyId}-01.jpg / -02.jpg**（图自己放 images/ 下）
//
// 下一个可用号：26BICE09
// ══════════════════════════════════════════════════════════════════════════

const IMG_BASE = "https://tong-xiangjie.github.io/funcollection/expo2026/images/";

const expo2026Items = [

    {
        copyId: "26BICE01",
        name: "2026年第30届北京国际钱币博览会 参观券",
        group: "门票",
        kind: "other",
        version: "05888",
        condition: "暂未评级",
        price: 0,
        purchaseDate: "2026年10月27日",
        tags: ["赠品", "展会纪念"],
        remark: "参观2026年第30届北京国际钱币博览会所得。非常幸运地得到了这样的号码。",
        img: IMG_BASE + "26BICE01-01.jpg",
        img2: IMG_BASE + "26BICE01-02.jpg"
    },
    {
        copyId: "26BICE02",
        name: "1980年5角（第四套人民币）",
        group: "纸币",
        kind: "note",
        version: "B6M7227077",
        grader: "源泰评级",
        condition: "真品",
        price: 0,
        purchaseDate: "2026年10月27日",
        tags: ["赠品"],
        remark: "「80年5角」",
        img: IMG_BASE + "26BICE02-01.jpg",
        img2: IMG_BASE + "26BICE02-02.jpg"
    },
    {
        copyId: "26BICE03",
        name: "1993年邮票",
        group: "邮票",
        kind: "stamp",
        grader: "CSIS",
        condition: "真品",
        price: 0,
        purchaseDate: "2026年10月27日",
        tags: ["赠品", "邮票"],
        img: IMG_BASE + "26BICE03-01.jpg",
        img2: IMG_BASE + "26BICE03-02.jpg"
    },
    {
        copyId: "26BICE04",
        name: "2017年邮票",
        group: "邮票",
        kind: "stamp",
        grader: "HDGS",
        condition: "真品",
        price: 0,
        purchaseDate: "2026年10月27日",
        tags: ["赠品", "邮票"],
        img: IMG_BASE + "26BICE04-01.jpg",
        img2: IMG_BASE + "26BICE04-02.jpg"
    },
    {
        copyId: "26BICE05",
        name: "朝鲜 1/2 Chon（半钱）盘羊 · 野生动物系列",
        group: "外国硬币",
        kind: "coin",
        year: "2002",
        denomination: "1/2 Chon",
        bank: "朝鲜",
        grader: "TQG",
        condition: "MS63",
        price: 0,
        purchaseDate: "2026年10月27日",
        tags: ["赠品", "外币"],
        remark: "铝币；盘羊（大角羊 / Bighorn Sheep）",
        img: IMG_BASE + "26BICE05-01.jpg",
        img2: IMG_BASE + "26BICE05-02.jpg"
    },
    {
        copyId: "26BICE06",
        name: "北宋 元丰通宝（篆书版）",
        group: "古钱币",
        kind: "ancient",
        grader: "国正评级",
        condition: "真品",
        price: 0,
        purchaseDate: "2026年10月27日",
        tags: ["赠品", "古钱币"],
        remark: "北宋元丰通宝两枚之一（篆书）",
        img: IMG_BASE + "26BICE06-01.jpg",
        img2: IMG_BASE + "26BICE06-02.jpg"
    },
    {
        copyId: "26BICE07",
        name: "北宋 元丰通宝（行书版）",
        group: "古钱币",
        kind: "ancient",
        grader: "国正评级",
        condition: "真品",
        price: 0,
        purchaseDate: "2026年10月27日",
        tags: ["赠品", "古钱币"],
        remark: "北宋元丰通宝两枚之一（行书）",
        img: IMG_BASE + "26BICE07-01.jpg",
        img2: IMG_BASE + "26BICE07-02.jpg"
    },
    {
        copyId: "26BICE08",
        name: "天圣元宝",
        group: "古钱币",
        kind: "ancient",
        grader: "斗泉",
        condition: "真品",
        price: 0,
        purchaseDate: "2026年10月27日",
        tags: ["赠品", "古钱币"],
        remark: "用户原记「天元圣宝」，疑为北宋天圣元宝，待核对",
        img: IMG_BASE + "26BICE08-01.jpg",
        img2: IMG_BASE + "26BICE08-02.jpg"
    }

];

// ══════════════════════════════════════════════════════════════════════════
// 详细信息卡片（点开某一件后弹出的那张卡）里显示的字段与顺序
//   · 写法与各板块数据文件的 detailFields 同源，代码只负责读它；
//   · key 必须对应上面条目里的字段名（kindName 是代码按 kind 映射出的中文种类）；
//   · 某项为空时那一行自动不显示（与纸币/硬币的行为一致）。
// ══════════════════════════════════════════════════════════════════════════
const expo2026Meta = {
    detailFields: [
        { key: "copyId", label: "留档编号" },
        { key: "kindName", label: "种类" },
        { key: "version", label: "冠字号码 / 流水号" },
        { key: "bank", label: "发行方" },
        { key: "denomination", label: "面值" },
        { key: "year", label: "发行年份" },
        { key: "grader", label: "评级公司" },
        { key: "condition", label: "评级结果" },
        { key: "price", label: "购入价格" },
        { key: "purchaseDate", label: "到手日期" }
    ]
};
