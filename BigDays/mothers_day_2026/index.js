<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=yes">
    <title>母亲节快乐</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            min-height: 100vh;
            background: linear-gradient(145deg, #f7e8df 0%, #f0dbcf 100%);
            font-family: 'Segoe UI', '华文楷书', 'Microsoft YaHei', serif;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
            overflow-x: hidden;
        }

        .envelope-container {
            position: relative;
            z-index: 10;
            max-width: 720px;
            width: 100%;
        }

        .envelope {
            width: 100%;
            background: #fcf3e9;
            border-radius: 0 0 16px 16px;
            box-shadow: 0 20px 30px -10px rgba(60, 30, 15, 0.35);
            border: 1px solid #e0cbb8;
            position: relative;
            padding-top: 180px;
        }

        .envelope-flap {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 180px;
            background: #f7ede2;
            clip-path: polygon(0 0, 100% 0, 50% 100%);
            cursor: pointer;
            transition: transform 0.5s cubic-bezier(0.2, 0.9, 0.4, 1.2);
            transform-origin: top center;
            z-index: 20;
        }

        .triangle-btn {
            position: absolute;
            top: 180px;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 60px;
            height: 60px;
            background: #ecb692;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 6px 14px rgba(80, 45, 20, 0.4);
            border: 2px solid #fff5ec;
            cursor: pointer;
            z-index: 25;
            transition: 0.3s ease;
        }
        .envelope-container.open .triangle-btn {
            opacity: 0;
            visibility: hidden;
            pointer-events: none;
        }
        .triangle-btn span { font-size: 32px; }

        .envelope-cover-text {
            position: absolute;
            top: 220px;
            left: 50%;
            transform: translateX(-50%);
            text-align: center;
            color: #c3512f;
            font-size: 1.8rem;
            font-weight: bold;
            z-index: 15;
            transition: opacity 0.3s;
            line-height: 1.8;
        }
        .envelope-container.open .envelope-cover-text {
            opacity: 0;
            visibility: hidden;
        }

        .letter-card {
            width: 90%;
            margin: 0 auto 40px;
            background: #fffbf7;
            border-radius: 48px 40px 56px 48px;
            box-shadow: 0 12px 24px rgba(90, 45, 25, 0.1);
            padding: 2rem 1.5rem 2.2rem;
            text-align: center;
            transition: all 0.3s ease;
            position: relative;
            z-index: 10;
        }

        .envelope-container.closed .letter-card {
            opacity: 0;
            visibility: hidden;
            pointer-events: none;
        }
        .envelope-container.open .letter-card {
            opacity: 1;
            visibility: visible;
            pointer-events: auto;
        }

        .envelope-container.open .envelope-flap {
            transform: rotateX(180deg);
            background: #eedbcb;
        }

        .mother-icon {
            font-size: 5rem;
            margin-bottom: 0.5rem;
            animation: gentleFloat 3s infinite ease-in-out;
        }
        @keyframes gentleFloat {
            0%,100%{transform: translateY(0);}
            50%{transform: translateY(-7px);}
        }

        .mother-day-date {
            background: #ffd5be;
            border-radius: 60px;
            padding: 0.3rem 1.5rem;
            margin: 0 auto 0.6rem;
            font-size: 0.9rem;
            color: #bc5a3a;
            font-weight: bold;
            width: fit-content;
        }
        .year-title {
            font-size: 1.1rem;
            color: #e28b6f;
            background: #fff0e7;
            padding: 0.2rem 1rem;
            border-radius: 60px;
            display: inline-block;
            margin-bottom: 0.8rem;
        }
        h1 {
            font-size: 2.3rem;
            color: #c3512f;
            margin: 0.3rem 0 0.5rem;
        }
        .greeting {
            font-size: 1.5rem;
            color: #b45a3b;
            margin: 0.7rem 0 0.8rem;
        }
        .message {
            background: #fff7f0;
            padding: 1rem;
            border-radius: 44px;
            margin: 1rem auto;
            font-size: 1rem;
            line-height: 1.65;
            color: #4e2e23;
            max-width: 90%;
        }
        .heart-icon {
            color: #f05b56;
            font-size: 1.2rem;
            margin-right: 6px;
        }
        .signature {
            margin-top: 1rem;
            font-size: 1rem;
            border-top: 2px dashed #faccb3;
            padding-top: 1rem;
            display: flex;
            justify-content: center;
            gap: 20px;
            flex-wrap: wrap;
        }
        .btn-love {
            background: #ea9e82;
            border: none;
            color: #fff;
            font-size: 1.08rem;
            font-weight: bold;
            padding: 10px 28px;
            border-radius: 60px;
            cursor: pointer;
            box-shadow: 0 5px 0 #9b4a2e;
            margin-top: 20px;
        }
        .btn-love:active {
            transform: translateY(2px);
            box-shadow: 0 2px 0 #9b4a2e;
        }

        .floating-heart {
            position: fixed;
            left: 0;
            top: 0;
            pointer-events: none;
            font-size: 1.6rem;
            z-index: 99999;
            animation: heartFly 1.5s ease-out forwards;
        }
        @keyframes heartFly {
            0% { opacity: 1; transform: scale(0.6); }
            100% { opacity: 0; transform: translateY(-300px) scale(1.5); }
        }

        .stamp-deco {
            position: absolute;
            top: 20px;
            right: 24px;
            font-size: 2rem;
            opacity: 0.85;
            z-index: 12;
            transform: rotate(6deg);
            pointer-events: none;
        }
        .address-deco {
            position: absolute;
            bottom: 20px;
            left: 24px;
            font-size: 0.7rem;
            color: #b0795c;
            background: #f0dfcf;
            border-radius: 60px;
            padding: 4px 16px;
            z-index: 12;
            pointer-events: none;
        }
    </style>
