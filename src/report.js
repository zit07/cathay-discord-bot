function money(n) {
    return new Intl.NumberFormat("vi-VN").format(n) + "đ";
}

function createReport(results) {
    let paid = 0;
    let unpaid = 0;
    let mismatch = 0;

    const lines = [];
    lines.push("📋 KẾT QUẢ KIỂM TRA");
    lines.push("");

    // Phân nhóm kết quả để hiển thị theo thứ tự mong muốn
    const paidList = results.filter(r => r.paid && !r.error);
    const unpaidList = results.filter(r => !r.paid && !r.error);
    const errorList = results.filter(r => r.error);

    // 1. Đưa các đơn ĐÃ THANH TOÁN (🟢) lên trên cùng và thu gọn 1 dòng
    if (paidList.length > 0) {
        for (const r of paidList) {
            lines.push(`🟢 ${r.policy} - Đã thanh toán`);
            paid++;
        }
        lines.push(""); // Dòng trống ngăn cách giữa nhóm Đã thanh toán và Chưa thanh toán
    }

    // 2. Đưa các đơn CHƯA THANH TOÁN (🔴) xuống phía dưới
    if (unpaidList.length > 0) {
        for (const r of unpaidList) {
            unpaid++;
            
            if (r.items.length === 1) {
                // Trường hợp nợ 1 kỳ: Gộp tất cả vào 1 dòng duy nhất
                let line = `🔴 ${r.policy} - Nợ: ${money(r.items[0].amount)}`;
                
                if (r.expected != null) {
                    let matchText = "";
                    if (r.match) {
                        if (r.mode === "single") matchText = "✅ Khớp 1 kỳ";
                        else if (r.mode === "total") matchText = "✅ Khớp tổng";
                        else matchText = "✅ Khớp";
                    } else {
                        mismatch++;
                        const sign = r.diff > 0 ? "+" : "";
                        matchText = `⚠ Sai lệch ${sign}${money(r.diff)}`;
                    }
                    line += ` | Ghi chú: ${money(r.expected)} (${matchText})`;
                }
                lines.push(line);
            } else {
                // Trường hợp nợ nhiều kỳ: Giữ chi tiết các kỳ nhưng bỏ chữ "Cathay"
                lines.push(`🔴 ${r.policy} - Tổng nợ: ${money(r.cathay)}`);
                for (const item of r.items) {
                    lines.push(`  • ${item.date} : ${money(item.amount)}`);
                }
                
                if (r.expected != null) {
                    let matchText = "";
                    if (r.match) {
                        if (r.mode === "single") matchText = "✅ Khớp 1 kỳ";
                        else if (r.mode === "total") matchText = "✅ Khớp tổng";
                        else matchText = "✅ Khớp";
                    } else {
                        mismatch++;
                        const sign = r.diff > 0 ? "+" : "";
                        matchText = `⚠ Sai lệch ${sign}${money(r.diff)}`;
                    }
                    lines.push(`  [Ghi chú: ${money(r.expected)} | ${matchText}]`);
                }
            }
            lines.push(""); // Dòng trống phân cách giữa các đơn chưa thanh toán
        }
    }

    // 3. Đưa danh sách LỖI (❌) xuống dưới cùng (nếu có)
    if (errorList.length > 0) {
        for (const r of errorList) {
            lines.push(`❌ ${r.policy} - Lỗi: ${r.error}`);
        }
        lines.push("");
    }

    // Xóa dòng trống thừa ở cuối cùng trước khi vẽ đường gạch ngang
    if (lines[lines.length - 1] === "") {
        lines.pop();
    }

    lines.push("──────────────");
    lines.push(`🟢 Đã thanh toán : ${paid}`);
    lines.push(`🔴 Chưa thanh toán : ${unpaid}`);
    lines.push(`⚠ Sai lệch : ${mismatch}`);

    return lines.join("\n");
}

module.exports = createReport;