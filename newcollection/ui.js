/* ===== 修复：initPinchZoom — 带边界限制，缩放范围 1~4 倍 ===== */
function initPinchZoom() {
    const container = document.getElementById('imageContainer');
    if (!container) return;
    if (hammerManager) { hammerManager.destroy(); hammerManager = null; }
    hammerManager = new Hammer.Manager(container);
    const pinch = new Hammer.Pinch();
    const pan = new Hammer.Pan();
    hammerManager.add([pinch, pan]);
    let lastScale = 1, lastX = 0, lastY = 0;

    function resetTransform() {
        currentScale = 1; currentX = 0; currentY = 0;
        container.style.transform = 'translate3d(0px, 0px, 0px) scale3d(1, 1, 1)';
    }

    function clampTransform() {
        const img = document.getElementById('modalImg');
        if (!img) return;
        const containerRect = container.parentElement.getBoundingClientRect();
        const imgRect = img.getBoundingClientRect();
        const scaledWidth = imgRect.width, scaledHeight = imgRect.height;
        let maxX = 0, maxY = 0;
        if (scaledWidth > containerRect.width) maxX = (scaledWidth - containerRect.width) / 2;
        if (scaledHeight > containerRect.height) maxY = (scaledHeight - containerRect.height) / 2;
        currentX = Math.min(maxX, Math.max(-maxX, currentX));
        currentY = Math.min(maxY, Math.max(-maxY, currentY));
        container.style.transform = `translate3d(${currentX}px, ${currentY}px, 0px) scale3d(${currentScale}, ${currentScale}, 1)`;
    }

    hammerManager.on('pinchstart', function(e) { lastScale = currentScale; e.preventDefault(); });
    hammerManager.on('pinchmove', function(e) {
        let newScale = lastScale * e.scale;
        newScale = Math.min(4, Math.max(1, newScale));
        currentScale = newScale;
        container.style.transform = `translate3d(${currentX}px, ${currentY}px, 0px) scale3d(${currentScale}, ${currentScale}, 1)`;
        e.preventDefault();
    });
    hammerManager.on('pinchend', function(e) { clampTransform(); e.preventDefault(); });
    hammerManager.on('panstart', function(e) { lastX = currentX; lastY = currentY; });
    hammerManager.on('panmove', function(e) {
        if (currentScale > 1) {
            currentX = lastX + e.deltaX;
            currentY = lastY + e.deltaY;
            container.style.transform = `translate3d(${currentX}px, ${currentY}px, 0px) scale3d(${currentScale}, ${currentScale}, 1)`;
        }
        e.preventDefault();
    });
    hammerManager.on('panend', function(e) { clampTransform(); });
    container.addEventListener('dblclick', function(e) { resetTransform(); e.preventDefault(); });
    resetTransform();
}