</head>
<body>

<div class="envelope-container closed" id="envelopeContainer">
    <div class="envelope" id="envelopeMain">
        <div class="envelope-flap" id="envelopeFlap"></div>
        <div class="triangle-btn" id="roundToggleBtn"><span>⭐</span></div>
        <div class="envelope-cover-text">母亲节快乐<br>愿时光温柔待您</div>

        <div class="letter-card" id="letterCard">
            <div class="mother-icon">👩‍👧‍👦🌹</div>
            <div class="mother-day-date">✨ 2026 年 5 月 · 母亲节 ✨</div>
            <div class="year-title">💗 献给最爱的妈妈 💗</div>
            <h1>母亲节快乐<br><span style="font-size:1.2rem">Happy Mother's Day</span></h1>
            <div class="greeting">🌷 亲爱的妈妈 🌷</div>
            <div class="message">
                <p><span class="heart-icon">❤️</span>您是我生命里最暖的光，岁岁年年，温柔且坚定。</p>
                <p><span class="heart-icon">🌸</span>感谢您包容我的任性，默默为我付出所有。</p>
                <p><span class="heart-icon">🌼</span>愿时光慢一点，温柔待您，平安健康，岁岁无忧。</p>
                <p style="margin-top:8px;font-style:italic;">永远爱您，我最亲爱的妈妈。</p>
            </div>
            <div class="signature">
                <span>💖 您永远的孩子</span>
                <span>📅 母亲节</span>
            </div>
            <div style="display:flex;justify-content:center;">
                <button class="btn-love" id="loveButton">💝 送妈妈小红心 💝</button>
            </div>
        </div>

        <div class="stamp-deco">🌸💌🌸</div>
        <div class="address-deco">To：最美的妈妈 🌷</div>
    </div>
</div>

<script>
const container = document.getElementById('envelopeContainer');
const toggleBtn = document.getElementById('roundToggleBtn');
const flap = document.getElementById('envelopeFlap');
let isOpen = false;

function toggleEnvelope(){
    isOpen = !isOpen;
    container.classList.toggle('open', isOpen);
    container.classList.toggle('closed', !isOpen);
}
toggleBtn.onclick = toggleEnvelope;
flap.onclick = toggleEnvelope;

const loveBtn = document.getElementById('loveButton');
const emojis = ['❤️','💖','🌸','💗','⭐','💝','🌹','🌷','🌺','💓','💕','💞','✨','🎀','💐'];

function createHeart(x,y,emo){
    let el = document.createElement('div');
    el.className = 'floating-heart';
    el.innerText = emo;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.fontSize = (Math.random()*20 + 14) + 'px';
    document.body.appendChild(el);
    setTimeout(()=>el.remove(), 1500);
}

loveBtn.onclick = function(e){
    e.stopPropagation();
    if(!isOpen) return;

    // 全屏 + 超密集特效
    for(let i=0;i<120;i++){
        setTimeout(()=>{
            let ranX = Math.random() * window.innerWidth;
            let ranY = Math.random() * window.innerHeight;
            let emo = emojis[Math.floor(Math.random()*emojis.length)];
            createHeart(ranX, ranY, emo);
        }, i*6);
    }
};
</script>
</body>
</html>
