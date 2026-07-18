function money(n) {
    return new Intl.NumberFormat("vi-VN").format(n) + "đ";
}

function createReport(results) {
    let paid = 0;
    let unpaid = 0;
    let mismatch = 0;

    // 1. TÍNH TOÁN SỐ LIỆU TỔNG KẾT TRƯỚC (Giữ đếm chính xác cho toàn bộ danh sách)
    for (const r of results) {
        if (r.error) continue;
        if (r.paid) {
            paid++;
        } else {
            unpaid++;
            if (r.expected != null && !r.match) {
                mismatch++;
            }
        }
    }

    const lines = [];
    lines.push("📋 KẾT QUẢ KIỂM TRA");
    lines.push("");

    // 2. LỌC DANH SÁCH HIỂN THỊ: Chỉ hiện đơn CHƯA THANH TOÁN và BỊ SAI LỆCH (hoặc đơn không có ghi chú)
    const unpaidList = results.filter(r => !r.paid && !r.error);
    const unpaidToDisplay = unpaidList.filter(r => r.expected == null || !r.match);

    if (unpaidToDisplay.length > 0) {
        for (const r of unpaidToDisplay) {
            if (r.items.length === 1) {
                // Trường hợp cước 1 kỳ: Đổi "Nợ" thành "Cước còn"
                let line = `🔴 ${r.policy} - Cước còn: ${money(r.items[0].amount)}`;
                
                if (r.expected != null) {
                    let matchText = "";
                    if (r.match) {
                        if (r.mode === "single") matchText = "✅ Khớp 1 kỳ";
                        else if (r.mode === "total") matchText = "✅ Khớp tổng";
                        else matchText = "✅ Khớp";
                    } else {
                        const sign = r.diff > 0 ? "+" : "";
                        matchText = `⚠ Sai lệch ${sign}${money(r.diff)}`;
                    }
                    line += ` | Ghi chú: ${money(r.expected)} (${matchText})`;
                }
                lines.push(line);
            } else {
                // Trường hợp cước nhiều kỳ: Đổi "Tổng nợ" thành "Tổng cước còn"
                lines.push(`🔴 ${r.policy} - Tổng cước còn: ${money(r.cathay)}`);
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
                        const sign = r.diff > 0 ? "+" : "";
                        matchText = `⚠ Sai lệch ${sign}${money(r.diff)}`;
                    }
                    lines.push(`  [Ghi chú: ${money(r.expected)} | ${matchText}]`);
                }
            }
            lines.push(""); // Dòng trống phân cách giữa các đơn
        }
    }

    // 3. LỌC DANH SÁCH LỖI (❌) ĐỂ HIỂN THỊ XUỐNG DƯỚI CÙNG (Nếu có)
    const errorList = results.filter(r => r.error);
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