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


// ══════════════════════════════════════════════════════════════════════════
// 详细信息卡片（点开某一件后弹出的那张卡）里显示的字段与顺序
//   · 写法与各板块数据文件的 detailFields 同源，代码只负责读它；
//   · key 必须对应上面条目里的字段名（kindName 是代码按 kind 映射出的中文种类）；
//   · 某项为空时那一行自动不显示（与纸币/硬币的行为一致）。
// ══════════════════════════════════════════════════════════════════════════
const expo2026Meta = {
    detailFields: [
        { key: "copyId", label: "藏品编号" },
        { key: "kindName", label: "类别" },
        { key: "version", label: "冠字号码" },
        { key: "bank", label: "发行方" },
        { key: "denomination", label: "面值" },
        { key: "year", label: "发行年份" },
        { key: "grader", label: "评级公司" },
        { key: "condition", label: "评级得分" },
        { key: "price", label: "购入价格" },
        { key: "purchaseDate", label: "购入日期" }
    ]
};

const IMG_BASE = "https://tong-xiangjie.github.io/funcollection/expo2026/images/";

const expo2026Items = [
    {
        event: "2026年第30届北京国际钱币博览会",   // 侧边栏与大标题用的活动名（将来别的会写别的）
        copyId: "26BICE01",
        name: "2026年第30届北京国际钱币博览会 参观券",
        group: "纸币 - 票证",
        kind: "纸币 - 票证",
        bank: "中国金币集团有限公司",
        year: 2026,
        version: "05888",
        condition: "暂未评级",
        price: "0元",
        purchaseDate: "2026年10月31日",
        tags: ["赠品", "展会纪念"],
        remark: "参观2026年第30届北京国际钱币博览会所得。非常幸运地得到了这样的号码。",
        img: IMG_BASE + "26BICE01-01.jpg",
        img2: IMG_BASE + "26BICE01-02.jpg"
    },
    {
        event: "2026年第30届北京国际钱币博览会",   // 侧边栏与大标题用的活动名（将来别的会写别的）
        copyId: "26BICE02",
        name: "第四套人民币 1980年 5角",
        group: "纸币 - 人民币",
        kind: "纸币 - 人民币",
        bank: "中国人民银行",
        year: 1980,
        version: "B6M7227077",
        grader: "源泰评级",
        condition: "真品",
        price: "0元",
        purchaseDate: "2026年10月31日",
        tags: ["赠品"],
        remark: "注册“赵涌在线”转转盘抽奖获赠。其实这个软件早就已经注册过了。",
        img: IMG_BASE + "26BICE02-01.jpg",
        img2: IMG_BASE + "26BICE02-02.jpg"
    },
    {
        event: "2026年第30届北京国际钱币博览会",   // 侧边栏与大标题用的活动名（将来别的会写别的）
        copyId: "26BICE03",
        name: "1993年 郑板桥作品选 20分 兰竹石大中堂",
        group: "纸币 - 邮票",
        kind: "纸币 - 邮票",
        bank: "中国邮政",
        year: 1993,
        version: "1993-15 (6-3)T",
        grader: "CSIS",
        condition: "真品",
        price: "0元",
        purchaseDate: "2026年10月31日",
        tags: ["赠品", "邮票"],
        remark: "关注公众号同时加推广人员的微信获赠。发行时间1993年11月22日，发行量4745.7万枚。",
        img: IMG_BASE + "26BICE03-01.jpg",
        img2: IMG_BASE + "26BICE03-02.jpg"
    },
    {
        event: "2026年第30届北京国际钱币博览会",   // 侧边栏与大标题用的活动名（将来别的会写别的）
        copyId: "26BICE04",
        name: "2017年 河北雄安新区设立纪念 1.20元 新起点 / 1.20元 新使命（一套2枚）",
        group: "纸币 - 邮票",
        kind: "纸币 - 邮票",
        bank: "中国邮政",
        year: 2017,
        version: "2017-30 (2-1)/(2-2)J",
        grader: "HDGS",
        condition: "真品",
        price: "1元",
        purchaseDate: "2026年10月31日",
        tags: ["赠品", "邮票"],
        remark: "",
        img: IMG_BASE + "26BICE04-01.jpg",
        img2: IMG_BASE + "26BICE04-02.jpg"
    },
    {
        event: "2026年第30届北京国际钱币博览会",   // 侧边栏与大标题用的活动名（将来别的会写别的）
        copyId: "26BICE05",
        name: "朝鲜 ½전（Chon） 野生动物系列纪念币 盘羊",
        group: "硬币 - 外国硬币",
        kind: "硬币 - 外国硬币",
        bank: "朝鲜中央银行",
        year: 2002,
        denomination: "½Chon（半钱）",
        bank: "朝鲜",
        grader: "TQG",
        condition: "MS63",
        price: "1元",
        purchaseDate: "2026年10月31日",
        tags: ["赠品", "外币"],
        remark: "由扭蛋中的奖券兑换而来，兑换自“朝鲜中央银行造币厂”展位。",
        img: IMG_BASE + "26BICE05-01.jpg",
        img2: IMG_BASE + "26BICE05-02.jpg"
    },
    {
        event: "2026年第30届北京国际钱币博览会",   // 侧边栏与大标题用的活动名（将来别的会写别的）
        copyId: "26BICE08",
        name: "北宋 天圣元宝 小平 隐郭",
        group: "硬币 - 古钱币",
        kind: "硬币 - 古钱币",
        bank: "北宋政府",
        year: 1023,
        grader: "斗泉",
        condition: "真品",
        price: "0元",
        purchaseDate: "2026年10月31日",
        tags: ["赠品", "古钱币"],
        remark: "小平指钱币的规格面值，即折值一文使用的标准小钱。隐郭为版别术语，即指内圈边缘凸起很低、线条较细，方孔周围的轮廓模糊低平。此枚通过下载并注册“斗泉”APP获赠。",
        img: IMG_BASE + "26BICE08-01.jpg",
        img2: IMG_BASE + "26BICE08-02.jpg"
    },
    {
        event: "2026年第30届北京国际钱币博览会",   // 侧边栏与大标题用的活动名（将来别的会写别的）
        copyId: "26BICE07",
        name: "北宋 元丰通宝 小平 阔缘（真书）",
        group: "硬币 - 古钱币",
        kind: "硬币 - 古钱币",
        bank: "北宋政府",
        year: 1078,
        grader: "国正评级",
        condition: "真品",
        price: "0元",
        purchaseDate: "2026年10月31日",
        tags: ["赠品", "古钱币"],
        remark: "真书即楷书。阔缘为版别特征，即外沿比普通版更宽厚。此枚通过扫码关注“国正评级”公众号并加相关人员微信获赠。博览会上该币的零售价为5元。",
        img: IMG_BASE + "26BICE07-01.jpg",
        img2: IMG_BASE + "26BICE07-02.jpg"
    },
    {
        event: "2026年第30届北京国际钱币博览会",   // 侧边栏与大标题用的活动名（将来别的会写别的）
        copyId: "26BICE06",
        name: "北宋 元丰通宝 小平 四出（篆书）",
        group: "硬币 - 古钱币",
        kind: "硬币 - 古钱币",
        bank: "北宋政府",
        year: 1078,
        grader: "国正评级",
        condition: "真品",
        price: "0元",
        purchaseDate: "2026年10月31日",
        tags: ["赠品", "古钱币"],
        remark: "四出为版别特征，指钱币方孔的四个角分别向外斜向延伸出四条短线。此枚通过扫码关注“国正评级”公众号并加相关人员微信获赠。博览会上该币的零售价为5元。",
        img: IMG_BASE + "26BICE06-01.jpg",
        img2: IMG_BASE + "26BICE06-02.jpg"
    }
];