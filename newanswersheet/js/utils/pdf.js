// ============================================================
// pdf.js — PDF 导出封装（带进度反馈）
// ============================================================

let isExporting = false;

export async function exportPDF(title, subject) {
    if (isExporting) return; // 防重复点击
    isExporting = true;

    const btn = document.getElementById('pdfBtn');
    const originalText = btn.textContent;
    btn.textContent = '正在生成 PDF...';
    btn.disabled = true;

    try {
        const container = document.getElementById('cardContainer');
        const safeTitle = title.replace(/[\\/:*?"<>|]/g, '').trim() || '答题卡';
        const filename = `${safeTitle}_${subject}答题卡.pdf`;

        await html2pdf()
            .set({
                margin: 0,
                filename,
                image: { type: 'image/png', quality: 0.95 },
                html2canvas: { 
                    scale: 2,          // 从3降为2，大幅减少内存
                    useCORS: true,
                    logging: false,
                },
                jsPDF: {
                    unit: 'mm',
                    format: 'a4',
                    orientation: 'portrait',
                },
            })
            .from(container)
            .save();

    } catch (err) {
        console.error('PDF 导出失败:', err);
        alert('PDF 导出失败，请重试或检查浏览器控制台');
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
        isExporting = false;
    }
}
