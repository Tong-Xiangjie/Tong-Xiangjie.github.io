<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=yes">
    <title>即将到来 | 敬请期待</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: system-ui, -apple-system, 'Segoe UI', 'Poppins', 'Roboto', 'Helvetica Neue', sans-serif;
            background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 2rem;
            position: relative;
            overflow-x: hidden;
        }

        /* 动态背景装饰 - 柔和光晕 */
        body::before {
            content: '';
            position: absolute;
            width: 150%;
            height: 150%;
            top: -25%;
            left: -25%;
            background: radial-gradient(circle at 30% 20%, rgba(99, 102, 241, 0.2), rgba(139, 92, 246, 0.05) 60%, transparent 80%);
            pointer-events: none;
            z-index: 0;
        }

        body::after {
            content: '';
            position: absolute;
            width: 100%;
            height: 100%;
            top: 0;
            left: 0;
            background-image: radial-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px);
            background-size: 40px 40px;
            pointer-events: none;
            z-index: 0;
        }

        /* 主卡片容器 */
        .container {
            position: relative;
            z-index: 2;
            max-width: 720px;
            width: 100%;
            text-align: center;
            backdrop-filter: blur(2px);
            animation: fadeInUp 1.1s cubic-bezier(0.2, 0.9, 0.4, 1.1) forwards;
        }

        /* 核心内容区 */
        .hero {
            background: rgba(15, 23, 42, 0.65);
            backdrop-filter: blur(16px);
            border-radius: 4rem;
            padding: 3rem 2rem;
            box-shadow: 0 25px 45px -12px rgba(0, 0, 0, 0.5), 0 1px 2px rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.12);
            transition: transform 0.3s ease, box-shadow 0.3s ease;
        }

        .hero:hover {
            transform: scale(1.01);
            box-shadow: 0 30px 55px -12px rgba(0, 0, 0, 0.6);
            border-color: rgba(255, 255, 255, 0.2);
        }

        /* 主标题 中英文优雅展示 */
        .main-title {
            font-size: clamp(2.8rem, 10vw, 5rem);
            font-weight: 800;
            letter-spacing: -0.02em;
            line-height: 1.2;
            margin-bottom: 1rem;
        }

        .chinese {
            display: block;
            background: linear-gradient(135deg, #F9FAFB, #C7D2FE, #A5B4FC);
            background-clip: text;
            -webkit-background-clip: text;
            color: transparent;
            text-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
            margin-bottom: 0.5rem;
        }

        .english {
            display: block;
            font-size: clamp(1.6rem, 6vw, 2.8rem);
            font-weight: 500;
            letter-spacing: 2px;
            color: #E2E8F0;
            background: linear-gradient(120deg, #E2E8F0, #94A3B8);
            background-clip: text;
            -webkit-background-clip: text;
            color: transparent;
            text-shadow: 0 1px 2px rgba(0,0,0,0.2);
            margin-top: 0.25rem;
        }

        /* 装饰性分隔线 */
        .divider {
            width: 80px;
            height: 4px;
            background: linear-gradient(90deg, #818CF8, #C084FC, #818CF8);
            border-radius: 4px;
            margin: 1.8rem auto 1.8rem auto;
        }

        /* 辅助说明文字 */
        .sub-message {
            color: #CBD5E1;
            font-size: 1.1rem;
            font-weight: 400;
            line-height: 1.5;
            max-width: 480px;
            margin: 0 auto;
            padding: 0 0.5rem;
            backdrop-filter: blur(4px);
        }

        /* 点缀小装饰 — 动态发光点 */
        .glow-dot {
            position: absolute;
            width: 8px;
            height: 8px;
            background: #A78BFA;
            border-radius: 50%;
            filter: blur(3px);
            opacity: 0.7;
            animation: floatGlow 6s infinite alternate ease-in-out;
            pointer-events: none;
            z-index: 1;
        }

        /* 增加一个简单的等待指示器，表示活力 */
        .pulse-ring {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            margin-top: 2.5rem;
            gap: 0.75rem;
        }

        .dot {
            width: 8px;
            height: 8px;
            background-color: #A78BFA;
            border-radius: 50%;
            display: inline-block;
            animation: pulseDot 1.4s infinite ease-in-out both;
        }

        .dot:nth-child(1) {
            animation-delay: -0.32s;
        }
        .dot:nth-child(2) {
            animation-delay: -0.16s;
        }
        .dot:nth-child(3) {
            animation-delay: 0s;
        }

        /* 微提示底部 */
        .footer-note {
            margin-top: 2.8rem;
            font-size: 0.8rem;
            color: #64748B;
            letter-spacing: 0.3px;
            font-weight: 400;
            transition: color 0.2s;
        }

        .footer-note:hover {
            color: #94A3B8;
        }

        /* 动画区 */
        @keyframes fadeInUp {
            0% {
                opacity: 0;
                transform: translateY(30px);
            }
            100% {
                opacity: 1;
                transform: translateY(0);
            }
        }

        @keyframes floatGlow {
            0% {
                transform: translate(0, 0) scale(1);
                opacity: 0.3;
            }
            100% {
                transform: translate(15px, -20px) scale(1.6);
                opacity: 0.8;
            }
        }

        @keyframes pulseDot {
            0%, 80%, 100% {
                transform: scale(0.6);
                opacity: 0.4;
            }
            40% {
                transform: scale(1.2);
                opacity: 1;
                background-color: #C084FC;
            }
        }

        /* 响应式微调 */
        @media (max-width: 550px) {
            .hero {
                padding: 2rem 1.5rem;
                border-radius: 2.5rem;
            }
            .sub-message {
                font-size: 0.95rem;
            }
            .divider {
                width: 60px;
                margin: 1.4rem auto;
            }
        }

        /* 适配暗色模式 (系统深色下微调增强) */
        @media (prefers-color-scheme: dark) {
            .hero {
                background: rgba(10, 15, 30, 0.7);
                backdrop-filter: blur(20px);
            }
        }
    </style>
</head>
<body>

<!-- 动态浮动光点装饰 (随机几个移动的点，增加生动感) -->
<div class="glow-dot" style="top: 12%; left: 8%; animation-duration: 8s;"></div>
<div class="glow-dot" style="bottom: 18%; right: 12%; animation-duration: 10s; width: 10px; height: 10px; background: #F472B6;"></div>
<div class="glow-dot" style="top: 30%; right: 5%; animation-duration: 7s; width: 6px; height: 6px; background: #34D399;"></div>
<div class="glow-dot" style="bottom: 25%; left: 15%; animation-duration: 12s; width: 12px; height: 12px; background: #FBBF24; filter: blur(4px);"></div>
<div class="glow-dot" style="top: 65%; left: 85%; animation-duration: 9s; width: 5px; height: 5px; background: #60A5FA;"></div>

<div class="container">
    <div class="hero">
        <!-- 主要信息：即将到来 + Coming soon! -->
        <div class="main-title">
            <span class="chinese">即将到来！</span>
            <span class="english">Coming soon!</span>
        </div>
        
        <div class="divider"></div>
        
        <div class="sub-message">
            ✨ 我们正在努力打造令人兴奋的新体验 ✨<br>
            敬请期待 — 精彩即将绽放
        </div>
        
        <!-- 动态小圆点增加现代感，隐喻进度/等待中但充满活力 -->
        <div class="pulse-ring">
            <span class="dot"></span>
            <span class="dot"></span>
            <span class="dot"></span>
        </div>
        
        <div class="footer-note">
            🚀 保持关注 · 倒计时开启
        </div>
    </div>
</div>

<!-- 简洁脚本：仅用于动态年份或者可选的控制台友好提示（无侵入性） -->
<script>
    (function() {
        // 纯装饰性的优雅控制台问候，不干扰主要展示，仅为页面增加一点趣味
        console.log("%c✨ 页面加载完成 | 精彩即将到来 ✨", "color: #A78BFA; font-size: 14px; font-weight: bold;");
        console.log("%c「即将到来！Coming soon!」 敬请期待后续更新。", "color: #94A3B8; font-size: 12px;");
        
        // 可选：添加非常细微的视差效果，让光点跟随鼠标移动一点点 (提升体验但不影响主要内容)
        // 为了保持简洁，不过度增加复杂度，只让光点有一点微妙反映，让用户感到呼吸感
        const dots = document.querySelectorAll('.glow-dot');
        if (dots.length && window.innerWidth > 768) {
            document.addEventListener('mousemove', (e) => {
                const mouseX = e.clientX / window.innerWidth;
                const mouseY = e.clientY / window.innerHeight;
                dots.forEach((dot, idx) => {
                    // 轻柔移动，幅度小，避免干扰阅读
                    const moveX = (mouseX - 0.5) * 12 * (idx % 2 === 0 ? 1 : -0.8);
                    const moveY = (mouseY - 0.5) * 10 * (idx % 3 === 0 ? 1.2 : 0.7);
                    dot.style.transform = `translate(${moveX}px, ${moveY}px)`;
                });
            });
        }
        
        // 简单添加一个动态效果：每三秒微微调整光晕的不透明度 (增强生命力)
        let glowIndex = 0;
        setInterval(() => {
            const heroDiv = document.querySelector('.hero');
            if (heroDiv) {
                // 非常轻微呼吸效果，只改变边框光晕透明度，不突兀
                const borderGlow = `rgba(167, 139, 250, ${0.1 + Math.sin(Date.now() / 3000) * 0.05})`;
                heroDiv.style.transition = 'border-color 0.8s ease';
                heroDiv.style.borderColor = borderGlow;
                // 重置一下避免僵化，但保留主边框色
                setTimeout(() => {
                    if(heroDiv) heroDiv.style.borderColor = 'rgba(255, 255, 255, 0.12)';
                }, 700);
            }
        }, 2200);
    })();
</script>
</body>
</html>
