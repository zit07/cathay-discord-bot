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

    // Duyệt qua TẤT CẢ các mã để hiển thị đầy đủ, không ẩn mã nào
    for (const r of results) {
        if (r.error) {
            lines.push(`❌ ${r.policy} - Lỗi: ${r.error}`);
            lines.push("");
            continue;
        }

        if (r.paid) {
            paid++;
            lines.push(`🟢 ${r.policy} - Đã thanh toán`);
            lines.push("");
        } else {
            unpaid++;
            if (r.expected != null && !r.match) {
                mismatch++;
            }

            if (r.items.length === 1) {
                // Trường hợp cước 1 kỳ
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
                // Trường hợp cước nhiều kỳ
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
            lines.push(""); // Dòng trống phân cách
        }
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